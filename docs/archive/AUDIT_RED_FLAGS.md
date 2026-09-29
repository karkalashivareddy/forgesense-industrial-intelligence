# ForgeSense Engineering Audit — Phase 0

**Audit date:** 2026-09-16 (Asia/Calcutta)
**Repository:** `karkalashivareddy/forgesense-industrial-intelligence`
**Auditor:** Codex
**Scope:** forensic inspection only; no application source was fixed or redesigned during Phase 0.

## Executive status

ForgeSense has a credible vertical slice: the repository contains a Spring Boot backend, FastAPI ML service, simulator, shared machine-profile JSON, a static modular JavaScript frontend with a Three.js twin, Compose infrastructure, and automated tests. The product documentation generally labels the simulator and production-impact figures as synthetic or estimated, and the frontend explicitly states that it does not control real machines.

The current worktree is not a clean release baseline. It contains substantial pre-existing modified and untracked files, including ML v2 code and untracked model artifacts, while `HEAD` still contains the older ML v1 implementation. All findings below are based on the executable current worktree unless explicitly marked `HEAD` or `HEAD:`. No user changes were reverted.

The most urgent result is that the active frontend does not boot its routed workspace in a real browser. A static-browser probe reached the sign-in shell but logged an uncaught router exception and left `<main>` empty. Separately, several backend/frontend contracts would produce incorrect or invisible operational state even after the boot defect is repaired.

### Severity definitions

- **P0 — correctness, security, or data-integrity blocker:** the system cannot be trusted for the stated workflow, or the primary product surface does not function.
- **P1 — serious architecture or product problem:** a core operating journey, boundary, or deployment assumption is materially unreliable.
- **P2 — important quality issue:** meaningful testability, maintainability, accessibility, resilience, or performance risk.
- **P3 — polish or documentation issue:** does not immediately invalidate the product, but weakens interview-grade credibility or operational clarity.

### Finding summary

| Severity | Count | Meaning |
|---|---:|---|
| P0 | 9 | Must be resolved before product redesign or end-to-end acceptance |
| P1 | 24 | Must be addressed or explicitly accepted in the engineering plan |
| P2 | 10 | Important hardening and quality work |
| P3 | 4 | Documentation and repository hygiene |

## P0 findings

### P0-01 — SPA router crashes during initial route mount

- **File / location:** `frontend/js/router.js:19-34`; registrations in `frontend/js/app.js:6-15`.
- **Problem:** `app.js` passes ES module namespace objects to `register()`. `router.go()` then assigns `v.el = host`. Module namespace objects are immutable, so the assignment throws before the default view mounts.
- **Why it matters:** the control-room workspace is not usable. Navigation, the Command Center, and the synchronized inspector cannot be accepted until boot is error-free.
- **Evidence:** real Chrome load against `http://localhost:5173/` on 2026-09-16 logged `TypeError: Cannot assign to property 'el' of [object Module]` at `router.js:33:8`; the accessibility snapshot showed an empty `main` element behind the sign-in shell.
- **Recommended fix:** register mutable view descriptors or keep route DOM references in router-owned state; do not mutate imported namespace objects.
- **Validation method:** load the frontend in Chrome from a clean session, assert no uncaught console errors, assert the default Command Center renders, then exercise every route.

### P0-02 — ML implementation, tests, artifacts, and Git history disagree on model version

- **File / location:** `ml-service/app/models.py:57-58` (worktree); `ml-service/tests/test_api.py:30-31`; untracked `ml-service/models/*`; `HEAD:ml-service/app/models.py`.
- **Problem:** the worktree reports `anomaly-model-v2` and `failure-risk-v2`, while the public `HEAD` implementation reports v1. The v2 artifacts and evaluation JSON are untracked, so a clean clone, CI build, and local worktree can train or serve different model contracts.
- **Why it matters:** model results are not reproducible, model metadata cannot be trusted, and the frontend/backend can silently display a version that is absent from the committed source.
- **Evidence:** current tests require v2; `ml-service/models/eval-metrics.json` is untracked and states that metrics came from a random row split; Git status shows the ML source modified and `ml-service/models/` untracked.
- **Recommended fix:** choose one canonical model source/version, make artifact provenance explicit, and make CI build the same version from the same committed evaluation pipeline. Remove or quarantine stale artifacts.
- **Validation method:** clone the committed revision into a clean directory, build the ML image, query `/health` and `/assess`, and compare version, feature schema, profile hash, and evaluation metadata with the repository manifest.

### P0-03 — RUL is displayed as hours after an arbitrary `* 20` conversion

- **File / location:** `ml-service/app/main.py:125-131`; `ml-service/app/models.py:214-223`; `frontend/js/views/fleet.js:142`, `predictions.js:77`, `inspector.js:144`, `command.js:95`.
- **Problem:** the model predicts synthetic remaining steps, then the API multiplies the output by `20.0` and the UI labels it `h`. The evaluator also publishes `rul_rmse_hours_equiv` using the same arbitrary factor.
- **Why it matters:** operators can read a model-step heuristic as physical remaining useful life. This is an unsupported operational claim and violates the stated requirement that physical time must not be invented.
- **Evidence:** source comments call the conversion a heuristic; the response field is `rulEstimate`; multiple active views append `h` without a sampling-interval or calibration field.
- **Recommended fix:** either train and evaluate hours-to-failure using a documented sampling interval, or rename the value everywhere to `estimated remaining steps` and show the sampling basis and uncertainty.
- **Validation method:** unit-test labels and units at the API boundary, inspect the rendered UI for no unsupported `h`, and verify the evaluation report uses the same declared target unit.

