# Final Frontend Redesign Report

**Branch:** `feat/industrial-operations-ui`
**Baseline:** `9444beb` on `main`
**Scope:** full audit, re-architecture, redesign, hardening and verification of
the ForgeSense frontend, plus the smallest safe backend corrections required
for the console to be truthful.

---

## 1. Executive summary

The baseline frontend was a **working but unmaintainable** vanilla JavaScript
SPA. It booted, rendered all twelve workspaces, held a live STOMP connection,
and produced zero console errors — but it had no build, no types, no
lockfile, four external runtime origins, a global mutable store where one
telemetry packet re-rendered the whole application, and **zero browser tests**.

The console was rebuilt as a **React 18 + TypeScript 5.7 + Vite 6** application
with **TanStack Query** for server state, **Zustand** for realtime state,
**Three.js** for the digital twin and **ECharts** for analytics — all
package-managed, all lazily loaded, **no external runtime origin**.

Two backend contract bugs and one unit-formatting bug were found during the
audit and fixed, because the console would otherwise have been forced to
display falsehoods.

**Result:** 66 unit tests, 43 browser tests (30 E2E + 13 visual/responsive) —
all passing. Typecheck clean, production build clean, zero console errors, zero
failed requests, zero unexpected 404s.

---

## 2. Original architecture

```
frontend/
  index.html          static shell: top bar, rail, 12 view hosts, inspector,
                      status bar, palette, toast
  js/app.js           main(): login → register views → boot router → poll → connect
  js/router.js        hash router, mount/unmount/activate/update per view
  js/state.js         ONE mutable singleton + notify() fan-out to all listeners
  js/realtime.js      hand-written STOMP client
  js/twin3d.js        ~1160 lines, CDN import map
  js/charts.js        bespoke canvas 2D chart
  css/*.css           tokens, base, components, views
```

Strengths preserved: the STOMP client design, the operational state ladder with
recovery confirmation, the twin's disposal discipline, the sensor unit map, and
the honest-by-default copy.

---

## 3. Finding → status table

Severity: **P0** breaks the product · **P1** materially degrades · **P2** debt ·
**P3** hygiene.

