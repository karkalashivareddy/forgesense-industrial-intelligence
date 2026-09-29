# UI/UX Guide

How the console is organised, and the reasoning behind each decision.

---

## 1. The question the product answers

Every workspace exists to answer one operator question, in this priority order:

1. **What is happening in the factory?** → Command Center
2. **Where is it, spatially?** → Factory Twin
3. **Which assets need attention?** → Fleet, Alerts, Anomalies
4. **Why are they at risk?** → Predictions, inspector attribution
5. **What should I do?** → Maintenance, Simulation
6. **Can I trust this data right now?** → System, the basis chips, freshness
   readouts

Navigation is grouped by that order — **Operations / Intelligence / Work /
Platform** — not by feature module.

---

## 2. Shell

```
┌──────────────────────────────────────────────────────────────────┐
│ TOP   ForgeSense · Factory Alpha [verdict] [conn] [ML] [basis]  ⏱ 👤 │  52px
├────────────┬──────────────────────────────────┬──────────────────┤
│ OPERATIONS │                                  │                  │
│  Command   │                                  │   INSPECTOR      │
│  Twin      │        WORKSPACE                │   (drawer, on    │
│  Fleet     │                                  │    demand)       │
│ INTEL…     │                                  │                  │
│ WORK       │                                  │                  │
│ PLATFORM   │                                  │                  │
├────────────┴──────────────────────────────────┴──────────────────┤
│ STATUS  Transport · Input · Basis · Oldest reading · Events      │  30px
└──────────────────────────────────────────────────────────────────┘
```

The status strip is permanent. Freshness and provenance are not something an
operator should have to go looking for — they are ambient, always visible.

### Mobile

- The rail becomes an off-canvas slide-over behind a hamburger.
- A 5-item bottom navigation bar appears below 860 px.
- The inspector becomes a **bottom sheet** (88 vh, rounded top, drag-ready).
- The connection badge collapses to its icon below 480 px; the full text stays
  in the tooltip and on the System page, so nothing is lost.

---

## 3. Command Center

Deliberately **not** a grid of twelve equal KPI cards. That layout flattens
priority, and priority is the whole job.

```
┌──────────────────────────────────────────────────────────────┐
│  OPERATIONAL / ATTENTION / DEGRADED / OFFLINE               │  verdict, largest type
│  3 assets in a critical condition     [fleet health] [risk] │
├──────────────────────────────────────────────────────────────┤
│  Assets 18 · Normal 14 · Attention 2 · Critical 1 · Stale 0 │  compact counters
├──────────────────┬───────────────────────┬───────────────────┤
│ ASSET BOARD      │ LIVE ACTIVITY         │ PRIORITY INCIDENTS│
│ 18 cells,        │ scrolling event       │ alert → asset →   │
│ colour-coded     │ stream                │ prediction        │
│                  │                       │                   │
│ HIGHEST RISK     │                       │ ALERT POSTURE     │
│ ranked list      │                       │ MAINTENANCE       │
└──────────────────┴───────────────────────┴───────────────────┘
```

The verdict is the largest element because it is the answer to question 1.
The asset board is a dense grid rather than cards: 18 assets must be scannable
at a glance, and a wall of cards would push the operational content below the
fold.

---

## 4. Factory Twin

The centrepiece, and a comprehension tool rather than decoration.

**Encoding modes** — the same scene answers three different questions:

| Mode | Answers |
| --- | --- |
| Status | Where is the problem right now? |
| Risk | Where is predicted risk concentrated? |
| Dependencies | What breaks if this asset stops? |

**Interactions**: click to inspect, double-click to focus, drag to orbit,
scroll to zoom, plus explicit Fit and Top-down presets for users who would
rather not fly a camera.

**Accessibility parity**: the twin is `role="application"` with a label, but it
is never the *only* route to a machine. The asset list, the fleet table and
`Ctrl+K` all reach the same inspector, and focusing an asset in the list moves
the camera. The 3D view is an enhancement, not a gate.

---

## 5. Machine inspector

The most important surface in the product, because it is where an operator
actually decides.

| Tab | Answers |
| --- | --- |
| Overview | Is it healthy, how risky, what's open, what do I do? |
| Telemetry | What are the sensors actually reading, and how fresh? |
| Prediction | Why is the model worried — and how much should I trust it? |
| Alerts | What has fired, and what actions can I take? |
| Maintenance | What work exists, and what can I advance? |
| Events | What happened to this asset historically? |

Design rules on this surface:

- **Guidance is stated, not implied.** Each state carries an operational
  instruction.
- **Every number shows its basis.** Health is derived, risk is model-predicted,
  telemetry is synthetic.
- **Attribution is clickable and navigable** — selecting a driver opens the
  telemetry tab, connecting "why" to "what".
- **Actions are role-gated and honestly disabled**, with a tooltip explaining
  which role is required.
