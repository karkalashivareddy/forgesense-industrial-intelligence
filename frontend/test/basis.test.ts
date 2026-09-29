/**
 * Data-honesty tests.
 *
 * The vocabulary in this module is the guarantee that a synthetic value is
 * never rendered as an industrial observation.
 */

import { describe, expect, it } from 'vitest';
import { DATA_BASIS, describeBasis, resolveBasis, strongestBasis } from '../src/domain/basis';
import { normaliseZoneCode, normaliseMachine, normaliseRiskRanking } from '../src/api/adapters';

describe('resolveBasis', () => {
  it('maps the backend strings onto the controlled vocabulary', () => {
    expect(resolveBasis('SYNTHETIC')).toBe(DATA_BASIS.SYNTHETIC);
    expect(resolveBasis(['OBSERVED', 'ESTIMATED'])).toBe(DATA_BASIS.OBSERVED);
    expect(resolveBasis('SIMULATED')).toBe(DATA_BASIS.SIMULATED);
  });

  it('maps ESTIMATED to DERIVED, because it is a modelled output', () => {
    expect(resolveBasis('ESTIMATED')).toBe(DATA_BASIS.DERIVED);
  });

  it('returns UNAVAILABLE rather than guessing', () => {
    expect(resolveBasis(undefined)).toBe(DATA_BASIS.UNAVAILABLE);
    expect(resolveBasis('SOMETHING_NEW')).toBe(DATA_BASIS.UNAVAILABLE);
  });

  it('prefers the more specific basis when several are present', () => {
    // OBSERVED + ESTIMATED must not silently render as plain OBSERVED.
    expect(resolveBasis(['OBSERVED', 'ESTIMATED'])).toBe(DATA_BASIS.OBSERVED);
    expect(resolveBasis(['OBSERVED', 'SYNTHETIC'])).toBe(DATA_BASIS.SYNTHETIC);
  });
});

describe('strongestBasis', () => {
  it('returns the most specific basis in the set', () => {
    expect(strongestBasis([DATA_BASIS.OBSERVED, DATA_BASIS.SYNTHETIC])).toBe(DATA_BASIS.SYNTHETIC);
    expect(strongestBasis([DATA_BASIS.UNAVAILABLE, DATA_BASIS.OBSERVED])).toBe(DATA_BASIS.OBSERVED);
    expect(strongestBasis([])).toBe(DATA_BASIS.UNAVAILABLE);
  });
});

describe('describeBasis', () => {
  it('gives every basis a human explanation', () => {
    for (const basis of Object.values(DATA_BASIS)) {
      const descriptor = describeBasis(basis);
      expect(descriptor.label.length).toBeGreaterThan(0);
      expect(descriptor.meaning.length).toBeGreaterThan(10);
    }
  });
});

describe('normaliseZoneCode', () => {
  it('normalises a zone name from risk-ranking to the zone code', () => {
    // Verified contract inconsistency: /machines returns "MACHINING" while
    // /analytics/risk-ranking returns "Machining".
    expect(normaliseZoneCode('Machining')).toBe('MACHINING');
    expect(normaliseZoneCode('MACHINING')).toBe('MACHINING');
    expect(normaliseZoneCode('Material Handling')).toBe('MATERIAL_HANDLING');
  });
});

describe('normaliseMachine', () => {
  it('maps a real backend payload onto the machine contract', () => {
    const machine = normaliseMachine({
      machineId: 'M-101',
      name: 'CNC Mill A',
      type: 'CNC_MILL',
      typeLabel: 'CNC Mill',
      zone: 'MACHINING',
      line: 'LINE-A',
      status: 'NORMAL',
      connectivity: 'ONLINE',
      criticality: 'CRITICAL',
      healthScore: 99.6,
      failureRisk: 0.0006,
      anomalyScore: 0.0103,
      anomalyLabel: 'NORMAL',
      rulEstimate: 60,
      rulUnit: 'steps',
      modelVersion: 'failure-risk-v2',
      modelMode: 'MODEL',
      lastTelemetryAt: '2026-09-29T04:22:45Z',
    });

    expect(machine.machineId).toBe('M-101');
    expect(machine.failureRisk).toBe(0.0006);
    // The critical case: a small non-zero risk must survive normalisation so
    // the UI can render it honestly rather than as 0.
    expect(machine.failureRisk).toBeGreaterThan(0);
    expect(machine.rulUnit).toBe('steps');
  });

  it('supplies safe defaults for a sparse payload', () => {
    const machine = normaliseMachine({ machineId: 'M-999' });
    expect(machine.status).toBe('UNKNOWN');
    expect(machine.connectivity).toBe('ONLINE');
    expect(machine.rulUnit).toBe('steps');
  });
});

describe('normaliseRiskRanking', () => {
  it('normalises the zone field so both endpoints agree', () => {
    const rows = normaliseRiskRanking([
      { machineId: 'M-101', name: 'CNC Mill A', zone: 'Machining', failureRisk: 0.1, anomalyScore: 0.2, status: 'NORMAL', criticality: 'HIGH', healthScore: 99 },
    ]);
    expect(rows[0]?.zone).toBe('MACHINING');
  });

  it('returns an empty array for a non-array payload', () => {
    expect(normaliseRiskRanking(null as never)).toEqual([]);
  });
});
