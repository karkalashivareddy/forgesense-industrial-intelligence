# Visual Upgrade — Verification

Evidence for the visual/interaction upgrade. This document is updated in place as verification
progresses; each row records the actual command results, browser check, and screenshot rather
than intent. **PASS** is only claimed for steps performed against the running stack or a live
browser session.

## Static checks

| # | Check | Command | Result |
|---|---|---|---|
| 1 | All frontend JS parses (ESM) | `node --check js/*.js js/views/*.js` | PASS — all files parse |
| 2 | Frontend unit tests | `node --test test/util.test.mjs` | PASS — 25/25 |
| 3 | Catalog valid, no dangling edges | node JSON check on `config/machine_profiles.json` | PASS — 6 zones, 18 machines, 20 edges, 0 dangling, types all in enum |
| 4 | Backend compiles + tests | `./mvnw -q package` in `backend/` | PASS — 18 machines/20 deps seeded in boot test |
| 5 | ML service tests | `python -m pytest tests -q` in `ml-service/` | PASS — 8/8 |
| 6 | Compose config resolves | `docker compose config` | PASS — exits 0 |
| 7 | Diff hygiene | `git diff --check` | PASS — no whitespace errors |

## Stack re-seed (18 machines)

| # | Step | Command | Result |
|---|---|---|---|
| 8 | Reset volumes so `DataSeeder` re-runs | `docker compose down -v` | PASS — volumes reset at re-seed; `docker compose ps`: 9/9 containers up ~1h, backend/ML/Kafka/Postgres/Redis/simulator healthy |
| 9 | Rebuild & start all services | `docker compose up --build -d` | PASS — backend `:8080`, frontend `:5173`, ml-service `:8001`, prometheus `:9090`, grafana `:3000` all listening; runtime DB flag `H2_DEV` (dev profile) |
| 10 | Backend healthy | `GET http://localhost:8080/actuator/health` | PASS — `UP` |
| 11 | ML healthy | `GET http://localhost:8001/health` | PASS — `ok` |
| 12 | 18 machines via API | `GET /api/v1/machines` (Bearer JWT, `operator`) | PASS — returns 18 machines |
| 13 | 6 zones via API | `GET /api/v1/zones` | PASS — Machining, Assembly, Packaging, Utilities, Material Handling, Inspection (6) |
| 14 | 20 dependency edges via API | `GET /api/v1/machines/dependencies/edge` | PASS — 20 edges |
| 15 | STOMP/ML/simulator status | `GET /api/v1/system/status` + browser basis | PASS — status: `mlServiceAvailable: true`, ML `failure-risk-v2` deployed, simulator feeding SYNTHETIC demo data (demoMode true, telemetry ~198/min); browser basis badge `LIVE · STOMP`, status bar `Backend OK · ML vfailure-risk-v2 up · Transport STOMP live` |

## Browser QA (headless screenshots, live stack)

Semantic checks per viewport via Puppeteer script (`tools/visual-qa/` see note) or Chrome
headless screenshots with computed-style assertions.

| # | Check | 375 | 768 | 1024 | 1440 | 1920 |
|---|---|---|---|---|---|---|
| 16 | No horizontal scrollbar/document overflow | PASS | PASS | PASS | PASS | PASS |
| 17 | Topbar fully visible (brand, user chip, no clip) | PASS* | PASS | PASS | PASS | PASS |
| 18 | Rail labels visible/legible (never 9px) | PASS | PASS | PASS | PASS | PASS |
| 19 | Inspector reachable and not clipped (<1180 drawer, ≤700 sheet) | PASS | PASS | PASS | PASS | PASS |
| 20 | Factory HUD (basis badge, zone chips, buttons) visible | PASS | PASS | PASS | PASS | PASS |
| 21 | 3D canvas renders; machine labels readable | PASS | PASS | PASS | PASS | PASS |
| 22 | Twin status indicators colored by state | PASS | PASS | PASS | PASS | PASS |
| 23 | Zone chips list all six zones | PASS | PASS | PASS | PASS | PASS |
| 24 | Inspector micro-bars render for Health/Anomaly/Risk | PASS | PASS | PASS | PASS | PASS |
| 25 | Browser console: no errors | PASS* | PASS* | PASS* | PASS* | PASS* |

Evidence (`qa_final.mjs`, Chrome 153 headless, live stack, 5 viewports; `_qa/final_*.png`):

- 16 — `docSW == vw` and `hScroll=false` at every width; off-canvas rail (375) and inline
  inspector (≥1180) extend beyond the viewport by design but never produce a horizontal
  scrollbar (`docSW` unchanged).
- 17 — Topbar `scrollWidth` overflows its 375px lane by 42–49px at the smallest viewport
  (brand subtitle shrinks within its flex lane, stays fully on-viewport, nothing clipped
  against the viewport edge, `right ≤ 375` for all children); `topbarOverflow=0` at 768+.
- 18 — All 12 rail labels render at `12.1875px`, `display: block`, on every viewport (never
  the old 9px collapse).
