# Performance Baseline — ForgeSense Industrial Intelligence

**Date:** 2026-09-18
**Environment:** Chrome 128 / Firefox 129, macOS M1 (baseline), 100 simulated machines
**Scope:** Measured or observable frontend performance characteristics at merge baseline

---

## 1. Build / Bundle (Static Files)

| Metric | Value | Method | Status |
|--------|-------|--------|--------|
| Total JS (19 files) | 132 KB | `du -sh frontend/js` | **BLOCKED** — no build, no minification measured |
| Total CSS (4 files) | 29 KB | `du -sh frontend/css` | **BLOCKED** — no minification |
| HTML | 7.5 KB | `wc -c index.html` | PASS |
| CDN Dependencies | Three.js ~600 KB gz, Chart.js ~120 KB gz | Network tab | **BLOCKED** — no local vendor, no SRI |
| Fonts | Inter + JetBrains Mono ~30 KB | Network tab | PASS (preconnect) |

**Note:** No bundler → no tree-shaking, no code-splitting, no hashing. All modules loaded via `<script type="module">` with import map in `index.html`.

---

## 2. Startup Performance (Cold Load)

| Metric | Target | Measured | Method | Status |
|--------|--------|----------|--------|--------|
| Time to First Paint | <1.5s | **BLOCKED** | No Lighthouse CI | BLOCKED |
| Time to Interactive | <3s | **BLOCKED** | No measurement harness | BLOCKED |
| DOMContentLoaded | — | ~320ms | DevTools Network | PASS |
| JS Parse/Eval (main thread) | <100ms | **BLOCKED** | No `performance.measure` | BLOCKED |
| WebSocket Connect | <500ms | ~180ms | `ws.onopen` timestamp | PASS |
| First Telemetry Frame | <2s | ~1.1s | WS `telemetry` timestamp | PASS |

**Gap:** No automated performance budgets; all numbers from manual devtools spot-checks.

---

## 3. Runtime Rendering (Digital Twin)

| Scenario | Machine Count | Avg FPS | Min FPS | Frame Time (ms) | GPU Mem | Status |
|----------|---------------|---------|---------|-----------------|---------|--------|
| Idle (no telemetry) | 100 | 60 | 58 | 16.7 | ~45 MB | PASS |
| Live telemetry (1Hz) | 100 | 58 | 52 | 17.2 | ~48 MB | PASS |
| Live telemetry (1Hz) | 500 | 28 | 22 | 35.7 | ~180 MB | **FAIL** |
| Camera orbit (drag) | 100 | 55 | 48 | 18.2 | — | PASS |
| Camera orbit (drag) | 500 | 22 | 15 | 45.5 | — | **FAIL** |
| Machine selection (raycast) | 100 | — | — | 2.1ms | — | PASS |
| Machine selection (raycast) | 500 | — | — | 8.4ms | — | **FAIL** |

**Root Causes (500 machines):**
- No frustum culling — all 500 instances submitted every frame
- CPU-side instance color update per frame (JS loop over 500)
- Single `InstancedMesh` with `MeshStandardMaterial` — no GPU-driven color
- No LOD / impostors for distant machines

---

## 4. Chart Performance

| Chart Type | Data Points | Update Freq | Re-render Cost | Frame Impact | Status |
|------------|-------------|-------------|----------------|--------------|--------|
| Sparkline (fleet row) | 60 | 1Hz | `chart.update()` | 0.8ms per chart | **FAIL** (cumulative) |
| Trend (analytics) | 1,440 (24h @ 1min) | On range change | Full re-render | 45ms | **FAIL** (>16ms budget) |
| Confidence Band | 200 | On select | Full re-render | 12ms | PASS |
| 10 visible sparklines | 600 total | 1Hz | 10 × `update()` | 8ms/frame | **FAIL** (exceeds budget) |

**Optimization Opportunities:**
- Sparkline: batch 10 updates in single rAF → ~1ms
- Trend: LTTB decimation to 400 points → ~8ms
- Confidence: already acceptable

---

## 5. WebSocket / Real-time Pipeline

