import { el, esc, pct, num, int, statusInfo } from '../util.js';
import { store, selectMachine } from '../state.js';
import { openInspector } from './inspector.js';
import { kpi, card, segBar, emptyBox } from '../shared.js';

let root = null;
let lastRef = null;

export function mount(container) {
  root = container;
  render();
}

export function unmount() { /* stateless */ }

export function update(s) {
  if (!root) return;
  const ref = JSON.stringify([s.analytics, s.alertStats, s.healthTrends, s.maintenanceStats, s.eventFreq, (s.riskRanking || []).length]);
  if (ref === lastRef) return;
  lastRef = ref;
  render();
}

function render() {
  root.innerHTML = '';
  const o = store.analytics || {};
  const alertStats = store.alertStats || {};
  const health = store.healthTrends || {};
  const ev = store.eventFreq || {};
  const mt = store.maintenanceStats || {};
  const risk = store.riskRanking || [];

  root.appendChild(el('div', { class: 'page-title' }, 'Analytics', el('span', { class: 'sub' }, 'backend analytics endpoints · basis ' + esc(Array.isArray(o.dataBasis) ? o.dataBasis.join(', ') : String(o.dataBasis || '—')))));

  root.appendChild(el('div', { class: 'grid cols-4' },
    kpi('Machines online', o.machinesOnline != null ? int(o.machinesOnline) + '/' + int(o.machinesTotal ?? '')?.split(',')[0] : '—', 'backend overview', 'good'),
    kpi('At risk', o.machinesAtRisk != null ? int(o.machinesAtRisk) : '—', o.criticalAlerts != null ? o.criticalAlerts + ' critical alerts' : '', (o.machinesAtRisk || 0) > 0 ? 'warn' : 'good'),
    kpi('Avg fleet health', o.averageFleetHealth != null ? num(o.averageFleetHealth * 100, 0) + '%' : '—', 'weighted health score', 'info'),
    kpi('Production efficiency', o.productionEfficiency ? (o.productionEfficiency.value != null ? num(o.productionEfficiency.value, 0) + '%' : '—') : '—', o.productionEfficiency && o.productionEfficiency.label ? esc(o.productionEfficiency.label) : '', 'good')));

  root.appendChild(el('div', { class: 'grid cols-4' },
    kpi('Telemetry throughput', o.telemetryThroughputPerMinute != null ? int(o.telemetryThroughputPerMinute) + '/min' : '—', 'ingested events', 'info'),
    kpi('Downtime risk horizon', o.estimatedDowntimeRiskMinutes != null ? int(o.estimatedDowntimeRiskMinutes) + ' min' : '—', 'modeled estimate', 'warn'),
    kpi('Active maintenance', mt.active != null ? int(mt.active) : '—', mt.scheduled != null ? mt.scheduled + ' scheduled' : '', mt.active ? 'critical' : 'good'),
    kpi('Basis', esc(String(o.dataBasis || '—')), 'OBSERVED = stored telemetry, SYNTHETIC = simulator feed', 'maint')));

  root.appendChild(el('div', { class: 'grid cols-2', style: { marginTop: '12px' } },
    alertPanel(alertStats),
    riskPanel(risk)));

  root.appendChild(el('div', { class: 'grid cols-2', style: { marginTop: '12px' } },
    healthPanel(health),
    eventsPanel(ev)));
}

function alertPanel(a) {
  return card('Alert lifecycle', 'from /api/v1/analytics/alerts',
    el('div', { class: 'stat-grid' },
      stat(a.open, 'open', 'warn'),
      stat(a.new, 'new', 'critical'),
      stat(a.investigating, 'investigating', 'info'),
      stat(a.resolvedToday, 'resolved today', 'good')),
    el('div', { class: 'muted small', style: { marginTop: '8px' } }, 'basis ' + esc(a.basis || '—')));
}

function stat(v, l, tone) {
  const color = { good: 'var(--color-emerald)', warn: 'var(--color-amber)', critical: 'var(--color-crimson)', info: 'var(--color-cyan)' }[tone];
  return el('div', { class: 'stat-box' },
    el('div', { class: 'l' }, l),
    el('div', { class: 'v', style: { color } }, v != null ? int(v) : '—'));
}

