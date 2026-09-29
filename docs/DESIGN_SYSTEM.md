# ForgeSense Design System

Industrial graphite surfaces, restrained colour, one icon family, and a rule
that colour is never the only carrier of state.

Source of truth: `frontend/src/styles/tokens.css`,
`frontend/src/styles/color.ts` and `frontend/src/design-system/index.tsx`.
There are no one-off colours, radii or spacing values in feature code. A
repo-wide scan for `#hex`, `rgb()` and `hsl()` literals outside `tokens.css`
and `color.ts` returns nothing; `color.ts` holds the only runtime fallbacks,
because ECharts and the Three.js renderer resolve colours in JavaScript where
CSS custom properties are not available.

---

## 1. Palette

The palette is a strict hierarchy, read top-down. Each colour means exactly
one thing:

| Role | Meaning |
| --- | --- |
| Graphite | environment and surfaces; recedes |
| White | information; the value itself |
| Cyan | interaction, live connection, selection |
| Green | healthy operation |
| Amber | attention / warning |
| Red | critical operational condition |
| Violet | ML intelligence, prediction, model output |
| Slate | metadata, derived values, secondary information |
| Warm amber | synthetic / simulation provenance |

Two rules carry most of the weight:

1. **`CRITICAL` and `SYNTHETIC` are different concepts and never look alike.**
   A critical machine is red; a synthetic feed is warm amber. Conflating a
   machine state with data provenance is the most misleading thing this
   console could do.
2. **Provenance and severity are orthogonal axes.** An alert's severity is a
   colour; its lifecycle state is expressed by weight and treatment, never by
   a second competing colour.

### Surfaces

| Token | Value | Use |
| --- | --- | --- |
| `--color-bg-app` | `#0a0d11` | app backdrop, behind everything |
| `--color-bg-panel` | `#10141a` | primary surfaces |
| `--color-bg-panel-elevated` | `#161b22` | raised panels, table headers |
| `--color-bg-panel-hover` / `-active` | `#1b212a` / `#212934` | interaction |
| `--color-bg-inset` | `#070a0e` | wells, code, chart backdrops |
| `--color-bg-overlay` | `#1a2029` | modals, menus, tooltips, the twin HUD |
| `--color-bg-scrim` | `rgba(4,6,9,.72)` | dimming layer behind overlays |

Edges: `--color-border-subtle` `#1c222a`, `--color-border-default` `#273040`,
`--color-border-strong` `#3a4658`, and `--color-border-active` at 55% accent.
Each surface step is a deliberate ~3% lightness increment, so depth reads even
in a flat render.

### Text (contrast measured against `--color-bg-panel`)

| Token | Value | Ratio | Use |
| --- | --- | --- | --- |
| `--color-text-primary` | `#e6ecf3` | 14.8:1 | body, values |
| `--color-text-secondary` | `#a7b4c4` | 7.6:1 | supporting text |
| `--color-text-muted` | `#7b8899` | 4.6:1 | metadata — **at the AA floor, not below** |
| `--color-text-disabled` | `#5a6674` | — | decorative only, never load-bearing |
| `--color-text-on-accent` | `#04212a` | — | for solid cyan fills |

### Semantic state

| Token | Value | Meaning |
| --- | --- | --- |
| `--color-success` | `#34c07d` | healthy operation |
| `--color-warning` | `#e8a93f` | attention required |
| `--color-critical` | `#ef4d55` | critical machine condition |
| `--color-accent` | `#22d3ee` | active, interactive, selected, live |
| `--color-intelligence` | `#9d7bf0` | model output — **reserved exclusively** |
| `--color-maintenance` | `#6f8ff0` | work in progress (an operational state, not a model output) |
| `--color-info` | `#4a9fe0` | neutral informational |
| `--color-derived` | `#7b8899` | metadata, computed values |
| `--color-unavailable` | `#5a6674` | visibly inert |
| `--color-synthetic` | `#c98a52` | provenance disclosure |

Every entry has a `-bg` wash, a `-border` and a `-text` variant that meets AA
on graphite. `--color-synthetic` is deliberately warm, desaturated and lower
contrast than the warning amber: it is a disclosure, not an alarm.

The reserved violet role matters most. A prediction is violet even when its
value is high; the machine *state* is what turns red. An operator should never
have to ask whether a number was measured or inferred.

### State lookup

`--state-*` aliases map semantic state to a colour triple, so a new state can
never pick up a colour that already means something else:

`critical` · `warning` · `ok` · `maint` · `info` · `idle` · `neutral`

### Chart series

`--color-chart-observed` (cyan), `--color-chart-predicted` (violet),
`--color-chart-warning-threshold`, `--color-chart-critical-threshold` and
`--color-chart-baseline` (slate) reuse the UI semantics verbatim, so a legend
and the surrounding interface always agree.

---

## 2. Typography

| Role | Stack |
| --- | --- |
| Sans | Inter (self-hosted variable) |
| Display | Inter Tight |
| Data | JetBrains Mono (self-hosted variable) |

All three are **bundled as `woff2` in `frontend/public/fonts/`** — 124 KB
total, no external font request at runtime. `font-display: swap` prevents
invisible text.

Scale: 11 / 12 / 13 / 14 / 16 / 20 / 26 / 34 / 44 px. Uppercase is reserved
for machine IDs, protocol names, technical codes and small status metadata.
It is never used for body text.

