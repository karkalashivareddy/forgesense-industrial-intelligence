# UI/UX Engineering Audit — ForgeSense Industrial Intelligence

**Date:** 2026-09-20
**Scope:** Complete UI/UX and security-engineering audit of the current worktree
**Method:** Direct repository inspection, targeted static tracing, prior audits (FRONTEND_AUDIT, UI_UX_AUDIT, REALTIME_AUDIT, PERF_BASELINE, POST_REBUILD_VERIFICATION), CDP harness design (`tools/visual-qa/qa_final.mjs`), and unit-test inventory.
**Constraint:** No implementation code was changed during this audit.
**Classification:** CRITICAL / HIGH / MEDIUM / LOW / COSMETIC — plus `BLOCKED — reason` where a claim cannot be verified in this environment.

**Overall status:** Merits an implementation pass. The core product is functional and largely faithful to its own contracts; the remaining work is disciplined hardening (auth gate, session handling, token consolidation, responsive execution, a11y completion) plus runtime verification of live behavior.

---

## A. Audit scope, method, environment

| Item | Detail |
|------|--------|
| Stack | Static vanilla ES-module frontend (Three.js import map); Spring Boot 4 backend; FastAPI ML; synthetic simulator |
| Routes | `factory, command, fleet, telemetry, anomalies, alerts, events, predictions, simulation, maintenance, analytics, system` |
| Environment | Node v24.19.0, Python 3.14.6, Java 25 (2025-09-16 LTS), Docker 29.7.2 available; local `.env` present (gitignored) |
| Runtime availability | Backend/ML/simulator were **not** started during this audit pass; runtime claims are marked `BLOCKED` unless traced to code |
| Prior context | Rebuild/redesign work and audits dated 2026-09-18 (REDESIGN_SCOPE, VISUAL_IDENTITY, POST_REBUILD_VERIFICATION) referenced; deltas verified against the current tree |

**What changed since POST_REBUILD_VERIFICATION (2026-09-18) — verified in-tree:**

1. **STOMP authentication bridge added.** `backend/.../websocket/StompAuthenticationInterceptor.java` (`ChannelInterceptor`) authenticates the JWT from the native STOMP `CONNECT` header, restores identity from session attributes for later frames, and rejects unauthenticated `SUBSCRIBE`/`SEND`. Registered alongside `SecurityContextChannelInterceptor` in `WebSocketConfig.configureClientInboundChannel` (`WebSocketConfig.java:33`). Covered by `StompAuthenticationInterceptorTest.java`. → closes prior P0 #1.
2. **WebSocket origin fallback hardened.** `WebSocketConfig.registerStompEndpoints` (`WebSocketConfig.java:44-45`) now falls back to `http://localhost:5173, http://127.0.0.1:5173` instead of `*`. → closes prior P2 #4.
3. **Dead architecture layers removed.** `frontend/js/signals.js`, `state.v2.js`, `overlay.js` no longer exist in `frontend/js/` → closes prior P1 #1 and dead-code finding.
4. **Statusbar label corrected.** `index.html:124` labels the unhealthy service "Transport" (id `svcKafka` remains), no longer mislabeling it "Kafka". → closes dead-UI note.
5. **Inspector dialog semantics strengthened.** `index.html:108` now marks the inspector `aria-modal="true"` (previously `aria-modal="false"`).

---

## B. Credential & secret handling

| # | Finding | Classification |
|---|---------|----------------|
| B1 | Backend enforces an explicit JWT secret via `FORGESENSE_SECURITY_JWT_SECRET`; in demo mode `JwtService` generates a random key; outside demo the app refuses to boot without a configured secret. Sound baseline. | INFO (RESOLVED) |
| B2 | CI hygiene job (`ci.yml`) greps tracked files for known development credential-default literals (development device password, development JWT signing-key, development demo password, and a development-environment password phrase) and fails on a tracked `.env`. Verified present. | INFO (PASS) |
| B3 | Local `.env` (gitignored) contains a fixed demo JWT secret and `FORGESENSE_DEV_PASSWORD`. Acceptable for local dev; must never be tracked. The tracked `.env.example` must remain placeholder-only. | LOW |
| B4 | No committed API key/database password found in the inspected configuration. | INFO (PASS) |
| B5 | Frontend keeps the JWT in a module variable (`api.js:3-4`), not `localStorage`/cookies → XSS surface reduced. | INFO (PASS) |

