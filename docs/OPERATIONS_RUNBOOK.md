# Operations Runbook

Running, verifying and troubleshooting ForgeSense locally.

---

## 1. Prerequisites

| Requirement | Version |
| --- | --- |
| Docker Desktop | Compose v2+ |
| Node.js | 20+ (only for local frontend development) |
| Java | 25 (only for local backend development) |
| Python | 3.13 (only for local ML development) |

---

## 2. The stack

```bash
# From the repository root
cp .env.example .env      # PowerShell: Copy-Item .env.example .env
# Edit .env and set all four required secrets. Compose uses the `:?` form for
# each, so the stack refuses to start while any is unset instead of falling back
# to a committed default:
#   POSTGRES_PASSWORD, FORGESENSE_SECURITY_JWT_SECRET (openssl rand -base64 48),
#   FORGESENSE_DEV_PASSWORD, GRAFANA_ADMIN_PASSWORD

docker compose up --build -d
docker compose ps
```

| Service | URL | Notes |
| --- | --- | --- |
| Frontend | http://localhost:5173 | built bundle served by nginx, SPA fallback |
| Backend API | http://localhost:8080 | |
| OpenAPI UI | http://localhost:8080/swagger-ui/index.html | |
| Actuator health | http://localhost:8080/actuator/health | |
| ML service | `http://ml-service:8001/health` on Compose network | Not host-published |
| Prometheus | http://localhost:9090 | |
| Grafana | http://localhost:3000 | |

Sign in as `admin` with the `FORGESENSE_DEV_PASSWORD` you set in `.env`. The
seeded `operator` and `engineer` accounts use the same development-only value.

> The simulator is a **separate** service. `docker compose up` includes it, so
> the console receives a live synthetic feed immediately. To demonstrate the
> console's no-telemetry and stale states, stop it:
> `docker compose stop simulator`.

---

## 3. Verification

```bash
# Health of every service
docker compose ps
curl -sf http://localhost:8080/actuator/health
# ML health is available to backend containers only; inspect backend readiness
# and `docker compose logs ml-service` from the host.

# Frontend
curl -sf http://localhost:5173/healthz
curl -sI http://localhost:5173/assets/ | head -1   # hashed assets, SPA fallback
```

A deep link such as `http://localhost:5173/twin` must return the shell, not a
404 — that is what the nginx `try_files … /index.html` rule guarantees.

---

## 4. Local development

Each service can run independently for fast iteration.

```bash
# Frontend — hot reload against the running container stack
cd frontend
npm ci
npm run dev            # http://localhost:5173

# Backend — dev profile: H2, in-process event bus
cd backend
./mvnw spring-boot:run -Dspring-boot.run.profiles=dev

# ML service
uvicorn app.main:app --app-dir ml-service --host 127.0.0.1 --port 8001

# Optional simulator
python simulator/telemetry_feed.py --degrade M-105
```

`npm run dev` proxies nothing: the console talks to `VITE_API_BASE_URL`
directly, so the backend must be reachable on that origin and must allow it via
CORS (`FORGESENSE_ALLOWED_ORIGINS`).

---

## 5. Frontend commands

```bash
npm ci              # lockfile-pinned install
npm run dev         # dev server
npm run typecheck   # tsc, strict, includes tests
npm test            # unit tests (Vitest)
npm run build       # production build
npm run preview     # serve the production build
npm run e2e         # Playwright (builds and previews automatically)
npm run visual-qa   # screenshot pass across breakpoints
```

`E2E_BASE_URL` points the suite at an already-running stack instead of starting
one. `CAPTURE_SCREENSHOTS=true` writes breakpoint screenshots.

---

## 6. Troubleshooting

### The console shows `OFFLINE`
The backend is unreachable. Check `docker compose ps` and
`docker compose logs backend`. Confirm `VITE_API_BASE_URL` matches the running
backend origin.

### The console shows `DEGRADED` — "realtime unavailable · polling REST snapshots"
The STOMP socket is not connected but REST works. Usually a proxy or firewall
between the browser and `/ws`. Check the System page transport diagnostics for
the reconnect attempt count and the last diagnostic reason.

### The console shows `STALE`
A healthy transport has stopped delivering deltas, or the oldest asset reading
is over 60 s old. Check `docker compose logs simulator` — the feed may have
stopped. The Simulation Lab's global pause control also stops the feed.

### The ML badge shows `offline`
The ML service is down. The backend falls back to heuristic estimates and labels
them `HEURISTIC`; the Predictions banner states how many assets are affected.
Check `docker compose logs ml-service`.

### The digital twin is blank
The WebGL canvas failed to create a context. Verify the browser has hardware
acceleration enabled, then reload. There is **no** context-loss recovery path —
a reload is required (see `docs/KNOWN_LIMITATIONS.md`).

### The frontend container is serving a stale bundle
The image is built from source with `npm ci`. Rebuild:
`docker compose up --build -d frontend`.

### Build fails on `npm ci`
The lockfile is out of sync with `package.json`. Run `npm install` locally and
commit the updated `frontend/package-lock.json`.

### The E2E suite cannot reach the backend
`npm run e2e` starts its own preview server but expects a backend on
`localhost:8080`. Bring the stack up first, or point the suite elsewhere with
`E2E_BASE_URL`.

---

## 7. Rotating credentials

```bash
# Edit .env, then recreate the affected containers
docker compose up -d --force-recreate backend simulator
```

`FORGESENSE_SECURITY_JWT_SECRET` invalidates every issued token, so all
sessions must re-authenticate. `FORGESENSE_DEV_PASSWORD` changes the sign-in
password for all three demo roles.

---

## 8. Shutting down

```bash
docker compose down          # stop, keep volumes
docker compose down -v       # stop and delete the database volume
```

---

## 9. Operational characteristics

| Aspect | Behaviour |
| --- | --- |
| Simulated ingest rate | ~5 s per asset, ~198 readings/min at 18 assets |
| REST snapshot cadence | 3 s (fleet, alerts), 6 s (per-asset detail), 15 s (analytics) |
| Realtime batch | One commit per animation frame, coalesced per asset |
| Twin rendering | On demand; a stationary scene costs no GPU |
| Bounded memory | Telemetry ring 120/asset, event stream 100, dedupe 2048 |
| Background tab | Transport paused, timers stopped, no GPU work |
| Browser CPU at rest | Near zero — the console does not poll when nothing is open |
