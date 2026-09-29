# Component Baseline — ForgeSense Industrial Intelligence

**Date:** 2026-09-18
**Scope:** Inventory of every major frontend component with decision rationale

---

## Component Inventory

| # | Component | Location | Purpose | Dependencies | Data Source | Current Functionality | Visual Quality | Interaction Quality | Known Defects | Decision | Reason |
|---|-----------|----------|---------|--------------|-------------|----------------------|----------------|---------------------|---------------|----------|--------|
| 1 | **App Shell** | `index.html` + `app.js` | Global layout: header rail, view outlet, modal root, toast host | `router.js`, `state.js`, `api.js` | — | Loads all views, binds rail, inits WS | Functional, dark navy | Rail keyboard nav works | No mobile hamburger | **VISUAL REDESIGN** | Layout works but visual identity generic; mobile broken |
| 2 | **Navigation Rail** | `index.html` (markup) + `app.js` (bind) | Primary navigation: 10 view buttons + user menu | `router.js` | — | Click → hash change → view swap | Icon + label, active state | Keyboard accessible | No responsive collapse | **VISUAL REDESIGN** | Works desktop; needs mobile drawer |
| 3 | **Command Palette** | `js/command.js` + `index.html` modal | Cmd+K fuzzy search for actions/views | `router.js`, `state.js` | Static action registry | Opens, filters, executes | Clean, minimal | Cmd+K, arrows, Enter | No ARIA on trigger | **KEEP** | High utility, low footprint |
| 4 | **Factory View (Digital Twin Host)** | `js/views/factoryView.js` | Thin wrapper mounting `twin3d.js` | `twin3d.js`, `state.js` | WS telemetry | Mounts canvas, passes selection | Delegates to twin | Click → select machine | Only 44 lines — too thin | **KEEP** | Correct delegation pattern |
| 5 | **Digital Twin (3D Scene)** | `js/twin3d.js` | Three.js scene: machines, camera, grid, selection | Three.js (CDN), `state.js` | WS `telemetry` + `machineState` | 100 instanced boxes, orbit cam, raycast select | Placeholder boxes, navy gradient sky | Click select, orbit/pan/zoom | No assets, color-only encoding, 500 machines <30fps | **VISUAL REDESIGN + REFACTOR** | Core differentiator; needs asset pipeline, GPU color, LOD |
| 6 | **Command Center View** | `js/views/command.js` | KPI cards, fleet status grid, quick actions | `api.js`, `state.js`, `charts.js` | REST `/machines`, `/telemetry/latest`, `/predictions/summary` | 4 KPI cards + 8 fleet status cards | Card grid, generic SaaS | Hover card → tooltip | Static KPI values (no live update) | **VISUAL REDESIGN** | Functionality correct; visual generic |
| 7 | **Fleet View** | `js/views/fleet.js` | Machine table with filters, zone chips, sparklines | `api.js`, `state.js`, `charts.js`, `shared.js` | REST `/machines` + WS `telemetry` | Sortable table, filter chips, inline sparklines | Dense table, status chips | Row click → inspector | Sparkline re-renders full on tick | **VISUAL REDESIGN** | High info density; visual redesign needed |
| 8 | **Analytics View** | `js/views/analytics.js` | Time-series charts for telemetry trends | `api.js`, `charts.js` | REST `/telemetry/history` | Multi-series line chart, range picker | Chart.js default theme | Range change → refetch | No downsampling; re-renders full | **VISUAL REDESIGN + PERF REFACTOR** | Chart works; needs decimation + batching |
| 9 | **Predictions View** | `js/views/predictions.js` | Failure risk, RUL, anomaly scores per machine | `api.js`, `charts.js`, `api.assess()` | REST `/predictions` + ML `/assess` | Risk cards, confidence bands, RUL bars | Card + chart mix | Machine select → detail | ML call on every select (no cache) | **VISUAL REDESIGN + REFACTOR** | ML integration works; UI generic |
| 10 | **Alerts View** | `js/views/alerts.js` | Alert feed, acknowledge, severity filter | `api.js`, `state.js` | WS `alert` + REST `/alerts` | Live list, ack button, severity chips | List + chips | Ack → PATCH → toast | No pagination (unbounded list) | **VISUAL REDESIGN** | Functional; add pagination + virtual list |
| 11 | **Maintenance View** | `js/views/maintenance.js` | Work orders CRUD, scheduling, parts | `api.js`, `state.js` | REST `/maintenance` | Table + create modal | Modal form, table | Create/edit/delete | No drag-drop scheduling | **VISUAL REDESIGN** | CRUD works; scheduling UI weak |
| 12 | **Simulation View** | `js/views/simulation.js` | Scenario runner, speed control, fault inject | `api.js`, `state.js` | WS `simulation` + REST `/simulation/*` | Dropdown, speed slider, fault buttons | Panel + canvas preview | Start/pause/reset, inject | Preview canvas minimal | **VISUAL REDESIGN** | Unique feature; preview needs love |
| 13 | **System View** | `js/views/system.js` | Health, config, feature flags | `api.js` | REST `/system/health`, `/config` | Status badges, toggle switches | Simple list | Toggle → PATCH | No audit log | **VISUAL REDESIGN** | Functional admin view |
| 14 | **Inspector Drawer** | `js/views/inspector.js` | Machine detail: telemetry sparklines, actions, 3D sync | `api.js`, `charts.js`, `twin3d.js`, `state.js` | REST `/machines/{id}`, `/telemetry/{id}`, WS | 482 lines: data fetch, charts, 3D highlight, actions | Split pane: left details, right charts | Camera fly-to, ack, schedule | Bloated; mixes fetch/chart/3D | **REFACTOR** | Split into presenter + view components |
| 15 | **Toast/Notification Host** | `index.html` + `app.js` (inline) | Transient success/error/info toasts | `util.js` | `api.js` errors, WS events | Auto-dismiss, stack | Minimal | Dismiss on click | No history/center | **REFACTOR** | Extract to `js/toast.js` |
| 16 | **Modal/Drawer System** | `css/components.css` + inline JS | Reusable modal (center) + drawer (right) | — | — | Open/close, overlay, focus trap (partial) | Consistent styling | Escape closes (partial) | Inspector not focus-trapped | **REFACTOR** | Centralize in `js/overlay.js` |
| 17 | **Status Chip / Badge** | `css/components.css` + `shared.js` colorMap | Semantic status: RUNNING/WARNING/ERROR/OFFLINE | `shared.js` | Machine state | Color dot + label | Color-only (no icon) | — | Color-only violates WCAG 1.4.1 | **VISUAL REDESIGN** | Add icon + text fallback |
| 18 | **Sparkline (Inline Chart)** | `js/charts.js` `createSparkline()` | 60-point mini trend for fleet rows | Chart.js | WS `telemetry` buffer | 60px wide, no axes | Mini, no labels | — | Re-renders full on every tick | **PERF REFACTOR** | Batch updates with rAF |
| 19 | **Trend Chart (Full)** | `js/charts.js` `createTrendChart()` | Multi-series line chart with tooltip | Chart.js | REST `/telemetry/history` | 24h/7d/30d range | Chart.js default | Hover tooltip | No downsampling >500 pts | **PERF REFACTOR** | Add LTTB decimation |
| 20 | **Confidence Band Chart** | `js/charts.js` `createConfidenceChart()` | Prediction mean ± std dev | Chart.js | ML `/assess` response | Mean line + shaded band | Shaded area | Hover detail | Re-renders on select | **KEEP + PERF REFACTOR** | Niche but correct |
| 21 | **Filter Chips** | `css/components.css` + view JS | Multi-select filter pills | — | View state | Click toggle, clear all | Pill style | Keyboard accessible | No mobile popover | **VISUAL REDESIGN** | Works desktop; mobile needs popover |
| 22 | **Data Table** | `css/components.css` + view JS | Sortable, filterable machine table | — | `state.machines` Map | Sort click, row select | Dense, hover highlight | Enter → inspector | No virtualization | **REFACTOR** | Add virtual scroll for 1000+ rows |
| 23 | **Form Modal** | `css/components.css` + view JS | Create/edit work order, simulation config | — | View submit handler | Validation, submit, close | Consistent | Tab order correct | No dirty-check on close | **KEEP** | Pattern solid |
| 24 | **Loading States** | `css/components.css` (`.skeleton`, `.spinner`) | Skeleton screens, button spinners | — | View fetch promises | Skeleton on list load | Gray pulse | — | Not used consistently | **VISUAL REDESIGN** | Standardize skeleton patterns |
| 25 | **Error States** | `css/components.css` (`.error-banner`) + `api.js` | Inline error banner, toast on 4xx/5xx | `api.js` | Fetch catch | Banner + toast | Red banner | Dismissible | No retry action | **VISUAL REDESIGN** | Add retry + offline banner |
| 26 | **Empty States** | View-specific inline | "No machines", "No alerts", etc. | — | Empty collections | Text + icon | Minimal | — | Inconsistent copy/icons | **VISUAL REDESIGN** | Standardize empty state component |

