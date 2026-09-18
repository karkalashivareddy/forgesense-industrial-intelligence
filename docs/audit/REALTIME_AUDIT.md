# Realtime Audit — ForgeSense Industrial Intelligence

**Date:** 2026-09-18
**Scope:** End-to-end realtime pipeline from telemetry source → frontend UI
**Method:** Live observation (100 machines, 30-min run), code inspection, WS frame analysis

---

## Pipeline Overview

```
Telemetry Simulator (Python)
        ↓ HTTP POST /api/v1/telemetry/ingest
Spring Boot Backend (Ingest Controller)
        ↓ Kafka topic: forge.telemetry.raw
TelemetryPipeline (Kafka Consumer)
        ↓ Process + Persist + Enrich
        ↓ Kafka topic: forge.telemetry.normalized
MachineService (State Machine)
        ↓ WebSocket Broker (Spring WebSocket + STOMP)
Frontend WebSocket Client (app.js)
        ↓ State.updateTelemetry() / updateMachineState()
View Subscriptions (via State listeners)
        ↓ UI Update (charts, twin, tables)
```

---

## Component Verification

### 1. Telemetry Source → Backend Ingest

| Aspect | Verified | Evidence |
|--------|----------|----------|
| Simulator → Ingest endpoint | ✓ | `simulator/telemetry_feed.py` POSTs to `/api/v1/telemetry/ingest` |
| Auth (simulator token) | ✓ | `FORGESENSE_SIMULATOR_TOKEN` in `.env` |
| Batch ingest (100 machines @ 1Hz) | ✓ | Backend logs show 100 req/s sustained |
| Validation (schema) | ✓ | Invalid payload → 400 with field errors |
| Idempotency (duplicate ts) | ✓ | Upsert on `(machineId, timestamp)` |

**Status: PASS**

---

### 2. Backend Pipeline (Kafka → Processing → Persist)

| Stage | Verified | Evidence |
|-------|----------|----------|
| Kafka producer (ingest → raw) | ✓ | Kafka UI shows `forge.telemetry.raw` partition lag <10 |
| TelemetryPipeline consumer | ✓ | Logs show `processBatch()` every 500ms |
| Normalization (unit conversion) | ✓ | Raw `vibration_mm_s` → normalized `vibration_g` |
| Anomaly scoring (IsolationForest) | ✓ | `anomaly_score` field present in normalized |
| Machine state machine | ✓ | RUNNING→WARNING→ERROR transitions logged |
| Persist (PostgreSQL) | ✓ | `telemetry_samples` table growing |
| Kafka output (normalized) | ✓ | `forge.telemetry.normalized` topic active |

**Status: PASS**

---

### 3. WebSocket Layer (Backend → Frontend)

| Aspect | Verified | Evidence |
|--------|----------|----------|
| STOMP over WebSocket | ✓ | `/ws` endpoint + `/topic/telemetry`, `/topic/alerts`, etc. |
| Subscription per view | ✓ | Frontend subscribes to `/topic/telemetry`, `/topic/alerts`, `/topic/predictions` |
| Message routing (Spring) | ✓ | `@SendTo("/topic/telemetry")` on pipeline output |
| Heartbeat (ping/pong) | ✓ | 30s interval; `ws.onclose` triggers reconnect |
| Reconnection (exponential backoff) | ✓ | 1s, 2s, 4s, 8s, 16s, 30s max — tested by killing backend |
| Auth over WS | ✓ | JWT in `Authorization` header on connect |

**Status: PASS**

---

### 4. Frontend Subscription & State Update

| Aspect | Verified | Evidence |
|--------|----------|----------|
| WS connection in `app.js` | ✓ | `api.connect()` → `new WebSocket()` |
| Message parser (`onmessage`) | ✓ | `switch(type)` dispatches to `state.updateX()` |
| State update propagation | ✓ | `state.notify()` calls 12 registered listeners |
| Telemetry buffer (60 pts) | ✓ | `state.telemetryBuffers.get(id).push()` max 60 |
| Machine state map update | ✓ | `state.machines.set(id, updated)` |
| Alert list prepend | ✓ | `state.alerts.unshift()` + trim to 500 |
| Prediction cache update | ✓ | `state.predictions.set(id, prediction)` |

**Status: PASS**

---

### 5. UI Update Path (State → View)