| Finding | Severity | Status | Evidence |
| --- | --- | --- | --- |
| F01 Three.js from `cdn.jsdelivr.net` import map | P1 | **Fixed** | `package.json` pins `three@0.169.0`; CI hygiene job rejects external origins |
| F02 Phosphor + Google Fonts from CDN | P1 | **Fixed** | Lucide React bundled; 3 woff2 files (124 KB) in `public/fonts/`; live run shows 0 external requests |
| F03 No `package.json` graph, no lockfile, no build | P0 | **Fixed** | `frontend/package-lock.json`; `npm ci` in CI; Dockerfile uses `npm ci` |
| F04 Zero type safety | P0 | **Fixed** | `strict` tsconfig; 40+ typed contracts in `src/api/types.ts`; `tsc --noEmit` clean |
| F05 `API_BASE` hardcoded in source | P1 | **Fixed** | `src/config/env.ts`, validated at load; `.env.example` |
| F06 Single `Promise.all` — one failure blanks the console | P0 | **Fixed** | Per-query-key TanStack Query; E2E "backend unreachable" test asserts one panel errors while the shell survives |
| F07 Global mutable store — one packet re-renders the app | P0 | **Fixed** | Four stores split by frequency; telemetry store has only narrow subscribers |
| F08 No browser tests | P0 | **Fixed** | 43 Playwright tests in CI |
| F09 `/system/status` contradicted `/telemetry/status` (`REST_POLL` vs `KAFKA`) | P0 | **Fixed** | Transport semantics separated; `SystemController.java` |
| F10 `/system/status` reported `H2_DEV` while on PostgreSQL | P1 | **Fixed** | Resolved from live `DataSource` metadata |
| F11 Factor rendering produced `NEUTRAL (+-2%)`; 0.06% risk → `"0%"` | P0 | **Fixed** | `DecisionEngine` formatters + `DecisionEngineFormattingTest` (7 tests) |
| F12 `zone` is a code on one endpoint, a name on another | P1 | **Fixed** | `normaliseZoneCode()`; unit-tested |
| F13 Top bar 550 px at a 375 px viewport | P1 | **Fixed** | Measured before/after; E2E asserts no overflow at 5 breakpoints |
| F14 Canvas painted over the twin controls (found by E2E) | P1 | **Fixed** | Explicit z-index layering; twin control E2E passes |
| F15 `esc()` applied before text-node insertion — double escaping | P2 | **Fixed** | React rendering; no `innerHTML` in `src/`; CI rejects regressions |
| F16 `el({ html })` → `innerHTML` footgun | P2 | **Fixed** | Helper deleted with the legacy renderer; CI hygiene job |
| F17 38 `innerHTML = ''` re-render clears | P3 | **Fixed** | React reconciliation |
| F18 `/simulation/scenarios` is run history, not a catalogue | P2 | **Documented + worked around** | Scenario Lab presents the backend's `ScenarioType` enum; the contract is documented |
| F19 Modelled figures shown beside observed counts | P1 | **Fixed** | `DATA_BASIS` vocabulary; basis chips throughout |
| F24 `POST /simulation/control` was never called by the UI, so the demo path "run a scenario → watch the fleet change" did not work | P1 | **Fixed** | Scenario Lab now separates **Run what-if** (`/simulation/run`, analysis only) from **Inject into live feed** (`/simulation/control`, which changes the synthetic feed). Verified live: M-105 → CRITICAL, anomaly 1.0, alerts raised. Covered by E2E. |
| F20 25 stale audit documents | P2 | **Fixed** | Archived to `docs/archive/` with a precedence note |
| F21 Secrets in the Compose env namespace | P2 | **Documented** | Checklist in `docs/KNOWN_LIMITATIONS.md` §7 |
| F22 `ml-service/.venv` in the tree | P3 | **Already correct** | Gitignored, 0 files tracked |
| F23 Apparent mojibake in source | P3 | **False positive** | Byte scan: 0 U+FFFD in any source file; PowerShell console artefact |
| F25 `normaliseMaintenance` expected a bare JSON array, but `GET /api/v1/maintenance` returns `{total, items}` — so the adapter always produced `[]` | P1 | **Fixed** | The maintenance board, the Command Center backlog panel and the inspector's work-order tab all silently showed "no work orders" while the nav badge showed 18, because the badge reads `/analytics/maintenance` through a different path. Adapter now unwraps either shape; `test/adapters.test.ts` locks the envelope for every collection endpoint. |
| F26 Command Center hero used the plant name as the page `h1`, so the workspace had no accessible name matching its route | P2 | **Fixed** | `h1` names the workspace ("Command Center"); the plant moved to the subtitle and is now sourced from `config.plantName` rather than 5 hardcoded literals |

### Findings that did NOT reproduce (investigated, not assumed)

| Reported historically | Result |
| --- | --- |
| Router mutates ES module namespace objects | **Not present.** `register()` stores, does not assign. All 12 routes boot, deep-link and refresh. |
| A legacy `frontend/app.js` competing with the modular app | **Not present.** One entrypoint only. |
| 3D resource leak | **Not present.** `disposeObject` + `disposeTwin` were already correct. |
| Favicon 404 | **Not present.** |

Recording these matters: a future audit should not re-investigate them, and an
audit that copies unverified claims is worse than no audit.

---

## 4. New architecture

```
src/
  api/          types (from live responses), client, adapters, queries
  auth/         AuthProvider, SignInGate, session
  app/          AppShell, route table
  realtime/     stomp.ts (wire) · store.ts (state) · useRealtimeSession.ts
  store/        ui.ts (selection + workspace UI)
  domain/       basis.ts · machineState.ts · format.ts
  design-system/index.tsx
  three/        TwinScene.ts (imperative) · useTwinCanvas.tsx (binding)
  routes/       12 lazily-loaded workspaces
  styles/       tokens · global · components · workspaces
```

| Concern | Choice | Why |
| --- | --- | --- |
| Server state | TanStack Query | Per-resource error isolation, stale/retry policy |
| Realtime state | Zustand, **split by frequency** | A packet cannot re-render the app |
| Selection | Zustand (own store) | Shared across Twin/Fleet/Telemetry/Predictions/Alerts/Maintenance |
| Routing | React Router | Deep links + SPA fallback |
| 3D | Imperative class, React binding | React never touches Three.js objects |

