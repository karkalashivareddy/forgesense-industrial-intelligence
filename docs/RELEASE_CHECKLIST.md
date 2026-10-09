# ForgeSense — Release checklist

Verification gate for the ForgeSense release. Every box is the result of an
executed command, not an intention. Re-run the whole list after any change that
touches `frontend/src`, `infra/nginx`, or the backend contracts.

This is historical evidence from the 2026-10-06 release audit. The repository
has changed since that run, so checked items below are not current release
approval. Current verification for the 2026-10-09 checkout is recorded in
[`ENGINEERING_AUDIT.md`](ENGINEERING_AUDIT.md); Playwright and Docker runtime
checks remain unverified in that run.

## Evidence provenance

This checklist mixes two kinds of check, and they are labelled separately:

- **Sections marked _executed_** were run in the final repository audit pass
  against the real stack (backend `dev` profile + ML service serving live
  inference). The counts quoted are the observed output of those commands.
- **Section "Not re-verified in this pass"** lists checks that require the
  Docker Compose topology or a browser session. They were executed during the
  original release verification but could **not** be re-executed in the audit
  pass, so they are recorded as prior evidence rather than as a fresh result.
  Do not read them as verified by the audit pass.

---

## Code

- [x] **TypeScript clean** — `npm run typecheck`, strict, tests included
- [x] **Unit tests passing** — 98 Vitest
- [x] **E2E passing** — 43 Playwright (30 functional + 13 visual), all green against the live stack
- [x] **Production build** — `npm run build` clean
- [x] **Debug-artifact gate** — `npm run lint:artifacts`, 41 files, clean
- [x] **Documentation link check** — `npm run check:docs`, 132 links across 67 files, 0 broken
- [x] **No console errors** — asserted on all 12 workspaces, 0 page errors in an independent sweep
- [x] **No network errors** — 0 failed requests across a 12-route walk
- [x] **No unexpected overflow** — 40 combinations (5 breakpoints × 8 workspaces)
- [x] **Responsive verification** — 375 / 768 / 1024 / 1440 / 1920
- [x] **Accessibility verification** — skip link, landmarks, heading order, focus management, tabs, reduced motion
- [x] **Realtime lifecycle verified** — WebSocket transport, events applied 9 → 36 over 10s, data basis SYNTHETIC
- [x] **Three.js cleanup verified** — scene disposes on navigation; no orphaned canvas
- [x] **Chart cleanup verified** — ECharts disposed on unmount, `setOption` on change (not re-instantiated)
- [x] **Error isolation verified** — one endpoint aborted at a time; siblings keep rendering
- [x] **Error states distinct from empty states** — a failure never renders as "no data"

## Machine learning

- [x] **ML service runs** — `uvicorn app.main:app` on :8001, `failure-risk-v2` / `anomaly-model-v2` loaded
- [x] **Real inference verified** — `POST /assess` returns risk, anomaly, RUL in steps, and 5 attribution factors
- [x] **Artifacts validated** — `artifact_hash` and `profiles_hash` reported by `/health`
- [x] **Heuristic fallback verified** — with the service stopped, a reset fleet scores risk 0.223–0.584 and zero assets above the 0.70 threshold
- [x] **Fallback scores against each asset's own profile** — per-type baselines from `config/machine_profiles.json`, so healthy assets are not reported as anomalous
- [x] **Fallback is labelled, never silent** — mode reads `HEURISTIC`, model version `heuristic-v2`, and the console states the degradation

## Security

> The header items below are prior-release results verified **on the wire**
> through nginx. The audit pass had no Compose stack, so they are recorded as
> prior evidence, not as a fresh result. Authorization and the session model
> _were_ re-verified in the audit pass against the running backend.

- [x] **Authorization enforced server-side** — `operator` → 403 on `POST /api/v1/simulation/control`; `admin` accepted
- [x] **Role gating in the UI matches the server** — inject control disabled for operator with the reason shown
- [x] **Cumulative role model** — operator, engineer, admin; backend expands each to ROLE_* authorities
- [x] **CSP served** — on `/`, deep links, hashed assets, `/healthz`
- [x] **X-Frame-Options** — `DENY` (+ `frame-ancestors 'none'`)
- [x] **nosniff** — `X-Content-Type-Options`
- [x] **Referrer-Policy / Permissions-Policy** — `no-referrer`; geolocation, microphone, camera disabled
- [x] **No CDN runtime dependencies** — three/echarts via npm, 3 woff2 served locally, no import map
- [x] **No unsafe HTML** — zero `innerHTML`, zero `dangerouslySetInnerHTML`
- [x] **No `unsafe-eval` in CSP**
- [x] **No secrets committed** — `.env` untracked, `.env.example` present, no keys in tracked source
- [x] **Password never stored** — no credential in `sessionStorage`, `localStorage` or a cookie; the JWT is `sessionStorage`-scoped and discarded when the tab closes
- [x] **No dead CSP** — headers verified on the wire, not just in the config

