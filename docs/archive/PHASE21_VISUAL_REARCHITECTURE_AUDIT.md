# Phase 21 — Visual Re-Architecture Audit

**Date:** 2026-09-21
**Scope:** `frontend/` visual system, 3D twin, shell/navigation, login, views
**Baseline:** 36/36 frontend tests green, QA 5/5 at 375/768/1024/1440/1920, realtime gaps 5/5, node --check clean

---

## A. Current visual problems

1. **Copper-first brand language is dated.** `--color-copper (#c9762e)` is the primary accent: active rail, focus ring, selection, links, buttons, icons, `st-info` tone, `viz-1`. The whole product reads as an "orange industrial template".
2. **Status color overload.** `good/warn/critical/maint/info` are painted everywhere (KPIs, pills, rows, tags, bars, accent lines). Six bright colors appear simultaneously on most screens.
3. **"Pill everything."** `pill-status`, `badge2`, `chip`, `conf-tag`, `basis-badge`, topbar/service pills dominate. Ordinary metadata is dressed as pills.
4. **Card-everything layout.** Command, Predictions, Fleet, Alerts wrap every section in `div.card` with border+radius+shadow. Hierarchy is lost — five equal KPI cards compete with real risk.
5. **Dense borders.** `--color-border #233044` is a heavy opaque stroke; nearly every element carries `border: 1px solid var(--color-border)`. Surfaces look boxed rather than spatial.
6. **Uppercase everywhere.** `MACHINING`, `TOP RISK`, `OUTAGE`, `SITUATION`, `OPERATIONS / LIVE FACILITY`, status pills, zone names — terminal-like shouting.
7. **3D twin looks like a network viz.** Giant rainbow CatmullRom dependency arcs + arrow cones, six colored zone slabs, glowing status rings, floating monospace labels on every machine, big grid dominating the floor, dark void background.
8. **Topbar/statusbar density.** Topbar shows backend/ML/transport/throughput pills + clock + user + commands; statusbar lists 8 services at equal weight.
9. **Login = dev tool.** Shows dev credential hints ("Passwords come from FORGESENSE_DEV_PASSWORD") and a raw "Connect" form over the flashing dashboard.
10. **Mixed token namespace.** `tokens.css` mixes `--color-*`, `--viz-*`, `--text-*`, `--space-*` with legacy `--glow-*`, `--shadow-*`, `--rail-width-compact` legacy values; inline `rgba(...)` literals in components.css and views.css.
11. **Generic SaaS/SCADA look.** Equal cards, `ops-strip` with 5 monotone bricks, `grid cols-4` KPI walls, empty space not used for hierarchy.

## B. Root causes

- There is **one visual primitive** (`card`) used for every container; no surface-level system.
- The **status tone table** is the default decoration instead of exception-driven emphasis.
- The **3D scene was built as a graph** (nodes + arcs) before it was a factory; zones colored like categories, not architecture.
- The **brand color was inherited** from an early "forge" (fire/copper) concept and never re-evaluated against a modern industrial platform.
- **Typography defaults to uppercase micro-labels** because the original design leaned on "HUD" aesthetics rather than enterprise information hierarchy.
- The **shell** (topbar + statusbar + rail) surfaces every telemetry detail instead of one aggregate state.

## C. Proposed visual principles

1. **Calm intelligence over dashboard noise.** Default reads quiet; state color is emphasis, not decoration.
2. **Neutral-first 70/20/10.** 70% neutral graphite/slate, 20% cool blue/steel/teal structure, 10% semantic status. UI must survive all colors removed.
3. **Spatial, not boxed.** Surfaces are distinguished by lightness and material, not by borders everywhere.
4. **Physical factory over network graph.** The twin is a facility: floor, zones, aisles, machines; dependencies are contextual, opt-in layers.
5. **Sentence-case, human-readable labels.** Uppercase reserved for machine IDs, codes, system metadata.
6. **Hierarchy by scale and whitespace.** The most important asset gets the most visual weight; low-value info goes quiet.
7. **Material used for depth, not decoration.** Selective translucency on floating surfaces (inspector, login, palette). No glass-everywhere.

