# CI Release Verification

Forensic repair of the ForgeSense release pipeline. Every failure below was
reproduced locally and the root cause established before any code was changed.
No test was weakened, no check was converted to a warning, no tag was moved.

## Previous failure

* **Workflow:** `ForgeSense CI`
* **Run:** `36655402593`'s predecessor, `36583580984` (commit `65b8f20`)
* **Failing job:** `Backend (Spring Boot 4)` — `Boot smoke test`, exit code `22`
* **Reported symptom:** `curl -sf http://localhost:8080/api/v1/factories` and
  `curl -sf http://localhost:8080/actuator/health`; `curl -f` prints nothing on
  an HTTP error, so the log showed only a bare exit code.
* **Classification:** environment/configuration and timing defect in the smoke
  test, plus a genuine application defect in dev-profile health reporting.

### Root cause 1 — the smoke test raced application readiness

`/api/v1/factories` is served as soon as Tomcat accepts connections, but the
application is not *ready* until `ApplicationReadyEvent` completes.
`DemoPredictionSeeder` runs there and takes several seconds against a cold H2
file. Until then `readinessState` is `REFUSING_TRAFFIC`.

Instrumenting the run proved it (run `36601235768`):

```
16:43:08.931  Started ForgeSenseBackendApplication in 9.305 seconds
16:43:09.412  factories status: 200     <- poll succeeded
16:43:09.510  health status:    503     <- asserted 0.5s later
16:43:09.525  health body:      {"groups":["liveness","readiness"],"status":"OUT_OF_SERVICE"}
16:43:11.641  DemoPredictionSeeder ... seeded: 144 predictions   <- 2.2s LATER
```

`OUT_OF_SERVICE` with no `DOWN` contributor is `readinessState`, not `mlService`.
The smoke test polled the wrong signal. Reproduced locally on a cold database:
API answers 200 at **13.5 s**, health turns 200 only at **17 s**.

### Root cause 2 — dev profile reported DOWN for an optional dependency

`MlHealthIndicator` is `@Component("mlService")` and returns `Health.down()`
when the ML service is unreachable, which drags the aggregate to 503. The `dev`
profile is designed to run without it (in-memory cache, Kafka disabled, gateway
falls back to the heuristic scorer) and already disables the `redis` and `kafka`
indicators for exactly that reason — `mlService` was simply omitted.

`management.health.mlService.enabled` does **not** fix this: that property only
filters auto-configured indicators, and this one is a hand-written `@Component`.
Both `mlService` and the kebab-case `ml-service` were tested and had no effect.

### Root cause 3 — E2E boot stack tore down the stack it had just started

`.ci/boot-stack.sh` combined `trap cleanup EXIT` with `exit 0` on success, so
`docker compose down -v` ran the instant the backend became ready — before
Playwright started. This was latent and invisible: the script never reached
`exit 0` because its probe used an authenticated endpoint.

### Root cause 4 — the E2E browser origin was not in the CORS allowlist

`FORGESENSE_ALLOWED_ORIGINS` was hardcoded to `http://localhost:5173` in
`docker-compose.yml`, so it could not be overridden. Playwright serves the
console with `vite preview` on **4173**, and the frontend calls the backend
cross-origin (`VITE_API_BASE_URL` defaults to `http://localhost:8080`). The
browser blocked every API call: the gate rendered, sign-in never completed, and
**42 of 43 tests timed out over 36.9 minutes**.

### Root cause 5 — the E2E script probed an authenticated endpoint

`boot-stack.sh` polled `/api/v1/factories`, which `SecurityConfig` does not
permit anonymously, so `curl -sf` always got 401 and the script always timed out
after 90 s. Only `/api/v1/auth/**`, `/actuator/health/**`, `/ws/**` and
`/error` are `permitAll`.

### Root cause 6 — file mode and artifact path

`.ci/boot-stack.sh` was committed as `100644`, so the step failed with exit 126
(`Permission denied`) — the executable bit is not preserved by a Windows clone.
The Playwright report was uploaded from `frontend/playwright-report` while the
job's working directory was already `frontend`, so the report was never
captured.

## Fix

