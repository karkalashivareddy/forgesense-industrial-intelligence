# API ↔ Frontend Contract

**Authority:** the running Spring Boot backend. Every type in
`frontend/src/api/types.ts` was written from a **captured live response** or
read from the Java enum that defines it. Nothing here is inferred from prose.

Base URL is configured by `VITE_API_BASE_URL` (see `frontend/.env.example`).
All endpoints below are relative to that origin.

---

## Authentication

### `POST /api/v1/auth/login` — anonymous

Request

```json
{ "username": "admin", "password": "<password>" }
```

Response `200`

```json
{
  "accessToken": "<jwt>",
  "username": "admin",
  "roles": ["ROLE_OPERATOR", "ROLE_ENGINEER", "ROLE_ADMIN"]
}
```

Notes
- The password is sent once, in the body, and is never stored by the client.
- A `401` from **any** subsequent request raises `SessionExpiredError`, which
  clears the tab-scoped session and re-opens the sign-in gate.
- There is no refresh token and no silent re-login: identity is re-confirmed.

---

## Machines

### `GET /api/v1/machines` — all authenticated roles

Returns `Machine[]`. Canonical row, as observed:

```json
{
  "machineId": "M-101",
  "name": "CNC Mill A",
  "type": "CNC_MILL",
  "typeLabel": "CNC Mill",
  "zone": "MACHINING",
  "line": "LINE-A",
  "status": "NORMAL",
  "connectivity": "ONLINE",
  "criticality": "CRITICAL",
  "healthScore": 99.6,
  "failureRisk": 0.0006,
  "anomalyScore": 0.0103,
  "anomalyLabel": "NORMAL",
  "rulEstimate": 60.0,
  "rulUnit": "steps",
  "modelVersion": "failure-risk-v2",
  "modelMode": "MODEL",
  "lastTelemetryAt": "2026-09-29T04:22:45Z"
}
```

**Unit contract**
| Field | Unit | Range | Basis |
| --- | --- | --- | --- |
| `healthScore` | points, 0–100 | 0–100 | model output |
| `failureRisk` | probability, 0–1 | 0–1 | model output |
| `anomalyScore` | probability, 0–1 | 0–1 | model output |
| `rulEstimate` | **simulator degradation steps** | ≥ 0 | model output over a synthetic feed |
| `lastTelemetryAt` | ISO-8601 UTC, nullable | — | observation time |

> `rulUnit` is `steps` and only `steps`. The client has no hours/days formatter
> anywhere; `formatRulSteps()` is the single RUL entry point and a unit test
> asserts the output cannot contain a time unit.

**Enums** (from `machine/domain/MachineState.java`, `Criticality.java`)
`status`: `ONLINE | NORMAL | DEGRADED | WARNING | CRITICAL | MAINTENANCE | OFFLINE | RECOVERING`
`connectivity`: `ONLINE | OFFLINE`
`criticality`: `LOW | MEDIUM | HIGH | CRITICAL`
`anomalyLabel`: `NORMAL | WATCH | ANOMALY`
`modelMode`: `MODEL | HEURISTIC` — `HEURISTIC` means the ML service was
unreachable and the backend used its documented fallback.

**Timestamp semantics** — `lastTelemetryAt` is when the sample was *produced*,
not when the backend received it. The client computes staleness from it.

### `GET /api/v1/machines/{machineId}`

`MachineDetail` — a superset adding `description`, `sensors[]`,
`operatingHours`, `throughputPerHour`, `maintenanceStatus`, `lastMaintenance`,
`nextMaintenance`, `position {x,y,z}`.

### `POST /api/v1/machines/{machineId}/state` — `ENGINEER | ADMIN`

Drives the validated backend state machine. Not exposed as a free-form control
in the console; the maintenance workflow is the intended path into it.

---

## Telemetry

### `GET /api/v1/machines/{machineId}/telemetry?limit=N`

```json
{
  "machineId": "M-101",
  "basis": "OBSERVED",
  "rows": [
    {
      "timestamp": "2026-09-29T04:27:47Z",
      "sequence": 4775,
      "temperature": 54.6,
      "vibration": 0.8,
      "rpm": 2337.9,
      "torque": 39.7,
      "current": 17.2,
      "voltage": 479.7,
      "power": 8.9,
      "frequency": 59.9,
      "airTemperature": 22.32,
      "operatingHours": 12450.53
    }
  ]
}
```

Sensor keys and units come from `machine/domain/SensorType.java`:

