# Redesign Scope — ForgeSense Industrial Intelligence

**Date:** 2026-09-18
**Input:** FRONTEND_AUDIT.md, FRONTEND_BASELINE.md, COMPONENT_BASELINE.md, PERF_BASELINE.md
**Purpose:** Categorize every frontend element for the redesign program

---

## Categorization Legend

| Category | Meaning | Action |
|----------|---------|--------|
| **PRESERVE** | Technically correct, functionally complete, visually acceptable | Zero changes; regression-test only |
| **VISUAL REDESIGN** | Functionality correct; UI weak (generic, inconsistent, not distinctive) | New visual language; same component API |
| **UX REDESIGN** | Workflow flawed; user friction; missing affordances | Redesign interaction flow + visual |
| **REFACTOR** | Architecture needs improvement (coupling, duplication, scalability) | Internal rewrite; same external behavior |
| **REWRITE** | Current implementation unsuitable for target requirements | Replace entirely; new architecture |
| **REMOVE** | Dead, duplicated, or obsolete | Delete |
| **NEW** | Required capability missing from current system | Build from scratch |

---

## Classification by Component

### PRESERVE (6)

| Component | Location | Reason |
|-----------|----------|--------|
| **Hash Router** | `js/router.js` | Minimal, dependency-free, works; only refactor if History API needed |
| **Command Palette** | `js/command.js` | High utility, clean implementation, keyboard-first |
| **REST Client (api.js)** | `js/api.js` | Thin `fetch` wrapper with auth/refresh; zero bloat |
| **Chart.js Wrapper** | `js/charts.js` | Thin, correct; only perf batching needed |
| **Form Modal Pattern** | `css/components.css` + view JS | Consistent validation/submit/close; reusable |
| **Toast/Notification Core** | `app.js` inline | Works; just needs extraction to dedicated module |

---

### VISUAL REDESIGN (12)

| Component | Location | Current Problem | Target |
|-----------|----------|-----------------|--------|
| **App Shell / Layout** | `index.html` + `app.js` | Generic dark-navy SaaS; no mobile rail | Distinct industrial shell; mobile-first drawer |
| **Navigation Rail** | `index.html` + `app.js` | Desktop-only; no collapse/hamburger | Adaptive: rail → drawer → bottom bar |
| **Command Center View** | `js/views/command.js` | Generic KPI card grid | Industrial dashboard: density, hierarchy, real-time feel |
| **Fleet View** | `js/views/fleet.js` | Dense table + sparklines; status chips color-only | Accessible chips (icon+text), virtual scroll, density toggle |
| **Analytics View** | `js/views/analytics.js` | Chart.js defaults; no decimation | Industrial trend charts: decimation, annotations, export |
| **Predictions View** | `js/views/predictions.js` | Card + chart mix; ML call per select | Confidence-first UI; cached assessments; explainability |
| **Alerts View** | `js/views/alerts.js` | Unbounded list; no pagination | Virtual list, severity lanes, bulk actions |
| **Maintenance View** | `js/views/maintenance.js` | Basic CRUD; no drag-drop scheduling | Kanban board + timeline; drag-drop WO |
| **Simulation View** | `js/views/simulation.js` | Minimal preview canvas | Rich scenario builder; live twin preview |
| **System View** | `js/views/system.js` | Bare admin list | Structured config panels; audit log |
| **Status Chip / Badge** | `css/components.css` + `shared.js` | Color-only (WCAG fail) | Icon + text + color; semantic token mapping |
| **Design Token System** | `css/tokens.css` | 38 props, navy-dominant, no semantic aliases | Industrial palette (Graphite+Copper/Amber); semantic aliases; motion tokens |

---

### UX REDESIGN (4)

| Component | Location | Workflow Issue | Target |
|-----------|----------|----------------|--------|
| **Inspector Drawer** | `js/views/inspector.js` | Bloated (482 lines); mixes data/chart/3D; no focus trap | Split: presenter + view; focus trap; keyboard shortcuts |
| **Responsive Shell** | `index.html` + `app.js` | Mobile broken: no hamburger, overflow, inspector overlaps | Mobile-first: bottom nav, stacked twin, bottom-sheet inspector |
| **Digital Twin Interaction** | `js/twin3d.js` | Click-only select; no multi-select, no context menu | Multi-select (shift+click), context menu, keyboard nav |
| **Simulation Scenario Builder** | `js/views/simulation.js` | Dropdown + buttons only | Visual node-graph builder; live twin preview |

---

### REFACTOR (6)

