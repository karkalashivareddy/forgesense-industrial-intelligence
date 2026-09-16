# ForgeSense — Architecture

```mermaid
flowchart LR
    subgraph Producers
        SIM[Simulator script<br/>Python, HTTP client]
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
        UI[Vanilla ES-module JS]
        X3D[Three.js via CDN<br/>3D factory floor]
        CHARTS[Canvas chart helpers]
    end

    subgraph Ops [Observability]
        PROM[Prometheus]
        GRA[Grafana]
    end

    ING --> VALIDATE
    ING --> BUS
    SIM -->|POST /api/v1/telemetry/ingest| ING
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
    WS --> UI
    REST --> UI
    UI --> X3D
    UI --> CHARTS
    PROM -->|scrape /actuator/prometheus| REST
    GRA --> PROM
```

## Key architectural positions

1. **An event-flow core with a WebSocket and REST surface.** Telemetry is
   ingested over HTTP, validated, normalized, and fed to the digital twin. The
   backend broadcasts events over WebSocket; the static frontend polls REST
   every 3 seconds and renders live state. The WebSocket endpoint exists and is
   used by server-side broadcast; the current frontend does not subscribe to it.

2. **Separation of "assess" from "decide".** The ML service answers *"what does
   the model assess for this telemetry?"* (`POST /assess`). The backend decision
   engine answers *"what should the system do about it?"* using configurable
   thresholds. Rules live in `application-*.yml` + service code, not inside ML.

3. **The digital twin is authoritative.** Every machine's synchronized state
   (telemetry, health, risk, status, dependencies, recent events) is owned by
   the backend. The 3D scene and all dashboards render from this one source of
   truth — the frontend never invents business state.

4. **Infrastructure adapters.** PostgreSQL/Redis/Kafka are the Compose-profile
   adapters; H2/in-memory/in-process bus are dev-profile adapters. Interfaces
   are identical, so behavior stays the same and the switch is environment-driven.

5. **Observability.** Micrometer counters/histograms/Timer, health indicators
   per dependency (DB, Redis, Kafka, ML), Prometheus export, Grafana dashboards.

## Component responsibilities

| Component | Responsibilities | Anti-responsibilities |
|---|---|---|
| Simulator | generate synthetic telemetry for the fleet, inject degradations, run bare mode | must not decide health/risk — that is upstream of it |
| Backend | domain truth: machines, state machine, alerts, maintenance, impact, simulation, websocket, API | must not train models |
| ML service | anomaly score, failure risk, heuristic RUL, feature attribution | must not own alert policy |
| Frontend | render synchronized state, interactions, what-if UX | must not compute business state |
| Redis | latest machine state / telemetry cache | not the source of truth |
| PostgreSQL | persisted domain + telemetry history | telemetry history bloat is a foreseeable analytics problem |

## Scaling notes (future work, not implemented)

- Kafka partitions by `machineId` key → ordered per machine, parallel across
  machines.
- Consumer groups scale pipeline stages.
- Telemetry history could move to a time-series store (TimescaleDB/ClickHouse)
  as it grows; PostgreSQL would keep domain/history summarized.
- WebSocket scale-out: topic prefix per backend node or broker; sticky sessions.
- ML inference is stateless and horizontally scalable behind a load balancer.

These are the intended growth path and are documented as forward-looking —
only the single-node Compose topology is implemented today.