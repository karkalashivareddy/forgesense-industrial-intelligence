# Frontend Re-architecture Audit

<!-- forge:historical -->
> **Historical audit record.** This document captures a point-in-time review.
> It is kept as evidence of what was checked and when, and is **not** a
> description of the current system. For current behaviour see the [docs index](../README.md)
> index and the source. Several claims here were superseded after the review —
> notably the frontend re-architecture and the transport/model-truth corrections.

**Baseline:** `9444beb` (branch `feat/industrial-operations-ui`, forked from `main`)
**Method:** static inspection of every frontend source file, plus a live Chromium
run against the running Docker Compose stack. Every finding below was verified
against code and against observed runtime behaviour, not copied from any
previous audit document in `docs/audit/`.

> Precedence used throughout: **current code > current tests > current API
> contracts > previous documentation.** Where this audit contradicts an older
> audit, this audit is correct.

---

## 1. Executive summary of the baseline

The baseline frontend was a **vanilla JavaScript ES-module SPA** with no build
step, no type system, no package management, and **three runtime CDN
dependencies**. It worked: it booted, rendered all twelve workspaces, held a
STOMP connection and produced **zero console errors and zero failed requests**
in a real browser. The problems were structural rather than cosmetic, and they
blocked the product qualities the brief requires — reproducibility,
type-safe realtime handling, honest data presentation, and testability.

| Area | Baseline |
| --- | --- |
| Language / build | Plain ES2022 JS, no bundler, served by nginx from source |
| Types | None |
| State | One mutable module singleton + a `notify()` fan-out |
| Server state | Hand-rolled 3 s `Promise.all` polling loop |
| Realtime | Hand-written STOMP client (correct, but untested against types) |
| 3D | Hand-written Three.js, loaded from a CDN import map |
| Icons / fonts | Phosphor webfont + Google Fonts, both from CDN |
| Tests | 4 `node:test` files, no browser coverage at all |
| Responsive | Passes 375–1920, but the top bar overflowed below 480 px |
| Accessibility | Partial: ARIA present, focus trap, landmarks, but no E2E proof |

---

## 2. Current architecture (as found)

### Entry point and shell
- `frontend/index.html` — static markup for the entire shell: top bar, left
  rail, 12 empty `<section>` view hosts, inspector aside, status bar,
  diagnostics dialog, command palette, toast.
- `frontend/js/app.js` — `main()` performs login gate, view registration,
  router boot, polling start, realtime connect, and installs 5 `setInterval`
  timers (1 s clock, 1 s status bar, plus the 3 s poll and 15 s slow poll).

### Routing
- `frontend/js/router.js` — hash router (`#/fleet`). Maintains a `Map` of
  registered views, each exposing `mount` / `unmount` / `activate` / `update`.
- **Verified working.** The historical "router mutates ES module namespace
  objects" failure is **not present at HEAD** — `register(name, view)` stores
  the namespace object, it does not assign to it. All 12 routes boot, deep
  links work, and refresh works.

### State
- `frontend/js/state.js` — a single `store` object with ~25 mutable fields and
  a `listeners: Set`. Every `set()` calls `Object.assign` then notifies **all**
  subscribers synchronously.
- `refreshCore()` fans out one `Promise.all` over five endpoints. **If any one
  fails, every derived view goes stale** — this is the classic "partial refresh
  failure" defect and it was present.
- Client-side `uiState` derivation, a recovery-confirmation counter, and realtime
  cursor/dedup maps all lived in the same object.

### Realtime
- `frontend/js/realtime.js` — `StompRealtimeClient` with STOMP framing,
  `validateRealtimeEvent`, per-entity coalescing, `requestAnimationFrame`
  batching, bounded pending maps (240 / 1024), bounded dedup (4096),
  exponential backoff reconnect, and a 10 s heartbeat.
- **This module was genuinely well built** and was the strongest part of the
  baseline. Its logic was preserved and re-typed in `src/realtime/stomp.ts`.

### 3D
- `frontend/js/twin3d.js` (~1160 lines) — a `disposeObject` walker, shared
  geometry cache (`userData.shared`), adaptive DPR tiers, FPS sampling,
  `disposeTwin()`. Also **already correct** on disposal.
