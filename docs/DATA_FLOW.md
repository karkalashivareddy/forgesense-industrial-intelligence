# ForgeSense — Data Flow

The central data flow of the platform, described end-to-end. This is the
"heart of the project" — every UI element maps to one of these steps.

## 1. The primary flow

```mermaid
sequenceDiagram
    participant S as Simulator
    participant K as Kafka (forge.*)
    participant B as Backend digital twin
    participant M as ML service
    participant D as Decision engine
    participant I as Impact engine
    participant A as Alert/Maintenance
    participant W as WebSocket
    participant F as Frontend / 3D

    S->>K: telemetry.raw (~0.2 Hz = 1 batch / 5 s per machine)
    K->>B: consume raw
    B->>B: validate + normalize
    B->>K: telemetry.normalized
    B->>M: POST /assess
    M-->>B: anomalyScore, riskScore, rulEstimate, factors
    B->>B: update MachineTwin (health, risk, status intent)
    B->>K: machine.state changed
    B->>D: evaluate decision rules
    D->>I: (risk high) compute production impact
    I-->>D: impacted machines + line + downtime est.
    D->>A: create alert / recommend maintenance
    A-->>B: alert / maintenance events
    B->>W: machine.updated / telemetry.updated / prediction.updated
    B->>W: anomaly.detected / alert.created / impact.updated
    F->>B: REST poll every 3 s → 3D scene + KPI + panels react
    F->>B: operator actions (ack alert, run simulation, schedule maintenance)
    B-->>S: scenario command (via control API) → simulator changes behavior
```

## 2. Telemetry ingestion paths

ForgeSense supports two equivalent production paths selected by configuration:

**Path A — Kafka-first (docker profile):**
```
Simulator → (kafka-python producer) → forge.telemetry.raw → backend consumer
```

**Path B — HTTP-first (dev profile):**
```
Simulator → POST /api/v1/telemetry/ingest → in-process EventBus → same consumer
```

Both paths land in the identical normalization/twin/ML pipeline. The backend
reports which backend input mode is configured (`forgesense.streaming.kafka.enabled`
via `/api/v1/system/status`); the browser transport is REST polling.

## 3. Machine state change flow

1. Normalized telemetry updates `MachineTwin.latestTelemetry`.
2. `HealthScore` recomputed from anomaly/risk/threshold model.
3. State-machine intent computed (`NORMAL → DEGRADED → WARNING → CRITICAL …`).
4. Valid transition applied by `MachineStateMachine` (or rejected).
5. On accepted change → `MACHINE_STATE_CHANGED` event + `machine.state.changed`
   WebSocket message (server-side capability; the dashboard reflects persisted
   state on its next 3 s REST poll).

## 4. Alert lifecycle

```
Telemetry signals anomaly/risk threshold
→ DecisionEngine creates Alert (NEW, CRITICAL/WARNING/etc.)
→ alert.created + timeline entry
→ Operator acknowledges (ACKNOWLEDGED)
→ Operator investigates (INVESTIGATING)
→ Maintenance created/scheduled
→ Alert resolved (RESOLVED) with resolution notes
→ alert.updated + timeline entries
```

## 5. Demonstration scenario (M-104)

The canonical story the product demonstrates end-to-end:

```
1. M-104 (Conveyor Drive Motor) starts NORMAL.
2. Degradation injected: vibration ↑, temperature ↑, RPM unstable.
3. Anomaly score climbs; failure risk climbs.
4. State WARNING → CRITICAL; CRITICAL alert created.
5. AI explanation (baseline-importance factors) available in the inspector.
6. Impact engine: M-106 waits, Assembly line throughput ↓, downtime estimate.
7. Operator runs what-if simulation (baseline vs scenario).
8. Maintenance scheduled → MAINTENANCE state → RECOVERING → NORMAL.
9. Materials fully driven by the simulator + pipeline; nothing hand-edited.
```

## 6. UI state sources

| UI element | Data source |
|---|---|
| KPIs | `/api/v1/analytics/overview` (REST) |
| 3D machines | REST `GET /api/v1/machines` fleet state |
| Telemetry strip | REST `GET /api/v1/machines/{id}/telemetry/range` |
| Alerts panel | REST `GET /api/v1/alerts` |
| Inspector charts | REST `GET /api/v1/machines/{id}/telemetry/range` (downsampled) |
| Explanation | REST `GET /api/v1/machines/{id}/explanation` |
| Impact page | REST `/api/v1/impact/{machineId}` |
| Simulation | REST `/api/v1/simulation/scenarios` + `/api/v1/simulation/run` |
| Timeline | REST `/api/v1/events` |

All dashboard views are fetched by a 3 s REST poll loop (`frontend/js/app.js`);
the backend additionally publishes WebSocket events on `/ws` for future
subscribers.

## 7. Backpressure / staleness rules

- Normalization rejects timestamps older than `forgesense.telemetry.maxStaleness`
  (default 60s) to avoid replay flooding the twin.
- Duplicate `eventId`s are dropped (recently-seen set).
- If telemetry for a machine stops for > `forgesense.machine.offlineAfter`
  (default 30s), the twin marks connectivity `STALE/OFFLINE`.
- Per-machine ordering preserved (keyed by machineId); cross-machine order is
  not assumed.
