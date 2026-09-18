# Post-Rebuild Verification

**Date:** 2026-09-18  
**Scope:** Current working tree after the first rebuild pass  
**Method:** Direct repository inspection, targeted static tracing, unit/smoke checks, and browser inspection of the static frontend shell.  
**Constraint:** No implementation code was changed during this audit.

## Executive Summary

The current checkout is a credible production-style prototype with a functioning Spring telemetry domain, synthetic simulator, persisted predictions, a Python ML service, REST views, a Three.js twin, maintenance/alert workflows, and a new STOMP transport adapter. The important capability is not merely visual: the backend telemetry path reaches persistence, prediction, event logging, and WebSocket broadcast in code; the ML service trains and loads deterministic synthetic models; and the frontend consumes the resulting REST contracts.

The rebuild is not yet fully verified as an end-to-end live product. The browser could load the static UI, but the backend was not running on port 8080 during the browser check, so login, populated machine state, secured STOMP connection, and live UI updates could not be observed in a real running stack. Code inspection also found a material security/integration risk: the frontend sends JWT in a STOMP `CONNECT` frame, but the backend has no `ChannelInterceptor`/STOMP authentication bridge, while Spring HTTP security protects `/ws`; the native browser WebSocket handshake cannot send the `Authorization` header used by `JwtAuthFilter`.

The new realtime adapter does provide bounded frame coalescing, malformed JSON rejection, heartbeat, reconnect/backoff, subscription setup, and REST snapshot polling. It does not provide sequence/timestamp stale-event rejection, schema validation beyond object/machine-id checks, or authoritative reconciliation when individual deltas are missed. The reactive `signals.js`/`state.v2.js` implementation is present but unused; runtime state remains a global listener store.

**OVERALL STATUS: PASS WITH FOLLOW-UP**

This status means the major prototype capabilities exist and pass the available code/unit checks, but the secured live transport, browser integration, accessibility completeness, dedicated route coverage, and runtime performance still need a focused follow-up before calling the rebuild production-ready.

## Repository State

### Current diff and additions

`git diff HEAD --name-status` reports 38 tracked paths changed: environment/CI, README and architecture documentation, backend security/services/eventing/telemetry/WebSocket code, frontend tokens/layout/routes/state/twin/command/inspector/system, ML service, and simulator changes. The working tree also contains untracked additions from the rebuild: `frontend/js/realtime.js`, `frontend/js/signals.js`, `frontend/js/state.v2.js`, `frontend/js/overlay.js`, `docs/REALTIME.md`, `FINAL_IMPLEMENTATION_REPORT.md`, and the existing audit/design directories.

The frontend is a static vanilla ES-module application, not React/Vite/Next. It uses:

| Concern | Current implementation | Finding |
|---|---|---|
| Entry point | `frontend/index.html` → `frontend/js/app.js` | Active |
| Routing | Hash router in `frontend/js/router.js` | Active; 9 registered routes |
| State | `frontend/js/state.js` global store + `subscribe()` | Active, coarse-grained |
| Proposed reactive layer | `frontend/js/signals.js`, `frontend/js/state.v2.js` | Present but not imported by runtime |
| API | `frontend/js/api.js` with `fetch`, in-memory JWT | Active |
| Realtime | `frontend/js/realtime.js` native WebSocket + STOMP frames | Imported by `app.js`; runtime integration not fully verified |
| 3D | Three.js 0.169 import map + `frontend/js/twin3d.js` | Active code path |
| Charts | Canvas chart helpers in `frontend/js/charts.js` | Active in inspector/prediction views |
| Build tooling | No frontend package scripts/bundler | No production frontend build command |
| Tests | Node utility tests; ML pytest; backend JUnit | No frontend interaction/browser suite |

### Preserved and newly implemented functionality

Preserved domain functionality includes the existing Spring controllers/services/repositories, machine state machine, event log, alert lifecycle, maintenance lifecycle, simulation controls, analytics endpoints, and Three.js scene. The rebuild added or materially changed the copper/graphite visual tokens, control-room shell, responsive navigation/inspector styling, STOMP adapter, realtime store bridge, risk-mode twin highlighting, command/inspector focus behavior, and documentation.

