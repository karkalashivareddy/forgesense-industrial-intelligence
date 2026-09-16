# ForgeSense — System Design

This document explains the concrete design of the platform. It complements
`ARCHITECTURE.md` (structure) and `DATA_FLOW.md` (dynamics).

## 1. Modules

Package layout (Spring Boot, `com.forgesense`):

```
com.forgesense
├── common        Config, domain events, ids, errors, abstract infra adapters
├── factory       Factory + Zone + ProductionLine domain
├── machine       Machine, MachineDependency, MachineStateMachine, Twin
├── telemetry     Ingestion REST, validation, normalization, pipeline
├── streaming     Kafka config, event bus + in-process bus adapter
├── prediction    ML client (HTTP + heuristic fallback), DecisionEngine, gateway
├── alert         Alert lifecycle (NEW/ACKNOWLEDGED/INVESTIGATING/RESOLVED)
├── maintenance   MaintenanceRecord workflow + recommendations
├── simulation    Scenario types, scenario control + engine
├── impact        Dependency traversal, ProductionImpact estimation
├── analytics     Aggregation queries, KPI + analytic endpoints
├── events        Operational event timeline + persistence
├── websocket     WebSocket registry + outbound events
├── security      Auth (dev + JWT), roles, auth filter chain
└── observability Micrometer metrics, health indicators
```

## 2. Machine state machine

States: `NORMAL, DEGRADED, WARNING, CRITICAL, MAINTENANCE, OFFLINE, RECOVERING`.

Allowed transitions (enforced by `MachineStateMachine`):

```
NORMAL → DEGRADED | MAINTENANCE | OFFLINE
DEGRADED → NORMAL | WARNING | MAINTENANCE | OFFLINE
WARNING → DEGRADED | CRITICAL | MAINTENANCE | OFFLINE
CRITICAL → WARNING | MAINTENANCE | OFFLINE | RECOVERING
MAINTENANCE → RECOVERING
RECOVERING → NORMAL | MAINTENANCE
OFFLINE → RECOVERING
```

The state machine is authoritative. If telemetry suggests `CRITICAL`, the
transition is validated against the current state before being applied, and
`MACHINE_STATE_CHANGED` events are emitted only for accepted transitions.
`OFFLINE → NORMAL` is intentionally rejected; the machine must pass through
`RECOVERING`.

State derivation from signals (telemetry + ML): anomaly/risk thresholds →
*intent* (`DEGRADED`, `WARNING`, `CRITICAL`), which the state machine validates.

## 3. Digital twin

`MachineTwin` is an in-memory synchronized state view:

```
identity, physicalType, latestTelemetry, healthScore, failureRisk,
anomalyScore, rulEstimate (labeled heuristic, not calibrated RUL), status,
maintenanceStatus, dependencies, recentEvents, connectivity,
lastTelemetryAt, modelVersion
```

Flow: normalized telemetry → `TwinService.applyTelemetry` → recompute
indicators → state-machine intent → apply transition → write
`forge.machine.state` event → WebSocket broadcast.

Connectivity is monitored independently by `ConnectivityMonitor`: after
`forgesense.machine.offline-after-seconds` (default 30) without data the twin
moves to `STALE → OFFLINE`, then `RECOVERING` when data resumes.

## 4. Event streaming (Kafka)

Topics:

```
forge.telemetry.raw
forge.telemetry.normalized
forge.machine.state
forge.ml.predictions
forge.anomalies
forge.alerts
forge.maintenance
forge.simulation.commands
```

Transport adapter: the `EventBus` interface has `KafkaEventBus`
(spring-kafka, docker profile) and `InMemoryEventBus` (dev profile).
Runtime components depend only on the interface. `EventRoutes` maps event
types to topic names. Envelope fields: eventId, eventType, machineId,
timestamp, sequence, source, payload.

Monotonicity/dedup design notes: the pipeline relies on validation (staleness
window, physical bounds) rather than a distributed idempotency store; this is
acceptable for the single-node demo topology.

## 5. ML integration

Backend `MlClient` (HTTP to FastAPI) exposes:

```
GET  /health                  → service + model availability
POST /assess                  → { anomalyLabel, anomalyScore, failureRisk,
                                  rulEstimate (heuristic), factors, recommendations, ... }
```

The ML service trains an `IsolationForest` anomaly model and a
`GradientBoosting` failure-risk model over synthetic data derived from the
machine profile catalog (deterministic seed). Feature attribution uses a
replace-with-baseline method. **This is not SHAP; the code and UI explicitly
label it so.**

On ML outage the backend falls back to a deterministic heuristic scorer
`HeuristicMlClient` clearly labeled `HEURISTIC`. `MlGateway` probes ML every
15 seconds, records the active mode, and reports it through the health
indicator and the `MODEL: available/unavailable` badge in the UI.

The docs do not claim production model accuracy; ML artifacts are project
artifacts trained on synthetic profiles.

## 6. Decision engine

`DecisionEngine.evaluate` maps model signals to operational state:

