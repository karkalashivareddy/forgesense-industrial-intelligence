# ForgeSense — Documentation Index

Every engineering area is documented. Business rules are implemented in code;
these documents explain **why**, not just *what* the code does.

## Getting started
| Doc | Purpose |
|---|---|
| [PROJECT_SPECIFICATION.md](PROJECT_SPECIFICATION.md) | Problem, goals, non-goals, architecture, milestones |
| [ABSTRACT.md](ABSTRACT.md) | 1-page abstract of the platform |
| [INTERVIEW_GUIDE.md](INTERVIEW_GUIDE.md) | Answers for technical interviews on this system |

## Architecture & design
| Doc | Purpose |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | High-level architecture and component diagram |
| [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) | Deep design across the whole stack |
| [DATA_FLOW.md](DATA_FLOW.md) | Telemetry → insights → action data flows |
| [DIGITAL_TWIN.md](DIGITAL_TWIN.md) | Digital twin state, machine state machine |
| [EVENT_STREAMING.md](EVENT_STREAMING.md) | Operational event model & timeline |
| [KAFKA.md](KAFKA.md) | Kafka topology, topics, consumers, error handling |

## Machine learning
| Doc | Purpose |
|---|---|
| [MACHINE_LEARNING.md](MACHINE_LEARNING.md) | ML architecture: anomaly, risk, evaluation strategy |
| [MODEL_CARD.md](MODEL_CARD.md) | Model cards for deployed artifacts |
| [DATASET.md](DATASET.md) | AI4I dataset, preprocessing, limitations |
| [FEATURE_ENGINEERING.md](FEATURE_ENGINEERING.md) | Features and why they exist |
| [EXPLAINABILITY.md](EXPLAINABILITY.md) | SHAP and attribution methodology |

## APIs & data
| Doc | Purpose |
|---|---|
| [API.md](API.md) | REST API v1 reference |
| [WEBSOCKET.md](WEBSOCKET.md) | Real-time WebSocket event reference |
| [DATABASE.md](DATABASE.md) | PostgreSQL schema / ER diagram, indexes |

## Frontend & 3D
| Doc | Purpose |
|---|---|
| [FRONTEND.md](FRONTEND.md) | Frontend architecture, state management |
| [3D_ENGINE.md](3D_ENGINE.md) | Three.js / R3F factory scene, performance |
| [UI_UX.md](UI_UX.md) | Industrial control-room design system |

## Domain capabilities
| Doc | Purpose |
|---|---|
| [SIMULATION.md](SIMULATION.md) | What-if simulation engine |
| [PRODUCTION_IMPACT.md](PRODUCTION_IMPACT.md) | Impact estimation methodology |
| [MAINTENANCE.md](MAINTENANCE.md) | Maintenance workflow & recommendations |

## Operations
| Doc | Purpose |
|---|---|
| [SECURITY.md](SECURITY.md) | Authentication, authorization, roles, secrets |
| [OBSERVABILITY.md](OBSERVABILITY.md) | Metrics, Actuator, Prometheus, Grafana |
| [TESTING.md](TESTING.md) | Test strategy: unit / integration / ML / E2E |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deployment approaches (local, Docker, AWS roadmap) |
| [DOCKER.md](DOCKER.md) | Docker Compose reference |

## Honesty & roadmap
| Doc | Purpose |
|---|---|
| [LIMITATIONS.md](LIMITATIONS.md) | What ForgeSense does **not** do |
| [FUTURE_SCOPE.md](FUTURE_SCOPE.md) | Where the platform can grow |
| [ROADMAP.md](ROADMAP.md) | Milestones and timeline |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Common issues and resolutions |