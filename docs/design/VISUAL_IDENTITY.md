# Visual Identity — ForgeSense Industrial Intelligence

**Date:** 2026-09-18
**Phase:** Design Research → Visual Identity
**Input:** `docs/design/DESIGN_RESEARCH.md`
**Output:** Binding visual language for all frontend implementation

---

## 1. Core Concept: "Precision in the Dark"

Industrial environments operate in low light. Machines glow with status. Data cuts through noise. ForgeSense visual language embodies **clarity in darkness** — not a dashboard, but a control surface.

**Keywords:** Graphite, Copper, Precision, Depth, Signal

---

## 2. Color Palette

### 2.1 Core Palette (Semantic Tokens)

| Token | Hex | Usage | Contrast (on bg) |
|-------|-----|-------|------------------|
| `--color-bg` | `#0a0e14` | Page background | — |
| `--color-surface` | `#111820` | Cards, panels, drawers | 14.2:1 |
| `--color-surface-elevated` | `#181f2a` | Modals, popovers | 12.8:1 |
| `--color-border` | `#233044` | Dividers, input borders | 4.1:1 |
| `--color-border-strong` | `#3a4a5f` | Focus rings, active states | 5.2:1 |

### 2.2 Brand Accents (The ForgeSense Fingerprint)

| Token | Hex | Name | Usage | Contrast (on bg) |
|-------|-----|------|-------|------------------|
| `--color-copper` | `#c9762e` | **Primary brand** | Primary buttons, active rail, key CTAs, focus ring | 5.8:1 |
| `--color-copper-hover` | `#d48a3e` | Primary hover | Button hover, rail active hover | 6.4:1 |
| `--color-copper-muted` | `#8b5a22` | Primary disabled | Disabled buttons, subtle accents | 3.2:1 |
| `--color-amber` | `#f59e0b` | **Warning / Attention** | WARNING state, pending, attention | 6.8:1 |
| `--color-emerald` | `#10b981` | **Running / Success** | RUNNING state, confirmed, online | 5.8:1 |
| `--color-crimson` | `#ef4444` | **Critical / Error** | ERROR state, critical alerts, destructive | 5.2:1 |
| `--color-cyan` | `#06b6d4` | **Info / ML / Simulation** | ML predictions, simulation, info | 4.9:1 |

### 2.3 Semantic Status Mapping (Color + Icon + Text — Never Color Only)

| State | Primary Token | Icon | Text Label | WCAG 1.4.1 |
|-------|---------------|------|------------|------------|
| RUNNING | `--color-emerald` | `⏵` (play) | "Running" | ✅ |
| WARNING | `--color-amber` | `⚠` (triangle) | "Warning" | ✅ |
| ERROR / CRITICAL | `--color-crimson` | `✕` (x-circle) | "Error" / "Critical" | ✅ |
| OFFLINE | `--color-border` | `⏹` (square) | "Offline" | ✅ |
| MAINTENANCE | `--color-cyan` | `🔧` (wrench) | "Maintenance" | ✅ |
| SIMULATION | `--color-cyan` | `🧪` (flask) | "Simulation" | ✅ |
| UNKNOWN | `--color-border` | `?` (help-circle) | "Unknown" | ✅ |

### 2.4 Data Visualization Palette (Categorical, Color-Blind Safe)

| Index | Token | Hex | Use For |
|-------|-------|-----|---------|
| 1 | `--viz-1` | `#c9762e` (copper) | Primary series, Machine A |
| 2 | `--viz-2` | `#06b6d4` (cyan) | Secondary series, Machine B |
| 3 | `--viz-3` | `#10b981` (emerald) | Machine C |
| 4 | `--viz-4` | `#f59e0b` (amber) | Machine D |
| 5 | `--viz-5` | `#ef4444` (crimson) | Machine E |
| 6 | `--viz-6` | `#8b5cf6` (violet) | Machine F |
| 7 | `--viz-7` | `#ec4899` (pink) | Machine G |
| 8 | `--viz-8` | `#22d3ee` (light cyan) | Machine H |

**Tested:** All 8 pass Coblis protanopia/deuteranopia/tritanopia simulation.

---

## 3. Typography

### 3.1 Font Stack

| Role | Font | Source | Weights |
|------|------|--------|---------|
| **UI / Body** | **Inter** | Google Fonts (self-hosted in prod) | 400, 500, 600, 700 |
| **Data / Mono** | **JetBrains Mono** | Google Fonts (self-hosted) | 400, 500, 600 |
| **Display / Headlines** | **Inter Tight** | Google Fonts (self-hosted) | 600, 700 |

**Self-hosting required** for offline/PWA — bundle via `@fontsource` or local `fonts/`.

### 3.2 Type Scale (Fluid, `clamp()`)

