# Engineering audit

Audit date: 2026-10-09
Baseline branch: `main`
Baseline commit: `43be48bbced1e0793975902fb49cad4b50ba8f73`

This record is based on the checked-out files and commands run in this
environment. Claims in older release and audit reports are historical and are
not current verification evidence.

## Baseline architecture

- React 18, TypeScript, Vite, TanStack Query, Zustand, Three.js and ECharts in
  `frontend/`; Vite provides development and Playwright preview servers.
- Spring Boot 4.1 / Java 25 backend in `backend/`; REST controllers, JPA,
  Spring Security/JWT, STOMP over WebSocket, and health/metrics endpoints.
- FastAPI / Python 3.13 service in `ml-service/`; scikit-learn anomaly,
  failure-risk and synthetic-step RUL artifacts generated on first startup.
- Python simulator in `simulator/` emits explicitly synthetic telemetry and
  scenario data.
- Compose services: PostgreSQL 17, Redis 7, single-node Kafka 3.7, ML API,
  backend, simulator, nginx frontend, Prometheus and Grafana.
- Local backend `dev` profile uses file-backed H2, in-memory event bus/cache;
  Compose uses PostgreSQL, Redis and Kafka.

## Runtime surface inventory

- Frontend route table (`frontend/src/app/routes.ts`): `/command`, `/twin`,
  `/fleet`, `/telemetry`, `/predictions`, `/anomalies`, `/analytics`, `/alerts`,
  `/maintenance`, `/events`, `/simulation`, `/system`.
- Backend REST controller roots: `/api/v1/auth`, `/api/v1/factories` and
  `/zones`, `/api/v1/machines`, `/api/v1/telemetry`, `/api/v1/analytics`,
  `/api/v1/events`, `/api/v1/alerts`, `/api/v1/maintenance`, `/api/v1/impact`,
  `/api/v1/system`, and `/api/v1/simulation` plus `/api/v1/simulator`.
  Exact methods/subpaths are declared in the corresponding controller classes
  and summarized in `docs/API_FRONTEND_CONTRACT.md`.
- WebSocket endpoints `/ws` and `/ws/telemetry`; authenticated STOMP
  subscriptions use `/topic/**`. Current emitted topics include
  `alert.created`, `alert.updated`, `impact.updated`, `events.updated`,
  `maintenance.created`, `maintenance.updated`, `prediction.updated`,
  `machine.updated`, `machine.state.changed`, `telemetry.updated`,
  `simulation.control.updated`, `simulation.global.updated`, and
  `simulation.updated`.
- ML service exposes `/health` and `/assess`; Compose limits reachability to
  the backend through the internal inference network. Artifacts and synthetic
  training are implemented; no model registry or real telemetry path exists.
- Persistence uses JPA entities with Hibernate `ddl-auto: update`; there is no
  versioned database migration directory. Background behavior includes the
  backend synthetic demo producer and the separate telemetry simulator.
- Test suites are frontend Vitest + Playwright, backend JUnit/Spring tests, and
  ML pytest. Compose integration and cross-service E2E are workflow/runtime
  tasks, not currently executable in this environment.

## Baseline repository state and environment

- `git status --short --branch`: clean, `## main...origin/main`.
- `git branch --show-current`: `main`.
- `git rev-parse HEAD`: `43be48bbced1e0793975902fb49cad4b50ba8f73`.
- Recent history begins with Compose-required secrets and includes prior audit
  and release documentation; tag `v1.0.0-industrial-operations` exists.
- Ignored local `.env` and service log files were present in the workspace and
  preserved. `.env` contents were not read.
- Node `v24.19.0`; Java `25`; Docker `29.7.2`; Compose `v5.4.0`.
- `npm` PowerShell shim is blocked by execution policy; `npm.cmd` works.
- Python launchers `python.exe` and `py.exe` were inaccessible to this process.
- Maven wrapper PowerShell invocation failed before Maven launch with
  `Cannot index into a null array` / `Cannot start maven from wrapper`.
- `gh auth status` reports the configured token is invalid; remote Actions API
  request also failed due to sandbox network restrictions. Remote CI is
  unverified.

## Baseline command evidence

| Command | Result |
|---|---|
| `npm.cmd ci --no-audit --no-fund` (`frontend/`) | Exit 0; 168 packages installed. npm noted an unapproved `esbuild` install script. |
| `npm.cmd run verify` (`frontend/`) | Docs links (133 across 67 Markdown files), artifact gate (41 source files), and TypeScript typecheck completed. Vitest failed to start: esbuild `Cannot read directory "../..": Access is denied` while loading `vitest.config.ts`; exit 1. Production build did not run because the script stopped at tests. |
| `./mvnw.cmd -q clean verify` (`backend/`) | Exit 1 before Maven; wrapper PowerShell error above. Backend suite unverified. |
| `py -3.13 --version`, pip and pytest attempts (`ml-service/`) | Process creation denied for `py.exe`; ML dependency/test suite unverified. |
| `docker compose version` | Exit 0; v5.4.0. |
| `docker compose config` | Not run at baseline. |
| `gh run list ...` | Remote state unavailable: invalid GitHub token and blocked API connection. |

