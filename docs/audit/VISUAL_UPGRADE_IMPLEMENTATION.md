# Visual Upgrade — Implementation

## Scope

Production-hardening pass for the ForgeSense control room: a dense, believable 3D digital
twin, a fixed navigation rail/header/inspector layout, backend-backed machine population,
responsive behavior from 375px to 1920px, and status transparency. It preserves the existing
graphite/copper identity, the STOMP/realtime contract, the ML service, and the four-file CSS
split (`tokens.css` → `base.css` → `components.css` → `views.css`).

Everything the UI draws is backend/MachineProfileCatalog-driven. No frontend-only machines,
no `setInterval` fakes, no genuine architectural rewrites.

## Catalog & backend (single source of truth)

- `config/machine_profiles.json` is the authoritative catalog: zones, machines, dependency
  edges. Frontend, `DataSeeder`, the ML service, and the simulator all derive from it.
- Zones expanded to six, ordered by material flow through the plant:

  | zone | order | machines |
  |---|---|---|
  | MACHINING | 1 | M-101, M-104, M-109, M-110, M-111 |
  | ASSEMBLY | 2 | M-106, M-112, M-113 |
  | PACKAGING | 3 | M-102, M-114 |
  | UTILITIES | 4 | M-103, M-105, M-107, M-108, M-118 |
  | MATERIAL_HANDLING | 5 | M-115, M-116 |
  | INSPECTION | 6 | M-117 |

  > Zone `order` in the catalog ranges 1..6; the frontend renders zones in that order.
- Machine fleet grown from 8 to 18 (M-101..M-118). Ten new machines reuse only
  domain-compatible types already defined in the enum (`CNC_MILL`, `INDUSTRIAL_MOTOR`,
  `HYDRAULIC_PUMP`, `CONVEYOR_DRIVE_MOTOR`, `COMPRESSOR`, `ROBOTIC_ARM`, `COOLING_UNIT`,
  `GENERATOR`) so `MachineProfileCatalog` sensor validation and the ML/simulator feature
  schemas match without new code.
- Dependency graph extended to 20 directed edges (MATERIAL, POWER, COOLING, SERVICE).
  Edges only reference existing machine ids (verified: no dangling edges).
- `DataSeeder.positions()` supplies twin anchor coordinates for all 18 machines; javadoc and
  seed logs describe the "18 machine fleet". Seeding stays idempotent (machine table empty
  check), so `docker compose down -v` + re-up is required on a previously seeded volume.

## Layout: rail, header, inspector (the clipping fix)

The root cause of the original clipping was a 72px icon rail whose labels were collapsed to
9px text, an over-tight header, and an inspector that behaved differently at three breakpoints.

- `tokens.css`: `--rail-width` is now 224px. Added compact (184px), icon (60px) rails and
  `--inspector-height-mobile` for the bottom sheet. New `--header-height`/`--z-drawer`
  usage is consistent with the existing scale.
- `base.css`: brand, factory chip, and topbar-status all gained `min-width:0` + ellipsis so
  they truncate gracefully instead of pushing the header off-screen. `.rail-btn` is a
  full-label item (flex + ellipsis label). Active state uses a copper left accent bar and a
  subtle copper gradient; both `.active` and `aria-current="page"` are styled.
- `views.css` responsive strategy (documented in-file):

  | width | rail | inspector |
  |---|---|---|
  | > 1180px | inline full rail | inline panel |
  | 701–1180px | inline full rail (compact at ≤900px) | right-side drawer |
  | ≤ 700px | off-canvas drawer (toggled by `#mobileNavToggle`) | bottom sheet |

  Nav labels are never collapsed to 9px text at any width the rail is shown.
- The old ≤980 / ≤760 "9px label" overrides were removed; conflicting drawer rules were
  consolidated into one place each in `views.css`.

## 3D digital twin (`twin3d.js` rewrite)

