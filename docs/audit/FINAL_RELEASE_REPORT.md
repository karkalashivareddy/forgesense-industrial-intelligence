# ForgeSense — Final release report

<!-- forge:historical -->
> **Historical audit record.** This document captures a point-in-time review.
> It is kept as evidence of what was checked and when, and is **not** a
> description of the current system. For current behaviour see the [docs index](../README.md)
> index and the source. Several claims here were superseded after the review —
> notably the frontend re-architecture and the transport/model-truth corrections.

Release packaging and evidence collection, 2026-09-29. Every number below was
produced by a command executed during this pass; nothing is copied forward from
an earlier report without re-running it.

---

## 1. Release status

| Item | Value |
| --- | --- |
| **Branch** | `feat/industrial-operations-ui` |
| **HEAD at verification** | `6cae465` (plus this packaging commit) |
| **Working tree** | clean — no untracked, no stashes |
| **TypeScript** | `tsc --noEmit` strict, tests included — **clean** |
| **Unit tests** | **83 passed** (5 files) |
| **E2E** | **43 passed** (30 functional + 13 visual) |
| **Production build** | `vite build` — **clean** |
| **Docker build** | **clean** (`npm ci` against committed lockfile) |
| **Docker startup** | frontend `Up (healthy)`; all 9 services healthy |
| **Console errors** | **0** across all 12 workspaces |
| **Uncaught exceptions** | **0** |
| **Unexpected failed requests / 4xx / 5xx** | **0** |
| **Horizontal overflow** | **0** across 60 combinations |
| **Broken routes** | **0** — 12 routes × direct/back/forward |
| **Duplicate WebSocket connections** | **0** — exactly 1 created |
| **Duplicate Three.js render loops** | **0** |

---

## 2. Architecture (summary)

Full detail: [`ARCHITECTURE.md`](../ARCHITECTURE.md).

A single-node event pipeline: **Simulator → `POST /api/v1/telemetry/ingest` →
event bus (or Kafka) → normalize → digital twin → ML service → decision engine →
WebSocket broadcast**, with REST as the reconciliation authority.

The frontend is React 18 + TypeScript + Vite, built and served by nginx. State is
split into **four stores by update frequency** — UI state (Zustand), server state
(TanStack Query, one key per resource), transport state, and a **separate
high-frequency telemetry store** whose live values are read by only 3 components.
That last split is the central performance decision: an 18-asset feed at 5 s is
~3.6 events/second, and the transport coalesces per entity and dispatches **once
per animation frame**, so it never re-renders the console.

**The most consequential finding of this pass was documentary, not structural:**
`ARCHITECTURE.md` and `DATA_FLOW.md` still described the pre-React console —
"vanilla ES-module JS + Three.js via CDN", "the dashboard does not subscribe to
WebSocket; the browser's verified transport is REST polling", and a reference to
`frontend/js/app.js`, a file deleted in the re-architecture. All three were
wrong. Both documents are rewritten, and the corrections are recorded in place
(`ARCHITECTURE.md` §10) rather than silently overwritten.

---

## 3. Reliability — defects found and fixed

### Fixed in this packaging pass

| # | Defect | Impact | Fix |
|---|---|---|---|
| 1 | **Docs claimed REST polling as the browser transport** | A reviewer would design around a false architecture | Rewrote `ARCHITECTURE.md` + `DATA_FLOW.md` against source and the live API; corrections logged in-place |
| 2 | **README demo used M-105, which is `CRITICAL` at rest** | Following the README produced **no visible change** — the demo looked broken | Switched the runbook to **M-104** (NORMAL at rest, verified transition, fully recoverable) |
| 3 | **README claimed alert/maintenance counts increase on injection** | They do **not** — all 18 assets already hold 2 alerts + 1 work order. A fabricated claim | Corrected to the demonstrable change: state transition, health drop, anomaly saturation, risk increase |
| 4 | **`DATA_FLOW.md` cited a deleted file and the wrong telemetry endpoint** | Broken reference; wrong data path | Corrected to `frontend/src/**` and `/machines/{id}/telemetry?limit=N` |
| 5 | **Docs referenced `/api/v1/machines/{id}/events` indirectly with a guessed envelope** | Would have reproduced the empty-list bug class | Matrix documents the verified bare-array shape |

No application code was modified in this pass. No defect was found that required
a code change — the hardening pass immediately prior had already fixed the
envelope bug class, the inert CSP, and the twin's render scheduling.

### Fixed earlier in this branch, for completeness

