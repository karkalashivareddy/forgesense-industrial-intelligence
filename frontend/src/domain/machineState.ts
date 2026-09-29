/**
 * Machine operational state.
 *
 * The backend publishes a coarse `MachineState` (NORMAL / DEGRADED / WARNING /
 * CRITICAL / MAINTENANCE / OFFLINE / RECOVERING). Two additional conditions are
 * purely a client concern because the backend cannot observe them from its own
 * state alone:
 *
 *  - STALE  — the feed is up but this asset has stopped reporting. Derived
 *             from `lastTelemetryAt` age.
 *  - UNKNOWN — the asset has never reported at all.
 *
 * These are presentation states layered ON TOP of the backend value, never a
 * replacement for it. `backendState` is always carried alongside so the UI can
 * show what the platform actually said.
 */

import { config } from '../config/env';
import type { Machine } from '../api/types';

export type OperationalState =
  | 'NORMAL'
  | 'DEGRADED'
  | 'WARNING'
  | 'CRITICAL'
  | 'MAINTENANCE'
  | 'OFFLINE'
  | 'RECOVERING'
  | 'STALE'
  | 'UNKNOWN';

export type StateTone = 'ok' | 'warn' | 'crit' | 'maint' | 'idle' | 'info';

export interface StateDescriptor {
  state: OperationalState;
  label: string;
  tone: StateTone;
  /** Short operational guidance shown in the inspector. */
  guidance: string;
}

const DESCRIPTORS: Record<OperationalState, StateDescriptor> = {
  NORMAL: {
    state: 'NORMAL',
    label: 'Normal',
    tone: 'ok',
    guidance: 'Operating inside modelled limits. No action required.',
  },
  DEGRADED: {
    state: 'DEGRADED',
    label: 'Degraded',
    tone: 'warn',
    guidance: 'Performance has drifted from baseline. Monitor the trend.',
  },
  WARNING: {
    state: 'WARNING',
    label: 'Warning',
    tone: 'warn',
    guidance: 'Anomaly or predicted risk is above its operating threshold. Plan an inspection window.',
  },
  CRITICAL: {
    state: 'CRITICAL',
    label: 'Critical',
    tone: 'crit',
    guidance: 'Treat as urgent. Review attribution, open the prediction, and action the maintenance recommendation.',
  },
  MAINTENANCE: {
    state: 'MAINTENANCE',
    label: 'Maintenance',
    tone: 'maint',
    guidance: 'Work order in progress. Excluded from health scoring until returned to service.',
  },
  OFFLINE: {
    state: 'OFFLINE',
    label: 'Offline',
    tone: 'idle',
    guidance: 'The asset has disconnected. Any displayed value is the last known reading, unconfirmed.',
  },
  RECOVERING: {
    state: 'RECOVERING',
    label: 'Recovering',
    tone: 'info',
    guidance: 'Stabilising after an incident. Clears once consecutive healthy readings are confirmed.',
  },
  STALE: {
    state: 'STALE',
    label: 'Stale',
    tone: 'idle',
    guidance: 'The feed is healthy but this asset has stopped reporting. Values are the last known reading.',
  },
  UNKNOWN: {
    state: 'UNKNOWN',
    label: 'Unknown',
    tone: 'idle',
    guidance: 'No telemetry on record for this asset yet.',
  },
};

export function describeState(state: OperationalState): StateDescriptor {
  return DESCRIPTORS[state] ?? DESCRIPTORS.UNKNOWN;
}

/** Seconds since an ISO timestamp, or null when unusable. */
export function ageSeconds(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (now - t) / 1000);
}

export interface DerivedState {
  /** The value the control room renders. */
  state: OperationalState;
  descriptor: StateDescriptor;
  /** The unmodified backend value, for provenance. */
  backendState: string;
  ageSec: number | null;
  isStale: boolean;
}

/**
 * Derive the rendered operational state. `now` is injected so the result is
 * deterministic and unit-testable.
 */
export function deriveOperationalState(
  machine: Pick<Machine, 'status' | 'connectivity' | 'lastTelemetryAt'> | null | undefined,
  now: number = Date.now(),
  staleAfterSec: number = config.staleAfterSec,
): DerivedState {
  if (!machine) {
    return {
      state: 'UNKNOWN',
      descriptor: DESCRIPTORS.UNKNOWN,
      backendState: 'UNKNOWN',
      ageSec: null,
      isStale: false,
    };
  }

  const backendState = String(machine.status ?? 'UNKNOWN').toUpperCase();
  const age = ageSeconds(machine.lastTelemetryAt, now);
  const isStale = age !== null && age > staleAfterSec;

  let state: OperationalState;
  if (machine.connectivity === 'OFFLINE' || backendState === 'OFFLINE') {
    state = 'OFFLINE';
  } else if (backendState === 'MAINTENANCE') {
    state = 'MAINTENANCE';
  } else if (isStale) {
    state = 'STALE';
  } else if (backendState === 'UNKNOWN' && age === null) {
    state = 'UNKNOWN';
  } else {
    const known = backendState as OperationalState;
    state = known in DESCRIPTORS ? known : 'UNKNOWN';
  }

  return { state, descriptor: DESCRIPTORS[state], backendState, ageSec: age, isStale };
}

/** Health score (0-100) -> tone. */
export function healthTone(score: number | undefined | null): StateTone {
  if (score === undefined || score === null || !Number.isFinite(score)) return 'idle';
  if (score < 60) return 'crit';
  if (score < 80) return 'warn';
  return 'ok';
}