- 19 — 375: fixed bottom-sheet, full-width (w375), toggled into view via `inspToggle`
  (translateY offset pre-open); 768/1024: fixed right drawer w400, transform into view;
  1440/1920: static inline panel w384, top 56 → bottom within viewport. No clipping.
- 20 — HUD bounding rects measured at all widths (e.g. 375: L8..R367; 1920: L238..R1906),
  basis badge `LIVE · STOMP` (green `#10b981`), all 6 zone chips visible, risk-mode + camera
  buttons visible.
- 21 — `canvasCount = 1` in every viewport with live twin sizing (375: 375×732 @2x → buffer
  750×1464; 1920: 1696×996); `twinAssets = 18`; `webgl: true`. Fresh `#/factory` loads now
  mount the twin on first activation (fixed listener-ordering race in `app.js`).
- 22 — State coloring verified via status classes: MACHINING/UTILITIES/MATERIAL_HANDLING
  chips carry attention `!` count badges; inspector Health meter `82.9%` green (`m-good`,
  `#10b981`), basis pill green when STOMP live.
- 23 — Each viewport lists all six zones (MACHINING · ASSEMBLY · PACKAGING · UTILITIES ·
  MATERIAL_HANDLING · INSPECTION) with correct machine counts (5/3/2/5/2/1) that total 18.
- 24 — Inspector for selected machine `CNC Mill A · M-101` (click on `twin-asset` row):
  `Health 82.9% within operating bounds`, `Anomaly score 56.8% LOW`, `Failure risk 0.1% LOW`
  micro-meter rows render (`meter` + `meter-fill m-good` tracks, green fill) at 1440; same
  render path is exercised per viewport when the inspector opens.
- 25 — Only console "error" across every run is `nett::ERR_BLOCKED_BY_CLIENT.Inspector`,
  which is the QA harness deliberately blocking Google font hosts (mirror strategy); zero
  `Runtime.exceptionThrown`, zero other failed resources.

## Notes / follow-ups

- Stale simulator health at last baseline check predates this work; simulator is healthy
  after re-seed (all 9 services up, demo telemetry flowing ~198/min).
- `docker compose down -v` destroys telemetry history; acceptable for a dev seed.
- Could not reproduce any JS exception related to the twin. A real boot-order race existed
  (`forge:ensure3d` listener registered after `bootRouter` fired the first activation on
  fresh `#/factory` loads) and was fixed in `app.js`; verified via instrumented CDP runs.
- Minor, cosmetic, ≤400px: topbar brand subtitle flex lane is squeezed (42px lane overflow);
  content stays on-viewport with no horizontal scroll. Left as tolerance.
- QA harness injects no code into the app; it only mirrors the four CDN assets locally,
  blocks Google font hosts, drives the login overlay, and reads computed styles/screenshots.

## Reproducible QA (final hygiene pass)

The CDP-based browser driver used for rows 16–25 is now repository-local and versionable:

- **Driver:** `tools/visual-qa/qa_final.mjs` (repo-relative paths; no machine-specific or
  temp-directory assumptions; no secrets committed — dev-seed login is configurable via
  `QA_USER`/`QA_PASS`).
- **Command:** `npm run qa:visual` (runs from `frontend/`); or
  `node tools/visual-qa/qa_final.mjs` from any cwd.
- **Prerequisites:** Node ≥ 22 (built-in WebSocket, no dependencies), Chrome or Edge
  (auto-detected on Windows, override with `QA_BROWSER`), and the live stack with the app
  reachable at `BASE_URL` (default `http://localhost:5173`). First run downloads the four
  CDN assets into the mirror cache; all artifacts go to `QA_OUTPUT_DIR` (default
  `<repo>/_qa`, gitignored) — screenshots are never committed.
- **Configuration (env):** `BASE_URL`, `QA_OUTPUT_DIR`, `QA_CDP_PORT`, `QA_MIRROR_PORT`,
  `QA_BROWSER`, `QA_USER`, `QA_PASS`, `QA_VPS`.
- **Viewports tested:** 375 / 768 / 1024 / 1440 / 1920 (overridable via `QA_VPS`).
- **What it asserts (DOM/runtime, not pixel stats):** boot (`view-factory` active, twin
  canvas mounted on fresh load = no init race), layout (no horizontal scroll, rail labels
  ≥ 12px, rail/inspector present), twin (canvas attached to `#sceneContainer`, 18
  `twin-asset`s, machine selection opens inspector with meters, six zone chips), runtime
  (`LIVE · STOMP`, STOMP statusbar text, ML pill visible, zero unexpected console errors).
- **Expected state:** 18 twin assets, 6 zones, 20 edges, `LIVE · STOMP`, ML
  `failure-risk-v2`.
- **Final run (this pass):** `viewports=5/5 pass=true`, `unexpectedConsole=0`.
- **Known harmless harness warning:** Google font hosts are intentionally blocked by the
  driver, which surfaces as `net::ERR_BLOCKED_BY_CLIENT` in the console error log — this is
  an EXPECTED / harness-intentional artifact (phosphor fonts are served from the local
  mirror), never counted as an application error. No real application errors are suppressed.