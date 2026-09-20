import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { login } = await import('../js/api.js');
const { store, set, applyRealtimeEvent, requestReconcile } = await import('../js/state.js');

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => (body == null ? '' : JSON.stringify(body)) };
}

globalThis.fetch = async (url) => {
  if (String(url).endsWith('/machines')) return jsonResponse(200, []);
  if (String(url).includes('/system/status')) return jsonResponse(200, {});
  if (String(url).includes('/telemetry/status')) return jsonResponse(200, {});
  if (String(url).includes('/alerts')) return jsonResponse(200, { items: [] });
  if (String(url).includes('/events')) return jsonResponse(200, { items: [], count: 0 });
  return jsonResponse(200, {});
};

await login('operator', 'pw');

const tick = () => new Promise(r => setTimeout(r, 5));

function resetStore() {
  store.lastGlobalSeq = -1;
  store.reconcilePending = false;
  store.reconcileReason = null;
  store.reconcileCount = 0;
  store.lastReconcileAt = 0;
  store.realtimeCursors = {};
  store.recentRealtimeEvents = {};
  store.liveTelemetry = {};
  set({});
}

const iso = () => new Date().toISOString();
const ev = (id, seq, machineId) => ({ eventId: id, sequence: seq, timestamp: iso(), payload: { machineId, temperature: 21 } });

test('monotonic deliveries advance the global sequence without reconciling', async () => {
  resetStore();
  assert.equal(applyRealtimeEvent('telemetry.updated', ev('event-1000001', 5, 'M-1')), true);
  assert.equal(store.lastGlobalSeq, 5);
  assert.equal(applyRealtimeEvent('telemetry.updated', ev('event-1000002', 7, 'M-2')), true);
  assert.equal(store.lastGlobalSeq, 7);
  await tick();
  assert.equal(store.reconcileCount, 0, 'a steady feed must not reconcile');
  assert.equal(store.reconcilePending, false);
});

test('sequence regression flags a received delta and schedules one reconcile', async () => {
  resetStore();
  assert.equal(applyRealtimeEvent('telemetry.updated', ev('event-1000003', 10, 'M-1')), true);
  assert.equal(applyRealtimeEvent('telemetry.updated', ev('event-1000004', 9, 'M-2')), true, 'regressed event still applies for a different entity');
  assert.equal(store.reconcilePending, true);
  assert.equal(store.reconcileReason, 'sequence-regression');
  await tick();
  assert.equal(store.reconcilePending, false);
  assert.equal(store.reconcileCount, 1);
});

test('a duplicate eventId replay does not trigger a reconcile', async () => {
  resetStore();
  const e = ev('event-1000005', 10, 'M-1');
  assert.equal(applyRealtimeEvent('telemetry.updated', e), true);
  assert.equal(applyRealtimeEvent('telemetry.updated', { ...e, sequence: 3 }), false, 'replayed eventId is rejected');
  await tick();
  assert.equal(store.reconcileCount, 0);
});

test('requestReconcile coalesces concurrent callers into a single refresh', async () => {
  resetStore();
  requestReconcile('alpha');
  requestReconcile('beta');
  assert.equal(store.reconcilePending, true);
  await tick();
  assert.equal(store.reconcileCount, 1);
});

test('requestReconcile is throttled within the coalesce window', () => {
  resetStore();
  store.lastReconcileAt = Date.now();
  const before = store.reconcileCount;
  requestReconcile('gamma');
  assert.equal(store.reconcilePending, false);
  assert.equal(store.reconcileCount, before, 'no refresh inside the throttle window');
});