# ForgeSense — Viva / Evaluation Guide

Concise, defensible answers. Every claim here is backed by code you can open or
a measurement recorded in [`audit/FINAL_RELEASE_HARDENING_REPORT.md`](audit/FINAL_RELEASE_HARDENING_REPORT.md).

---

## 1. Architecture

**Why React?**
The console is a dense operational surface — 12 workspaces, a shared machine
selection, a slide-over inspector, live updating panels. That is exactly the
shape declarative rendering handles well: selection lives in one store, and every
workspace reacts. The previous vanilla-ES-module renderer re-implemented
reconciliation by hand and needed `innerHTML` resets. React removed that class
of bug rather than papering over it.

**Why TypeScript?**
The backend's contracts are wide and the wire format is genuinely inconsistent
(see below). Types make the *normalized* frontend model explicit, so an adapter
bug becomes a type error instead of an empty panel. `strict` mode with
`noUncheckedIndexedAccess` is on; tests are included in the typecheck.

**Why TanStack Query?**
Server state has different rules from client state: it is cached, refetched,
deduplicated, retried, and invalidated by mutation. Hand-rolling that produced
the original "one `Promise.all` failure blanks the console" defect. Per-resource
query keys give error isolation structurally — a failing key cannot take down a
sibling panel.

**Why Zustand?**
Only for **UI** state (selection, inspector open, twin mode, toasts). It is
small, has no provider nesting, and does not need the server-state machinery
that would be pure overhead here.

**Why isolate telemetry?**
An 18-asset feed at 5 s is ~3.6 events/second. If that shared state with
everything else, the whole console would re-render continuously. Three
mechanisms isolate it: the transport **coalesces per entity** and dispatches
**once per animation frame**; history is a **bounded 120-point ring kept only
for watched assets**; and subscriptions are **narrow** — `useLiveReading(id)`
selects one asset's value through `useShallow`, so only 3 components in the app
read live data at all. Measured: 2.7 % of one core, zero long tasks, 60 fps.

**Why WebSocket/STOMP?**
The backend already publishes a versioned event envelope with a monotonic
sequence. Reusing it avoids a second, parallel push contract, and STOMP's
`SUBSCRIBE` gives explicit topic control. Critically, the console treats
realtime as the **low-latency path, not the truth** — REST polling at 3 s
remains the authority, so a dropped socket degrades to "slightly staler", never
to "wrong".

**Why Three.js?**
A digital twin needs real 3D (orbit, selection, spatial layout, 20 dependency
edges) — a 2D canvas cannot express it. It is used for one thing and disposed
completely on unmount.

**Why ECharts?**
Standard radar/scatter/histogram work with good defaults and a declarative option
object that suits React. Used for Analytics only; the twin and inspector
sparklines are hand-rolled SVG/canvas because they are simpler and cheaper.

**Why Docker/nginx?**
Reproducibility and supply-chain hygiene. The runtime image is nginx serving a
static bundle — no Node, no dev server, no CDN. `npm ci` against a committed
lockfile means the image rebuilds byte-comparably. The browser loads **zero**
external origins, which is what makes a strict CSP possible.

---

## 2. Systems

**How does telemetry reach the UI?**
Simulator → `POST /api/v1/telemetry/ingest` → event bus (or Kafka
`forge.telemetry.raw`) → `forge.telemetry.normalized` → validate/normalize →
digital twin → ML `/assess` → decision engine. Out to the browser two ways: the
3 s REST snapshot (authority) and STOMP `telemetry.updated` (latency).

**How are realtime updates handled?**
Validate → dedupe by `eventId` (bounded FIFO, 2048) → order by envelope
`sequence` → coalesce per entity (cap 240) → **one dispatch per animation
frame**. Out-of-order or replayed sequences raise a diagnostic that triggers a
**REST reconcile** so client state re-seats on the authority instead of drifting.

**How do you prevent duplicate WebSocket connections?**
Three independent guarantees: the client is a **module-level singleton** keyed
by access token; the session hook is mounted **once above the router**, so route
changes cannot re-run it; and `connect()` returns early if a socket is already
`OPEN`/`CONNECTING`. Verified by instrumenting the `WebSocket` constructor:
**exactly 1** created across 14 route changes, and closed on sign-out.

**How are errors isolated?**
One query key per resource, one `LoadingState`/`ErrorState`/`EmptyState` per
panel, no top-level `Promise.all`. Verified by aborting one endpoint at a time:
killing `/maintenance` left all 18 assets rendering with only that panel in
error. A failure is **never** rendered as an empty success — "there is nothing"
and "the server did not answer" stay distinguishable.

**How does the simulation work?**
Two deliberately separate actions. `POST /simulation/run` is a **what-if**: it
computes modelled impact and changes nothing. `POST /simulation/control`
**injects a parameter into the synthetic generator**, which then emits different
telemetry — propagating through ML into machine state, alerts, and maintenance.
Both are reversible.

**What happens when an asset becomes critical?**
The state machine applies a valid transition → decision engine creates/updates
an alert and may create a maintenance recommendation → impact engine propagates
to dependents → all broadcast on `/topic/**` → the console updates the asset
card, inspector, twin indicator, risk ranking, and priority incidents.

---

## 3. ML

**What does failure risk mean?**
A bare probability from `failure-risk-v2` (gradient boosting), that the asset
will fail within the configured horizon. It is **model output, not a
measurement**, and it carries **no confidence interval**.

**Observed vs predicted?**
- **OBSERVED** — reported for this deployment: sensor values, health, connectivity.
- **DERIVED** — computed from those: operating state, fleet counts.
- **PREDICTED** — model output: `failureRisk`, `anomalyScore`, `rulEstimate`,
  attribution factors. Always violet, always labelled with model version and
  freshness.

