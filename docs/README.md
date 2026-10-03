# ForgeSense Documentation Index

Canonical index for ForgeSense documentation. Every link below is verified by
`npm run check:docs` (see [Repository tooling](#repository-tooling)); a broken
link fails CI rather than accumulating quietly.

Business rules are implemented in code. These documents explain **what the
system does and why**, and are held to that standard: where a document and the
source disagree, the source is correct and the document is a defect.

> **Truthfulness rule.** ForgeSense renders telemetry from a simulator in this
> repository. It does not connect to plant equipment and cannot control it.
> Model output is an estimate, not a measurement or a guarantee. Documentation
> in this folder describes that system honestly and does not imply a real
> industrial deployment.

## Start here

| Document | Purpose |
|---|---|
| [PROJECT_SPECIFICATION.md](PROJECT_SPECIFICATION.md) | Problem, goals, non-goals, scope |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture and component topology |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Running locally and in Docker Compose |
| [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) | What this system does **not** do |
| [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) | Guided walkthrough of the running product |

Repository-level community documents live at the repository root:
[README.md](../README.md), [SECURITY.md](../SECURITY.md),
[CONTRIBUTING.md](../CONTRIBUTING.md), [LICENSE](../LICENSE).

## Product

| Document | Purpose |
|---|---|
| [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) | Design detail across the whole stack |
| [PORTFOLIO_DESCRIPTION.md](PORTFOLIO_DESCRIPTION.md) | Product framing and positioning |
| [FUTURE_SCOPE.md](FUTURE_SCOPE.md) | Deliberately out-of-scope work |
| [UI_UX_GUIDE.md](UI_UX_GUIDE.md) | Interaction and layout guidance |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Tokens, colour, type, spacing, motion |

## Frontend

| Document | Purpose |
|---|---|
| [FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md) | React + TypeScript + Vite console structure |
| [API_FRONTEND_CONTRACT.md](API_FRONTEND_CONTRACT.md) | REST envelope and adapter discipline |
| [REALTIME_FRONTEND_CONTRACT.md](REALTIME_FRONTEND_CONTRACT.md) | STOMP topics, sequencing, reconciliation |

## Backend

| Document | Purpose |
|---|---|
| [DATA_FLOW.md](DATA_FLOW.md) | Telemetry → inference → insight → action |
| [REALTIME.md](REALTIME.md) | STOMP broker, topics, connection lifecycle |
| [PHASE1_CONTRACTS.md](PHASE1_CONTRACTS.md) | Runtime contracts the backend guarantees |
| [ENGINEERING_DECISIONS.md](ENGINEERING_DECISIONS.md) | Rationale for the technology choices |

## Machine learning

| Document | Purpose |
|---|---|
| [ML_PROVENANCE.md](ML_PROVENANCE.md) | How artifacts are produced and validated |
| [MODEL_UI_PROVENANCE.md](MODEL_UI_PROVENANCE.md) | What the UI may claim about model output |

## Security

| Document | Purpose |
|---|---|
| [SECURITY.md](SECURITY.md) | Auth model, roles, secrets handling |

## Operations

| Document | Purpose |
|---|---|
| [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) | Day-to-day operational procedures |
| [OWNERSHIP.md](OWNERSHIP.md) | Authorship and ownership record |

## Quality and release

| Document | Purpose |
|---|---|
| [testing/README.md](testing/README.md) | Test layers, commands, and what each layer proves |
| [TESTING.md](TESTING.md) | Test strategy and how to run each suite |
| [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) | Pre-release gate, recorded as executed evidence |
| [RELEASE_EVIDENCE.md](RELEASE_EVIDENCE.md) | How release evidence is produced |

## Reference material

| Document | Purpose |
|---|---|
| [SCREENSHOTS](screenshots/README.md) | Captured from the running application |
| [audit/](audit/README.md) | Dated audits and verification records |

## Evaluation

| Document | Purpose |
|---|---|
| [INTERVIEW_GUIDE.md](INTERVIEW_GUIDE.md) | Technical interview answers |
| [VIVA_GUIDE.md](VIVA_GUIDE.md) | Demonstration walkthrough |

## Historical

These are point-in-time records, not current documentation. They are retained as
evidence and are **not** a description of the running system.

| Directory | Contents |
|---|---|
| [audit/](audit/) | Dated audits and verification records |
| [archive/](archive/) | Superseded design phases |

## Repository tooling

| Command | Checks |
|---|---|
| `npm run check:docs` | Internal doc links resolve to real files |
| `npm run lint:artifacts` | No debug artifacts in `frontend/src` |

Both run in CI. See [TESTING.md](TESTING.md) for the full verification matrix.