| Key | Unit |
| --- | --- |
| `temperature` | °C |
| `vibration` | mm/s |
| `pressure` | bar |
| `rpm` | rpm |
| `torque` | Nm |
| `current` | A |
| `voltage` | V |
| `power` | kW |
| `flow` | L/min |
| `frequency` | Hz |

Only the sensors a machine type actually carries are populated. The client
derives its sensor list from the data, so an absent sensor renders as `—`
rather than a fabricated zero. **The console asserts no normal range** for any
sensor: the profile is a modelled baseline, not a surveyed specification.

### `GET /api/v1/telemetry/status`

```json
{
  "dataBasis": "SYNTHETIC",
  "inputTransport": "KAFKA",
  "transport": "KAFKA",
  "source": "kafka:forge.telemetry.raw",
  "pollIntervalSeconds": 3,
  "telemetryPerMinute": 198,
  "streaming": true
}
```

`inputTransport` / `transport` describe how telemetry **enters the backend**.
How the *browser* receives updates is `system/status.transport`.

### `POST /api/v1/telemetry/ingest`, `/ingest/batch`

Write path for the simulator. Returns `{ accepted, machineId, sequence,
normalized }` or `{ received, accepted }`. Rejected samples return `400` and
never enter the pipeline.

---

## Predictions

### `GET /api/v1/machines/{machineId}/predictions` — `Prediction[]`

```json
{
  "id": "df14be00-…",
  "machineId": "M-101",
  "timestamp": "2026-09-29T04:27:47.758432Z",
  "failureRisk": 0.0006,
  "anomalyScore": 0.0257,
  "anomalyLabel": "NORMAL",
  "healthScore": 99.2,
  "modelVersion": "failure-risk-v2",
  "mode": "MODEL",
  "factors": [
    { "feature": "RPM", "contribution": -0.0069, "label": "NEUTRAL", "direction": "down" }
  ]
}
```

### `GET /api/v1/machines/{machineId}/explanation`

The single latest assessment — same factor shape, no history.

**Factor semantics — the most important contract in this document.**

| Field | Meaning |
| --- | --- |
| `feature` | Human label of the sensor, e.g. `Vibration`, `Ambient temperature` |
| `contribution` | **Signed change in model output probability** when this feature is replaced with its training-set average. **Unitless. Not a percentage.** |
| `label` | `ELEVATED` \| `REDUCED` \| `NEUTRAL` — thresholded on \|contribution\| > 0.05 |
| `direction` | `up` \| `down` \| `flat` |

Method: **local baseline perturbation** (`ml-service/app/explanation.py`), one
model evaluation per active feature, O(F). It is first-order and local; it does
not capture feature interactions. **It is not SHAP and must never be called
SHAP** — no SHAP library or axiom is involved. The console states this on every
attribution panel.

---

## Alerts

### `GET /api/v1/alerts?status=&limit=`

```json
{
  "total": 36,
  "statusFilter": "ALL",
  "items": [
    {
      "id": "f07dba27-…",
      "machineId": "M-102",
      "machineName": "Packaging Motor",
      "severity": "CRITICAL",
      "status": "NEW",
      "type": "FAILURE_RISK",
      "source": "M-102",
      "headline": "Failure risk threshold crossed for M-102",
      "description": "…",
      "recommendedAction": "…",
      "factorsSummary": "Frequency:-2% Ambient temperature:-1% …",
      "riskAtCreation": 0.0006,
      "openedAt": "2026-09-19T04:49:41.815707Z",
      "updatedAt": "2026-09-29T04:15:37.233982Z"
    }
  ]
}
```

**Canonical lifecycle — the only values the client will ever send**

```
NEW ──acknowledge──▶ ACKNOWLEDGED ──investigate──▶ INVESTIGATING ──resolve──▶ RESOLVED
```

`severity`: `INFO | WARNING | CRITICAL`

| Transition | Endpoint | Role required |
| --- | --- | --- |
| acknowledge | `POST /api/v1/alerts/{id}/acknowledge` | `OPERATOR`, `ENGINEER`, `ADMIN` |
| investigate | `POST /api/v1/alerts/{id}/investigate` | `ENGINEER`, `ADMIN` |
| resolve | `POST /api/v1/alerts/{id}/resolve` | `ENGINEER`, `ADMIN` |

The UI hides or disables actions the role cannot perform
(`canActOnAlert()`), and the backend re-authorises every call independently.
`statusFilter` echoes the applied filter.

---

## Maintenance

### `GET /api/v1/maintenance?limit=`

`MaintenanceRecord[]`:

```json
{
  "id": "e9c63747-…",
  "machineId": "M-101",
  "title": "Recommended inspection - M-101",
  "description": "…",
  "reason": "PREDICTED_RISK_96",
  "priority": "URGENT",
  "status": "RECOMMENDED",
  "assignedRole": "ENGINEER",
  "recommendedAction": "CNC Mill - inspect drive assembly, bearings, vibration mounts.",
  "riskAtCreation": 0.963,
  "estimatedDurationMinutes": 60,
  "createdAt": "2026-09-19T14:42:50.811498Z",
  "scheduledAt": null,
  "startedAt": null,
  "completedAt": null
}
```

**Canonical lifecycle** (`maintenance/domain/MaintenanceStatus.java`) — the
console renders exactly this and nothing more:

```
RECOMMENDED ──schedule──▶ SCHEDULED ──start──▶ ACTIVE ──complete──▶ COMPLETED
                    └──cancel────────────────────────────────────────▶ CANCELLED
```

| Transition | Endpoint | Role |
| --- | --- | --- |
| schedule | `POST /api/v1/maintenance/{id}/schedule` | `ENGINEER`, `ADMIN` |
| start | `POST /api/v1/maintenance/{id}/start` | `ENGINEER`, `ADMIN` |
| complete | `POST /api/v1/maintenance/{id}/complete` | `ENGINEER`, `ADMIN` |
| cancel | `POST /api/v1/maintenance/{id}/cancel` | `ENGINEER`, `ADMIN` |

`priority`: `LOW | MEDIUM | HIGH | URGENT`.
`estimatedDurationMinutes` is a **model estimate of labour**, not a measurement.

---

## Analytics

| Endpoint | Returns | Basis |
| --- | --- | --- |
| `GET /analytics/overview` | fleet counters | `OBSERVED` counts + `ESTIMATED` modelled figures |
| `GET /analytics/risk-ranking` | `RiskRankingRow[]` | derived from live twin state |
| `GET /analytics/alerts` | alert lifecycle counts | `OBSERVED` |
| `GET /analytics/health-trends` | current health per machine | `OBSERVED` — a **snapshot, not a time series**, despite the name |
| `GET /analytics/maintenance` | work-order counts by status | `OBSERVED` |
| `GET /analytics/events` | cumulative event counts | `OBSERVED` |

Two fields in `/analytics/overview` are **modelled, not measured**, and are
labelled as such in the UI:

- `productionEfficiency` — `100 − (average fleet failure risk × 100)`. Carries
  its own `label` explaining this.
- `estimatedDowntimeRiskMinutes` — `assetsAtRisk × 30`. A planning figure.

> `/analytics/health-trends` returns only the *current* health per machine. The
> console renders it as a distribution, never as a trend line, because the
> backend does not provide history here.

---

## Events

### `GET /api/v1/events?machineId=&limit=`

```json
{ "count": 50, "items": [ { "id": 135633, "machineId": "M-118",
  "eventType": "PREDICTION_UPDATED", "eventTime": "2026-09-29T04:23:09.553534Z",
  "detail": "Prediction updated - risk 0%", "source": "ml-service" } ] }
```

`eventType` is drawn from the canonical vocabulary in
`common/domain/EventType.java` (17 types). `GET /events` returns the most
recent `limit` rows while `count` reflects the register total, so `count` can
exceed the number of rows returned.

---

## Factory, topology, impact

| Endpoint | Returns | Notes |
| --- | --- | --- |
| `GET /factories` | `Factory[]` | single seeded factory, `ALPHA-01` |
| `GET /factories/{code}` | `Factory` | |
| `GET /zones` | `Zone[]` | `code` (`MACHINING`) and `name` (`Machining`) |
| `GET /machines/dependencies/edge` | `DependencyEdge[]` | `relation`: `MATERIAL \| POWER \| COOLING \| SERVICE`; carries `propagationFactor` and `delayMinutes` |
| `GET /machines/{id}/dependencies` | `DependencyEdge[]` | per-asset |
| `GET /impact/{machineId}` | `{ latest, history }` | every row carries `dataLabel`, `assumptionsJson` and `simulated` |

**Production impact is always a modelled estimate.** Each record states its own
assumptions; the console renders `dataLabel` verbatim next to the numbers.

### Zone naming — verified inconsistency

`zone` is a **code** on `/machines` and a **name** on `/analytics/risk-ranking`.
`normaliseZoneCode()` in `frontend/src/api/adapters.ts` maps both to the code in
one place, so no view has to know about the difference.

---

## Simulation

