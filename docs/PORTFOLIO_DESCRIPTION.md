# ForgeSense — Portfolio description

Three lengths, all factually supported by this repository. Nothing here claims a
capability the code does not have.

---

## Short — for the GitHub repository description

> **ForgeSense** is an industrial operations console for synthetic telemetry:
> realtime STOMP asset updates, a Three.js digital twin, an ML failure-risk and
> anomaly pipeline feeding alerts and maintenance recommendations, and a
> scenario lab that injects degradations into the simulator and shows the
> consequence propagate end to end. It does not control physical machinery.

---

## Resume — three bullets

- **Built a realtime industrial telemetry console** (React 18 + TypeScript +
  Vite) on a Spring Boot / Kafka / PostgreSQL backend, consuming 5-second
  telemetry over **STOMP-over-WebSocket**. The transport coalesces per asset and
  dispatches once per animation frame, keeping ~3.6 events/second off the React
  render path — measured at 0.16 s script time per 8 s wall, zero long tasks,
  60 fps, with **exactly one** WebSocket across 14 route changes.
- **Designed the honest data-provenance layer.** Every value carries a basis —
  observed, derived, model-predicted, synthetic, simulated, unavailable — and
  model output is visually quarantined in violet, so an operator can always tell
  a measurement from an inference. When a value cannot be trusted it renders as
  *unavailable* rather than as a confident `0`.
- **Verified it.** Current local verification includes 98 Vitest unit tests,
  64 backend tests, 10 ML tests, strict TypeScript, and a production frontend
  build. Playwright and a full Docker deployment were not re-run in this
  checkout. Earlier browser work caught real defects: an event list permanently empty
  because of a mis-guessed JSON envelope, and security headers that were
  declared in nginx but **never served** because `add_header` is not inherited
  into a location that declares one.

---

## Portfolio — 130 words

**The problem.** Industrial dashboards fail quietly: they go stale without
saying so, a risk score arrives with no way to ask why, and nobody can tell at
03:00 whether the screen is fresh or frozen. ForgeSense is a demonstration of the
architecture that fixes that — a full decision pipeline on **synthetic**
telemetry, with honesty as a first-class design constraint.

**The system.** A Python simulator feeds a Spring Boot backend through
`/api/v1/telemetry/ingest`; telemetry is normalised into an authoritative digital
twin, scored by an ML service (scikit-learn IsolationForest + GradientBoosting)
for anomaly and failure risk, and passed through a rules-based decision engine
that produces machine state, alerts and maintenance recommendations. The
console consumes it over STOMP, with REST polling retained as the reconciliation
authority so a dropped socket causes staleness, never wrongness.

**Demonstrated.** Injecting `VIBRATION_SPIKE` on a healthy asset moves it
`NORMAL → CRITICAL` with health 99.9 → 65.9 and failure risk 0.0006 → 0.0585, and
the change is visible across every workspace.

**Not claimed.** No physical machine control and no fieldbus client exist, the
models are unvalidated against real equipment, and failure risk carries no
confidence interval.

---

## Accuracy notes

Claims deliberately **not** made, and why:

| Avoided claim | Why |
| --- | --- |
| "production-ready" / "enterprise-grade" | The frontend is verified; the backend is single-node with no load or failure testing. |
| "real factory" / "real-time plant data" | The feed is simulated. The status strip says `DATA BASIS SYNTHETIC` on every screen. |
| "guaranteed predictive maintenance" | Failure risk is a bare probability with no confidence interval, and it saturates at `0.0006` for nominal assets. |
| "AI-powered" | Only two components are actually ML-backed (anomaly score, failure risk). Alert policy is a rules engine, deliberately. |
| "real-world ML accuracy" | The model was trained on simulator data and has never seen real equipment. |
| "safety-certified" | No SIL/PL rating, interlock or fail-safe design. |
| "sub-second latency" | Telemetry is emitted every 5 s; the console is honest about its own freshness rather than claiming a latency it does not have. |