## Post-change verification

| Command | Result |
|---|---|
| `npm.cmd run verify` (`frontend/`) | Exit 0. 137 documentation links across 69 Markdown files; artifact gate scanned 41 source files; strict typecheck passed; 6 Vitest files / 98 tests passed; Vite production build completed (2,268 modules). Node 24.19.0. |
| `./mvnw.cmd -q clean verify` (`backend/`) | Exit 0 with Java 25. Surefire: 64 tests, 0 failures/errors/skips, including RBAC (10), JWT key policy (3), and STOMP authentication (5). Lombok/Mockito emitted JDK dynamic-agent warnings. |
| `& .\\.venv\\Scripts\\python.exe -m pytest tests -q` (`ml-service/`) | Exit 0 with Python 3.14.6 (project documents 3.13): 10 passed. Three dependency/cache warnings; tests include grouped-split determinism, RUL cohort isolation, and API checks. |
| `& .\\.venv\\Scripts\\python.exe -m pip check` (`ml-service/`) | Exit 0; no broken installed requirements. Python 3.14.6 environment; clean Python 3.13 install not available. |
| `npm.cmd audit --audit-level=high` (`frontend/`) | Exit 0; registry reported 0 known vulnerabilities for the lockfile dependency tree. |
| `& .\\.venv\\Scripts\\python.exe -m pip_audit --local` (`ml-service/`) | Initial scan found vulnerable local `pip 26.1.2` and `pytest 8.4.2`; the pytest constraint was updated and local tools upgraded to pip 26.2.1 / pytest 9.1.1. Re-scan exit 0: no known vulnerabilities. The scanner ran against Python 3.14.6, not the documented Python 3.13 runtime. |
| ML artifacts generated by pytest app startup | `synthetic-generator-v4`, evaluation at `2026-10-09T05:39:44.688366+00:00`, 8 held-out machine groups, 7,200 rows. See `docs/ML_PROVENANCE.md` for actual metrics. |
| `& .\\.venv\\Scripts\\python.exe scripts\\train.py` (`ml-service/`) | Exit 0; loaded the now-current v4 artifacts in 1.4 s. The metrics above were regenerated during pytest startup after the schema bump; this later invocation validated the documented command against the current cache. |
| `docker compose --env-file .env.example config --quiet` | Exit 0 using sanitized placeholders. Docker daemon unavailable (named pipe missing), so build/start/network rules are not runtime-verified. |
| Compose ML isolation assertions | Exit 0: no ML host port; ML and backend share `ml-inference`; network is `internal: true`. Same assertions were added to the Docker CI job; remote execution remains unknown. |
| GitHub workflow YAML parse | Exit 0 with PyYAML; `jobs.docker` and the CI workflow document parsed. Remote action execution remains unknown. |
| `git diff --check` | Exit 0. |
| `gh run list ...` | Still unverifiable: invalid token and blocked GitHub API network. |

An additional selected-format history check scanned reachable Git objects and
current changed/untracked files for AWS access-key IDs, common GitHub/Slack/
Google token prefixes, and PEM private-key headers. It found no matches. This
narrow check is not equivalent to Gitleaks/TruffleHog and does not establish
that repository history is secret-free.

After the first push, the official Gitleaks 8.29.1 Windows binary was downloaded
to a temporary directory and matched its published SHA-256 checksum. Its
redacted full-history scan covered 71 commits / approximately 2.84 MB and found
one `generic-api-key` pattern in the deterministic 48-byte test key in
`backend/src/test/java/com/forgesense/security/JwtServiceTest.java` at commit
`994183fcf930c109e0014cc48cc0320d3d09b1ef`. Inspection established that it was
a synthetic JUnit-only signing fixture, never a deployment credential; no key
rotation is indicated. The current test now generates an ephemeral key using
`SecureRandom`, and a redacted Gitleaks directory scan of that current test file
found no leaks. The historical test vector remains in public history; history
was not rewritten.

The release hardening diff adds read-only workflow permissions, finite job
timeouts, npm audit at high severity, and a Python `pip-audit` check after
upgrading pip to the fixed 26.2 line. The Maven dependency graph and full Git
history have not been checked by a dedicated vulnerability/secret scanner.