function riskPanel(risk) {
  const sorted = risk.slice().sort((a, b) => (b.failureRisk ?? -1) - (a.failureRisk ?? -1) || String(a.machineId || '').localeCompare(String(b.machineId || '')));
  const body = el('div', {});
  if (!sorted.length) { body.appendChild(emptyBox('No risk ranking available yet.')); return card('Risk ranking', 'from /api/v1/analytics/risk-ranking', body); }
  const max = Math.max(...sorted.map(r => r.failureRisk ?? 0), 0.01);
  for (const r of sorted.slice(0, 8)) {
    body.appendChild(el('div', { class: 'factor-row' },
      el('div', {
      class: 'fa', tabindex: '0', role: 'button',
      onClick: () => { selectMachine(r.machineId); openInspector(r.machineId); },
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMachine(r.machineId); openInspector(r.machineId); } },
      style: { cursor: 'pointer' },
    }, r.machineId),
      el('div', { class: 'fb' },
        el('div', { class: 'pc' },
          el('div', { class: 'bar' }, el('div', { class: 'bar-fill f-' + (r.failureRisk >= 0.5 ? 'warn' : 'good'), style: { width: pct((r.failureRisk ?? 0) / max, 0) } })),
          el('div', { class: 'bar-cap' }, el('span', {}, esc(r.zone || r.status || '')), el('b', {}, pct(r.failureRisk)))))),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn btn-sm', onClick: () => { selectMachine(r.machineId); openInspector(r.machineId, 'prediction'); } }, 'predictions')));
  }
  return card('Risk leaders', 'click a machine to inspect', body);
}

function healthPanel(h) {
  const machines = (h.machines || []).slice();
  const body = el('div', {});
  if (!machines.length) { body.appendChild(emptyBox('No health-trend snapshot yet.')); return card('Fleet health vs risk', 'from /api/v1/analytics/health-trends', body); }
  body.appendChild(el('div', { class: 'kv' }, el('b', {}, 'basis'), el('span', {}, esc(h.basis || '—'))));
  const maxH = Math.max(...machines.map(x => x.healthScore ?? 0), 0.01);
  const maxR = Math.max(...machines.map(x => x.failureRisk ?? 0), 0.01);
  for (const mm of machines) {
    const m = store.machineMap.get(mm.machineId);
    body.appendChild(el('div', { class: 'factor-row' },
      el('div', {
      class: 'fa', tabindex: '0', role: 'button',
      onClick: () => { selectMachine(mm.machineId); openInspector(mm.machineId); },
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMachine(mm.machineId); openInspector(mm.machineId); } },
      style: { cursor: 'pointer' },
    }, mm.machineId),
      el('div', { class: 'fb' },
        el('div', { class: 'pc' },
          el('div', { class: 'bar' }, el('div', { class: 'bar-fill f-' + (mm.healthScore < 60 ? 'critical' : mm.healthScore < 80 ? 'warn' : 'good'), style: { width: pct((mm.healthScore ?? 0) / maxH, 0) } })),
          el('div', { class: 'bar-cap' }, el('span', {}, (m && m.name) || ''), el('b', {}, num(mm.healthScore) + '% health'))),
        el('div', { class: 'pc' },
          el('div', { class: 'bar' }, el('div', { class: 'bar-fill f-' + (mm.failureRisk >= 0.5 ? 'warn' : 'good'), style: { width: pct((mm.failureRisk ?? 0) / maxR, 0) } })),
          el('div', { class: 'bar-cap' }, el('span', {}, ''), el('b', {}, pct(mm.failureRisk) + ' risk'))))));
  }
  return card('Fleet health vs risk', 'latest snapshot per machine', body);
}

function eventsPanel(e) {
  const rows = [
    ['Telemetry', e.telemetry],
    ['Alert changes', e.alerts],
    ['Maintenance events', e.maintenance],
    ['Simulation runs', e.simulations],
  ];
  const body = el('div', {});
  const max = Math.max(...rows.map(([, v]) => Number(v) || 0), 1);
  if (!rows.some(([, v]) => Number(v) > 0)) body.appendChild(emptyBox('No event-frequency snapshot yet.'));
  for (const [label, val] of rows) {
    const v = Number(val) || 0;
    body.appendChild(segBar(label, v / max, v > 0 ? 'info' : 'muted', int(v)));
  }
  body.appendChild(el('div', { class: 'muted small', style: { marginTop: '8px' } }, 'basis ' + esc(e.basis || '—')));
  return card('Event frequency', 'events recorded in the period', body);
}
