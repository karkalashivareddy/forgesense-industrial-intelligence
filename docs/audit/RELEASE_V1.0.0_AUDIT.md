# ForgeSense v1.0.0 — release audit

Release packaging pass, 2026-09-29. Every number here was produced by a command
executed during this pass. Where something could not be measured honestly, that
is stated rather than glossed.

---

## 1. Repository

| Item | Value |
| --- | --- |
| Release branch | `release/industrial-operations` |
| HEAD | `b996872` — merge of `feat/industrial-operations-ui` into `release/industrial-operations` |
| Feature branch | `feat/industrial-operations-ui` at `8fe4dd3` (**preserved, not deleted**) |
| Base | `main` at `9444beb` (`origin/main`) |
| Tag | `v1.0.0-industrial-operations` (annotated, on `b996872`) |
| Working tree | **clean** |
| Merge conflicts | **none** — `--no-ff` merged cleanly |
| History | intact; no reset, force push, or rebase |
| Pushes performed | **none** |

Merge topology:

```
*   b996872 (HEAD -> release/industrial-operations, tag: v1.0.0-industrial-operations)
|\
| * 8fe4dd3 (feat/industrial-operations-ui) fix(frontend): 41 undefined colour-token references
| * 880283e docs: finalize ForgeSense release and demo documentation
| * 6cae465 fix(hardening): envelope bug class, inert CSP, idle-not-settling twin
| * aa8d0cc feat(frontend): semantic colour system and visual hierarchy
| * a454776 feat(simulation): wire the live feed injection path
| * 9510203 docs: rebuild documentation around the actual implementation
| * 54c20c5 build: serve the console from a reproducible multi-stage image
| * 38a62b3 feat(frontend): re-architect the console on React + TypeScript + Vite
| * 0eb93f6 fix(backend): correct self-contradicting status and unit formatting
| * 1b13a4e audit: establish verified frontend baseline
|/
* 9444beb (main, origin/main) fix: require QA_PASS in release verify driver
```

---

## 2. Code

**One application-code fix was made during release packaging**, after the
predecessor pass had been declared complete. It was found by asking a question
the earlier audits had never asked.

**41 undefined CSS custom-property references.** The semantic colour migration
renamed every token in `tokens.css` but missed inline `var(--old-name)`
references. An undefined custom property is not an error — it resolves to
nothing, so each rendered as an inherited colour, a transparent background, or
a missing border. The type checker, the test suite and the browser console all
saw nothing, and the prior hex-literal colour audit could not catch it because
these were token *references*, not literals.

What was actually broken, all measured in the browser before and after:

| Surface | Before | After |
| --- | --- | --- |
| `OBSERVED` provenance chips | `colour=rgb(230,236,243)` (inherited), `bg=rgba(0,0,0,0)`, **dot `rgba(0,0,0,0)` — invisible** | `colour=rgb(143,203,243)`, `bg=rgba(74,159,224,0.1)`, `dot=rgb(74,159,224)` |
| Scenario Lab "What to watch" strip | all 7 segments `rgba(0,0,0,0)` — fully transparent | T0 graphite, Degrade/Anomaly amber, Risk/Alert red, Maint violet, Recover green |
| Twin dependency legend | 4 swatches had no colour | Material cyan, Power info, Cooling maintenance, Service slate — all distinct |
| Inspector drawer | `width: min(var(--drawer-w), 100vw)` invalid, declaration dropped, sized to content | 420 px desktop, 390 px full-width bottom sheet at 390 px viewport |
| Command Center hero `·` separator | `--color-text-subtle` undefined (my own regression) | `--color-text-disabled`, resolves |
| `BasisDescriptor.cssVar` × 6 | pointed at the removed `--basis-*` vocabulary | repointed at `--color-{basis}` |

Root cause of the provenance-chip failure: `BasisChip` builds its colour from a
template literal, `var(--color-{basis}-text)`, so all six bases need a complete
quadruple. The migration defined `derived`, `synthetic` and `unavailable` but
omitted `observed`, `predicted` and `simulated`. Those three are the product's
central idea — "every number carries a data basis" — and a third of them were
rendering blank.

