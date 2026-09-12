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

Detailed content is being written incrementally. Start with:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/DATA_FLOW.md`](docs/DATA_FLOW.md)
- [`docs/MACHINE_LEARNING.md`](docs/MACHINE_LEARNING.md)

## Repository Layout

```
forgesense-industrial-intelligence/
├── backend/          Spring Boot (Java) core backend
├── ml-service/       FastAPI (Python) ML inference
├── simulator/        Telemetry simulator service
├── frontend/         React + TypeScript control room
├── infrastructure/   Kafka / Postgres / Prometheus / Grafana config
├── data/             dataset notes + processed artifacts
└── docs/             engineering documentation
```

## Quick Start

```bash
# Infrastructure + services (PostgreSQL, Redis, Kafka, Prometheus, Grafana)
docker compose up --build

# Local development without Docker:
#   backend:  mvn spring-boot:run   (dev profile, H2)
#   ml-service:  uvicorn app.main:app --port 8001
#   simulator:   python simulator/app.py
#   frontend:    npm install && npm run dev
```

_Intentionally a skeleton — completing during staged development._

## License

[MIT](LICENSE)

## Author

Karka Lashi Vareddy