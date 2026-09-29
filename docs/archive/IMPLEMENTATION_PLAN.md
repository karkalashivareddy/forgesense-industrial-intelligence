# ForgeSense implementation plan

**Baseline:** 18 September 2026

## Existing system

- Static HTML/CSS/ES-module frontend with Three.js loaded from an import map.
- Spring Boot 4 backend with H2 development mode, PostgreSQL/Redis/Kafka Compose mode, REST under `/api/v1`, and STOMP over `/ws`.
- Python FastAPI ML service and a profile-driven synthetic telemetry simulator.
- Nine operational views plus the factory twin, machine inspector, command palette, auth, maintenance workflow, alert lifecycle, analytics, and simulation controls.
- The worktree already contains user-owned changes and audit/design notes; those remain in scope and are not reset.

## Decisions

1. Keep the current frontend stack. A framework migration would add risk without improving the core industrial workflow.
2. Keep REST as the authoritative snapshot path and add a STOMP event bridge for low-latency UI updates with automatic fallback to polling.
3. Keep backend schemas and event topics unchanged: `telemetry.updated`, `machine.updated`, `machine.state.changed`, `prediction.updated`, `alert.created`, `alert.updated`, `maintenance.*`, `simulation.updated`, and `events.updated`.
4. Use the copper/graphite identity already present in the token work, with cyan reserved for information and telemetry.
5. Make the command center a situation room: a live operational strip, a risk-led action column, a spatial zone map, and a detection-chain narrative. The Digital Twin remains the primary spatial view.
6. Fix responsive behavior and keyboard semantics without introducing a second navigation or overlay system.

## Incremental implementation

### Phase A — runtime foundation

- Replace the unused generic WebSocket helper with a small STOMP client that validates payloads, coalesces bursts per animation frame, and reconnects safely.
- Add event application functions to the existing state store; keep REST polling for snapshot reconciliation and degraded mode.
- Surface the actual transport state in the header/status bar.

### Phase B — command-center experience

- Add a live operations banner and richer command-center composition.
- Add a factory health pulse, risk rail, production signal, and a compact event stream without creating dead controls.

### Phase C — accessibility and responsive hardening

- Add a mobile navigation toggle, explicit status glyphs/text, dialog semantics, focus return, and inspector drawer behavior for tablet/mobile.
- Add reduced-motion-safe visual state transitions.

### Phase D — verification

- Run syntax/tests, inspect changed files, run static server smoke checks, and document environment-blocked checks honestly.

## Reuse / replace map

| Area | Decision | Reason |
| --- | --- | --- |
| REST API client | Keep and harden | Already aligned with backend contracts and auth refresh |
| State store | Refactor in place | Existing views already depend on it |
| Router | Keep | Hash routes and deep links work |
| Three.js twin | Refactor in place | It is the product differentiator and already has selection/focus/cleanup |
| Charts | Keep | Existing charts answer real telemetry questions |
| Generic realtime helper | Rewrite | It did not match the backend STOMP contract and was not wired into the app |
| Visual shell | Redesign | Current structure is functional but too card/grid-oriented and weak on mobile |
| Backend/ML/data model | Preserve | Existing layers cover ingestion, inference, persistence, explainability, and workflows |