### P0-04 — Stale telemetry validation checks the envelope timestamp, not the sample timestamp

- **File / location:** `backend/src/main/java/com/forgesense/telemetry/validation/TelemetryValidator.java:28-38`; `backend/src/main/java/com/forgesense/telemetry/web/TelemetryIngestController.java`; `backend/src/main/java/com/forgesense/telemetry/pipeline/TelemetryPipeline.java:84-93`.
- **Problem:** the validator receives an event/envelope timestamp. HTTP ingest passes `Instant.now()` and the pipeline validates that envelope value, while the actual sample timestamp can be arbitrarily old or out of order.
- **Why it matters:** stale telemetry can update the digital twin, predictions, alerts, and production impact while the UI reports fresh data.
- **Recommended fix:** validate sample event time and transport receive time separately; reject or quarantine stale/future samples and enforce sequence/timestamp ordering per machine.
- **Validation method:** submit samples with old, future, duplicate, and out-of-order timestamps through both HTTP and Kafka paths and assert the same explicit rejection/quarantine contract.

### P0-05 — Nullable telemetry can abort the hot path after persistence

- **File / location:** `backend/src/main/java/com/forgesense/telemetry/pipeline/TelemetryPipeline.java:108-124`; nullable fields in `TelemetrySample` and `TelemetryRecord`.
- **Problem:** `Map.of(...)` is used with nullable `temperature`, `vibration`, `rpm`, and `torque`. Java `Map.of` rejects null values. The outer pipeline catches the exception broadly after parts of processing may already have run.
- **Why it matters:** a legitimate machine-specific missing sensor can result in a saved record without downstream prediction, event broadcast, or a visible error. This creates partial state and makes missing-sensor behavior unsafe.
- **Recommended fix:** use null-tolerant payload builders, persist explicit missingness, and make pipeline stages transactional or idempotent with observable dead-letter/retry outcomes.
- **Validation method:** ingest each supported machine with one required sensor missing, then multiple sensors missing; assert no exception, explicit missingness, a documented ML outcome, and consistent event/telemetry state.

### P0-06 — Alert lifecycle names do not match between backend and frontend

- **File / location:** backend `AlertStatus.java`, `AlertController.java:33-40`; frontend `frontend/js/views/alerts.js:11`, `31`, `67`, `77`, `89-111`.
- **Problem:** backend active-new alerts are named `NEW`; the frontend expects `ACTIVE`. The UI filters and renders `ACTIVE`, while the backend `AlertStatus.valueOf(status)` will reject `ACTIVE` rather than map it.
- **Why it matters:** newly generated alerts can be invisible in the Alert Center, active counters can be wrong, and an `ACTIVE` query can return a server error. This breaks the core detect-to-decide workflow.
- **Recommended fix:** define one canonical lifecycle (`NEW/ACKNOWLEDGED/INVESTIGATING/RESOLVED` or an explicitly mapped `ACTIVE`) in a shared API contract and test every transition.
- **Validation method:** create a new alert, fetch unfiltered and filtered lists, acknowledge/investigate/resolve it, and assert identical state names and counts across API and UI.

### P0-07 — System status claims “LIVE” and streaming from configuration rather than verified health

- **File / location:** `backend/src/main/java/com/forgesense/system/web/SystemController.java:38-50`; `TelemetryIngestController.java:80-84`; `frontend/js/app.js:150-162`; `frontend/js/views/system.js:39`, `60`, `115-116`.
- **Problem:** the backend returns `streaming: "KAFKA"` or `"IN-PROCESS"` based on configuration and hardcodes `dataBasis: ["LIVE", "SIMULATED"]`. The frontend treats either non-empty string as truthy and renders `ACTIVE`/`streaming active`.
- **Why it matters:** the product can say LIVE, Kafka, or active while no broker, consumer, database, or telemetry producer is healthy. This violates the non-negotiable honesty rule.
- **Recommended fix:** expose typed transport state with actual connection/last-success timestamps, use `REST POLL · 3s` for the current frontend transport, and label simulator input `SYNTHETIC` rather than `LIVE`.
- **Validation method:** stop each dependency independently, query the status API, and verify the UI shows `DOWN`, `DEGRADED`, or `STALE` with evidence rather than configuration labels.

### P0-08 — Connectivity state transition emits an event but does not apply or persist the state

- **File / location:** `backend/src/main/java/com/forgesense/machine/MachineService.java:77-82`; `ConnectivityMonitor.java:90-95`; `TwinService.java:112-117`.
- **Problem:** `setStatusQuiet()` calls `emitStateChanged()` but never sets the twin status or persists the machine. `emitStateChanged()` only publishes/broadcasts the requested transition.
- **Why it matters:** a machine can remain `NORMAL` in the authoritative twin/database while an event says it became `OFFLINE` or `RECOVERING`. Later reads, alert decisions, and selection views disagree.
- **Recommended fix:** route monitor transitions through one validated, transactional state transition method and persist connectivity/status atomically with the event.
- **Validation method:** stop telemetry for more than the configured offline threshold, query machine/twin/event endpoints, restart the process, and assert `OFFLINE → RECOVERING → NORMAL` is durable and consistent.

