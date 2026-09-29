/**
 * Colour resolution for JavaScript.
 *
 * The design system has one source of truth (`styles/tokens.css`). This module
 * is the only bridge from that file into TypeScript, so no component ever
 * contains a literal colour.
 *
 * Chart libraries and the 3D renderer need concrete values, and CSS custom
 * properties cannot be read from a canvas context. `resolveToken()` reads the
 * computed value from the document, so those two consumers still stay in sync
 * with the token file.
 */

import type { StateTone } from '../domain/machineState';
import type { DataBasis } from '../domain/basis';

const FALLBACK: Record<string, string> = {
  '--color-accent': '#22d3ee',
  '--color-info': '#4a9fe0',
  '--color-success': '#34c07d',
  '--color-warning': '#e8a93f',
  '--color-critical': '#ef4d55',
  '--color-intelligence': '#9d7bf0',
  '--color-synthetic': '#c98a52',
  '--color-derived': '#7b8899',
  '--color-unavailable': '#5a6674',
  '--color-maintenance': '#6f8ff0',
  '--color-chart-observed': '#22d3ee',
  '--color-chart-predicted': '#9d7bf0',
  '--color-chart-warning-threshold': '#e8a93f',
  '--color-chart-critical-threshold': '#ef4d55',
  '--color-chart-baseline': '#7b8899',
  '--color-chart-grid': 'rgba(120, 150, 180, 0.09)',
  '--color-chart-axis': '#7b8899',
  '--color-text-primary': '#e6ecf3',
  '--color-text-secondary': '#a7b4c4',
  '--color-text-muted': '#7b8899',
  '--color-border-subtle': '#1c222a',
  '--color-border-default': '#273040',
  '--color-bg-inset': '#070a0e',
  '--color-bg-panel': '#10141a',
};

const cache = new Map<string, string>();

/** Read a CSS custom property, falling back to a known value. */
export function token(name: string): string {
  const cached = cache.get(name);
  if (cached) return cached;

  let value = FALLBACK[name];
  if (typeof window !== 'undefined') {
    const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (resolved) value = resolved;
  }
  const final = value ?? '#7b8899';
  cache.set(name, final);
  return final;
}

/** Drop the cache. Called once on load so a theme change is picked up. */
export function resetTokenCache(): void {
  cache.clear();
}

/* ------------------------------------------------------------------ *
 * State -> colour
 * ------------------------------------------------------------------ */

/**
 * Machine operational state. This is the ONLY place a machine state is
 * allowed to acquire a colour, and it never uses violet: violet is reserved
 * for model output, so a predicted value can never be mistaken for an
 * observed condition.
 */
export const STATE_COLOR: Record<StateTone | 'neutral', string> = {
  ok: 'var(--state-ok)',
  warn: 'var(--state-warning)',
  crit: 'var(--state-critical)',
  maint: 'var(--state-maint)',
  idle: 'var(--state-idle)',
  info: 'var(--state-info)',
  neutral: 'var(--state-neutral)',
};

export const STATE_COLOR_BG: Record<StateTone | 'neutral', string> = {
  ok: 'var(--state-ok-bg)',
  warn: 'var(--state-warning-bg)',
  crit: 'var(--state-critical-bg)',
  maint: 'var(--state-maint-bg)',
  idle: 'var(--state-idle-bg)',
  info: 'var(--state-info-bg)',
  neutral: 'var(--state-neutral-bg)',
};

export const STATE_COLOR_TEXT: Record<StateTone | 'neutral', string> = {
  ok: 'var(--state-ok-text)',
  warn: 'var(--state-warning-text)',
  crit: 'var(--state-critical-text)',
  maint: 'var(--state-maint-text)',
  idle: 'var(--state-idle-text)',
  info: 'var(--state-info-text)',
  neutral: 'var(--state-neutral-text)',
};

/* ------------------------------------------------------------------ *
 * Provenance -> colour
 * ------------------------------------------------------------------ */

/**
 * Data basis. Note that SYNTHETIC is a warm desaturated amber and is
 * visually quieter than the warning amber: it is a disclosure, not an alarm.
 */
export const BASIS_COLOR: Record<DataBasis, string> = {
  OBSERVED: 'var(--color-accent)',
  DERIVED: 'var(--color-derived)',
  PREDICTED: 'var(--color-intelligence)',
  SYNTHETIC: 'var(--color-synthetic)',
  SIMULATED: 'var(--color-synthetic)',
  UNAVAILABLE: 'var(--color-unavailable)',
};

export const BASIS_COLOR_BG: Record<DataBasis, string> = {
  OBSERVED: 'var(--color-accent-bg)',
  DERIVED: 'var(--color-derived-bg)',
  PREDICTED: 'var(--color-intelligence-bg)',
  SYNTHETIC: 'var(--color-synthetic-bg)',
  SIMULATED: 'var(--color-synthetic-bg)',
  UNAVAILABLE: 'var(--color-unavailable-bg)',
};

export const BASIS_COLOR_BORDER: Record<DataBasis, string> = {
  OBSERVED: 'var(--color-accent-border)',
  DERIVED: 'var(--color-derived-border)',
  PREDICTED: 'var(--color-intelligence-border)',
  SYNTHETIC: 'var(--color-synthetic-border)',
  SIMULATED: 'var(--color-synthetic-border)',
  UNAVAILABLE: 'var(--color-unavailable-border)',
};

export const BASIS_COLOR_TEXT: Record<DataBasis, string> = {
  OBSERVED: 'var(--color-accent-text)',
  DERIVED: 'var(--color-derived-text)',
  PREDICTED: 'var(--color-intelligence-text)',
  SYNTHETIC: 'var(--color-synthetic-text)',
  SIMULATED: 'var(--color-synthetic-text)',
  UNAVAILABLE: 'var(--color-unavailable-text)',
};

/* ------------------------------------------------------------------ *
 * Chart semantics
 * ------------------------------------------------------------------ */

/**
 * Chart series colours carry the same meaning as the UI, so a violet series
 * in a chart is a model output and a cyan series is observed telemetry.
 */
export const CHART = {
  observed: () => token('--color-chart-observed'),
  predicted: () => token('--color-chart-predicted'),
  warningThreshold: () => token('--color-chart-warning-threshold'),
  criticalThreshold: () => token('--color-chart-critical-threshold'),
  baseline: () => token('--color-chart-baseline'),
  grid: () => token('--color-chart-grid'),
  axis: () => token('--color-chart-axis'),
  text: () => token('--color-text-secondary'),
  muted: () => token('--color-text-muted'),
  panel: () => token('--color-bg-panel'),
  border: () => token('--color-border-subtle'),
} as const;

/** rgba() from a hex token, for fills that need alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const normalised = hex.trim();
  if (normalised.startsWith('#')) {
    const value = normalised.length === 4
      ? normalised
          .slice(1)
          .split('')
          .map((char) => char + char)
          .join('')
      : normalised.slice(1);
    if (value.length === 6) {
      const r = parseInt(value.slice(0, 2), 16);
      const g = parseInt(value.slice(2, 4), 16);
      const b = parseInt(value.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  if (normalised.startsWith('rgb(')) return normalised.replace(/rgba?\(([^)]+)\)/, (_m, inner) => `rgba(${inner.split(',').slice(0, 3).join(', ')}, ${alpha})`);
  return normalised;
}
