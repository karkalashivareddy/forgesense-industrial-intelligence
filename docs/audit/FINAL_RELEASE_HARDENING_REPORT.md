# ForgeSense — final release hardening report

Branch `feat/industrial-operations-ui`. This is a **hardening pass**, not a
redesign: no stack change, no architecture change, no new features. The goal was
to make an already-working console *stable, truthful, performant, reproducible
and demo-ready*, and to stop.

Everything below was measured or executed, not assumed. Where a measurement
could not be taken honestly, that is said explicitly.

---

## 1. Baseline (verified, not trusted)

The brief supplied a baseline. Each item was re-run rather than accepted.

| Claim | Result |
| --- | --- |
| Vitest 73 passing | **confirmed** |
| TypeScript strict clean | **confirmed** (`tsc --noEmit`) |
| Branch / tree | `feat/industrial-operations-ui`, clean at `aa8d0cc` |
| Docker serving the console | confirmed, nginx container on 5173 |

`npm test` and `npm run typecheck` were the entry point for every subsequent
claim. Playwright was run at the end, not continuously, to protect the laptop
and because it is the slowest suite.

---

## 2. Fixes made (only real defects)

### F1 — Machine inspector event list was permanently empty (data bug)

`useMachineEvents` read `raw.items` / `raw.count`, but
`GET /api/v1/machines/{id}/events` returns a **bare array** on the wire. The
adapter therefore returned `{count: 0, items: []}` forever, and the Events tab
always showed "No recorded history".

This is the same defect class as the maintenance bug fixed in `aa8d0cc` —
a mis-guessed collection envelope that is indistinguishable from a legitimately
empty result. Confirmed by probing the live API, then fixed and verified in the
browser: the tab now reads **"Showing 50 of 50 events"**.

### F2 — The envelope bug class is now structurally prevented

Rather than patching the second instance and hoping, all collection reads go
through one helper in `frontend/src/api/adapters.ts`:

- `unwrapCollection(raw, ...keys)` accepts a bare array, `{items}`, `{rows}`,
  `{data}` or `{content}`.
- `unwrapCount(raw, items)` accepts `total` or `count`, falling back to
  `items.length`.
- `normaliseEventList` is now shared by both event endpoints, which genuinely
  differ.

A new backend envelope is a one-line change in one file. `adapters.test.ts` grew
from 7 to 15 cases covering every collection endpoint, both shapes per
endpoint, and degenerate input (`null`, `{}`, `{items: null}`).

### F3 — Security headers were declared but never served (security bug)

`infra/nginx/default.conf` set CSP, `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy` and `Permissions-Policy` at `server` level. **None of them
reached the client.**

nginx does not inherit `add_header` into a `location` block that declares an
`add_header` of its own — and every location here needs `Cache-Control`. So the
headers were discarded for every response the SPA actually serves. Verified
before the fix:

```
GET / ->  Connection, Vary, Accept-Ranges, Content-Length, Cache-Control,
          Content-Type, Date, ETag, Last-Modified, Server
          (no CSP, no X-Frame-Options, no nosniff)
```

The config *read* as protected while the protection was inert — the worst kind
of defect, because it survives code review.

Fixed by extracting `infra/nginx/security-headers.conf` and `include`-ing it in
`server` **and** in every location that adds a header, with a comment
documenting the inheritance rule. After the fix all five headers are present on
`/`, on a deep link (`/command`), on hashed assets, and on `/healthz`. The full
Playwright suite — including its zero-console-error walk of all 12 workspaces —
still passes, which proves the policy is enforced *and* correct rather than
merely present.

### F4 — The twin requested a 700 ms render settle every 3 seconds, always

The twin renders on demand (`needsRender` gate; it stops scheduling frames when
nothing changed). But three paths called `invalidate()` unconditionally, and
`refreshEmphasis` requested a 700 ms continuous settle:

- `applyZoneFilter()` → `invalidate()` on every call
- `applySelectionVisuals()` → `invalidate()` on every call
- `refreshEmphasis()` → `invalidate(700)` on every call
- `setMode()` → `invalidate(700)` on every call

`useMachines` refetches every 3 s, so the twin was being told to re-render
continuously roughly 23 % of the time while displaying nothing new.

All four are now idempotent and gated on a **comparable key** stored on the node
(`visualKey`, `selectionKey`) rather than on reading back material values.

> A first attempt compared `material.color.getHex()` and made things *worse*
> (386 → 1359 rAF registrations). Three.js colour-manages on `set` and returns
> converted values from `getHex()`, so the comparison reported "changed" every
> time and defeated the gate. The key-based approach is exact.

### F5 — `TelemetryRangeResponse.rows` was typed narrower than reality