### P0-09 — System view has an undefined variable on its render path

- **File / location:** `frontend/js/views/system.js:47`, `81-88`.
- **Problem:** `reconcileCard(fs, o)` references `st.definedMachines`, but `st` is not defined in that function.
- **Why it matters:** the System page will throw during render when reached, masking service status and observability information.
- **Recommended fix:** pass the system-status object explicitly or remove the stale reference; add a route-render test with a representative status payload.
- **Validation method:** open System with API fixtures and with partial/failed service data; assert no console error and complete cards.

## P1 findings

### P1-01 — Evaluation leaks degradation trajectories through row-level random splitting

- **File / location:** `ml-service/app/models.py:102-190`, `257-278`; untracked `ml-service/models/eval-metrics.json:6`.
- **Problem:** neighboring rows from the same generated trajectory are concatenated and split randomly into train/test rows. The artifact explicitly says “held-out 20% of generated samples (random split)”.
- **Why it matters:** temporal neighbors share the same baseline, fault onset, and degradation ramp, so reported AUC/RMSE can overstate generalization to unseen trajectories, machines, or fault scenarios.
- **Recommended fix:** implement deterministic trajectory-aware train/validation/test splits, optionally hold out machine IDs and fault types, and publish split counts and hashes.
- **Validation method:** assert no trajectory ID appears in more than one split; rerun evaluation from a clean environment and compare the machine-readable report.

### P1-02 — Synthetic generator uses one generic “all values rise” degradation pattern

- **File / location:** `ml-service/app/models.py:102-183`; simulator `simulator/telemetry_feed.py` fault/degradation logic.
- **Problem:** the ML generator applies broadly correlated offsets to most features. It does not encode distinct bearing, overload, cavitation, cooling, imbalance, drift, intermittent, and network-delay signatures.
- **Why it matters:** the model can learn “everything increasing” rather than industrially meaningful causal signatures; explanations and simulations will not be credible across fault classes.
- **Recommended fix:** create fault-specific generators grounded in the shared profile relationships, with trajectory IDs and scenario labels.
- **Validation method:** plot and statistically test each scenario’s expected signal direction, relationship stability, onset pattern, and recovery behavior.

### P1-03 — Model features are instantaneous only

- **File / location:** `ml-service/app/features.py:39`, `139-158`.
- **Problem:** the fixed feature vector is a per-sample z-score vector. There are no rolling mean/std, deltas, rates, short trends, EWMA, anomaly-onset duration, or recent anomaly count features.
- **Why it matters:** degradation and intermittent faults are temporal phenomena; an instantaneous vector cannot distinguish trend, transient spike, and persistent deterioration reliably.
- **Recommended fix:** add a small, documented temporal feature set with bounded history and explicit warm-up/missing-history behavior.
- **Validation method:** feature-unit tests, trajectory-level ablations, and time-ordered evaluation showing whether each temporal feature improves held-out scenario performance.

### P1-04 — Missing sensors are encoded as nominal values

- **File / location:** `ml-service/app/features.py:6-8`, `139-158`; `schemas.py:56`.
- **Problem:** absent or non-applicable sensors are encoded as z-score `0.0`; missingness is only returned as a side list and is not part of the model vector. The response list also uses a mutable default.
- **Why it matters:** missing telemetry can look healthy to the model and reduce risk or anomaly scores instead of reducing confidence or producing an explicit rejection.
- **Recommended fix:** use missingness indicators and a trained missing-data policy, or reject incomplete required samples with a typed reason. Use immutable schema defaults.
- **Validation method:** test missing vibration, temperature, current, and multiple sensors; compare score/confidence behavior and assert missingness cannot create a nominal-looking explanation.

### P1-05 — No reproducible trajectory evaluation or risk-calibration pipeline exists

- **File / location:** `ml-service/app/models.py:202-223`, `257-303`; no `ml-service/evaluation/` package.
- **Problem:** only anomaly AUC, failure-risk AUC, and RUL RMSE are generated; there is no committed split module, PR-AUC, precision, recall, F1, confusion matrix, Brier score, calibration curve, or threshold policy.
- **Why it matters:** a risk score is displayed as a probability-like value without evidence that it is calibrated or useful at operational thresholds.
- **Recommended fix:** add `evaluation/splits.py`, `metrics.py`, `evaluate.py`, and `report.py` with machine-readable outputs, calibration analysis, and model metadata.
- **Validation method:** run evaluation twice from a clean checkout and compare hashes; assert reports contain the required metrics and calibration status without hardcoded values.

### P1-06 — Explanations merge anomaly and failure-risk drivers and omit operational context