All numeric values use `font-variant-numeric: tabular-nums`, so columns of
numbers align and do not jitter as they update.

---

## 3. Spacing, radii, motion

4 px base scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.

Radii are deliberately tight — this is instrumentation, not a consumer app:
2 / 3 / 5 / 8 px, plus a pill for meters and count badges.

| Token | Duration | Use |
| --- | --- | --- |
| `--dur-fast` | 120 ms | hover, colour |
| `--dur-base` | 200 ms | panel entry, drawer |
| `--dur-slow` | 300 ms | chart interpolation, camera settle |

Easings: `--ease-out` for entrances, `--ease-in-out` for camera, and a
light `--ease-spring` for modal scale only.

`prefers-reduced-motion: reduce` collapses every duration to 0 ms, disables
ambient animation, and makes camera moves snap. State remains fully legible
because it is carried by icon, text and colour.

---

## 4. Data basis — the honesty vocabulary

A first-class design concern, not a footnote. `DATA_BASIS` in
`src/domain/basis.ts` classifies every meaningful number.

| Basis | Label | Meaning |
| --- | --- | --- |
| `OBSERVED` | Observed | read from a system of record |
| `DERIVED` | Derived | computed by the platform from observed values |
| `PREDICTED` | Model predicted | estimated by the ML service; not a measurement |
| `SYNTHETIC` | Synthetic | generated by the simulator; represents no real machine |
| `SIMULATED` | Simulated | produced by the what-if engine under a stated assumption |
| `UNAVAILABLE` | Unavailable | no trustworthy value exists |

Rendered as a `BasisChip` with its own colour and a tooltip carrying the full
definition. The backend's free-form strings map onto this vocabulary in one
function: `SYNTHETIC → SYNTHETIC`, `OBSERVED → OBSERVED`, `ESTIMATED →
DERIVED` (it is a modelling output), anything unrecognised → `UNAVAILABLE`
rather than a guess.

---

## 5. Components

`frontend/src/design-system/index.tsx` exports:

`Button` · `IconButton` · `Badge` · `StatusBadge` · `BasisChip` · `Panel` ·
`SectionHeader` · `Metric` · `HealthIndicator` · `RiskIndicator` · `Tabs` +
`TabPanel` · `Drawer` · `Modal` · `LoadingState` · `EmptyState` ·
`ErrorState` · `StaleBanner` · `Skeleton` · `DataTable` · `Timeline` ·
`ToastViewport` · `Sparkline`

### Non-negotiable rules encoded in the components

- **`StatusBadge` always takes an icon.** A status is icon + text + colour.
  Colour alone never carries meaning.
- **`BasisChip` on any panel mixing observed and modelled data.**
- **`Metric` shows its unit separately from its value**, so `0.06%` can never be
  read as `0.06`.
- **`Drawer` and `Modal` trap focus, restore it on close, and close on
  Escape.** Implemented once in `useFocusTrap`.
- **`Tabs` implement the ARIA tab pattern**: `role="tablist"`, roving
  `tabindex`, arrow/Home/End keys, and a linked `tabpanel`.
- **`DataTable` is a real `<table>`** with `<caption>`, `<th scope>`, and
  `aria-sort`. Interactive rows are focusable and activate on Enter/Space.
- **No `innerHTML` anywhere in `src/`.** Verified by the CI hygiene check.

---

## 6. Iconography

One family: **Lucide React**, bundled locally (no webfont, no CDN). Consistent
16 px in navigation and controls, 12–14 px inline with text, 18–22 px in
empty and error states. Icon stroke width is uniform.

Emoji and inline SVG glyph hacks are not used anywhere.

---

## 7. Motion as state, not decoration

Animation communicates a state change; it never merely entertains.

| Interaction | Motion |
| --- | --- |
| Hover on a row or card | 120 ms surface lift |
| Panel / modal entry | 200 ms fade + 2 px rise; modals add a 3% scale |
| Drawer entry | 200 ms slide; a bottom sheet below 860 px |
| Live value change | tabular numerals prevent width jitter; no flash |
| Status transition | new icon and colour; no pulsing |
| Camera preset | 620 ms eased tween, `easeInOutCubic` |

There is **no infinite animation and no continuous pulse**, critical or
otherwise. A permanently flashing critical badge trains operators to ignore it.

---

## 8. Motion and performance together

Two rules keep the interface calm *and* cheap:

1. Animate `transform` and `opacity`, never `width`, `height` or `top`.
2. `backdrop-filter: blur()` appears only on the twin HUD — a few small,
   static panels. It is never applied to elements that repaint continuously.

The continuous live-data pulse is expressed as a **textual** time-ago readout
plus a status icon, not as a CSS animation on a repainting element.

---

## 9. Accessibility contract

- Contrast: body text ≥ 4.5:1, large text and UI borders ≥ 3:1.
- Every interactive element has an accessible name; icon-only controls carry
  `aria-label` **and** a `title`.
- Focus is always visible: a 2 px teal ring with a 2 px dark offset.
- A skip link is the first focusable element on every page.
- Landmarks: `banner`, `navigation` (labelled), `main`, `contentinfo`.
- Live regions: toasts use `role="status"`; critical toasts use `role="alert"`.
- Tables expose sort state via `aria-sort`; columns hide below breakpoints via
  `data-hide-below` so a narrow table is a shorter table, not a broken one.
