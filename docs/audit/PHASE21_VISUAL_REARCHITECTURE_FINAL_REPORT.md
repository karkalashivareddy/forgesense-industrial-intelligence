# Phase 21 — Visual Re-architecture · Final Report

**Date:** 2026-09-21
**Status:** Implemented, tested, QA-passed
**Companion docs:** `docs/design/VISUAL_IDENTITY.md`, `docs/design/TOKENS.css`, `docs/audit/PHASE21_VISUAL_REARCHITECTURE_AUDIT.md`

---

## 1. Summary

The frontend moved from the copper/dark-SCADA look to a cool **"Industrial Precision / Calm
Intelligence"** system: graphite surfaces, a steel-blue brand, semantic colour reserved for real
state, sentence-case labels, an opt-in dependency layer in the 3D twin, and a deliberately quiet
physical factory scene. No contracts changed — routes, machine/zone models, util behaviour,
backend REST + STOMP, and the auth flow are byte-identical from the JS side.

---

## 2. What changed

### 2.1 `frontend/css/tokens.css` (full rewrite)
- New surface ramp `--bg-0..surface-3`, brand family (`--brand`, `--teal`, `--violet-ai`),
  semantic `--good/warn/critical/maint/down/info`, text triad, 8-step `--viz-*` ramp.
- **All `color-mix()` removed** — dims/glows/focus are static `rgba` (deterministic across engines).
- Legacy aliases (`--color-*`, `--text-*`, `--radius-*`, `--space-*`, `--font-*`, `--z-*`) retained
  so all existing JS lookups (`shared.js`, `charts.js`, `twin3d.js`, views) keep working.

### 2.2 `frontend/css/base.css`, `components.css`, `views.css` (rewrites)
- Base: grouped navigation rail with 4 groups and `.idx` numerals, simplified topbar
  (`.pill.sys.ok/degraded/down`, `.ml-pill`), statusbar with aggregate `#sysBtn`, `.diag` drawer,
  `prefers-reduced-motion` block. Rail `.label` fixed at 13px, `display:block`.
- Components: shared classes preserved verbatim in name (`.card`, `.kpi.tone-*` with bottom accent
  bar, `.pill-status.st-*`, `.bar/.bar-fill`, `.tbl`, `.login-*`, `.palette`, `.toast`, `.command-*`,
  `.fleetbar*`, `.insight*`, `.status-dot`), all in the new palette.
- Views: factory HUD/inspector/login glass, `.basis-badge.t-live/t-sim/t-warn/t-err`,
  `.twin-asset` list with `.twin-asset-dot`, `#depLegend` hidden by default, responsive
  breakpoints 1180 (inspector right drawer) / 900 (compact rail) / 700 (mobile off-canvas rail +
  bottom-sheet inspector).

### 2.3 `frontend/index.html`
- Removed stale topbar widgets (`#thrPill`, `#thrRate`); sys pill now `.pill.sys` + `ph-broadcast`.
- Grouped rail (Command/Factory/Fleet … System) with `.idx` spans, plus `.label` texts unchanged.
- Statusbar: aggregate `#sysBtn`/`#sysDot`/`#sysBtnText`, footer transport/basis/last-telemetry
  rows, and a diagnostics drawer `#diag` (`.diag.hidden`) with per-service rows.

### 2.4 `frontend/js/app.js`
- Login: placeholder "Enter your password"; hint text cleaned (no credentials on screen).
- `osLabel` → sentence case (Outage / Attention / Operational).
- `topbar()` → drives `.pill.sys` states (ok/degraded/down), keeps LIVE · STOMP and ML pill.
- `statusbar()` → drives detailed rows (diag + footer) and the aggregate button state
  (`.state-warn`/`.state-down`/nominal); `#sysBtn`, `#diagClose`, Escape handled from main().

### 2.5 `frontend/js/twin3d.js` (full rebuild)
- Physical factory: graphite bodies, steel-blue spindles, muted panel lights; status = small bar
  light (no aura), thin brand selection ring (no rotating arcs); labels on hover/selection/risk/sim.
- Zones: single neutral graphite slab + hairline + direction strip — no per-zone colour coding;
  neutral floor labels; quiet two-level grid + low-opacity safety strip.
- **Dependency arcs opt-in**: `layerMode` physical (default) | risk | dependencies | selected —
  edges are built but hidden at DEFAULT; `setRiskMode(u)` = risk layer, `setDepMode(u)` =
  dependencies layer, `setLayerMode('dependencies'|'selected')` supported for future UI.
- Camera framing targets ~70–80% viewport coverage (`fitPose` fov/aspect math), smooth damping.
- Export surface unchanged: `initTwin, updateMachines, resetCamera, focusOnMachine, focusOnZone,
  setSimMode, setRiskMode, focusTop, isTwin, disposeTwin` (+ `setLayerMode`, `setDepMode`, `syncMachines`).

