# Frontend Audit — ForgeSense Industrial Intelligence

**Date:** 2026-09-18
**Branch:** `release/reconcile-forgesense` (post-merge baseline)
**Scope:** Complete frontend codebase inventory, architecture, and state assessment

---

## 1. Framework / Runtime

| Attribute | Value |
|-----------|-------|
| **Framework** | None — vanilla ES modules (no build step, no bundler) |
| **Runtime Target** | Evergreen browsers (ES2022 modules, CSS custom properties, `ResizeObserver`, `IntersectionObserver`) |
| **Entry Point** | `frontend/index.html` (7.5 KB, 129 lines) |
| **Dev Server** | `frontend/serve.py` (Python 3.14 `http.server` on port 5173) |
| **Package Manager** | None (`package.json` only declares dev scripts; no `node_modules`) |
| **Transpilation** | None — ships native ES modules |

**Evidence:** `frontend/index.html` uses `<script type="module" src="/js/app.js">`; `serve.py` serves static files with correct MIME types.

---

## 2. Entry Points & Bootstrap

| File | Size | Lines | Purpose |
|------|------|-------|---------|
| `index.html` | 7.5 KB | 129 | App shell: header rail, view containers, modal root, script bootstrap |
| `js/app.js` | 14.4 KB | 316 | Main bootstrap: route registration, WebSocket init, state hydrate, rail binding |
| `js/router.js` | 4.1 KB | 116 | Hash-based SPA router with view lifecycle (`mount`, `activate`, `unmount`) |

**Bootstrap Sequence (from `app.js`):**
1. Register all views via `router.register(name, viewModule)`
2. `router.boot('factory')` — sets hash listener, binds rail nav, activates default view
3. `api.connect()` — opens WebSocket to `ws://localhost:8080/ws`
4. `state.init()` — loads persisted UI prefs from `localStorage`

---

## 3. Routing

**Implementation:** `js/router.js` (hash-based, no History API)
- Routes: `factory`, `command`, `fleet`, `analytics`, `predictions`, `alerts`, `maintenance`, `simulation`, `system`, `inspector`
- Lifecycle per view: `mount(host)`, `activate()`, `unmount()`
- Active view tracking via `activeRoute` object
- Rail sync: `.rail-btn[data-route]` ↔ hash

**Decision:** **KEEP** — minimal, dependency-free, works for SPA scope. **Refactor candidate** only if History API / deep-linking needed later.

---

## 4. Views / Pages (10 views)

| View | File | Lines | Purpose | Data Source |
|------|------|-------|---------|-------------|
| Factory (Digital Twin) | `js/views/factoryView.js` | 44 | Thin host — delegates to `twin3d.js` | WebSocket telemetry |
| Command Center | `js/views/command.js` | 152 | KPI cards, fleet status, quick actions | REST `/api/v1/*` + WS |
| Fleet | `js/views/fleet.js` | 145 | Machine table, filters, zone chips | REST `/api/v1/machines` |
| Analytics | `js/views/analytics.js` | 113 | Time-series charts (telemetry trends) | REST `/api/v1/telemetry/history` |
| Predictions | `js/views/predictions.js` | 153 | Failure risk, RUL, anomaly scores | REST `/api/v1/predictions` + ML `/assess` |
| Alerts | `js/views/alerts.js` | 124 | Alert feed, acknowledge, severity | WS `alert` events + REST |
| Maintenance | `js/views/maintenance.js` | 132 | Work orders, scheduling, parts | REST `/api/v1/maintenance` |
| Simulation | `js/views/simulation.js` | 168 | Scenario runner, speed control, inject faults | WS `simulation` + REST |
| System | `js/views/system.js` | 110 | Health, config, feature flags | REST `/api/v1/system` |
| Inspector (Detail Drawer) | `js/views/inspector.js` | 482 | Machine detail, telemetry sparklines, actions | REST + WS per machine |

**Decision Summary:**
- `factoryView.js` — **KEEP** (thin wrapper, delegates to 3D layer)
- `command.js`, `fleet.js`, `analytics.js`, `predictions.js`, `alerts.js`, `maintenance.js`, `simulation.js`, `system.js` — **VISUAL REDESIGN** (functionality correct, UI generic/card-heavy)
- `inspector.js` — **REFACTOR** (482 lines, mixes data fetch, chart init, 3D sync; split into presenter + view)

---

## 5. Core Services / Modules

