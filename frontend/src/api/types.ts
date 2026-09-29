/**
 * TypeScript mirrors of the ForgeSense backend contract.
 *
 * Every shape here was captured from a live response of the running backend
 * (not inferred from prose documentation). Where the backend is loose — mixed
 * enum casing, string-or-object unions, absent fields — the type is widened
 * deliberately and the normalisation happens in `adapters.ts`, so a single
 * adapter can be corrected if the backend tightens its contract.
 *
 * Enums below are copied from the authoritative Java sources:
 *   machine/domain/MachineState.java
 *   alert/domain/AlertStatus.java, AlertSeverity.java
 *   maintenance/domain/MaintenanceStatus.java, MaintenancePriority.java
 *   machine/domain/Criticality.java, MachineType.java, SensorType.java
 *   simulation/domain/ScenarioType.java
 *   common/domain/EventType.java
 */

/* ------------------------------------------------------------------ *
 * Enums (authoritative backend values)
 * ------------------------------------------------------------------ */

export const MACHINE_STATES = [
  'ONLINE',
  'NORMAL',
  'DEGRADED',
  'WARNING',
  'CRITICAL',
  'MAINTENANCE',
  'OFFLINE',
  'RECOVERING',
] as const;
export type MachineState = (typeof MACHINE_STATES)[number];