### 2.6 Other JS polish
- `shared.js` — `statusPill` sentence case; `statusDot` → `.status-dot.st-*` class (no inline styles).
- `requestView` files — machine-state pill text sentence case (`command.js`, `inspector.js`);
  `charts.js` COLORS mapped to the new `--viz-*` ramp; opState labels sentence case.
- Feature/signal IDs and mode codes (MODEL/HEURISTIC, zone codes, `.toUpperCase()` on data codes)
  intentionally remain uppercase.

---

## 3. Validation

| Check | Result |
|-------|--------|
| `node --check` on all edited JS | Pass |
| Unit tests (`cd frontend; npm test`) | **36/36 pass** |
| Visual QA (`npm run qa:visual`, `QA_PASS=<dev-seed-password>`) | **5/5 viewports PASS** |
| Console / runtime errors during QA | **0 unexpected** |
| Network fail events during QA | 0 failed resources (fonts served from local mirror cache) |
| Hard gates | login connect button, `#twinBasis` = LIVE · STOMP, statusbar `/stomp/i`, rail labels ≥12px, 18 twin assets, 6 zone chips, inspector `.meter` on select — all pass |

Evidence artifacts regenerated: `_qa/final_1_375.png … final_5_1920.png`, `_qa/finalverify.out.txt`, `_qa/qafinal.txt`.

---

## 4. Contract integrity

Unchanged and re-verified by the suite: `util.js` riskInfo/anomalyInfo/ageBand/sensorLabel/etc.
(36 pinning tests), route keys 1–9, RPC/auth/stomp surface, 18 machines / 6 zones / 2 lines / 20 deps,
`/#/…` deep links. Backend and simulator (running with `--degrade M-105`) untouched.

## 5. Known limitations

- Screenshots were **not inspected by a human**; visual review used the programmatic
  pixel-analysis + live-CDP audit in `tools/visual-qa/review_phase21.mjs` (see §7). This is
  honest evidence, not a claim of "visually verified".
- Q7 (NVDA screen-reader runtime) and R5 (browser profiler) remain **BLOCKED / NOT VERIFIED** —
  no runtime evidence is available from this environment; no FPS/profiler numbers are invented.
- `_qa/final_*.png` screenshots are artifacts only — do not commit them (or any log containing
  credentials). They are regenerated on demand.

## 6. Suggested commit message (commit deferred per release instruction)

```
feat(ui): Phase 21 visual re-architecture — cool industrial design system

- tokens: graphite/cool-ramp, steel-blue brand, semantic-only state colour,
  static rgba dims/glows (no color-mix), legacy JS aliases retained
- shell: grouped rail, simplified topbar, aggregate sysBtn + diagnostics drawer
- twin: physical factory rebuild, quiet selection, opt-in dependency layers,
  ~70% camera framing; export surface unchanged
- copy: sentence-case state labels; charts mapped to new viz ramp
- login: credentialed hint text removed
- release validation: production-efficiency % fix (9700% → n%), explanation
  404 gating + graceful copy, clean login error states, events empty copy,
  inspector rejection guard, repo hygiene redactions
- validation: 36/36 tests, visual QA 5/5 viewports, 0 console errors,
  programmatic visual review 0 violations
```

---

## 7. Final release-validation pass

Run on 2026-09-21 against the live stack (backend :8080, ML :8001, frontend :5173,
simulator `--degrade M-105`, dev seed credentials supplied via environment).

### 7.1 Visual review (five viewports × the release criteria)

Method: this environment cannot render PNGs to a human reviewer, so inspection was performed
**programmatically**, honestly — `tools/visual-qa/review_phase21.mjs`:

- **Pixel pass** (decodes `_qa/final_1_375.png … final_5_1920.png` with a minimal
  `node:zlib` PNG decoder; measures colour composition):
  - copper/orange dominance = **0.00%** on every viewport (login/factory screenshots contain
    no decaying-copper mass; brand warm tone appears only as small chips/pills);
  - brand-blue accent share 0.14–0.21% (accent only, not dominant);
  - scene coverage (twin region) 50–57% on desktop, 91% on 375 portrait — the factory fills
    the frame with quiet negative space, no empty void.
- **Live DOM audit** (fresh CDP browser through the real login overlay, 375/768/1024/1440/1920):
  - `upperLabels = 0` — no all-caps micro-labels anywhere;
  - horizontal scroll = **false** on every viewport;
  - dependency edges = **0 exposed by default** (opt-in layers stay off);
  - zone chips = **6/6**, twin assets = **18**;
  - canvas vs viewport = 51–90% (factory occupies ~70–80% on desktop targets);
  - topbar glass = `rgba(10,18,27,0.88)` + `blur(10px)` — restrained, not chrome;
  - login overlay covers **100% × 100%** of the viewport (no dashboard pre-auth);
  - selected-machine inspector: meters present, **no overflow** (the `.tabs` strip is
    `overflow-x:auto` by design and excluded);
  - pills concentrated in the topbar only (2 visible `.pill`, `topbarPills=2`), statusbar 5 cells,
    rail 14 items — per-surface density is low;