---

## Cross-Cutting Decisions

| Pattern | Current | Target |
|---------|---------|--------|
| **View Architecture** | Each view = single JS file with fetch+render+WS mixed | Presenter/View split; shared base class |
| **State Propagation** | Global `State` mutation broadcasts to all listeners | Signal-based granular subscriptions |
| **Realtime Handling** | Inline `switch` in `app.js` `onmessage` | Typed handler registry in `js/realtime.js` |
| **Chart Updates** | Full `chart.update()` on every WS tick | Batch with `requestAnimationFrame` + data window |
| **3D Updates** | CPU loop updates instance colors per frame | GPU instanced color buffer + frustum culling |
| **Responsive** | Desktop-only rail; mobile broken | Mobile-first: drawer rail, stacked twin, bottom sheets |
| **Accessibility** | Partial (focus-visible, contrast) | Full WCAG 2.1 AA: ARIA, focus trap, color-independent status |
| **Visual Language** | Navy/blue tokens, generic cards | Distinct industrial tokens (Graphite+Copper/Amber) |

---

## Summary Counts

| Decision | Count |
|----------|-------|
| KEEP | 6 |
| VISUAL REDESIGN | 12 |
| REFACTOR | 6 |
| REWRITE | 0 |
| REMOVE | 0 |
| PERF REFACTOR | 4 (subset of above) |

**Total Components:** 26 (including sub-components like chips, tables, charts)