**Regression guard added:** `frontend/test/tokens.test.ts` asserts that every
`var(--token)` in `src/` is defined in `tokens.css`, that no legacy short token
name survives, and that all six provenance families are complete. It expands the
template-literal form over the six bases, so the exact gap above now fails the
suite. Comments are stripped before scanning so documented patterns are not false
positives.

**Documentation changes:** README (diagram, stack, demo, limitations, "why
this matters", overclaim removed), `DEPLOYMENT.md` (deleted `serve.py`
reference), `REALTIME.md` (deleted `frontend/js/realtime.js` reference),
`PROJECT_SPECIFICATION.md` (scope note), `RELEASE_CHECKLIST.md`, plus new
`docs/PORTFOLIO_DESCRIPTION.md` and 7 re-captured screenshots.

---

## 3. Verification

Run on the **release branch** after the merge:

| Check | Result |
| --- | --- |
| `tsc --noEmit` (strict, `noUncheckedIndexedAccess`, tests included) | **clean** |
| Vitest | **86 passed** (6 files) |
| Playwright | **43 passed** (30 functional + 13 visual) |
| `vite build` | **clean** |
| Docker build (`npm ci`, committed lockfile) | **clean** |
| Docker startup | frontend `Up (healthy)`, **9/9 services** healthy |
| Console errors | **0** across all 12 workspaces |
| Uncaught exceptions | **0** |
| Unexpected failed requests / 4xx / 5xx | **0** |
| Horizontal overflow | **0** across 60 breakpoint × workspace combinations |
| Routes | **12**, each verified by direct load, back and forward |
| WebSocket connections | **exactly 1** across 14 route changes, closed on sign-out |
| Three.js idle draw calls | **0** in an 8 s idle window |

### One flake, disclosed

The first full-suite run on the release branch produced **42 passed, 1 failed**:
`scenario lab › reflects an injected scenario in the console`. Investigated
rather than assumed:

- Re-running that test in isolation: **passed**
- Re-running the whole `app.spec.ts` file: **30/30 passed**
- Full suite, run 2: **43/43 passed**
- Full suite, run 3: **43/43 passed**

The assertion that failed is `expect(page.getByText(/A scenario is live on/i))
.toHaveCount(0, { timeout: 20_000 })` — waiting for the backend to clear control
state after "Reset feed". It is a **timing dependency on the running simulator**,
not a code regression, and the test is already written to be idempotent
(reset → inject → assert → reset). The test was **not weakened** to make it
pass; two consecutive clean full-suite runs are the basis for tagging.

---

## 4. Security

Verified **on the wire**, not in the config, for `/`, `/command`, `/twin` and
`/healthz`:

| Header | Status |
| --- | --- |
| `Content-Security-Policy` (`script-src 'self'`, **no `unsafe-eval`**) | present on all paths |
| `X-Content-Type-Options: nosniff` | present |
| `X-Frame-Options: DENY` (+ `frame-ancestors 'none'`) | present |
| `Referrer-Policy: no-referrer` | present |
| `Permissions-Policy` (geolocation, microphone, camera disabled) | present |

| Check | Result |
| --- | --- |
| CDN runtime dependencies | **none** — three/echarts via npm, 3 woff2 served locally, no import map |
| `innerHTML` / `dangerouslySetInnerHTML` | **0 occurrences** in `src/` |
| Secrets in tracked source | **none**; `.env` untracked, `.env.example` present |
| Token storage | in-memory only, never `localStorage` |
| `console.log` / `debugger` / `window.alert(` | **0** |
| `TODO` / `FIXME` / `HACK` / `XXX` | **0** |

> Worth retaining in the record: during the predecessor hardening pass the
> declared security headers were found **absent from every response**, because
> nginx does not inherit `add_header` into a `location` that declares one. The
> config read as protected while shipping no CSP at all. Fixed in `6cae465` and
> verified on the wire since.

---

## 5. Demo

Verified end to end against the running system.

| Item | Value |
| --- | --- |
| Asset | **M-104 — Conveyor Drive Motor**, chosen because it begins `NORMAL` |
| Scenario | **`VIBRATION_SPIKE`**, severity 0.9 — the real `ScenarioType` enum value |
| Endpoint | `POST /api/v1/simulation/control` |
| Before | `NORMAL` · health 99.9 · anomaly 0.0 · risk 0.0006 |
| After (~30 s) | **`CRITICAL`** · health 65.9 · anomaly 0.9993 (`ANOMALY`) · risk **0.0585** (97×) |
| Recovery | `POST /api/v1/simulation/control/M-104/clear` → `NORMAL` · 99.9 · 0.0006 in ~40 s |
| Repeatable | **yes** |

