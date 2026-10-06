# ForgeSense — Demo Runbook

A 3–5 minute demonstration. Every endpoint, enum value, and expected number in
this runbook was **executed against the running system on 2026-09-29**; the
figures are quoted from that run, not estimated.

---

## 0. Before you start (2 minutes, once)

```bash
cp .env.example .env       # then set the four required secrets (see below)
docker compose up -d --build frontend
docker compose ps          # all services should be Up (healthy)
```

`.env` must define `POSTGRES_PASSWORD`, `FORGESENSE_SECURITY_JWT_SECRET`,
`FORGESENSE_DEV_PASSWORD`, and `GRAFANA_ADMIN_PASSWORD`. Compose uses the `:?`
form for each, so the stack refuses to start while one is missing rather than
using a committed default.

Open <http://localhost:5173> and sign in as `admin` with the
`FORGESENSE_DEV_PASSWORD` you set in `.env`.

> **`localhost:5173` is an nginx container serving a built bundle, not a Vite dev
> server.** If you changed source and the browser looks unchanged, rebuild with
> `docker compose up -d --build --force-recreate frontend`. The
> `--force-recreate` is required; a plain `up -d` can leave the old container
> running against the new image.

**Baseline to confirm before starting** (fleet is 18 assets, 16 `NORMAL`,
2 `CRITICAL` — M-105 Compressor and M-107 Cooling Unit are pre-seeded):

| Asset | State at rest |
|---|---|
| M-104 Conveyor Drive Motor | `NORMAL`, health 99.9, risk 0.0006, anomaly 0.0 |
| Alerts | 36 total (2 per asset) |
| Maintenance | 18 `RECOMMENDED` work orders (1 per asset) |
| Active simulation controls | 0 |

> **Use M-104 for this demo, not M-105.** M-105 is already `CRITICAL` with
> alerts and a work order, so injecting into it changes nothing visible. M-104
> starts `NORMAL` and transitions cleanly — and it fully recovers, so the demo
> is repeatable.

---

## Step 1 — Command Center (~45 s)

**Show:** fleet health, the asset board, the failure-risk panel, alerts,
maintenance posture, and the provenance disclosure.

**Say:** *"ForgeSense is built around operational decisions, not dashboards. The
first thing on screen answers 'is this plant okay, and what needs me?' — a single
verdict word, at display scale, with the supporting numbers beside it and not
competing with it."*

Point at, in order:

1. **The verdict** — `DEGRADED` with the reason beneath it. Largest type on the
   page, because it is the answer to question 1.
2. **`SYNTHETIC FEED`** — the provenance disclosure, deliberately separated from
   the operational verdict. Different colour, different weight, different
   concept. Say: *"The plant state and the data provenance are two different
   facts, and the interface never merges them."*
3. **`ML failure-risk-v2`** — which model produced the violet numbers.
4. **Fleet health / peak failure risk** meters on the right.
5. **The asset board** — all 18 assets, colour-coded by operational state. Green
   `NORMAL`, red `CRITICAL`. Point at M-104 specifically: *"this one is healthy;
   watch it."*
6. **The failure-risk panel** — note the explicit explanation that nominal risk
   values are identical and why. **Do not hide this; it is the honest answer.**
7. **Maintenance backlog** — 18 `RECOMMENDED` work orders.

---

## Step 2 — Open M-104 (~45 s)

Click the **M-104** card (or Twin → asset list). Say: *"Conveyor Drive Motor.
This is the asset I am going to degrade, and I'm going to show you the whole
chain light up."*

Walk the inspector tabs:

| Tab | Show | Note |
|---|---|---|
| **Overview** | identity, zone, line, criticality, operating hours | backend-owned facts |
| **Telemetry** | live sensor values + sparklines | "live" = STOMP delta, bounded history |
| **Prediction** | failure risk, anomaly, RUL in **violet** | *"violet always means the model said this"* |
| **Alerts** | this asset's 2 alerts | severity = colour, lifecycle = weight |
| **Maintenance** | this asset's work order | 5 backend states, not a fake CMMS |
| **Events** | recorded history | *"Showing 50 of 50 events"* |