export const ALERT_STATUSES = ['NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const ALERT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const MAINTENANCE_STATUSES = ['RECOMMENDED', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const MAINTENANCE_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];

export const CRITICALITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Criticality = (typeof CRITICALITIES)[number];

export const MACHINE_TYPES = [
  'CNC_MILL',
  'INDUSTRIAL_MOTOR',
  'HYDRAULIC_PUMP',
  'CONVEYOR_DRIVE_MOTOR',
  'COMPRESSOR',
  'ROBOTIC_ARM',
  'COOLING_UNIT',
  'GENERATOR',
] as const;
export type MachineType = (typeof MACHINE_TYPES)[number];

/** Sensor keys + units come from machine/domain/SensorType.java. */
export const SENSOR_UNITS = {
  temperature: { label: 'Temperature', unit: '°C' },
  vibration: { label: 'Vibration', unit: 'mm/s' },
  pressure: { label: 'Pressure', unit: 'bar' },
  rpm: { label: 'Rotational speed', unit: 'rpm' },
  torque: { label: 'Torque', unit: 'Nm' },
  current: { label: 'Current', unit: 'A' },
  voltage: { label: 'Voltage', unit: 'V' },
  power: { label: 'Power', unit: 'kW' },
  flow: { label: 'Flow', unit: 'L/min' },
  frequency: { label: 'Frequency', unit: 'Hz' },
} as const;
export type SensorKey = keyof typeof SENSOR_UNITS;

export const SCENARIO_TYPES = [
  'NONE',
  'DEGRADATION',
  'OVERHEATING',
  'BEARING_FAILURE',
  'VIBRATION_SPIKE',
  'RPM_INSTABILITY',
  'CURRENT_SPIKE',
  'SENSOR_FAILURE',
  'MACHINE_OFFLINE',
  'LOAD_INCREASE',
  'MAINTENANCE',
  'RECOVERY',
] as const;
export type ScenarioType = (typeof SCENARIO_TYPES)[number];

export const EVENT_TYPES = [
  'TELEMETRY_RECEIVED',
  'TELEMETRY_NORMALIZED',
  'MACHINE_STATE_CHANGED',
  'ANOMALY_DETECTED',
  'PREDICTION_UPDATED',
  'FAILURE_RISK_CHANGED',
  'ALERT_CREATED',
  'ALERT_ACKNOWLEDGED',
  'ALERT_INVESTIGATING',
  'ALERT_RESOLVED',
  'MAINTENANCE_CREATED',
  'MAINTENANCE_STARTED',
  'MAINTENANCE_COMPLETED',
  'SIMULATION_STARTED',
  'SIMULATION_COMPLETED',
  'MACHINE_OFFLINE',
  'MACHINE_RECOVERED',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ANOMALY_LABELS = ['NORMAL', 'WATCH', 'ANOMALY'] as const;
export type AnomalyLabel = (typeof ANOMALY_LABELS)[number];

/** ML inference mode. HEURISTIC means the ML service was unreachable. */
export type ModelMode = 'MODEL' | 'HEURISTIC';

export type Role = 'OPERATOR' | 'ENGINEER' | 'ADMIN' | 'VIEWER';

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

export interface AuthToken {
  accessToken: string;
  username?: string;
  roles: string[];
  expiresIn?: number;
  tokenType?: string;
}

/* ------------------------------------------------------------------ *
 * Machines
 * ------------------------------------------------------------------ */

/** GET /api/v1/machines (summary row, as returned today). */
export interface Machine {
  machineId: string;
  name: string;
  type: MachineType | string;
  typeLabel: string;
  zone: string;
  line: string;
  status: MachineState | string;
  connectivity: 'ONLINE' | 'OFFLINE' | string;
  criticality: Criticality | string;
  healthScore: number;
  failureRisk: number;
  anomalyScore: number;
  anomalyLabel: AnomalyLabel | string;
  rulEstimate: number;
  rulUnit: 'steps' | string;
  modelVersion: string;
  modelMode: ModelMode | string;
  lastTelemetryAt: string | null;
}

/** GET /api/v1/machines/{id} (detail row — superset of Machine). */
export interface MachineDetail extends Machine {
  description: string;
  sensors: string[];
  operatingHours: number;
  throughputPerHour: number;
  maintenanceStatus: string;
  lastMaintenance: string | null;
  nextMaintenance: string | null;
  position: { x: number; y: number; z: number } | null;
}

/* ------------------------------------------------------------------ *
 * Telemetry
 * ------------------------------------------------------------------ */

/** One telemetry reading. All sensor fields are optional; the simulator
 *  only populates the sensors a machine type actually carries. */
export interface TelemetryReading {
  machineId: string;
  timestamp: string;
  sequence: number;
  temperature?: number;
  vibration?: number;
  pressure?: number;
  rpm?: number;
  torque?: number;
  current?: number;
  voltage?: number;
  power?: number;
  flow?: number;
  frequency?: number;
  airTemperature?: number;
  operatingHours?: number;
  machineType?: string;
}

export interface TelemetryRangeResponse {
  machineId: string;
  basis: string;
  rows: Omit<TelemetryReading, 'machineId'>[];
}

export interface TelemetryStatus {
  dataBasis: string;
  inputTransport: string;
  transport: string;
  source: string;
  pollIntervalSeconds: number;
  telemetryPerMinute: number;
  streaming: boolean;
}

/* ------------------------------------------------------------------ *
 * Predictions
 * ------------------------------------------------------------------ */

/**
 * One attribution factor.
 *
 * IMPORTANT — `contribution` is NOT a percentage. It is a signed delta on the
 * model's output probability when that feature is replaced with the training
 * baseline (see ml-service/app/explanation.py). It is unitless and is
 * rendered as a probability delta, never as "%".
 */
export interface Factor {
  feature: string;
  contribution: number;
  label: 'ELEVATED' | 'REDUCED' | 'NEUTRAL';
  direction: 'up' | 'down' | 'flat';
}

export interface Prediction {
  id: string;
  machineId: string;
  timestamp: string;
  failureRisk: number;
  anomalyScore: number;
  anomalyLabel: AnomalyLabel | string;
  healthScore: number;
  modelVersion: string;
  mode: ModelMode | string;
  factors: Factor[];
}

export interface Explanation {
  machineId: string;
  mode: ModelMode | string;
  failureRisk: number;
  anomalyScore: number;
  timestamp: string;
  factors: Factor[];
}

/* ------------------------------------------------------------------ *
 * Alerts
 * ------------------------------------------------------------------ */

export interface Alert {
  id: string;
  machineId: string;
  machineName: string;
  machineType?: string;
  severity: AlertSeverity | string;
  status: AlertStatus | string;
  type: string;
  source: string;
  correlationId?: string;
  headline: string;
  description: string;
  factorsSummary?: string;
  recommendedAction?: string;
  riskAtCreation?: number;
  openedAt: string;
  updatedAt?: string;
}

export interface AlertListResponse {
  total: number;
  statusFilter: string;
  items: Alert[];
}

/* ------------------------------------------------------------------ *
 * Maintenance
 * ------------------------------------------------------------------ */

export interface MaintenanceRecord {
  id: string;
  machineId: string;
  machineName: string;
  title: string;
  description: string;
  reason: string;
  priority: MaintenancePriority | string;
  status: MaintenanceStatus | string;
  assignedRole?: string;
  recommendedAction?: string;
  riskAtCreation?: number;
  estimatedDurationMinutes?: number;
  createdAt: string;
  scheduledAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

/* ------------------------------------------------------------------ *
 * Analytics
 * ------------------------------------------------------------------ */

export interface AnalyticsOverview {
  machinesOnline: number;
  machinesTotal: number;
  machinesAtRisk: number;
  criticalAlerts: number;
  averageFleetHealth: number;
  activeMaintenance: number;
  productionEfficiency: { value: number; label: string };
  telemetryThroughputPerMinute: number;
  estimatedDowntimeRiskMinutes: number;
  dataBasis: string[];
}

export interface RiskRankingRow {
  machineId: string;
  name: string;
  type: string;
  /** NOTE: risk-ranking returns the zone *name* ("Machining") while
   *  /machines returns the zone *code* ("MACHINING"). Normalised in adapters. */
  zone: string;
  failureRisk: number;
  anomalyScore: number;
  status: string;
  criticality: string;
  healthScore: number;
}

export interface AlertStats {
  open: number;
  new: number;
  investigating: number;
  resolvedToday: number;
  basis: string;
}

export interface FleetHealth {
  machines: { machineId: string; healthScore: number; failureRisk: number }[];
  basis: string;
}

export interface MaintenanceStats {
  recommended: number;
  scheduled: number;
  active: number;
  completed: number;
  basis: string;
}

export interface EventFrequency {
  telemetry: number;
  alerts: number;
  maintenance: number;
  simulations: number;
  basis: string;
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

export interface EventLogEntry {
  id: number;
  machineId: string | null;
  eventType: EventType | string;
  eventTime: string;
  detail: string;
  source: string;
}

export interface EventListResponse {
  count: number;
  items: EventLogEntry[];
}

/* ------------------------------------------------------------------ *
 * Factory / topology
 * ------------------------------------------------------------------ */

export interface Factory {
  id: string;
  code: string;
  name: string;
  location?: string;
}

export interface Zone {
  id: string;
  code: string;
  name: string;
  factoryCode: string;
  order: number;
}

export type DependencyRelation = 'MATERIAL' | 'POWER' | 'COOLING' | 'SERVICE';

export interface DependencyEdge {
  id: string;
  upstream: string;
  downstream: string;
  relation: DependencyRelation | string;
  propagationFactor: number;
  delayMinutes: number;
}

/* ------------------------------------------------------------------ *
 * Impact
 * ------------------------------------------------------------------ */

export interface ProductionImpact {
  id?: string;
  originMachineId: string;
  affectedMachineCount: number;
  affectedMachineIds?: string[];
  affectedLines?: string[];
  estimatedDowntimeMinutes: number;
  productionLossUnits: number;
  throughputLossUnits?: number;
  criticality?: string;
  simulated: boolean;
  dataLabel: string;
  assumptionsJson: string;
  recoveryAssumption?: string;
  createdAt: string;
}

export interface ImpactResponse {
  latest?: ProductionImpact | null;
  history: ProductionImpact[];
}

/* ------------------------------------------------------------------ *
 * Simulation
 * ------------------------------------------------------------------ */

export interface SimulationRun {
  id: string;
  name: string;
  machineId: string;
  machineName: string;
  scenarioType: ScenarioType | string;
  severity: number;
  status: string;
  affectedMachineCount: number;
  affectedMachineIds?: string[];
  expectedDowntimeMinutes: number;
  productionLossUnits: number;
  throughputLossUnits?: number;
  failureHorizonMinutes?: number;
  result?: Record<string, unknown>;
  createdAt: string;
}

export interface SimulationControl {
  machineId: string;
  scenario: ScenarioType | string;
  severity: number;
  active: boolean;
  paused: boolean;
  startedAt: string | null;
}

export interface SimulatorConfig {
  paused: boolean;
  machines: { machineId: string; scenario: string; severity: number; active: boolean; paused: boolean }[];
}

/* ------------------------------------------------------------------ *
 * System
 * ------------------------------------------------------------------ */

export interface SystemStatus {
  application: string;
  demoMode: boolean;
  streaming: boolean;
  transport: string;
  pollIntervalSeconds: number;
  inputTransport: string;
  database: string;
  mlServiceAvailable: boolean;
  mlModelVersion: string | null;
  anomalyModelVersion: string | null;
  simulationPaused: boolean;
  webSocketConnections: number;
  definedMachines: number;
  dataBasis: string[];
}

export interface HealthComponent {
  status: string;
  details?: Record<string, unknown>;
}

export interface ActuatorHealth {
  status: string;
  components?: Record<string, HealthComponent>;
}

/* ------------------------------------------------------------------ *
 * Realtime envelope (common/domain/EventEnvelope.java)
 * ------------------------------------------------------------------ */

export const LIVE_TOPICS = [
  'telemetry.updated',
  'machine.updated',
  'machine.state.changed',
  'prediction.updated',
  'alert.created',
  'alert.updated',
  'maintenance.created',
  'maintenance.updated',
  'simulation.updated',
  'simulation.control.updated',
  'simulation.global.updated',
  'events.updated',
  'impact.updated',
] as const;
export type LiveTopic = (typeof LIVE_TOPICS)[number];

export interface RealtimeEnvelope {
  event: LiveTopic;
  eventId: string;
  sequence: number;
  timestamp: string;
  assetId?: string;
  payload: Record<string, unknown>;
}