The following are genuinely connected by code rather than merely painted into the UI:

- simulator → `/api/v1/telemetry/ingest` → `TelemetryPipeline.handle()`;
- telemetry validation/normalization → `TwinService`/repository persistence;
- throttled backend prediction assessment → stored prediction and broadcast;
- alert/maintenance/event services → backend event broadcasts;
- REST snapshot → frontend `refreshCore()`/`refreshMaintenance()`/analytics refresh;
- machine/alert/prediction/maintenance rows → inspector and backend mutation endpoints;
- ML `/assess` → backend ML gateway → prediction fields/explanation UI.

The following are only partial or demo-bound:

- synthetic telemetry is the only verified source; no physical MQTT/OPC-UA/Kafka deployment was exercised;
- browser runtime was checked against the static server with backend down, so populated live UI was not observed;
- the 3D twin uses procedural primitive geometry rather than imported industrial asset models;
- telemetry/anomaly/events are represented through inspector/alerts/predictions rather than dedicated top-level routes;
- browser performance and multi-viewport testing were not executable with the available browser control surface.

## Realtime Verification

### Actual path

```text
simulator/telemetry_feed.py
  -> POST /api/v1/telemetry/ingest
  -> TelemetryIngestController
  -> TelemetryPipeline.handle()
  -> TelemetryValidator / TelemetryNormalizer
  -> TwinService + TelemetryRepository
  -> PredictionService / EventLogService
  -> WsNotifier.broadcast("telemetry.updated", payload)
  -> Spring WebSocketConfig STOMP simple broker /topic/*
  -> frontend/js/realtime.js WebSocket + STOMP parser
  -> app.js onEvent()
  -> state.js applyRealtimeEvent()
  -> global subscribe() listener fan-out
  -> current view / twin update
```

### Evidence by stage

| Stage | Files/functions | Status |
|---|---|---|
| Telemetry source | `simulator/telemetry_feed.py`, `_post()`, `main()` | PASS by code inspection; synthetic HTTP producer |
| Ingest | `TelemetryIngestController.ingest()` / `ingestBatch()` | PASS by code inspection; backend tests cover validator/normalizer, not full live stream |
| Pipeline | `TelemetryPipeline.handle()` | PASS by code inspection; validates, normalizes, persists, invokes ML, broadcasts |
| Topic publication | `WsNotifier.broadcast()`, `WebSocketConfig` | PASS by code inspection; `/topic/{eventTopic}` and `/ws` are defined |
| Frontend connection | `StompRealtimeClient.connect()` | PARTIAL; native WebSocket/STOMP frame code exists, secured handshake not runtime-verified |
| Subscriptions | `handleFrame(CONNECTED)` loops `LIVE_TOPICS` | PASS in adapter smoke test; all 11 configured topics are subscribed |
| Parsing | `parseFrames()`, `receive()`, `handleFrame()` | PASS for framed JSON smoke path; parser is private and has no dedicated unit suite |
| Validation | `payloadIsUsable()` | PARTIAL; rejects non-objects and missing `machineId` for machine topics, but does not validate field types/ranges/timestamps/sequence |
| Coalescing | `pending` Map keyed by topic + machine/id, `requestAnimationFrame`/16 ms flush | PASS; bounded at `MAX_PENDING=240`, verified with fake WebSocket smoke test |
| Reconnect | `scheduleReconnect()` | PASS in code; exponential 1/2/4/8/16/30 s cap; actual backend restart test not rerun in this environment |
| Heartbeat | `startHeartbeat()`/`stopHeartbeat()` | PASS in code; sends STOMP newline every 10 s |
| State bridge | `applyRealtimeEvent()` | PARTIAL; machine/alert/event counters update, maintenance/simulation trigger REST refresh, but no sequence/staleness ordering guard |
| REST fallback | `startPolling()` and `refreshCore()` every 3 s | PASS in code; snapshot is the stated authority and freshness is shown in UI |
| Reconnect reconciliation | polling eventually refreshes the snapshot | PARTIAL; no explicit “reconnected → immediate snapshot” action and no per-entity merge/version protocol |

### Realtime defects and risks