## D. New design system — "Industrial Precision"

- **Brand:** cool electric blue `#4FA7FF` + steel/teal support. Copper/amber becomes warning-only.
- **Backgrounds:** `#070D15` → `#0A121B` → `#0E1A26` → `#132330` (four-step neutral ramp).
- **Borders:** hairline `rgba(150,182,208,0.07/0.12/0.22)`.
- **Semantic state:** calibrated green / amber / red / cyan, each used deliberately.
- **Type:** Inter UI + JetBrains Mono data; sentence case; 2.5rem display; generous KPI numerals.
- **Four elevation levels** replace "every section is a card".
- **Restricted glass:** floating inspector, login surface, command palette, factory HUD only.
- Full token map becomes the single source of truth in `frontend/css/tokens.css`.

## E. Component migration map

| Current | New |
| --- | --- |
| `.card` everywhere | `.surface` (L1 section) / `.panel` (L2 elevated) / `.float` (L3) / `.canvas` (L0) |
| `.kpi` 5-across strips | `.metric` families with weighted sizing; primary metric large |
| `.pill-status` overuse | inline `.state` dot + text; `pill` only for real state classification |
| `.badge2` metadata | `.meta` muted text |
| `.ops-strip` 5 bricks | Command hierarchy: header / situation / fleet / top risk / actions |
| topbar pills | 1 system indicator + 1 ML indicator; the rest → diagnostic drawer |
| statusbar 8 services | 1 aggregate state line → diagnostics drawer |
| nav 12 flat buttons | grouped rail: Monitor / Intelligence / Operations / Admin |
| login dev form | premium pre-auth environment surface |
| rainbow dep arcs | contextual dependency layers, hidden by default |
| glowing labels/rings | quiet machine labels, thin selection outline |

## F. 3D twin redesign plan

- Isometric elevated default camera; factory fills ~70% of viewport (fov-based frame math).
- Floor: facility slab, zone slabs with hairline boundaries, aisle lanes, safety strips; grid removed/subtle.
- Zones: neutral graphite architecture, subtle floor label; accent only on highlight.
- Machines: graphite body, steel structure, muted blue control panel, tiny emissive indicator; physical proportions.
- Dependency layers: default OFF. Modes: physical / flow / selected / risk / all. Thin grounded directional lines.
- Selection: hairline outline + soft local light + small label; remove giant rings.
- Layers object structure (`environment / productionCells / machines / flow / selection / annotations`) so layers toggle without rebuilds.
- Motion: meaningful only (spindles, fan, material flow, camera) with `prefers-reduced-motion` respected.

## G. Motion system

| Class | Duration | Purpose |
| --- | --- | --- |
| micro | 120–180ms | hover, focus |
| ui | 200–300ms | panel open/close |
| navigation | 250–350ms | route transition |
| spatial | 400–700ms | 3D camera fly-to |
| data | subtle | numeric interpolation, meter fills |
| live | — | only true live-state movement |

No bounce, no constant glow, no decorative loops. Every animation must communicate.

## H. Validation criteria

1. `node --check` on all frontend JS modules.
2. `npm test` → 36/36 green.
3. `npm run qa:visual` → 5/5 viewports PASS, zero unexpected console errors, zero failed assets.
4. Factory: 18 machines, 6 zone chips, STOMP basis, selection + inspector `.meter`, no h-scroll at 375/768/1024/1440/1920.
5. Login: boots through new pre-auth surface; no dev credential text.
6. Dependency arcs hidden by default; no rainbow arcs unless a dependency layer is enabled.
7. Greyscale test: UI remains legible without status color.
8. No dead CSS/JS; obsolete tokens removed.

---
*Next step: implementation (Phases 21.2 → 21.21).*