| Metric | Value | Method | Status |
|--------|-------|--------|--------|
| WS Message Rate (100 machines) | ~120 msg/s (telemetry + state) | DevTools WS frame count | PASS |
| Message Parse (JS) | 0.04ms/msg | `performance.now()` in `onmessage` | PASS |
| State Update Propagation | 1.2ms (broadcast to 12 listeners) | `performance.now()` | PASS |
| Backlog on Tab Background (30s) | ~3,600 messages queued | Manual test | **FAIL** (no backpressure) |
| Reconnect Time (after 5s down) | 1.8s (exponential backoff) | Manual kill/restart | PASS |

**Critical Gap:** No backpressure — background tab accumulates messages, causes jank on restore.

---

## 6. Memory Profile (30-min Soak — NOT RUN)

| Metric | Target | Measured | Status |
|--------|--------|----------|--------|
| JS Heap (idle 30min) | <50 MB growth | **BLOCKED** | BLOCKED |
| WS Message Buffer Leak | 0 bytes/min | **BLOCKED** | BLOCKED |
| Chart Instance Leak | 0 instances leaked | **BLOCKED** | BLOCKED |
| Three.js Geometry/Texture Leak | 0 | **BLOCKED** | BLOCKED |

**Status:** No automated soak test; manual 10-min showed stable heap (~42 MB).

---

## 7. Animation / Motion Cost

| Animation | Duration | Main Thread Cost | GPU | Status |
|-----------|----------|------------------|-----|--------|
| Rail hover | 120ms | 0.1ms | Transform only | PASS |
| Modal open | 240ms | 0.3ms | Transform + opacity | PASS |
| Inspector drawer | 240ms | 0.5ms | Transform | PASS |
| Twin camera orbit | Continuous | 0.8ms/frame | Vertex shader | PASS |
| Machine color transition | 300ms (CSS) | 0ms (GPU) | — | PASS |
| Toast slide | 200ms | 0.1ms | Transform | PASS |

**Note:** All animations use CSS `transition` on `transform`/`opacity` — compositor-friendly. No JS-driven animation loops except Three.js render loop.

---

## 8. Network / Caching

| Resource | Cache-Control | Size (gz) | Status |
|----------|---------------|-----------|--------|
| `index.html` | `no-cache` | 2.1 KB | PASS |
| JS modules | `no-cache` (dev) | 132 KB total | **BLOCKED** — no hashing/immutable caching |
| CSS | `no-cache` | 29 KB | **BLOCKED** |
| Three.js (CDN) | 1 year (CDN) | 600 KB | PASS (but no SRI) |
| Chart.js (CDN) | 1 year (CDN) | 120 KB | PASS (but no SRI) |
| Fonts (Google) | 1 year | 30 KB | PASS (preconnect) |

**Gap:** No `Cache-Control: immutable` for versioned assets (no versioning exists).

---

## 9. Baseline Summary

| Category | PASS | FAIL | BLOCKED | Notes |
|----------|------|------|---------|-------|
| Build/Bundle | 1 | 0 | 3 | No build = no metrics |
| Startup | 2 | 0 | 3 | Manual spot-checks only |
| Twin Rendering | 2 | 2 | 0 | 500 machines fails |
| Charts | 1 | 3 | 0 | Downsampling + batching needed |
| WebSocket | 3 | 1 | 0 | Backpressure missing |
| Memory | 0 | 0 | 4 | No soak test |
| Animation | 6 | 0 | 0 | All CSS-compositor |
| Network | 2 | 0 | 2 | No versioning/hashing |

**Overall:** **12 PASS / 7 FAIL / 12 BLOCKED**

---

## Critical Performance Failures

1. **500 machines <30fps** — no frustum culling, CPU color update, no LOD
2. **Chart updates exceed frame budget** — sparklines cumulative 8ms/frame; trend 45ms
3. **WS backpressure missing** — background tab queues thousands of messages
4. **No performance budgets / CI** — regressions undetectable

---

## Recommended Performance Targets (Post-Redesign)

| Metric | Target |
|--------|--------|
| TTI (cold) | <2.5s (Lighthouse CI) |
| Twin 100 machines | 60fps sustained |
| Twin 500 machines | 45fps sustained |
| Sparkline batch update | <1ms/frame (10 charts) |
| Trend chart render | <16ms (decimated) |
| WS backlog (30s background) | <100 messages (drop/coalesce) |
| JS Heap (30min) | <20 MB growth |
| Lighthouse Performance | ≥90 |