Declared `Omit<TelemetryReading, 'machineId'>[]`, but the adapter explicitly
stamps `machineId` on every row so a mixed response cannot label a chart with
the wrong asset. The type was corrected to `TelemetryReading[]`; the two
dynamic sensor-key lookups in the inspector got one narrow, commented cast.

---

## 3. API contracts

Full matrix with verified shapes, consumers, and per-endpoint error/empty
behaviour: **[`API_CONTRACT_MATRIX.md`](API_CONTRACT_MATRIX.md)**.

The backend wraps collections **three different ways** (bare array, `{items}`,
`{rows}`) and names the counter two ways (`total`, `count`). Both are verified
from the running service, not inferred from DTOs. All 28 endpoints are now
listed with the shape actually observed.

Adapters correctly tolerate: `null`, missing fields, optional fields, numeric
strings (`toNumber` accepts `"0.6"`), `Map.of`-absent numerics (surfaced as
unavailable rather than a confident `0`), and empty arrays.

## 4. Error isolation

Verified by aborting one endpoint at a time in the browser and asserting the
rest survives.

| Failure injected | Shell | `h1` | Other resources | Failed resource |
| --- | --- | --- | --- | --- |
| none | up | yes | 18 assets | — |
| `/maintenance` | up | yes | **18 assets** | `ErrorState` "Maintenance unavailable" |
| `/analytics/*` | up | yes | **18 assets** | 2 `ErrorState`s |
| `/machines` | up | yes | panel hidden | `ErrorState` |

**No failure is ever rendered as an empty successful state.** "The server said
there is nothing" and "the server did not answer" are visually and structurally
distinct. No uncaught exceptions in any scenario.

## 5. Realtime

Measured by instrumenting the `WebSocket` constructor before app load.

| Check | Result |
| --- | --- |
| Sockets created across 14 route changes (twin visited 3×) | **exactly 1** |
| Sockets opened | 1 |
| Sockets closed on sign-out | **yes** |

The stated failure mode — route change → new WebSocket → old one alive — **does
not occur**. `useRealtimeSession` owns one module-level client keyed by token and
is mounted once in `App.tsx` above the router, so route changes never re-run it.

Also verified by inspection: envelope validation before any state write;
dedupe by `eventId` with a bounded FIFO set (2048); sequence-regression
detection that triggers a REST reconcile instead of silent drift; per-entity
coalescing capped at 240; discrete events capped at 256 per flush; **one
dispatch per animation frame**; exponential backoff with jitter; 10 s heartbeat;
full teardown of timers, buffers, maps and socket on disconnect; transport paused
entirely while the tab is hidden.

## 6. Performance

### Honest note on the twin

The headless browser used for verification runs **SwiftShader** (software
rasterisation) — `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))`. Raw frame
rates measured there are meaningless for a real laptop and are **not** reported
as product performance. An early reading of "4.7 fps on the twin" was a
headless artefact, not a defect.

What *is* meaningful, and is GPU-independent, is whether the renderer issues GPU
work while idle. Measured by wrapping `drawElements` / `drawArrays`:

| Page | WebGL draw calls in an 8 s idle window |
| --- | --- |
| Command Center | 0 (no canvas) |
| **Factory Twin, settled** | **0** |
| **Factory Twin, second visit** | **0** |

The twin genuinely stops rendering when nothing changes. This is the property
that matters for laptop heat, and it holds.

> `requestAnimationFrame` registration counts were measured first and turned out
> to be a **bad proxy** — rAF is registered for non-render work too, so the
> numbers (386 / 523) implied a regression that did not exist. Reported here so
> nobody re-derives that false signal.

### Command Center under live telemetry

| Metric | 8 s window |
| --- | --- |
| Script time | 0.16 s (~2.7 % of one core) |
| Long tasks (> 50 ms) | **0** |
| Layouts | 96 |
| Style recalcs | 64 |
| Event listeners | 228 → 228 (flat) |
| Frame rate | 60 fps |

### Render isolation

A telemetry packet does **not** re-render the application. Verified structurally:
every store subscription is narrow —
`state.transport`, `state.watch` / `unwatch`, and `useLiveReading(machineId)`
via `useShallow`. Only three components read live readings (Telemetry and two
inspector tabs); no component subscribes to the whole `live` or `history` map.
The STOMP client coalesces per entity and dispatches once per animation frame.
History is bounded to 120 points per watched asset, and only for assets someone
is actually watching.

### No leaks across navigation

Twin → Command → Twin → Fleet → Twin → Command → Twin: heap 24.5 → 10.3 → 9.1 MB,
DOM nodes 3056 → 470 → 470, listeners 619 → 200 → 200. **Monotonically down to a
floor, not growing.** No duplicate scenes, no orphaned canvases.