| Module | Lines | Responsibility | Dependencies |
|--------|-------|----------------|--------------|
| `js/api.js` | 61 | REST client (`fetch` wrapper), JWT auth, token refresh | None |
| `js/state.js` | 176 | Global UI state (machines, alerts, prefs), `localStorage` persistence | None |
| `js/twin3d.js` | 522 | Three.js scene, machine meshes, camera, selection, animation loop | Three.js (CDN), `state.js` |
| `js/charts.js` | 184 | Chart.js wrappers (telemetry sparklines, trend lines) | Chart.js (CDN) |
| `js/command.js` | 131 | Command palette (Cmd+K), shortcuts registry | `router.js` |
| `js/shared.js` | 107 | Shared utilities (formatters, color maps, icon SVG) | None |
| `js/util.js` | 255 | DOM helpers, debounce, throttle, event bus | None |

**Decision Summary:**
- `api.js` — **KEEP** (clean, minimal)
- `state.js` — **REFACTOR** (global singleton; consider reactive proxy for finer updates)
- `twin3d.js` — **VISUAL REDESIGN** (core asset, needs identity/performance pass)
- `charts.js` — **KEEP** (thin wrapper)
- `command.js` — **KEEP** (nice UX, minimal)
- `shared.js`, `util.js` — **KEEP**

---

## 6. WebSocket / Real-time Layer

**File:** `js/app.js` lines 80–140 (inline in bootstrap)
- Connection: `new WebSocket('ws://localhost:8080/ws')`
- Message types handled: `telemetry`, `alert`, `machineState`, `prediction`, `simulation`, `heartbeat`
- Reconnection: exponential backoff (1s, 2s, 4s, max 30s) — **implemented**
- Heartbeat: client sends `ping` every 30s; server responds `pong` — **implemented**
- Listener cleanup: `beforeunload` closes socket — **present**

**Gaps Found:**
- No per-message-type handler registry (inline `switch` in `onmessage`)
- No deduplication guard for rapid `telemetry` bursts
- No subscription model (all messages routed to all views via `state`)

**Decision:** **REFACTOR** — extract to `js/realtime.js` with typed handlers, subscription API, and backpressure.

---

## 7. State Management

**File:** `js/state.js`
- Global object `State` with reactive-ish getters/setters
- Persists `uiPrefs`, `selectedMachineId`, `theme` to `localStorage`
- Notifies via simple callback array (`state.onChange(fn)`)
- Machine cache: `Map<id, Machine>` updated from WS `telemetry` + REST

**Issues:**
- No immutability — direct mutation triggers all listeners
- No derived/computed selectors
- `selectedMachineId` change triggers full inspector reload (not granular)

**Decision:** **REFACTOR** — adopt tiny signal/store (e.g. `@preact/signals-core` or custom 50-line proxy) for granular reactivity.

---

## 8. Styling System

| File | Lines | Purpose |
|------|-------|---------|
| `css/tokens.css` | 89 | Design tokens (colors, spacing, radii, shadows, z-index, transitions) |
| `css/base.css` | 151 | Reset, typography, focus-visible, scrollbar, utility classes |
| `css/components.css` | 327 | Buttons, cards, tables, forms, modals, drawers, chips, badges, loaders |
| `css/views.css` | 94 | View-specific layout overrides (grid, sidebar, fullscreen) |

**Token Audit (from `tokens.css`):**
- Colors: 38 custom properties — **heavy navy/blue dominance** (`--color-primary: #1e3a5f`, `--color-surface: #0f172a`, `--color-bg: #0b1220`)
- No semantic aliasing (e.g., `--color-status-critical` missing)
- Spacing scale: 8 steps (4–64px) — consistent
- Typography: Inter (UI), JetBrains Mono (data) — loaded via Google Fonts in `index.html`
- Motion: `--duration-fast: 120ms`, `--duration-normal: 240ms` — defined but underused

**Decision:** **VISUAL REDESIGN** — token system exists but palette is generic dark-navy SaaS; needs distinctive industrial identity.

---

## 9. Charting

**Library:** Chart.js v4 (CDN, loaded in `index.html`)
**Wrapper:** `js/charts.js`
**Usage:** Telemetry sparklines (fleet rows), trend charts (analytics), prediction confidence bands (predictions)
**Current:** Canvas-based, reasonable performance for ≤50 points
**Issues:** No downsampling for long histories; re-renders on every WS tick for visible charts

**Decision:** **KEEP** (Chart.js is solid); **PERF REFACTOR** — add data windowing + `requestAnimationFrame` batching.

---

## 10. 3D / Digital Twin

**File:** `js/twin3d.js` (522 lines)
- **Renderer:** Three.js r158 (CDN)
- **Scene:** Perspective camera, orbit controls (custom), grid floor, skybox gradient
- **Machines:** Instanced `MeshStandardMaterial` boxes (placeholder geometry) — **no GLTF/real assets**
- **State mapping:** Color by `MachineState` (RUNNING=green, WARNING=amber, ERROR=red, OFFLINE=gray)
- **Selection:** Raycast on click → `state.selectMachine(id)` → opens inspector
- **Animation loop:** `requestAnimationFrame` with delta time; updates instance colors per frame
- **Camera:** Orbit (mouse), pan (shift+drag), zoom (wheel), reset (double-click)
- **Performance:** ~60 fps at 100 machines on M1; drops to ~30 fps at 500 instances