```
if risk >= 0.80 or anomaly >= 0.70 → intent CRITICAL
if risk >= 0.50 or anomaly >= 0.45 → intent WARNING
if risk >= 0.30 or anomaly >= 0.25 → intent DEGRADED
else                               → intent NORMAL
```

On elevated signals it creates alerts via `AlertService.ensureAlert`
(CRITICAL for risk ≥ 0.8 or anomaly ≥ 0.7, WARNING otherwise) and, when risk
≥ 0.7, triggers a maintenance recommendation. No alerts are raised while a
machine is in MAINTENANCE.

## 7. Production impact engine

Inputs: failure machine, dependency graph (directed edges with per-edge
`propagationDelayMinutes`, `propagationFactor`), machine throughput
(units/period), line membership.

Behavior: dependency traversal applies per-edge factors to estimate affected
machines, downtime, and production loss; results are labeled `ESTIMATED` and
never presented as hard production facts.

## 8. What-if simulation

`SimulationScenario` types: `FAILURE, OVERHEATING, BEARING_DEGRADATION,
VIBRATION_SPIKE, OFFLINE, SENSOR_FAILURE, LOAD_INCREASE, MAINTENANCE_DELAY`.

Control service records simulation controls in `SimulationControl`, and the
simulator reads them to adjust behavior. Scenario runs are exposed through
the simulation REST surface.

## 9. Persistence

PostgreSQL (dev: H2 PG-mode). JPA entities under
`backend/src/main/java/com/forgesense/**/domain`, repositories per aggregate.
`application-docker.yml` selects the Postgres adapter, `application-dev.yml`
the H2 adapter. No external `init.sql` is shipped; schema is created from the
entities in dev and managed via JPA in the Compose profile.

## 10. WebSocket protocol

Endpoints `/ws` and `/ws/telemetry` (STOMP/SockJS) with a simple in-memory
broker under `/topic`. Topics include `machine.updated`,
`machine.state.changed`, `telemetry.updated`, `prediction.updated`,
`alert.created`, `alert.updated`, `maintenance.created`, `impact.updated`,
`events.updated`.

The backend broadcasts on domain events. **The current static frontend polls
REST every 3 seconds and does not subscribe to WebSocket topics** — the socket
surface is implemented and testable server-side, and client-side subscription
is a planned enhancement.

## 11. Security

- Dev login (`/api/v1/auth/login`) issues JWT bearer tokens; three roles
  (OPERATOR/ENGINEER/ADMIN).
- `JwtService` enforces a ≥32-character `FORGESENSE_JWT_SECRET` when security
  is enabled; dev/discovery profiles may run with a transient signing key.
- `ForgeUserDetailsService` fails fast if `FORGESENSE_DEV_PASSWORD` is unset
  while security is enabled.
- CSRF disabled for the JSON API; Actuator health/probes exposed to
  `health,info,metrics,prometheus` only.
- All secrets come from environment variables; `.env` is gitignored and
  `.env.example` documents every variable.

## 12. Observability

Micrometer counters/gauges/timer registered in `ForgeMetrics`:
`forgesense.telemetry.received.total`, `.dropped.total`, `.predictions.total`,
`.anomalies.total` (critical-alert events), `.alerts.total` + per-type alerts,
`.maintenance.total`, `.simulation.runs.total`, `.events.total`,
`forgesense.telemetry.processing.latency`, `forgesense.machines.online`,
`forgesense.websocket.connections`.

Actuator health groups: `liveness`, `readiness` (includes `db`, `mlService`).
Prometheus scrape target reachable at `/actuator/prometheus`.

## 13. Failures & degradation (summary)

| Failure | Behavior | UI indication |
|---|---|---|
| Kafka down | in-process bus (dev) OR publish error (docker) logged | `STREAMING` fallback messaging |
| Redis down | cache falls back to memory; PostgreSQL unaffected | `CACHE: fallback` |
| PostgreSQL down | health down; writes rejected; reads degraded | error states |
| ML down | heuristic scorer selected + `MODEL: unavailable` badge | explanation uses heuristic |
| WebSocket down | REST polling continues; server-side broadcasts no-op | `LIVE` reflects REST data |
| Machine offline | telemetry stops; state → OFFLINE; alerts generated | status color + stale label |

## 14. Environment & configuration

- Profiles: `dev` (H2/in-memory/bus), `docker` (Postgres/Redis/Kafka).
- `.env` consumed by compose; Spring maps via `${VAR}` placeholders in
  `application.yml`. `.env.example` documents every variable.
- ML URL, demo mode, security toggle, staleness windows, offline threshold,
  prediction throttle — all configurable.

## 15. Testing strategy (current)

- Backend: JUnit + Mockito unit tests for `MachineStateMachine`,
  `DecisionEngine`, `AlertService` (22 tests; run in CI via `./mvnw package`).
- ML: pytest tests for health, `/assess` normal and degraded inputs,
  deterministic training (4 tests; run in CI).
- Frontend: `node --check` for all modules + `node:test` unit tests
  (`test/util.test.mjs`, 15 tests; run in CI).
- Testcontainers, Vitest/Testing Library, and Playwright E2E are **not**
  currently implemented; they are candidate next steps.

The CI workflow is at `.github/workflows/ci.yml`.