1. **Secured STOMP authentication is not proven and is likely incomplete.** `frontend/js/realtime.js` places JWT in the STOMP native `CONNECT` header. `backend/src/main/java/com/forgesense/security/JwtAuthFilter.java` reads only the HTTP request `Authorization` header. No `ChannelInterceptor`, `StompHeaderAccessor`, or CONNECT authentication bridge exists. `SecurityConfig` protects non-public requests, including the `/ws` handshake. This must be verified/fixed before claiming secured live transport.
2. **No stale message rejection.** `applyRealtimeEvent()` accepts older telemetry or machine/prediction payloads if they arrive after newer data. `timestamp`, `sequence`, and `ingestedAt` are not compared.
3. **No robust duplicate identity.** Alerts deduplicate only by `id`; events are prepended without an event-id deduplication check. Messages without IDs can duplicate or overwrite/coalesce unexpectedly.
4. **Validation is intentionally shallow.** A telemetry object with a string temperature, invalid timestamp, or out-of-range value can pass frontend validation and reach state; backend validation remains the stronger boundary.
5. **No transport-level error recovery on STOMP `ERROR`.** `handleFrame(ERROR)` sets state to `CLOSED` but does not close the socket, reject/restart the connection, or clear subscriptions explicitly.

**Realtime classification: PARTIAL.** There is real transport and bounded delivery logic, but secured end-to-end live operation and strong event consistency are not verified.

## State Architecture

### Active path

`frontend/js/state.js` owns one mutable `store`, a `listeners` set, `set()` performs `Object.assign()` then calls every listener, and `app.js` installs the main listener. `inspector.js` adds its own subscription. Views use string/reference guards to avoid some unnecessary DOM rebuilds.

| Primitive | Status | Evidence |
|---|---|---|
| Signal usage | UNUSED at runtime | No runtime import of `signals.js`; only `overlay.js` and `state.v2.js` reference it |
| Computed usage | UNUSED at runtime | Defined in `signals.js`/`state.v2.js`, not imported by `app.js` or views |
| Effects usage | UNUSED at runtime | Defined in unused overlay layer |
| Batch updates | UNUSED at runtime | `batch()` exists in unused signals layer; live state calls `set()` per event |
| Realtime state | ACTIVE/PARTIAL | `applyRealtimeEvent()` updates machine/alert/event/live transport data |
| REST reconciliation | ACTIVE | `refreshCore()` replaces machine/alert/event snapshots every 3 s |
| Derived values | ACTIVE | `deriveMachineState()`/`fleetSummary()` recalculate from snapshots |
| Duplicate listener prevention | PARTIAL | singleton realtime client; global state listener model remains coarse |
| Stale-event handling | UNUSED | no timestamp/sequence gate |

The store has a useful bounded `liveTelemetry` map, but telemetry deltas do not update a per-machine history buffer or chart state; the inspector still fetches its historical series through REST. A machine update is copied into a new array/map, while telemetry only mutates `machine.lastTelemetryAt` and keeps the raw payload separately. This is internally understandable, but it means the twin’s status and inspector’s historical chart can briefly represent different freshness points.

**State classification: PARTIAL.** The active state bridge works for the tested payloads, but the advertised reactive architecture is not active and consistency semantics are not strong enough for an industrial event stream.

## Digital Twin Verification

### Implemented behavior

`frontend/js/twin3d.js` creates a Three.js scene, procedural machine geometry per type, zone slabs, dependency lines, labels, lighting, orbit controls, raycast selection, camera focus, top/reset views, health/status emissive colors, simulation highlighting, and risk mode. `app.js` synchronizes selection to the inspector and camera; `updateMachines()` reconciles machine objects; `disposeTwin()` cleans renderer, controls, observer, listeners, geometries, materials, and textures.

### Classification: PARTIAL DIGITAL TWIN

It is more than a visual mock because machine objects are built from backend machine records, selection opens a machine inspector, camera focus follows selection, status/risk/simulation state changes alter the scene, and dependency edges come from backend data. It is not a fully verified real functional digital twin because:

- the live backend was unavailable during browser verification;
- machine hover only changes the cursor; it does not expose a spatial tooltip/telemetry overlay;
- selection is pointer/raycast-only and not keyboard accessible;
- geometry is generic primitive procedural representation, not asset-specific engineering models;
- risk mode changes emissive colors/dimming, but there is no verified timeline/time-travel state;
- `animate()` runs a continuous render loop and quality adaptation reduces DPR only; there is no instancing, LOD, or explicit culling strategy;
- no current browser profile established object count, FPS, heap, or memory behavior.

## Command Center Verification

The current `/command` view is implemented in `frontend/js/views/command.js` and renders live-derived fleet KPIs, situation, zones, production impact, and the telemetry→ML→state→alert→impact→maintenance chain. The browser inspection at `http://127.0.0.1:5173/#/command` showed the shell, `Command Center`, `FACTORY OPERATIONAL`, synthetic-demo labeling, empty-safe KPI values, and an explicit `Zone layout not loaded from /api/v1/zones yet` state while the backend was down.

| Test | Result | Evidence |
|---|---|---|
| Industrial identity | PARTIAL | Graphite/copper tokens and control-room language are present; initial command screen is still mostly KPI/panel composition |
| Navy-template test | PASS | Current tokens use graphite/steel/copper; blue/cyan are secondary visualization/status colors |
| Card-grid test | PARTIAL | KPI band plus cards remains prominent, although command composition and detection chain add hierarchy |
| Template feel | PARTIAL | More distinctive than the earlier admin baseline, but several views still share repeated card/KPI structures |
| Twin centrality | FAIL on command screen | Twin is a separate `factory` route; command screen provides an “Open the interactive 3D twin” action rather than making it the hero |
| Operational density | PARTIAL | Health/attention/critical/offline/risk states are immediately visible; populated machine behavior was not live-verified |
| Interaction quality | PARTIAL | Shell nav, inspector toggle, command palette, route actions, and risk-mode controls are wired; backend-dependent machine actions could not be exercised |
| Product clarity in 10 seconds | PASS | Header says ForgeSense / Industrial Intelligence, facility/status/synthetic demo are explicit |

The copper/graphite design system is genuinely centralized in `frontend/css/tokens.css`, consumed by base/components/views CSS, and reduced motion is represented in tokens/components. It is not yet a full visual QA pass because only the 1440px-class browser view was inspected.

## Responsive Verification

Static inspection confirms responsive rules for the navigation rail and full-width mobile inspector at `max-width: 760px`, grid collapse breakpoints through `600px`, fixed touch-sized controls, `overflow-x:auto` for dense tables, and `html { overflow-x:hidden; }`.

| Viewport | Result | Evidence |
|---|---|---|
| 1440px+ | PARTIAL PASS | Browser screenshot/AX inspection completed; shell and login overlay rendered without visible horizontal overflow |
| 1024px | BLOCKED | No viewport-resize control available in the browser verification surface |
| 768px | BLOCKED | Same limitation; CSS source inspected only |
| 390px | BLOCKED | Same limitation; CSS source inspected only |
| 375px | BLOCKED | Same limitation; CSS source inspected only |

The implementation has a mobile hamburger and drawer rules, but they were not executed at a mobile viewport. Treat mobile as **PARTIAL**, not verified complete.

## Accessibility Verification

### Positive evidence

- `lang="en"`, semantic header/nav/main/aside/footer, explicit button labels, dialog/listbox/status roles, `aria-live` on the main toast/simulation regions, `aria-pressed` risk mode, labels/titles on major controls, visible `:focus-visible` styling, and `prefers-reduced-motion` CSS are present.
- The login field receives focus on boot; the browser AX tree exposed an accessible login select, password field, and Connect button. One Tab action moved focus to Connect, confirming basic keyboard traversal through the login overlay.
- Inspector open saves previous focus and restores it on close.

### Gaps

- The inspector is marked `role="dialog"` but has `aria-modal="false"` and no focus trap. `inspector.js` focuses the panel, but Tab can escape to the background.
- The 3D scene is `role="img"` with a generic label; individual machines are not in the accessibility tree and cannot be selected via keyboard.
- Dynamic realtime changes are not announced as a structured live stream; the toast is a live region, but the machine/telemetry/status updates are not.
- Several custom clickable rows/spans and zone chips rely on pointer handlers rather than fully semantic button/link behavior.
- Dialog focus management for the command palette is implemented through the separate unused `overlay.js`, not the active static palette path in `command.js`.