`M-105` was rejected for the demo: it is `CRITICAL` **at rest** with 2 alerts
and a work order, so injecting into it produces no visible change.

**Stated honestly in the runbook and the README:** alert and maintenance
*counts* do not increase on injection (36 and 18 throughout), because the
decision engine has already raised a standing recommendation for every asset.
The demonstrable change is the state transition, the health drop, the anomaly
saturation, the risk increase, and the asset entering Priority incidents.

---

## 6. Limitations

- **Synthetic / simulated telemetry.** Generated by the simulator in this
  repository; the ML models were trained on that simulator and have **never seen
  real equipment**.
- **No physical machine control.** No OPC-UA, no MQTT, no Modbus, no fieldbus
  client of any kind. "Inject scenario" means *change a synthetic generator's
  parameters*.
- **No accuracy guarantee against real equipment.** Failure risk is a bare
  probability with **no confidence interval**.
- **Failure-risk saturation.** All 18 assets report `0.0006` (`0.060%`). Genuine
  `failure-risk-v2` output — the same response carries 8+ distinct anomaly
  scores and 2 health scores, and `formatProbability(0.00065)` → `0.065%` — so
  nothing is collapsed and no spread was manufactured.
- **RUL is a simulator step count**, not a calibrated remaining-life estimate.
  Production efficiency and downtime risk are modelled, not measured.
- **Attribution is baseline perturbation, not SHAP**, labelled accordingly.
- **Maintenance is the backend's 5 states**, not a full CMMS.
- **No multi-tenancy, no SSO** — three fixed roles.
- **Single-node topology.** Kafka partitioning, WebSocket scale-out and
  time-series storage are documented future work, not implemented.
- **`/analytics/health-trends` is a snapshot, not a time series**, despite the
  name.
- **Not a safety system.** No SIL/PL rating, interlock or fail-safe design.
- **CI cannot measure real GPU frame rates** (SwiftShader software rendering).
  The GPU-independent property — zero idle draw calls — is what is asserted.
- **One known flaky E2E assertion** (simulator state-clearing timing), disclosed
  in §3 and not papered over.

---

## 7. Release decision

> The repository satisfies the verified technical and documentation checks for an
> evaluation/portfolio release.

Objective basis, and nothing beyond it:

- `tsc --noEmit` clean under strict mode with tests included.
- 86 unit tests and 43 browser tests pass; two consecutive clean full-suite runs.
- Production build clean; Docker build reproducible via `npm ci`; 9/9 services
  healthy; SPA fallback, 404 behaviour and health probe verified.
- All 5 security headers verified on the wire on every path.
- Realtime lifecycle verified: exactly one WebSocket across 14 route changes,
  torn down on sign-out, bounded memory, no duplicate subscriptions.
- One genuine application defect found and fixed during packaging, with a
  regression guard added; no known open defect remains.
- Documentation matches the implementation, including corrections to
  architecture and deployment claims that were previously wrong.

**This is not a production industrial deployment and must not be described as
one.** No physical machine control exists, no model has been validated against
real equipment, and failure risk carries no confidence interval.

---

## 8. Push status

**NOT PUSHED.** No branch or tag was sent to the remote.

| Item | Value |
| --- | --- |
| Current branch | `release/industrial-operations` |
| Current HEAD | `b996872` |
| Release tag | `v1.0.0-industrial-operations` (annotated, on `b996872`) |
| Working tree | clean |
| Commits ahead of `main` | 10 (9 on the feature branch + 1 merge commit) |
| Verification | 86 Vitest · 43 Playwright · tsc clean · build clean · Docker clean · 9/9 healthy · 5/5 headers · 1 WebSocket |

Manual commands, to be run by the repository owner:

```bash
git push origin release/industrial-operations
git push origin v1.0.0-industrial-operations
```

Optionally push the feature branch for traceability:

```bash
git push origin feat/industrial-operations-ui
```