- **File / location:** `ml-service/app/explanation.py:25-99`; `ml-service/app/main.py:134-147`.
- **Problem:** anomaly and risk perturbation contributions are combined with a fixed `.4/.6` weight into one `factors` list. The response has feature, contribution, label, and direction, but not current value, normal range, unit, sigma/delta, or separate driver sets.
- **Why it matters:** operators cannot tell why a sensor is anomalous versus why the model predicts failure. The output is intentionally baseline perturbation, not SHAP, but the current contract is still too thin for trustworthy investigation.
- **Recommended fix:** return separate anomaly drivers and risk drivers with value, unit, baseline/range, direction, contribution scale, method, and model version.
- **Validation method:** fixture tests for each fault signature; verify driver separation and that rendered explanations never call the method SHAP.

### P1-07 — Caller-supplied machine type can override the authoritative machine identity

- **File / location:** `ml-service/app/main.py:106-112`; `ml-service/app/features.py:112-132`.
- **Problem:** the endpoint rejects an unknown machine ID, but an existing machine can be assessed with an arbitrary explicit `machineType`; `profile_for()` intentionally gives the explicit type precedence.
- **Why it matters:** M-101 can be scored with M-102’s baselines and sensors, creating a cross-layer identity violation that contaminates predictions and explanations.
- **Recommended fix:** derive type from the authoritative machine registry, or require and verify an exact type match with a clear 400 response.
- **Validation method:** submit every known machine with an incorrect known type and assert rejection; submit unknown IDs and unknown types and assert 404/400 semantics.

### P1-08 — Machine profiles are not actually single-source across runtime fallbacks

- **File / location:** `config/machine_profiles.json`; backend `Machine.java:95-135`, `HeuristicMlClient.java:21-31`; `DataSeeder.java:44-52`, `132-163`; frontend twin layout/metadata.
- **Problem:** the catalog is authoritative for seeding and ML profiles, but backend default sensor sets, heuristic baselines, seeder positions, and frontend sensor metadata are duplicated elsewhere. Several sensor sets differ from the JSON catalog.
- **Why it matters:** a degraded ML fallback, simulator reading, backend validation, and inspector can disagree on sensor availability, units, nominal ranges, and machine identity.
- **Recommended fix:** generate or load all runtime profiles, including fallback baselines and display metadata, from one versioned catalog; keep layout as a profile field or a separately versioned spatial catalog.
- **Validation method:** add a cross-language profile contract test comparing machine IDs, types, sensors, units, ranges, thresholds, and dependencies across backend, ML, simulator, and frontend fixtures.

### P1-09 — Existing databases do not rebuild the in-memory twin registry

- **File / location:** `backend/src/main/java/com/forgesense/bootstrap/DataSeeder.java:80-108`; `TwinService`; `ConnectivityMonitor`.
- **Problem:** if any machine exists, the seeder returns before registering machines in the in-memory twin map. Connectivity monitoring iterates that map, so restart behavior differs between an empty seeded DB and an existing DB.
- **Why it matters:** offline detection, WebSocket state changes, and in-memory operational state can silently stop after restart even though database-backed machine endpoints still work.
- **Recommended fix:** separate idempotent catalog seeding from a startup reconciliation that registers all persisted machines and restores current twin fields.
- **Validation method:** start with an existing database, verify all eight twins are registered, stop one telemetry stream, and compare behavior with a first-boot environment.

### P1-10 — Event and telemetry idempotency/order semantics are incomplete

- **File / location:** `EventEnvelope`, `EventLogService.java:19-79`, `TelemetryRecord`, telemetry repositories.
- **Problem:** event IDs and correlation IDs are generated but not durably represented in the event-log contract; telemetry has no verified machine+sequence uniqueness or last-seen ordering guard. Event throttling is process-local and time-based.
- **Why it matters:** retries, duplicate Kafka deliveries, restarts, and out-of-order samples can create duplicate alerts/events or regress twin state.
- **Recommended fix:** persist event identity/correlation, define idempotency keys, add unique constraints, and reject/quarantine stale sequence numbers per machine.
- **Validation method:** replay the same event, deliver duplicates across a restart, and deliver sequences `2,1,2`; assert one durable effect and explicit replay metrics.

### P1-11 — Kafka failure handling does not provide a reliable retry/DLQ contract

- **File / location:** `backend/src/main/java/com/forgesense/streaming/KafkaEventBus.java:29-34`; `KafkaIngress.java`; Kafka configuration.
- **Problem:** async publish failures are raised inside a future callback without a durable retry or dead-letter path, and the listener does not expose a clear error-handler/acknowledgment policy.
- **Why it matters:** telemetry can be accepted by an HTTP boundary but disappear from the event pipeline without an operator-visible failure state.
- **Recommended fix:** define producer delivery semantics, bounded retries, an error handler, DLQ payload, replay procedure, and metrics for each stage.
- **Validation method:** stop Kafka during publish/consume, inject malformed events, and assert retry/DLQ/metrics behavior without silent loss.

### P1-12 — Alert deduplication is machine-wide rather than correlated to a root condition

- **File / location:** `backend/src/main/java/com/forgesense/alert/AlertService.java:52-66`; `AlertRepository` open-alert query.
- **Problem:** `ensureAlert()` finds one open alert by machine and status, not by alert type, root signal, scenario, or correlation key.
- **Why it matters:** independent vibration, temperature, and connectivity conditions can overwrite or suppress one another; repeated polling is not modeled as a durable correlation window.
- **Recommended fix:** define alert fingerprints and correlation windows, persist first/last seen and duration, and keep active versus history queries explicit.
- **Validation method:** raise two independent root signals on one machine and repeat each signal across polling cycles; assert correct deduplication and history.