**Accessibility: PARTIAL / FAIL against a full WCAG 2.1 AA claim.** The shell has improved semantics, but the inspector focus trap, 3D text alternative, dynamic update announcements, and keyboard parity remain incomplete.

## API Contract Verification

The following contracts were traced against actual backend mappings and frontend consumers.

| Endpoint | Method | Frontend consumer | Backend exists | Response compatible | Status |
|---|---|---|---|---|---|
| `/api/v1/auth/login` | POST | `api.js` `login()` | Yes | `accessToken`, `username`, `roles` consumed | PASS |
| `/api/v1/machines` | GET | `state.refreshCore()` | Yes | list consumed | PASS |
| `/api/v1/machines/{id}` | GET | inspector overview | Yes | detail map consumed | PASS |
| `/api/v1/machines/{id}/telemetry` | GET | inspector telemetry | Yes | `rows` consumed | PASS |
| `/api/v1/machines/{id}/telemetry/range` | GET | inspector range selector | Yes | `rows` consumed | PASS |
| `/api/v1/machines/{id}/predictions` | GET | inspector prediction | Yes | array consumed | PASS |
| `/api/v1/machines/{id}/explanation` | GET | predictions/inspector | Yes | factors consumed | PASS |
| `/api/v1/machines/{id}/events` | GET | inspector events | Yes | list consumed | PASS |
| `/api/v1/machines/dependencies/edge` | GET | scaffold/twin | Yes | edge list consumed | PASS |
| `/api/v1/alerts` + lifecycle paths | GET/POST | alerts view | Yes | item/status contract consumed | PASS |
| `/api/v1/events` | GET | state refresh | Yes | items/count consumed | PASS |
| `/api/v1/maintenance` + lifecycle paths | GET/POST | maintenance/inspector | Yes | item/status contract consumed | PASS |
| `/api/v1/analytics/*` | GET | state/analytics | Yes | overview/ranking/trends/stats consumed | PASS |
| `/api/v1/impact/{id}` + `/analyze` | GET/POST | command/inspector | Yes | latest/history consumed | PASS |
| `/api/v1/simulation/*` | GET/POST | simulation view | Yes | control/scenario/config consumed | PASS |
| `/actuator/health` | GET | system/app health | Yes | status/components consumed | PASS |

No frontend call to a non-existent backend route was found in the inspected paths. Live HTTP compatibility was not executed because no backend was listening on `localhost:8080`.

## ML Integration Verification

The ML path is real synthetic-model inference, not a frontend hardcode:

```text
TelemetrySample
  -> backend PredictionService / MlGateway
  -> POST ml-service /assess
  -> profile-based z-score features
  -> IsolationForest anomaly score
  -> GradientBoosting failure-risk classifier
  -> GradientBoosting synthetic RUL-step regressor
  -> baseline-perturbation feature attribution
  -> backend Prediction persistence
  -> machine summary / explanation endpoints
  -> frontend Predictions and Inspector views
```

Evidence: `ml-service/app/models.py` builds or loads deterministic artifacts with profile hashing and held-out metrics; `features.py` uses the shared catalog; `main.py` validates requests and returns anomaly/risk/health/RUL/factors/recommendations; `ml-service/tests/test_api.py` passed 8 tests. The UI explicitly labels `MODEL` versus `HEURISTIC` fallback and RUL as synthetic `steps`, which is technically honest.

**ML classification: PASS for service/unit integration; PARTIAL end-to-end.** Backend-to-ML live connectivity was not run in this environment. RUL is a synthetic horizon in steps, not physical remaining useful life.

## Route-by-Route Status

