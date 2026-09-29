# API contract matrix (frontend ↔ backend)

Verified against the **running** backend by probing every endpoint with an
authenticated session, not by reading DTOs. Captured 2026-09-29.

## Why this document exists

The backend is **not consistent about how collections are wrapped**, and the
frontend cannot infer the shape from the type alone. Two live incidents came
from this and nothing else:

| Incident | Endpoint | Actual | Adapter assumed | Symptom |
| --- | --- | --- | --- | --- |
| Fixed in `aa8d0cc` | `GET /api/v1/maintenance` | `{ total, items }` | bare array | board showed "no work orders" while the nav badge read 18 |
| Fixed in this pass | `GET /api/v1/machines/{id}/events` | bare array | `{ items, count }` | inspector event list permanently empty |

Both are **silent**: the adapter returned `[]`, which is byte-identical to a
legitimately empty result. The type checker cannot see it and no component
assertion caught it. Every collection now goes through `unwrapCollection()` in
`frontend/src/api/adapters.ts`, which accepts all three shapes, and
`frontend/test/adapters.test.ts` locks each one.

**When you add an endpoint, add its real envelope to the table below and a case
to `adapters.test.ts`.**

## The three envelopes

| Shape | Key | Endpoints |
| --- | --- | --- |
| bare array | — | `/zones` `/factories` `/machines` `/machines/dependencies/edge` `/machines/{id}/events` `/machines/{id}/predictions` `/simulation/control` `/simulation/scenarios` `/analytics/risk-ranking` |
| object | `items` | `/alerts` `{items,total,statusFilter}` · `/maintenance` `{items,total}` · `/events` `{items,count}` |
| object | `rows` | `/machines/{id}/telemetry` `{rows,basis,machineId}` |

Counters are also inconsistent: `/alerts` reports `total`, `/events` reports
`count`. `unwrapCount()` accepts either and falls back to `items.length`.

## Matrix