- **Empty states are specific**: "No telemetry available for M-104", not a
  blank panel.

---

## 6. Alert Center

An industrial alarm experience. The lifecycle strip shows all four canonical
states with live counts; severity and text filters sit below it; the table
carries severity, asset, condition, type, risk at creation, first seen,
duration, status and the permitted actions.

Every row is an entry point into the investigation chain:
**Alert → asset → prediction → maintenance**.

A resolved alert is not deleted — it stays in the register with its resolution
timestamp, because an operator reviewing an incident needs the history.

---

## 7. Maintenance

Rendered as a board mirroring the backend lifecycle exactly:
`RECOMMENDED → SCHEDULED → ACTIVE → COMPLETED`, plus `CANCELLED`.

The UI does **not** show an "Investigating" or "Validating" column, because the
server cannot store those states. Inventing a stage the backend does not
support is how a CMMS demo becomes a lie.

**Only stages that hold work orders get a lane.** A fixed five-column board
next to a single full column wastes most of the width and squeezes the actual
backlog into a narrow strip, so empty stages collapse and the remaining lanes
take the full width — with cards flowing into multiple columns when one stage
dominates. The stage metric row above stays the authoritative count for every
lifecycle stage, including the empty ones, and a note says so. The board never
silently hides work.

A table view is available for scanning and sorting.

---

## 8. Predictions

Every value here is model output, and the page says so before you read a
number. The banner names the model versions and reports how many assets are
currently on the heuristic fallback.

The limitations panel is non-dismissible and states plainly that failure risk
is a probability without a confidence interval, and that remaining-useful-life
is simulator steps rather than time.

---

## 9. Scenario Lab

Framed as an engineering laboratory, not a game.

- The boundary is unmissable: **SIMULATION MODE — NO PHYSICAL MACHINE
  CONTROL**, above the controls, not in a tooltip.
- A fault-model catalogue with a plain-language description of each, populated
  from the backend's `ScenarioType` enum rather than invented locally.
- **Two separate actions**, because their side effects are fundamentally
  different:
  - **Run what-if** — computes modelled production impact against the
    dependency graph. Records a run. Changes nothing else. Safe and repeatable.
  - **Inject into live feed** — changes what the synthetic generator emits
    next. Propagates through the ML service and the decision engine into
    machine state, alerts and work orders. Guarded while already active.
- A live preview of the dependency fan-out the engine *will* model, read from
  the real graph — while downtime and loss are shown only after a run, because
  that is when they are known.
- A timeline strip showing the propagation: T0 → degrade → anomaly → risk →
  alert → maintenance → recover.
- While a scenario is live, the Factory Twin shows its own simulation banner,
  so the boundary is visible from every surface, not just this one.

---

## 10. System

Organised around three questions: **what is broken, what still works, what can
I trust**. A service tile shows `AVAILABLE | DEGRADED | UNAVAILABLE | UNKNOWN`
with an icon and the observed evidence behind that verdict. No synthetic
"99.99% uptime" — if a number was not measured, it is not shown.

The transport diagnostics panel exposes the realtime pipeline's own counters:
deltas applied, duplicates suppressed, malformed frames rejected. Operators can
see the machinery working.

---

## 11. Empty, loading and error states

Every panel has all four. They are designed, not browser defaults.

| State | Treatment |
| --- | --- |
| Loading | Shimmer skeleton shaped like the content, plus a polite live-region label |
| Empty | Icon, a specific sentence, and a next action ("Widen to 300 readings") |
| Error | Icon, what failed, why it matters, and a Retry button |
| Stale | Amber banner naming the age of the data being shown, plus Refresh |

A failing subsystem shows its own error while every other panel keeps
rendering healthy data. This is the direct fix for the old all-or-nothing
`Promise.all`.

---

## 12. Motion

Motion marks a state change and nothing else. 120–200 ms for interaction,
300 ms for chart interpolation, 620 ms for a camera tween. No infinite
animation, no flashing critical badge — a permanently flashing alert trains
operators to ignore it. Live data is expressed through tabular numerals and a
time-ago readout, not a pulse.

`prefers-reduced-motion: reduce` collapses all of it to zero while keeping
every state legible.

---

## 13. Data honesty — the non-negotiables

1. A synthetic feed is labelled **SYNTHETIC**, never `LIVE`.
2. RUL is **simulator steps**. There is no hours formatter in the codebase, and
   a unit test asserts the output cannot contain a time unit.
3. Attribution is **baseline perturbation**, never "SHAP".
4. A heuristic fallback is labelled **HEURISTIC FALLBACK**, and the
   Predictions banner says how many assets are affected.
5. Production impact renders the backend's own `dataLabel` and
   `assumptionsJson` verbatim.
6. A small non-zero probability is never rounded to `0%` — the formatting
   helper emits `0.060%` and `<0.01%`, and a unit test pins both.
7. The status strip always states that the console does not control physical
   machinery.