- Loaded via `<script type="importmap">` from `cdn.jsdelivr.net`.

### Charts
- `frontend/js/charts.js` — a bespoke canvas 2D line chart. ~180 lines.
  Adequate for two series, not for the analytics surface the brief requires.

### Auth
- `frontend/js/api.js` — `API_BASE` from `localStorage` or a hardcoded
  `http://localhost:8080`; token held in a **module variable** (never
  persisted); `SessionExpiredError` on 401.

---

## 3. Findings

Severity: **P0** breaks the product, **P1** materially degrades it, **P2** is
debt, **P3** is hygiene.

| # | Finding | Severity | Evidence |
| --- | --- | --- | --- |
| F01 | Three.js loaded from `cdn.jsdelivr.net` via an import map. A blocked or unavailable CDN is a total loss of the digital twin, and there is no integrity guarantee. | P1 | `index.html:171-178`; live run logged `200 … three@0.169.0/build/three.module.js` |
| F02 | Phosphor icon webfont and Inter / Inter Tight / JetBrains Mono loaded from `cdn.jsdelivr.net` and `fonts.googleapis.com`. Four external origins for a control room. | P1 | `index.html:10-16`; live run logged all four as external requests |
| F03 | No `package.json` dependency graph, **no `package-lock.json`**, no build. `package.json` declared only `test` and `qa:visual`. | P0 | `frontend/package.json` (7 lines) |
| F04 | Zero type safety. The realtime envelope, alert lifecycle, machine state and factor shapes were all untyped. | P0 | No `.ts` file existed anywhere in the repository |
| F05 | `API_BASE` hardcoded to `http://localhost:8080` in source, not environment-driven. | P1 | `js/api.js:1` |
| F06 | `refreshCore()` used one `Promise.all` across machines, system status, telemetry status, alerts and events. A single failing endpoint marked the whole console stale. | P0 | `js/state.js:208-214` |
| F07 | Global mutable singleton: every `set()` notified all subscribers, so one telemetry packet re-rendered the shell, the status bar, the twin and the active view. | P0 | `js/state.js:48-55`; `js/app.js:412-421` |
| F08 | No browser test coverage whatsoever. CI ran only `node --check` and one `node:test` file. | P0 | `.github/workflows/ci.yml:73-90` |
| F09 | **Backend contract self-contradiction.** `/api/v1/system/status` hard-coded `streaming: false` and `transport: "REST_POLL"` regardless of configuration, while `/api/v1/telemetry/status` reported `streaming: true, transport: "KAFKA"`. The System page therefore told the operator the transport was REST polling while the same product reported Kafka. | P0 | `SystemController.java` (hard-coded literals) vs live responses |
| F10 | **Backend contract self-contradiction.** `database` was derived from `demoMode` (`H2_DEV` vs `POSTGRES_CONFIGURED`). Under Compose, demo mode is on and PostgreSQL is in use, so the platform misreported its own database. | P1 | `SystemController.java:42`; live response `{"database":"H2_DEV"}` while connected to PostgreSQL |
| F11 | **Factor formatting bug.** `DecisionEngine.buildDescription` rendered `label + "(+" + round(contribution*100) + "%)"`. A negative contribution produced literal `NEUTRAL (+-2%)`; a 0.06% risk was rendered as `failure risk 0%`. | P0 | Live alert payload: `"Top contributing factors: NEUTRAL (+-2%), NEUTRAL (+-1%)"` and `"failure risk 0%"` |
| F12 | `zone` field inconsistency: `/machines` returns the code (`MACHINING`), `/analytics/risk-ranking` returns the name (`Machining`). Any naive join across the two is wrong. | P1 | Live responses compared side by side |
| F13 | Top bar measured 550 px at a 375 px viewport — horizontal overflow on every mobile device. | P1 | Measured in Chromium: `scrollWidth=550 clientWidth=375` |
| F14 | The 3D canvas painted above the twin overlay, so the camera controls were unclickable. (Introduced during migration; caught by E2E before release.) | P1 | Playwright: `element is visible, enabled and stable` then intercepted |
| F15 | `esc()` was applied to values that were then inserted as **text nodes**, producing double-escaped output such as a literal `&lt;` in a toast. | P2 | `js/app.js:158`, `js/util.js:272` |
| F16 | `el()` supported an `html:` attribute that assigned `innerHTML`. Unused at HEAD, but an XSS-shaped footgun. | P2 | `js/util.js:272` |
| F17 | 38 `innerHTML = ''` sites for re-render clears. Not an injection risk, but inseparable from the hand-rolled renderer. | P3 | Grep across `frontend/js` |
| F18 | Simulated impact is a **history of recorded runs**, not a scenario catalogue. The old Simulation view could only show a "what-if" form, so the lab had little to display. | P2 | `SimulationRepository.findTop50ByOrderByCreatedAtDesc`; live `/simulation/scenarios` returned `[]` on a fresh stack |
| F19 | `productionEfficiency` and `estimatedDowntimeRiskMinutes` are **modelled** values derived from fleet failure risk, but sat in the same list as observed counts with no basis label. | P1 | `AnalyticsService.java:69-74`; live `label: "ESTIMATED - derived from average fleet failure risk"` |
| F20 | Twelve accumulated audit/phase documents describing states that no longer exist, several of which directly contradict current code. | P2 | `docs/audit/*` (25 files) |
| F21 | The `.env` file ships `POSTGRES_PASSWORD` and the JWT secret into the Compose interpolation namespace for all services. | P2 | `docker-compose.yml` + `.env` |
| F22 | `ml-service/.venv/` present in the working tree; correctly gitignored, but 800 MB of noise. | P3 | `git ls-files` → 0 tracked; disk only |
| F23 | PowerShell renders the source files' UTF-8 as `A�` / `�?"`. **Verified as a console artefact, not a file defect** — a byte-level scan found zero U+FFFD replacement characters in any source file. | P3 | Byte scan of every `.js`/`.html`/`.css` file: 0 matches |