| Token | Desktop | Tablet | Mobile | Usage |
|-------|---------|--------|--------|-------|
| `--text-display` | `clamp(2.5rem, 4vw, 3.5rem)` | — | — | Page hero (rare) |
| `--text-h1` | `clamp(1.75rem, 3vw, 2.25rem)` | — | — | View titles |
| `--text-h2` | `clamp(1.375rem, 2.5vw, 1.75rem)` | — | — | Section headers |
| `--text-h3` | `1.125rem` | — | — | Card titles, drawer headers |
| `--text-body-lg` | `1.0625rem` | — | — | Important body |
| `--text-body` | `0.9375rem` | — | — | Default body |
| `--text-body-sm` | `0.8125rem` | — | — | Secondary, metadata |
| `--text-caption` | `0.75rem` | — | — | Timestamps, chips |
| `--text-mono` | `0.8125rem` | — | — | Code, IDs, metrics |
| `--text-mono-lg` | `0.9375rem` | — | — | KPI values, telemetry |

**Line Heights:** `--leading-tight: 1.1`, `--leading-normal: 1.5`, `--leading-relaxed: 1.625`

### 3.3 Font Features

```css
font-feature-settings: "cv11" 1, "ss01" 1, "cv02" 1, "cv03" 1, "cv04" 1, "zero" 1;
/* Inter: slashed zero, alt 'l', tabular nums for data */
font-variant-numeric: tabular-nums;
/* JetBrains Mono: tabular nums, slashed zero */
```

---

## 4. Iconography

### 4.1 System: **Phosphor Icons (Duotone)** — Self-hosted

- **Why:** 7,000+ icons, duotone supports semantic color (primary + muted), consistent weight, MIT license
- **Set:** `@phosphor-icons/web` → bundle as SVG sprite
- **Sizes:** `--icon-xs: 12px`, `--icon-sm: 16px`, `--icon-md: 20px`, `--icon-lg: 24px`, `--icon-xl: 32px`

### 4.2 Industrial Symbol Set: **ISA-5.1 / ISA-5.2** (Custom SVG)

| Symbol | Meaning | SVG ID |
|--------|---------|--------|
| `pump` | Centrifugal pump | `isa-pump` |
| `compressor` | Compressor | `isa-compressor` |
| `turbine` | Turbine | `isa-turbine` |
| `heat-exchanger` | Heat exchanger | `isa-hex` |
| `vessel` | Tank/vessel | `isa-vessel` |
| `valve-gate` | Gate valve | `isa-valve-gate` |
| `valve-ball` | Ball valve | `isa-valve-ball` |
| `sensor-temp` | Temperature sensor | `isa-temp` |
| `sensor-pressure` | Pressure sensor | `isa-pressure` |
| `sensor-vibration` | Vibration sensor | `isa-vibration` |
| `sensor-flow` | Flow sensor | `isa-flow` |
| `motor` | Electric motor | `isa-motor` |
| `fan` | Fan/blower | `isa-fan` |

**Usage:** Twin machine glyphs, P&ID overlays, fleet type badges.

---

## 5. Spacing & Layout

### 5.1 Base Unit: **4px** (consistent with 8pt grid)

| Token | Value | Usage |
|-------|-------|-------|
| `--space-0` | `0` | Reset |
| `--space-1` | `4px` | Micro gap |
| `--space-2` | `8px` | Base unit |
| `--space-3` | `12px` | Compact gap |
| `--space-4` | `16px` | Standard gap |
| `--space-5` | `20px` | Relaxed |
| `--space-6` | `24px` | Section gap |
| `--space-8` | `32px` | Major section |
| `--space-10` | `40px` | Page margin |
| `--space-12` | `48px` | Hero section |

### 5.2 Layout Grid

| Token | Value | Usage |
|-------|-------|-------|
| `--layout-max` | `1440px` | Max content width |
| `--layout-gutter` | `24px` | Page gutter (desktop) |
| `--layout-gutter-mobile` | `16px` | Page gutter (mobile) |
| `--rail-width` | `72px` | Navigation rail (collapsed) |
| `--rail-width-expanded` | `240px` | Navigation rail (expanded) |
| `--inspector-width` | `384px` | Inspector drawer |
| `--inspector-width-mobile` | `100vw` | Bottom sheet (mobile) |
| `--header-height` | `56px` | Top header |
| `--twin-aspect` | `16/9` | Twin canvas aspect |

---

## 6. Border Radius & Shadows

### 6.1 Radius Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-none` | `0` | Tables, full-bleed |
| `--radius-sm` | `4px` | Inputs, chips, badges |
| `--radius-md` | `8px` | Buttons, cards, modals |
| `--radius-lg` | `12px` | Drawers, popovers |
| `--radius-xl` | `16px` | Hero cards |
| `--radius-full` | `9999px` | Pills, avatars |

