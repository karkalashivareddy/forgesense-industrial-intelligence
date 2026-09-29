# Realtime Contract

Backend → WebSocket/STOMP → realtime adapter → normalised events → Zustand
stores → selectors → components.

REST remains the **reconciliation authority**. Realtime is a latency
optimisation, never the source of truth.

---

## 1. Transport

| Property | Value |
| --- | --- |
| Protocol | STOMP 1.2 over raw WebSocket |
| Endpoint | `{VITE_WS_URL}`, defaulting to the API origin with `http` → `ws`, path `/ws` |
| Authentication | `Authorization: Bearer <jwt>` in the STOMP `CONNECT` frame header |
| Heartbeat | `heart-beat: 10000,10000`; the client also emits `\n` every 10 s |
| Reconnect | Exponential backoff, 1 s base → 30 s cap, ±25% jitter |
| Connection ownership | Exactly one socket per authenticated session |

### Reconnection and reconciliation

On every reconnect the console **invalidates** the `machines`, `alerts` and
`maintenance` query keys. REST snapshots then re-seat the client state, so a
missed delta during a disconnect cannot cause drift. The realtime path never
becomes the only path.

### Sequence-gap handling

The backend publishes one canonical envelope per event with a monotonic
per-process `sequence`. If a delivered sequence **regresses**, a frame was
dropped or replayed while the socket stayed up. The client raises a
reconciliation request rather than letting client state drift, and the shell
re-seats from REST.

---

## 2. Envelope

Produced by `common/domain/EventEnvelope.java`:

```ts
interface RealtimeEnvelope {
  event: LiveTopic;      // must equal the STOMP destination
  eventId: string;       // 8–128 chars, unique per event
  sequence: number;      // safe integer ≥ 0, monotonic per process
  timestamp: string;     // ISO-8601, parseable
  assetId?: string;      // ≤ 128 chars
  payload: Record<string, unknown>; // always an object
}
```

### Topics

| Topic | Payload | Coalesced |
| --- | --- | --- |
| `telemetry.updated` | `{ machineId, timestamp, sequence, temperature?, vibration?, pressure?, rpm?, torque?, current?, voltage?, power?, flow?, frequency? }` | yes |
| `machine.updated` | machine fields | yes |
| `machine.state.changed` | `{ machineId, from, to }` | yes |
| `prediction.updated` | prediction fields | yes |
| `alert.created` | alert fields | no |
| `alert.updated` | alert fields | no |
| `maintenance.created` / `maintenance.updated` | work-order fields | no |
| `simulation.updated` | run summary | no |
| `simulation.control.updated` / `simulation.global.updated` | control state | no |
| `events.updated` | event log entry | no |
| `impact.updated` | `{ machineId, downtimeMinutes, affectedMachines, lossUnits }` | no |

---

## 3. Validation

`validateEnvelope()` in `frontend/src/realtime/stomp.ts` is the security
boundary between the network and application state. An envelope is rejected —
and counted in `invalidDropped` on the System page — if any of these fail:

- topic is not in the known set
- `event` ≠ the STOMP destination (topic spoofing)
- `eventId` is not a string of 8–128 characters
- `timestamp` is not a parseable ISO-8601 value
- `sequence` is not a safe integer ≥ 0
- `assetId` is present but not a ≤ 128-character string
- `payload` is not a plain object
- a machine-scoped topic has no resolvable `machineId`
- `telemetry.updated` carries a non-finite value in any known sensor key
- `telemetry.updated.payload.timestamp` is present but unparseable

---

## 4. Deduplication, ordering, coalescing

1. **Deduplicate** by `eventId` against a bounded `Set` (2048 entries, FIFO
   eviction). A replayed or re-delivered envelope is dropped and counted in
   `duplicatesDropped`.
2. **Order** by `sequence`. A regression is reported as a diagnostic and
   triggers reconciliation.
3. **Coalesce** per-entity on the four high-frequency topics. A key is
   `topic:assetId` (falling back to `payload.machineId`, `payload.id`, then
   `global`). Only the newest delta per entity survives to the next flush.
4. **Batch** discrete events in a queue capped at 256 per flush.

### Memory bounds

| Buffer | Bound |
| --- | --- |
| Coalesced pending map | 240 entities, oldest evicted |
| Discrete queue | 256 per flush |
| Dedupe set | 2048 event ids, FIFO |
| Per-machine telemetry ring | 120 points |
| Live event stream | 100 rows |
| Client-side alerts | 100 rows |

Nothing in the UI grows without a cap.

---

## 5. Frame batching

A flush is scheduled with `requestAnimationFrame` (falling back to a 16 ms
timer when rAF is unavailable) and is **idempotent while already scheduled** —
many frames arriving between animation frames cost exactly one flush.

At 18 machines on a 5 s simulator interval this turns a storm of individual
store writes into **one batched commit per animation frame**. That is the
single most important performance guarantee in the realtime path.

---

## 6. Truthful connection state

`deriveConnectionQuality()` is the only place the word `LIVE` is produced.

| Label | Condition |
| --- | --- |
| `SYNTHETIC` | socket open, data basis is `SYNTHETIC` |
| `SIMULATED` | socket open, data basis is `SIMULATED` |
| `LIVE` | socket open, feed is genuinely observed, and a delta arrived recently |
| `STALE` | socket open but no delta for > 30 s, **or** the oldest asset reading is > 60 s old |
| `SYNCING` | connecting or reconnecting |
| `DEGRADED` | socket closed; REST polling active |
| `OFFLINE` | REST snapshots are failing too |

Two rules are load-bearing:

- **A configured transport is not a healthy transport.** State comes from what
  this browser session has *observed*, never from configuration.
- **A synthetic feed is never `LIVE`.** In this deployment the simulator drives
  the pipeline, so the console says `SYNTHETIC` and the status strip repeats
  that the data describes no real machine.

---

## 7. Render-isolation contract

High-frequency telemetry is deliberately kept **out** of the global store tree.

| Store | Frequency | Subscribers |
| --- | --- | --- |
| `useRealtimeStore` | low | shell, status strip, System page |
| `useTelemetryStore` | high | only the components displaying a specific asset's readings |
| `useUiStore` | user-driven | shell, inspector, navigation |

A telemetry packet therefore triggers **one** narrow component update, not an
application re-render. The inspector only subscribes to the ring of the machine
it is actually showing, and only while it is open — `watch()` / `unwatch()`
bracket the drawer.

---

## 8. Failure matrix

| Failure | Behaviour |
| --- | --- |
| Backend down before sign-in | Sign-in shows "cannot reach the ForgeSense API" |
| Backend dies after sign-in | `restOk` false → `OFFLINE`; each panel shows its own error; the shell stays interactive |
| WebSocket rejected (401/403) | `ERROR` frame → diagnostic, socket closed, exponential backoff, REST polling carries the console |
| Socket drops | `reconnecting` with attempt count and next-delay; REST polling continues uninterrupted |
| Malformed frame | Dropped, counted in `invalidDropped`, surfaced on the System page |
| Duplicate delivery | Dropped, counted in `duplicatesDropped` |
| Sequence regression | Reconciliation requested; REST snapshot re-seats client state |
| Tab hidden | Socket paused; **no timers, no GPU work**; resumed on visibility |
| Reduced motion | Camera transitions snap instead of easing; ambient animation disabled |
