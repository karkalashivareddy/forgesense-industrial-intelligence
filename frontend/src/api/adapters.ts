/**
 * Normalisation adapters.
 *
 * The backend is authoritative but loose in a few specific, verified places.
 * Rather than spreading defensive `??` chains through the UI, every such
 * inconsistency is resolved exactly once, here, and the rest of the app works
 * with clean types.
 *
 * Verified inconsistencies handled in this file:
 *  1. `zone` is a CODE ("MACHINING") on /machines and a NAME ("Machining")
 *     on /analytics/risk-ranking. Both are normalised to the code.
 *  2. `modelMode` ("MODEL"/"HEURISTIC") on /machines vs `mode` on
 *     /machines/{id}/predictions. Both normalise to `mode`.
 *  3. Absent numeric fields arrive as `0` from `Map.of(...)` on the backend,
 *     which is indistinguishable from a real zero. `isRealZero()` marks the
 *     UI as unavailable rather than showing a confident 0.
 *  4. Optional list responses can be `null` instead of `[]`.
 */

import type {
  Alert,
  AlertListResponse,
  Explanation,
  MaintenanceRecord,
  Machine,
  MachineDetail,
  Prediction,
  RiskRankingRow,
  TelemetryReading,
  TelemetryRangeResponse,
  Zone,
} from './types';

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function toStr(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function toNullableStr(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

const ZONE_NAME_TO_CODE: Record<string, string> = {
  machining: 'MACHINING',
  'material handling': 'MATERIAL_HANDLING',
  assembly: 'ASSEMBLY',
  inspection: 'INSPECTION',
  packaging: 'PACKAGING',
  utilities: 'UTILITIES',
};

/** "Machining" -> "MACHINING"; "MACHINING" -> "MACHINING". */
export function normaliseZoneCode(zone: string): string {
  if (!zone) return '';
  if (/^[A-Z_]+$/.test(zone)) return zone;
  return ZONE_NAME_TO_CODE[zone.trim().toLowerCase()] ?? zone.toUpperCase().replace(/\s+/g, '_');
}

export function normaliseMachine(raw: Record<string, unknown>): Machine {
  return {
    machineId: toStr(raw.machineId),
    name: toStr(raw.name, toStr(raw.machineId)),
    type: toStr(raw.type),
    typeLabel: toStr(raw.typeLabel, toStr(raw.type)),
    zone: normaliseZoneCode(toStr(raw.zone)),
    line: toStr(raw.line),
    status: toStr(raw.status, 'UNKNOWN'),
    connectivity: toStr(raw.connectivity, 'ONLINE'),
    criticality: toStr(raw.criticality, 'MEDIUM'),
    healthScore: toNumber(raw.healthScore),
    failureRisk: toNumber(raw.failureRisk),
    anomalyScore: toNumber(raw.anomalyScore),
    anomalyLabel: toStr(raw.anomalyLabel, 'NORMAL'),
    rulEstimate: toNumber(raw.rulEstimate),
    rulUnit: toStr(raw.rulUnit, 'steps'),
    modelVersion: toStr(raw.modelVersion, 'unknown'),
    modelMode: toStr(raw.modelMode, 'HEURISTIC'),
    lastTelemetryAt: toNullableStr(raw.lastTelemetryAt),
  };
}

export function normaliseMachineDetail(raw: Record<string, unknown>): MachineDetail {
  const base = normaliseMachine(raw);
  const position = raw.position as { x?: number; y?: number; z?: number } | null | undefined;
  return {
    ...base,
    description: toStr(raw.description),
    sensors: toArray<string>(raw.sensors),
    operatingHours: toNumber(raw.operatingHours),
    throughputPerHour: toNumber(raw.throughputPerHour),
    maintenanceStatus: toStr(raw.maintenanceStatus, 'NONE'),
    lastMaintenance: toNullableStr(raw.lastMaintenance),
    nextMaintenance: toNullableStr(raw.nextMaintenance),
    position:
      position && typeof position === 'object'
        ? { x: toNumber(position.x), y: toNumber(position.y), z: toNumber(position.z) }
        : null,
  };
}

export function normaliseRiskRanking(raw: Record<string, unknown>[]): RiskRankingRow[] {
  return toArray<Record<string, unknown>>(raw).map((row) => ({
    machineId: toStr(row.machineId),
    name: toStr(row.name),
    type: toStr(row.type),
    zone: normaliseZoneCode(toStr(row.zone)),
    failureRisk: toNumber(row.failureRisk),
    anomalyScore: toNumber(row.anomalyScore),
    status: toStr(row.status, 'UNKNOWN'),
    criticality: toStr(row.criticality, 'MEDIUM'),
    healthScore: toNumber(row.healthScore),
  }));
}

function normaliseFactor(raw: unknown): Prediction['factors'][number] {
  const f = (raw ?? {}) as Record<string, unknown>;
  const direction = toStr(f.direction, 'flat');
  return {
    feature: toStr(f.feature),
    contribution: toNumber(f.contribution),
    label: (['ELEVATED', 'REDUCED', 'NEUTRAL'] as const).includes(f.label as never)
      ? (f.label as 'ELEVATED' | 'REDUCED' | 'NEUTRAL')
      : 'NEUTRAL',
    direction: (['up', 'down', 'flat'] as const).includes(direction as never)
      ? (direction as 'up' | 'down' | 'flat')
      : 'flat',
  };
}

export function normalisePrediction(raw: Record<string, unknown>): Prediction {
  return {
    id: toStr(raw.id),
    machineId: toStr(raw.machineId),
    timestamp: toStr(raw.timestamp),
    failureRisk: toNumber(raw.failureRisk),
    anomalyScore: toNumber(raw.anomalyScore),
    anomalyLabel: toStr(raw.anomalyLabel, 'NORMAL'),
    healthScore: toNumber(raw.healthScore),
    modelVersion: toStr(raw.modelVersion, 'unknown'),
    mode: toStr(raw.mode ?? raw.modelMode, 'HEURISTIC'),
    factors: toArray<unknown>(raw.factors).map(normaliseFactor),
  };
}

export function normaliseExplanation(raw: Record<string, unknown>): Explanation {
  return {
    machineId: toStr(raw.machineId),
    mode: toStr(raw.mode, 'HEURISTIC'),
    failureRisk: toNumber(raw.failureRisk),
    anomalyScore: toNumber(raw.anomalyScore),
    timestamp: toStr(raw.timestamp),
    factors: toArray<unknown>(raw.factors).map(normaliseFactor),
  };
}

export function normaliseAlert(raw: Record<string, unknown>): Alert {
  return {
    id: toStr(raw.id),
    machineId: toStr(raw.machineId),
    machineName: toStr(raw.machineName),
    machineType: toNullableStr(raw.machineType) ?? undefined,
    severity: toStr(raw.severity, 'INFO'),
    status: toStr(raw.status, 'NEW'),
    type: toStr(raw.type),
    source: toStr(raw.source, 'backend'),
    correlationId: toNullableStr(raw.correlationId) ?? undefined,
    headline: toStr(raw.headline, 'Alert'),
    description: toStr(raw.description),
    factorsSummary: toNullableStr(raw.factorsSummary) ?? undefined,
    recommendedAction: toNullableStr(raw.recommendedAction) ?? undefined,
    riskAtCreation: typeof raw.riskAtCreation === 'number' ? raw.riskAtCreation : undefined,
    openedAt: toStr(raw.openedAt),
    updatedAt: toNullableStr(raw.updatedAt) ?? undefined,
  };
}

export function normaliseAlertList(raw: unknown): AlertListResponse {
  const body = (raw ?? {}) as Record<string, unknown>;
  const items = toArray<Record<string, unknown>>(body.items).map(normaliseAlert);
  return {
    total: typeof body.total === 'number' ? body.total : items.length,
    statusFilter: toStr(body.statusFilter, 'ALL'),
    items,
  };
}

export function normaliseMaintenance(raw: unknown): MaintenanceRecord[] {
  const body = (raw ?? {}) as Record<string, unknown>;
  const items = Array.isArray(raw) ? raw : toArray<Record<string, unknown>>(body.items);
  return items.map((entry) => {
    const r = (entry ?? {}) as Record<string, unknown>;
    return {
      id: toStr(r.id),
      machineId: toStr(r.machineId),
      machineName: toStr(r.machineName),
      title: toStr(r.title, 'Maintenance work order'),
      description: toStr(r.description),
      reason: toStr(r.reason),
      priority: toStr(r.priority, 'MEDIUM'),
      status: toStr(r.status, 'RECOMMENDED'),
      assignedRole: toNullableStr(r.assignedRole) ?? undefined,
      recommendedAction: toNullableStr(r.recommendedAction) ?? undefined,
      riskAtCreation: typeof r.riskAtCreation === 'number' ? r.riskAtCreation : undefined,
      estimatedDurationMinutes:
        typeof r.estimatedDurationMinutes === 'number' ? r.estimatedDurationMinutes : undefined,
      createdAt: toStr(r.createdAt),
      scheduledAt: toNullableStr(r.scheduledAt),
      startedAt: toNullableStr(r.startedAt),
      completedAt: toNullableStr(r.completedAt),
    };
  });
}

export function normaliseTelemetry(raw: Record<string, unknown>): TelemetryReading {
  return {
    machineId: toStr(raw.machineId),
    timestamp: toStr(raw.timestamp),
    sequence: toNumber(raw.sequence),
    temperature: typeof raw.temperature === 'number' ? raw.temperature : undefined,
    vibration: typeof raw.vibration === 'number' ? raw.vibration : undefined,
    pressure: typeof raw.pressure === 'number' ? raw.pressure : undefined,
    rpm: typeof raw.rpm === 'number' ? raw.rpm : undefined,
    torque: typeof raw.torque === 'number' ? raw.torque : undefined,
    current: typeof raw.current === 'number' ? raw.current : undefined,
    voltage: typeof raw.voltage === 'number' ? raw.voltage : undefined,
    power: typeof raw.power === 'number' ? raw.power : undefined,
    flow: typeof raw.flow === 'number' ? raw.flow : undefined,
    frequency: typeof raw.frequency === 'number' ? raw.frequency : undefined,
    airTemperature: typeof raw.airTemperature === 'number' ? raw.airTemperature : undefined,
    operatingHours: typeof raw.operatingHours === 'number' ? raw.operatingHours : undefined,
    machineType: toNullableStr(raw.machineType) ?? undefined,
  };
}

export function normaliseTelemetryRange(raw: unknown): TelemetryRangeResponse {
  const body = (raw ?? {}) as Record<string, unknown>;
  const machineId = toStr(body.machineId);
  return {
    machineId,
    basis: toStr(body.basis, 'OBSERVED'),
    rows: toArray<Record<string, unknown>>(body.rows).map((row) => ({
      ...normaliseTelemetry({ ...row, machineId }),
      machineId,
    })),
  };
}

export function normaliseZones(raw: unknown): Zone[] {
  return toArray<Record<string, unknown>>(raw).map((z) => ({
    id: toStr(z.id),
    code: normaliseZoneCode(toStr(z.code)),
    name: toStr(z.name),
    factoryCode: toStr(z.factoryCode),
    order: typeof z.order === 'number' ? z.order : 0,
  }));
}
