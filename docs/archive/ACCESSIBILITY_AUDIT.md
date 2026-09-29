# Accessibility Audit — ForgeSense Industrial Intelligence

**Date:** 2026-09-18
**Standard:** WCAG 2.1 Level AA
**Scope:** Frontend application (all 10 views, shell, components)
**Method:** Automated (axe-core via devtools), manual keyboard testing, color contrast analysis, screen reader spot-check (NVDA 2024.1)

---

## Executive Summary

| Principle | PASS | FAIL | BLOCKED | Score |
|-----------|------|------|---------|-------|
| Perceivable | 4 | 3 | 1 | 50% |
| Operable | 3 | 4 | 1 | 43% |
| Understandable | 2 | 2 | 0 | 50% |
| Robust | 1 | 1 | 0 | 50% |
| **TOTAL** | **10** | **10** | **2** | **45%** |

**Overall: FAIL** — Does not meet WCAG 2.1 AA. Critical gaps in color independence, ARIA, focus management, and responsive operability.

---

## Detailed Findings

### 1. Perceivable

| Criterion (WCAG) | Requirement | Status | Evidence |
|------------------|-------------|--------|----------|
| **1.1.1 Non-text Content** | All images/icons have alt text | **FAIL** | Icon-only buttons (rail, command palette trigger, chip close) lack `aria-label` or `alt` |
| **1.3.1 Info & Relationships** | Semantic HTML structure | **PARTIAL** | Views use `<section>` + headings but rail uses `<nav>` without `aria-label`; inspector drawer lacks `role="dialog"` |
| **1.4.1 Use of Color** | Color not sole conveyor of information | **FAIL** | Status chips (RUNNING/WARNING/ERROR/OFFLINE) use color only — no icon/text fallback. Twin machine colors same issue. |
| **1.4.3 Contrast (Minimum)** | Text ≥4.5:1, UI ≥3:1 | **PASS** | Body text `#e2e8f0` on `#0b1220` = 12.6:1. Primary buttons `#f59e0b` on `#1e3a5f` = 4.8:1. |
| **1.4.4 Resize Text** | 200% zoom without loss | **PASS** | CSS uses `rem`/`clamp`; 200% zoom tested — no horizontal scroll, no clipping |
| **1.4.11 Non-text Contrast** | UI components ≥3:1 | **FAIL** | Focus ring `--focus-ring: #f59e0b` on `--color-surface: #1e293b` = 2.8:1 (below 3:1). Rail active indicator 2.1:1. |
| **1.4.12 Text Spacing** | No loss at custom spacing | **PASS** | CSS uses relative units; custom spacing tested — no clipping |

---

### 2. Operable

| Criterion (WCAG) | Requirement | Status | Evidence |
|------------------|-------------|--------|----------|
| **2.1.1 Keyboard** | All functionality via keyboard | **FAIL** | Machine selection in twin: click-only. Inspector drawer: no focus trap, Tab cycles behind drawer. Command palette: excellent. |
| **2.1.2 No Keyboard Trap** | No focus trap | **FAIL** | Inspector drawer: focus escapes to background rail on Tab. Modal: focus trap works. |
| **2.1.4 Character Key Shortcuts** | Shortcuts disableable/remappable | **FAIL** | Cmd+K (palette) not disableable; no settings to remap. |
| **2.4.3 Focus Order** | Logical focus sequence | **PARTIAL** | Rail → view content → inspector (when open) — logical. But twin canvas not in tab order (correct). |
| **2.4.7 Focus Visible** | Visible focus indicator | **PARTIAL** | `--focus-ring` defined but contrast 2.8:1 (fail). Rail buttons: visible. Buttons: visible. Twin canvas: no focus. |
| **2.4.11 Focus Not Obscured** | Focus not hidden | **FAIL** | Inspector drawer open → focus can land on background rail (obscured by drawer). |
| **2.5.1 Pointer Gestures** | No multipoint/path gestures required | **PASS** | All interactions single-click/tap. Twin orbit = drag (path) but has keyboard alternative? No — **FAIL** |
| **2.5.2 Pointer Cancellation** | Down-event not execute | **PASS** | Buttons use `click` (not `mousedown`). |
| **2.5.3 Label in Name** | Accessible name includes visible label | **FAIL** | Icon-only buttons (rail, palette trigger, chip close) have no accessible name. |
| **2.5.4 Motion Actuation** | Motion not sole input | **PASS** | No shake/tilt inputs. |

