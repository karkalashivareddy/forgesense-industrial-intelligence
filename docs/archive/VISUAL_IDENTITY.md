# Visual Identity — ForgeSense Industrial Intelligence

**Date:** 2026-09-21 (Phase 21 revision)
**Phase:** Visual Re-architecture
**Status:** Implemented — binding visual language for the frontend
**Supersedes:** 2026-09-18 "Precision in the Dark" (copper/dark-SCADA)

---

## 1. Core Concept: "Industrial Precision / Calm Intelligence"

A control room is not an arcade. The previous copper-on-black design was visually loud —
auto-playing colour-cycling arcs on every asset, zone ramps in five hues, giant selection rings —
and it read as *noise*, not *signal*. The re-architecture inverts that: **the plant stays quiet
graphite and steel; only meaning emits colour.**

**Keywords:** Cool steel, Calm, Precision, Spectral restraint, Quiet competence

**The 70/20/10 rule:** ~70% of the screen is neutral graphite/steel, ~20% is the brand family
(still mostly neutral steel-blue), and ≤10% is semantic colour reserved strictly for state.

**Sentence case everywhere** (uppercase is reserved for machine IDs, codes, and raw signal names).

---

## 2. Colour Palette

### 2.1 Neutral Surface Ramp — the "70"

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-0` | `#070d15` | App background |
| `--bg-1` | `#0a121b` | Page region / text area |
| `--surface-1` | `#0e1a26` | Cards, panels, drawers |
| `--surface-2` | `#132330` | Elevated cards, hover |
| `--surface-3` | `#1a2c3a` | Modals, popovers |

Borders step quietly: `rgba(150,182,208,0.07) → 0.12 → 0.22` (hairline → subtle → strong).

### 2.2 Brand Family — the "20"

| Token | Hex | Usage |
|-------|-----|-------|
| `--brand` | `#4fa7ff` | Primary actions, active rail, focus, selection ring |
| `--brand-2` | `#6bb9ff` | Hover / active accent |
| `--teal` | `#19c9a6` | Positive flow / OK in the twin |
| `--violet-ai` | `#8f8af8` | ML / predictions accent (sparingly) |

### 2.3 Semantic Status — the "10"

| Token | Hex | Usage |
|-------|-----|-------|
| `--good` / `--color-emerald` | `#35c98f` | Normal / operational |
| `--warn` / `--color-amber` | `#e7a83b` | Warning / degraded |
| `--critical` / `--color-crimson` | `#f06a74` | Critical / error |
| `--maint` / `--color-cyan` | `#45c7e8` | Maintenance / recovery |
| `--info` / `--brand` | `#63b3ff` | Information |
| `--down` | `#5a6b7e` | Offline / unknown |

Text triad: `--text-1 #e7eef6` (primary), `--text-2 #a6b8ca` (secondary), `--text-3 #6e8094` (faint/metadata).

**Rule:** amber, red and emerald appear *only* for real state changes — never decoratively.

### 2.4 Data Visualisation Palette (8 exhausted, colour-usable)

| Token | Hex | Name |
|-------|-----|------|
| `--viz-1` | `#4fa7ff` | blue |
| `--viz-2` | `#19c9a6` | teal |
| `--viz-3` | `#e7a83b` | amber-gold |
| `--viz-4` | `#7c8bee` | periwinkle |
| `--viz-5` | `#f06a74` | coral |
| `--viz-6` | `#4fc4e6` | ice |
| `--viz-7` | `#9db1c6` | slate |
| `--viz-8` | `#2e9e8f` | deep teal |

### 2.5 Dimensional Colour

No `color-mix()` anywhere — subtractive/averaging effects are encoded as **static rgba**
pre-computed from surface + accent (e.g. `--color-accent-dim: rgba(79,167,255,0.13)`,
`--shadow-focus: 0 0 0 2px rgba(79,167,255,0.55)`). This keeps rendering deterministic and
avoids Safari/engine variance.

---

## 3. Typography