| Endpoint | Method | Response shape | Adapter | Frontend consumer | Error behaviour | Empty behaviour |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/v1/auth/login` | POST | `{ accessToken, ... }` | none (direct) | `AuthProvider` | error → gate reopens, no token stored | n/a |
| `/api/v1/zones` | GET | `Zone[]` (6) | `normaliseZones` | Twin layout, `useZones` | `ErrorState` in the workspace | n/a (static topology) |
| `/api/v1/factories` | GET | `Factory[]` (1) | inline map | shell factory name | non-critical | n/a |
| `/api/v1/machines` | GET | `Machine[]` (18) | `normaliseMachine` | Command Center, Fleet, Twin, Inspector | `ErrorState` + retry; shell survives | `EmptyState`, never silent |
| `/api/v1/machines/{id}` | GET | `MachineDetail` | `normaliseMachineDetail` | machine inspector | `ErrorState` | `EmptyState` "Asset not found" |
| `/api/v1/machines/dependencies/edge` | GET | `DependencyEdge[]` (20) | inline map | Twin dependency mode | scene renders without edges | no edges drawn |
| `/api/v1/machines/{id}/telemetry` | GET | `{rows,basis,machineId}` | `normaliseTelemetryRange` | Telemetry, inspector sparklines | `ErrorState` | chart empty, basis still shown |
| `/api/v1/machines/{id}/predictions` | GET | `Prediction[]` (50) | `normalisePrediction` | Predictions, inspector | `ErrorState` | `EmptyState` |
| `/api/v1/machines/{id}/explanation` | GET | `Explanation` | `normaliseExplanation` | inspector explanation | `ErrorState` | factors `[]` |
| `/api/v1/machines/{id}/events` | GET | **bare array** (50) | `normaliseEventList` | inspector Events tab | `ErrorState` | `EmptyState` "No recorded history" |
| `/api/v1/impact/{id}` | GET | `{latest,history,hasImpact}` | inline in `useMachineImpact` | inspector impact | `ErrorState` | `latest: null` |
| `/api/v1/alerts?status=&limit=` | GET | `{items,total,statusFilter}` | `normaliseAlertList` | Alert Center, Command Center | `ErrorState` | `EmptyState` |
| `/api/v1/alerts/{id}/acknowledge\|investigate\|resolve` | POST | `{…}` | none | Alert Center actions | mutation error surfaced | invalidates `alerts` + analytics |
| `/api/v1/maintenance?limit=100` | GET | `{items,total}` | `normaliseMaintenance` | Maintenance board, CC backlog, inspector | `ErrorState` "Maintenance unavailable" | `EmptyState` "No work orders" |
| `/api/v1/maintenance/{id}/schedule\|start\|complete\|cancel` | POST | `{…}` | none | Maintenance board | mutation error surfaced | invalidates `maintenance` + `machines` |
| `/api/v1/analytics/overview` | GET | `AnalyticsOverview` | none (typed) | Command Center KPIs | `ErrorState` | n/a (scalars) |
| `/api/v1/analytics/risk-ranking` | GET | `RiskRankingRow[]` (18) | `normaliseRiskRanking` | Command Center risk panel | `ErrorState` | `EmptyState` |
| `/api/v1/analytics/alerts` | GET | `AlertStats` | none (typed) | nav badge | `ErrorState` | badge hidden, not shown as 0 |
| `/api/v1/analytics/health-trends` | GET | `FleetHealth` `{machines,basis}` | none (typed) | Analytics | `ErrorState` | `EmptyState` |
| `/api/v1/analytics/maintenance` | GET | `MaintenanceStats` | none (typed) | nav badge | `ErrorState` | badge hidden |
| `/api/v1/analytics/events` | GET | `EventFrequency` | none (typed) | Analytics | `ErrorState` | zeros, chart empty |
| `/api/v1/events?machineId=&limit=` | GET | `{items,count}` | `normaliseEventList` | Event Stream, Command Center | `ErrorState` | `EmptyState` |
| `/api/v1/simulation/scenarios` | GET | `SimulationRun[]` | inline map | Scenario Lab history | `ErrorState` | `EmptyState` "No scenario runs" |
| `/api/v1/simulation/control` | GET / POST | `SimulationControl[]` | inline map | Scenario Lab, Twin | mutation error surfaced | `[]` = nothing injected |
| `/api/v1/simulation/run\|pause\|resume\|reset` | POST | `{…}` | none | Scenario Lab | mutation error surfaced | invalidates 9 query keys |
| `/api/v1/simulator/config` | GET | `SimulatorConfig` `{paused,machines}` | none (typed) | Scenario Lab | `ErrorState` | n/a |
| `/api/v1/system/status` | GET | `SystemStatus` | none (typed) | header verdict, provenance, System | `ErrorState` | n/a |
| `/api/v1/telemetry/status` | GET | `TelemetryStatus` | none (typed) | status strip, connection detail | `ErrorState` | n/a |
| `/actuator/health` | GET | `ActuatorHealth` | none (typed) | System page | `ErrorState`, `retry: 0` | n/a |

## Error-isolation rule (verified)

A single failed resource never blanks the console. Verified by aborting one
endpoint at a time and asserting the rest still renders:

| Failure | Shell | `h1` | Other resources | Failed resource shows |
| --- | --- | --- | --- | --- |
| none (healthy) | up | yes | 18 assets | — |
| `/maintenance` | up | yes | **18 assets** | `ErrorState` "Maintenance unavailable" |
| `/analytics/*` | up | yes | **18 assets** | 2 `ErrorState`s |
| `/machines` | up | yes | maintenance panel hidden | `ErrorState` |

A failure always renders as an **error state**, never as an empty successful
state. The two are deliberately distinguished so "the server said there is
nothing" can never be confused with "the server did not answer".

## Auth and transport rules

- `401` on any authenticated request → `SessionExpiredError`, token cleared,
  sign-in gate reopened. Not retried.
- Aborted requests (`AbortError`) propagate unchanged — a caller unmounting is a
  decision, not a failure.
- Non-JSON body → `ApiError("Backend returned a non-JSON response body.")`
- `204` and empty bodies → `null`, not a parse error.
- Tokens live in memory only (`api/client.ts` module state). Nothing sensitive
  is written to `localStorage`.