## 7. Navigation integrity

All 12 routes × {direct load, back, forward}. **24/24 pass**, no blank page, no
stale workspace, no console errors.

`h1` names the workspace on every route (not the plant):

`Command Center · Factory Twin · Fleet · Telemetry · Predictions · Anomalies ·
Analytics · Alert Center · Maintenance · Scenario Lab · Event Stream · System`

## 8. Responsive

375 / 768 / 1024 / 1440 / 1920 × all 12 routes = 60 combinations. **No horizontal
overflow anywhere.** Playwright asserts this independently.

## 9. Accessibility

- Skip link present and is the first tab stop (E2E-verified).
- Route change moves focus into the new workspace (E2E-verified).
- `role="tablist"` / `tab` / `tabpanel` with `aria-selected`, `aria-controls`,
  `aria-labelledby`, and arrow/Home/End key handling.
- Drawer and dialog semantics; focus trap; Esc to close.
- `prefers-reduced-motion` honoured, asserted by E2E.
- Colour is never the sole carrier of meaning — every semantic colour ships with
  an icon and a text label.
- Text contrast: primary 14.8:1, secondary 7.6:1, muted 4.6:1 (at the AA floor,
  documented, never below).

## 10. Simulation boundary and prediction honesty

- Footer, on every screen: *"Synthetic simulator telemetry — operational
  visualisation only, no physical machine control."*
- Sign-in gate, header provenance chip, twin badge, inspector, and README all
  state the boundary.
- **Run what-if** (`/simulation/run`, analysis only) and **Inject into live
  feed** (`/simulation/control`, changes what the simulator emits) are
  presented as separate actions and labelled as such.
- Predictions render in violet, carry model version and freshness, and never
  claim certainty. No SHAP values, confidence scores, causal attribution or
  calibrated RUL are displayed, because the backend does not provide them.
- Maintenance stages are exactly the backend's five states.

## 11. The identical risk values — investigated, not faked

**Every one of the 18 assets reports `failureRisk` exactly `0.0006`**, rendering
as `0.060%`. The brief asked whether this is model output, rounding,
truncation, shared state, simulator behaviour, or an adapter bug. It is
**genuine model output**, established by evidence:

| Test | Result | What it rules out |
| --- | --- | --- |
| Raw JSON precision | `"failureRisk":0.0006` | rounding, truncation |
| `anomalyScore` spread | 7+ distinct values (0.0, 0.9999, 0.0014, 0.0011, 0.0013, 0.0003, 0.0002) | adapter collapsing values |
| `healthScore` spread | 99.9 ×17, 70.0 ×1 | shared state |
| `modelVersion` / `modelMode` | `failure-risk-v2` / `MODEL` ×18 | heuristic fallback |
| `formatProbability(0.00065/0.0007)` | `0.065%` / `0.070%` | formatter collapsing |

The adapter faithfully passes through variation *where it exists* (anomaly
scores and health scores vary within the same response). The model saturates
near zero for nominal assets.

**Therefore: values preserved exactly as they are.** No spread was invented.
Instead, a regression test now pins the formatter's precision so a future
"simplify the number" change cannot quietly begin merging genuinely distinct
risks, and the Command Center risk panel explains the saturation to the
operator.

## 12. Security sanity

| Check | Result |
| --- | --- |
| Hardcoded secrets / API keys / tokens in `src/` | none |
| `dangerouslySetInnerHTML` / `innerHTML` | none |
| External origins (scripts, fonts, CDNs) | none — all bundled |
| `https://` references outside localhost | none |
| CSP now actually served | **yes, all paths** (was silently absent) |
| `unsafe-eval` in CSP | not present |
| Token storage | in-memory only, never `localStorage` |
| `401` handling | clears token, reopens gate, no retry loop |

CSP is strict: `default-src 'self'; script-src 'self'` with no
`unsafe-eval`, `frame-ancestors 'none'`, `object-src 'none'`. It was **not**
weakened to make anything work.

## 13. Docker reproducibility

- `npm ci` in the build stage against a committed lockfile — reproducible.
- Multi-stage: Node builds, nginx serves. No Node runtime in the final image.
- SPA fallback verified: a direct load of `/command` returns **200**, not 404.
- Hashed assets immutable for 1 y; `index.html` `no-cache`.
- Missing asset → 404 (not a silently-200 `index.html`).
- favicon → 200 `image/svg+xml`.
- `/healthz` → 200, drives the container `HEALTHCHECK`.
- Deep links, static assets, and API/WebSocket connectivity all verified against
  the running container.

