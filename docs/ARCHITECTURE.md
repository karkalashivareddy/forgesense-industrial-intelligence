# ForgeSense — Architecture

> **Scope note.** This document was rewritten during release packaging because
> it still described the pre-React console (vanilla ES modules, Three.js from a
> CDN, REST polling as the browser transport) after that code was replaced. The
> claims below are verified against the running system — the frontend source,
> the live API, and the OpenAPI document at `/v3/api-docs`.

---

## 1. System overview

```text
                        ┌─────────────────────────────────────────┐
                        │  Operations Console (browser)           │
                        │  React 18 · TypeScript · Vite           │
                        │  Zustand · TanStack Query · Three.js    │
                        │  ECharts · nginx static host  :5173     │
                        └──────┬──────────────────────┬───────────┘
                               │                      │
                    REST /api/v1/**            STOMP over WebSocket
                    (authority, 3s poll)       (low-latency deltas)
                               │                      │
        ┌──────────────────────┴──────────────────────┴────────────┐
        │            Spring Boot Backend  :8080                     │
        │  REST API · WebSocket hub /ws · state machine ·           │
        │  decision engine · impact engine · alert & maintenance    │
        └───┬──────────────┬──────────────┬──────────────┬──────────┘
            │              │              │              │
      ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼──────┐  ┌────▼─────┐
      │ Simulator │  │  ML svc   │  │ PostgreSQL │  │  Redis   │
      │ (synthetic│  │  :8001    │  │  :5432     │  │  :6379   │
      │ telemetry)│  │ anomaly + │  │ domain +   │  │ latest   │
      └─────┬─────┘  │ risk + RUL│  │ history    │  │ state    │
            │        └───────────┘  └────────────┘  └──────────┘
            │ POST /api/v1/telemetry/ingest
            └──────────────► backend event bus / Kafka
```

### Ingest path (the only way data enters)

```text
Simulator (Python)
   └─ POST /api/v1/telemetry/ingest        (bearer token)
        └─ event bus  ──or──  Kafka  forge.telemetry.raw
             └─ forge.telemetry.normalized
                  └─ validate + normalize  (staleness & range rules)
                       └─ digital twin state (authoritative)
                            ├─ feature vector ──► ML :8001 /assess
                            │                     └─ anomaly, failureRisk, RUL, factors
                            └─ decision engine (rules in application.yml)
                                 ├─ state machine  NORMAL→DEGRADED→WARNING→CRITICAL
                                 ├─ impact engine  (line + dependency propagation)
                                 ├─ alert lifecycle
                                 └─ maintenance recommendation
                                      └─ broadcast /topic/** over WebSocket
```

Kafka topics actually used: `forge.telemetry.raw`,
`forge.telemetry.normalized`, `forge.machine.state`, `forge.ml.predictions`,
`forge.simulation.commands`. In the dev profile an in-process bus replaces
Kafka with identical behaviour.

---

## 2. Frontend architecture

```
src/
  api/         client.ts (fetch + auth + 401 handling), queries.ts (TanStack
               Query hooks), adapters.ts (all normalisation), types.ts
  app/         App.tsx (router + session), AppShell.tsx (chrome, nav, status)
  auth/        AuthProvider, SignInGate
  components/  shared UI + inspector/ (machine drawer, 5 tabs)
  design-system/  Button, Metric, StatusBadge, Panel, DataTable, Tabs, …
  domain/      format.ts, basis.ts, machineState.ts  (pure, unit-tested)
  hooks/       useNow, useFocusTrap, usePrefersReducedMotion
  realtime/    stomp.ts (transport), store.ts (state), useRealtimeSession.ts
  routes/      one module per workspace
  store/       ui.ts (selection, inspector, twin mode) — UI-only
  styles/      tokens.css (single colour source), color.ts, global/components/
  three/       TwinScene.ts, useTwinCanvas.tsx
```

### State management: four stores, split by update frequency

This split is the core performance decision, not a stylistic one.

| Store | Holds | Update rate | Subscribers |
|---|---|---|---|
| `store/ui.ts` (Zustand) | selection, open inspector, twin mode, toasts | on user action | workspace components |
| TanStack Query | every REST resource, keyed per resource | 3 s / 15 s / 2 min | per-panel |
| `realtime/store.ts` | transport status, event log (capped), reconcile flag | per flushed frame | header, System page |
| `realtime/store.ts` → `useTelemetryStore` | **live sensor values + bounded ring** | per flushed frame | **3 components only** |

