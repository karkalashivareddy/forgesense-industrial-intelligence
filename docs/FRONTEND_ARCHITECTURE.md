# Frontend Architecture

The ForgeSense Industrial Operations Center.

```
src/
  main.tsx                  mount
  App.tsx                   providers, auth gate, route table
  api/          types, client, adapters, queries
  auth/         AuthProvider, SignInGate, session storage
  app/          AppShell, route table, shell.css
  realtime/     stomp.ts (wire), store.ts (state), useRealtimeSession.ts
  store/        ui.ts (selection + workspace UI)
  domain/       basis.ts, machineState.ts, format.ts
  design-system/index.tsx
  three/        TwinScene.ts (imperative), useTwinCanvas.tsx (binding)
  routes/       12 lazily-loaded workspaces
  hooks/        useNow, useFocusTrap
  styles/       tokens.css, global.css, components.css, workspaces.css
```

---

## 1. Stack and why

| Choice | Reason |
| --- | --- |
| **React + TypeScript + Vite** | The brief's product needs a component model with types. Vanilla JS with a hand-rolled renderer had no type safety and no way to express the realtime render-isolation contract. |
| **TanStack Query** for server state | Per-resource caching, per-resource error isolation, and stale/retry policy in one place. This replaced the single `Promise.all` poll that made one failure blank everything. |
| **Zustand** for client/realtime state | Minimal store with selector subscriptions, so a telemetry packet can update one component instead of the tree. |
| **Three.js** | The digital twin. Pinned at `0.169.0`, bundled, lazily loaded. |
| **ECharts** (tree-shaken core) | Canvas rendering for the analytics surface, imported per chart type so the bundle carries only bar, line and scatter. |
| **Lucide React** | One icon family, bundled, tree-shakeable. |
| **Vitest + Playwright** | Unit tests for the logic that must be right, browser tests for the product. |

Not used: Bootstrap, Material UI, Ant Design, Redux, any dashboard template.
Nothing in the UI is borrowed from a generic admin kit — the visual identity is
built from the token layer.

---

## 2. State architecture

Four stores, split by **update frequency** and **subscription scope**. This is
the central design decision: it is what stops a telemetry storm from
re-rendering the application.

| Store | Holds | Update rate | Subscribers |
| --- | --- | --- | --- |
| TanStack Query | every REST resource | per its own interval | the components that need it |
| `useRealtimeStore` | transport status, dirty-machine set, live alerts | low | shell, status strip, System |
| `useTelemetryStore` | latest reading + bounded ring per asset | **high** | only components showing that asset |
| `useUiStore` | selection, inspector, navigation, toasts | user-driven | shell, inspector, twin |

### Why the split matters

A naive design puts telemetry in one global store. Then every reading triggers
one `set()`, which re-renders the top bar, the sidebar, the status bar and the
active route. At 18 assets on a 5 s interval that is a visible, expensive
reconciliation on every frame.

Here, `useTelemetryStore` is subscribed to **only** by the components that
display a specific machine's readings, and the machine inspector `watch()`es a
ring only while it is open. A packet for an asset nobody is looking at updates
one map entry and re-renders nothing.

---

## 3. Data flow

```
                    ┌──────────────── REST (authority) ────────────────┐
                    │  /machines  /alerts  /maintenance  /analytics …  │
                    └───────────────────────┬───────────────────────────┘
                                            │ TanStack Query
                                            │ per-key cache + error isolation
                                            ▼
  simulator ─▶ Kafka ─▶ backend pipeline ─▶ decision engine ─┐
                     │  (telemetry, anomaly, risk, alerts)      │
                     ▼                                        │
              WebSocket / STOMP deltas                        │
                     │                                        │
                     ▼                                        │
              validateEnvelope ─▶ dedupe ─▶ order ─▶ coalesce │
                     │                                        │
                     ▼                                        │
              rAF batched flush ─▶ useRealtimeStore            │
                                  useTelemetryStore            │
                                          │                   │
                                          ▼                   ▼
                                   selectors ─────────▶ components
                                                            │
                        reconciliation ◀────────────────────┘
                   (sequence gap or reconnect invalidates the query keys)
```

REST and realtime are complementary, never redundant: REST is the authority
and the reconciliation path; realtime reduces latency between polls.

---

## 4. Routing

`react-router-dom` with `BrowserRouter`, 12 routes, every workspace
`React.lazy`-loaded so the shell and command centre stay small.

Measured production chunks:

| Chunk | gzip |
| --- | --- |
| shell + React + router + query + zustand | 32.5 KB |
| Command Center | 3.9 KB |
| Factory Twin | 8.9 KB |
| Analytics | 3.2 KB |
| **Three.js** (twin only) | 122 KB |
| **ECharts** (analytics only) | 170 KB |

Three.js and ECharts are split out and only downloaded when their route is
visited. A user who never opens the twin never downloads Three.js.

nginx serves the SPA with `try_files … /index.html`, so a refresh on any deep
link resolves to the shell.

---