**Chunking:** shell 32.5 KB gzip; Three.js 122 KB and ECharts 170 KB split out
and loaded only on their routes.

---

## 5. Realtime architecture

- One WebSocket per authenticated session, owned by a React hook, destroyed on
  sign-out, paused when the tab is hidden.
- `stomp.ts` is the only module that speaks the wire protocol — framing,
  validation, dedup, ordering, coalescing, rAF batching, bounded buffers,
  backoff with jitter, heartbeat.
- **One batched store commit per animation frame.** This is the guarantee that
  an 18-asset telemetry storm cannot re-render the application.
- Sequence regression → REST reconciliation rather than silent drift.
- `deriveConnectionQuality()` is the only producer of the word `LIVE`, and it
  refuses to return `LIVE` for a synthetic feed.

See `docs/REALTIME_FRONTEND_CONTRACT.md`.

---

## 6. Digital twin architecture

- Representative per-type geometry, 6 zones laid out along material flow.
- Three encoding modes: **status**, **risk**, **dependencies**.
- **On-demand rendering**: the loop stops scheduling frames when nothing
  changes. A stationary twin costs zero GPU. Hard suspend when `document.hidden`.
- Shared geometry/materials — a live status change mutates one material colour.
- Hover raycasting throttled to one pick per frame.
- Full disposal: geometries, materials, textures, label sprites, DOM
  listeners, `ResizeObserver`. Verified by an E2E test asserting the canvas is
  removed from the DOM on navigation.
- Full keyboard parity via the asset list and `Ctrl+K`.

---

## 7. Data honesty

The most important design decision in the rebuild.

`DATA_BASIS` = `OBSERVED · DERIVED · PREDICTED · SYNTHETIC · SIMULATED ·
UNAVAILABLE`, applied to every meaningful number and shown as a chip.

Enforced by code and by tests:

- `formatProbability(0.0006) === '0.060%'` — never `"0%"`.
- `formatContribution` carries a real minus sign and **never** a `%`.
- `formatRulSteps` output **cannot** match a time unit — no hours formatter
  exists in the codebase.
- Attribution labelled baseline perturbation, never SHAP.
- Heuristic fallback labelled as such, with a count.
- The status strip always states the console does not control physical
  machinery.

---

## 8. Security changes

| Concern | Measure |
| --- | --- |
| Password | Never stored, logged or persisted |
| Token | `sessionStorage` — tab-scoped; trade-off documented in `FRONTEND_ARCHITECTURE.md` §8 |
| XSS | No `innerHTML` in `src/`; no third-party script; no external origin; CI enforces all three |
| CSP | `default-src 'self'` + `nosniff` + `frame-ancestors 'none'` + `Referrer-Policy` + `Permissions-Policy` |
| Authorization | Backend re-authorises every call; a 403 is surfaced, never swallowed |
| Session expiry | Any 401 clears the session and re-opens the gate; no silent re-login |

---

## 9. Accessibility changes

Skip link; landmarks; focus trap and restoration shared across drawer, modal and
palette; ARIA tab pattern with roving tabindex; `role="meter"` with
`aria-valuenow`; polite vs assertive live regions; `prefers-reduced-motion` in
CSS and in the twin camera; colour never the sole signal; `Ctrl+K` and `?`
shortcuts; keyboard-equivalent access to every machine.

Verified by 6 E2E tests, not by inspection.

---

## 10. Performance changes

| Property | Mechanism |
| --- | --- |
| One render loop | Owned by `TwinScene`, cancelled on dispose |
| No idle GPU | On-demand rendering; loop stops when nothing changes |
| No background work | Transport paused, timers stopped when the tab is hidden |
| No render storms | rAF-batched, per-entity coalesced realtime commits |
| Bounded memory | Telemetry ring 120/asset; events 100; dedupe 2048; pending 240/256 |
| No idle polling | `refetchIntervalInBackground: false` |
| Small shell | Route-level code splitting; Three/ECharts loaded on demand |
| Efficient charts | ECharts tree-shaken to bar/line/scatter, updated via `setOption` |
| No CDN latency | Everything bundled and cache-immutable |

---

## 11. Testing

