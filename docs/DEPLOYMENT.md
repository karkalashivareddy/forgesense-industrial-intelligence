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
`FORGESENSE_DEV_PASSWORD` (a development-only seed credential; never reuse it for any
  real deployment — override it in `.env`). The JWT signing key is a
  documented demo placeholder (`forgesense-demo-...`) — replace it for any real
  deployment.
- WebSocket/STOMP endpoints are not anonymous control-plane entry points; the
  browser currently uses authenticated REST polling. The rest of `/api/v1/**`
  requires a Bearer token from `POST /api/v1/auth/login`.

## Telemetry & ML

- The simulator streams the fabricated fleet (`M-101`…`M-108`). Degrade a machine with
  `--degrade M-105` to watch anomaly → risk → alert → maintenance in the UI.
- On boot the ML service trains `ml-service/models/` artifacts if the
  `config/machine_profiles.json` retrain-hash changed (see
  `ml-service/app/models.py`), persists holdout `eval-metrics.json`, and reports
  its model versions (`anomaly-model-v2` / `failure-risk-v2`) on `GET /health`.
  Each `/assess` response carries `modelVersion`, which the backend stores on the
  prediction and the machine twin for transparency.