---

## C. Authentication flow & session lifecycle

| # | Finding | Classification |
|---|---------|----------------|
| C1 | **Plaintext credential held in memory + automated candidate relogin.** `api.js:39` `credential = { user, pass }`; `api.js:43-53` `relogin()` silently attempts `[credential.user, username, 'operator', 'engineer', 'admin']` with the stored password on every 401. This is an implicit credential sweep: a user who logs in as `operator` gets re-authenticated as `engineer`/`admin` if their password matches, with **no user notification and no role re-confirmation**. | **CRITICAL** |
| C2 | No logout/sign-out affordance anywhere in the shell (index.html, app.js). A control-room app shared across shifts has no way to clear an active session. | **HIGH** |
| C3 | No explicit session-expiry UI. JWT default `jwt-expiration: 86400` (24 h); expiration surfaces only as a silent 401 → `relogin()` path (C1). | **HIGH** |
| C4 | Login is a dynamically injected overlay (`app.js:43-70` `showLogin`), built from unlabeled `div`/`input`/`button` — **not a `<form>`**, no `autocomplete="current-password"` control, error signalled only by a red border (color-only, see Q). Enter key works for the password field only; no keyboard path from username select. | MEDIUM |
| C5 | The dashboard shell (topbar, rail, statusbar, brand) is rendered **behind** the login overlay before authentication (`index.html` static shell + `app.js` `bootLogin` gates only the dynamic boot). Identifiable product content is visible pre-login; acceptable for a demo but not a true gate. | MEDIUM |
| C6 | Digest: user/roles panel updates via `topbar()`/`userChip` after `set({ user, roles })`; role-based UI gating exists (e.g. maintenance `canEdit` ENGINEER). Good pattern, but it depends on C1 (roles can silently escalate). | HIGH (inherits C1) |
| C7 | `API_BASE` is overridable per-user via `localStorage 'forgesense.api'` (`api.js:1`). Acceptable for local demo; not a trusted production config source. | LOW |

---

## D. API / authorization enforcement

| # | Finding | Classification |
|---|---------|----------------|
| D1 | Backend `SecurityConfig` gates non-public routes; stateless JWT via `JwtAuthFilter`; RBAC via method security; personas `operator`/`engineer`/`admin`. Matches frontend expectations. | INFO (PASS) |
| D2 | `AuthController` throttles failed logins (`MAX_FAILED_ATTEMPTS = 5`, `LOCKOUT_MILLIS = 5 * 60_000`) — verified in earlier audit pass (auth-protocol untouched since). | INFO (PASS) |
| D3 | Auth endpoints traced against frontend consumers (`api.js login/post`, `state` refresh, `realtime` tokenProvider): contract alignment PASS (from API_CONTRACT_AUDIT + current reads). | INFO (PASS) |
| D4 | Frontend mutation endpoints (`alerts`, `maintenance`, `simulation`, `impact`) lack consistent user-facing error handling on failure; some rejections can escape as unhandled promises. | MEDIUM |

---

## E. WebSocket / STOMP transport security

