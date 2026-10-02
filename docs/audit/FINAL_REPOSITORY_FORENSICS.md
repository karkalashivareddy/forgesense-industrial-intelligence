# ForgeSense — Final repository forensics

<!-- forge:historical -->
> **Historical audit record.** This document captures a point-in-time review.
> It is kept as evidence of what was checked and when, and is **not** a
> description of the current system. For current behaviour see the [docs index](../README.md)
> index and the source. Several claims here were superseded after the review —
> notably the frontend re-architecture and the transport/model-truth corrections.

Search performed during release packaging (2026-09-29) across
`frontend/src`, `frontend/e2e`, `frontend/test`, `backend/src`, `infra/`, and
all tracked files. Every hit is classified below. **Nothing was deleted
blindly** — most matches are legitimate.

---

## 1. Search terms and results

| Term | `frontend/src` | `backend/src` | Verdict |
| --- | --- | --- | --- |
| `TODO` | 0 | 0 | clean |
| `FIXME` | 0 | 0 | clean |
| `HACK` | 0 | 0 | clean |
| `XXX` | 0 | 0 | clean |
| `console.log` | **0** | 0 | clean |
| `debugger` | **0** | 0 | clean |
| `window.alert(` | **0** | 0 | clean |
| `console.debug` | 1 | — | intentional, dev-only (below) |
| `localhost` | 1 | config only | intentional (below) |
| `127.0.0.1` | 0 | config only | clean |
| `mock` | 0 | 0 | clean |
| `fake` | 0 | 0 | clean |
| `dummy` | 0 | 0 | clean |
| `placeholder` | 5 | — | legitimate HTML `placeholder` |
| `hardcoded` | 2 (comments) | — | legitimate prose |
| `API_KEY` / secrets | 0 | 0 | clean |
| `dangerouslySetInnerHTML` | **0** | n/a | clean |
| `innerHTML` | **0** | n/a | clean |
| `unsafeHTML` | 0 | n/a | clean |
| `temporary` | 0 | 0 | clean |
| `test-only` | 0 | 0 | clean |

---

## 2. Classified findings

### Legitimate static UI metadata — 5 hits
`placeholder=` on the search inputs in `CommandPalette`, `Alerts`, `Anomalies`,
`EventStream`, `Fleet`. Standard accessible search affordance, not stub data.

### Intentional and documented — 4 hits

| Location | Content | Why it stays |
| --- | --- | --- |
| `config/env.ts:18` | `DEFAULT_API_BASE = 'http://localhost:8080'` | Local dev default. Validated at load, overridable via `VITE_API_BASE_URL`. The module's own comment states *"No hardcoded backend origin inside application code."* |
| `realtime/useRealtimeSession.ts:94` | `console.debug` for transport diagnostics | Guarded by `import.meta.env.DEV`, so it is compiled out of the production bundle. Not `console.log`. |
| `three/TwinScene.ts:16` | comment: *"a telemetry storm at 18 machines x 5 s"* | Explanatory comment describing the performance contract. **Not a hardcoded UI value** — the fleet size is read from `useMachines()`. |
| `routes/CommandCenter.tsx:218,389` | comments referencing 18 assets and the `0.0006` saturation | Explanatory context recorded during the risk investigation. The rendered numbers come from the API. |

### Required runtime behaviour

| Location | Pattern | Justification |
| --- | --- | --- |
| `stomp.ts:468` | `setInterval` (heartbeat, 10 s) | STOMP `heart-beat` negotiation; cleared in `stopHeartbeat()` on close and teardown. |
| `stomp.ts:493` | `setTimeout` (reconnect backoff) | Exponential + jitter; cleared on `disconnect()`. |
| `stomp.ts:438` | `requestAnimationFrame` (frame flush) | The batching point: one store dispatch per animation frame. |
| `useNow.ts:21` | `setInterval` (1 s clock) | Shared clock; **pauses when the tab is hidden** and clears on unmount. |
| `TwinScene.ts:1080,1092` | `requestAnimationFrame` (render loop) | On-demand; cancels itself when `needsRender` is false; checks `disposed` each frame. |
| `TwinScene.ts`, `useTwinCanvas.tsx` | `addEventListener` | All removed in `dispose()` / effect cleanup. Verified by listener counts returning to a floor. |