### Why high-frequency telemetry is isolated

An 18-machine feed emitting every 5 s is ~3.6 events/second. Routing that
through the same state as everything else would re-render the console
continuously. Instead:

1. **The transport coalesces.** `stomp.ts` keeps one pending delta **per
   entity** in a `Map`, capped at 240, and dispatches **at most once per
   animation frame**. An 18-machine storm becomes a handful of store writes per
   frame, not 18.
2. **Batched events are sorted by envelope `sequence`** before dispatch, so
   ordering is preserved despite coalescing.
3. **History is bounded and opt-in.** `useTelemetryStore` keeps a 120-point
   ring **only for assets someone is watching** (`watch`/`unwatch`). An idle
   console accumulates no series at all.
4. **Subscriptions are narrow.** `useLiveReading(machineId)` selects
   `state.live[machineId]` through `useShallow`, returning a stable reference
   for every *other* asset. No component subscribes to the whole `live` or
   `history` map.
5. **Only three components read live values** — the Telemetry workspace and two
   inspector tabs. Everything else renders from the 3 s REST snapshot.

Measured: Command Center under live telemetry uses 0.16 s of script time per
8 s wall (~2.7 % of one core), **zero** long tasks, 60 fps.

---

## 3. Realtime flow

```text
App.tsx  ──once per authenticated session──►  useRealtimeSession(true)
                                                      │
                                    module-level singleton StompRealtimeClient
                                    (keyed by access token)
                                                      │
   WebSocket /ws  ──►  CONNECT (STOMP 1.2, heart-beat 10s, Authorization)
                   ──►  CONNECTED
                   ──►  SUBSCRIBE × 13   destination: /topic/<topic>
                   ──►  MESSAGE …        validate → dedupe → order → coalesce
                   ──►  rAF flush        onEvents(batch) → stores
```

Topics subscribed (`LIVE_TOPICS`): `telemetry.updated`, `machine.updated`,
`machine.state.changed`, `prediction.updated`, `alert.created`,
`alert.updated`, `maintenance.created`, `maintenance.updated`,
`simulation.updated`, `simulation.control.updated`, `simulation.global.updated`,
`events.updated`, `impact.updated`.

**One socket, guaranteed.** The client is a module-level singleton keyed by
token, and the session hook is mounted once in `App.tsx` *above* the router, so
route changes cannot create a second connection. Verified by instrumenting the
`WebSocket` constructor: **exactly 1** created across 14 route changes, closed
on sign-out.

**Defence in depth** before any event reaches application state:

- Envelope validation — topic must be known, `event` must match the topic,
  `eventId` 8–128 chars, valid ISO `timestamp`, safe-integer `sequence ≥ 0`,
  payload must be an object, machine-scoped topics must resolve a `machineId`,
  and every numeric telemetry field must be finite.
- Dedupe by `eventId` in a bounded FIFO set (2048).
- Sequence regression → `onDiagnostic('sequence-regression')` → the store
  requests a **REST reconcile** rather than letting client state drift.
- Reconnect with exponential backoff **and jitter** (1 s → 30 s) so a backend
  restart does not produce a synchronised reconnect stampede.
- `document.hidden` → the socket is disconnected entirely and reconnected on
  return, so a backgrounded tab does no socket work.

**REST stays authoritative.** TanStack Query polls on a 3 s
(`snapshotRefetchMs`) / 15 s (`analyticsRefetchMs`) cadence and is the
reconciliation target. Realtime is the low-latency path, not the source of
truth — which is why a dropped socket degrades to "slightly staler", never to
"wrong".

---

## 4. Data flow by concern

| Flow | Path |
|---|---|
| **Telemetry** | simulator → ingest → normalize → twin → ML → REST `/machines/{id}/telemetry?limit=` + `telemetry.updated` |
| **Prediction** | twin → ML `/assess` → `POST /machines/{id}/predictions`, `/explanation` + `prediction.updated` |
| **Alert** | decision engine → alert lifecycle → `/alerts`, `/analytics/alerts` + `alert.created/updated` |
| **Maintenance** | decision engine → 5-state workflow → `/maintenance` + `maintenance.created/updated` |
| **Simulation** | Scenario Lab → `POST /simulation/control` (inject) or `/simulation/run` (what-if) → simulator → feeds back into telemetry |
| **Impact** | decision engine → `/impact/{machineId}` + `impact.updated` |

Full narrative, with the honest provenance distinction, in
[`DATA_FLOW.md`](DATA_FLOW.md).

