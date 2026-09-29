# Documentation archive

Files here describe earlier redesign phases of the ForgeSense frontend and are
kept **as historical evidence only**.

## Do not use these to understand the current system

They were written against a **vanilla JavaScript frontend** (`frontend/js/*.js`,
`frontend/index.html`) that no longer exists. The console is now React +
TypeScript + Vite under `frontend/src/`. Descriptions of component names, CSS
tokens, module layout, routing and the visual system in this folder are
**stale by design**.

## Why they were archived rather than deleted

- They record the reasoning behind earlier decisions, which is occasionally
  useful context.
- Several contain observations that remain true about the *backend* contract.
- Deleting a project's history is its own kind of loss.

## What replaced them

| Archived | Current |
| --- | --- |
| `UI_UX_ENGINEERING_AUDIT.md`, `UI_UX_AUDIT.md`, `FRONTEND_AUDIT.md`, `FRONTEND_BASELINE.md` | `docs/audit/FRONTEND_REARCHITECTURE_AUDIT.md` |
| `PHASE*`, `VISUAL_UPGRADE_*`, `POST_REBUILD_VERIFICATION.md`, `FINAL_UI_UX_RELEASE_REPORT.md`, `AUDIT_GATE.md`, `IMPLEMENTATION_PLAN.md` | `docs/audit/FINAL_FRONTEND_REDESIGN_REPORT.md` |
| `design/VISUAL_IDENTITY.md`, `design/DESIGN_RESEARCH.md` | `docs/DESIGN_SYSTEM.md`, `docs/UI_UX_GUIDE.md` |
| `AUDIT_RED_FLAGS.md` | `docs/audit/FRONTEND_REARCHITECTURE_AUDIT.md` §3 (verified against code) |
| `REALTIME_AUDIT.md` | `docs/REALTIME_FRONTEND_CONTRACT.md` |
| `API_CONTRACT_AUDIT.md` | `docs/API_FRONTEND_CONTRACT.md` |
| `ACCESSIBILITY_AUDIT.md` | `docs/TESTING.md` §4-5 (now proven by E2E, not asserted) |
| `COMPONENT_BASELINE.md`, `PERF_BASELINE.md` | `docs/FRONTEND_ARCHITECTURE.md` |

## Precedence

> **Current code > current tests > current API contracts > archived documents.**

If an archived document contradicts the code, the code is correct and the
document is simply old.
