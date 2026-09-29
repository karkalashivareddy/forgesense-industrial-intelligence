/**
 * Realtime store.
 *
 * Split deliberately into two stores so that a telemetry packet can never
 * re-render the application shell:
 *
 *   - `useRealtimeStore`  : transport status + live alerts. Low frequency.
 *   - `useTelemetryStore` : high-frequency sensor values. Subscribed ONLY by
 *     the small components that display a specific machine's readings.
 *
 * Selection state lives in its own store so that focusing a machine in the
 * twin does not invalidate unrelated memoised views.
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { config } from '../config/env';
import type { Alert, LiveTopic, RealtimeEnvelope } from '../api/types';
import { normaliseAlert } from '../api/adapters';
import type { TransportStatus } from './stomp';

/* ------------------------------------------------------------------ *
 * Transport + live entity state
 * ------------------------------------------------------------------ */

export interface ConnectionQuality {
  /** The truthful composite label shown in the header. */
  label: 'LIVE' | 'SYNCING' | 'STALE' | 'DEGRADED' | 'OFFLINE' | 'SIMULATED' | 'SYNTHETIC';
  tone: 'ok' | 'warn' | 'crit' | 'idle' | 'info';
  detail: string;
}

interface RealtimeState {
  transport: TransportStatus;
  /** Machine ids whose status/state changed since the last REST snapshot. */
  dirtyMachines: Record<string, number>;
  /** Live alert deltas keyed by alert id (newest wins). */
  liveAlerts: Record<string, Alert>;
  lastRealtimeAt: number | null;
  lastSequence: number;
  reconcileRequestedAt: number | null;
  reconcileReason: string | null;

  applyStatus(status: TransportStatus): void;
  applyEvents(batch: { topic: LiveTopic; event: RealtimeEnvelope }[], now: number): void;
  clearMachineDirty(machineId: string): void;
  clearAllDirty(): void;
  requestReconcile(reason: string, now: number): void;
  noteReconciled(now: number): void;
  reset(): void;
}

const emptyTransport: TransportStatus = {
  state: 'idle',
  detail: null,
  attempt: 0,
  lastEventAt: null,
  lastConnectAt: null,
  eventsApplied: 0,
  duplicatesDropped: 0,
  invalidDropped: 0,
};

export const useRealtimeStore = create<RealtimeState>((set, get) => ({
  transport: emptyTransport,
  dirtyMachines: {},
  liveAlerts: {},
  lastRealtimeAt: null,
  lastSequence: -1,
  reconcileRequestedAt: null,
  reconcileReason: null,

  applyStatus: (status) => set({ transport: status }),

  applyEvents: (batch, now) => {
    if (batch.length === 0) return;

    const dirty: Record<string, number> = { ...get().dirtyMachines };
    let alerts: Record<string, Alert> | null = null;
    let maxSequence = get().lastSequence;
    let newest = get().lastRealtimeAt;

    for (const { topic, event } of batch) {
      if (event.sequence > maxSequence) maxSequence = event.sequence;

      const machineId = (event.payload.machineId ?? event.assetId) as string | undefined;

      switch (topic) {
        case 'telemetry.updated': {
          // Telemetry is applied to the dedicated telemetry store, not here.
          if (machineId) dirty[machineId] = now;
          break;
        }
        case 'machine.updated':
        case 'machine.state.changed':
        case 'prediction.updated': {
          if (machineId) dirty[machineId] = now;
          break;
        }
        case 'alert.created':
        case 'alert.updated': {
          alerts ??= { ...get().liveAlerts };
          const id = String(event.payload.id ?? event.eventId);
          const previous = alerts[id];
          alerts[id] = normaliseAlert({
            ...(previous ?? {}),
            ...(event.payload as Record<string, unknown>),
            id,
            openedAt: (event.payload.openedAt as string) ?? previous?.openedAt ?? event.timestamp,
            updatedAt: event.timestamp,
          });
          if (machineId) dirty[machineId] = now;
          break;
        }
        case 'maintenance.created':
        case 'maintenance.updated':
        case 'simulation.updated':
        case 'simulation.control.updated':
        case 'simulation.global.updated':
        case 'events.updated':
        case 'impact.updated': {
          if (machineId) dirty[machineId] = now;
          // These are low-frequency but authoritative enough to warrant a
          // coalesced REST reconciliation rather than duplicating the whole
          // entity model client-side.
          get().requestReconcile(`topic:${topic}`, now);
          break;
        }
        default:
          break;
      }
    }

    const next: Partial<RealtimeState> = {
      dirtyMachines: dirty,
      lastSequence: maxSequence,
      lastRealtimeAt: newest ?? now,
    };
    if (alerts) next.liveAlerts = alerts;
    set(next as RealtimeState);
  },

  clearMachineDirty: (machineId) => {
    if (!(machineId in get().dirtyMachines)) return;
    const dirty = { ...get().dirtyMachines };
    delete dirty[machineId];
    set({ dirtyMachines: dirty });
  },

  clearAllDirty: () => set({ dirtyMachines: {} }),

  requestReconcile: (reason, now) => {
    const state = get();
    // Throttle: at most one reconciliation request per second.
    if (state.reconcileRequestedAt && now - state.reconcileRequestedAt < 1000) return;
    set({ reconcileRequestedAt: now, reconcileReason: reason });
  },

  noteReconciled: (now) => set({ reconcileRequestedAt: null, reconcileReason: null, dirtyMachines: {}, lastRealtimeAt: now }),

  reset: () =>
    set({
      transport: emptyTransport,
      dirtyMachines: {},
      liveAlerts: {},
      lastRealtimeAt: null,
      lastSequence: -1,
      reconcileRequestedAt: null,
      reconcileReason: null,
    }),
}));