| # | Finding | Classification |
|---|---------|----------------|
| E1 | `StompAuthenticationInterceptor.preSend` (`StompAuthenticationInterceptor.java:34-69`): CONNECT authenticates JWT from native `Authorization` header; session user restored for subsequent frames; `SUBSCRIBE`/`SEND` without a user throw `MessageDeliveryException`. Security bypassable when `FORGESENSE_SECURITY_ENABLED=false` (dev/CI profile) — intended. | INFO (PASS, code-verified) |
| E2 | `WebSocketConfig` endpoint set `{/ws, /ws/telemetry}`, simple broker `/topic`, app prefix `/app`; origin fallback is the localhost:5173 safe-list (not `*`). | INFO (PASS) |
| E3 | `frontend/js/realtime.js` sends the JWT in the STOMP CONNECT frame (`tokenProvider`), heartbeat 10 s, exponential reconnect capped at 30 s, `MAX_PENDING=240` coalescing, `MAX_DISCRETE=1024`. | INFO (PASS, code-verified) |
| E4 | Event ordering IS guarded: `state.js:85` rejects duplicate `eventId`; `state.js:87-88` rejects stale `sequence`/`timestamp` per topic+entity cursor (`realtimeCursors`). Remaining gap: a skipped sequence is not detected, so a missed delta still waits for the next REST snapshot (no explicit reconnect → immediate `refreshCore`). | MEDIUM |
| E5 | STOMP `ERROR` frame handling (`realtime.js:213-218`) rejects the connect promise and closes the socket, which triggers the reconnect scheduler; subscriptions are re-subscribed on the next `CONNECTED`. Residual: an in-session broker `ERROR` is not surfaced as a user-visible transport failure. | LOW |
| E6 | Live behavior (secured CONNECT handshake, subscription, event flow against a running backend) **not executed** in this pass. | `BLOCKED — backend runtime not started` |

---

## F. Data / telemetry fidelity & synthetic labelling

| # | Finding | Classification |
|---|---------|----------------|
| F1 | Synthetic-data boundary is explicit and pervasive: footer disclaimer (`index.html:130`), rail badge "·synthetic demo·" (`index.html:64`), transport badge states (SYNCING/DEGRADED/REST FALLBACK), `SIMULATED` basis in statusbar, "visualization only, no physical control" sim banner. | INFO (PASS) |
| F2 | No fabricated live numbers were found: KPIs render from backend `store` fields with empty/`—` guards (verified in views). | INFO (PASS) |
| F3 | ML fallback is honest: `MODEL` vs `HEURISTIC` labeled in predictions; RUL is labeled synthetic `steps`, not physical remaining life; mismatched ML model versions surface in the UI rather than being rejected. | INFO (PASS) |
| F4 | With ordering guarded (E4), delta fidelity is bound to the REST snapshot authority; the remaining gap is gap/missed-delta detection rather than ordering. | MEDIUM (inherits E4) |

---

## G. Information architecture & routes

| # | Finding | Classification |
|---|---------|----------------|
| G1 | 12 registers routes + hash router; all `app.js`-registered views map to static `index.html` sections (no dynamic route bodies missing). | INFO (PASS) |
| G2 | Number shortcuts (`app.js:231` `ROUTE_KEYS`) cover only 9 of 12 routes; `anomalies`, `events`, `simulation` are not on 1-9. Synced with the 1–9 help text in `SHORTCUTS` (`app.js:27-33`), so it is consistent — but the shortcut list omits three reachable sections from the header help. | COSMETIC |
| G3 | Prior gap: no top-level `telemetry`/`anomalies`/`events` routes — now resolved; telemetry/anomalies/events are dedicated sections. | INFO (RESOLVED) |
| G4 | Routes render sections for `simulation` and `anomalies` that are thin (single-panel KPIs) relative to command/fleet; acceptable scope, flag for polish. | LOW |

---

## H. Design token system

| # | Finding | Classification |
|---|---------|----------------|
| H1 | `css/tokens.css` implements the binding identity from `VISUAL_IDENTITY.md` ("Graphite, Copper, Precision, Depth, Signal", dark-mode only): `--color-*` core (bg/surface/border/copper/amber/emerald/crimson/cyan), semantic status mapping (color+icon+text), 8-color `--viz-*` categorical set, dark-mode-only, reduced-motion hook. Header comment "Generated from VISUAL_IDENTITY.md — DO NOT EDIT MANUALLY" present. | INFO (PASS) |
| H2 | **Mixed token namespaces.** `css/components.css`, `base.css`, and `views.css` reference legacy props (`--panel`, `--border`, `--muted`, `--fs-11`, `--sp3`, `--glass-bg`, `--glass-border`, `--radius`, `--accent`) alongside the new `--color-*`/spacing tokens. Two parallel systems could drift. | **MEDIUM** |
| H3 | Contrast/usage documented per token (copper 5.8:1, amber 6.8:1, etc.); composite labels (`twin-assets`, HUD glass) rely on `rgba` overrides not represented in tokens. | LOW |