/**
 * Failure-risk bands. These mirror DecisionEngine.intent() thresholds in the
 * backend so a risk bar and a machine state never disagree.
 */
export type RiskBand = 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'LOW';

export function riskBand(risk: number | undefined | null): RiskBand {
  const r = typeof risk === 'number' && Number.isFinite(risk) ? risk : 0;
  if (r >= 0.8) return 'CRITICAL';
  if (r >= 0.5) return 'HIGH';
  if (r >= 0.3) return 'ELEVATED';
  return 'LOW';
}

export function riskTone(risk: number | undefined | null): StateTone {
  const band = riskBand(risk);
  if (band === 'CRITICAL') return 'crit';
  if (band === 'HIGH' || band === 'ELEVATED') return 'warn';
  return 'ok';
}

export type AnomalyBand = 'ANOMALY' | 'ELEVATED' | 'LOW';

export function anomalyBand(score: number | undefined | null): AnomalyBand {
  const s = typeof score === 'number' && Number.isFinite(score) ? score : 0;
  if (s >= 0.7) return 'ANOMALY';
  if (s >= 0.45) return 'ELEVATED';
  return 'LOW';
}

export function anomalyTone(score: number | undefined | null): StateTone {
  const band = anomalyBand(score);
  if (band === 'ANOMALY') return 'crit';
  if (band === 'ELEVATED') return 'warn';
  return 'ok';
}

/**
 * Fleet rollup. Every counter is observable, so this is DERIVED, never PREDICTED.
 */
export interface FleetSummary {
  total: number;
  online: number;
  offline: number;
  normal: number;
  degraded: number;
  warning: number;
  critical: number;
  maintenance: number;
  recovering: number;
  stale: number;
  unknown: number;
  /** Assets needing attention = degraded + warning + critical. */
  attention: number;
  averageHealth: number | null;
  atRisk: number;
  newestTelemetryAt: string | null;
  oldestTelemetryAgeSec: number | null;
}

export function summariseFleet(machines: Machine[], now: number = Date.now()): FleetSummary {
  const summary: FleetSummary = {
    total: machines.length,
    online: 0,
    offline: 0,
    normal: 0,
    degraded: 0,
    warning: 0,
    critical: 0,
    maintenance: 0,
    recovering: 0,
    stale: 0,
    unknown: 0,
    attention: 0,
    averageHealth: null,
    atRisk: 0,
    newestTelemetryAt: null,
    oldestTelemetryAgeSec: null,
  };

  const healthValues: number[] = [];
  let newestMs = -Infinity;
  let oldestAge: number | null = null;

  for (const machine of machines) {
    const derived = deriveOperationalState(machine, now);
    summary.online += 1;

    switch (derived.state) {
      case 'NORMAL':
        summary.normal += 1;
        break;
      case 'DEGRADED':
        summary.degraded += 1;
        break;
      case 'WARNING':
        summary.warning += 1;
        break;
      case 'CRITICAL':
        summary.critical += 1;
        break;
      case 'MAINTENANCE':
        summary.maintenance += 1;
        break;
      case 'RECOVERING':
        summary.recovering += 1;
        break;
      case 'OFFLINE':
        summary.offline += 1;
        break;
      case 'STALE':
        summary.stale += 1;
        break;
      default:
        summary.unknown += 1;
    }

    if (typeof machine.healthScore === 'number' && Number.isFinite(machine.healthScore)) {
      healthValues.push(machine.healthScore);
    }
    if (machine.failureRisk >= 0.5) summary.atRisk += 1;

    const ms = machine.lastTelemetryAt ? Date.parse(machine.lastTelemetryAt) : NaN;
    if (!Number.isNaN(ms) && ms > newestMs) newestMs = ms;
    if (derived.ageSec !== null && (oldestAge === null || derived.ageSec > oldestAge)) {
      oldestAge = derived.ageSec;
    }
  }

  summary.attention = summary.degraded + summary.warning + summary.critical;
  summary.averageHealth = healthValues.length
    ? healthValues.reduce((a, b) => a + b, 0) / healthValues.length
    : null;
  summary.newestTelemetryAt = Number.isFinite(newestMs) ? new Date(newestMs).toISOString() : null;
  summary.oldestTelemetryAgeSec = oldestAge;
  return summary;
}

/** Factory-level operating verdict, derived only from observed asset state. */
export type OperationalVerdict = 'OPERATIONAL' | 'ATTENTION' | 'DEGRADED' | 'OFFLINE';

export function factoryVerdict(summary: FleetSummary): {
  verdict: OperationalVerdict;
  tone: StateTone;
  detail: string;
} {
  if (summary.total === 0) {
    return { verdict: 'DEGRADED', tone: 'idle', detail: 'No assets reporting' };
  }
  if (summary.offline > 0) {
    return {
      verdict: 'OFFLINE',
      tone: 'crit',
      detail: `${summary.offline} of ${summary.total} assets offline`,
    };
  }
  if (summary.critical > 0) {
    return {
      verdict: 'DEGRADED',
      tone: 'crit',
      detail: `${summary.critical} asset${summary.critical === 1 ? '' : 's'} in a critical condition`,
    };
  }
  if (summary.attention > 0 || summary.stale > 0) {
    const parts = [summary.attention ? `${summary.attention} need attention` : '', summary.stale ? `${summary.stale} stale` : '']
      .filter(Boolean)
      .join(', ');
    return { verdict: 'ATTENTION', tone: 'warn', detail: parts || 'Monitoring' };
  }
  return { verdict: 'OPERATIONAL', tone: 'ok', detail: 'All assets inside modelled limits' };
}