| Endpoint | Returns | Notes |
| --- | --- | --- |
| `GET /simulation/scenarios` | `SimulationRun[]` | **history of recorded runs**, newest first. Empty on a fresh stack. Not a catalogue. |
| `POST /simulation/run` | `SimulationRun` | `ENGINEER`, `ADMIN`. Body: `{ machineId, scenarioType, severity, failureHorizonMinutes, name? }`. **What-if analysis only — changes nothing.** |
| `POST /simulation/control` | `SimulationControl` | `ENGINEER`, `ADMIN`. Body: `{ machineId, scenario, severity, parameters? }`. **This is the live injection path** — it changes what the simulator emits next. |
| `GET /simulation/control` | `SimulationControl[]` | active per-machine overrides |
| `POST /simulation/control/{machineId}/clear` | — | `ENGINEER`, `ADMIN` |
| `GET /simulator/config` | `{ paused, machines[] }` | global feed state; polled by the simulator |
| `POST /simulation/pause` \| `/resume` \| `/reset` | — | `ENGINEER`, `ADMIN`. `/reset` clears every machine. |

### Two distinct scenario actions

The backend exposes **two** different capabilities and the console presents them
as **two separate buttons**, because their side effects differ fundamentally:

| | `POST /simulation/run` | `POST /simulation/control` |
| --- | --- | --- |
| Purpose | What-if analysis | Live fault injection |
| Modelled impact | yes | no |
| Changes the fleet | **no** | **yes** |
| Side effects | records a run in history | simulator emits faulted telemetry → ML scores it → decision engine raises state, alerts, work orders |
| Repeatable | yes | guarded — re-applying while active is blocked in the UI |

`scenarioType` values (`simulation/domain/ScenarioType.java`):
`NONE`, `DEGRADATION`, `OVERHEATING`, `BEARING_FAILURE`, `VIBRATION_SPIKE`,
`RPM_INSTABILITY`, `CURRENT_SPIKE`, `SENSOR_FAILURE`, `MACHINE_OFFLINE`,
`LOAD_INCREASE`, `MAINTENANCE`, `RECOVERY`.

**Both act only on the synthetic telemetry generator. Neither commands,
connects to, or represents any physical machine.**

---

## System

### `GET /api/v1/system/status`

```json
{
  "application": "ForgeSense Backend",
  "demoMode": true,
  "streaming": true,
  "transport": "WEBSOCKET_STOMP",
  "pollIntervalSeconds": 3,
  "inputTransport": "KAFKA",
  "database": "POSTGRESQL",
  "mlServiceAvailable": true,
  "mlModelVersion": "failure-risk-v2",
  "anomalyModelVersion": "anomaly-model-v2",
  "simulationPaused": false,
  "webSocketConnections": 2,
  "definedMachines": 18,
  "dataBasis": ["SYNTHETIC"]
}
```

Transport semantics are deliberately distinct:

- `inputTransport` — how telemetry **enters** the backend: `KAFKA | IN_PROCESS`
- `transport` — how a **client** receives updates: `WEBSOCKET_STOMP`
- `streaming` — whether the server-side realtime channel is enabled

> `database` is resolved from the live `DataSource` connection metadata. It
> previously reported `H2_DEV` whenever demo mode was on, which misreported a
> PostgreSQL deployment as an in-memory one.

### `GET /actuator/health`

Spring Boot health, including per-component detail. `405`/`404` and an
unreachable gateway are expected states and render as an honest error panel,
never as a fake "up".

---

## ML service (direct)

The browser never calls the ML service. The console may read it only through
the backend. For reference:

`GET /health` → `model_version`, `anomaly_model_version`, `models_loaded`,
`evaluation` (`anomaly_auc`, `risk_auc`, `rul_rmse_steps`, `rul_unit: "steps"`),
`metadata` (`feature_schema_version`, `artifact_hash`, `profiles_hash`).

Those AUC figures are **held-out metrics on generated data**. They are not
accuracy claims about industrial equipment, and the console does not display
them as such.

---

## Error semantics

| Status | Meaning | Client behaviour |
| --- | --- | --- |
| `400` | validation failure | panel-level error with the backend message |
| `401` | session invalid/expired | clear session, re-open the sign-in gate |
| `403` | role insufficient | action button disabled; if it still reaches the server, the failure is surfaced as a toast — never silently ignored |
| `404` | unknown entity | "not found" state, not a blank panel |
| `5xx` / network | backend unavailable | per-resource error state; **healthy resources keep rendering** |

Errors are isolated **per query key**. One failing subsystem never blanks the
console — this replaced the baseline's single `Promise.all` fan-out.