### P1-13 — “Resolved today” analytics counts opened alerts

- **File / location:** `backend/src/main/java/com/forgesense/analytics/AnalyticsService.java:99-105`.
- **Problem:** `resolvedToday` calls `countByOpenedAtAfter(...)` instead of counting `resolvedAt` for resolved alerts.
- **Why it matters:** analytics and the Command Center can report a resolution metric that is not a resolution metric, undermining maintenance and recovery analysis.
- **Recommended fix:** add a resolved timestamp query filtered by `RESOLVED`, and expose explicit time-basis fields in the API.
- **Validation method:** create alerts on different days, resolve only a subset today, and assert the statistic matches resolved timestamps.

### P1-14 — Security defaults expose development assumptions and sensitive diagnostics

- **File / location:** `.env.example`; `docker-compose.yml`; `application.yml:48-57`; `SecurityConfig.java:65-79`; `ForgeUserDetailsService.java:24-31`; `JwtService.java`.
- **Problem:** default/demo passwords and a deterministic fallback JWT secret exist; actuator exposes `env`, `beans`, and `loggers` with `show-details: always`; H2 console and Swagger are permitted; disabling security makes every request permitted.
- **Why it matters:** copied demo configuration can expose secrets, diagnostics, schema tooling, or authenticated operations in a non-demo environment.
- **Recommended fix:** fail closed outside an explicit demo profile, require secrets through validated environment/configuration, restrict actuator and docs, remove H2 console from deployable profiles, and never use deterministic JWT fallback in a secured profile.
- **Validation method:** run a production-like profile with missing/weak secrets and assert startup failure; verify actuator/docs/H2/CORS access under operator, engineer, admin, and anonymous requests.

### P1-15 — CORS and WebSocket authorization are broad by default

- **File / location:** `SecurityConfig.java:67`, `89-92`; `WebSocketConfig.java:34-35`.
- **Problem:** WebSocket/topic paths are permitted without authentication and empty allowed-origin configuration falls back to `*`; CORS is configured with credentials enabled.
- **Why it matters:** operational telemetry and state-change broadcasts may be readable cross-origin without the same authorization boundary as REST APIs.
- **Recommended fix:** require explicit origins, authenticate the WebSocket handshake/subscriptions, and apply role/tenant checks to destinations.
- **Validation method:** test anonymous/cross-origin WebSocket and REST requests with a browser and integration tests; assert rejection outside configured origins and roles.

### P1-16 — Schema management is not production-safe

- **File / location:** `backend/src/main/resources/application-dev.yml:9`; `application-docker.yml:8`; `backend/pom.xml`.
- **Problem:** both development and Docker profiles use Hibernate `ddl-auto: update`; no migration tool or versioned schema is present.
- **Why it matters:** schema changes are implicit, difficult to review/rollback, and can diverge between H2 and PostgreSQL.
- **Recommended fix:** introduce versioned migrations, validate schemas in CI, and use `validate` in deployed profiles.
- **Validation method:** apply migrations to empty and existing PostgreSQL databases, run backend startup with schema validation, and test rollback/upgrade paths.

### P1-17 — Production-impact analysis is a mutating endpoint without explicit role enforcement

- **File / location:** `backend/src/main/java/com/forgesense/impact/web/ImpactController.java:44-45`.
- **Problem:** `POST /api/v1/impact/analyze` writes impact analysis but has no method-level authorization annotation, unlike simulation control endpoints.
- **Why it matters:** role semantics are inconsistent for an operation that creates operational records and can influence decisions.
- **Recommended fix:** classify the endpoint as read-only or command-like, validate input, and enforce the corresponding role and audit trail.
- **Validation method:** verify anonymous/operator/engineer/admin behavior in MockMvc and assert mutation/audit records only for authorized roles.

### P1-18 — Simulation reset broadcasts changes without applying a complete reset to authoritative state

- **File / location:** `backend/src/main/java/com/forgesense/simulation/ControlService.java:124-146`.
- **Problem:** reset/clear operations delete controls and emit events, but the reset path does not consistently persist twin state, status, connectivity, predictions, alerts, or impact records back to their authoritative stores.
- **Why it matters:** the UI can say a scenario was reset while the next poll reintroduces the previous degraded state or stale operational consequence.
- **Recommended fix:** define reset scope and transaction boundaries; reset only simulation overlays while preserving observed history, and return the authoritative post-reset snapshot.
- **Validation method:** run a scenario, reset, restart the backend, and assert observed telemetry/history is preserved while simulation controls/overlays are cleared.

### P1-19 — Frontend refresh logic can leave values stale and treats partial failure as total failure