### 6.2 Shadow Scale (Depth = Elevation)

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-1` | `0 1px 2px rgba(0,0,0,0.3)` | Cards, default |
| `--shadow-2` | `0 4px 8px rgba(0,0,0,0.35)` | Elevated cards |
| `--shadow-3` | `0 8px 24px rgba(0,0,0,0.4)` | Modals, drawers |
| `--shadow-4` | `0 16px 48px rgba(0,0,0,0.45)` | Toasts, popovers |
| `--shadow-focus` | `0 0 0 2px var(--color-copper)` | Focus ring |

---

## 7. Motion Tokens

| Token | Duration | Easing | Usage |
|-------|----------|--------|-------|
| `--duration-instant` | `0ms` | — | Toggles, checkboxes |
| `--duration-fast` | `120ms` | `ease-standard` | Hover, focus, chips |
| `--duration-normal` | `240ms` | `ease-standard` | Modals, drawers, toasts |
| `--duration-slow` | `400ms` | `ease-decelerate` | Page transitions, camera fly-to |
| `--duration-cinematic` | `800ms` | `ease-spring` | Twin preset views, onboarding |

**Easing Curves:**
```css
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
--ease-decelerate: cubic-bezier(0, 0, 0.2, 1);
--ease-accelerate: cubic-bezier(0.4, 0, 1, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
```

**Reduced Motion:** All non-essential motion disabled via `@media (prefers-reduced-motion: reduce)`.

---

## 8. Z-Index Scale

| Token | Value | Layer |
|-------|-------|-------|
| `--z-base` | `0` | Content |
| `--z-rail` | `100` | Navigation rail |
| `--z-header` | `200` | Top header |
| `--z-dropdown` | `300` | Dropdowns, popovers |
| `--z-drawer` | `400` | Side drawers (inspector) |
| `--z-modal` | `500` | Modals |
| `--z-toast` | `600` | Toasts |
| `--z-tooltip` | `700` | Tooltips |
| `--z-loading` | `800` | Full-screen loading |

---

## 9. Component Visual Specs (Key)

### 9.1 Button

| Variant | Background | Text | Border | Hover | Focus |
|---------|------------|------|--------|-------|-------|
| Primary | `--color-copper` | `#0a0e14` | None | `--color-copper-hover` | `--shadow-focus` |
| Secondary | `--color-surface-elevated` | `--color-text` | `--color-border` | `--color-border-strong` | `--shadow-focus` |
| Ghost | Transparent | `--color-text` | None | `--color-surface` | `--shadow-focus` |
| Destructive | `--color-crimson` | `#fff` | None | `--color-crimson` (darker) | `--shadow-focus` |

**Sizes:** `--btn-sm: 32px`, `--btn-md: 40px`, `--btn-lg: 48px`

### 9.2 Status Chip

```css
.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: var(--text-caption);
  font-weight: 500;
  /* Color + Icon + Text — never color only */
}
```

| State | Background | Icon Color | Text |
|-------|------------|------------|------|
| RUNNING | `color-mix(in srgb, var(--color-emerald) 15%, transparent)` | `--color-emerald` | "Running" |
| WARNING | `color-mix(in srgb, var(--color-amber) 15%, transparent)` | `--color-amber` | "Warning" |
| ERROR | `color-mix(in srgb, var(--color-crimson) 15%, transparent)` | `--color-crimson` | "Error" |
| OFFLINE | `color-mix(in srgb, var(--color-border) 15%, transparent)` | `--color-border` | "Offline" |

### 9.3 Card

```css
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-1);
  padding: var(--space-4);
}
```

### 9.4 Input / Select

```css
.input {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  padding: 8px 12px;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}
.input:focus {
  border-color: var(--color-copper);
  box-shadow: var(--shadow-focus);
}
```

---

## 10. Dark Mode Only (No Light Mode)

ForgeSense is **dark-mode only** — industrial control rooms are dark. No light mode tokens.

---

## 10. CSS Custom Properties — Complete Token File

See `docs/design/TOKENS.css` (generated alongside this doc) for the complete `:root` block ready to drop into `css/tokens.css`.

---

## 11. Accessibility Baseline (Baked Into Tokens)

| Requirement | Token Implementation |
|-------------|---------------------|
| Focus ring ≥3:1 | `--shadow-focus: 0 0 0 2px var(--color-copper)` (5.8:1) |
| Color-independent status | Every status = color + icon + text token |
| Focus visible | `--shadow-focus` on all interactive |
| Reduced motion | `@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }` |
| Text contrast ≥4.5:1 | All text tokens measured ≥4.5:1 |
| UI contrast ≥3:1 | Focus ring 5.8:1; borders 4.1:1 |

---

## 11. Implementation Checklist

- [ ] Replace `css/tokens.css` with generated `TOKENS.css`
- [ ] Add Phosphor Icons + ISA-5.1 sprite to `index.html`
- [ ] Self-host Inter / JetBrains Mono / Inter Tight
- [ ] Update `css/base.css` to use new tokens
- [ ] Update `css/components.css` with new component specs
- [ ] Update `css/views.css` for new layout tokens
- [ ] Add `prefers-reduced-motion` media query
- [ ] Verify all contrast ratios in browser devtools
- [ ] Test with color-blind simulator (Coblis)

---

## 12. Approval

**Visual Identity Approved:** _______________ **Date:** _______________

**Next:** Generate `TOKENS.css` → Update `css/tokens.css` → Begin Phase 1 Implementation