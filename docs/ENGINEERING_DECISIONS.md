# Engineering Decisions

This document records decisions that are visible in the current ForgeSense
implementation. It is deliberately scoped to the code and configuration that
are present today.

## Separate domain decisions from model inference

The FastAPI service returns anomaly, failure-risk, and explanation results. The
Spring Boot backend owns state transitions, alert policy, maintenance workflow,
and production-impact decisions.

This keeps a model prediction from becoming an operational action by accident.
It also lets the decision rules evolve without retraining the model.

## Use adapters for local development and integrated infrastructure

The `dev` profile uses H2, in-memory caching, and an in-process event bus. The
Docker profile uses PostgreSQL, Redis, and Kafka. The backend consumes an event
bus abstraction rather than binding domain logic directly to one transport.

The trade-off is that local development is reproducible and lightweight, while
the Docker path exercises more realistic infrastructure. The two profiles are
not identical deployments and should not be described as production parity.

## Keep the digital twin authoritative

Machine state, recent telemetry, risk, health, dependencies, and connectivity
belong to the backend twin. The frontend renders that state through REST and
WebSocket updates; it does not decide machine health in the browser.

This creates one place to validate state transitions and makes the 3D view a
projection of domain state rather than a second source of truth.

## Make event delivery optional by environment

Kafka is enabled for the integrated profile, while the local profile can use
the in-process bus or HTTP ingestion. Both paths feed the same normalization,
twin, prediction, and decision pipeline.

The trade-off is a smaller local setup, at the cost of not exercising broker
failure and partition behavior during every developer run.

## Label synthetic and heuristic results

The simulator generates synthetic telemetry and supports controlled degradation
scenarios. If the ML service is unavailable, the backend uses a deterministic
heuristic path and exposes that status to the UI. Remaining-useful-life values
and production impact are estimates, not measured factory outcomes.

This boundary is important: the project demonstrates an industrial-intelligence
workflow without claiming access to real plant data or production accuracy.

## Require secrets from the environment

Database, Grafana, dev-user, and JWT credentials are now required through
environment variables for secure profiles. The repository contains only
placeholders in `.env.example`; it does not ship reusable passwords or signing
keys.