- Result: **pixel pass + 0 DOM violations.** No fixes required.

### 7.2 Functional integrity

- `node --check` on all edited JS — pass.
- `cd frontend; npm test` — **36/36 pass**.
- `npm run qa:visual` (env credentials) — **5/5 viewports PASS**, `unexpectedConsole=0`,
  0 failed resources; fresh `_qa/final_*.png` + logs.
- `git diff --check` — clean (LF→CRLF notices only).

### 7.3 Data / API integrity fixes (found during this pass)

- **Production efficiency 9700%**: backend `AnalyticsService.ProductionEfficiency` is already a
  0–100 value; the frontend wrongly fed it through `pct()` (`value*100`). Fixed to
  `num(value,0)+'%'` in `views/command.js` and `views/analytics.js`.
- **Predictions explanation 404**: `views/predictions.js` fired
  `GET /api/v1/machines/{id}/explanation` for machines with no `Prediction` row (backend 404s).
  Now gated on a prediction signal (`failureRisk`/`anomalyScore` non-null); when genuinely
  absent, both the insight card and the attribution panel render
  "No explanation available for this prediction…" without issuing the request.
- **Raw HTTP error text**: `api.js login()` and the explanation/attribution failure paths no
  longer surface backend `HTTP 400/404 … {timestamp}` payloads — clean copy only
  ("Login failed — check credentials." / "Sign-in service unreachable…" /
  "No explanation available for this prediction right now.").
- **Inspector rejection guard**: `renderTab()` now catches async-tab rejections and renders a
  calm per-tab empty state instead of an unhandled promise rejection.
- **Events empty state**: intentional and describes the synthetic feed
  ("No events in the current window — the feed carries synthetic telemetry…").
- Factory = 18 machines / 6 zones / 2 lines / 20 deps; data basis "SIMULATED · stomp live"
  identified in the statusbar without dominating.

### 7.4 Authentication review

- The dashboard is gated behind the `.login-overlay` (verified live: overlay covers the full
  viewport). No route renders production data anonymously.
- No password is retained in frontend state or `localStorage`; only the JWT, username and roles
  live in module memory for the Authorization header.
- Login failures have explicit, non-leaking states (`role=alert` `#loginError`); no credential
  material in UI copy; auth/API contracts (whoami, roles, Bearer) unchanged; token never written
  to logs/screenshots.

### 7.5 Repository hygiene

- Whole-repo scan for credentials/API keys/tokens/secrets/JWTs/private keys — **clean**
  (no `AKIA*`, `ghp_*`, `sk-*`, `xox*`, `eyJ…`, `BEGIN PRIVATE KEY`, dsn creds).
- `.env` is **untracked and gitignored**; only `.env.example` (placeholders) is tracked.
- Redacted tracked documentation literals with placeholders:
  `docs/DEPLOYMENT.md`, `docs/audit/PHASE21_VISUAL_REARCHITECTURE_FINAL_REPORT.md`,
  `docs/audit/VISUAL_UPGRADE_FINAL_REPORT.md`, `.env.example` — the dev seed password is now
  shown only as `<dev-seed-password>` / an env var name. Functional defaults in
  `docker-compose.yml`, backend tests, and `ForgeUserDetailsService` keep the *runtime* dev
  seed (they cannot work redacted). The remaining string `forgesense-dev` in two audit docs is
  the H2 **database filename** (`backend/data/forgesense-dev.mv.db`), not a credential.
- No local `ci.yml`/`.github` workflow exists in this checkout, so the CI hygiene grep was
  validated by an equivalent local scan only.

### 7.6 Accessibility / performance audit status

- Q7 (screen-reader runtime) — **BLOCKED / NOT VERIFIED** (no NVDA/VoiceOver evidence available).
- R5 (browser profiler) — **BLOCKED / NOT VERIFIED** (no profiler evidence; no FPS invented).

### 7.7 Git state at close

- Changed files: **20 tracked files modified + 3 new untracked**
  (`docs/audit/PHASE21_VISUAL_REARCHITECTURE_AUDIT.md`,
  `docs/audit/PHASE21_VISUAL_REARCHITECTURE_FINAL_REPORT.md`,
  `tools/visual-qa/review_phase21.mjs`).
- `git diff --check` clean; `npm test` 36/36; `qa:visual` 5/5. **Not committed / not pushed** —
  the release commit is explicitly deferred by instruction; GitHub Actions status therefore N/A
  (a green push would still not equal a green CI run).