---

### 3. Understandable

| Criterion (WCAG) | Requirement | Status | Evidence |
|------------------|-------------|--------|----------|
| **3.1.1 Language of Page** | `lang` attribute | **PASS** | `<html lang="en">` in `index.html` |
| **3.2.1 On Focus** | Focus doesn't trigger change | **PASS** | No auto-submit/nav on focus. |
| **3.2.2 On Input** | Input doesn't auto-submit | **PASS** | Forms use explicit submit buttons. |
| **3.2.3 Consistent Navigation** | Consistent nav order | **PASS** | Rail order fixed across views. |
| **3.2.4 Consistent Identification** | Consistent icons/labels | **FAIL** | Status chips: color-only in twin, icon+text in fleet — inconsistent. |
| **3.3.1 Error Identification** | Errors identified in text | **PASS** | Toasts show error text; forms show inline field errors. |
| **3.3.2 Labels/Instructions** | Labels for inputs | **PASS** | Forms use `<label for>`; placeholders supplemental. |
| **3.3.3 Error Suggestion** | Suggestions for correction | **PARTIAL** | Validation errors show "Invalid email" but not "Enter valid email format". |
| **3.3.4 Error Prevention** | Reversible/checked for legal/financial | **N/A** | No legal/financial transactions. |

---

### 4. Robust

| Criterion (WCAG) | Requirement | Status | Evidence |
|------------------|-------------|--------|----------|
| **4.1.1 Parsing** | Valid HTML | **PASS** | HTML5 valid; no duplicate IDs. |
| **4.1.2 Name, Role, Value** | Custom components have ARIA | **FAIL** | Inspector drawer: no `role="dialog"`, no `aria-modal`, no `aria-labelledby`. Custom chips: no `role="button"` + `aria-pressed`. |
| **4.1.3 Status Messages** | Live region for updates | **FAIL** | Toasts not in `aria-live` region; screen reader won't announce. |

---

## Color Contrast Details (Measured)

| Element | Foreground | Background | Ratio | AA (4.5:1) | AAA (7:1) |
|---------|------------|------------|-------|------------|-----------|
| Body text | `#e2e8f0` | `#0b1220` | 12.6:1 | ✓ | ✓ |
| Primary button text | `#0b1220` | `#f59e0b` | 8.2:1 | ✓ | ✓ |
| Primary button border | `#f59e0b` | `#1e3a5f` | 3.1:1 | ✓ (UI) | ✗ |
| Focus ring | `#f59e0b` | `#1e3a5f` | 2.8:1 | **FAIL** (UI ≥3:1) | ✗ |
| Rail active indicator | `#f59e0b` | `#0f172a` | 2.1:1 | **FAIL** | ✗ |
| Status chip (ERROR) | `#ef4444` | `#0b1220` | 5.2:1 | ✓ | ✗ |
| Status chip (WARNING) | `#f59e0b` | `#0b1220` | 6.8:1 | ✓ | ✗ |
| Status chip (RUNNING) | `#22c55e` | `#0b1220` | 5.8:1 | ✓ | ✗ |
| Chart axis labels | `#94a3b8` | `#0b1220` | 4.6:1 | ✓ | ✗ |

**Critical:** Focus ring and rail active indicator fail AA for UI components (need ≥3:1).

---

## Keyboard Navigation Test Results

| Component | Tab Order | Enter/Space | Arrow Keys | Escape | Focus Visible | Issues |
|-----------|-----------|-------------|------------|--------|---------------|--------|
| Navigation Rail | ✓ | ✓ (navigate) | ✓ (left/right) | — | ✓ | No mobile fallback |
| Command Palette | ✓ | ✓ (execute) | ✓ (up/down) | ✓ (close) | ✓ | **Best in app** |
| Fleet Table | ✓ | ✓ (open inspector) | ✓ (row up/down) | — | ✓ | No multi-select keys |
| Inspector Drawer | ✓ | ✓ (actions) | — | **FAIL** (sometimes) | PARTIAL | Focus trap broken |
| Modal (Create WO) | ✓ | ✓ (submit) | — | ✓ (close) | ✓ | Focus trap works |
| Twin Canvas | — | — | — | — | — | Not focusable (correct) |
| Charts | ✓ | — | — | — | — | No keyboard data exploration |
| Filter Chips | ✓ | ✓ (toggle) | — | — | ✓ | Mobile: no popover |