> Worth re-checking every release: nginx does not inherit `add_header` into a
> location that declares one. Verify on the **wire**, e.g.
> `curl -sI http://localhost:5173/ | grep -i content-security-policy`.

## Truthfulness

- [x] **No fake metrics** — every displayed value traced to an endpoint
- [x] **No fabricated ML values** — real `failure-risk-v2` output; saturation documented, not spread
- [x] **No fabricated timestamps** — server-supplied; freshness shown as `OLDEST READING <n>s ago`
- [x] **No fake RUL** — displayed in simulator `steps`, never converted to hours
- [x] **No fake confidence scores** — none exist, so none shown
- [x] **Synthetic provenance visible** — header chip, status strip, per-tile basis chips, footer
- [x] **Units correct** — °C, mm/s, rpm, N·m, A, V, kW, Hz, %, steps
- [x] **No unsupported AI/accuracy claims** — no "AI-powered", no "guaranteed"
- [x] **No physical-control implication** — no fieldbus client exists; the boundary is stated on every screen
- [x] **Unavailability ≠ zero** — missing sensors render unavailable, not `0`
- [x] **Limitations documented** — [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) and README

## Docker

> Requires the Compose topology. **Not re-verified in the audit pass** — the
> Docker daemon was not available. These are prior-release results; re-run
> `docker compose up -d --build --force-recreate` and confirm before relying
> on them.

- [x] **Clean build** — `npm ci` against the committed lockfile
- [x] **Container healthy** — all 9 services `Up (healthy)`
- [x] **nginx SPA fallback** — direct load of `/command` returns 200
- [x] **Security headers served** — all 5, on every path
- [x] **Production bundle loads** — hashed assets, immutable caching
- [x] **Missing asset returns 404** — not a silently-200 `index.html`
- [x] **`/healthz` responds** — drives the container HEALTHCHECK
- [x] **No stale bundle** — `--force-recreate` documented and used

## Git

- [x] **Working tree clean**
- [x] **Branch verified** — `main`
- [x] **No accidental files** — no scratch scripts, no `package.json` at repo root, no build output
- [x] **No debug artifacts** — no `console.log`, no `debugger`, no `TODO`/`FIXME`/`HACK`
- [x] **No stale file references in current docs** — audited for references to files deleted in the re-architecture; `DEPLOYMENT.md` and `REALTIME.md` corrected
- [x] **No temporary scripts committed** — probe scripts kept outside the repository
- [x] **History intact** — no reset, no force push, no rebase of published work
- [x] **`.env` untracked**

## Documentation

- [x] **README** — what it is, architecture, stack, run, rebuild, test, demo, limits
- [x] **Architecture matches reality** — `ARCHITECTURE.md` rewritten; the pre-React claims are corrected in-place
- [x] **Data flow matches reality** — `DATA_FLOW.md` rewritten with real endpoint and event names
- [x] **Contract matrix** — verified envelope per endpoint
- [x] **Demo runbook** — verified end to end, with observed values
- [x] **Viva guide** — architecture, ML, security, performance, limitations
- [x] **Evidence plan** — what each screenshot proves
- [x] **Screenshots real** — captured from the running system, none edited

---

## Commands to re-run the full gate

```bash
# 1. Static + unit + build
cd frontend
npm ci
npx tsc --noEmit -p tsconfig.json
npm test
npx vite build

# 2. Container
cd ..
docker compose up -d --build --force-recreate frontend
docker compose ps

# 3. Browser suite
cd frontend
E2E_BASE_URL=http://localhost:5173 npx playwright test

# 4. Security headers on the wire
curl -sI http://localhost:5173/ | grep -iE "content-security-policy|x-frame-options|x-content-type|referrer-policy|permissions-policy"

# 5. Clean up generated output
rm -rf frontend/dist frontend/test-results frontend/playwright-report
```

## Known non-blockers

| Item | Why it is not a blocker |
|---|---|
| Twin frame rate unmeasurable in CI | the browser uses SwiftShader (software rendering). The GPU-independent property — zero idle draw calls — is asserted instead. |
| `1/TODO`-style backlog | none. No known open defect. |
| Stress/load testing not performed | single-node demo topology, out of scope for release. |
| Backend unit tests re-run in the audit pass | 61/61 green (`./mvnw test`). |