---

## 5. Error isolation

Resource isolation is structural: every TanStack Query has its own query key,
and every panel renders its own `LoadingState` / `ErrorState` / `EmptyState`.
There is no top-level `Promise.all`, so one failure cannot blank the console.

Verified by aborting one endpoint at a time:

| Failure | Shell | `h1` | Other resources | Failed resource shows |
|---|---|---|---|---|
| `/maintenance` | up | yes | **18 assets** | `ErrorState` "Maintenance unavailable" |
| `/analytics/*` | up | yes | **18 assets** | 2 `ErrorState`s |
| `/machines` | up | yes | panel hidden | `ErrorState` |

A failure renders as an **error**, never as an empty success. "The server said
there is nothing" and "the server did not answer" stay distinguishable.

Auth: a `401` on any authenticated request clears the token, raises
`SessionExpiredError`, and reopens the sign-in gate. It is not retried. An
`AbortError` (caller unmounting) propagates unchanged — that is a decision, not
a failure.

---

## 6. 3D Factory Twin

`three/TwinScene.ts` owns the renderer; `useTwinCanvas.tsx` owns the lifecycle
and creates the scene **once** (empty dependency array), disposing on unmount.

- **On-demand rendering.** The loop stops scheduling frames when nothing
  changed (`needsRender` gate). Verified: **0 WebGL draw calls** in an 8 s idle
  window, including on a second visit.
- **Idempotent invalidation.** Render requests are gated on a comparable key
  stored per node, not on reading back material values — Three.js colour-manages
  on `set`, so `getHex()` comparisons report false change.
- **Full disposal.** ResizeObserver, all DOM listeners, orbit controls, every
  geometry / material / texture, the renderer, and the scene graph.
  `dispose()` is idempotent and the loop checks `disposed` each frame.
- No leaks across repeated navigation: heap and DOM nodes fall to a floor
  (3056 → 470 nodes, 619 → 200 listeners) rather than growing.
- `prefers-reduced-motion` skips camera tweens.

---

## 7. Performance strategy

| Concern | Strategy |
|---|---|
| Telemetry storm | per-entity coalescing + one dispatch per animation frame |
| Memory | bounded ring (120/asset, watched only), capped dedupe (2048), capped event log (100) |
| Re-render scope | narrow selectors; live values read by 3 components |
| Polling | 3 s snapshots, 15 s analytics, 2–5 min topology; `refetchIntervalInBackground: false` |
| Chart updates | ECharts `setOption` on data change, not re-instantiation; see `routes/Analytics.tsx` |
| 3D | on-demand render loop, 0 idle draw calls |
| Background tab | socket disconnected, `useNow` timers stopped, twin loop skips work |
| Bundle | `three` and `echarts` code-split; fonts bundled locally; no CDN |

---

## 8. Component responsibilities

| Component | Owns | Must not |
|---|---|---|
| Simulator | generate synthetic telemetry, inject degradations | decide health or risk — that is upstream |
| Backend | domain truth: twin, state machine, alerts, maintenance, impact, simulation, API, WebSocket | train models |
| ML service | anomaly score, failure risk, RUL estimate, attribution factors | own alert policy |
| Frontend | render synchronised state, collect operator intent | compute business state or invent values |
| Redis | latest-state cache | be the source of truth |
| PostgreSQL | persisted domain + history | hold raw telemetry indefinitely |

---

## 9. Scaling notes (future work, not implemented)

- Kafka partitions by `machineId` → ordered per machine, parallel across
  machines; consumer groups scale pipeline stages.
- Telemetry history could move to a time-series store as it grows.
- WebSocket scale-out: topic prefix per node or broker, with sticky sessions.
- ML inference is stateless and horizontally scalable behind a load balancer.

Only the single-node Compose topology is implemented today.

---

## 10. Corrections to the previous version of this document

Recorded deliberately, because the old text was confidently wrong:

| Previous claim | Reality |
|---|---|
| "Vanilla ES-module JS + Three.js via CDN" | React 18 + TypeScript + Vite; `three@0.169.0` bundled via npm, no CDN |
| "the dashboard does not subscribe to [WebSocket]; the browser's verified transport is REST polling" | STOMP-over-WebSocket is the primary transport; the client `SUBSCRIBE`s to 13 `/topic/**` destinations |
| "Canvas chart helpers" | ECharts 5.5.1 |
| "Static dashboard - nginx" | still true, and now also the thing that serves the built React bundle |
