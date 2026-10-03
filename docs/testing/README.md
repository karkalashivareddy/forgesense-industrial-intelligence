# Testing

What ForgeSense actually verifies, how to run it, and what each layer proves.

## Layers

| Layer | Location | What it proves |
|---|---|---|
| Frontend unit | `frontend/test/` (Vitest) | Adapters, formatters, state derivation, design tokens |
| Frontend E2E | `frontend/e2e/` (Playwright) | Routing, auth, realtime, resilience, accessibility, scenarios |
| Visual QA | `frontend/e2e/visual.spec.ts` | Layout, responsive breakpoints, twin rendering, console cleanliness |
| Backend | `backend/src/test/` (JUnit 5) | State machine, decision engine, RBAC, validation, STOMP auth |
| ML | `ml-service/tests/` (pytest) | Inference contract, artifact provenance, feature schema |

## Running

```bash
# Frontend — the same gate CI runs
cd frontend
npm run verify      # doc links, artifact gate, typecheck, unit, build
npm test            # 98 Vitest
npm run e2e         # 43 Playwright (30 functional + 13 visual)

# Backend
cd backend && ./mvnw test                    # 61 JUnit

# ML
cd ml-service && python -m pytest tests -q   # 8 pytest
```

## Current results

| Suite | Result |
|---|---|
| Vitest | 98 / 98 |
| JUnit | 61 / 61 |
| pytest | 8 / 8 |
| Playwright | 43 / 43 |

All run on every push in GitHub Actions.

## Repository checks

| Check | Command | Enforces |
|---|---|---|
| Documentation links | `npm run check:docs` | Every relative link resolves; directory links have an index; anchors exist |
| Debug artifacts | `npm run lint:artifacts` | No console calls, `debugger`, `TODO`/`FIXME`/`HACK`, or raw DOM writes in `frontend/src` |
| Secret scan | CI hygiene job | No tracked credential defaults |

`check:docs` and `lint:artifacts` both run in the Frontend CI job, so a broken
link or a stray `console.log` fails the build rather than being noticed later.

## What the E2E suite covers

`frontend/e2e/app.spec.ts` exercises the product against a real backend:

- boot, sign-in, session restore, and sign-out
- all twelve workspaces on a direct deep link, and navigation between them
- asset selection opening the inspector and persisting across workspaces
- that remaining-useful-life is never presented as a time unit
- truthful realtime connection state, and that `LIVE` is never claimed for
  synthetic data
- the status strip exposing transport and data basis
- error states when the backend is unreachable, and when the ML service is
  unavailable, without fabricating confidence
- scenario analysis separated from live feed injection, and an injected
  scenario reflected in the console
- accessibility: skip link as first tab stop, landmark structure, focus
  management on route change, command palette, reduced motion

`frontend/e2e/visual.spec.ts` covers layout across breakpoints, mobile
navigation, the 3D scene lifecycle, and asserts no console or network errors
across a full workspace walk.

## Running E2E locally

Playwright needs the backend and the console. With the ML service running the
suite exercises the model path; without it the suite still passes and verifies
the labelled fallback.

```bash
# terminal 1
cd backend && ./mvnw spring-boot:run

# terminal 2 (optional)
cd ml-service && .venv/Scripts/python -m uvicorn app.main:app --port 8001

# terminal 3
cd frontend
E2E_BASE_URL=http://127.0.0.1:4173 npm run e2e
```

If `E2E_BASE_URL` is unset, Playwright builds the console and starts
`vite preview` itself.

## Runtime verification beyond the suites

Some guarantees are verified by exercising the running system rather than by a
unit test, and are recorded in
[../RELEASE_CHECKLIST.md](../RELEASE_CHECKLIST.md):

- ML inference against the trained artifacts, across all eight machine types
- server-side authorization: `operator` receives 403 on a control endpoint
- the scenario lifecycle end to end: healthy → degraded → cleared → recovery
- realtime event counters advancing over a live WebSocket

## Adding tests

- A bug fix needs a regression test that fails without the fix.
- Adapters deserve a test whenever an endpoint envelope changes; an adapter
  that guesses wrong yields an empty result, which is indistinguishable from a
  genuinely empty one and is caught by no type error.
- Keep loading, empty and error states distinct in both the UI and its tests.