## 14. Dependency hygiene

All 8 runtime dependencies are used in `src/`. **No unused dependency found, so
none was removed.** No version was upgraded — runtime deps are pinned exactly
(no `^`), so the lockfile is authoritative. `npm ci` + `npm run build` verified
reproducible.

## 15. Forensic search

Searched for `TODO`, `FIXME`, `HACK`, `XXX`, `placeholder`, `mock`, `fake`,
`dummy`, `hardcoded`, `localhost`, `console.log`, `innerHTML`,
`dangerouslySetInnerHTML`, `any`, `setInterval`, `setTimeout`,
`requestAnimationFrame`, `WebSocket`, `STOMP`.

Every hit classified:

| Category | Examples |
| --- | --- |
| **Legitimate** | `placeholder=` on 5 search inputs |
| **Intentional, documented** | `DEFAULT_API_BASE = 'http://localhost:8080'` (validated at load, overridable by env); `console.debug` in the realtime diagnostic path guarded by `import.meta.env.DEV`; comments stating things are *not* hardcoded |
| **Required runtime behaviour** | `setInterval` for the 1 s clock and 10 s heartbeat; `requestAnimationFrame` in the STOMP frame flush and the twin render loop |
| **Actual defect** | F1–F5 above |

No `console.log` left in production paths, no `TODO`, no `mock`/`fake`/`dummy`
data in `src/`.

## 16. Development workflow

Documented in the README and enforced by convention:

```bash
docker compose up -d --build --force-recreate frontend
```

with the false-negative scenario spelled out. `docker system prune -a` is
explicitly **not** recommended. No duplicate Vite server, browser, or simulator
was left running; temporary probe scripts live outside the repo and are not
committed.

---

## 17. Final automated verification

Run in this order, at the end, after all implementation.

| Check | Result |
| --- | --- |
| `tsc --noEmit` (strict, includes tests) | **clean** |
| Vitest | **83 passed** (73 baseline + 10) |
| Playwright (30 functional + 13 visual) | **43 passed** |
| `vite build` | **clean** |
| Docker frontend build | **clean** |
| Docker frontend startup | **healthy** |
| Console errors | **0** |
| Uncaught exceptions | **0** |
| Unexpected failed requests / 4xx / 5xx | **0** |
| Horizontal overflow (60 combinations) | **0** |
| Broken routes | **0** |
| Duplicate WebSocket connections | **0** |
| Duplicate Three.js render loops | **0** |

Two of my own test assertions were wrong during this pass (a
`formatProbability` boundary and a test-side `getHex()` comparison). Both were
my errors, found and corrected before the final run; neither indicated a
product defect.

---

## 18. Known limitations (unchanged, stated plainly)

- Telemetry is **synthetic**; the models were trained on it.
- **No physical machine control.** Nothing actuates equipment, executes real
  maintenance, or reports real production.
- Failure risk has **no confidence interval** and saturates at `0.0006` for
  nominal assets.
- Remaining-useful-life is a **simulator-relative step count**, not a
  calibrated RUL.
- `/analytics/health-trends` returns a **snapshot, not a time series**, despite
  the name — the console renders a distribution rather than inventing a trend
  line.
- Maintenance is the backend's five states, not a full CMMS workflow.
- Twin performance in CI is unmeasurable (software rasterisation); the
  GPU-independent property — zero idle draw calls — is what is asserted.

## 19. Future scope (not implemented, deliberately)

Per the brief, all of the following are **out of scope** and belong in
[`docs/FUTURE_SCOPE.md`](../FUTURE_SCOPE.md): auth platform redesign, i18n,
offline-first, WebGPU, Kubernetes, microfrontends, new database, new ML models,
OPC-UA, MQTT, Kafka migration, cloud deployment.

## 20. Demo readiness

The 12-step walkthrough in the README is verified end-to-end and takes 3–4
minutes with no dead ends. The spine of the demo:

> synthetic telemetry → digital twin → ML prediction → anomaly detection →
> alert → maintenance recommendation → scenario injection → measured effect

The step that makes it land is 10–11: injecting a vibration scenario on M-105
in the Scenario Lab and then returning to the Command Center to watch the
verdict, the alert count, and the work-order backlog all move. That single pass
demonstrates the entire pipeline and the honesty boundary at the same time.

## 21. Data boundary

**All operational data in ForgeSense is synthetic.** It is generated by the
telemetry simulator, scored by a model trained on that simulator, and displayed
in an operations console. ForgeSense **does not control, monitor, or actuate
physical machinery**, does not execute real maintenance, and does not report
real production output. The console states this in the persistent footer, on
sign-in, in the header, and in this report.
