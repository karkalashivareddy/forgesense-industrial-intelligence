/**
 * Formatting contract tests.
 *
 * These lock the unit discipline the product depends on:
 *  - a small non-zero probability is never rendered as "0%"
 *  - a factor contribution is never suffixed with "%"
 *  - remaining-useful-life is only ever expressed in simulator steps
 */

import { describe, expect, it } from 'vitest';
import {
  formatAge,
  formatContribution,
  formatDuration,
  formatNumber,
  formatProbability,
  formatRulSteps,
  formatScore,
  titleCase,
} from '../src/domain/format';

describe('formatProbability', () => {
  it('renders zero as 0%', () => {
    expect(formatProbability(0)).toBe('0%');
  });

  it('never rounds a small non-zero value to 0%', () => {
    // This is the exact failure mode that produced "failure risk 0%" for an
    // asset that actually sat at 0.06%.
    expect(formatProbability(0.0006)).not.toBe('0%');
    expect(formatProbability(0.0006)).toBe('0.060%');
    expect(formatProbability(0.00001)).toBe('<0.01%');
  });

  it('scales precision with magnitude', () => {
    expect(formatProbability(0.5)).toBe('50.0%');
    expect(formatProbability(0.789)).toBe('78.9%');
    expect(formatProbability(1)).toBe('100.0%');
  });

  it('never collapses distinct risk values into one label', () => {
    /*
     * Every asset currently reports failureRisk exactly 0.0006, which renders
     * as "0.060%" for all 18 of them. That is genuine model output from
     * failure-risk-v2, not a formatting artefact - but the Command Center
     * asset board would be lying if the formatter also collapsed values that
     * genuinely differ. These cases pin the precision so a future "simplify
     * the number" change cannot quietly start merging distinct risks.
     */
    expect(formatProbability(0.0006)).toBe('0.060%');
    expect(formatProbability(0.00065)).toBe('0.065%');
    expect(formatProbability(0.0007)).toBe('0.070%');

    // All three must stay distinguishable from one another.
    const labels = [0.0006, 0.00065, 0.0007].map((v) => formatProbability(v));
    expect(new Set(labels).size).toBe(3);
  });

  it('keeps a low but real risk visible rather than rounding it to 0%', () => {
    // A real low risk must never be presented as certainty of zero. The
    // "<0.01%" band is strictly below 0.0001; 0.0001 itself prints as
    // "0.010%", which is still a visible non-zero figure.
    expect(formatProbability(0.0001)).toBe('0.010%');
    expect(formatProbability(0.0001)).not.toBe('0%');
    expect(formatProbability(0.00001)).toBe('<0.01%');
    expect(formatProbability(0.00001)).not.toBe('0%');
  });

  it('returns an em dash for unusable input', () => {
    expect(formatProbability(null)).toBe('—');
    expect(formatProbability(undefined)).toBe('—');
    expect(formatProbability(Number.NaN)).toBe('—');
  });
});

describe('formatScore', () => {
  /*
   * The anomaly score is IsolationForest's `decision_function` rescaled
   * against its own training distribution (ml-service/app/main.py
   * `_anomaly_score`). It is bounded [0,1] but it is NOT a probability, so
   * appending "%" would assert a calibration the model does not have.
   */
  it('never appends a percent sign to a bounded score', () => {
    expect(formatScore(0.9993)).not.toContain('%');
    expect(formatScore(0.9993)).toBe('0.999');
    expect(formatScore(0.5)).toBe('0.500');
  });

  it('distinguishes a genuine zero score from an absent score', () => {
    // A real 0.0 measurement must render as a value, not as "unavailable".
    expect(formatScore(0)).toBe('0.000');
    expect(formatScore(null)).toBe('—');
    expect(formatScore(undefined)).toBe('—');
    expect(formatScore(Number.NaN)).toBe('—');
  });

  it('is not interchangeable with the probability formatter', () => {
    // Same number, different claim. This is the regression that would turn a
    // calibrated score into a fabricated likelihood.
    expect(formatScore(0.9993)).not.toBe(formatProbability(0.9993));
  });
});

describe('formatContribution', () => {
  it('renders a signed value with a real minus sign, not a hyphen artefact', () => {
    expect(formatContribution(0.0069)).toBe('+0.0069');
    expect(formatContribution(-0.0069)).toBe('−0.0069');
  });

  it('never appends a percent sign', () => {
    // A contribution is a signed delta on model output probability. Rendering
    // it as "…%" — or as "+-2%" for a negative value — is a unit error.
    expect(formatContribution(0.02)).not.toContain('%');
    expect(formatContribution(-0.02)).not.toContain('%');
  });

  it('handles a zero contribution without a sign', () => {
    expect(formatContribution(0)).toBe('0.0000');
  });
});

describe('formatRulSteps', () => {
  it('is the only remaining-useful-life formatter and uses steps', () => {
    expect(formatRulSteps(60)).toBe('60 steps');
  });

  it('never implies a physical time unit', () => {
    const output = formatRulSteps(42).toLowerCase();
    expect(output).not.toMatch(/hour|hr|day|minute|min\b|week|month/);
  });

  it('formats large horizons with separators', () => {
    expect(formatRulSteps(12000)).toBe('12,000 steps');
  });
});

describe('formatNumber', () => {
  it('respects the requested precision', () => {
    expect(formatNumber(99.63, 1)).toBe('99.6');
    expect(formatNumber(99.63, 0)).toBe('100');
  });
});

describe('formatDuration', () => {
  it('renders minutes and hours', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(80)).toBe('1h 20m');
  });
});

describe('formatAge', () => {
  it('scales the unit with magnitude', () => {
    expect(formatAge(4)).toBe('4s ago');
    expect(formatAge(120)).toBe('2m ago');
    expect(formatAge(7200)).toBe('2h ago');
    expect(formatAge(172800)).toBe('2d ago');
  });
});

describe('titleCase', () => {
  it('normalises enum-style tokens', () => {
    expect(titleCase('MAINTENANCE')).toBe('Maintenance');
    expect(titleCase('MATERIAL_HANDLING')).toBe('Material Handling');
  });
});
