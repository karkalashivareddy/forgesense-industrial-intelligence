# ForgeSense — Project Specification

> **Version:** 1.0
> **Status:** Baseline specification adopted at project start
> **Date:** 2026-09-12

---

## 1. Problem Statement

Industry 4.0 environments generate continuous telemetry from manufacturing
machinery. Operators drown in raw sensor streams and typically only learn about
a developing failure after it has already caused unplanned downtime, degraded
product quality, or cascading line stoppages.

Classic monitoring stacks show *what the equipment is doing*. They do not
answer the questions operators actually need:

1. **Is this machine moving toward failure?**
2. **Why is the model concerned about this machine?**
3. **What happens to the rest of the factory if it fails?**
4. **What should we do about it, and how urgent is it?**

ForgeSense is a decision-support platform that closes that loop:

```
TELEMETRY → EVENT STREAM → DIGITAL TWIN → ML → EXPLANATION
→ ALERT → PRODUCTION IMPACT → WHAT-IF SIMULATION → MAINTENANCE → RECOVERY
```

## 2. Goals

- Continuously ingest, validate, and normalize streaming machine telemetry.
- Maintain a synchronized digital twin — the authoritative real-time software
  state of every machine.
- Detect anomalies and predict failure risk with defensible, reproducible
  machine-learning models.
- Explain every important prediction (SHAP-based attribution) without claiming
  unsupported physical causality.
- Compute the operational consequence of a predicted failure through a
  configurable dependency graph (affected line, downstream machines, estimated
  downtime, estimated production impact).
- Let operators evaluate **what-if** maintenance scenarios against a baseline
  before acting.
- Drive a live, interactive 3D factory visualization from the same state the
  rest of the product consumes.
- Track the operational event timeline (telemetry → anomaly → risk → alert →
  action → maintenance → recovery) backed by real system events.
- Be observable (metrics, health, dashboards), secure (roles, auth), testable,
  and reproducible (Docker Compose).
- Be genuinely functional: no dead buttons, no fake connectivity badges, no
  fabricated ML metrics or fake telemetry posing as real factory data.

## 3. Non-Goals (explicit)

- **No physical PLC/SCADA integration.** Telemetry is simulated. Simulation is
  always labeled as such.
- **No automatic control of physical machinery.** ForgeSense is a
  decision-support system; humans act.
- **No safety-critical certification** (IEC 61508 / ISO 26262 etc.).
- **No real RUL (remaining useful life) claims.** RUL is shown only as a
  clearly labeled heuristic estimate unless a dataset supports a defensible
  model (the AI4I dataset does not provide run-to-failure curves).
- **No fabricated monetary loss figures.** Production impact is presented as a
  labeled *estimate* with transparent assumptions.
- **No production-grade multi-region fault-tolerant infrastructure.** We
  document how the system scales; we do not build a giant cluster locally.

## 4. Architecture Decisions (summary)

See `docs/ARCHITECTURE.md` and `docs/SYSTEM_DESIGN.md` for the full rationale.

| Concern | Decision | Why |
|---|---|---|
| Core backend | **Spring Boot** (Java) | mature ecosystem, strong tooling, enterprise expectations |
| Streaming transport | **Apache Kafka** | durable high-throughput event backbone, replay, multiple consumers |
| State + cache | **Redis** | low-latency latest-state cache & pub/sub where justified |
| Source of truth | **PostgreSQL** | transactional relational domain data, audit, history |
| ML inference | **FastAPI** (Python) | separate ML lifecycle, independent scaling, model hygiene |
| Anomaly model | **Isolation Forest** | solid unsupervised baseline, cheap, interpretable enough |
| Failure-risk model | **XGBoost / LightGBM / Random Forest**, compared | supervised ensemble; selection on precision/recall/PR-AUC not accuracy alone |
| Explainability | **SHAP** (TreeExplainer) with documented fallback | consistent model-agnostic attribution |
| Frontend | **React + TypeScript + Vite** | large ecosystem, strong typing, fast dev loop |
| Charts | **Recharts** | declarative, adequate for real-time sparklines/trends |
| 3D scene | **Three.js + React Three Fiber** | mature WebGL, declarative scene graph, control over performance |
| Styling | **Tailwind CSS** + shadcn/ui-style primitives | fast, consistent, accessible dark industrial theme |
| Packaging | **Docker Compose** | single-command reproducible environment |
| Observability | **Actuator + Micrometer + Prometheus + Grafana** | standard, proven |

### 4.1 Infrastructure adapters (graceful degradation)

Real deployments use PostgreSQL / Redis / Kafka. Local development must remain
possible without Docker. ForgeSense therefore defines **infrastructure
adapter interfaces**:

- `Database`: PostgreSQL (docker profile) **or** H2 in PostgreSQL mode (dev)
- `CacheStore`: Redis (docker) **or** in-memory hash map (dev)
- `EventBus`: Kafka (docker) **or** in-process event bus (dev)
- `MlClient`: FastAPI HTTP client (default) **or** local in-process heuristics
  (only when the ML service is unreachable — explicitly marked)

Selection is driven by environment variables (`forgesense.streaming.kafka.enabled`,
`spring.profiles.active`, `FORGESENSE_ML_URL`, …). Every path is visible to the
operator: the UI never claims "Kafka connected" unless Kafka is actually used.

## 5. Domain Model

Primary entities (see `docs/DATABASE.md` and `docs/SYSTEM_DESIGN.md`):