---

## I. App shell & navigation

| # | Finding | Classification |
|---|---------|----------------|
| I1 | Static shell is semantic: `header[role=banner]`, `nav[aria-label]`, `main#workspace`, `aside[role=dialog]`, `footer[role=contentinfo]`, per-section `.view` containers. | INFO (PASS) |
| I2 | Mobile hamburger (`#mobileNavToggle`, `aria-expanded` + mobile drawer rules at ≤760px) exists statically; execution at mobile viewports is **not** runtime-verified. | `BLOCKED — no mobile runtime in this pass` |
| I3 | Topbar conveys transport/freshness/ML/roles and supports `aria-pressed` risk-mode toggle — good state discipline. | INFO (PASS) |
| I4 | Rail has 12 items + footer links; no collapse → expanded drawer on desktop; visual L/R rail width fixed (`--rail-width` per identity). Shell remains card/SaaS-like on secondary views (see REDESIGN_SCOPE VISUAL REDESIGN items). | LOW |

---

## J. Login / onboarding UX

| # | Finding | Classification |
|---|---------|----------------|
| J1 | Overlay pattern (C4/C5) is functionally reachable (focus lands on password), but is a wall-over-shell, not a dedicated gate; no brand/status context, no password managers, no session guidance. | MEDIUM |
| J2 | Dev-user affordance is good: `select#loginUser` with operator/engineer/admin + helper text referencing `FORGESENSE_DEV_PASSWORD` prevents guessing. | INFO (PASS) |
| J3 | No loading/feedback state during `login()` (button does not disable; double-submit possible); failure only colors the border. | LOW |

---

## K. Command center view

| # | Finding | Classification |
|---|---------|----------------|
| K1 | `/command` computes live-derived fleet KPIs, situation (OUTAGE/ATTENTION/OPERATIONAL), zones, production impact, and the telemetry→ML→state→alert→impact→maintenance chain; loads zones from `/api/v1/zones`; empty-safe. | INFO (PASS) |
| K2 | Twin-centrality scorecard: twin is a separate `factory` route; command screen links to it rather than embedding it (> REDESIGN_SCOPE Phase 2/3 target). | LOW (agreed scope) |
| K3 | `topbar()`/`statusbar()` drive live transport states (LIVE·STOMP / DEGRADED / REST FALLBACK with age). | INFO (PASS) |

---

## L. Digital twin (factory) view

| # | Finding | Classification |
|---|---------|----------------|
| L1 | `twin3d.js` — procedural machines/zone slabs/dependency lines/labels, selection → inspector, camera focus/top/reset, health-color emissives, risk-mode overlay, simulation highlight; reconciliation in `updateMachines()`, cleanup in `disposeTwin()`. | INFO (PASS, code-verified) |
| L2 | Pointer-only selection; machines not reachable by keyboard; the scene is `role="img"` (`index.html:70`) with a generic label and a separate asset list for keyboard access (`#twinAssetList`). Keyboard parity is partial. | **HIGH** |
| L3 | Continuous `requestAnimationFrame` render loop with DPR adaptation (<44 FPS lowers DPR) but **no instancing, LOD, or frustum culling**; 500-machine target unverified. | MEDIUM |
| L4 | Runtime 3D behavior (render perf, selection, camera) not browser-verified in this pass. | `BLOCKED — no browser runtime` |

---

## M. Inspector drawer