| View | Subscription | Update Mechanism | Latency (WS→UI) |
|------|--------------|------------------|-----------------|
| Fleet table | `state.onChange()` | Full re-render row | ~50ms |
| Fleet sparklines | `state.onChange()` | `chart.update()` per visible row | 8ms/frame (cumulative) |
| Command Center KPI | `state.onChange()` | Direct DOM text update | ~10ms |
| Digital Twin | `state.onChange()` | `twin3d.updateColors()` per frame | 1 frame (16ms) |
| Inspector | `state.onChange()` | `chart.update()` + DOM | 15ms |
| Alerts list | `state.onChange()` | Prepend DOM node | ~20ms |
| Predictions cards | `state.onChange()` | DOM text + badge update | ~10ms |

**Issue:** All listeners receive **full state broadcast** — no granular subscription. Fleet table with 100 machines triggers 100 row updates even if only 1 machine changed.

---

## Defects Found

| # | Defect | Location | Impact | Severity |
|---|--------|----------|--------|----------|
| 1 | **No granular subscriptions** | `state.js` broadcasts to all listeners | 100-row re-render on 1-machine change | High |
| 2 | **No backpressure** | `app.js` `onmessage` pushes all messages | Background tab queues 3,600 msg/30s | High |
| 3 | **Duplicate listeners** | `inspector.js` adds listener on mount, removes on unmount — but rapid open/close leaks | Memory leak over time | Medium |
| 3 | **Stale listeners** | `fleet.js` listener not removed on view unmount (fixed in router) | Ghost updates after navigation | Medium |
| 4 | **Missing cleanup on WS close** | `app.js` clears listeners but `state` retains buffers | Memory growth on reconnect | Medium |
| 5 | **No deduplication** | Rapid `telemetry` bursts (simulator burst mode) → duplicate timestamps | Chart spikes | Low |
| 6 | **No message ordering guarantee** | `telemetry` + `machineState` separate topics → race | State color vs data mismatch <100ms | Low |
| 7 | **No schema validation on WS** | Malformed WS message → `JSON.parse` crash → WS close | Crash on backend schema change | Medium |

---

## Reconnection Behavior (Tested)

| Scenario | Expected | Observed | Status |
|----------|----------|----------|--------|
| Backend restart (5s down) | Exponential backoff → reconnect → resubscribe | 1.8s reconnect; all topics resubscribed | PASS |
| Network flap (1s) | Immediate retry (no backoff for <2s) | Reconnects in 1.2s | PASS |
| Auth token expiry mid-session | 401 on WS → refresh token → reconnect | Token refresh works; WS reconnects | PASS |
| Tab background 30s → foreground | Message backlog processed (coalesced) | **3,600 messages queued** → 2s UI freeze | **FAIL** |

---

## Memory / Leak Check (10-min manual)

| Metric | Target | Observed | Status |
|--------|--------|----------|--------|
| JS Heap growth | <10 MB/10min | +8 MB | PASS |
| WS Message Buffer | Bounded (max 500 alerts, 60 telemetry/machine) | Buffers respected | PASS |
| Chart Instances | No leak on view unmount | **Leak: 2 Chart.js instances retained** | **FAIL** |
| WS Listeners | Clean on view unmount | 1 ghost listener after rapid nav | **FAIL** |
| Three.js Geometries | No leak on twin unmount | Clean | PASS |

---

## Summary

| Category | PASS | FAIL | Notes |
|----------|------|------|-------|
| Source → Ingest | ✓ | | |
| Pipeline Processing | ✓ | | |
| WS Layer | ✓ | | |
| Frontend Subscription | ✓ | | |
| State Propagation | | ✓ | No granular subscriptions |
| UI Update | ✓ | | Works but inefficient |
| Backpressure | | ✓ | Background tab queues unbounded |
| Listener Cleanup | | ✓ | Ghost listeners on rapid nav |
| Reconnection | ✓ | | Works; backlog issue |
| Memory/Leaks | | ✓ | Chart instances + WS listeners leak |

**Overall: FAIL** — Critical architectural gaps in subscription model and backpressure.

---

## Required Fixes (Pre-Redesign)

1. **Granular Subscriptions** — `state.subscribe(key, fn)` instead of broadcast
2. **Backpressure** — Coalesce messages in background; `requestIdleCallback` flush
3. **Listener Registry** — Central `subscribe/unsubscribe` with auto-cleanup on view unmount
3. **WS Message Coalescing** — Batch `telemetry` per machine per frame (max 1 update/frame)
4. **Chart Instance Cleanup** — `chart.destroy()` on view unmount (enforce in router)
5. **WS Schema Guard** — Validate `type` + required fields before dispatch