import { api } from './api.js';
import { deriveMachineState, RECOVERY_CONFIRM } from './util.js';

export const POLL_MS = 3000;

export const store = {
  user: null,
  roles: [],
  machines: [],
  machineMap: new Map(),
  status: null,
  telemetryStatus: null,
  zones: [],
  factories: [],
  dependencies: [],
  alerts: { items: [], total: 0, statusFilter: 'ALL' },
  events: { items: [], count: 0 },
  analytics: null,
  riskRanking: [],
  healthTrends: null,
  alertStats: null,
  maintenanceStats: null,
  eventFreq: null,
  selectedMachineId: null,
  liveTelemetry: {},
  liveTransport: { state: 'closed', detail: null, lastEventAt: null },
  liveEventCount: 0,
  realtimeCursors: {},
  recentRealtimeEvents: {},
  freshness: { ok: false, lastOk: null, polls: 0, failures: 0, lastError: null },
  uiRawStates: {},
  recoverySeen: {},
  derivedAt: null,
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) fn(store);
}

export function set(patch) {
  Object.assign(store, patch);
  notify();
}

export function setFreshness(ok, err = null) {
  const f = store.freshness;
  f.polls += 1;
  f.ok = ok;
  if (ok) {
    f.lastOk = Date.now();
    f.failures = 0;
    f.lastError = null;
  } else {
    f.failures += 1;
    f.lastError = err;
  }
  set({});
}

export function selectMachine(id) {
  store.selectedMachineId = id;
  set({});
}

/**
 * Apply a validated STOMP delta without inventing a second operational state
 * model. The next REST snapshot remains authoritative and can reconcile any
 * missed event after a reconnect.
 */
export function applyRealtimeEvent(topic, event) {
  if (!event || typeof event !== 'object' || !event.payload || typeof event.payload !== 'object') return false;
  const payload = event.payload;
  const now = Date.now();
  const machineId = payload.machineId || event.assetId;
  const cursorKey = `${topic}:${machineId || payload.id || 'global'}`;
  const recent = { ...(store.recentRealtimeEvents || {}) };
  const cursors = { ...(store.realtimeCursors || {}) };
  if (event.eventId && recent[event.eventId]) return false;
  const previous = cursors[cursorKey];
  if (previous && Number.isSafeInteger(event.sequence) && event.sequence <= previous.sequence) return false;
  if (previous && !Number.isSafeInteger(event.sequence) && Date.parse(event.timestamp) <= Date.parse(previous.timestamp)) return false;
  if (event.eventId) {
    recent[event.eventId] = now;
    const ids = Object.entries(recent).sort((a, b) => a[1] - b[1]);
    while (ids.length > 4096) delete recent[ids.shift()[0]];
  }
  cursors[cursorKey] = { sequence: event.sequence, timestamp: event.timestamp };
  const transport = { ...store.liveTransport, lastEventAt: now };
  const accepted = { recentRealtimeEvents: recent, realtimeCursors: cursors, liveTransport: transport };

  if (topic === 'telemetry.updated' && typeof machineId === 'string') {
    const liveTelemetry = { ...store.liveTelemetry, [machineId]: { ...payload, eventId: event.eventId, eventSequence: event.sequence, publishedAt: event.timestamp, receivedAt: now } };
    const machine = store.machineMap.get(machineId);
    if (machine) machine.lastTelemetryAt = payload.timestamp || machine.lastTelemetryAt;
    set({ ...accepted, liveTelemetry, liveEventCount: store.liveEventCount + 1 });
    return true;
  }

  if ((topic === 'machine.updated' || topic === 'machine.state.changed' || topic === 'prediction.updated') && typeof machineId === 'string') {
    const current = store.machineMap.get(machineId);
    if (!current) return false;
    const next = topic === 'machine.state.changed'
      ? { ...current, status: payload.to || current.status, previousStatus: payload.from || current.status }
      : { ...current, ...payload };
    const index = store.machines.findIndex(m => m.machineId === machineId);
    const machines = store.machines.slice();
    if (index >= 0) machines[index] = next;
    const machineMap = new Map(store.machineMap);
    machineMap.set(machineId, next);
    set({ ...accepted, machines, machineMap, liveEventCount: store.liveEventCount + 1 });
    return true;
  }

  if (topic === 'alert.created' || topic === 'alert.updated') {
    const previous = store.alerts || { items: [], total: 0 };
    const identity = payload.id || event.eventId;
    const items = (previous.items || []).filter(item => (item.id || item.eventId) !== identity);
    items.unshift({ ...payload, eventId: event.eventId });
    set({ ...accepted, alerts: { ...previous, items: items.slice(0, 100), total: Math.max(previous.total || 0, items.length) }, liveEventCount: store.liveEventCount + 1 });
    return true;
  }

  if (topic === 'events.updated') {
    const previous = store.events || { items: [], count: 0 };
    const item = payload.eventType ? payload : null;
    const items = item && !(previous.items || []).some(existing => existing.eventId === event.eventId)
      ? [{ ...item, eventId: event.eventId, eventSequence: event.sequence }, ...(previous.items || [])].slice(0, 50)
      : previous.items || [];
    set({ ...accepted, events: { ...previous, items, count: Math.max(previous.count || 0, items.length) }, liveEventCount: store.liveEventCount + 1 });
    return true;
  }

  if (topic.startsWith('maintenance.') || topic.startsWith('simulation.') || topic === 'impact.updated') {
    set({ ...accepted, liveEventCount: store.liveEventCount + 1 });
    return true;
  }
  return false;
}