| # | Finding | Classification |
|---|---------|----------------|
| M1 | Declared `role="dialog"` `aria-modal="true"` labelled `aria-labelledby="inspTitle"` (`index.html:108`); `isOpen()`/`openInspector()` manage `collapsed` class + `aria-hidden`; focus restore on close (code-verified in `inspector.js` early reads). | INFO (PARTIAL) |
| M2 | **No focus trap.** Tab can escape the modal to the background shell; `aria-modal` claims modal semantics that are not enforced. | **HIGH** |
| M3 | 8 tabs (overview/telemetry/prediction/explanation/dependencies/events/impact/maintenance) with ranges 5m/15m/6h; telemetry charts via `charts.js` (DPR cap 2). Functional but heavy on re-fetch; no live delta buffer. | LOW |
| M4 | Drawer overlap/behavior at tablet/mobile widths is statically specified (full-width bottom-sheet) not runtime-verified. | `BLOCKED — no mobile runtime` |

---

## N. Fleet / telemetry / alerts / events views

| # | Finding | Classification |
|---|---------|----------------|
| N1 | Fleet: search + status/zone filters + sort + row→inspector; accessible chips (icon+text) per identity. Good. | INFO (PASS) |
| N2 | Alerts: severity lanes + lifecycle actions (ACKNOWLEDGE/INVESTIGATING/RESOLVED) + KPI cards; mutation error paths inconsistent (D4). | MEDIUM |
| N3 | Telemetry view + events view are live-fed from state (`applyRealtimeEvent`); counters and transport badge surface in topbar. Dense tables use `overflow-x:auto`. | INFO (PASS) |
| N4 | Events dedup on `eventId` (`state.js:133`); alerts dedupe on `payload.id`/`eventId` (`state.js:123-125`). Reconnect duplicates handled; no persistent cross-reload identity (acceptable for a control session). | INFO (PASS) |

---

## O. Predictions / anomalies / simulation / maintenance / analytics / system

| # | Finding | Classification |
|---|---------|----------------|
| O1 | Predictions: ranked risk (failureRisk desc), `MODEL`/`HEURISTIC` labeling, explanation cache; honest synthetic RUL. | INFO (PASS) |
| O2 | Maintenance: RBAC-gated (ENGINEER can edit), full lifecycle + inspector workflow; mutation errors inconsistent (D4). | MEDIUM |
| O3 | Simulation: scenario/control/config polling to `/api/v1/simulation/*` and `/api/v1/simulator/config`, global banner + twin highlight; clearly "visualization only, no physical control". | INFO (PASS) |
| O4 | Analytics: backend overview/risk/health/event/maintenance panels; predominantly bar/KPI (chart series underused); `dataBasis` shown. | LOW |
| O5 | System: `/actuator/health` + ML availability/model version/demo flag/transport/backends; no audit-log surface. | LOW |

---

## P. Responsive & mobile behavior

| # | Finding | Classification |
|---|---------|----------------|
| P1 | Breakpoints (760px nav/inspector, 600px grids) and touch-sized buttons are statically present; `html { overflow-x:hidden }`. | INFO (PASS, static) |
| P2 | No viewport execution (375/768/1024/1440+) happened in this pass; the CDP harness (`tools/visual-qa/qa_final.mjs`, 5 viewport classes) is ready to close this gap in Phase 19. | `BLOCKED — no viewport runtime` |
| P3 | QA harness needs `QA_PASS` (dev seed credentials) and a running backend to be meaningful end-to-end. | `BLOCKED — backend + QA_PASS env` |

---

## Q. Accessibility

| # | Finding | Classification |
|---|---------|----------------|
| Q1 | Baseline strong: `lang`, landmarks, labels/aria-labels, `aria-live` toast/sim banner, `:focus-visible` ring, `prefers-reduced-motion`, color+icon+text status chips, focus restore in inspector. | INFO (PASS) |
| Q2 | Focus trap missing in inspector + palette (`command.js` active; `overlay.js` trap removed with dead code). | **HIGH** |
| Q3 | Login failure signaled by color only (red border, `app.js:53,65`) → WCAG 1.4.1 fail; no `aria-invalid`/message text. | **HIGH** |
| Q4 | 3D twin text alternative is a generic scene label + asset list; per-machine telemetry/status not keyboard-reachable from the scene. | **HIGH** |
| Q5 | Dynamic realtime updates are not announced beyond the toast; machine/status changes rely on visual only. | MEDIUM |
| Q6 | Custom clickable rows/chips rely on pointer handlers; several lack `role="button"`/keyboard handlers. | MEDIUM |
| Q7 | No full-page `aria-live` region for login status/large updates; screen-reader end-to-end verification not executed. | `BLOCKED — no SR runtime` |