- **File / location:** `frontend/js/state.js:65-123`, `156-157`; `frontend/js/views/fleet.js:29`, `predictions.js:20`, `alerts.js:22`.
- **Problem:** refresh uses broad `Promise.all`; one failed resource prevents a coherent partial update. Several view render keys use array/object coercion or lengths, so risk/status/value changes with the same row count do not rerender.
- **Why it matters:** operators can see stale risk, alert, and fleet values while the application appears loaded. Slow polls can also overlap because there is no in-flight guard.
- **Recommended fix:** maintain per-resource freshness/error state, use stable value-based selectors, cancel or serialize polls, and render partial data with clear stale indicators.
- **Validation method:** delay/fail one API, mutate values without changing counts, and run overlapping polls; assert stale/partial states are explicit and values update.

### P1-20 — Two frontend architectures are shipped, one of them legacy and disconnected

- **File / location:** `frontend/index.html` loads `frontend/js/app.js`; root `frontend/app.js` is a separate legacy application with different IDs/API flow/Three.js behavior.
- **Problem:** the repository contains an active modular SPA and an older standalone dashboard implementation. Both are shipped assets, but only one is documented as active.
- **Why it matters:** fixes, tests, visual QA, and interview reviewers can target the wrong runtime; dead code also preserves contradictory state and transport assumptions.
- **Recommended fix:** declare one entrypoint, remove or archive the other through a deliberate migration decision, and add a build/test check that the deployed entrypoint is the tested one.
- **Validation method:** build/serve the exact deployment artifact and confirm only the selected entrypoint is reachable and covered by tests.

### P1-21 — Analytics frontend and backend disagree on fleet-health units

- **File / location:** backend `AnalyticsService.java:69-74`; `frontend/js/views/analytics.js:33-45`; `frontend/js/app.js` system KPI formatting.
- **Problem:** backend health is a 0–100 score, while the frontend multiplies `averageFleetHealth` by 100 or formats it as a fractional percentage in different locations.
- **Why it matters:** the dashboard can render values such as 9600% or inconsistent percentages, making operational impact and fleet ranking misleading.
- **Recommended fix:** make the API contract explicit (`score0To100` or `fraction0To1`) and use one formatter with unit tests.
- **Validation method:** fixture-test 0, 50, and 100 values across Analytics, Command Center, System, and inspector views.

### P1-22 — Maintenance lifecycle does not match the requested operational workflow

- **File / location:** backend maintenance domain/service/controller; `frontend/js/views/maintenance.js`.
- **Problem:** current statuses are `RECOMMENDED`, `SCHEDULED`, `ACTIVE`, `COMPLETED`, and `CANCELLED`, while the target workflow requires explicit `DETECTED → INVESTIGATING → SCHEDULED → MAINTENANCE → RECOVERING → VALIDATING → RESOLVED` semantics.
- **Why it matters:** a maintenance recommendation cannot be traced cleanly from detection through recovery and validation, so the platform does not yet close the operational loop.
- **Recommended fix:** model the requested workflow explicitly, including legal transitions, actor/role, timestamps, evidence, and relation to alert/prediction state.
- **Validation method:** integration-test every legal and illegal transition and verify the same machine selection/status across Maintenance, Alerts, Inspector, and Impact.

### P1-23 — CI omits integrated browser, Docker, simulator, and contract coverage

- **File / location:** `.github/workflows/ci.yml:1-69`; `frontend/package.json`; `frontend/test/util.test.mjs`.
- **Problem:** CI runs Maven package, ML pytest, frontend syntax checks, and a small pure utility test. It does not run a browser smoke/E2E suite, Docker build/compose startup, simulator integration, API contract tests across services, or frontend route/state tests.
- **Why it matters:** the real-browser P0 router failure passed every current CI job, showing that the existing gate does not validate the primary product.
- **Recommended fix:** add staged browser smoke and integration jobs after the architecture is stabilized; include service health, selection synchronization, alert lifecycle, simulation, and error-state coverage.
- **Validation method:** make CI fail on the observed router exception, a 404/401/500 network response, console errors, or broken M-104 cross-view selection.

## P2 findings

### P2-01 — Telemetry validation lacks complete numeric and ordering guards

- **File / location:** `TelemetryValidator.java`, `TelemetryNormalizer.java:23-46`, `TelemetryRecord` indexes.
- **Problem:** validation uses broad hardcoded ranges and clamping, but does not clearly reject NaN/Infinity, future jitter, per-profile limits, duplicate sequence numbers, or out-of-order data. Clamping can conceal invalid input.
- **Why it matters:** malformed or physically impossible data can look canonical and contaminate predictions.
- **Recommended fix:** reject non-finite values, validate against profile units/ranges, separate normalization from rejection, and record the reason.
- **Validation method:** unit and integration tests for non-finite, future, boundary, duplicate, out-of-order, and profile-specific values.

### P2-02 — Batch ingest silently drops invalid records

- **File / location:** `TelemetryIngestController.java:63-74`.
- **Problem:** batch ingestion increments `accepted` only for valid items and returns aggregate counts without per-item error reasons or a durable rejection record.
- **Why it matters:** producers cannot reconcile which samples were dropped, and operators cannot distinguish invalid data from pipeline failure.
- **Recommended fix:** return item-level status/correlation IDs, expose rejection metrics, and define partial-batch transaction semantics.
- **Validation method:** submit mixed valid/invalid batches and assert stable per-item results and metrics.

### P2-03 — Three.js scene cleanup and interaction coverage are incomplete