- `Factory` — production site (Factory Alpha).
- `Zone` — operational area (Machining, Assembly, Packaging, Utilities).
- `ProductionLine` — ordered grouping of machines (Line A, Line B).
- `Machine` — physical asset with type, sensors, health, risk, status.
- `MachineDependency` — `upstream → downstream` edges (configurable at runtime).
- `Telemetry` — normalized sensor reading.
- `Prediction` — anomaly + failure-risk prediction snapshot.
- `Anomaly` — detected anomaly record.
- `Alert` — operational alert with lifecycle.
- `MaintenanceRecord` — recommended/scheduled/active/completed work order.
- `SimulationScenario` — scenario definition + run results.
- `ProductionImpact` — computed consequence of a (simulated or predicted) failure.
- `OperatorAction` — audit trail of operator decisions.
- `EventLog` — ordered operational event timeline.

## 6. Event Model

Versioned event envelopes published over Kafka (and the in-process bus):

```
{
  "eventId": "uuid",
  "eventType": "TELEMETRY_RECEIVED",
  "machineId": "M-104",
  "timestamp": "ISO8601",
  "sequence": 123456,
  "payload": { ... },
  "source": "simulator|backend|ml-service",
  "schemaVersion": "1.0",
  "correlationId": "uuid"
}
```

Key topics: `forge.telemetry.raw`, `forge.telemetry.normalized`,
`forge.machine.state`, `forge.ml.predictions`, `forge.anomalies`,
`forge.alerts`, `forge.maintenance`, `forge.simulation.commands`.
See `docs/EVENT_STREAMING.md` and `docs/KAFKA.md`.

## 7. Machine State Machine

Explicit states: `ONLINE, NORMAL, DEGRADED, WARNING, CRITICAL, MAINTENANCE,
OFFLINE, RECOVERING`. Transitions are enforced by the backend state machine,
never invented by the UI. See `docs/DIGITAL_TWIN.md`.

## 8. ML Strategy

- **Dataset:** UCI AI4I 2020 Predictive Maintenance (labeled failure
  classification). Documented in `docs/DATASET.md`; fallback synthetic
  dataset generation is transparently labeled when the upstream file is
  unreachable.
- **Anomaly model:** Isolation Forest on normalized sensor features
  (temperature, vibration, pressure, rpm, torque, current, power, deltas,
  rolling statistics).
- **Failure-risk model:** supervised ensemble on engineered features; evaluated
  with precision, recall, F1, ROC-AUC, PR-AUC, calibration, confusion matrix,
  and inference latency — with a **false-negative-aware** decision threshold.
- **RUL:** not modeled (no run-to-failure support in AI4I). The UI may show a
  clearly labeled heuristic estimate only.
- **Explainability:** SHAP TreeExplainer contributions aggregated to features.
- **Versioning:** artifacts stored as `models/anomaly-model-v1.pkl`,
  `models/failure-risk-v1.pkl` plus a JSON manifest (features, metrics,
  hyperparameters, training date, dataset version).

See `docs/MACHINE_LEARNING.md`, `docs/MODEL_CARD.md`, `docs/FEATURE_ENGINEERING.md`,
`docs/EXPLAINABILITY.md`.

## 9. Simulation & Impact

- Dependency graph drives traversal: affected machine → downstream machines →
  line → zone.
- Impact engine estimates downtime and throughput impact from per-edge delay
  factors and per-machine throughput; assumptions are explicit and labeled
  `ESTIMATED`.
- What-if engine simulates scenarios (failure, overheating, bearing
  degradation, vibration spike, offline, sensor failure, load increase,
  maintenance delay) and compares **Baseline vs Scenario**.

## 10. UI Strategy

Industrial control-room aesthetic: near-black graphite, subtle borders,
technical typography, semantic status colors, high information density.
Pages: Dashboard (KPI + live 3D factory + telemetry strip), Machines,
Machine Inspector, Alerts, Analytics, Maintenance, Simulation, Impact.
Command palette (`Ctrl/Cmd+K`) + keyboard shortcuts. All data connected to
backend via REST + WebSocket; loading/empty/error/offline states everywhere.

## 11. Infrastructure

Docker Compose: `frontend, backend, ml-service, simulator, postgres, redis,
kafka, prometheus, grafana`. Prometheus scrapes backend/ml/simulator; Grafana
provisioning includes dashboards. GitHub Actions CI: build + test backend &
ML & frontend, lint, Docker validation.

## 12. Risks & Assumptions

- Python 3.14 wheel availability for `shap` may be limited on Windows → the
  explanation module falls back to documented tree-gain / permutation
  attribution while keeping the same API.
- Docker Desktop may be unavailable in some environments → infra adapters.
- AI4I is a synthetic diagnostic dataset, not real streaming telemetry →
  clearly documented; live demo uses the simulator.
- Dependencies (machines/edges, throughput, downtime factors) are **modeled
  assumptions**, not measured physics.

## 13. Milestones

1. Spec + repo skeleton
2. Domain + database + state engine
3. Telemetry simulator + scenarios
4. Kafka pipeline + backend APIs + digital twin + WebSocket
5. ML training + inference service + explainability
6. Frontend foundation + dashboard + 3D factory + inspector
7. Alerts, analytics, impact, simulation, maintenance, command palette
8. Observability + security
9. Tests, Docker, CI
10. Documentation, validation, demo scenario, release