---

## R. Performance

| # | Finding | Classification |
|---|---------|----------------|
| R1 | Polling `POLL_MS=3000` REST snapshot + coalesced STOMP deltas (`MAX_PENDING=240`, rAF flush) is a sane hybrid; freshness shown in topbar. | INFO (PASS) |
| R2 | **No bundler/minifier/module graph**; Three.js 0.169 + Fonts (Google) + Phosphor (jsDelivr) via CDN, **no SRI**. Startup depends on 3 external hosts; offline/PWA not possible. | **HIGH** (supply chain + startup) |
| R3 | `twin3d` per-machine Mesh/Material without instancing/LOD/culling (L3); continuous rAF. | MEDIUM |
| R4 | Full-store broadcast to all subscribers; views self-guard with references; no measurement budgets (device memory/DOM) enforced. | MEDIUM |
| R5 | No bundle-size/FPS/LCP budgets asserted — nothing was measured this pass. | `BLOCKED — no browser profiler` |

---

## S. Frontend engineering health

| # | Finding | Classification |
|---|---------|----------------|
| S1 | Unit tests: `frontend/test/util.test.mjs` (statusInfo/fleetSummary/freshness) + `frontend/test/realtime.test.mjs` (STOMP adapter) — `node --test` runs green in prior pass. | INFO (PASS) |
| S2 | Backend tests incl. `StompAuthenticationInterceptorTest` (7 suites, 49 tests in prior surefire report) and ML `test_api.py` (8) all green. | INFO (PASS) |
| S3 | No frontend lint/typecheck/build scripts or browser interaction suite outside the CDP QA harness. | MEDIUM |
| S4 | `console.error` in realtime catch path not routed through a logging policy. | LOW |
| S5 | `innerHTML` used for view containers; dynamic strings generally pass through `esc()` (POST_REBUILD confirms) — surface requires discipline. | LOW |
| S6 | `_qa/` output dir does not exist yet (harness output will populate it in Phase 19). | INFO |

---

## T. Findings summary & remediation map

**Counts:** CRITICAL 1 · HIGH 9 · MEDIUM 15 · LOW 12 · COSMETIC 1 · BLOCKED/untested 8.

| Priority | Theme | Items to address in phases |
|----------|-------|-----------------------------|
| P0 (PHASE 3/6) | Auth gate rework | C1 (remove candidate relogin + plaintext credential), C2 logout, C3 expiry UI, C4 real `<form>` + feedback, Q3 failure messaging, J3 loading state |
| P1 (PHASE 18) | Realtime gap detection | E4, F4 — detect skipped sequences and trigger an immediate snapshot on reconnect |
| P1 (PHASE 15) | Accessibility completion | M2/Q2 focus traps (inspector + palette), Q4 twin keyboard alternative, Q5 live announcements, Q6 semantic click handlers |
| P1 (PHASE 4) | Token consolidation | H2 single token source; H3 move glass/viz into tokens |
| P1 (PHASE 14) | Responsive execution | I2, M4, P2, P3 via CDP harness at 375/768/1024/1440 |
| P2 (PHASE 16) | Performance | L3/R2 (instancing/LOD; self-host/SRI), R4 budgets |
| P2 (PHASE 20) | Final report | Re-run every `BLOCKED` item against a live stack before `FINAL_UI_UX_RELEASE_REPORT.md`; never claim PASS without evidence |

