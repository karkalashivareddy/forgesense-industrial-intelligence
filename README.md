<div align="center">

# ForgeSense Industrial Intelligence

**Realtime industrial asset health, anomaly detection and failure-risk prediction
on a spatial digital twin.**

React 18 · TypeScript · Spring Boot 4 · FastAPI · STOMP/WebSocket · Three.js · scikit-learn

[![CI](https://github.com/karkalashivareddy/forgesense-industrial-intelligence/actions/workflows/ci.yml/badge.svg)](https://github.com/karkalashivareddy/forgesense-industrial-intelligence/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-93%20frontend%20%7C%2061%20backend%20%7C%208%20ML-informational)](docs/TESTING.md)

</div>

---

> ### ⚠️ Read this first — what this system is
>
> ForgeSense renders telemetry from a **simulator that runs inside this
> repository**. It is an operational simulation and intelligence platform, not a
> plant connectivity product.
>
> - **It does not connect to equipment.** There is no OPC-UA client, no MQTT
>   client, and no fieldbus driver anywhere in the codebase.
> - **It cannot control machinery.** No write path exists to any device.
> - **Model output is an estimate, not a measurement.** Failure risk, anomaly
>   score and remaining-useful-life are inferences. They are not guarantees, not
>   calibrated probabilities, and not substitutes for engineering judgement.
> - **Remaining-useful-life is expressed in simulator steps, never hours.**
>
> See [KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) for the full boundary.

---

## The problem

Plant operators see either raw sensor traces or a wall of dashboards, and
neither answers the two questions that matter during a shift: *which asset is
degrading, and what is driving that?* ForgeSense consolidates condition
monitoring, anomaly detection, failure-risk estimation and explanation into one
operator console, anchored to a spatial model of the plant so a system-level
picture and a single-sensor reading are the same click apart.

## Who it is for

Reliability and maintenance engineers, plus the shift operators who escalate to
them. The workflow is built around triage: rank by risk, open the driver, read
the sensor, decide.

## Capabilities

| Capability | What it does |
|---|---|
| **Spatial digital twin** | 3D factory hall with per-asset state, zone grouping and camera control |
| **Condition monitoring** | Live and historical sensor readings per asset, derived from the backend's own data |
| **Anomaly detection** | Trained unsupervised model, with heuristic fallback when ML is unavailable |
| **Failure-risk prediction** | Per-asset risk estimate with model version and inference mode always shown |
| **Attribution** | Per-sensor signed contribution to model output via baseline perturbation — **not** SHAP |
| **Prediction history** | Recorded model outputs over time, charted per asset |
| **Realtime streaming** | Authenticated STOMP-over-WebSocket with sequencing and snapshot reconciliation |
| **What-if simulation** | Engineer-gated scenario injection against the live synthetic feed |
| **Role-based access** | Cumulative operator / engineer / admin authorities, enforced server-side |
| **Maintenance & alerts** | Work records, alert lifecycle, acknowledgement |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Console (React 18 + TypeScript + Vite)                         │
│  12 lazily-loaded workspaces · ECharts · Three.js twin          │
└───────────────┬──────────────────────────────┬──────────────────┘
                │ REST (authoritative snapshot) │ STOMP/WebSocket
                │ Bearer JWT                   │ authenticated realtime
┌───────────────▼──────────────────────────────▼──────────────────┐
│  Backend (Spring Boot 4, Java 21)                               │
│  controllers · state machine · twin projection · STOMP broker   │
└──────┬─────────────────────────────┬───────────────────────────┘
       │                             │
┌──────▼──────────────┐   ┌──────────▼───────────────────────────┐
│ Simulator           │   │ ML service (FastAPI + scikit-learn)  │
│ synthetic telemetry │   │ anomaly + failure-risk + explanation  │
│ scenario injection  │   │ falls back to heuristics if offline  │
└─────────────────────┘   └──────────────────────────────────────┘
```

Persistence is PostgreSQL in the container topology; the `dev` profile uses
embedded H2, an in-process event bus and in-memory caching so the whole system
boots with one command. See [ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[DEPLOYMENT.md](docs/DEPLOYMENT.md).

## The digital twin

The twin is a modelled representation, not a surveyed plant model. It renders a
bounded factory hall — structural columns, roof beams, aisles, transfer
conveyors, overhead services and equipment pads — with assets placed by zone and
sized for legibility. Three.js exists to communicate operational state:
assemblies are representative geometry, and status is carried by colour,
indicators and selection rather than decoration.

Machine state shown in the twin is derived from the same live snapshot as every
other workspace, so it cannot disagree with the rest of the console.

## Machine learning, and when it is absent

The ML service produces anomaly scores, failure-risk estimates and baseline
perturbation attribution. Artifacts are generated deterministically from
`config/machine_profiles.json` and validated by hash; see
[ML_PROVENANCE.md](docs/ML_PROVENANCE.md).

**When the ML service is unreachable the backend falls back to heuristics.** The
console detects this and states it explicitly: the model version reads
`unavailable`, affected assets are counted, and a persistent banner tells the
operator every value on the page is indicative only. The fallback is
deterministic and deterministic in its limits — it is a labelled degradation, not
a silent substitution.

## Security model

- JWT issued by `POST /api/v1/auth/login`; held in `sessionStorage` (tab-scoped,
  never `localStorage`).
- Three cumulative roles; control-plane endpoints protected server-side with
  `@PreAuthorize`. The frontend hides what an operator cannot use, but **the
  backend is authoritative** — role checks are not UI-only.
- STOMP connections are authenticated; anonymous subscription is rejected.
- No real credential is committed; CI fails the build on a tracked default.

Full detail in [SECURITY.md](docs/SECURITY.md).

## Getting started

```bash
# Backend (dev profile: embedded H2, no external services)
cd backend && ./mvnw spring-boot:run

# Console
cd frontend && npm ci && npm run dev
```

Sign in with a seeded development account (`operator` / `engineer` / `admin`);
the password comes from `FORGESENSE_DEV_PASSWORD`. Full container topology:

```bash
cp .env.example .env      # then edit
docker compose up --build
```

## Verification

Everything below is run in CI on every push.

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | 0 errors |
| Unit (frontend) | `npm test` | 93 passing |
| Production build | `npm run build` | clean |
| Debug artifacts | `npm run lint:artifacts` | clean |
| Doc links | `npm run check:docs` | 253 links, 0 broken |
| Backend | `./mvnw test` | 61 passing |
| ML | `python -m pytest` | 8 passing |
| Browser E2E | `npm run e2e` | Playwright, all roles |

One command for the frontend gate: `npm run verify`. Matrix and methodology in
[TESTING.md](docs/TESTING.md).

## Configuration

| Variable | Purpose | Default |
|---|---|---|
| `VITE_API_BASE_URL` | Backend origin | `http://localhost:8080` |
| `VITE_WS_URL` | Realtime endpoint | derived from API base |
| `FORGESENSE_DEMO_MODE` | Seed the simulated fleet | `true` |
| `FORGESENSE_DEV_PASSWORD` | Seeded account password | dev only |
| `FORGESENSE_SECURITY_JWT_SECRET` | JWT signing key | random in demo |
| `FORGESENSE_ALLOWED_ORIGINS` | CORS allow-list | localhost dev origins |
| `POSTGRES_PASSWORD` | Container database | required |

See [.env.example](.env.example).

## Repository layout

```
backend/        Spring Boot 4 API, STOMP broker, state machine
frontend/       React console, digital twin, design system, E2E suite
ml-service/     FastAPI inference service
simulator/      Synthetic telemetry generator
config/         Machine profiles — the source for ML artifacts
infra/          Container definitions
docs/           Documentation (start at docs/README.md)
tools/          Release and QA tooling
```

## Documentation

Start at **[docs/README.md](docs/README.md)**. It indexes architecture,
frontend, backend, ML, realtime, deployment, security, testing, design system,
release process and known limitations, and every link in it is verified by CI.

## Release

Current release tag: `v1.0.0-industrial-operations`. Component versions are
independent and intentional — see
[docs/README.md](docs/README.md#start-here) and the version table below.

| Component | Version | Rationale |
|---|---|---|
| Console (`frontend`) | 2.0.0 | Two majors past the initial vanilla-JS console |
| Backend (`backend`) | 1.0.0 | First supported release of the current API |
| ML service (`ml-service`) | 0.2.0 | Service contract still evolving |

The repository release is identified by its tag, not by a shared version
number across components.

## Limitations

Read [KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) before evaluating this
project. In summary: synthetic data only, no plant connectivity, no equipment
control, heuristic fallback when ML is offline, and model output that is
indicative rather than authoritative.

## Ownership

Karkala Shiva Reddy. See [docs/OWNERSHIP.md](docs/OWNERSHIP.md).
