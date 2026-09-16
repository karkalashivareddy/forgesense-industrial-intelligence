# ForgeSense — Architecture

```mermaid
flowchart LR
    subgraph Producers
        SIM[Simulator Service<br/>Python producer, outbound HTTP]
        ING[REST ingest endpoint<br/>POST /api/v1/telemetry/ingest]
    end

    subgraph Streaming
        K[Apache Kafka<br/>forge.* topics]
        BUS[(In-process bus<br/>dev mode)]
    end

    subgraph Backend [Spring Boot Backend - port 8080]
        CONSUMER[Kafka / bus consumers]
        VALIDATE[Validation + normalization]
        TWIN[Digital Twin state store]
        SM[State machine engine]
        DECISION[Decision engine]
        IMPACT[Production impact engine]
        SIM[Simulation engine]
        MTN[Maintenance workflow]
        ALERT[Alert lifecycle]
        WS[WebSocket hub /ws/*]
        REST[HTTP API /api/v1/**]
        REDISC[(Redis latest-state cache<br/>or in-memory in dev)]
        PG[(PostgreSQL<br/>or H2 in dev)]
    end

    subgraph ML [ML Service - FastAPI, port 8001]
        ANOM[Anomaly detector<br/>Isolation Forest]
        RISK[Failure-risk model]
        EXPL[Baseline-importance factor attribution]
    end

    subgraph Frontend [Static dashboard - nginx :5173]
        UI[Vanilla JS + Three.js via CDN]
        X3D[Three.js factory floor]
        POLL[REST poll every 3 s]
    end

    subgraph Ops [Observability]
        PROM[Prometheus]
        GRA[Grafana]
    end

    SIM -->|telemetry| K
    SIM -->|telemetry| ING
    K --> CONSUMER
    BUS --> CONSUMER
    ING --> BUS
    CONSUMER --> VALIDATE
    VALIDATE --> TWIN
    TWIN --> SM
    CONSUMER -->|feature vector| ANOM
    ANOM --> RISK
    RISK --> EXPL
    EXPL --> DECISION
    TWIN --> DECISION
    DECISION --> IMPACT
    DECISION --> ALERT
    ALERT --> MTN
    MTN --> SIM
    DECISION --> WS
    TWIN --> REDISC
    REDISC --> PG
    REST --> UI
    POLL --> REST
    UI --> X3D
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
   of truth — the frontend never invents business state.

4. **Infrastructure adapters.** PostgreSQL/Redis/Kafka are the production
   adapters; H2/in-memory/in-process bus are dev adapters. Interfaces are
   identical, so behavior is the same and the switch is environment-driven.

5. **Observability everywhere.** Micrometer counters/histograms, health
   indicators per dependency, Prometheus export, Grafana dashboards.

## Component responsibilities

| Component | Responsibilities | Anti-responsibilities |
|---|---|---|
| Simulator | generate plausible machine telemetry, run scenarios, expose control API | must not decide health/risk — that is upstream of it |
| Backend | domain truth: machines, state machine, alerts, maintenance, impact, simulation, websocket, API | must not train models |
| ML service | anomaly score, failure-risk, RUL estimate, baseline-importance factors | must not own alert policy |
| Frontend | render synchronized state, interactions | must not compute business state |
| Redis | latest telemetry / machine state cache, small short-lived state | not the source of truth |
| PostgreSQL | persisted domain + history | investors-free time-series bloat becomes analytics problem |

## Scaling (how this grows)

- Kafka partitions by `machineId` key → ordered per machine, parallel across
  machines.
- Consumer groups scale pipeline stages.
- Telemetry history moves to a time-series store (TimescaleDB/ClickHouse) as it
  grows; PostgreSQL keeps domain/history summarized.
- WebSocket scale-out: topic prefix per backend node or broker; sticky sessions.
- ML inference: stateless, horizontally scalable behind a load balancer with
  model warm cache.
- See `docs/SYSTEM_DESIGN.md:scalability`.