## 5. Realtime pipeline

Detailed in `docs/REALTIME_FRONTEND_CONTRACT.md`. In code:

- `realtime/stomp.ts` — the **only** module that speaks the wire protocol.
  Framing, validation, dedup, ordering, coalescing, rAF batching, bounded
  buffers, backoff, heartbeat. No React, no stores, fully unit-tested.
- `realtime/store.ts` — turns validated events into bounded, immutable state.
- `realtime/useRealtimeSession.ts` — owns one socket per authenticated session,
  tears it down on sign-out and on unmount, and pauses it when the tab is
  hidden.

### Connection honesty

`deriveConnectionQuality()` is the only producer of the word `LIVE`. It reads
observed transport state, never configuration, and refuses to say `LIVE` for a
synthetic feed.

---

## 6. Digital twin

`three/TwinScene.ts` is a plain class with an imperative API. React never
touches Three.js objects; it only calls methods and passes data.

```ts
const scene = new TwinScene({ containers, callbacks, reducedMotion });
scene.syncMachines(machines, zones);   // reconciles; creates/destroys only diffs
scene.setMode('risk');
scene.setSelected(['M-101']);
scene.focusMachine('M-101');
scene.dispose();
```

### Performance model

The scene renders **on demand**. It draws only when something changed — a
camera move, a state change, a selection, or a short settle window afterwards —
and then **stops scheduling frames entirely**. A stationary twin costs zero GPU.

Further guarantees:

- One `requestAnimationFrame` loop, owned by the class, cancelled on dispose.
- Hard suspend when `document.hidden` — no GPU work in a background tab.
- Shared geometry and materials; a live status change mutates one material
  colour, it never rebuilds the scene.
- Hover raycasting throttled to one pick per animation frame.
- `powerPreference: 'low-power'`, DPR capped at 2.
- Full disposal of geometries, materials, textures and per-node label sprites;
  the `ResizeObserver` and every DOM listener are released.

---

## 7. Accessibility

- Skip link first in tab order; landmarks `banner` / `navigation` / `main` / `contentinfo`.
- Focus trap and focus restoration in one shared hook (`useFocusTrap`), used by
  the drawer, modal and command palette.
- ARIA tab pattern with roving tabindex and arrow-key navigation.
- `role="meter"` with `aria-valuenow` for health and risk.
- Toasts are `role="status"` (polite) or `role="alert"` for critical.
- `prefers-reduced-motion` honoured globally and in the twin camera.
- Keyboard-equivalent access to every machine: the twin asset list, the fleet
  table and `Ctrl+K`. The 3D view is never the only route to an action.
- Colour is never the sole signal — every status pairs colour with an icon and
  a text label.

---

## 8. Security

| Concern | Measure |
| --- | --- |
| Password | Never stored, logged or persisted. Held in component state for the duration of the sign-in request only. |
| Token | `sessionStorage` — tab-scoped, discarded when the tab closes. Never `localStorage`, never a JS-readable cookie. |
| XSS | No `innerHTML` in `src/`. All rendering goes through React. No third-party script, no external origin. |
| CSP | Strict `default-src 'self'` with `connect-src` limited to the API origin, plus `nosniff`, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `Permissions-Policy`. |
| Authorization | The client hides actions the role cannot perform; the **backend re-authorises every call**. A 403 is surfaced, never swallowed. |
| Session expiry | Any `401` clears the session and re-opens the sign-in gate. No silent re-login. |
| Secrets | No credential exists in the frontend bundle or in `VITE_*` variables. |

### The session trade-off, stated plainly

A memory-only token would be marginally stronger but would force a re-login on
every page refresh — unacceptable for a console an operator keeps open all
shift. `sessionStorage` is scoped to the tab and cleared on close, so a shared
workstation does not leak a live session. The accepted risk (an XSS payload
could read the token) is why the app has no `innerHTML`, no third-party script,
no external origin, and a strict CSP.

---

## 9. Testing

| Layer | Tool | Count | Covers |
| --- | --- | --- | --- |
| Unit | Vitest | 98 | formatting/unit discipline, state derivation, data basis, envelope validation, STOMP framing, connection honesty, adapters, design tokens |
| E2E | Playwright | 30 | boot, auth, all 12 routes, deep links, refresh, selection journey, realtime honesty, backend-down, ML-down, a11y, reduced motion |
| Visual/responsive | Playwright | 13 | 8 workspaces × 5 breakpoints, mobile nav, bottom sheet, twin lifecycle, console/network cleanliness |

Run: `npm run typecheck`, `npm test`, `npm run e2e`.

---

## 10. Environment configuration

```bash
VITE_API_BASE_URL=http://localhost:8080
# VITE_WS_URL=ws://localhost:8080/ws   # derived from the API origin when unset
VITE_SHOW_SYNTHETIC_ADVISORY=true
```

Validated at module load — a malformed `VITE_API_BASE_URL` throws immediately in
development rather than producing silent fetch failures. See
`frontend/.env.example`. No secret belongs in any of these.
