# Frontend Baseline — ForgeSense Industrial Intelligence

**Date:** 2026-09-18
**Baseline Commit:** Post-merge `release/reconcile-forgesense` (all tests green)
**Purpose:** Establish immutable PASS/FAIL/BLOCKED truth before any redesign

---

## Baseline Matrix

| Area | Test | Status | Evidence | Severity |
|------|------|--------|----------|----------|
| **Build** | Static files serve | PASS | `python serve.py` → 200 OK on `/` | Critical |
| **Build** | No syntax errors | PASS | `node --check` on all 19 `.js` files → rc=0 | Critical |
| **Build** | CSS valid | PASS | No parse errors in 4 CSS files | Critical |
| **Runtime** | Application loads | PASS | `index.html` loads in Chrome/Firefox, no console errors | Critical |
| **Runtime** | Router boots | PASS | `router.boot('factory')` activates factory view | Critical |
| **Runtime** | All 10 routes resolve | PASS | Hash navigation `#/factory`..`#/system` all mount | High |
| **API** | REST client init | PASS | `api.connect()` returns token on valid creds | Critical |
| **API** | Core contracts (8) | PASS | `/machines`, `/telemetry`, `/predictions`, `/alerts`, `/maintenance`, `/system`, `/auth/login`, `/auth/refresh` all return 200 + expected shape | Critical |
| **API** | Auth flow | PASS | Login → token stored → reused → refresh on 401 | High |
| **Realtime** | WebSocket connects | PASS | `ws://localhost:8080/ws` opens, `onopen` fires | Critical |
| **Realtime** | Telemetry events received | PASS | `telemetry` messages arrive ~1Hz per machine | Critical |
| **Realtime** | Alert events received | PASS | `alert` messages create toast + list entry | High |
| **Realtime** | Machine state events | PASS | `machineState` updates fleet row colors | High |
| **Realtime** | Prediction events | PASS | `prediction` updates risk badges | High |
| **Realtime** | Reconnection works | PASS | Kill backend → WS closes → exponential backoff reconnects | High |
| **Realtime** | Heartbeat/pong | PASS | 30s ping/pong logged in console | Medium |
| **Digital Twin** | Scene renders | PASS | Three.js canvas appears, 100 boxes visible | Critical |
| **Digital Twin** | Machine selection | PASS | Click box → inspector opens with correct machine | High |
| **Digital Twin** | State color mapping | PASS | RUNNING=green, WARNING=amber, ERROR=red, OFFLINE=gray | High |
| **Digital Twin** | Camera controls | PASS | Orbit/pan/zoom/reset all functional | Medium |
| **Digital Twin** | Telemetry sync | FAIL | Color updates lag WS by 200–500ms (single-frame per tick) | High |
| **Charts** | Sparkline renders | PASS | Fleet rows show 60-point sparklines | High |
| **Charts** | Trend chart renders | PASS | Analytics view shows 24h trend | High |
| **Charts** | Prediction bands render | PASS | Predictions view shows confidence interval | Medium |
| **Charts** | Downsampling | FAIL | 1000+ point histories render all points (no decimation) | Medium |
| **Alerts** | Feed updates real-time | PASS | New alert appears <500ms after WS event | High |
| **Alerts** | Acknowledge action | PASS | Click ack → PATCH `/alerts/{id}/ack` → UI updates | High |
| **Alerts** | Severity filtering | PASS | Filter chips filter list correctly | Medium |
| **Maintenance** | Work order list | PASS | Loads `/maintenance` → table renders | Medium |
| **Maintenance** | Create work order | PASS | Modal submits POST → 201 → list refreshes | Medium |
| **Simulation** | Scenario select | PASS | Dropdown loads scenarios from `/simulation/scenarios` | Medium |
| **Simulation** | Run scenario | PASS | Start → WS `simulation:start` → speed slider works | Medium |
| **Simulation** | Fault injection | PASS | Inject fault → machine goes ERROR → alert fires | High |
| **System** | Health endpoint | PASS | `/system/health` shows DB, Kafka, ML status | Medium |
| **System** | Feature flags | PASS | Toggle flags → UI respects immediately | Medium |
| **Responsive** | Desktop (≥1200px) | PASS | All views usable, rail visible | Medium |
| **Responsive** | Tablet (768–1199px) | FAIL | Rail collapses but inspector drawer overlaps twin | Medium |
| **Responsive** | Mobile (<768px) | FAIL | Rail hidden, no hamburger; twin canvas overflows | High |
| **Accessibility** | Keyboard nav (rail) | PASS | Tab/Enter/Space navigates rail buttons | High |
| **Accessibility** | Keyboard nav (inspector) | FAIL | Inspector drawer not focus-trapped; Escape doesn't close | High |
| **Accessibility** | Focus visible | PASS | `--focus-ring` token used on all interactive | Medium |
| **Accessibility** | Color contrast (text) | PASS | All body text ≥4.5:1 (WCAG AA) | High |
| **Accessibility** | Color contrast (status) | FAIL | Status chips (green/amber/red) rely on color only — no icon/text | High |
| **Accessibility** | ARIA labels | FAIL | Icon-only buttons lack `aria-label` (command palette, rail) | High |
| **Accessibility** | Screen reader | BLOCKED | Not tested with NVDA/VoiceOver | High |
| **Performance** | Initial paint | BLOCKED | No Lighthouse/CI measurement in baseline | High |
| **Performance** | JS parse/eval | BLOCKED | No `performance.measure` instrumentation | High |
| **Performance** | Twin 60fps @ 100 machines | PASS | Manual devtools: ~58fps average | High |
| **Performance** | Twin 30fps @ 500 machines | FAIL | ~28fps; instanced mesh but no frustum culling | High |
| **Performance** | Chart update cost | FAIL | Full re-render on every WS tick (visible charts) | Medium |
| **Performance** | Memory leak (WS) | BLOCKED | No 30-min soak test run | Medium |
| **Console** | Zero errors at load | PASS | Clean console on fresh load | Critical |
| **Console** | Zero errors during use | FAIL | `WebSocket is already in CLOSING state` on fast nav | High |
| **Console** | Zero warnings | FAIL | Three.js deprecation warnings (legacy `MeshStandardMaterial` params) | Medium |

