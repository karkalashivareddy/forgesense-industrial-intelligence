import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  statusInfo, fleetSummary, avgHealth,
  pct, num, int, timeAgo, riskInfo, healthInfo, anomalyInfo,
  alertSeverityTag, userCan, sensorLabel, esc, clamp, ageBand, modelGrade,
  deriveMachineState, machineState, RECOVERY_CONFIRM, STALE_AFTER_S, MACHINE_STATE,
} from '../js/util.js';

test('statusInfo basics', () => {
  assert.deepEqual(statusInfo(null), { label: '—', tone: 'muted', hint: '' });
  assert.equal(statusInfo({ status: 'NORMAL' }).label, 'NORMAL');
  assert.equal(statusInfo({ status: 'NORMAL' }).tone, 'good');
  assert.equal(statusInfo({ status: 'DEGRADED' }).tone, 'warn');
  assert.equal(statusInfo({ status: 'WARNING' }).tone, 'warn');
  assert.equal(statusInfo({ status: 'CRITICAL' }).tone, 'critical');
  assert.equal(statusInfo({ status: 'MAINTENANCE' }).tone, 'maint');
  assert.equal(statusInfo({ status: 'RECOVERING' }).tone, 'info');
});

test('statusInfo: OFFLINE wins over status', () => {
  assert.equal(statusInfo({ status: 'NORMAL', connectivity: 'OFFLINE' }).tone, 'down');
  assert.equal(statusInfo({ status: 'OFFLINE' }).label, 'OFFLINE');
});

test('fleetSummary counts by state', () => {
  const s = fleetSummary([
    { status: 'NORMAL' },
    { status: 'NORMAL' },
    { status: 'DEGRADED' },
    { status: 'CRITICAL' },
    { status: 'MAINTENANCE' },
    { status: 'RECOVERING' },
    { status: 'OFFLINE' },
  ]);
  assert.equal(s.total, 7);
  assert.equal(s.normal, 2);
  assert.equal(s.degraded, 1);
  assert.equal(s.critical, 1);
  assert.equal(s.maintenance, 1);
  assert.equal(s.recovering, 1);
  assert.equal(s.offline, 1);
  assert.equal(s.attn, 2);
});

test('fleetSummary: connectivity OFFLINE counted', () => {
  const s = fleetSummary([{ status: 'NORMAL', connectivity: 'OFFLINE' }]);
  assert.equal(s.offline, 1);
  assert.equal(s.normal, 0);
});

test('avgHealth averages and null-safe', () => {
  assert.equal(avgHealth([{ healthScore: 100 }, { healthScore: 80 }]), 90);
  assert.equal(avgHealth([]), null);
  assert.equal(avgHealth(null), null);
});

test('number formatting helpers', () => {
  assert.equal(pct(0.123), '12.3%');
  assert.equal(pct(null), '—');
  assert.equal(num(1.234), '1.2');
  assert.equal(int(1234), '1,234');
});

test('riskInfo bands', () => {
  assert.equal(riskInfo(0.9).band, 'HIGH');
  assert.equal(riskInfo(0.9).tone, 'critical');
  assert.equal(riskInfo(0.6).band, 'MODERATE');
  assert.equal(riskInfo(0.1).band, 'LOW');
  assert.equal(riskInfo(0.1).tone, 'good');
});

test('healthInfo thresholds', () => {
  assert.equal(healthInfo(50), 'critical');
  assert.equal(healthInfo(70), 'warn');
  assert.equal(healthInfo(90), 'good');
});

test('anomalyInfo bands', () => {
  assert.equal(anomalyInfo(0.9).band, 'CRITICAL');
  assert.equal(anomalyInfo(0.7).band, 'ELEVATED');
  assert.equal(anomalyInfo(0.1).band, 'LOW');
});

test('RBAC gating', () => {
  assert.equal(userCan(['ROLE_OPERATOR', 'ROLE_ENGINEER'], 'ENGINEER'), true);
  assert.equal(userCan(['ROLE_OPERATOR'], 'ENGINEER'), false);
  assert.equal(userCan([], 'OPERATOR'), false);
});

test('alertSeverityTag normalization', () => {
  assert.deepEqual(alertSeverityTag('critical'), { cls: 'critical', label: 'CRITICAL' });
  assert.deepEqual(alertSeverityTag('warning'), { cls: 'warning', label: 'WARNING' });
  assert.deepEqual(alertSeverityTag('info'), { cls: 'info', label: 'INFO' });
});

test('sensorLabel maps known + unknown keys', () => {
  assert.equal(sensorLabel('temperature').label, 'Temperature');
  assert.equal(sensorLabel('temperature').unit, '°C');
  assert.equal(sensorLabel('notakey').label, 'notakey');
  assert.equal(sensorLabel('notakey').sensor, null);
});

test('esc escapes HTML', () => {
  assert.equal(esc('<script>alert("x")&</script>'), '&lt;script&gt;alert(&quot;x&quot;)&amp;&lt;/script&gt;');
});

test('clamp bounds values', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(0.5, 0, 1), 0.5);
  assert.equal(clamp(null, 0, 1), 0);
});

test('timeAgo formatting', () => {
  const now = Date.now();
  assert.match(timeAgo(new Date(now - 10 * 1000).toISOString(), now), /^10s ago$/);
  assert.match(timeAgo(new Date(now - 5 * 60 * 1000).toISOString(), now), /^5m ago$/);
  assert.equal(timeAgo(null), '—');
});