| Defect | Commit |
|---|---|
| Maintenance board rendered empty — `{items,total}` read as a bare array | `aa8d0cc` |
| Machine inspector event list permanently empty — bare array read as `{items,count}` | `6cae465` |
| **Security headers declared but never served** (nginx `add_header` inheritance) | `6cae465` |
| Twin requested a 700 ms render settle every 3 s unconditionally | `6cae465` |

---

## 4. Security

Verified **on the wire**, not in the config:

| Header | `/` | `/command` | `/twin` | `/healthz` |
| --- | --- | --- | --- | --- |
| `Content-Security-Policy` | ✓ | ✓ | ✓ | ✓ |
| `X-Content-Type-Options` | ✓ | ✓ | ✓ | ✓ |
| `X-Frame-Options` | ✓ | ✓ | ✓ | ✓ |
| `Referrer-Policy` | ✓ | ✓ | ✓ | ✓ |
| `Permissions-Policy` | ✓ | ✓ | ✓ | ✓ |

Other findings: no `unsafe-eval`; no CDN runtime origins (three/echarts via npm,
3 woff2 served locally); **zero** `innerHTML` and **zero**
`dangerouslySetInnerHTML`; no secrets in tracked source; `.env` untracked with
`.env.example` present; bearer token held in memory only, never `localStorage`;
`401` clears the token and reopens the gate without retry loops.

> The header bug is worth restating: the config *read* as protected while
> shipping **no CSP at all**, because nginx does not inherit `add_header` into a
> location that declares one. Verified now on every path, and the test suite's
> zero-console-error walk proves the policy is **enforced**, not merely present.

---

## 5. Performance

Only measurements actually obtained are reported.

| Measurement | Result | Method |
| --- | --- | --- |
| Command Center under live telemetry | 0.16 s script / 8 s wall (~2.7 % of one core), **0** long tasks, 60 fps | CDP `Performance.getMetrics` |
| Twin idle GPU work | **0 WebGL draw calls** in an 8 s idle window, both visits | wrapped `drawElements`/`drawArrays` |
| WebSocket connections | **exactly 1** across 14 route changes; closed on sign-out | instrumented `WebSocket` constructor |
| Leak check (Twin→Command→Twin→Fleet→Twin) | nodes 3056 → 470, listeners 619 → 200 — **falls to a floor** | CDP metrics |
| Event listeners on Command Center | 228 → 228 over 8 s — **flat** | CDP metrics |

**Not reported:** twin frame rate. The verification browser uses **SwiftShader**
(software rasterisation), so raw FPS there says nothing about a real laptop. An
early reading of 4.7 fps was a headless artefact, not a defect. The
GPU-independent property — zero idle draw calls — is what is asserted.

---

## 6. Truthfulness

**All operational data is synthetic.** Generated by the Python simulator, scored
by a model trained on that simulator, displayed in an operations console.
**ForgeSense does not observe, monitor, or actuate physical machinery.** No
OPC-UA, MQTT, Modbus or fieldbus client exists anywhere in the codebase; the
only write paths are operator actions against the backend's own API.

The six-label provenance vocabulary (**OBSERVED / DERIVED / PREDICTED /
SYNTHETIC / SIMULATED / UNAVAILABLE**) is enforced in the UI, unit-tested in
`test/basis.test.ts`, and applied per-value rather than once per page.

Verified during this pass:

- **No `TODO` / `FIXME` / `HACK` / `XXX`** in `frontend/src` or `backend/src`.
- **No `console.log`**, no `debugger`, no `window.alert(`. The one
  `console.debug` is guarded by `import.meta.env.DEV` and stripped from the
  production bundle.
- **No hardcoded fleet metrics.** Fleet size, counts, and health all come from
  the API. The "18 machines" strings are explanatory comments.
- **No unsupported claims.** Zero matches for "AI-powered", "real factory",
  "guaranteed", "enterprise-ready", "100% accurate".
- **Units are correct and honest** — °C, mm/s, rpm, N·m, A, V, kW, Hz, %, and
  RUL in simulator `steps` (never hours, because no time calibration exists).
- **Unavailability is never rendered as `0`** — a missing sensor shows
  unavailable, because a confident zero is a fabricated measurement.

**The `0.060%` risk saturation is preserved, not fixed.** All 18 assets genuinely
report `0.0006`. Established as real `failure-risk-v2` output: raw JSON is full
precision; the *same response* carries 8+ distinct anomaly scores and 2 health
scores, so nothing is collapsed in transit; and `formatProbability(0.00065)` →
`0.065%`, so the formatter is not merging. A regression test pins formatter
precision so distinct values can never silently merge. **No spread was
manufactured** — fabricating variation in a safety-adjacent number would be
worse than an honest flat line.