**Say on provenance:** *"Note the basis chips. Telemetry is SYNTHETIC because it
comes from a simulator. Failure risk is PREDICTED because a model produced it.
Health is DERIVED because the backend computed it from observations. The console
tells you which is which on every number."*

---

## Step 3 — Scenario Lab: inject the vibration scenario (~45 s)

Navigate **Scenario Lab**. Emphasise the separation before clicking anything:

> **Run what-if** — computes modelled impact, **changes nothing**.
> **Inject into live feed** — changes what the simulator emits, and propagates
> through ML into machine state, alerts, and maintenance.
>
> *"The console refuses to blur these, because only one of them touches the
> system."*

**Exact action** (what the UI sends, for reference):

```http
POST /api/v1/simulation/control
{ "machineId": "M-104", "scenario": "VIBRATION_SPIKE", "severity": 0.9 }
```

`VIBRATION_SPIKE` is the real `ScenarioType` enum value — not "VIBRATION". The
full enum is `NONE · DEGRADATION · OVERHEATING · BEARING_FAILURE ·
VIBRATION_SPIKE · RPM_INSTABILITY · CURRENT_SPIKE · SENSOR_FAILURE ·
MACHINE_OFFLINE · LOAD_INCREASE · MAINTENANCE · RECOVERY`.

Confirm the injected control appears in the table.

---

## Step 4 — Observe the telemetry changing (~30 s)

Return to **M-104 → Telemetry**, or watch the Twin.

> *"Vibration is now climbing. This is the simulator responding to the injected
> parameter — the same mechanism a real plant would use, with no plant."*

The change arrives over STOMP `telemetry.updated`, coalesced per asset and
dispatched once per animation frame. Point out the status strip footer:
`OLDEST READING <n>s ago` — the console proves its own data freshness rather
than claiming "real-time" without evidence.

---

## Step 5 — The ML response (~30 s)

Watch **Prediction** on M-104.

**Observed transition (measured):**

| Field | Before | After | Change |
|---|---|---|---|
| `status` | `NORMAL` | **`CRITICAL`** | derived by the state machine |
| `healthScore` | 99.9 | **65.9** | −34 points |
| `anomalyScore` | 0.0 | **0.9993** | saturation of the detector |
| `anomalyLabel` | `NORMAL` | **`ANOMALY`** | — |
| `failureRisk` | 0.0006 | **0.0585** | **97× increase** |

> *"The model did not just copy the injected severity. It received a feature
> vector and produced its own assessment — and note the failure risk moved 97
> fold, from 0.06% to 5.85%, while remaining in violet because it is model
> output. The red is the machine state; the violet is the prediction. Different
> facts, different colours."*

---

## Step 6 — Operational consequences (~30 s)

On the Command Center, and in the M-104 inspector:

1. **Asset state** — M-104's card is now red `CRITICAL`.
2. **Priority incidents** panel — M-104 listed.
3. **Maintenance** — M-104's work order is present.

> **Be accurate here.** In the current seeded dataset, alert and maintenance
> counts do **not** increase on injection: all 18 assets already carry 2 alerts
> and 1 `RECOMMENDED` work order from the backend's own decision engine, so the
> totals stay at 36 and 18. The demonstrable change is the **state transition,
> the health drop, the anomaly saturation, and the risk increase** — plus the
> asset moving into the priority-incident panel.
>
> Say so plainly: *"the counts don't move because the decision engine already
> raised a standing recommendation for every asset. What's new is the severity
> of M-104's condition, not the existence of its paperwork."* That is a more
> credible answer than a rigged counter.

To show a lifecycle action live instead, use **Alert Center** and acknowledge or
investigate one of M-104's alerts — the counter and the badge both move.

