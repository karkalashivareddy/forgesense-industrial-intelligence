/**
 * API adapter contract tests.
 *
 * These lock the envelope discipline between the Spring backend and the
 * frontend query layer. Collection endpoints are inconsistent by design:
 * some return a bare JSON array, others a paged { total, items } object.
 * An adapter that guesses wrong silently yields an empty list, which looks
 * identical to "no data" in the UI and hides real records.
 *
 * The shapes below are captured from the running backend; see
 * docs/audit/FINAL_FRONTEND_REDESIGN_REPORT.md.
 */

import { describe, expect, it } from 'vitest';
import {
  normaliseAlertList,
  normaliseMaintenance,
  normaliseRiskRanking,
  normaliseZones,
} from '../src/api/adapters';

describe('normaliseMaintenance', () => {
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

  it('reads the paged envelope returned by GET /api/v1/maintenance', () => {
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
  });

  it('preserves every record when the backlog is large', () => {
    const many = Array.from({ length: 18 }, (_, i) => ({ ...record, id: `wo-${i}` }));
    expect(normaliseMaintenance({ total: 18, items: many })).toHaveLength(18);
  });
});

describe('collection envelope handling', () => {
  it('reads the bare array from GET /api/v1/zones', () => {
    expect(normaliseZones([{ id: 'z1', code: 'CUTTING', name: 'Cutting' }])).toHaveLength(1);
  });

  it('reads the bare array from GET /api/v1/analytics/risk-ranking', () => {
    expect(normaliseRiskRanking([{ machineId: 'M-101', name: 'CNC Mill A' }])).toHaveLength(1);
  });

  it('reads the paged envelope from GET /api/v1/alerts', () => {
    const result = normaliseAlertList({ statusFilter: 'ALL', total: 3, items: [{ id: 'a1' }] });

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(1);
  });
});
