/**
 * Machine state derivation tests.
 *
 * These lock the two behaviours operators depend on:
 *  - an asset that stops reporting is never shown as healthy
 *  - a maintenance work order suppresses the health ladder
 */

import { describe, expect, it } from 'vitest';
import {
  ageSeconds,
  anomalyBand,
  anomalyTone,
  deriveOperationalState,
  factoryVerdict,
  healthTone,
  riskBand,
  riskTone,
  summariseFleet,
} from '../src/domain/machineState';
import type { Machine } from '../src/api/types';

const NOW = Date.parse('2026-09-19T12:00:00Z');

function machine(overrides: Partial<Machine> = {}): Machine {
  return {
    machineId: 'M-101',
    name: 'CNC Mill A',
    type: 'CNC_MILL',
    typeLabel: 'CNC Mill',
    zone: 'MACHINING',
    line: 'LINE-A',
    status: 'NORMAL',
    connectivity: 'ONLINE',
    criticality: 'HIGH',
    healthScore: 98,
    failureRisk: 0.01,
    anomalyScore: 0.02,
    anomalyLabel: 'NORMAL',
    rulEstimate: 60,
    rulUnit: 'steps',
    modelVersion: 'failure-risk-v2',
    modelMode: 'MODEL',
    lastTelemetryAt: new Date(NOW - 2_000).toISOString(),
    ...overrides,
  };
}

describe('deriveOperationalState', () => {
  it('reports NORMAL for a healthy, recently reporting asset', () => {
    const state = deriveOperationalState(machine(), NOW);
    expect(state.state).toBe('NORMAL');
    expect(state.backendState).toBe('NORMAL');
    expect(state.isStale).toBe(false);
  });

  it('reports STALE once the feed is healthy but the asset stops reporting', () => {
    const state = deriveOperationalState(
      machine({ lastTelemetryAt: new Date(NOW - 120_000).toISOString() }),
      NOW,
    );
    expect(state.state).toBe('STALE');
    expect(state.isStale).toBe(true);
  });

  it('reports OFFLINE from connectivity even when the reading is fresh', () => {
    const state = deriveOperationalState(machine({ connectivity: 'OFFLINE' }), NOW);
    expect(state.state).toBe('OFFLINE');
  });

  it('keeps MAINTENANCE even when the backend reports a healthy state', () => {
    // The work order must win over the health ladder, otherwise starting
    // maintenance would snap the asset straight back to NORMAL.
    const state = deriveOperationalState(machine({ status: 'MAINTENANCE' }), NOW);
    expect(state.state).toBe('MAINTENANCE');
  });

  it('preserves the backend value alongside the presentation state', () => {
    const state = deriveOperationalState(
      machine({ status: 'CRITICAL', lastTelemetryAt: new Date(NOW - 200_000).toISOString() }),
      NOW,
    );
    expect(state.state).toBe('STALE');
    expect(state.backendState).toBe('CRITICAL');
  });

  it('returns UNKNOWN for a missing machine', () => {
    expect(deriveOperationalState(null, NOW).state).toBe('UNKNOWN');
  });

  it('returns UNKNOWN when the asset has never reported', () => {
    const state = deriveOperationalState(machine({ status: 'UNKNOWN', lastTelemetryAt: null }), NOW);
    expect(state.state).toBe('UNKNOWN');
  });
});

describe('ageSeconds', () => {
  it('computes the age of a timestamp', () => {
    expect(ageSeconds(new Date(NOW - 30_000).toISOString(), NOW)).toBe(30);
  });

  it('returns null for a missing or invalid timestamp', () => {
    expect(ageSeconds(null, NOW)).toBeNull();
    expect(ageSeconds('not-a-date', NOW)).toBeNull();
  });
});

describe('risk and health bands', () => {
  it('mirrors the backend DecisionEngine thresholds', () => {
    expect(riskBand(0.85)).toBe('CRITICAL');
    expect(riskBand(0.6)).toBe('HIGH');
    expect(riskBand(0.35)).toBe('ELEVATED');
    expect(riskBand(0.05)).toBe('LOW');
  });

  it('treats an absent risk as low rather than throwing', () => {
    expect(riskBand(null)).toBe('LOW');
    expect(riskTone(undefined)).toBe('ok');
  });

  it('maps health to a tone', () => {
    expect(healthTone(50)).toBe('crit');
    expect(healthTone(70)).toBe('warn');
    expect(healthTone(95)).toBe('ok');
    expect(healthTone(null)).toBe('idle');
  });

  it('maps anomaly score to a band', () => {
    expect(anomalyBand(0.9)).toBe('ANOMALY');
    expect(anomalyBand(0.5)).toBe('ELEVATED');
    expect(anomalyBand(0.1)).toBe('LOW');
    expect(anomalyTone(0.9)).toBe('crit');
  });
});

describe('summariseFleet', () => {
  const fleet = [
    machine({ machineId: 'M-101' }),
    machine({ machineId: 'M-102', status: 'WARNING' }),
    machine({ machineId: 'M-103', status: 'CRITICAL', failureRisk: 0.9 }),
    machine({ machineId: 'M-104', status: 'MAINTENANCE' }),
    machine({ machineId: 'M-105', connectivity: 'OFFLINE', lastTelemetryAt: null }),
  ];

  it('counts every state exactly once', () => {
    const summary = summariseFleet(fleet, NOW);
    expect(summary.total).toBe(5);
    expect(summary.normal).toBe(1);
    expect(summary.warning).toBe(1);
    expect(summary.critical).toBe(1);
    expect(summary.maintenance).toBe(1);
    expect(summary.offline).toBe(1);
  });

  it('derives the attention count', () => {
    const summary = summariseFleet(fleet, NOW);
    expect(summary.attention).toBe(summary.degraded + summary.warning + summary.critical);
  });

  it('averages health across reporting assets', () => {
    const summary = summariseFleet(fleet, NOW);
    expect(summary.averageHealth).toBeCloseTo(98, 5);
  });

  it('handles an empty fleet without throwing', () => {
    const summary = summariseFleet([], NOW);
    expect(summary.total).toBe(0);
    expect(summary.averageHealth).toBeNull();
  });
});

describe('factoryVerdict', () => {
  it('reports OUTAGE when any asset is offline', () => {
    const summary = summariseFleet([machine({ connectivity: 'OFFLINE', lastTelemetryAt: null })], NOW);
    expect(factoryVerdict(summary).verdict).toBe('OFFLINE');
  });

  it('reports DEGRADED when any asset is critical', () => {
    const summary = summariseFleet([machine({ status: 'CRITICAL' })], NOW);
    expect(factoryVerdict(summary).verdict).toBe('DEGRADED');
  });

  it('reports ATTENTION for warnings', () => {
    const summary = summariseFleet([machine({ status: 'WARNING' })], NOW);
    expect(factoryVerdict(summary).verdict).toBe('ATTENTION');
  });

  it('reports OPERATIONAL for a healthy fleet', () => {
    const summary = summariseFleet([machine(), machine({ machineId: 'M-102' })], NOW);
    expect(factoryVerdict(summary).verdict).toBe('OPERATIONAL');
  });
});