Rewritten while preserving the exported API (`initTwin`, `updateTwin`, `updateMachines`,
`syncMachines`, `resetCamera`, `focusTop`, `focusOnMachine`, `focusOnZone`, `setSimMode`,
`setRiskMode`, `isTwin`, `disposeTwin`).

- Physical layout: six zone rows (`ROW_PITCH` 6.9, `ROW_OFFSET` 2.6), machines spaced
  `MACHINE_SPACING` 4.6 within a zone, centered on the bay, ordered by machine id.
- Per-type meshes with rotation states: CNC spindle/motor/pump/compressor/generator rotors,
  conveyor rollers + drive drum, two-segment robot arm, cooling fan.
- Each machine sits on a plinth with a status indicator bar mounted at its own front edge and
  a two-line sprite label (id · name, state · risk) that rescales by camera distance and
  re-renders only when its status signature changes.
- Environment: zone slabs (6 zone tints), zone edge outlines, zone name sprites, safety-stripe
  floor, grid, animated dash flow strips on every row plus a left spine with directional
  cones following material flow, and curved dependency edges with arrow heads colored by
  relation (MATERIAL / POWER / COOLING / SERVICE).
- Interaction: hover raycast (cursor + dim non-hovered), click select, double-click focus,
  arrow-key cycling + Enter select (guarded against inputs, the inspector, and non-factory
  views), zone focus with dimming of other zones.
- Camera: fit-to-bounds reset, top-down focus, per-machine focus with eased lerp target.
- Quality: dynamic pixel-ratio adaptation based on measured FPS, `prefers-reduced-motion`
  disables all animation, `document.hidden` pauses the loop.
- Lifecycle: full geometry/material/texture disposal on rebuild and `disposeTwin`, shared
  assets (rings, arrows, dash/canvas textures) disposed exactly once.

### Cleanup notes

Removed leftovers from the rewrite: a bogus floor plane (`grapheneHelper`) sized incorrectly,
unused `labelTimer`/`onCameraChange`/`pointer` stubs, dead `skip` branches in picking, and a
double-creation shared-geometry pattern for dependency edges (edges now own plain
`BufferGeometry` that is disposed on rebuild). Status indicator bars now mount at each
machine's real front edge instead of a fixed world offset.

## Status transparency

- `index.html`: thr and ML pills carry `thr-pill`/`ml-pill` classes so responsive CSS can
  drop them before the header overflows; a new `#twinBasis` status badge lives in the factory
  HUD.
- `factoryView.renderBasis(s)` reports one of `LIVE · STOMP`, `SIMULATION`, `REST SNAPSHOT`,
  or `DISCONNECTED · RETRY` derived from `liveTransport.state`, `freshness.ok`, and the
  status `demoMode`/`dataBasis` flags, with a matching tone + tooltip.
- `components.css` adds the `.basis-badge` states (pulsing dot), zone-chip tints for all six
  zones, twin-asset list polish, inspector polish, `.meter` micro-bars, and HUD button
  accents — all using existing design tokens.

## Inspector

- `statBox` gained an optional micro-meter bar; overview Health, Anomaly score and Failure
  risk now render real-data bars with tone classes (`m-good`/`m-warn`/`m-critical`/`m-maint`/
  `m-info`) mapped from `healthScore/100`, `anomalyScore`, and `riskInfo(...).tone`.

## Files touched

- `config/machine_profiles.json`
- `backend/.../bootstrap/DataSeeder.java`
- `frontend/index.html`
- `frontend/css/tokens.css`, `base.css`, `components.css`, `views.css`
- `frontend/js/twin3d.js` (rewrite)
- `frontend/js/views/factoryView.js`, `frontend/js/views/inspector.js`

## Non-goals honored

- No backend/ML architecture rewrites; no STOMP/API contract changes (payloads unchanged).
- No new dependencies beyond the existing `three` import map; no CSS `!important` (the only
  `!important` in touched files predates this work and is in unrelated command-layout rules).
- ML/realtime contracts preserved exactly (see `docs/REALTIME.md`, `docs/PHASE1_CONTRACTS.md`).