| Role | Font |
|------|------|
| UI / body | Inter (400, 500, 600, 700) |
| Data / mono | JetBrains Mono (400, 500, 600) |

- `font-feature-settings: "cv11" 1, "ss01" 1, "cv02" 1, "cv03" 1, "cv04" 1, "zero" 1`
- `font-variant-numeric: tabular-nums`
- Fluid-capped type scale via `--text-10 … --text-16` plus semantic aliases; rail labels fixed at 13px.

## 4. Iconography

Phosphor Icons (regular), 16–20px, default `--text-2`; semantic states get the state colour.
Icons are labels-first: an icon never carries meaning on its own.

## 5. Spacing & Layout

4px base unit (`--space-1..12`); rail 224px desktop (compact 172px ≤900px, off-canvas drawer ≤700px);
inspector 400px right drawer (collapses to bottom sheet ≤700px); topbar 56px; HUD overlays the twin.

## 6. Radius, Shadows, Motion

`--radius-sm/md/lg/full` (4/8/12/9999px); shadows step `--shadow-1..4` (black @0.30/0.35/0.4/0.45).
Durations `120/240/400/800ms`, easings standard/decelerate/accelerate/spring.
`@media (prefers-reduced-motion: reduce)` disables all non-essential animation — the 3D twin
camera fades instead of flying.

## 7. Z-Index

`--z-rail 100`, `--z-header 200`, `--z-dropdown 300`, `--z-inspector 400`, `--z-modal 500`,
`--z-toast 600`, `--z-tooltip 700`, `--z-splash 800`.

## 8. Component Specs (Key)

| Component | Rule |
|-----------|------|
| Card | `--surface-1`, hairline border, `--radius-md`, `--shadow-1` |
| KPI | label `--text-2` small, value `--text-1` mono/semibold, tone accent via 3px bottom bar (`.tone-*`) |
| Primary button | `--brand`/`--surface-3` text, hover `--brand-2`, focus ring `--shadow-focus` |
| Status pill | `.pill-status.st-*` — coloured dot + sentence-case label (never colour-only) |
| Toast | `--surface-3`, `--shadow-3`, `.ok`/`.err` accents |
| Login overlay | glass (`--material-glass-bg`), no dev credentials on screen |
| Twin selection | thin brand ring + label; no rotating double rings, no ARGB rainbow |

## 9. Accessibility Baseline

- Focus visible on all interactive elements via `--shadow-focus` (≥3:1).
- Every status = colour + text label (`.pill-status`, `.twin-asset-dot`, `.status-dot`).
- Body text ≥4.5:1 against `--surface-1`; reduced-motion respected end-to-end.
- Rail/mobile navigation is keyboard-operable; machine pick via arrow keys + Enter in the twin.

## 10. 3D Twin Language

Physical factory: graphite bodies, steel-blue spindles/flanges, muted panel lights.
Zones are single neutral graphite slabs with hairline edges and a flowing direction strip —
no per-zone colour coding. Machine "status" is a small bar light, not an aura.
Dependency arcs are opt-in layers (DEFAULT = hidden; FLOW/SELECTED/RISK/DEPENDENCIES modes opt in).
Selection = calm brand ring + readable label; camera framing targets ~70–80% viewport coverage.

## 11. Implementation Checklist (Phase 21 status)

- [x] `css/tokens.css` — new ramp + static rgba dims/glows, legacy aliases kept
- [x] `css/base.css` — shell, topbar, grouped rail, statusbar, diagnostics drawer
- [x] `css/components.css` — shared components (sentence case, tone bars, status-dot)
- [x] `css/views.css` — factory HUD/inspector/login glass + responsive (1180/900/700)
- [x] `index.html` — grouped rail, simplified topbar, statusbar + diagnostics drawer
- [x] `js/twin3d.js` — physical factory rebuild, deps hidden by default
- [x] `js/app.js`, `shared.js`, `command.js`, `charts.js`, `inspector.js` — sentence case & new palette
- [x] 36/36 unit tests, visual QA 5/5 viewports, `unexpectedConsole=0`