export function setLiveTransport(state, detail = null) {
  set({ liveTransport: { state, detail, lastEventAt: store.liveTransport.lastEventAt } });
}

export async function initScaffold() {
  try {
    const [zones, factories, dependencies] = await Promise.all([
      api('/api/v1/zones'),
      api('/api/v1/factories'),
      api('/api/v1/machines/dependencies/edge'),
    ]);
    set({ zones: zones || [], factories: factories || [], dependencies: dependencies || [] });
  } catch {
    set({ zones: [], factories: [], dependencies: [] });
  }
}

export async function refreshCore() {
  let ok = true;
  let err = null;
  try {
    const [machines, status, telStatus, alerts, events] = await Promise.all([
      api('/api/v1/machines'),
      api('/api/v1/system/status'),
      api('/api/v1/telemetry/status'),
      api('/api/v1/alerts?limit=100'),
      api('/api/v1/events?limit=50'),
    ]);
    const list = machines || [];
    const machineMap = new Map();
    const rawStates = { ...(store.uiRawStates || {}) };
    const recoveryOld = store.recoverySeen || {};
    const recoveryNext = {};
    const now = Date.now();
    for (const m of list) {
      const baseState = deriveMachineState(m, { now }).state;
      rawStates[m.machineId] = baseState;
      let counter = recoveryOld[m.machineId] || 0;
      if (baseState === 'MAINTENANCE' || baseState === 'OFFLINE' || baseState === 'STALE' || baseState === 'UNKNOWN') {
        counter = 0;
      } else if (baseState === 'CRITICAL' || baseState === 'ESCALATED') {
        counter = 0;
      } else if (baseState === 'NORMAL') {
        const prev = rawStates[m.machineId];
        if (prev === 'CRITICAL' || prev === 'ESCALATED') counter = 1;
        else if (counter > 0) counter += 1;
        if (counter >= RECOVERY_CONFIRM) counter = 0;
      }
      recoveryNext[m.machineId] = counter;
      m.uiState = deriveMachineState(m, {
        now,
        recovering: counter > 0,
        consecutive: counter,
        confirmReadings: RECOVERY_CONFIRM,
      });
      machineMap.set(m.machineId, m);
    }
    set({
      machines: list,
      machineMap,
      status,
      telemetryStatus: telStatus,
      alerts: alerts || { items: [] },
      events: events || { items: [] },
      uiRawStates: rawStates,
      recoverySeen: recoveryNext,
      derivedAt: now,
    });
  } catch (e) {
    ok = false;
    err = e;
  }
  setFreshness(ok, err);
}

export async function refreshAnalytics() {
  try {
    const [overview, alertStats, healthTrends] = await Promise.all([
      api('/api/v1/analytics/overview'),
      api('/api/v1/analytics/alerts'),
      api('/api/v1/analytics/health-trends'),
    ]);
    set({ analytics: overview, alertStats, healthTrends });
  } catch {
    set({});
  }
}

export async function refreshSlow() {
  try {
    const [riskRanking, maintenanceStats, eventFreq] = await Promise.all([
      api('/api/v1/analytics/risk-ranking'),
      api('/api/v1/analytics/maintenance'),
      api('/api/v1/analytics/events'),
    ]);
    set({ riskRanking: riskRanking || [], maintenanceStats, eventFreq });
  } catch {
    set({});
  }
}

export async function refreshMaintenance() {
  try {
    const r = await api('/api/v1/maintenance?limit=100');
    set({ maintenance: r || { items: [] } });
  } catch {
    set({});
  }
}

let started = false;

export function startPolling() {
  if (started) return;
  started = true;
  initScaffold();
  const tick = () => {
    refreshCore().then(() => {
      refreshAnalytics();
      const slowMs = 15000;
      if (!tick._slow || Date.now() - tick._slow > slowMs) {
        tick._slow = Date.now();
        refreshSlow();
      }
    });
  };
  tick();
  setInterval(tick, POLL_MS);
}
