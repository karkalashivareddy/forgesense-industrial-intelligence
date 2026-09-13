import { el, esc, pct, num, int, fmtTime, statusInfo, fleetSummary, avgHealth } from '../util.js';
import { api } from '../api.js';
import { store } from '../state.js';
import { card, kv, errorBox, emptyBox, kpi } from '../shared.js';

let root = null;
let lastRef = null;
let health = null;

export function mount(container) {
  root = container;
  render();
  api('/actuator/health').then(
    v => { health = v; if (root) renderHealth(); },
    () => { health = { __err: 'not reachable' }; if (root) renderHealth(); }
  );
}

export function unmount() { /* stateless */ }

export function update(s) {
  if (!root) return;
  const ref = JSON.stringify([s.status, s.telemetryStatus, s.analytics]);
  if (ref === lastRef) return;
  lastRef = ref;
  render();
}

function render() {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'page-title' }, 'System', el('span', { class: 'sub' }, 'observability · integrity · environment')));

  const st = store.status || {};
  const ts = store.telemetryStatus || {};
  const fs = fleetSummary(store.machines);
  const o = store.analytics || {};

  root.appendChild(el('div', { class: 'grid cols-5' },
    kpi('Streaming', st.streaming != null ? (st.streaming ? 'ACTIVE' : 'STALLED') : '—', 'backend pipeline', st.streaming ? 'good' : 'critical'),
    kpi('ML service', st.mlServiceAvailable ? 'UP' : 'DOWN', 'v' + (st.mlModelVersion || '—'), st.mlServiceAvailable ? 'good' : 'critical'),
    kpi('Demo mode', st.demoMode ? 'ON' : 'OFF', 'synthetic plant', 'maint'),
    kpi('Sim paused', st.simulationPaused ? 'YES' : 'NO', 'simulator feed', st.simulationPaused ? 'warn' : 'good'),
    kpi('Define machines', st.definedMachines != null ? int(st.definedMachines) : '—', fs.total + ' reporting', 'info')));

  root.appendChild(el('div', { class: 'grid cols-2', style: { marginTop: '12px' } },
    servicesCard(st, ts),
    reconcileCard(fs, o)));

  root.appendChild(el('div', { class: 'grid cols-2', style: { marginTop: '12px' } },
    mlIntegrityCard(st, ts),
    pipelineCard(st, ts)));
}

function servicesCard(st, ts) {
  return card('Services', 'runtime status',
    kv('Application', esc(st.application || '—')),
    kv('Database', st.database == null ? '—' : typeof st.database === 'string' ? esc(st.database) : JSON.stringify(st.database)),
    kv('WebSocket connections', st.webSocketConnections != null ? int(st.webSocketConnections) : '—'),
    kv('Backend data basis', (st.dataBasis || []).join(' + ') || '—'),
    kv('Telemetry stream', ts.streaming ? 'ACTIVE' : 'STALLED'),
    kv('Telemetry source', esc(ts.source || '—')),
    kv('Telemetry / min', ts.telemetryPerMinute != null ? int(ts.telemetryPerMinute) : '—'),
    kv('ML models', 'anomaly ' + esc(st.mlModelVersion || '—') + ' · attribution baseline-perturbation'),
    healthCard());
}

function healthCard() {
  const body = el('div', {});
  body.appendChild(el('div', { class: 'kv' }, el('b', {}, 'actuator /health'), el('span', {}, health == null ? 'loading…' : (health && health.status ? esc(health.status) : (health && health.__err ? esc(health.__err) : '—')))));
  if (health && health.status === 'UP') {
    const comps = Object.entries((health.components) || {}).slice(0, 8);
    for (const [name, c] of comps) {
      body.appendChild(el('div', { class: 'kv' }, el('b', {}, esc(name)), el('span', {}, el('span', { class: 'pill-status st-' + (c.status === 'UP' ? 'good' : 'critical') }, c.status || '—'))));
    }
  } else if (health && health.__err) {
    body.appendChild(el('div', { class: 'muted small' }, 'actuator health endpoint not reachable through the gateway.'));
  }
  return body;
}

function reconcileCard(fs, o) {
  const derivedOnline = fs.total - fs.offline;
  const attn = fs.attn;
  const row = (label, a, b) => el('div', { class: 'kv' },
    el('b', {}, label),
    el('span', {}, a != null ? int(a) : '—', el('span', { class: 'muted small' }, ' vs backend ' + (b != null ? int(b) : '—'))));
  return card('KPI reconciliation', 'derived from live machine list vs backend analytics',
    row('Machines total', fs.total, (o.machinesTotal ?? st.definedMachines)),
    row('Online', derivedOnline, o.machinesOnline),
    row('At risk (risk ≥ 0.5)', fs.atRisk, o.machinesAtRisk),
    kv('Average health (derived)', o.averageFleetHealth != null ? pct(o.averageFleetHealth, 0) : '—'),
    kv('Attention count (derived)', attn),
    el('div', { class: 'muted small', style: { marginTop: '6px' } },
      'Local values are recomputed on every poll from the same REST feed the views use, so they always match what you see in the UI.'));
}

function mlIntegrityCard(st, ts) {
  const machines = store.machines || [];
  const mModeModel = machines.filter(m => m.modelMode === 'MODEL').length;
  const mModeHeur = machines.length - mModeModel;
  return card('ML integrity', 'honest model accounting',
    kv('ML service', st.mlServiceAvailable ? 'available' : 'unavailable'),
    kv('Model version', esc(st.mlModelVersion || '—')),
    kv('Machines on MODEL', mModeModel + '/' + machines.length),
    kv('Machines on heuristic fallback', mModeHeur),
    kv('Attribution method', 'baseline perturbation (not SHAP)'),
    kv('RUL', 'heuristic estimate — not certified'),
    el('div', { class: 'muted small', style: { marginTop: '8px' } },
      'When the ML service is down the backend labels predictions HEURISTIC so the UI never overstates confidence. The frontend shows mode and modelVersion per machine everywhere relevant.'),
    el('div', { class: 'alert-desc', style: { marginTop: '8px' } },
      'Scenarios and impact figures are simulation/estimate outputs. The control room does not control physical machinery.'));
}

function pipelineCard(st, ts) {
  const basis = (st.dataBasis || []).join('/');
  return card('Data pipeline', 'REST-polled control room · ' + (st.streaming ? 'streaming active' : 'streaming stalled'),
    kv('Source', 'simulator ' + esc(ts.source || '—') + ' (synthetic, ~5s samples)'),
    kv('Transport', 'Kafka → backend consumer → API store'),
    kv('UI transport', 'REST poll · 3s · no WebSocket subscription by default (available on /ws)'),
    kv('Freshness', 'age shown in top bar · basis ' + esc(basis) + ' from backend'),
    kv('Auth', 'JWT bearer + RBAC (OPERATOR/ENGINEER/ADMIN)'),
    el('div', { class: 'muted small', style: { marginTop: '8px' } },
      'The backend exposes SockJS/STOMP topics (machine.updated, alert.created, impact.updated, …). This UI deliberately polls REST so every number it shows is the same single source of truth.'));
}