/**
 * Derive the truthful connection label. This is deliberately NOT derived from
 * configuration: a configured Kafka transport is not a healthy transport, and
 * a synthetic simulator feed is never reported as industrial LIVE telemetry.
 */
export function deriveConnectionQuality(
  transport: TransportStatus,
  options: { dataBasis: string; demoMode: boolean; restOk: boolean; restAgeSec: number | null; now: number },
): ConnectionQuality {
  const synthetic = options.dataBasis === 'SYNTHETIC' || options.demoMode;

  if (!options.restOk) {
    return {
      label: 'OFFLINE',
      tone: 'crit',
      detail: transport.state === 'open' ? 'REST snapshots failing' : 'no connection to the backend',
    };
  }

  if (transport.state === 'open') {
    const silentSec = transport.lastEventAt ? (options.now - transport.lastEventAt) / 1000 : null;
    if (silentSec !== null && silentSec > config.transportStaleAfterSec) {
      return {
        label: 'STALE',
        tone: 'warn',
        detail: `realtime silent for ${Math.round(silentSec)}s · REST fallback active`,
      };
    }
    if (synthetic) {
      return {
        label: 'SYNTHETIC',
        tone: 'info',
        detail: 'synthetic simulator feed over live transport',
      };
    }
    return { label: 'LIVE', tone: 'ok', detail: 'live deltas over WebSocket' };
  }

  if (transport.state === 'reconnecting' || transport.state === 'connecting') {
    return {
      label: 'SYNCING',
      tone: 'warn',
      detail: transport.detail ?? 'establishing realtime transport',
    };
  }

  if (options.restAgeSec !== null && options.restAgeSec > config.staleAfterSec) {
    return {
      label: 'STALE',
      tone: 'warn',
      detail: `last snapshot ${Math.round(options.restAgeSec)}s ago`,
    };
  }

  return {
    label: 'DEGRADED',
    tone: 'warn',
    detail: 'realtime unavailable · polling REST snapshots',
  };
}

/* ------------------------------------------------------------------ *
 * High-frequency telemetry store
 * ------------------------------------------------------------------ */

/** Latest reading per machine plus a bounded per-machine ring for sparklines. */
export interface LiveReading {
  machineId: string;
  timestamp: string;
  receivedAt: number;
  sequence: number;
  values: Record<string, number>;
}

interface TelemetryState {
  live: Record<string, LiveReading>;
  /** Rolling window per machine, capped at config.limits.telemetryRing. */
  history: Record<string, { t: number; v: number }[]>;
  /** Per-machine history is only kept for machines someone is watching. */
  watched: Record<string, true>;
  packetsApplied: number;

  pushReading(machineId: string, timestamp: string, values: Record<string, number>, sequence: number, now: number): void;
  watch(machineId: string): void;
  unwatch(machineId: string): void;
  clear(): void;
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  live: {},
  history: {},
  watched: {},
  packetsApplied: 0,

  pushReading: (machineId, timestamp, values, sequence, now) => {
    const state = get();
    const previous = state.live[machineId];
    // Out-of-order / duplicate suppression at the store boundary.
    if (previous && sequence > 0 && previous.sequence > sequence) return;

    const reading: LiveReading = { machineId, timestamp, receivedAt: now, sequence, values };

    if (!state.watched[machineId]) {
      // Not being watched: only the latest value matters. No history growth.
      set({ live: { ...state.live, [machineId]: reading } });
      return;
    }

    const ring = state.history[machineId] ?? [];
    const next = ring.length >= config.limits.telemetryRing ? ring.slice(1) : ring.slice();
    for (const value of Object.values(values)) {
      const existing = next.find((point) => point.t === now);
      if (existing) existing.v = value;
      else next.push({ t: now, v: value });
    }

    set({
      live: { ...state.live, [machineId]: reading },
      history: { ...state.history, [machineId]: next },
      packetsApplied: state.packetsApplied + 1,
    });
  },

  watch: (machineId) => {
    if (get().watched[machineId]) return;
    set({ watched: { ...get().watched, [machineId]: true }, history: { ...get().history, [machineId]: [] } });
  },

  unwatch: (machineId) => {
    if (!get().watched[machineId]) return;
    const watched = { ...get().watched };
    const history = { ...get().history };
    delete watched[machineId];
    delete history[machineId];
    set({ watched, history });
  },

  clear: () => set({ live: {}, history: {}, watched: {}, packetsApplied: 0 }),
}));

/* ------------------------------------------------------------------ *
 * Selectors — stable references so components do not re-render on
 * unrelated state changes.
 * ------------------------------------------------------------------ */

export const selectLiveReading = (machineId: string) => (state: TelemetryState): LiveReading | undefined =>
  state.live[machineId];

export const useLiveReading = (machineId: string | null): LiveReading | undefined =>
  useTelemetryStore(useShallow((state) => (machineId ? state.live[machineId] : undefined)));

export const useTransportStatus = (): TransportStatus => useRealtimeStore((state) => state.transport);
