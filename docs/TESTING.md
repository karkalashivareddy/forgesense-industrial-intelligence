# Testing

The browser is the product, so browser tests are not an optional extra here.

---

## 1. Layers

| Layer | Tool | Location | What it protects |
| --- | --- | --- | --- |
| Unit | Vitest | `frontend/test/` | unit discipline, state derivation, data basis, protocol framing, envelope validation |
| Type | `tsc --noEmit` | — | contract shape across the whole app, including tests |
| E2E | Playwright | `frontend/e2e/app.spec.ts` | the product: boot, auth, every route, selection, realtime, failure handling, a11y |
| Visual/responsive | Playwright | `frontend/e2e/visual.spec.ts` | layout integrity at 5 breakpoints, mobile nav, twin lifecycle, console/network cleanliness |

---

## 2. Running

```bash
cd frontend
npm ci                # lockfile-pinned
npm run typecheck     # tsc, strict, includes tests
npm test              # vitest run
npm run build         # tsc -b && vite build
npm run e2e           # Playwright, builds + previews automatically
```

Against an already-running stack:

```bash
E2E_BASE_URL=http://localhost:5173 npm run e2e
```

Set `CAPTURE_SCREENSHOTS=true` to write breakpoint screenshots to
`frontend/test-results/visual/`.

---

## 3. Unit tests (66)

### `format.test.ts` — unit discipline
The tests that matter most in the repository, because they encode product
promises rather than implementation detail:

- `formatProbability(0.0006)` is `"0.060%"`, **not** `"0%"`.
  This is the exact failure that produced `failure risk 0%` for a real 0.06%.
- `formatContribution(-0.0069)` uses a real minus sign and **never** contains
  `"%"` — it is a signed delta on model output probability, not a percentage.
- `formatRulSteps()` output **cannot** match `/hour|day|minute|week|month/`.
  There is no other RUL formatter in the codebase.

### `machineState.test.ts` — operational state
- A healthy asset reporting 2 s ago is `NORMAL`.
- An asset silent for 120 s is `STALE`, even though the backend still says
  `NORMAL`. **Staleness is a client concern the backend cannot see.**
- `connectivity: OFFLINE` beats a fresh reading.
- `MAINTENANCE` beats a healthy backend state — otherwise starting a work order
  would snap the asset straight back to `NORMAL`.
- The backend value is always preserved alongside the presentation state.
- Risk bands mirror `DecisionEngine.intent()` so a bar and a state can never
  disagree.

### `basis.test.ts` — data honesty
- `ESTIMATED` maps to `DERIVED`, not `OBSERVED` — it is a modelling output.
- An unrecognised basis string yields `UNAVAILABLE`, never a guess.
- `strongestBasis` prefers the most specific basis in a mixed set.
- `normaliseZoneCode('Machining') === 'MACHINING'`, pinning the verified
  code-vs-name inconsistency between two endpoints.

### `realtime.test.ts` — the protocol boundary
- STOMP framing round-trips, and a frame split across two WebSocket chunks is
  buffered and completed correctly.
- Envelope validation rejects: unknown topic, topic/payload mismatch, bad
  `eventId`, invalid timestamp, invalid sequence, missing `machineId` on a
  machine-scoped topic, non-finite sensor value, non-object payload.
- `deriveConnectionQuality` never returns `LIVE` for a synthetic feed, and
  returns `STALE` for a silent socket.

---

## 4. E2E tests (27)

| Group | Coverage |
| --- | --- |
| Boot & auth | gate renders; **password absent from localStorage, sessionStorage and cookies**; bad credentials rejected; sign-out re-opens the gate |
| Routing | all 12 workspaces on a **direct deep link**; sidebar navigation; unknown path redirects |
| Machine journey | fleet row → inspector → tab switch → close; RUL never rendered as a time unit |
| Realtime | connection label resolves to a truthful value and is **never `LIVE`** for this synthetic deployment; status strip exposes transport, basis and oldest-reading age |
| Resilience | backend aborted mid-session → intentional error state, **no uncaught exception**; ML-down page states reduced confidence rather than fabricating it |
| Accessibility | skip link; landmarks; `Ctrl+K` opens and `Escape` closes the palette; keyboard reaches navigation; reduced motion honoured |

The "no horizontal overflow" and "zero console errors" assertions run on **every**
route test via `expectCleanBrowser()`.

---

## 5. Visual & responsive tests (13)

Eight workspaces × five breakpoints (375, 768, 1024, 1440, 1920).

A screenshot alone is not a check, so each test also asserts:

- `documentElement.scrollWidth <= clientWidth + 1` — no horizontal overflow
- the page heading is visible with a non-zero box at every width
- the twin canvas mounts at a real size, its controls are clickable, and the
  canvas is **removed from the DOM** on navigation (leak check)

Plus mobile bottom navigation, the inspector-as-bottom-sheet geometry, and two
whole-app walks asserting zero console errors, zero page errors, zero failed
requests and zero unexpected 4xx/5xx.

---

## 6. CI gates

`npm run typecheck`, `npm test` and `npm run build` all fail the pipeline on
regression. The E2E job additionally fails on any uncaught browser error or
unexpected failed network request, because those are asserted per test.

Repository hygiene fails on:

- tracked credential defaults
- **`.innerHTML =` or `document.write` in `frontend/src`** — the console renders
  exclusively through React
- **`console.log` / `console.error` in `frontend/src`** — would break the
  zero-console-error criterion
- **any external runtime origin** in the frontend (CDN, Google Fonts) — fonts,
  icons and Three.js must be bundled
- **a missing `frontend/package-lock.json`** — builds must be reproducible

---

## 7. Resource discipline

The suite is deliberately frugal, because CI is a shared resource:

- **1 Playwright worker**, fully parallel off.
- **Video off**; trace `retain-on-failure`; screenshots only on failure.
- One browser instance, contexts closed between tests.
- No simulator container in the E2E stack: the console must render correctly
  with no incoming telemetry, and a live feed would make fleet assertions
  non-deterministic.
- ECharts and Three.js load only for the routes that use them, so most tests
  never download them.

---

## 8. What is not covered

Honest gaps, listed rather than hidden:

- **No cross-browser matrix.** Chromium only. Firefox and WebKit would likely
  surface WebGL and `matchMedia` differences.
- **No WebGL context-loss test.** If the browser drops the GPU context the
  canvas would need a rebuild path; that is not implemented or tested.
- **No visual pixel-diffing.** Assertions are DOM- and geometry-based plus
  captured screenshots. Adding a pixel baseline would make the suite brittle
  against benign font-rendering differences.
- **No load or performance budget test.** Performance properties are designed
  for and documented, but not gated by a measured threshold in CI.