### False positives — the word "alert"
Roughly 20 matches came from `alert` as the **domain noun** (`normaliseAlert`,
`useAcknowledgeAlert`, `canActOnAlert`, `CRITICAL/NEW` badges). No `alert()`
browser dialog exists anywhere. Recorded so a future search does not re-investigate.

### Actual defects
**None in this pass.** Two categories of defect were found and fixed earlier in
this branch and are recorded for completeness:

| Defect | Fixed in |
| --- | --- |
| Maintenance board rendered empty (`{items,total}` read as a bare array) | `aa8d0cc` |
| Machine inspector event list permanently empty (bare array read as `{items,count}`) | `6cae465` |
| Security headers declared but never served (nginx `add_header` inheritance) | `6cae465` |
| Twin requested a 700 ms render settle every 3 s unconditionally | `6cae465` |

---

## 3. Repository hygiene

| Check | Result |
| --- | --- |
| `.env` tracked | **no** (correct) |
| `.env.example` present | yes |
| Secrets in tracked source | none |
| Scratch scripts at repo root | none — none present |
| Stray `package.json` / `package-lock.json` at repo root | none — none present |
| Build output (`dist/`, `test-results/`, `playwright-report/`) | git-ignored; cleaned after each run |
| Files named `*.log` at repo root | 8 dev logs, **git-ignored** via `*.log` |
| `.pytest_cache/` | git-ignored |
| Untracked files at session end | none (working tree clean) |

---

## 4. Documentation accuracy audit

This pass found documentation that was **confidently wrong** — a more serious
class of defect than a code bug, because it misleads exactly the reader it
exists to inform.

| Document | Claim | Reality | Action |
| --- | --- | --- | --- |
| `ARCHITECTURE.md` | "Vanilla ES-module JS + Three.js via CDN" | React 18 + TS + Vite; `three` bundled via npm | rewritten |
| `ARCHITECTURE.md` | "the dashboard does not subscribe to [WebSocket]; the browser's verified transport is REST polling" | STOMP-over-WebSocket is primary; 13 `/topic/**` subscriptions | rewritten |
| `ARCHITECTURE.md` | "Canvas chart helpers" | ECharts 5.5.1 | rewritten |
| `DATA_FLOW.md` | "the browser transport is REST polling" | STOMP deltas + REST authority | rewritten |
| `DATA_FLOW.md` | "`frontend/js/app.js`" | file deleted in the React re-architecture | rewritten |
| `DATA_FLOW.md` | telemetry via `/machines/{id}/telemetry/range` | the UI calls `/telemetry?limit=N` (`/range` also exists but is unused) | corrected |
| `DATA_FLOW.md` | demo asset **M-104** | correct — but the README said M-105, which is already `CRITICAL` | README corrected to M-104 |
| `README.md` | "watch the alert count move" after injection | all 18 assets already hold 2 alerts + 1 work order, so counts do **not** move | corrected with the accurate narrative |

Corrections are recorded in place (`ARCHITECTURE.md` §10) rather than silently
overwritten, so a reader can see what changed and why.

---

## 5. Demo-reliability finding (documentation, not code)

The release runbook's primary demo asset was changed from **M-105 to M-104**
after verifying the fleet state:

- **M-105** (Compressor) is `CRITICAL` **at rest**, already with 2 alerts and a
  work order. Injecting into it produces **no visible change**, so a demo built
  on it looks broken.
- **M-104** (Conveyor Drive Motor) is `NORMAL` at rest and transitions cleanly.
  Measured: `NORMAL`/99.9/0.0006/0.0 → `CRITICAL`/65.9/0.0585/0.9993, and it
  **fully recovers** to `NORMAL`/99.9/0.0006 after
  `POST /api/v1/simulation/control/M-104/clear`, making the demo repeatable.

Additionally, the runbook states plainly that **alert and maintenance counts do
not increase** on injection, because the decision engine has already raised a
standing recommendation for every asset. The demonstrable change is the state
transition, health drop, anomaly saturation and risk increase. Claiming a counter
would move would have been the fabricated-metric failure this audit exists to
prevent.
