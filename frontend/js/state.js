import { api } from './api.js';

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
  freshness: { ok: false, lastOk: null, polls: 0, failures: 0, lastError: null },
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
    const machineMap = new Map();
    (machines || []).forEach(m => machineMap.set(m.machineId, m));
    set({
      machines: machines || [],
      machineMap,
      status,
      telemetryStatus: telStatus,
      alerts: alerts || { items: [] },
      events: events || { items: [] },
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
  setInterval(() => notify(), 1000);
}