### Findings that did NOT reproduce

Recorded explicitly so a future audit does not re-investigate them.

- **Router namespace mutation** — not present at HEAD. `register()` stores, it
  does not assign. All 12 routes boot, deep-link and refresh correctly.
- **Legacy duplicate frontend** — not present. There was exactly one
  entrypoint (`index.html` → `js/app.js`). No `frontend/app.js` competitor.
- **3D resource leak** — not present. `disposeObject` walked geometry, materials
  and textures, with a `userData.shared` guard and a `disposeTwin()` teardown.
- **Mojibake in source** — not present (see F23).
- **Favicon 404** — not present; `favicon.svg` was referenced and served.

---

## 4. What was kept, and why

The baseline contained real engineering that a rewrite would have thrown away.
It was carried forward deliberately:

1. **The STOMP client design** — frame/unframe, envelope validation, per-entity
   coalescing, rAF batching, bounded buffers, dedup, backoff, heartbeat. Only
   re-typed and re-tested, not redesigned.
2. **The `inscribed` state ladder** — NORMAL → ESCALATED → CRITICAL with a
   recovery-confirmation counter, plus STALE derived from reading age. Preserved
   and made testable by injecting `now`.
3. **The twin's disposal discipline** — shared-geometry tracking and a full
   teardown. Preserved verbatim in `TwinScene.dispose()`.
4. **Sensor units and the `SensorType` key mapping** — taken from the backend
   enum rather than reinvented.
5. **The honest-by-default copy** — "synthetic model output", "estimated
   remaining steps", "baseline perturbation (not SHAP)" were already correct and
   were promoted into a system.

---

## 5. Migration risks identified before starting

| Risk | Mitigation |
| --- | --- |
| Losing behavioural parity in the twin | The twin was rebuilt behind a class with a documented imperative API, then verified in a real browser by E2E before any UI claim was made |
| Silent contract drift during the rewrite | Every TypeScript type was written from a **captured live response**, not from prose documentation |
| Breaking the working realtime path | The realtime module was ported first and unit-tested in isolation before any UI consumed it |
| "Fake UI" — panels with no data flow | Each workspace was required to bind to a real query; panels that could not were replaced with honest empty states |
| Performance regression from adding a framework | On-demand Three.js rendering, bounded telemetry rings, rAF batching and lazy route chunks were designed in from the start, not retrofitted |

---

## 6. Outcome

See `docs/audit/FINAL_FRONTEND_REDESIGN_REPORT.md` for the completed
before/after table, the test results, and the known limitations.
