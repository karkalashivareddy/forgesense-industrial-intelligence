# Phase 3 Architecture Decision

## Decision

ForgeSense keeps `frontend/js/state.js` as the single runtime state architecture. The existing store is already the integration point for REST snapshots, STOMP deltas, polling freshness, selection, inspector data, and the 3D twin. The unused experimental modules `signals.js`, `state.v2.js`, and `overlay.js` were retired rather than leaving two competing state systems in the repository.

## Canonical realtime flow

```text
Telemetry / domain services
  -> WsNotifier canonical envelope
  -> authenticated STOMP CONNECT + topic subscription
  -> frontend StompRealtimeClient
  -> envelope validation
  -> bounded coalescing / discrete queue
  -> state.applyRealtimeEvent
  -> sequence cursor + event-id deduplication
  -> views, inspector, and digital twin
```

The backend envelope is `event`, `eventId`, `assetId` (when applicable), `timestamp`, `sequence`, and `payload`. `sequence` is process-monotonic for the WebSocket publisher; REST snapshots remain the reconciliation source after reconnect.

## Security decision

REST JWT validation is shared with STOMP through `JwtAuthenticationFactory`. The browser sends `Authorization: Bearer <token>` in the STOMP CONNECT native header. `StompAuthenticationInterceptor` validates CONNECT and attaches the authenticated `Principal`; the principal is also stored in STOMP session attributes and restored for subsequent broker messages. Unauthenticated SUBSCRIBE/SEND frames are rejected. The HTTP WebSocket upgrade is permitted only so the browser can reach the STOMP authentication boundary.

## State correctness

`state.js` stores a bounded recent event-id map and per-topic/entity cursors. An event is accepted only once and only when newer than the last accepted sequence (or timestamp when a sequence is unavailable). Telemetry and machine/prediction updates are coalesced before state mutation; alerts, maintenance, and event records remain discrete.

## Digital twin interaction

The existing Three.js implementation remains the visual twin. `selectedMachineId` is the shared selection key. A keyboard-accessible asset list in the factory view selects the same machine and opens the same inspector used by pointer selection. The inspector now owns focus trapping, Escape close, focus restoration, and tab semantics.

## Deferred items

The twin remains a lightweight procedural visualization rather than a physically accurate plant model. GPU profiling, instancing/LOD, and live browser verification require a running browser/backend environment and are recorded as verification items rather than claimed as complete.
