# Phase 3 Implementation

## Scope

This phase hardens the existing ForgeSense prototype. It does not replace the established graphite/copper UI or introduce a competing frontend framework.

## Security

- Added `spring-security-messaging`.
- Added `JwtAuthenticationFactory` so HTTP and STOMP use the same JWT parsing and role mapping.
- Added `StompAuthenticationInterceptor` for authenticated CONNECT frames and authenticated session commands.
- Persists the authenticated principal in STOMP session attributes and restores it for subsequent SUBSCRIBE/SEND frames.
- Kept the WebSocket HTTP upgrade reachable while enforcing credentials in STOMP CONNECT.
- Narrowed the default WebSocket origin fallback to local development origins.
- No token values are logged or rendered.

## Runtime verification evidence

- Authenticated browser session connected with `LIVE · STOMP`.
- An authenticated telemetry ingest for M-101 produced live browser events and advanced freshness to seconds.
- Unauthenticated STOMP subscription was rejected; authenticated CONNECT and subscription were accepted.

## Realtime contract

`WsNotifier` wraps every topic publication in a canonical `RealtimeEvent` with event name, unique id, publisher sequence, timestamp, optional asset id, and payload. The frontend transport rejects unknown topics, mismatched event names, malformed identifiers/timestamps/sequences, and invalid telemetry numeric fields before dispatch.

Only telemetry-like updates are coalesced. Alert, maintenance, simulation, impact, and event notifications use a bounded discrete queue so important operational events are not silently replaced by newer samples.

## State and synchronization

`state.js` remains the only runtime state store. It now tracks bounded event ids and per-entity cursors. REST polling remains the snapshot reconciliation path. Realtime updates feed telemetry, machines, alerts, events, transport freshness, and the inspector. The factory view has an accessible machine list synchronized with `selectedMachineId` and the Three.js scene.

## Product views

Independent Telemetry, Anomalies, and Events routes were added. They consume the same store as Command, Fleet, Alerts, and the Inspector; they do not create duplicate API clients or duplicate machine state.

## Accessibility

The inspector is a labelled modal drawer with focus containment, Escape close, focus restoration, tab roles, and left/right tab navigation. Machine rows and the factory asset list support keyboard activation. The 3D canvas is complemented by a semantic DOM selection surface because WebGL geometry is not a reliable keyboard target.

## ML transparency

The existing ML/inference pipeline was preserved. UI text continues to distinguish model, hybrid, and heuristic modes. No synthetic value is promoted to a real-factory claim.

## Files of interest

- Backend: `JwtAuthenticationFactory.java`, `StompAuthenticationInterceptor.java`, `RealtimeEvent.java`, `WsNotifier.java`, `WebSocketConfig.java`.
- Frontend: `realtime.js`, `state.js`, `app.js`, `views/inspector.js`, `views/factoryView.js`, `views/telemetry.js`, `views/anomalies.js`, `views/events.js`.
- Decisions: `PHASE_3_ARCHITECTURE_DECISION.md`.