| View/route | Status | Real data/interactions | Main limitation |
|---|---|---|---|
| Command Center | COMPLETE/PARTIAL | REST-derived fleet/impact/situation; select machine, zone, twin/simulation links | Twin not central hero; backend runtime not observed |
| Digital Twin (`factory`) | PARTIAL | Three.js scene, zones, selection, camera, risk mode, simulation overlay | No live browser verification; generic geometry; keyboard/hover gaps |
| Assets (`fleet`) | COMPLETE | Search, status/zone filters, sorting, row→inspector | No dedicated `/assets` route name |
| Telemetry | PARTIAL | Inspector telemetry tab fetches 5m/15m/6h series and draws canvas chart | No dedicated telemetry route; no live delta chart buffer |
| Predictions | COMPLETE/PARTIAL | Ranked risk, attribution, inspector history and model/fallback labeling | Backend runtime and chart performance not verified |
| Anomalies | PARTIAL | Alert view and anomaly score/label in predictions/inspector | No dedicated anomalies route/investigation view |
| Alerts | COMPLETE | Filter, machine focus, acknowledge/investigate/resolve lifecycle | Action error handling is not consistently caught in view handlers |
| Maintenance | COMPLETE | Filter, schedule/start/complete/cancel, RBAC gating, inspector workflow | Mutation errors can escape as rejected promises |
| Analytics | COMPLETE/PARTIAL | Backend overview/risk/health/event/maintenance panels | Mostly bars/KPIs; not a dedicated time-series chart experience |
| Events | PARTIAL | Global state and inspector event list | No top-level event timeline route |
| System | COMPLETE/PARTIAL | Service/ML/transport/health/reconciliation cards | Actual service checks require backend runtime |

Loading and empty states are present in most views, especially inspector, predictions, simulation, maintenance, alerts, and analytics. Error states are inconsistent: `state.js` often falls back to an empty/unchanged store, while action handlers in alerts, maintenance, simulation, and inspector do not consistently show a user-facing error on mutation failure.

## Dead UI Findings

- `frontend/js/signals.js`, `frontend/js/state.v2.js`, and `frontend/js/overlay.js` are not imported by the active application. They are architectural candidates, not active runtime primitives.
- The command palette is active through `frontend/js/command.js`; the focus-trap implementation in `overlay.js` is not used by it.
- There are no registered top-level routes for `assets`, `telemetry`, `anomalies`, or `events`; functionality is folded into fleet, inspector, alerts, predictions, and system views. This is an information-architecture gap rather than a broken button.
- The status footer still labels one service “Kafka” even when the active UI transport is STOMP and the default dev profile has Kafka disabled. The companion value correctly reports REST fallback/STOMP live, but the label can mislead operators.
- There are no obvious `TODO`, `FIXME`, “Coming Soon”, or intentional empty core-return placeholders in the active frontend/backend/ML paths found by repository search.
- Most visible buttons have handlers. The remaining risk is unhandled rejected promises in async mutation handlers, not buttons with no callback.
- `console.error()` remains in the realtime event-handler catch path. This is useful diagnostics but should be routed through the application logging policy before production.
- The frontend uses `innerHTML` for clearing/rendering containers. Dynamic content inspected in the primary paths is generally passed through `esc()`, but this remains a surface that requires discipline.

## Visual Quality Tests

| Test | Result | Concrete finding |
|---|---|---|
| Industrial identity | PARTIAL | Strong terminology, facility/transport labels, graphite/copper tokens; command view still reads as a structured dashboard |
| Navy template | PASS | Navy is not the dominant palette |
| Card grid | PARTIAL | KPI band and repeated cards remain common across views |
| Template feel | PARTIAL | Better than the legacy admin baseline, but not yet a fully distinct spatial product language |
| Twin centrality | PARTIAL overall / FAIL on command | Twin is a separate full route and is not the command page hero |
| Operational density | PASS/PARTIAL | Critical/attention/risk/freshness values are placed high; zero-data state was all that could be rendered live |
| Interaction quality | PARTIAL | Route, palette, inspector, zone, risk, workflow handlers exist; data-dependent interaction blocked by unavailable API |
| Product clarity | PASS | First viewport clearly names Industrial Intelligence, Factory Alpha, operational/degraded state, and synthetic demo basis |

## Performance Verification

No current browser profiler or Lighthouse result was manufactured. **Browser profiling: BLOCKED — browser profiling unavailable in the available CUA surface.**

Source-level findings:

- Three.js creates multiple meshes/materials per machine and traverses machine groups during status application. There is no instancing, LOD, or frustum-culling policy visible.
- The animation loop schedules a continuous `requestAnimationFrame`; hidden documents skip rendering work but continue scheduling frames.
- DPR adaptation exists and lowers pixel ratio when sampled FPS falls below 44, which is a useful guard but not a complete scalability strategy.
- Realtime pending events are bounded to 240 and coalesced per topic/entity; this is a clear improvement over the prior unbounded message path.
- Frontend has no bundler/minification/code splitting or automated bundle budget. Three.js, fonts, and icon resources are loaded from CDNs; no SRI attributes are present.
- `state.js` still broadcasts the whole store to all subscribers, so view-level render guards are the primary performance control.

No FPS, heap, latency, DOM, or bundle-size values are asserted here because they were not measured in this audit.

## Security Verification

### Positive controls

- Backend has stateless JWT authentication, BCrypt password encoding, method security/RBAC, CORS configuration, and an explicit production-secret requirement outside demo mode.
- Frontend keeps the JWT and login credential in memory rather than localStorage; the simulator reads its password from environment configuration.
- `.env.example` uses placeholders and documents that real `.env` files must not be committed.
- ML CORS is restricted to configured local origins and allows only the expected methods/headers.
- No committed API key or database password was found in the inspected configuration.

### Findings

1. **STOMP authentication bridge missing/undemonstrated:** see Realtime Verification. This is the highest security/integration follow-up.
2. `WebSocketConfig` falls back to `List.of("*")` when allowed origins are empty. Configuration defaults are restrictive, but the fallback is unsafe if deployment omits the variable.
3. `API_BASE` is user-overridable through localStorage. This is acceptable for a local demo, but production deployments should use a trusted build/runtime configuration rather than arbitrary client-selected origins.
4. Token refresh reuses the login password held in memory. This avoids persistence but is still sensitive in the page process and should be documented as a demo compromise or replaced with a refresh-token flow.
5. External CDN assets have no Subresource Integrity and are not pinned locally; this is a supply-chain hardening follow-up.

**Security classification: PARTIAL.** The core API security design is present, but WebSocket authentication and deployment-origin hardening need resolution.

## Reference Comparison