---

## Baseline Status Summary

| Category | PASS | FAIL | BLOCKED | N/A |
|----------|------|------|---------|-----|
| Build | 3 | 0 | 0 | 0 |
| Runtime | 2 | 0 | 0 | 0 |
| API | 3 | 0 | 0 | 0 |
| Realtime | 6 | 0 | 0 | 0 |
| Digital Twin | 4 | 1 | 0 | 0 |
| Charts | 3 | 1 | 0 | 0 |
| Alerts | 3 | 0 | 0 | 0 |
| Maintenance | 2 | 0 | 0 | 0 |
| Simulation | 3 | 0 | 0 | 0 |
| System | 2 | 0 | 0 | 0 |
| Responsive | 1 | 2 | 0 | 0 |
| Accessibility | 2 | 4 | 1 | 0 |
| Performance | 1 | 2 | 3 | 0 |
| Console | 1 | 2 | 0 | 0 |
| **TOTAL** | **35** | **12** | **4** | **0** |

---

## Critical Failures (must fix before redesign)

1. **Digital Twin telemetry sync lag** — color updates lag WS by 200–500ms; need frame-aligned state application
2. **Responsive mobile/tablet broken** — no hamburger, canvas overflow, inspector overlaps
3. **Accessibility: status chips color-only** — WCAG 1.4.1 violation; add icons/text
4. **Accessibility: missing ARIA labels** — icon-only buttons unlabelled
5. **Console: WebSocket closing state errors** — race on route change before WS cleanup

---

## High-Priority Failures

1. **Chart downsampling missing** — 1000+ points kill performance
2. **Chart full re-render on tick** — batch with rAF
3. **Twin 500 machines <30fps** — needs frustum culling / LOD
5. **Inspector not focus-trapped** — keyboard trap on open
6. **WS closing-state race** — guard `ws.readyState === OPEN` before send

---

## Known Limitations (BLOCKED items)

- No automated performance budgets (Lighthouse CI not configured)
- No memory leak soak test (30-min WS)
- No screen-reader verification
- No bundle size tracking (no build)

---

## Preserved Functionality (PASS — do not regress)

- All 10 routes + bootstrap
- Full REST + WS contract compliance
- Real-time telemetry/alert/prediction flow
- Three.js scene with 100 machines @ 60fps
- Command palette (Cmd+K) — discoverable shortcuts
- Simulation scenario runner + fault injection
- Theme tokens + dark-mode baseline

---

## Redesign Targets (from FAIL/BLOCKED)

1. **Visual identity overhaul** — replace navy SaaS palette with distinctive industrial system
2. **Responsive shell** — mobile-first rail, adaptive twin canvas, drawer stack
3. **Accessibility remediation** — ARIA, focus trap, color-independent status
3. **Twin performance** — instanced GPU color, frustum culling, asset pipeline
4. **Realtime architecture** — typed handler registry, backpressure, subscription model
5. **State reactivity** — granular signals to replace global mutation broadcast
6. **Test infrastructure** — Vitest + Playwright + visual regression

---

## New Features Required (not in current baseline)

- Offline-first / PWA (service worker)
- Multi-language (i18n) — at least EN/DE
- Deep-linking / shareable view state (URL sync)
- Export / PDF reports (analytics, maintenance)
- Notification center (toast history)
- User preferences panel (theme, density, units)