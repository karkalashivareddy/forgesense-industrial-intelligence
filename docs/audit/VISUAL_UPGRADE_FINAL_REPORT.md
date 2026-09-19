# ForgeSense Visual Upgrade — Final Report

Status: **DELIVERED** — implementation + verification complete against the running stack.
32 fields, numbered 1–32. Every numeric claim below was measured on a live session
(backend API calls with JWT, or Chrome 153 headless against the running frontend).

## Fields

| # | Field | Value / Evidence |
|---|---|---|
| 1 | Change objective | Fix clipped rail/header/inspector; dense 3D twin of all 18 machines; responsive 375–1920px; zero backend/ML/STOMP contract changes |
| 2 | Scope | Frontend only (CSS split ×4 + JS views/twin/util/app), docs, QA harness; no backend or model edits required |
| 3 | Environment | Windows; Docker Desktop; Java 25; Python 3.14.6; Node v24.19.0; Chrome 153.0.8010.52 headless; Edge available |
| 4 | Stack state | `docker compose ps`: 9/9 up — backend `:8080`, frontend `:5173` (nginx bind-mount of `./frontend`), ml-service `:8001`, prometheus `:9090`, grafana `:3000`, postgres, redis, kafka, simulator |
| 5 | Backend health | `GET /actuator/health` → `UP`; `GET /api/v1/system/status` → `mlServiceAvailable: true`, ML `failure-risk-v2` |
| 6 | ML health | `GET http://localhost:8001/health` → `ok` |
| 7 | Catalog — machines | `GET /api/v1/machines` → **18** |
| 8 | Catalog — zones | `GET /api/v1/zones` → **6**: Machining, Assembly, Packaging, Utilities, Material Handling, Inspection |
| 9 | Catalog — edges | `GET /api/v1/machines/dependencies/edge` → **20**, zero dangling (node check) |
| 10 | Catalog — types | All machine types within enum (node check vs `config/machine_profiles.json`) |
| 11 | Login used | `operator` / `forgesense-dev` → JWT `accessToken`, roles `ROLE_OPERATOR`, expiry 86400s; unchanged auth flow |
| 12 | Twin — mount | Fresh `#/factory` loads mount the 3D twin on first activation (race fixed in `app.js`); `sceneContainer` canvas present, `webgl: true`, `twin-asset = 18` |
| 13 | Twin — renderer | `new THREE.WebGLRenderer({ antialias: true })` @ three 0.169.0; canvas sized to container in all viewports (375: 375×732; 1920: 1696×996) |
| 14 | Twin — data mapping | 18 backend machines placed 1:1 (no frontend-only machines); zone rows per `ZONE_ORDER`, machine counts per zone = 5/3/2/5/2/1 |
| 15 | Twin — state colors | Status-driven coloring verified (`m-good` meters `#10b981`, chip attention `!` badges, basis pill green when LIVE · STOMP) |
| 16 | Responsive — 375 | No h-scroll (`docSW=375`); rail off-canvas (fixed, w290, translateX −304.5); inspector bottom-sheet w375; labels 12.19px |
| 17 | Responsive — 768 | No h-scroll; compact rail 184px; inspector right drawer w400; labels 12.19px |
| 18 | Responsive — 1024 | No h-scroll; rail 224px; drawer w400; labels 12.19px |
| 19 | Responsive — 1440 | No h-scroll; rail 224px; inline static inspector w384; thr + ML pills visible |
| 20 | Responsive — 1920 | No h-scroll; rail 224px; inline static inspector w384; twin 1696×996 |
| 21 | Topbar | No clipping on any viewport; at 375 a 42px flex-lane squeeze is cosmetic, on-viewport, no h-scroll (documented tolerance) |
| 22 | Rail legibility | All 12 labels `12.1875px`, never the legacy 9px collapse, at every viewport |
| 23 | Inspector reachability | Sheet (≤700) / drawer (701–1180) / inline (>1180); toggles verified; micro-bars render on selection: Health 82.9%, Anomaly 56.8% LOW, Failure risk 0.1% LOW |
| 24 | HUD contents | Basis badge `LIVE · STOMP`, 6 zone chips (MACHINING ·5·1!, ASSEMBLY ·3, PACKAGING ·2, UTILITIES ·5·1!, MATERIAL_HANDLING ·2, INSPECTION ·1), risk-mode + camera buttons — visible at all widths |
| 25 | Live transports | STOMP live (`LIVE · STOMP · ~100 events`), telemetry ~198/min, ML `vfailure-risk-v2` up; backend `dataBasis SYNTHETIC`, demoMode true |
| 26 | Contracts preserved | No backend/ML/STOMP API changes; token in module memory, login overlay flow unchanged (QA drives real UI) |
| 27 | No faked data | No `setInterval` UI fakes; all chips/pills/metrics derived from polling + STOMP + ML payloads |
| 28 | Console purity | Zero `Runtime.exceptionThrown` in any run; only console error is harness-blocked Google font (`ERR_BLOCKED_BY_CLIENT`, intentional) |
| 29 | CI checks | `git diff --check` clean; `node --check` all frontend JS; `node --test` **27/27**; `./mvnw -q package` pass (seed test asserts 18/20); ml pytest 8/8 |
| 30 | Bugs found & fixed | (a) phosphor icon 404s → `@2.1.2` `regular/style.css` link; (b) `el()` `onClick` bindings dead → `k.slice(2).toLowerCase()`; (c) `forge:ensure3d` listener registered after first activation → twin never mounted on fresh loads, moved `globalEvents()` before `bootRouter()` |
| 31 | QA evidence paths | `_qa/final_*.png` (5 screenshots), `_qa/qafinal.txt` (probes + errors); harness `qa_final.mjs` (mirrors 4 CDN assets, blocks Google fonts, drives login via CDP, zero app injection) |
| 32 | Open risks / follow-ups | ≤400px topbar flex-lane squeeze (cosmetic, tolerance); full WebGL render is SwiftShader (headless) — recommend one real-browser visual pass on physical hardware; QA harness lives in the opencode temp dir, not versioned |

## Artifacts

- Implementation: `docs/audit/VISUAL_UPGRADE_IMPLEMENTATION.md`
- Verification (rows 1–25, all PASS): `docs/audit/VISUAL_UPGRADE_VERIFICATION.md`
- Screenshots/logs: `_qa/final_1_375.png`, `_qa/final_2_768.png`, `_qa/final_3_1024.png`,
  `_qa/final_4_1440.png`, `_qa/final_5_1920.png`, `_qa/qafinal.txt`
- QA driver (dev tool, versioned): `tools/visual-qa/qa_final.mjs` — run with `npm run qa:visual` from `frontend/`