An OWASP Dependency-Check 13.0.0 scan was attempted with
`./mvnw.cmd -q org.owasp:dependency-check-maven:13.0.0:check
-DfailBuildOnCVSS=7 -DskipTest=true`. It exited 1 before analysis because no
NVD API key was configured (`Invalid API Key, length of 0`) and no local NVD
data existed. This is an unavailable advisory-data input, not a clean Maven
vulnerability result. The owner can rerun it with an NVD API key supplied via
the scanner's environment/property configuration; do not commit that key.

## Confirmed findings

### High — ML host port exposed without authentication

At baseline `docker-compose.yml:49-57` published `ml-service` port 8001 to
every host interface, while `ml-service/app/main.py:111` exposed `/assess` without
authentication. CORS did not protect direct clients. This allowed untrusted
host/network clients to submit arbitrary inference workloads and inspect model
health/diagnostics. Compose no longer publishes the port and restricts access
to an internal network shared with the backend. Regression: Compose config must
resolve without an ML host port mapping.

### High — synthetic ML row split leaked machine trajectories

`ml-service/app/models.py` (baseline `_build_or_load`, current grouped split at
lines 239-247) randomly selected rows for evaluation even though
many rows came from the same generated machine timeline. The published AUC/RMSE
values therefore overstated generalization. Those values have been withdrawn.
Evaluation now groups by generated machine trajectory, selects the anomaly
threshold from training healthy samples, evaluates RUL only on its
failure-risk-positive target population, reports classification/calibration
metrics and baselines, and fails if either holdout target lacks both classes.
The full ML suite generated metrics under this protocol. Regression:
`ml-service/tests/test_grouped_evaluation.py` asserts deterministic disjoint
groups.

### Medium â€” RUL evaluation included samples outside the regressor target cohort

The RUL model is fitted only to failure-risk-positive rows, while its earlier
evaluation scored every row with a nonzero generated RUL. Evaluation now uses
the same failure-risk-positive holdout cohort as training. The pytest startup
retrained and regenerated the metric artifact after the evaluation schema
version bump; current MAE/RMSE are reported in `docs/ML_PROVENANCE.md`.

### Medium â€” explicit short JWT key silently fell back in demo mode

`backend/src/main/java/com/forgesense/security/JwtService.java:50-63` accepted configured keys from 32 characters, below the
documented 48-byte minimum; a shorter non-empty value in demo mode was silently
ignored in favor of an ephemeral random key. The service now rejects any
explicit key under 48 UTF-8 bytes, and JUnit covers short-key rejection,
strong-key signing/parsing, and missing-key rejection outside demo mode. CI
now generates and masks fresh throwaway credentials per job.

### Medium â€” Windows Maven wrapper failed on a normal cache directory

`backend/mvnw.cmd:92-96` indexed `.Target[0]` on a regular `.m2` directory; PowerShell
raised `Cannot index into a null array`, preventing Maven from starting. The
wrapper now checks for an empty target and handles normal directories. The
full `clean verify` run then passed.

## Potential risks and unverified assumptions

- The ML API has no service authentication; the updated Compose topology
  restricts it to an internal network shared with the backend. Other Compose
  deployments must preserve this boundary or add service authentication.
- No real industrial dataset, plant integration, physical control path,
  production deployment, load test, or high-availability evidence is present.
- Backend, simulator, and ML container processes use their image defaults; a
  non-root container runtime has not been verified. Image builds and runtime
  hardening remain open because the Docker engine is unavailable.
- Testcontainers-backed PostgreSQL parity and migration-from-empty behavior
  are not verified here; Compose currently configures Hibernate `ddl-auto:
  update` rather than a versioned migration tool.
- GitHub CI status and repository history secret scanning could not be
  independently verified from this environment.
- Full browser E2E workflows, full-stack Compose startup/recovery, dependency
  vulnerability scan, and Docker image builds remain unverified until a Docker
  daemon and remote CI results are available.

## Prioritized remediation and current disposition

1. Withdraw row-split ML claims and implement grouped synthetic trajectory
   evaluation. Code, regression test, and generated metric report verified.
2. Remove host exposure of unauthenticated ML API. Compose now uses an internal
   backend/ML network and has no host mapping; config passes, Docker runtime is
   unavailable here.
3. Run frontend, backend and ML gates. All three pass locally. Compose image
   build and startup remain blocked by the unavailable Docker daemon.
4. Review runtime authorization, WebSocket authorization, model validation,
   telemetry workflows, and recovery tests against the current code. Existing
   tests/docs provide partial coverage; complete execution remains pending.
5. Update all metric and test-count claims only from newly executed evidence.