| Suite | Count | Result |
| --- | --- | --- |
| Vitest unit | 73 | **pass** (66 + 7 adapter contract tests) |
| Playwright E2E | 30 | **pass** |
| Playwright visual/responsive | 13 | **pass** |
| Backend unit | 7 new (`DecisionEngineFormattingTest`) | **pass** |
| `tsc --noEmit` (strict, includes tests) | — | **clean** |
| `vite build` | — | **clean** |
| Hardcoded-colour scan outside `tokens.css` / `color.ts` | — | **0 hits** |

E2E asserts, on **every** route: zero console errors, zero uncaught
exceptions, zero failed requests, zero unexpected 4xx/5xx, no horizontal
overflow.

The E2E suite earned its keep during the colour pass: the Command Center hero
had been given the plant name as its `h1`, which broke four tests before the
change ever reached a user. The adapter bug behind F25 was invisible to the
type checker and to every existing test, because a `[]` returned from a
mis-shaped response is indistinguishable from a legitimately empty one.

---

## 12. Files added (43)

**Frontend source (28):** `main.tsx`, `App.tsx`, `index.html`,
`tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`,
`Dockerfile`, `.env.example`, `public/favicon.svg` + 3 fonts, and under
`src/`: `api/{types,client,adapters,queries}`, `auth/{AuthProvider,SignInGate,session}`,
`app/{AppShell,routes,shell.css}`, `realtime/{stomp,store,useRealtimeSession}`,
`store/ui`, `domain/{basis,machineState,format}`, `design-system/index`,
`three/{TwinScene,useTwinCanvas}`, 12 routes, `hooks/{useNow,useFocusTrap}`,
4 stylesheets.

**Tests (6):** 4 unit + 2 E2E specs + fixtures.
**Infra (2):** `frontend/Dockerfile`, `infra/nginx/default.conf`, `.ci/boot-stack.sh`.
**Docs (10):** audit, API contract, realtime contract, design system, UI/UX
guide, frontend architecture, testing, provenance, limitations, runbook, future
scope, final report, archive README.

## 13. Files removed (29)

The entire legacy frontend: `index.html`, `serve.py`, `robots.txt`,
`favicon.svg`, 4 CSS files, 20 JS modules, 4 test files, `__pycache__`.
Plus 25 superseded audit documents moved to `docs/archive/`.

There is now **exactly one** frontend entrypoint, one build, and one lockfile.

---

## 14. Known limitations

See `docs/KNOWN_LIMITATIONS.md`. The material ones: Chromium-only E2E, no
WebGL context-loss recovery, no offline mode, no i18n, no performance budget
gate, and the fundamental one — the whole system is synthetic and says so
everywhere.

---

## 15. Demo walkthrough (3–5 minutes)

1. **Sign in** — the gate states up front that this is synthetic telemetry.
2. **Command Center** — read the verdict first: *OPERATIONAL / ATTENTION /
   DEGRADED / OFFLINE*. Then the asset board, then priority incidents.
3. **Factory Twin** — orbit the plant. Switch **Status → Risk → Dependencies**.
   Open the asset list and select **M-105**.
4. **Inspector → Telemetry** — live sensor values with freshness. Note the
   basis chip: `SYNTHETIC`.
5. **Inspector → Prediction** — risk, anomaly, and the attribution drivers.
   Point out that the method is baseline perturbation, not SHAP, and that the
   model version is shown.
6. **Alerts** — the four-state lifecycle strip. Acknowledge one, investigate
   one. Point at the role gate.
7. **Maintenance** — the board mirrors the backend lifecycle exactly. Schedule
   a work order.
8. **Simulation Lab** — run a *Vibration spike* what-if on M-105 at 80% for
   modelled impact, then **Inject into live feed**. Switch to the Factory Twin
   and watch telemetry, prediction, machine state and alerts all react. Return
   and **Reset feed**.
9. **System** — service tiles, transport diagnostics (deltas applied,
   duplicates suppressed, frames rejected), and the provenance panel.
10. **Close on the status strip** — transport, data basis, oldest reading, and
    the standing statement that this console does not control physical machinery.

---

## 16. Screenshots

No screenshots are committed. `npm run visual-qa` captures all eight key
workspaces at five breakpoints into `frontend/test-results/visual/` on demand.

They are generated artefacts of a running application, and a committed
screenshot is a picture of a build that no longer exists.