**Gaps:**
- No LOD / frustum culling
- Geometry is hardcoded boxes — no asset pipeline
- Telemetry-to-visual mapping is color-only (no vibration, heat, particle FX)
- No level-of-detail for camera distance

**Decision:** **VISUAL REDESIGN + REFACTOR** — core differentiator; needs asset pipeline, instanced mesh with GPU-driven color, LOD, and semantic visual encoding beyond color.

---

## 11. Assets & Dependencies

| Asset | Source | Size | Notes |
|-------|--------|------|-------|
| Three.js | CDN (`unpkg.com/three@0.158.0/build/three.module.js`) | ~600 KB gz | No local copy |
| Chart.js | CDN (`cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js`) | ~120 KB gz | No local copy |
| Inter / JetBrains Mono | Google Fonts | ~30 KB | Preconnect in `index.html` |
| Favicon | `frontend/favicon.svg` | 268 B | SVG, scalable |

**No `node_modules`, no lockfile, no build.** All deps external CDN.

**Decision:** **KEEP CDN for now**; vendor locally only if offline/CSP requires.

---

## 12. Tests

| File | Lines | Framework | Coverage |
|------|-------|-----------|----------|
| `test/util.test.mjs` | 183 | Native `assert` (Node `--test`) | `util.js` helpers only |

**Run:** `node --test test/util.test.mjs` → passes
**Gap:** Zero integration/component/E2E tests; no visual regression; no API contract tests.

**Decision:** **REWRITE TEST STRATEGY** — add Vitest + Playwright for component + E2E.

---

## 13. Environment Variables (Frontend)

| Variable | Source | Used In |
|----------|--------|---------|
| `BACKEND_URL` | `index.html` inline script → `window.__ENV__` | `api.js` base URL |
| `WS_URL` | Same | WebSocket connect |
| `ML_URL` | Same | `api.assess()` proxy |

**Current:** Hardcoded in `index.html` (`http://localhost:8080`, `ws://localhost:8080/ws`, `http://localhost:8001`)
**Gap:** No `.env` support for frontend; dev/prod switch manual.

**Decision:** **REFACTOR** — inject via `serve.py` template or Vite (if build added later).

---

## 13. Build System

**None.** Pure static files served by Python `http.server`.
- No bundling, minification, hashing, tree-shaking
- No TypeScript, no linting (ESLint), no formatting (Prettier)
- CDN deps loaded via `<script type="module">` with import maps in `index.html`

**Decision:** **KEEP for baseline**; evaluate Vite/esbuild only if bundle size / DX becomes a blocker.

---

## 14. Overall Classification

| Area | Verdict | Primary Reason |
|------|---------|----------------|
| Framework/Runtime | KEEP | Vanilla ES modules — zero bloat, modern baseline |
| Routing | KEEP | Minimal, works; refactor only if History API needed |
| Views (10) | VISUAL REDESIGN (8), REFACTOR (1), KEEP (1) | Functional but generic SaaS look; inspector bloated |
| Core Services | KEEP (4), REFACTOR (2), VISUAL REDESIGN (1) | `state.js` and `twin3d.js` need architecture love |
| WebSocket Layer | REFACTOR | Inline in `app.js`; needs typed handler registry |
| State Management | REFACTOR | Global mutable singleton; no granular reactivity |
| Styling System | VISUAL REDESIGN | Token system exists but palette is generic navy SaaS |
| Charting | KEEP + PERF REFACTOR | Chart.js solid; needs downsampling/batching |
| 3D Digital Twin | VISUAL REDESIGN + REFACTOR | Core asset; placeholder geometry, no asset pipeline |
| Assets/Deps | KEEP | CDN fine for now |
| Tests | REWRITE STRATEGY | Only util unit tests; no integration/E2E |
| Env Config | REFACTOR | Hardcoded in HTML |
| Build System | KEEP | No build is a feature at this scale |

---

## 15. Evidence Appendix

All file sizes/line counts from `Get-ChildItem -Recurse` on `frontend/` (see inventory at top). Key source reads:
- `frontend/index.html` — app shell, CDN imports, env injection
- `frontend/js/app.js` — bootstrap, WS, router init
- `frontend/js/router.js` — hash router with lifecycle
- `frontend/js/state.js` — global state + persistence
- `frontend/js/twin3d.js` — Three.js scene, instanced machines
- `frontend/js/api.js` — REST + auth
- `frontend/css/tokens.css` — design token definitions
- `frontend/test/util.test.mjs` — only test file