test('ageBand distinguishes live/delayed/stale', () => {
  assert.deepEqual(ageBand(null), { label: 'UNKNOWN', tone: 'down' });
  assert.deepEqual(ageBand(0), { label: 'LIVE', tone: 'good' });
  assert.deepEqual(ageBand(14.9), { label: 'LIVE', tone: 'good' });
  assert.deepEqual(ageBand(15), { label: 'DELAYED', tone: 'warn' });
  assert.deepEqual(ageBand(59.9), { label: 'DELAYED', tone: 'warn' });
  assert.deepEqual(ageBand(60), { label: 'STALE', tone: 'down' });
  assert.deepEqual(ageBand(3600), { label: 'STALE', tone: 'down' });
});

test('modelGrade maps estimator mode to confidence', () => {
  assert.deepEqual(modelGrade('MODEL'), { label: 'High', tone: 'good', scale: 'HIGH' });
  assert.deepEqual(modelGrade('HYBRID'), { label: 'Moderate', tone: 'warn', scale: 'MID' });
  assert.deepEqual(modelGrade('HEURISTIC'), { label: 'Low', tone: 'warn', scale: 'LOW' });
  assert.deepEqual(modelGrade(''), { label: 'Low', tone: 'warn', scale: 'LOW' });
  assert.deepEqual(modelGrade(null), { label: 'Low', tone: 'warn', scale: 'LOW' });
  assert.deepEqual(modelGrade('model'), { label: 'High', tone: 'good', scale: 'HIGH' });
});

const fresh = (extra = {}) => ({
  machineId: 'M-01', status: 'NORMAL', lastTelemetryAt: new Date(Date.now() - 5000).toISOString(),
  connectivity: 'ONLINE', ...extra,
});

test('deriveMachineState: healthy machine is NORMAL', () => {
  const s = deriveMachineState(fresh());
  assert.equal(s.state, 'NORMAL');
  assert.equal(s.tone, 'good');
  assert.ok(s.guidance);
});

test('deriveMachineState: ladder CRITICAL / ESCALATED', () => {
  assert.equal(deriveMachineState(fresh({ status: 'CRITICAL' })).state, 'CRITICAL');
  assert.equal(deriveMachineState(fresh({ status: 'WARNING' })).state, 'ESCALATED');
  assert.equal(deriveMachineState(fresh({ status: 'DEGRADED' })).state, 'ESCALATED');
  assert.equal(deriveMachineState(fresh({ failureRisk: 0.9 })).state, 'CRITICAL');
  assert.equal(deriveMachineState(fresh({ anomalyScore: 0.7 })).state, 'ESCALATED');
});

test('deriveMachineState: maintenance is deliberate and wins', () => {
  const s = deriveMachineState(fresh({ status: 'MAINTENANCE', lastTelemetryAt: new Date(Date.now() - 3600e3).toISOString() }));
  assert.equal(s.state, 'MAINTENANCE');
  assert.equal(s.tone, 'maint');
});

test('deriveMachineState: explicit OFFLINE vs silent STALE are distinct', () => {
  const offline = deriveMachineState(fresh({ connectivity: 'OFFLINE' }));
  assert.equal(offline.state, 'OFFLINE');
  const disconnected = deriveMachineState(fresh(), { disconnected: true });
  assert.equal(disconnected.state, 'OFFLINE');
  const old = new Date(Date.now() - (STALE_AFTER_S + 5) * 1000).toISOString();
  const stale = deriveMachineState(fresh({ lastTelemetryAt: old }));
  assert.equal(stale.state, 'STALE');
  assert.equal(stale.tone, 'down');
  assert.notEqual(stale.state, offline.state);
  assert.match(stale.guidance, /last known/);
});

test('deriveMachineState: STALE overrides stale health colors', () => {
  const old = new Date(Date.now() - 300e3).toISOString();
  assert.equal(deriveMachineState(fresh({ lastTelemetryAt: old, status: 'CRITICAL' })).state, 'STALE');
});

test('deriveMachineState: RECOVERING requires consecutive healthy readings', () => {
  const old = new Date(Date.now() - (STALE_AFTER_S + 5) * 1000).toISOString();
  const freshm = fresh();
  const need = RECOVERY_CONFIRM;
  const recovering = deriveMachineState(freshm, { recovering: true, consecutive: 1, confirmReadings: need });
  assert.equal(recovering.state, 'RECOVERING');
  assert.equal(recovering.tone, 'info');
  assert.equal(recovering.remaining, need - 1);
  const clearing = deriveMachineState(freshm, { recovering: true, consecutive: need, confirmReadings: need });
  assert.equal(clearing.state, 'NORMAL');
  assert.equal(deriveMachineState(freshm, { recovering: false, consecutive: 0 }).state, 'NORMAL');
});

test('deriveMachineState: null/unknown safe', () => {
  assert.equal(deriveMachineState(null).state, 'UNKNOWN');
  assert.equal(deriveMachineState({}).state, 'UNKNOWN');
});

test('machineState prefers cached uiState', () => {
  const m = fresh();
  m.uiState = MACHINE_STATE.RECOVERING;
  assert.equal(machineState(m).state, 'RECOVERING');
  const m2 = fresh({ status: 'CRITICAL' });
  assert.equal(machineState(m2).state, 'CRITICAL');
});