| File | Change | Why correct |
| --- | --- | --- |
| `.github/workflows/ci.yml` | Boot smoke test polls `/actuator/health` until ready, with a 120 s budget and an explicit `::error::` on timeout | Waits for the real readiness signal instead of racing the seeder. Strictly stronger than before: both endpoints are still asserted with `curl -sf` |
| `.github/workflows/ci.yml` | Smoke test prints status codes and the health body before asserting | A bare `curl -f` exit code is undiagnosable; this is what found root cause 1 |
| `.github/workflows/ci.yml` | Trigger extended to `release/**` branches and `v*` tags | Release pushes and tags are now CI-covered; no duplicate workflow created |
| `.github/workflows/ci.yml` | E2E stack invoked via `bash`, teardown moved to an `if: always()` step with compose placeholders | Removes the file-mode dependency, and the stack is now torn down *after* the browser run |
| `.github/workflows/ci.yml` | Playwright report path corrected to `playwright-report` | Relative to the job working directory |
| `.ci/boot-stack.sh` | Teardown only on failure; success leaves the stack up | Fixes root cause 3; the workflow owns teardown |
| `.ci/boot-stack.sh` | Probes the unauthenticated `/actuator/health` | Fixes root cause 5; readiness is the correct signal anyway |
| `.ci/boot-stack.sh` | Exports `FORGESENSE_ALLOWED_ORIGINS` including `http://127.0.0.1:4173` | Fixes root cause 4 with explicit origins, no wildcard |
| `backend/.../MlHealthIndicator.java` | `forgesense.ml.health-indicator.required`, default `true` | Fixes root cause 2. The default keeps production and docker behaviour identical |
| `backend/src/main/resources/application-dev.yml` | Sets `forgesense.ml.health-indicator.required: false` | The dev profile genuinely runs without ML |
| `docker-compose.yml` | `FORGESENSE_ALLOWED_ORIGINS` made overridable, default unchanged | Lets CI add its origin without editing the file |
| `.ci/boot-stack.sh` | Mode `100644` -> `100755` | Fixes root cause 6 |

`MlHealthIndicator` is the only application source change. It does not alter
authentication, authorization, the prediction model, or ML behaviour: with the
default `required=true` it returns `Health.down()` exactly as before, which was
verified explicitly.

## Local verification

| Check | Result |
| --- | --- |
| Backend `./mvnw test` | **61/61 pass** with security **enabled** |
| `SecurityRbacIntegrationTest` | 10/10 pass |
| `StompAuthenticationInterceptorTest` | 5/5 pass |
| Frontend typecheck | clean |
| Frontend Vitest | 86/86 pass |
| ML train/load | 11 features |
| ML pytest | 8/8 pass |
| `docker compose config --quiet` | exit 0 |
| `docker compose build frontend` | exit 0 |
| Boot smoke, cold H2, ML unreachable | API 200 at 13.5 s, health 200 at 17 s |
| Boot smoke, `required=true` (prod default) | health **503** — original strict behaviour preserved |
| Compose origin override | `http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:4173` |

## Remote CI

* **Run:** [36655402593](https://github.com/karkalashivareddy/forgesense-industrial-intelligence/actions/runs/36655402593)
* **Workflow:** `ForgeSense CI`
* **Commit:** `72de9734217813ee18c88bf43e56a0360973dcbb`
* **Branch:** `main`
* **Event:** `push`
* **Conclusion:** **success**

| Job | Result |
| --- | --- |
| Repository hygiene | success |
| Frontend (typecheck, build, unit) | success |
| Backend (Spring Boot 4) | success |
| ML service (FastAPI) | success |
| Docker build | success |
| Frontend E2E (Playwright) | success — **43 passed (2.2m)**, no longer skipped |

E2E went from 1 passed / 42 failed to 43 passed. The Playwright HTML report is
now captured as an artifact.

## Release integrity

* **`v1.0.0-industrial-operations` tag:** `0d52d545` -> `a0363a1`
* **Tag moved:** **NO.** Not moved, not deleted, not recreated, not force-updated.
* **Release branch HEAD:** `72de973`
* **CI-tested SHA:** `72de9734217813ee18c88bf43e56a0360973dcbb`
* **Force push used:** **NO.** `65b8f20` remains an ancestor of `main`; every
  push in this repair was a fast-forward.

The tag predates this repair. **`a0363a1` does not contain these CI fixes** and
its CI was red when tagged. The first CI-green commit is `e011783`, and the
fully green release state is `72de973`. If a fully CI-verified release artifact
is required, publish `v1.0.1-industrial-operations` at `72de973`; `v1.0.0` must
remain where it is.

## Remaining limitations

Real ones only:

* `v1.0.0` still points at a commit whose CI was red. It is immutable by
  instruction, so this cannot be corrected in place.
* The tag also predates the attribution repair, so the `v1.0.0` tag view still
  shows the original commit message. `main` carries the clean history.
* The boot smoke test still disables security for its own process, by design.
  This is step-scoped only; `./mvnw package` and the Playwright run both keep
  security enabled, which is why E2E exercises real authentication.
* The dev profile treats the ML service as optional for health purposes. The
  `docker` profile and every production path keep `required=true`.
