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

Topics (see `docs/KAFKA.md`):

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

Backend `MlClient` (HTTP to FastAPI) with endpoints:

```
GET  /health
POST /predict/anomaly        { features }        → { anomalyScore, label, ... }
POST /predict/failure-risk   { features }        → { riskScore, probability, model}
POST /explain                { features }        → { factors: [{feature, contribution, direction}] }
```

On ML outage the backend falls back to a deterministic heuristic scorer
clearly labeled `HEURISTIC`, and the UI shows `MODEL: unavailable`.
See `docs/EXPLAINABILITY.md` and `docs/MACHINE_LEARNING.md`.

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
alert status, telemetry/prediction timestamps, event type. Schema in
`infrastructure/postgres/init.sql` (mirrors JPA `ddl-auto: validate`).
See `docs/DATABASE.md`.

## 10. WebSocket protocol

Endpoints `/ws/telemetry` (machine updates + telemetry), topics:

```
machine.updated | machine.state.changed | telemetry.updated
prediction.updated | anomaly.detected | alert.created | alert.updated
maintenance.created | simulation.updated | impact.updated
```

JSON envelopes mirror domain events; frontend subscribes by topic and
re-renders selective components. See `docs/WEBSOCKET.md`.

## 11. Security

Dev-mode form login with three roles (OPERATOR/ENGINEER/ADMIN) loaded from
config; optional JWT bearer accepted; CSRF disabled for API; actuator
`/metrics` restricted; environment-driven secrets (.env → env vars), no
hard-coded credentials. See `docs/SECURITY.md`.

## 12. Observability

Micrometer counters/histograms: `telemetry_events_total`,
`telemetry_processing_latency`, `ml_inference_latency`, `predictions_total`,
`anomalies_total`, `alerts_total`, `machines_online_gauge`,
`websocket_connections_gauge`, `kafka_consumer_lag`, `simulation_runs_total`.
Actuator health groups: `liveness`, `readiness`, `dependencies`
(db/redis/kafka/ml). See `docs/OBSERVABILITY.md`.

## 13. Failures & degradation (summary)

| Failure | Behavior | UI indication |
|---|---|---|
| Kafka down | in-process bus (dev) OR clear error + telemetry queued/alerted | `STREAMING: Kafka unavailable (fallback)` |
| Redis down | cache falls back to memory; PostgreSQL unaffected | `CACHE: fallback` |
| PostgreSQL down | health down; writes rejected; reads degraded | `DB: DOWN` + error states |
| ML down | heuristic scorer + `MODEL: unavailable` badge | explanation uses heuristic |
| WebSocket down | reconnect loop; REST fallback for initial fetch | `LIVE` → `RECONNECTING` |
| Machine offline | telemetry stops; state → OFFLINE; alerts generated | status color + stale label |

## 14. Environment & configuration

- Profiles: `dev` (H2/mem/bus), `docker` (PG/Redis/Kafka).
- `.env` consumed by compose; Spring maps via `${VAR}` placeholders in
  `application.yml`. `.env.example` documents every variable.
- ML URL, demo mode, security toggle, thresholds all configurable.

## 15. Testing strategy

- Backend: JUnit + Spring Boot Test; state machine, decision rules, impact
  engine, alert lifecycle, maintenance, simulation unit tests; slice tests with
  H2; Testcontainers (PostgreSQL/Redis) in `docker` profile CI job.
- ML: pytest — preprocessing, model artifact load, inference determinism,
  explanation sanity.
- Simulator: pytest — distribution sanity, scenario switching, determinism.
- Frontend: Vitest + Testing Library — components, hooks, WS reducer.
- E2E: Playwright — full telemetry→alert→simulation→maintenance→recovery flow.
- See `docs/TESTING.md`.