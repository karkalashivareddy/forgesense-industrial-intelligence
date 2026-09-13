# ForgeSense

**Real-Time Industrial Intelligence & Predictive Operations Platform**

ForgeSense is a real-time industrial operations intelligence platform that monitors
factory machines, processes streaming telemetry, maintains synchronized digital machine
states, detects anomalies, predicts failure risk, explains why a machine is becoming
risky, estimates operational consequences, recommends maintenance actions, and allows
operators to investigate the factory through an interactive 3D environment.

> Full documentation lives in [`docs/`](docs/OWNERSHIP.md). The extended project
> specification is in [`docs/PROJECT_SPECIFICATION.md`](docs/PROJECT_SPECIFICATION.md).

---

## Overview

ForgeSense is composed of:

- **Backend** — Spring Boot 4.1.1 (Java) service: telemetry ingest + normalization,
  digital-twin fleet model, event-driven pipeline (Kafka in production / in-process in
  dev), anomaly & failure-risk predictions, explainable factors, production-impact
  estimates, maintenance recommendations, alerting, and a simulation engine.
- **ML service** — FastAPI (Python, scikit-learn): trains synchronize models on boot
  (IsolationForest + GradientBoosting, synthetic-but-realistic fleet data) and exposes
  `/health`, `/assess`, `/explain`, `/explain-ml`, `/interpretability-info`.
- **Simulator** — Python telemetry feed that streams privacy-safe, synthetic telemetry
  for the full fabricated fleet to the backend.
- **Frontend** — dependency-free static dashboard: Three.js factory floor, fleet
  overview, per-machine detail with sparkline + model factors, live event and alert
  feeds. Run `python serve.py`.

Documentation: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/DATA_FLOW.md`](docs/DATA_FLOW.md), [`docs/MACHINE_LEARNING.md`](docs/MACHINE_LEARNING.md),
[`docs/OWNERSHIP.md`](docs/OWNERSHIP.md) and `docs/DEPLOYMENT.md`.

## Repository Layout

```
forgesense-industrial-intelligence/
├── backend/          Spring Boot 4 core backend (Java 25)
├── ml-service/       FastAPI ML inference + model training (Python)
├── simulator/        telemetry_feed.py — fleet telemetry streamer
├── frontend/         static Three.js dashboard (serve.py)
├── infra/            Prometheus + Grafana provisioning
├── .github/          CI workflow (backend boot, ml pytest, frontend syntax)
├── data/             dataset notes + processed artifacts
└── docs/             engineering documentation
```

## Quick Start

```bash
# Full stack (PostgreSQL, Redis, Kafka, ML, backend, frontend, Prometheus, Grafana)
docker compose up --build

# Local development without Docker:
#  backend:      cd backend && mvn spring-boot:run     (dev profile, H2, port 8080)
#  ml-service:   cd ml-service && uvicorn app.main:app --port 8001
#  simulator:    python simulator/telemetry_feed.py --degrade M-105
#  frontend:     python frontend/serve.py              (point browser at :5173)
```

Dev-mode access: admin/operator/engineer users, password from
`FORGESENSE_DEV_PASSWORD` (default `forgesense-dev`). Login via
`POST /api/v1/auth/login`; API docs at `/swagger-ui/index.html`.

## License

[MIT](LICENSE)

## Author

Karka Lashi Vareddy