**Why are some risks nearly identical?**
All 18 assets genuinely report `0.0006`. This was investigated, not assumed:
raw JSON is full precision; the *same response* carries 8+ distinct anomaly
scores and 2 health scores, so nothing is collapsed in transit; and
`formatProbability(0.00065)` → `0.065%`, so the formatter is not merging values.
`failure-risk-v2` is a **coarse classifier that saturates near zero** for nominal
assets. **The values are preserved and the limitation is documented.**
Manufacturing spread would mean fabricating a safety-adjacent number.
A regression test pins formatter precision so distinct values can never merge.

**What is RUL here?**
A **simulator-relative step count** — "steps remaining before this asset's
synthetic profile would fail". Displayed with the unit `steps`, never converted
to hours or days, because no calibration exists.

**Model limitations?**
No confidence intervals; saturating near zero for nominal assets; trained on
synthetic data, so it has never seen real equipment; attribution factors come
from a baseline-importance method, **not** SHAP, and are labelled as such; RUL
is heuristic, not calibrated. There is also **no ML for alert policy** — that is
a rules engine, deliberately.

---

## 4. Security

**CSP?** `default-src 'self'; script-src 'self'` — **no `unsafe-eval`**,
`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
`form-action 'self'`, with `connect-src` naming only the API origin. Justified
because the app loads **zero** external origins. It was **not** weakened to make
anything work.

> Worth knowing: during release hardening the headers were found **declared but
> never served**. nginx does not inherit `add_header` into a `location` that
> declares one of its own, and every location needed `Cache-Control` — so the
> app shipped with no CSP at all while the config read as protected. Fixed via a
> shared snippet, verified on every path, and the test suite's zero-console-error
> walk now proves the policy is *enforced* rather than merely present.

**X-Frame-Options?** `DENY`, plus `frame-ancestors 'none'` in CSP. Clickjacking
is impossible.

**MIME sniffing?** `X-Content-Type-Options: nosniff`, so a browser cannot
re-interpret a response's type.

**Auth/session?** Bearer JWT held **in memory only** in `api/client.ts` —
never `localStorage`, so XSS cannot exfiltrate it from storage. A `401` clears
the token, raises `SessionExpiredError`, and reopens the gate without retry
loops. Sign-out tears down the WebSocket.

**Unsafe HTML?** **None.** No `innerHTML`, no `dangerouslySetInnerHTML` anywhere
in `src/`. All rendering is React text nodes.

**Dependency / CDN risk?** `three` and `echarts` are npm dependencies, bundled
locally; the 3 woff2 fonts are served from `/fonts`. No CDN, no import map, no
external script. Runtime deps are pinned **exactly** (no `^`), and the image
builds with `npm ci`. A CI hygiene job rejects reintroduction of external
origins.

---

## 5. Performance

**High-frequency telemetry?** Coalesced per entity and dispatched **once per
animation frame**, so an 18-asset storm is a handful of store writes rather
than 18. Only 3 components subscribe to live values, and each selects a single
asset.

**Bounded history?** Yes — 120-point ring per **watched** asset only, plus a
capped dedupe set (2048) and a capped event log (100). Nothing grows unbounded.

**Chart updates?** ECharts is instantiated once per chart and updated via
`setOption`; it is not re-created on data change. Only 3 assets are watched
concurrently, so telemetry charts are small by construction.

**Three.js render loop?** **On demand.** The loop stops scheduling frames when
`needsRender` is false. Verified by wrapping `drawElements`/`drawArrays`:
**0 WebGL draw calls in an 8 s idle window**, including on a second visit.
Render requests are gated on comparable keys, not material readbacks — Three.js
colour-manages on `set`, so `getHex()` comparisons report false change (an
early attempt did exactly that and made things worse).

**WebGL lifecycle?** The scene is created once (empty deps) and disposed on
unmount: ResizeObserver, all DOM listeners, orbit controls, every geometry,
material and texture, the renderer, and the scene graph. `dispose()` is
idempotent. Across Twin → Command → Twin → Fleet → Twin, DOM nodes fall from
3056 to a floor of ~470 and listeners from 619 to ~200 — **no growth**.

**Responsive / backgrounded?** No horizontal overflow at 375/768/1024/1440/1920
across all 12 workspaces (60 combinations, asserted in CI). When the tab is
hidden the WebSocket disconnects entirely, `useNow` timers stop, and the twin
skips GPU work.

---

## 6. What this project does NOT claim

State these plainly; they are real and documented in
[`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md).

- **No physical machine control.** No OPC-UA, no MQTT, no fieldbus driver, no
  write path to any device. "Inject scenario" means *change a synthetic
  generator's parameters*.
- **No real factory data.** The feed is simulated, and the models were trained
  on that simulation. Nothing here is validated against real equipment.
- **No accuracy guarantee.** No confidence intervals; risk saturates near zero
  for nominal assets; RUL is a simulator step count, not calibrated life.
- **Not a full CMMS.** The lifecycle is the backend's five states. No
  inventory, work-order history, or vendor management.
- **No multi-tenancy, no RBAC beyond three fixed roles**, no SSO/OIDC.
- **Single-node topology only.** Kafka partitioning, WebSocket scale-out and
  time-series storage are documented as future work, not implemented.
- **`/analytics/health-trends` is a snapshot, not a time series**, despite the
  name — so the console renders a distribution instead of inventing a trend.
- **Twin geometry is representative**, not surveyed plant models.
- **Not a safety system.** No SIL/PL rating, no interlock, no fail-safe design.