The exact reference repository inspected was [KadhirDev/factory-twin](https://github.com/KadhirDev/factory-twin), not `factory-twin-observer`. It was used at the architectural/product-pattern level only: spatial factory representation, machine-level inspection, telemetry-to-risk presentation, and a digital-twin-first information hierarchy. ForgeSense has its own product name, graphite/copper tokens, backend domain, simulator, ML service, and terminology. No reference source code, branding, assets, or text was copied during this audit.

## Test Matrix

| Check | Command/result | Status |
|---|---|---|
| Frontend syntax | `node --check` over frontend JS modules; 13 top-level modules plus recursive module checks from the prior pass | PASS |
| Frontend unit tests | `node --test frontend/test/util.test.mjs` | PASS — 25 tests |
| Realtime adapter smoke | Fake WebSocket/STOMP CONNECT + telemetry coalescing smoke | PASS — newest same-entity payload delivered once |
| State bridge smoke | LocalStorage stub + `applyRealtimeEvent()` smoke | PASS — machine, telemetry, notification state changed |
| Static frontend HTTP | Node static server on `127.0.0.1:5173`, HTML/marker check | PASS — HTTP 200 |
| Browser shell | Chrome CUA screenshot + AX tree at `/#/command` | PASS/PARTIAL — shell/login/command empty state rendered; backend unavailable |
| Browser keyboard spot-check | Login field focus then Tab to Connect | PASS for basic traversal; full workflow blocked by login/API |
| ML tests | `& .\\ml-service\\.venv\\Scripts\\python.exe -m pytest ml-service/tests -q` | PASS — 8 passed, 3 dependency/cache warnings |
| Backend tests | Maven/Surefire reports in `backend/target/surefire-reports` | PASS at report level — 7 suites, 49 tests, 0 failures/errors; the Maven process itself hung during shutdown in this environment and was terminated |
| Docker Compose syntax | `docker compose config --quiet` | PASS — exit 0, Docker config access warnings |
| Docker runtime | `docker version` / service startup | BLOCKED — Docker Desktop daemon unavailable |
| ML runtime | `TestClient` tests | PASS through test app; standalone uvicorn deployment not run |
| Frontend build/lint/typecheck | No configured frontend scripts/package dependencies | BLOCKED/NOT CONFIGURED |
| Backend live integration | `/actuator/health`, login, REST, STOMP | BLOCKED — no backend listening on localhost:8080 |
| Multi-viewport visual QA | 375/390/768/1024/1440+ | PARTIAL — 1440-class inspected; viewport control unavailable for the others |
| Browser performance profile | DevTools/Lighthouse | BLOCKED — profiling surface unavailable |
| Diff hygiene | `git diff --check` | PASS — only line-ending warnings |

## Known Limitations

- The final secured WebSocket handshake and event flow remain unverified and may fail until STOMP CONNECT authentication is wired into Spring Messaging.
- There is no active use of the added signal/computed/effect/batch architecture.
- State reconciliation lacks event versioning, stale suppression, event-id deduplication, and immediate post-reconnect snapshot semantics.
- Dedicated top-level telemetry, anomalies, and events experiences do not exist.
- Inspector focus trap and keyboard-accessible twin alternative are incomplete.
- No frontend build, lint, typecheck, browser interaction suite, visual regression suite, or performance budget exists.
- Docker daemon and backend runtime were unavailable for this gate.
- Synthetic ML output is deterministic and tested, but it is not validated against physical failure data; RUL is explicitly synthetic steps.

## Required Follow-Up

### P0 — required before claiming live production-style completion

1. Add and test a Spring STOMP `ChannelInterceptor` (or equivalent) that authenticates the JWT from the STOMP CONNECT frame, and verify handshake/CONNECT/subscription behavior in secured mode.
2. Add event envelope validation and versioning: `eventId`, `sequence`/timestamp, schema version, and per-entity stale/duplicate rejection in the frontend bridge.
3. Add an immediate REST snapshot reconciliation after STOMP reconnect and a clear connection-state transition test.
4. Add the missing frontend mutation error handling so failed acknowledge/maintenance/simulation actions become user-visible error states instead of unhandled promise rejections.

### P1 — required for product-quality follow-up

1. Either activate the signal/state-v2 approach or remove it; do not retain a competing unused state architecture.
2. Implement an inspector focus trap with `aria-modal="true"` while open, focus restoration, and an accessible text/table alternative for the 3D twin.
3. Add dedicated telemetry/anomalies/events routes or document and deliberately validate the folded information architecture.
4. Add browser automation at 375, 390, 768, 1024, and 1440+ with screenshots and keyboard workflows.
5. Add frontend build/lint/typecheck scripts, realtime contract tests, and a browser smoke suite.

### P2 — performance/hardening

1. Profile the twin with representative fleet sizes and add instancing/LOD/culling if needed.
2. Add chart decimation/rAF batching and a frontend render/update budget.
3. Pin or self-host CDN assets and add SRI where CDN use remains.
4. Change the WebSocket allowed-origin empty fallback from `*` to a safe failure or explicit development-only behavior.

## Final Status

```text
OVERALL STATUS: PASS WITH FOLLOW-UP
```

The current repository is a functional industrial-intelligence prototype with real backend, ML, REST, simulation, state, and 3D foundations. It is not yet a fully verified secured realtime production-style platform because the backend runtime was unavailable for this gate and the code review identified concrete live-transport authentication and state-consistency gaps.

### Exact files requiring work next

- `backend/src/main/java/com/forgesense/security/SecurityConfig.java`
- `backend/src/main/java/com/forgesense/websocket/WebSocketConfig.java`
- new/updated Spring Messaging auth interceptor under `backend/src/main/java/com/forgesense/security/` or `websocket/`
- `frontend/js/realtime.js`
- `frontend/js/state.js`
- `frontend/js/app.js`
- `frontend/js/views/alerts.js`
- `frontend/js/views/maintenance.js`
- `frontend/js/views/simulation.js`
- `frontend/js/views/inspector.js`
- `frontend/index.html`
- `frontend/js/command.js`
- `frontend/js/signals.js` / `frontend/js/state.v2.js` / `frontend/js/overlay.js` (activate or remove after an explicit decision)
- `frontend/package.json` and a new browser-test/build configuration
- `docs/REALTIME.md` (update after secured STOMP verification)