---

## 7. Known limitations

Real, and not hidden:

- **No physical machine control.** No fieldbus integration of any kind.
- **No real equipment data.** The models were trained on simulation and have
  never seen a real machine. Nothing here is validated against real hardware.
- **No accuracy guarantee.** Failure risk has no confidence interval and
  saturates at `0.0006` for nominal assets.
- **RUL is a simulator step count**, not a calibrated remaining-life estimate.
- **Attribution is baseline perturbation, not SHAP** — labelled as such, because
  no SHAP library is involved.
- **`/analytics/health-trends` is a snapshot, not a time series**, despite the
  name; the console renders a distribution rather than inventing a trend.
- **Maintenance is the backend's 5 states**, not a full CMMS.
- **No multi-tenancy, no SSO**, three fixed roles only.
- **Single-node topology.** Kafka partitioning, WebSocket scale-out and
  time-series storage are documented future work, not implemented.
- **Not a safety system.** No SIL/PL rating, interlock, or fail-safe design.
- **Twin frame rate is unmeasurable in CI** (software rendering).

---

## 8. Demo path

Verified end to end, with the observed values quoted from the run:

```text
Scenario Lab
  → inject VIBRATION_SPIKE on M-104 (severity 0.9)
  → realtime telemetry over STOMP (telemetry.updated)
  → ML response: anomaly 0.0 → 0.9993, failureRisk 0.0006 → 0.0585
  → state machine: NORMAL → CRITICAL, health 99.9 → 65.9
  → alert / priority incident
  → maintenance work order present
  → Command Center recomputes the fleet verdict
```

Fully reversible: `POST /api/v1/simulation/control/M-104/clear` returns M-104 to
`NORMAL` / 99.9 / 0.0006 in ~40 s, so the demo is repeatable. Full script with
timings and troubleshooting: [`DEMO_RUNBOOK.md`](../DEMO_RUNBOOK.md).

---

## 9. Final recommendation

**Technically ready for release as an evaluation/portfolio candidate.**

Grounds, from objective results only:

- `tsc --noEmit` clean under strict mode with tests included.
- 83 unit tests and 43 browser tests pass; 0 console errors, 0 uncaught
  exceptions, 0 unexpected 4xx/5xx, 0 overflow across 60 responsive
  combinations, 0 broken routes across 12 routes × direct/back/forward.
- Production build clean; Docker build reproducible via `npm ci`; all 9
  services healthy; SPA fallback, 404 behaviour and health probe verified.
- All 5 security headers verified on the wire on every path, with a strict CSP
  (no `unsafe-eval`) and zero external runtime origins.
- Realtime lifecycle verified: exactly one WebSocket across 14 route changes,
  torn down on sign-out, with bounded memory and no duplicate subscriptions.
- No known open defect. No application code changed in this pass.
- Documentation now matches the implementation, including corrections to
  architecture claims that were previously wrong.

**Explicitly not recommended for:** production plant deployment, safety-critical
use, or any claim of predictive accuracy against real equipment. The data is
synthetic, the models are unvalidated against real machines, and failure risk
carries no confidence interval. This is a demonstration of architecture and
decision-pipeline design — which is what it claims to be.

**Suggested next action:** merge `feat/industrial-operations-ui` into a release
branch and tag. I have not pushed, merged, or tagged anything; see §10.

---

## 10. Git state and recommended manual action

| Item | Value |
| --- | --- |
| Branch | `feat/industrial-operations-ui` |
| Working tree | clean at time of writing (documentation commits pending this report) |
| History | intact — no reset, no force push, no rebase of published work |
| Pushes performed | **none** |
| Tags created | **none** |

Recommended (run manually — I have deliberately not executed these):

```bash
# 1. Review the packaging diff
git diff --stat main..HEAD
git log --oneline main..HEAD

# 2. Merge into a release branch
git checkout -b release/industrial-operations
git merge --no-ff feat/industrial-operations-ui

# 3. Tag (only after the above verification passes on the release branch)
git tag -a v1.0.0-industrial-operations -m \
  "ForgeSense v1.0.0 — industrial operations console. Synthetic/simulated telemetry; no physical machine control."

# 4. Push
git push origin release/industrial-operations
git push origin v1.0.0-industrial-operations
```

Do **not** use `docker system prune -a` to clear a stale container — it deletes
volumes. Use
`docker compose up -d --build --force-recreate frontend` instead.