- **File / location:** `frontend/js/twin3d.js:182-188`, `274-288`, `448-451`; `router.js:104-114`; `app.js:313-323`.
- **Problem:** dependency rebuilds are keyed only by array length; removed geometries/materials are not comprehensively disposed; the render loop continues scheduling frames; router emits `zone-focus` and `scene-dblclick` events without a complete app handler path.
- **Why it matters:** long sessions can leak GPU resources, and required focus/double-click/dependency interactions can appear implemented while doing nothing.
- **Recommended fix:** dispose removed resources, use stable dependency hashes, pause rendering when hidden, and add tested hover/focus/double-click behavior.
- **Validation method:** repeatedly enter/leave Twin, mutate dependencies with equal lengths, use keyboard/mouse interactions, and inspect console/GPU behavior.

### P2-04 — Responsive navigation relies on missing labels at the small-screen breakpoint

- **File / location:** `frontend/style.css:541`; navigation buttons in `frontend/index.html`.
- **Problem:** the responsive CSS renders compact labels via `attr(data-label)`, but the rail buttons do not provide `data-label` attributes.
- **Why it matters:** at tablet/small widths the rail can become iconless or unlabeled, making navigation inaccessible and difficult to discover.
- **Recommended fix:** add accessible labels/tooltips or preserve visible text with an explicit compact navigation component.
- **Validation method:** test desktop, tablet, and small viewport screenshots with keyboard navigation and screen-reader names.

### P2-05 — Frontend authentication/session handling is not production-grade

- **File / location:** `frontend/js/api.js`; legacy `frontend/app.js`; login boot flow.
- **Problem:** the active token is in memory without expiry/refresh handling, while the legacy app stores a password in local storage. Initial login attempts are coupled to demo credentials and backend availability.
- **Why it matters:** sessions can become stale or silently unauthenticated, and the legacy path creates unnecessary credential exposure risk.
- **Recommended fix:** remove legacy credential storage, use an explicit session lifecycle, handle expiry/logout, and keep demo credentials isolated to a demo profile.
- **Validation method:** expire a token, restart the backend, and verify clean logout/re-authentication without password persistence.

### P2-06 — Frontend dependencies are loaded from a CDN import map without a reproducible frontend build

- **File / location:** `frontend/index.html:122-128`; `frontend/package.json`.
- **Problem:** Three.js is loaded from a runtime CDN URL, while the frontend has no dependency lockfile, build step, bundling, or asset integrity strategy.
- **Why it matters:** offline/demo environments and CI can render a different dependency or fail before the application logic runs.
- **Recommended fix:** retain the vanilla architecture if justified, but pin and package runtime assets or introduce a minimal reproducible build with explicit rationale.
- **Validation method:** build in a network-isolated environment and compare dependency hashes.

### P2-07 — Prediction response omits model metadata needed for truthful presentation

- **File / location:** `ml-service/app/schemas.py:40-56`; `main.py:139-147`; backend `Assessment`/`Prediction`.
- **Problem:** the response contains one failure model version and factors, but not the anomaly model version, calibration status, feature schema/profile hash, prediction basis timestamp, or RUL unit/interval metadata.
- **Why it matters:** frontend labels such as model version, confidence, and RUL cannot be audited from the response that produced them.
- **Recommended fix:** version the complete assessment contract and carry provenance through backend storage and UI.
- **Validation method:** snapshot-test `/health` and `/assess` metadata and verify the inspector shows model basis and uncertainty.

### P2-08 — WebSocket connection count may double-count sessions

- **File / location:** `backend/src/main/java/com/forgesense/websocket/WebSocketConnectionMonitor.java`.
- **Problem:** the monitor handles both connect-related event types without evidence that they represent distinct sessions, so one connection can increment twice.
- **Why it matters:** System observability can report incorrect connection counts and mask transport health.
- **Recommended fix:** count by session ID on connect/disconnect with idempotent transitions.
- **Validation method:** open and close one and multiple SockJS/STOMP sessions and compare actual sessions with the metric.

### P2-09 — Static browser load produces a favicon 404

- **File / location:** `frontend/index.html`; no `favicon.ico` asset.
- **Problem:** browser logs show `GET /favicon.ico 404` during the static smoke load.
- **Why it matters:** minor console noise undermines the “clean browser console” acceptance criterion.
- **Recommended fix:** add a small local favicon or remove the request deliberately.
- **Validation method:** reload the static page and assert no 404s in browser logs.

### P2-10 — Accessibility semantics are incomplete for a dense control-room UI

- **File / location:** `frontend/index.html`, `frontend/js/views/*`, command palette and inspector modules.
- **Problem:** the shell has useful semantic regions and a live alert container, but tabs, palette options, selected states, focus management, and drawer behavior are not consistently expressed with ARIA semantics or focus containment.
- **Why it matters:** keyboard and assistive-technology users cannot reliably navigate the same operational workflow.
- **Recommended fix:** implement roving tab/selected semantics, focus return, dialog/drawer labeling, and text-plus-color status communication.
- **Validation method:** keyboard-only route/selection/inspector tests and accessibility-tree assertions at each modal/drawer state.

## P3 findings

### P3-01 — Repository contains duplicate infrastructure locations

