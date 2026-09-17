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
├── telemetry     Ingestion REST, validation, normalization, TelemetryService
├── streaming     Kafka config, producers, consumers, in-process bus adapter
├── prediction    ML client, Prediction model, RiskService
├── anomaly       Anomaly detection pipeline + persistence
├── alert         Alert lifecycle (NEW/ACKNOWLEDGED/INVESTIGATING/RESOLVED)
├── maintenance   MaintenanceRecord workflow + recommendations
├── simulation    Scenario types, SimulationEngine, scenario control
├── impact        Dependency traversal, ProductionImpact estimation
├── analytics     Aggregation queries, KPI + analytic endpoints
├── websocket     WebSocket registry + outbound events
├── security      Auth (dev + JWT), roles, auth principles
└── observability Micrometer metrics, health indicators, tracing ids
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

State derivation from signals (telemetry + ML):
- anomaly/risk/time-series heuristic → *intent* (`DEGRADED`, `WARNING`,
  `CRITICAL`), which the state machine validates.

## 3. Digital twin

`MachineTwin` is an in-memory + persisted view:

```
identity, physicalType, latestTelemetry, healthScore, failureRisk,
anomalyScore, rulEstimate (labeled heuristic), status, maintenanceStatus,
dependencies, recentEvents[10], connectivity, lastTelemetryAt, modelVersion
```

Flow: normalized telemetry → `TwinService.update(machineId, sample)` →
recompute indicators → state-machine intent → apply transition → write
`forge.machine.state` event → publish WebSocket `machine.updated` /
`machine.state.changed`.

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

Transport adapter: `EventBus` interface has `KafkaEventBus` (spring-kafka) and
`InMemoryEventBus` (dev). Producers/consumers depend only on the interface.
Envelope fields: eventId, eventType, machineId, timestamp, sequence,
correlationId, source, schemaVersion, payload.

Idempotency: consumers track processed `eventId`s in a small recent-set and
deduplicate; timestamps are validated for staleness; ordering per machine
key maintained.

## 5. ML integration

Backend `MlClient` (HTTP to FastAPI) with routes:

```
GET  /health                        → { model versions, evaluation, status }
POST /assess   { features, ... }    → { anomalyScore, riskScore, rulEstimate,
                                        factors: [{feature, contribution, direction}] }
```

The factor attribution is a replace-with-baseline perturbation method inside
the ML service (`ml-service/app/explanation.py`) — it is deliberately **not**
SHAP or any external explainability library.

On ML outage the backend falls back to a deterministic heuristic scorer
clearly labeled `HEURISTIC`, and the UI shows `MODEL: unavailable`.

## 6. Decision engine

Configurable rules (`application-*.yml` → `DecisionRule` entity), e.g.:

```
if failureRisk >= 0.8 and anomalyLabel in (HIGH) and criticality >= HIGH
   → create CRITICAL alert; compute impact; recommend inspection
if failureRisk >= 0.5 and anomalyLabel in (MEDIUM)
   → create WARNING alert
```

Rules trigger: alert creation, impact computation, maintenance recommendation,
websocket broadcast.

## 7. Production impact engine

Inputs: failure machine, dependency graph (directed edges with per-edge
`propagationDelayMinutes`, `propagationFactor`), machine throughput
(units/period), line membership.

Algorithm: BFS over downstream dependencies applying per-edge factor to downtime
and throughput; aggregate to line/zone; produce `ProductionImpact` with explicit
assumptions (`ESTIMATED`, `ASSUMED`). Never presented as hard fact.

## 8. What-if simulation

`SimulationScenario` types: `FAILURE, OVERHEATING, BEARING_DEGRADATION,
VIBRATION_SPIKE, OFFLINE, SENSOR_FAILURE, LOAD_INCREASE, MAINTENANCE_DELAY`.

Engine: clone dependency graph and run impact estimation under scenario’s
perturbation applied to the affected machine; produce Baseline vs Scenario
comparison (downtime, throughput, affected line count, production loss units).
Stored + versioned; a `forge.simulation.commands` event is emitted.

## 9. Persistence

PostgreSQL (dev: H2 PG-mode). Key indexes on `machine_id`, `timestamp`,
alert status, telemetry/prediction timestamps, event type. The docker profile
uses JPA `ddl-auto: update`; there is no checked-in SQL schema.

## 10. WebSocket protocol

Endpoints `/ws/telemetry` (machine updates + telemetry), topics:

```
machine.updated | machine.state.changed | telemetry.updated
prediction.updated | anomaly.detected | alert.created | alert.updated
maintenance.created | simulation.updated | impact.updated
```

JSON envelopes mirror domain events; the server exposes these topics for any
subscriber, but the current dashboard does **not** open a WebSocket — it polls
the REST API every 3 s and WebSocket remains server-side capability.

## 11. Security

Dev-mode login with three roles (OPERATOR/ENGINEER/ADMIN) loaded from
config; JWT bearer authentication (BCrypt password hashing, configurable
expiry); CSRF disabled for the stateless API; actuator endpoints restricted;
environment-driven secrets (.env → env vars), no hard-coded credentials
unless `FORGESENSE_DEV_PASSWORD` is unset.

## 12. Observability

Micrometer counters/histograms/gauge (`ForgeMetrics`): `forgesense.telemetry.received.total`,
`forgesense.telemetry.dropped.total`, `forgesense.telemetry.processing.latency`,
`forgesense.ml.inference.latency`, `forgesense.predictions.total`,
`forgesense.alerts.total`, `forgesense.machines.online`,
`forgesense.websocket.connections`, `forgesense.simulation.runs.total`,
`forgesense.events.total`, `forgesense.maintenance.total`.
Actuator health groups: `liveness`, `readiness`, `dependencies`
(db/redis/kafka/ml). Prometheus scrapes only the backend `/actuator/prometheus`; Grafana
visualizes it.

## 13. Failures & degradation (summary)

| Failure | Behavior | UI indication |
|---|---|---|
| Kafka down | in-process bus (dev) OR clear error + telemetry queued/alerted | `STREAMING: Kafka unavailable (fallback)` |
| Redis down | cache falls back to memory; PostgreSQL unaffected | `CACHE: fallback` |
| PostgreSQL down | health down; writes rejected; reads degraded | `DB: DOWN` + error states |
| ML down | heuristic scorer + `MODEL: unavailable` badge | explanation uses heuristic |
| WebSocket down | dashboard unaffected — it polls REST and never opens a socket | n/a |
| Machine offline | telemetry stops; state → OFFLINE; alerts generated | status color + stale label |

## 14. Environment & configuration

- Profiles: `dev` (H2/mem/bus), `docker` (PG/Redis/Kafka).
- `.env` consumed by compose; Spring maps via `${VAR}` placeholders in
  `application.yml`. `.env.example` documents every variable.
- ML URL, demo mode, security toggle, thresholds all configurable.

## 15. Testing strategy

- Backend: JUnit + Spring Boot Test — state machine, telemetry validation,
  twin, decision rules, alert lifecycle, and an end-to-end RBAC integration
  suite (`MockMvc`) run by CI via `./mvnw package`.
- ML: pytest — API endpoints against the trained v2 artefacts, retrain-hash
  stability, evaluation metrics.
- Simulator: exercised end-to-end via docker compose (`--degrade`, `--bare`,
  `--omit`); no dedicated test suite at present.
- Frontend: no test suite; CI runs a syntax check (`node --check app.js`).