/**
 * API adapter contract tests.
 *
 * These lock the envelope discipline between the Spring backend and the
 * frontend query layer. Collection endpoints are inconsistent by design and
 * that inconsistency is verified, not assumed:
 *
 *   bare array     /zones  /factories  /machines  /machines/dependencies/edge
 *                  /machines/{id}/events  /machines/{id}/predictions
 *                  /simulation/control  /simulation/scenarios
 *   { items, ... } /alerts {items,total,statusFilter}
 *                  /maintenance {items,total}   /events {items,count}
 *   { rows, ... }  /machines/{id}/telemetry {rows,basis,machineId}
 *
 * An adapter that guesses wrong yields `[]`, which is indistinguishable from
 * a legitimately empty result. The type checker cannot see it and no
 * component assertion catches it, which is exactly how the maintenance board
 * and the machine inspector's event list both rendered as permanently empty
 * while their nav counters read 18 and 50.
 *
 * Every shape below was captured from the running backend via
 * `docs/audit/API_CONTRACT_MATRIX.md`.
 */

import { describe, expect, it } from 'vitest';
import {
  normaliseAlertList,
  normaliseEventList,
  normaliseMaintenance,
  normaliseRiskRanking,
  normaliseTelemetryRange,
  normaliseZones,
} from '../src/api/adapters';

describe('normaliseMaintenance — GET /api/v1/maintenance', () => {
  const record = {
    id: 'wo-1',
    machineId: 'M-101',
    machineName: 'CNC Mill A',
    title: 'Recommended inspection - M-101',
    description: 'Bearing vibration trending up',
    reason: 'risk threshold crossed',
    priority: 'HIGH',
    status: 'RECOMMENDED',
    assignedRole: 'ROLE_ENGINEER',
    recommendedAction: 'Inspect spindle bearings',
    riskAtCreation: 0.0006,
    estimatedDurationMinutes: 45,
    createdAt: '2026-01-01T00:00:00Z',
  };

  it('reads the paged envelope { total, items }', () => {
    const orders = normaliseMaintenance({ total: 18, items: [record] });

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: 'wo-1',
      machineId: 'M-101',
      status: 'RECOMMENDED',
      priority: 'HIGH',
      riskAtCreation: 0.0006,
      estimatedDurationMinutes: 45,
    });
  });

  it('still accepts a bare array', () => {
    expect(normaliseMaintenance([record])).toHaveLength(1);
  });

  it('degrades to an empty list rather than throwing on bad input', () => {
    expect(normaliseMaintenance(null)).toEqual([]);
    expect(normaliseMaintenance(undefined)).toEqual([]);
    expect(normaliseMaintenance({})).toEqual([]);
    expect(normaliseMaintenance({ total: 0, items: null })).toEqual([]);
  });

  it('preserves every record in a full backlog', () => {
    const many = Array.from({ length: 18 }, (_, i) => ({ ...record, id: `wo-${i}` }));
    expect(normaliseMaintenance({ total: 18, items: many })).toHaveLength(18);
  });
});

describe('normaliseEventList — the two event endpoints differ', () => {
  const entry = {
    id: 1,
    machineId: 'M-101',
    eventType: 'PREDICTION',
    eventTime: '2026-01-01T00:00:00Z',
    detail: 'Prediction updated',
    source: 'backend',
  };

  it('reads the { items, count } envelope from GET /api/v1/events', () => {
    const result = normaliseEventList({ items: [entry], count: 50 });

    expect(result.count).toBe(50);
    expect(result.items).toHaveLength(1);
  });

  it('reads the BARE ARRAY from GET /api/v1/machines/{id}/events', () => {
    // This endpoint returns a bare array on the wire. Reading it as an
    // envelope left the machine inspector's event list permanently empty.
    const result = normaliseEventList([entry, { ...entry, id: 2 }]);

    expect(result.items).toHaveLength(2);
    expect(result.count).toBe(2);
  });

  it('reports a genuine zero count as zero, not as a failure', () => {
    expect(normaliseEventList({ items: [], count: 0 })).toEqual({ count: 0, items: [] });
    expect(normaliseEventList([])).toEqual({ count: 0, items: [] });
  });
});

describe('normaliseAlertList — GET /api/v1/alerts', () => {
  it('reads { statusFilter, total, items }', () => {
    const result = normaliseAlertList({
      statusFilter: 'ALL',
      total: 3,
      items: [{ id: 'a1', machineId: 'M-101', severity: 'CRITICAL' }],
    });

    expect(result.total).toBe(3);
    expect(result.statusFilter).toBe('ALL');
    expect(result.items).toHaveLength(1);
  });

  it('falls back to items.length when total is absent or non-numeric', () => {
    expect(normaliseAlertList({ items: [{ id: 'a1' }] }).total).toBe(1);
    expect(normaliseAlertList({ total: 'many', items: [{ id: 'a1' }] }).total).toBe(1);
  });
});

describe('normaliseTelemetryRange — GET /api/v1/machines/{id}/telemetry', () => {
  it('reads the { rows, basis, machineId } envelope', () => {
    const result = normaliseTelemetryRange({
      machineId: 'M-101',
      basis: 'SYNTHETIC',
      rows: [
        { machineId: 'M-101', sequence: 7, timestamp: '2026-01-01T00:00:00Z', temperature: 61.2, vibration: 2.4 },
      ],
    });

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(result.machineId).toBe('M-101');
    expect(result.basis).toBe('SYNTHETIC');
    expect(row?.sequence).toBe(7);
    expect(row?.temperature).toBeCloseTo(61.2);
  });

  it('stamps the requested machineId onto rows that omit it', () => {
    const result = normaliseTelemetryRange({
      machineId: 'M-107',
      rows: [{ sequence: 1, timestamp: '2026-01-01T00:00:00Z' }],
    });

    expect(result.rows[0]?.machineId).toBe('M-107');
  });

  it('leaves absent sensor fields undefined rather than inventing zeros', () => {
    // A confident 0 for a missing sensor would be a fabricated measurement.
    const result = normaliseTelemetryRange({ machineId: 'M-101', rows: [{ sequence: 1 }] });

    expect(result.rows[0]?.temperature).toBeUndefined();
    expect(result.rows[0]?.vibration).toBeUndefined();
  });

  it('defaults basis to OBSERVED when the backend omits it', () => {
    expect(normaliseTelemetryRange({ machineId: 'M-101', rows: [] }).basis).toBe('OBSERVED');
  });
});

describe('collection envelope handling — remaining endpoints', () => {
  it('reads the bare array from GET /api/v1/zones', () => {
    const zones = normaliseZones([{ id: 'z1', code: 'Machining', name: 'Machining' }]);

    expect(zones).toHaveLength(1);
    // zone arrives as a NAME here and a CODE elsewhere.
    expect(zones[0]?.code).toBe('MACHINING');
  });

  it('reads the bare array from GET /api/v1/analytics/risk-ranking', () => {
    const rows = normaliseRiskRanking([{ machineId: 'M-101', name: 'CNC Mill A', zone: 'Material Handling' }]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.zone).toBe('MATERIAL_HANDLING');
  });
});