| Component | Location | Architectural Issue | Target |
|-----------|----------|---------------------|--------|
| **WebSocket Layer** | `app.js` (inline) | Inline `switch` in `onmessage`; no typed handlers | `js/realtime.js`: typed registry, subscriptions, backpressure |
| **State Management** | `js/state.js` | Global mutable singleton; broadcast to all listeners | Signal-based store (`@preact/signals-core` or 50-line proxy) |
| **Inspector (Internal)** | `js/views/inspector.js` | 482 lines mixing fetch/chart/3D | Split: `InspectorPresenter` + `InspectorView` + `Inspector3DSync` |
| **Overlay System** | `css/components.css` + inline | Modal/drawer logic duplicated; focus trap partial | `js/overlay.js`: unified Modal/Drawer/Toast with focus trap |
| **Chart Update Pipeline** | `js/charts.js` + views | Full `chart.update()` on every WS tick | Batch with rAF; data windowing; decimation |
| **3D Update Pipeline** | `js/twin3d.js` | CPU loop updates instance colors per frame | GPU instanced color buffer; frustum culling; LOD |

---

### REWRITE (0)

*None at baseline — all core functionality works; no component is fundamentally unsuitable.*

---

### REMOVE (0)

*No dead/duplicated code found. Two near-duplicates noted but both active:*
- `js/command.js` (palette) vs `js/views/command.js` (view) — **different purposes**
- `js/views/factoryView.js` (44 lines) vs `js/twin3d.js` — **thin wrapper pattern, keep**

---

### NEW (7) — Required Capabilities Missing

| Capability | Description | Priority |
|------------|-------------|----------|
| **Offline-First / PWA** | Service worker, cache-first assets, background sync for pending actions | High |
| **Deep-Linking / Shareable State** | URL sync for view, filters, selected machine, time range | High |
| **Export / Reporting** | PDF/CSV export for analytics, maintenance, alerts | Medium |
| **Notification Center** | Persistent toast history, bell icon, mark-read | Medium |
| **User Preferences Panel** | Theme, density, units, timezone, notifications | Medium |
| **Multi-Language (i18n)** | EN/DE at minimum; tokenized strings | Medium |
| **Visual Regression Testing** | Playwright + pixelmatch for component snapshots | High (gate for redesign) |

---

## Redesign Phases (Sequential)

### Phase 1: Foundation (Weeks 1–2)
- [ ] Design token system v2 (industrial palette, semantic aliases, motion)
- [ ] Extract `js/realtime.js`, `js/overlay.js`, `js/state.v2.js` (signals)
- [ ] Add Vitest + Playwright + visual regression harness
- [ ] Establish performance budgets in CI (Lighthouse + custom)

### Phase 2: Visual Language + Shell (Weeks 3–4)
- [ ] Industrial color palette (Graphite + Copper/Amber) + semantic tokens
- [ ] Typography scale + motion tokens
- [ ] Mobile-first shell: adaptive rail → drawer → bottom bar
- [ ] Responsive twin canvas (aspect-preserving, no overflow)
- [ ] Accessibility baseline: ARIA, focus trap, color-independent status

### Phase 3: Core Views (Weeks 5–8)
- [ ] Command Center — industrial dashboard density
- [ ] Fleet — virtual table, accessible chips, density toggle
- [ ] Analytics — decimation, annotations, export
- [ ] Predictions — confidence-first, cached ML, explainability
- [ ] Alerts — virtual list, severity lanes, bulk actions
- [ ] Maintenance — Kanban + timeline
- [ ] Simulation — node-graph builder, live preview
- [ ] System — structured config, audit log

### Phase 4: Digital Twin Overhaul (Weeks 9–12)
- [ ] Asset pipeline: GLTF models, texture atlas, LOD
- [ ] GPU instanced color buffer (shader-driven state)
- [ ] Frustum culling + LOD (impostors at distance)
- [ ] Semantic visual encoding: vibration, heat, particles
- [ ] Multi-select, context menu, keyboard nav
- [ ] Camera: cinematic transitions, preset views

### Phase 5: Integration & Polish (Weeks 13–16)
- [ ] End-to-end realtime pipeline with backpressure
- [ ] Inspector split (presenter/view/3D sync) + focus trap
- [ ] Offline-first PWA (service worker, background sync)
- [ ] Deep-linking / shareable state
- [ ] Export / reporting (PDF/CSV)
- [ ] Notification center + preferences panel
- [ ] i18n (EN/DE)
- [ ] Visual regression gate in CI
- [ ] Performance budgets enforced in CI

---

## Constraints (Non-Negotiable)

1. **No navy/blue default** — palette must be distinctive industrial
2. **No generic card-grid dashboards** — density + hierarchy
3. **Digital twin is centerpiece** — not decoration; drives layout
4. **Accessibility = requirement** — WCAG 2.1 AA minimum
5. **Performance budgets enforced in CI** — no regressions
6. **No heavy framework** — stay vanilla ES modules or minimal signals
6. **Twin renders 500 machines @ 45fps** — GPU instancing + culling
7. **Mobile-first responsive** — no desktop-only features

---

## Approval Gate

Redesign begins **only after**:

- [ ] All 8 audit deliverables complete
- [ ] Baseline matrix reviewed and signed off
- [ ] Critical failures acknowledged with remediation owners
- [ ] Design research summary delivered (separate doc)
- [ ] Visual identity (palette, typography, motion) approved
- [ ] Performance budgets codified in CI