- **File / location:** `infra/` contains Prometheus/Grafana configuration; `infrastructure/` is present but empty.
- **Problem:** deployment ownership is ambiguous.
- **Why it matters:** contributors and reviewers can place operational configuration in the wrong directory.
- **Recommended fix:** choose one infrastructure root and document its ownership.
- **Validation method:** repository inventory check in CI and a deployment documentation link test.

### P3-02 — Documentation describes v2/current behavior while the committed baseline can be v1

- **File / location:** `README.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/SYSTEM_DESIGN.md`; `HEAD` versus worktree ML code.
- **Problem:** documentation references v2 artifacts and evaluation behavior that are not present in the committed `HEAD` baseline.
- **Why it matters:** setup and review instructions are not sufficient to reproduce the state being demonstrated.
- **Recommended fix:** update documentation only after the canonical model/evaluation implementation is committed, and include an explicit provenance table.
- **Validation method:** run every documented command from a clean clone and verify reported versions/hashes.

### P3-03 — There is no committed model card or limitations document

- **File / location:** `ml-service/` and `docs/`.
- **Problem:** model limitations are distributed across comments and README text; there is no single card describing target, data basis, split, calibration, known failure modes, and prohibited use.
- **Why it matters:** interview reviewers and operators cannot quickly distinguish synthetic demonstration behavior from validated industrial performance.
- **Recommended fix:** add a model card after Phase 2–3 evaluation is rebuilt.
- **Validation method:** documentation review against the assessment response and evaluation artifact.

### P3-04 — Operational data-basis and runtime-failure runbooks are missing

- **File / location:** `docs/DEPLOYMENT.md`, `docs/DATA_FLOW.md`, `docs/SYSTEM_DESIGN.md`.
- **Problem:** the repository describes the components but does not give a concise runbook for synthetic versus observed data, dependency failure modes, replay/DLQ behavior, and safe simulation reset.
- **Why it matters:** operators and reviewers cannot determine what remains trustworthy when one subsystem is down.
- **Recommended fix:** document state semantics, service-health evidence, fallback behavior, and recovery procedures after contracts are fixed.
- **Validation method:** perform a tabletop failure drill and update the runbook from observed behavior.

## Digital-twin and cross-layer consistency assessment

`config/machine_profiles.json` is a good intended source of truth: it defines eight machine IDs (M-101 through M-108), eight types, sensor profiles, zones, lines, and dependencies. The backend catalog loader and ML profile loader both consume it, and the seeder uses it for machine sensors. The source-of-truth claim is not yet complete because fallback baselines, default sensor sets, positions, frontend display metadata, and some simulator behavior are duplicated elsewhere. The catalog therefore needs a contract test before it can be treated as authoritative.

The state enum is broader than the current operational contract (`NORMAL`, `DEGRADED`, `WARNING`, `CRITICAL`, `MAINTENANCE`, `OFFLINE`, `RECOVERING` plus `ONLINE`), but monitor transitions currently bypass the validated persistence path. Alert lifecycle, prediction state, connectivity, and machine state can therefore disagree. This is the main backend foundation to address in Phase 1.

## What is working and should be preserved

- The repository clearly labels the simulator and production-impact values as synthetic, estimated, or simulation-only in several user-facing locations.
- The frontend footer explicitly states that ForgeSense does not control real machines.
- The backend has role checks for alert actions and simulation control endpoints, and the security integration tests exercise RBAC.
- The ML explanation module explicitly says its baseline perturbation method is not SHAP; that honesty should be retained while the contract is expanded.
- The shared catalog has all eight requested machine identities and a dependency graph suitable for a coherent selection model.
- The current dark industrial visual language, route taxonomy, command palette, inspector concept, and Three.js twin are viable foundations if the runtime and state contracts are repaired.

## Validation performed

| Check | Result | Notes |
|---|---|---|
| `backend\\mvnw.cmd clean test` | PASS | 47 tests, 0 failures/errors/skips |
| `backend\\mvnw.cmd package` | PASS | packaged Spring Boot jar; same 47 tests passed |
| ML `python -m pytest -q` | PASS | 6 tests; 2 dependency deprecation warnings |
| Frontend `node --check` modules | PASS | all active `js/` modules parsed |
| Frontend `node --test test/util.test.mjs` | PASS | 15 tests |
| Python `py_compile` for ML/simulator/frontend server | PASS | syntax-only validation |
| `docker compose config --quiet` | PASS | Compose configuration parses |
| Real browser static smoke | FAIL | frontend loads shell but logs P0-01; `main` remains empty; favicon 404 |
| Integrated browser/E2E | NOT RUN | backend, ML, and frontend ports were not running; no credentials entered |
| Docker image build / Compose startup | NOT RUN | requires a full dependency/runtime exercise; no source changes were made in Phase 0 |

## Phase 0 conclusion

The repository is not ready for a visual redesign phase. The first implementation phase must establish a trustworthy baseline for frontend boot, model provenance/RUL semantics, telemetry freshness and null handling, alert lifecycle, state persistence, service-status honesty, and security/deployment boundaries. The full finding register above is the acceptance backlog for that work.

No P0 issue was fixed during this audit. No Phase 1 work was started.
