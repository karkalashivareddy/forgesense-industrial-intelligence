# Interview Guide

These prompts are grounded in the current ForgeSense implementation and are
intended to help explain the project precisely.

## Architecture

- Walk through telemetry from the simulator to the frontend.
  - Cover HTTP/Kafka ingestion, normalization, the digital twin, ML calls,
    decision rules, persistence, and WebSocket updates.
- Why does the backend own the digital-twin state?
  - Explain the single source of truth and why the 3D client should not invent
    business state.
- What changes between the `dev` and `docker` profiles?
  - H2/in-memory/in-process adapters versus PostgreSQL/Redis/Kafka.

## Eventing and failure behavior

- What happens if Kafka is unavailable?
  - Describe the configured transport path and the development fallback; do not
    claim transparent production failover unless it has been implemented.
- How are stale or duplicate telemetry events handled?
  - Discuss timestamp staleness checks, recent event-id deduplication, and
    per-machine ordering.
- What happens if the WebSocket connection drops?
  - Explain reconnect behavior and the REST path used for initial or fallback
    reads.

## ML and decision-making

- What does the ML service actually return?
  - Anomaly score, failure-risk result, and explanation factors.
- Where is alert policy implemented?
  - In backend decision rules, not inside the ML service.
- What are the limitations of the model workflow?
  - Training uses project data/synthetic inputs, RUL is heuristic, and no
    production accuracy or factory validation is claimed.

## Data and operations

- What is PostgreSQL used for, and what is Redis used for?
  - PostgreSQL persists domain/history data; Redis is a latest-state/cache
    adapter and is not the source of truth.
- How would this scale to more machines?
  - Discuss Kafka partitioning by machine, consumer groups, stateless ML
    inference, and the future need for time-series storage.
- How are credentials handled?
  - Required environment variables for secure profiles; no reusable credentials
    are stored in the repository.

## Testing

- What is covered by the current tests?
  - 61 JUnit tests on the backend (state machine, twin projection, alert
    lifecycle, decision formatting, telemetry validation, STOMP auth, and an
    RBAC integration suite), 98 Vitest unit tests in the frontend, 8 pytest
    tests in the ML service, and 43 Playwright tests (30 functional + 13
    visual/responsive) that drive a real browser against the running backend.
- What would you add next?
  - Testcontainers-based integration tests for PostgreSQL, Redis and Kafka,
    explicit failure-injection tests for those dependencies, and a
    cross-browser Playwright matrix (currently Chromium only).

