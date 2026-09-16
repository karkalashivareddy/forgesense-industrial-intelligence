# Deployment

ForgeSense runs locally for development and as a Docker Compose stack for an
integrated environment.

## Local development (no Docker)

| Service    | How to start                          | Port |
| ---------- | ------------------------------------- | ---- |
| Backend    | `cd backend && mvn spring-boot:run`   | 8080 |
| ML service | `cd ml-service && uvicorn app.main:app --port 8001` | 8001 |
| Simulator  | `python simulator/telemetry_feed.py`  | —    |
| Frontend   | `python frontend/serve.py`            | 5173 |

Backend dev mode uses an embedded H2 file database, an in-memory event bus (no Kafka/Redis)
and defaults security ON with the dev users. Set `FORGESENSE_SECURITY_ENABLED=false` to
disable authentication for local tooling.

## Docker Compose stack

`docker compose up --build` starts PostgreSQL, Redis, Kafka (KRaft, single node), the ML
service, the backend (Spring profile `docker`), the static frontend behind nginx, and
Prometheus + Grafana.

- Backend: `http://localhost:8080` — API + Swagger at `/swagger-ui/index.html`,
  health at `/actuator/health`, Prometheus metrics at `/actuator/prometheus`.
- Frontend: `http://localhost:5173` — prompts for the operator password.
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000` — the admin password comes from
  `GRAFANA_ADMIN_PASSWORD`; the Prometheus datasource is
  provisioned under `infra/grafana/`.

## IAM notes

- Dev users (seeded on boot): `admin`, `operator`, `engineer`. Passwords come from
  the required `FORGESENSE_DEV_PASSWORD` environment variable. The JWT signing key
  comes from the required `FORGESENSE_JWT_SECRET` environment variable.
- WebSocket/STOMP broker and `/topic/**` are public; the rest of `/api/v1/**`
  requires a Bearer token from `POST /api/v1/auth/login`.

## Telemetry & ML

- The simulator streams the fabricated fleet (`M-101`…`M-108`). Degrade a machine with
  `--degrade M-105` to watch anomaly → risk → alert → maintenance in the UI.
- On first boot the ML service trains `models/` artifacts (gitignored). Retrain:
  `cd ml-service && python -m scripts.train`. Expected model versions are enforced
  via `forgesense.ml.*-model-version`; a mismatch is surfaced but does not block
  predictions.