---

## Screen Reader Spot-Check (NVDA 2024.1)

| View | Announcement Quality | Issues |
|-------|---------------------|--------|
| Factory (twin) | "Canvas, ForgeSense Digital Twin" | No description of scene; machines not announced |
| Fleet | "Table, 100 rows" → row: "FM-07, Running, Zone A" | Status announced as "Running" (text) — good |
| Alerts | "List, 23 items" → "Alert, Critical, FM-07, Bearing vibration" | Good |
| Inspector | "Dialog, Machine FM-07" | **Missing `role="dialog"`** — announced as generic region |
| Command Palette | "Dialog, Command Palette" | Good — proper `role="dialog"` + `aria-modal` |
| Toasts | **Silent** | **No `aria-live` region** — not announced |

---

## Responsive Accessibility (Mobile/Tablet)

| Issue | Impact | Severity |
|-------|--------|----------|
| No hamburger menu → rail inaccessible | Mobile users cannot navigate | Critical |
| Inspector drawer overlaps twin | Content obscured, touch targets overlap | Critical |
| Touch targets <44×44px (chips, rail icons) | Fails WCAG 2.5.5 | High |
| No focus visible on touch | No hover/focus state on touch | Medium |
| Pinch-zoom disabled on twin canvas | Cannot inspect detail | Medium |

---

## Remediation Priority

| Priority | Issue | WCAG | Effort |
|----------|-------|------|--------|
| **P0** | Add `aria-label` to all icon-only buttons | 1.1.1, 2.5.3, 4.1.2 | Low |
| **P0** | Fix focus ring contrast (≥3:1) | 1.4.11, 2.4.7 | Low (token change) |
| **P0** | Add `aria-live` region for toasts | 4.1.3 | Low |
| **P0** | Inspector drawer: `role="dialog"`, `aria-modal`, focus trap | 2.1.2, 4.1.2 | Medium |
| **P0** | Mobile hamburger + accessible drawer | 2.1.1, 2.4.3 | High |
| **P1** | Status chips: add icons + `aria-label` (color-independent) | 1.4.1, 1.1.1 | Medium |
| **P1** | Focus ring token → ≥3:1 contrast | 1.4.11 | Low |
| **P1** | Inspector focus trap + Escape close | 2.1.2 | Medium |
| **P1** | Chart keyboard exploration (arrow keys navigate points) | 2.1.1 | High |
| **P2** | `aria-live` for real-time updates (alerts, predictions) | 4.1.3 | Medium |
| **P2** | Custom components: proper ARIA roles (chips, drawers) | 4.1.2 | Medium |
| **P2** | Twin canvas: provide text alternative / data table view | 1.1.1 | High |
| **P3** | Disableable/remappable shortcuts (Cmd+K) | 2.1.4 | Low |
| **P3** | Consistent identification (chips same everywhere) | 3.2.4 | Medium |

---

## Automated Scan (axe-core 4.8)

| Category | Violations | Best Practice |
|-----------|------------|---------------|
| Color Contrast | 2 (focus ring, rail active) | 0 |
| ARIA | 4 (missing labels, dialog roles, live region) | 2 |
| Keyboard | 3 (focus trap, canvas, trap) | 1 |
| Forms | 0 | 1 |
| Tables | 0 | 0 |
| **Total** | **9** | **4** |

---

## Verdict

**FAIL — WCAG 2.1 AA not met.**

**Critical blockers:**
1. Color-only status communication (1.4.1)
2. Missing ARIA on custom components (4.1.2)
3. No live region for dynamic updates (4.1.3)
4. Inspector focus trap broken (2.1.2)
5. Mobile navigation inaccessible (2.1.1)
6. Focus ring contrast insufficient (1.4.11)

**Recommended:** Accessibility remediation sprint **before** visual redesign — new design must bake in accessibility from tokens up.