**Do-not-undo (preserve):** JWT stateless auth + RBAC (D1/D2), STOMP CONNECT auth interceptor (E1/E2), REST-snapshot authority + freshness topbar (K3/R1), synthetic-demo labeling (F1/F3), dark graphite/copper identity (H1), vanilla modular stack (REDESIGN_SCOPE constraints).

**Governance:** The implementation phases (3–20) will land in the mandated order with conventional commits; each phase records its own verification, and unverifiable claims are marked `BLOCKED — reason` rather than PASS.

---

## Implementation log — resolved during later phases

| Phase | Finding | Resolution | Verification |
|-------|---------|------------|--------------|
| 3 | C1 (credential sweep) | `api.js` rewritten: `credential` removed, candidate `relogin()` removed; 401 now clears the session once and raises `SessionExpiredError`; `clearSession`/`logout`/`onAuthRequired` added. `app.js` re-opens the sign-in gate on expiry and restarts live transport only after explicit re-login. | `frontend/test/api.test.mjs` 4 tests — session cleared on single 401 (no retry), logout notifies once. 31/31 tests green; `node --check` on all 23 modules OK. |
| 4 | H2 (token namespaces) | Canonical derived tokens added (`--color-accent-dim`, `--color-*-dim` set, `--color-overlay`, `--glow-*`, micro `--text-10..15`); `components.css`/`views.css` migrated off the deprecated alias bridge; legacy alias block deleted from `tokens.css`; duplicate accessibility block removed from `base.css`. | Brace balance OK in all 4 CSS files; exact-string scan shows no legacy `var()` refs remain; `--fs-15` (previously undefined) now resolves via `--text-15`. |
| 5–15 | App shell + auth + service views (C2/C3/C4, D, P0) | `index.html` rail-foot "Sign out" button wired through `router.js` (`forge:action:logout`) and `app.js` `guardSession` reset; login rebuilt as a real `<form>` (`components.css` login-overlay/card/field/error styling, `role=dialog`, `aria-modal`, labelled fields, `autocomplete`, busy/disabled submit, `role=alert` error, Enter-to-submit, `--z-modal` for overlay). Live transport (STOMP), machine inspector (tabs, grid, sparkline, twin payloads), system view (status/health/data-basis), charts (line/histogram/gauge/radial bar) built out. | `frontend/test/*` suites green (31/31 + added cases); `node --check` on all modules OK; unit smoke on chart metrics (attribute/id/units/legends); log entries for discoverability probes recorded per phase. |
| 16 | Individual fixing after Phase 9 run (pointer/keyboard parity, live regions, label accuracy) | Survey results checked against current code — most items were already implemented: clickable rows keyboard-activatable across `fleet`/`predictions`/`simulation`/`command`/`analytics`/`alerts`/`telemetry`/`anomalies`, `aria-selected` tabs in inspector, candidate-relogin-free `api.js`, `telemetry` `update()` ref includes `liveTransport.state`, `events` label is "X of Y retained events". Remaining fixes applied: `<div class="topbar-status">` is no longer a container live region — `role="status"` moved to the `#sysStatus` pill so only meaningful transport changes are announced (clock/throughput no longer spam the region). | `node --check` on all touched modules; comparisons against per-view source confirmed survey claims already satisfied either here or during phases 3–15. |
| 17 | Visual/design-token hygiene + dead code + accessibility of interactive controls | `charts.js`: dead `drawSpark` (single-use, superseded by inspector sparkline) removed; `COLORS` and line-chart font/axis/grid/threshold now resolve from `tokens.css` via `token()`/`TOKEN_MONO`/`TOKEN_MUTED`/`TOKEN_GRID`/`TOKEN_THRESHOLD` with hex fallbacks. `fleet.js`: `sortLabel` → real `<button>` inside `<th>` with `aria-sort`, search `aria-label`, `activate()` dead `.loading` branch removed, interactive rows `tabindex` + Enter/Space. `analytics.js`: `stat()` inline hex map → `var(--color-*)`; risk/health rows keyboard-activatable. CSS: z-index litter (`4/5/6/80`) → `--z-dropdown`/`--z-drawer`/`--z-toast`; `var(--border-strong, #2c3a4d)` stale fallbacks → `var(--color-border-strong)`; leftover hexes (`#8fa0b8`/`#9fb0c4`/`#ffb3aa`) → text/crimson tokens; icon `font-size: 14/15/16/18px` → `--icon-*` tokens; `.dep-*` dead CSS removed; toolbar search goes full-width ≤600px. `robots.txt` added (disallow `/api/`). | `node --check` on `charts.js`/`fleet.js`/`analytics.js` OK; no `drawSpark`/legacy-`var(` references remain; brace balance maintained; tokens `--z-toast`/`--icon-sm`/`--icon-md`/`--text-13` confirmed present. |
| 18 | Realtime gap detection (E4, F4) | Reconnect → immediate snapshot was already present (`app.js` `onState('open') → refreshCore()`), so missed deltas after a drop no longer wait for the next 3 s poll. Added in-session skipped-sequence detection in `state.js` `applyRealtimeEvent`: the STOMP envelope `sequence` is a single-producer, per-process monotonic counter (`WsNotifier.sequence` verified in backend source), and client coalescing preserves that global order at delivery — so a delivered sequence that regresses while the transport is up is a genuine discontinuity. That now raises `requestReconcile('sequence-regression')`, a coalesced and throttled (≥1 s) immediate `refreshCore()` (`requestReconcile`, `store.reconcilePending/reconcileReason/reconcileCount/lastReconcileAt/lastGlobalSeq`). Backend envelope study confirmed per-machine telemetry sequence lives in `payload.sequence` but coalescing makes per-entity gap thresholds noisy — deliberately not used; global-order regression is noise-free. | `frontend/test/state.test.mjs` 5 tests — monotonic stream does not reconcile, regression schedules exactly one reconcile with reason, duplicate `eventId` replay triggers none, concurrent callers coalesce to a single refresh, throttle window blocks. 36/36 tests green; `node --check` on all modules OK. |
| 19 | Viewport QA via CDP harness (I2/M4/P2, responsive + twin + runtime) | `tools/visual-qa/qa_final.mjs` re-run at 375/768/1024/1440/1920. Two real defects found and fixed: (1) `predictions.js` imported `riskPill` from `shared.js`, which does not export it — a boot-blocking `SyntaxError` (stale import from an earlier refactor); (2) `factoryView.update()` only re-rendered `#zoneChips` when the machine-status signature changed, so chips stayed empty if zones arrived after mount — the change ref now includes zone codes, so chips re-render when zones load/change. A third issue was environmental: the live backend had a stale dev H2 DB seeded with the old 8-machine/4-zone catalog (`DataSeeder` skips when the machine table is non-empty), while `config/machine_profiles.json` defines the authoritative 18 machines / 6 zones; deleting `backend/data/forgesense-dev.mv.db` and restarting `spring-boot:run` reseeded the full fleet. | `node --check` on `factoryView.js`/`predictions.js`; 36/36 tests still green. CDP run: all 5 viewports `PASS` on `boot`/`layout`/`twin`/`runtime` — `hScroll=false`, rail width sane, `assets=18`, `chips=6`, basis `LIVE · STOMP`, machine select opens inspector with meter, `unexpectedConsole=0`; screenshots under `_qa/`. Backend health UP after reseed. |
| 20 | Final report (re-run `BLOCKED` items live) | Viewport/responsive + realtime + twin + login-gate `BLOCKED` items were re-verified against the live stack this phase: CDP run passes (above), realtime gap detection unit-tested (Phase 18), login gate exercised end-to-end by the harness (`role=dialog` overlay, submit, expiry not hit). Items that remain genuinely unverifiable here are re-marked `BLOCKED — no screen-reader runtime` (Q7) and `BLOCKED — no bundle/FPS profiler` (R5); no un-evidenced PASS is claimed. | `FINAL_UI_UX_RELEASE_REPORT.md` produced from this log + harness artifacts; see that report for the full gate matrix. |