---

## Step 7 — Fleet-level consequences (~30 s)

Return to **Command Center** and look at the whole picture:

- **Fleet verdict** — recomputed from the new machine state.
- **Asset board** — M-104 now red among green; the M-104 card sits in the
  critical set.
- **Priority incidents** — M-104 surfaced.
- **Factory Twin** — M-104's indicator turns red in 3D, and in **Risk** mode
  the intelligence overlay dims nominal assets and highlights the affected one.
  Same data, same colours, one source of truth.

> *"One injected parameter, eight layers of consequence, and every one of them
> traceable to a single authoritative record on the backend. Nothing in the UI
> computed a business fact on its own."*

---

## Step 8 — The honesty boundary (~45 s)

Open **System**, then close on this, verbatim:

> **This demonstration uses synthetic/simulated industrial telemetry.
> ForgeSense demonstrates the architecture and the decision pipeline. It does
> not claim to control a physical factory, and it does not claim its models are
> accurate for real equipment.**

Supporting points, all verifiable on screen:

- **The persistent footer**, on every screen: *"Synthetic simulator telemetry —
  operational visualisation only, no physical machine control."*
- **The status strip**: `DATA BASIS SYNTHETIC`, `TRANSPORT WebSocket`,
  `INPUT Kafka`.
- **No fieldbus**: there is no OPC-UA, MQTT, or Modbus client anywhere in the
  codebase. The only write paths are operator actions against the backend's own
  API.
- **Twin geometry is representative**, as the twin caption states — not surveyed
  plant models.
- **RUL is a simulator-relative step count**, not a calibrated remaining-life
  estimate. The UI labels the unit (`steps`) rather than inventing hours.

### The risk-saturation limitation — disclose it, don't hide it

Every nominal asset currently reads `0.060%`, because `failure-risk-v2` is a
coarse classifier that saturates near zero for healthy assets. This was
investigated and is genuine model output, not a bug: the same response carries
8+ distinct anomaly scores and 2 distinct health scores, so nothing is being
collapsed in transit.

> *"If I faked some spread here, the dashboard would look more interesting and
> the product would be worse. A flat line from a coarse model is the truth. So
> the console explains the saturation instead of hiding it, and a regression
> test pins the formatter's precision so distinct values can never be merged by
> a future change."*

---

## Recovery — making the demo repeatable

The injection is fully reversible and M-104 returns to its rest state:

```http
POST /api/v1/simulation/control/M-104/clear
```

**Verified recovery (measured, ~40 s):** `NORMAL`, health 99.9, risk 0.0006,
anomaly 0.0013, active controls 0. The demo can be run repeatedly.

Prefer the UI: **Scenario Lab → clear the control for M-104**. Otherwise the
next run starts with M-104 already `CRITICAL` and the transition is invisible —
the same trap as using M-105.

---

## Timing summary

| Step | Duration |
|---|---|
| 1 Command Center | 45 s |
| 2 Open M-104 | 45 s |
| 3 Scenario Lab, inject | 45 s |
| 4 Telemetry changes | 30 s |
| 5 ML response | 30 s |
| 6 Operational consequence | 30 s |
| 7 Fleet consequences | 30 s |
| 8 Honesty boundary | 45 s |
| **Total** | **≈ 5 min** |

## If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| Source change not visible | stale nginx container | `docker compose up -d --build --force-recreate frontend` |
| Injection seems to do nothing | injected into M-105 (already `CRITICAL`) | inject into **M-104** |
| M-104 already `CRITICAL` | previous run not cleared | clear the M-104 control |
| No telemetry movement | socket paused because the tab is hidden | focus the browser window |
| Header shows `DEGRADED`/`STALE` | transport or REST failing | check `docker compose ps`; the header tooltip states the reason |
| Sign-in gate reappeared | `401` — session expired or backend restarted | sign in again |
