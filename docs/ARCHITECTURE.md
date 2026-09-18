# ForgeSense â€” Architecture

```mermaid
flowchart LR
    subgraph Producers
        SIM[Simulator Service<br/>Python producer, outbound HTTP]
        ING[REST ingest endpoint<br/>POST /api/v1/telemetry/ingest]
    end

    subgraph Streaming
        K[Apache Kafka<br/>forge.* topics<br/>docker profile]
        BUS[(In-process bus<br/>dev profile)]
    end

    subgraph Backend [Spring Boot Backend - port 8080]
        CONSUMER[Event bus consumers]
        VALIDATE[Validation + normalization]
        TWIN[Digital Twin state store]
        SM[State machine engine]
        DECISION[Decision engine]
        IMPACT[Production impact engine]
        MTN[Maintenance workflow]
        ALERT[Alert lifecycle]
        WS[WebSocket hub /ws/*]
        REST[HTTP API /api/v1/**]
        REDISC[(Redis latest-state cache<br/>or in-memory in dev)]
        PG[(PostgreSQL<br/>or H2 in dev)]
    end

    subgraph ML [ML Service - FastAPI, port 8001]
        ANOM[Anomaly detector<br/>Isolation Forest]
        RISK[Failure-risk model<br/>Gradient Boosting]
        RUL[Heuristic RUL estimate]
        ATTR[Feature attribution<br/>replace-with-baseline]
    end

    subgraph Frontend [Static dashboard - nginx :5173]
        UI[Vanilla ES-module JS + Three.js via CDN]
        X3D[Three.js factory floor]
        POLL[REST poll every 3 s]
        CHARTS[Canvas chart helpers]
    end

    subgraph Ops [Observability]
        PROM[Prometheus]
        GRA[Grafana]
    end

    SIM -->|telemetry| K
    SIM -->|POST /api/v1/telemetry/ingest| ING
    ING --> VALIDATE
    ING --> BUS
    K --> CONSUMER
    BUS --> CONSUMER
    CONSUMER --> VALIDATE
    VALIDATE --> TWIN
    TWIN --> SM
    TWIN -->|feature vector| ANOM
    ANOM --> RISK
    RISK --> RUL
    RUL --> ATTR
    ATTR --> DECISION
    TWIN --> DECISION
    DECISION --> IMPACT
    DECISION --> ALERT
    ALERT --> MTN
    DECISION --> WS
    TWIN --> REDISC
    REDISC --> PG
    REST --> UI
    POLL --> REST
    UI --> X3D
    UI --> CHARTS
    PROM -->|scrape /actuator/prometheus| REST
    GRA --> PROM
```

## Key architectural positions

1. **A server-side event core with an honest polling browser.** Telemetry enters via
   `forge.telemetry.raw`, is normalized to `forge.telemetry.normalized`, and
   every downstream subsystem (digital twin, ML, alerts, timeline) consumes
   events. The frontend keeps itself updated by polling the REST API every 3 s;
   WebSocket push exists server-side (`/ws`) but the dashboard does not subscribe
   to it; the browser's verified transport is REST polling.

2. **Separation of "predict" from "decide".** The ML service answers
   *"what does the model predict?"* (`GET /health`, `POST /assess`). The backend
   decision engine answers *"what should the system do about it?"* using
   configurable rules. Rules live in `application-*.yml` + `SystemConfig`, not
   inside ML code.

3. **The digital twin is authoritative.** Every machine's synchronized state
   (telemetry, health, risk, status, dependencies, recent events) is owned by
   the backend. The 3D scene and all dashboard views render from this one source
   of truth â€” the frontend never invents business state.

4. **Infrastructure adapters.** PostgreSQL/Redis/Kafka are the Compose-profile
   adapters; H2/in-memory/in-process bus are dev-profile adapters. Interfaces
   are identical, so behavior stays the same and the switch is environment-driven.

5. **Observability.** Micrometer counters/histograms/Timer, health indicators
   per dependency (DB, Redis, Kafka, ML), Prometheus export, Grafana dashboards.

## Component responsibilities

| Component | Responsibilities | Anti-responsibilities |
|---|---|---|
| Simulator | generate synthetic telemetry for the fleet, inject degradations, run bare mode | must not decide health/risk â€” that is upstream of it |
| Backend | domain truth: machines, state machine, alerts, maintenance, impact, simulation, websocket, API | must not train models |
| ML service | anomaly score, failure-risk, RUL estimate, baseline-importance factors | must not own alert policy |
| Frontend | render synchronized state, interactions | must not compute business state |
| Redis | latest telemetry / machine state cache, small short-lived state | not the source of truth |
| PostgreSQL | persisted domain + history | telemetry history bloat is a foreseeable analytics problem |

## Scaling notes (future work, not implemented)

- Kafka partitions by `machineId` key â†’ ordered per machine, parallel across
  machines.
- Consumer groups scale pipeline stages.
- Telemetry history could move to a time-series store (TimescaleDB/ClickHouse)
  as it grows; PostgreSQL would keep domain/history summarized.
- WebSocket scale-out: topic prefix per backend node or broker; sticky sessions.
- ML inference: stateless, horizontally scalable behind a load balancer with
  model warm cache.

These are the intended growth path and are documented as forward-looking â€”
only the single-node Compose topology is implemented today.
