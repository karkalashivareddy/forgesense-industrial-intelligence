import { el, esc, pct, num, int, timeAgo, statusInfo, riskInfo, anomalyInfo, fleetSummary } from '../util.js';
import { store, selectMachine } from '../state.js';
import { statusPill, kpi, healthBar, segBar } from '../shared.js';
import { openInspector } from './inspector.js';

let root = null;
let q = '';
let fStatus = 'ALL';
let fZone = 'ALL';
let sortKey = 'status';
let sortDir = -1;
let lastRef = null;

const STATUS_OPTIONS = ['ALL', 'NORMAL', 'DEGRADED', 'WARNING', 'CRITICAL', 'MAINTENANCE', 'OFFLINE', 'RECOVERING'];

export function mount(container) {
  root = container;
  render();
}

export function unmount() { /* stateless */ }

export function update(s) {
  if (!root) return;
  const ref = (s.machines || []).map(m =>
    m.machineId + ':' + m.status + ':' + (m.healthScore != null ? Math.round(m.healthScore) : '-') + ':' + (m.anomalyScore != null ? Math.round(m.anomalyScore * 100) : '-') + ':' + (m.lastTelemetryAt || '')).join('|')
    + '|' + s.selectedMachineId + '|' + s.alerts.total + '|' + (s.status || {}).simulationPaused;
  if (ref === lastRef) return;
  lastRef = ref;
  renderBody();
}

export function matches(m) {
  if (q) {
    const hay = (m.machineId + ' ' + (m.name || '') + ' ' + (m.zone || '') + ' ' + (m.line || '') + ' ' + (m.typeLabel || '')).toLowerCase();
    if (!hay.includes(q.toLowerCase())) return false;
  }
  if (fStatus !== 'ALL' && m.status !== fStatus) return false;
  if (fZone !== 'ALL' && m.zone !== fZone) return false;
  return true;
}

function render() {
  root.innerHTML = '';
  const fs = fleetSummary(store.machines);
  root.appendChild(el('div', { class: 'page-title' }, 'Fleet', el('span', { class: 'sub' }, fs.total + ' machines · Factory Alpha'),
    el('button', { class: 'btn btn-sm', style: { marginLeft: 'auto' }, onClick: () => { selectMachine(''); openInspector(''); } }, 'Nothing selected — click a machine')));

  root.appendChild(el('div', { class: 'grid cols-5' },
    kpi('Total machines', fs.total, 'Factory Alpha', 'info'),
    kpi('Healthy', fs.normal, 'operating within bounds', 'good'),
    kpi('Attention', fs.attn, fs.degraded + ' degraded · ' + fs.warning + ' warning', 'warn'),
    kpi('Critical', fs.critical, fs.recovering ? fs.recovering + ' recovering' : 'none flagging urgent', 'critical'),
    kpi('Offline / maint', fs.offline + fs.maintenance, fs.offline + ' offline · ' + fs.maintenance + ' in maintenance', 'maint')));

  root.appendChild(renderToolbar());
  const tableCard = el('div', { class: 'card', style: { marginTop: '12px' } });
  const tableHost = el('div', { id: 'fleetTable' });
  tableHost.appendChild(renderTable());
  tableCard.appendChild(tableHost);
  root.appendChild(tableCard);
}

function renderToolbar() {
  const out = el('div', { class: 'toolbar' },
    el('input', {
      className: 'search',
      id: 'fleetQ',
      placeholder: 'Search machines…',
      'aria-label': 'Search machines',
      value: q,
      oninput: e => { q = e.target.value; renderBody(); },
    }),
    el('select', { className: 'search', style: { minWidth: '140px' }, onchange: e => { fStatus = e.target.value; renderBody(); } },
      STATUS_OPTIONS.map(s => el('option', { value: s }, s === 'ALL' ? 'All statuses' : s))),
    el('select', { className: 'search', style: { minWidth: '140px' }, onchange: e => { fZone = e.target.value; renderBody(); } },
      ['ALL', ...(store.zones || []).map(z => z.code)].map(z => el('option', { value: z }, z === 'ALL' ? 'All zones' : z))));
  out.querySelectorAll('select')[0].value = fStatus;
  out.querySelectorAll('select')[1].value = fZone;
  return out;
}

function sortableTh(key, label) {
  const active = sortKey === key;
  return el('th', { 'aria-sort': active ? (sortDir < 0 ? 'descending' : 'ascending') : undefined },
    el('button', {
      class: 'sort-btn',
      title: 'Sort by ' + label,
      onClick: () => { if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = -1; } renderBody(); },
    }, label + (active ? (sortDir < 0 ? ' ↓' : ' ↑') : '')));
}

function filterSort() {
  const rows = (store.machines || []).filter(matches);
  const order = { NORMAL: 0, RECOVERING: 1, DEGRADED: 2, WARNING: 3, MAINTENANCE: 4, CRITICAL: 5, OFFLINE: 6 };
  const get = m => {
    if (sortKey === 'status') return order[m.status] ?? 99;
    if (sortKey === 'risk') return m.failureRisk ?? -1;
    if (sortKey === 'health') return m.healthScore ?? -1;
    if (sortKey === 'anomaly') return m.anomalyScore ?? -1;
    if (sortKey === 'zone') return String(m.zone || '');
    if (sortKey === 'machine') return String(m.machineId || '');
    if (sortKey === 'last') return (m.lastTelemetryAt || '');
    return 0;
  };
  return rows.sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (av < bv) return -1 * sortDir;
    if (av > bv) return 1 * sortDir;
    return String(a.machineId || '').localeCompare(String(b.machineId || ''));
  });
}

function renderBody() {
  if (!root) return;
  const tableHost = root.querySelector('#fleetTable');
  if (!tableHost) return;
  tableHost.innerHTML = '';
  tableHost.appendChild(renderTable());
}

function renderTable() {
  const rows = filterSort();
  const thead = el('tr', {},
    sortableTh('machine', 'Machine'),
    el('th', {}, 'Zone / Line'),
    sortableTh('status', 'Status'),
    el('th', {}, 'Health', el('span', { class: 'muted small' }, ' · 0-100')),
    el('th', {}, 'Risk', el('span', { class: 'muted small' }, ' · 0-100%')),
    el('th', {}, 'Anomaly'),
    el('th', {}, 'Est RUL'),
    el('th', {}, 'Model'),
    el('th', {}, 'Last telemetry'));
  if (!rows.length) {
    return el('div', {}, el('table', { class: 'tbl' }, el('thead', {}, thead)),
      el('div', { class: 'empty', style: { padding: '12px 8px' } }, 'No machines match the current filters.'));
  }
  const trs = rows.map(m => {
    const s = statusInfo(m);
    const a = anomalyInfo(m.anomalyScore);
    const r = riskInfo(m.failureRisk);
    const selected = store.selectedMachineId === m.machineId;
    return el('tr', { class: selected ? 'selected' : '', tabindex: '0', onClick: () => { selectMachine(m.machineId); openInspector(m.machineId); }, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMachine(m.machineId); openInspector(m.machineId); } } },
      el('td', {}, el('div', { style: { fontWeight: '600' } }, m.machineId), el('div', { class: 'muted small' }, esc(m.name || '') + (m.typeLabel ? ' · ' + esc(m.typeLabel) : ''))),
      el('td', {}, m.zone || '—', el('div', { class: 'muted small' }, m.line || '')),
      el('td', {}, statusPill(m)),
      el('td', {}, healthBar(m)),
      el('td', {}, el('div', { class: 'bar-row' }, el('div', { class: 'bar' }, el('div', { class: 'bar-fill f-' + r.tone, style: { width: pct(m.failureRisk, 0) } })), el('div', { class: 'bar-cap' }, el('span', {}, r.band), el('b', {}, pct(m.failureRisk))))),
      el('td', {}, el('span', { class: 'tag tag-' + (a.tone) }, a.band), el('span', { class: 'muted small', style: { marginLeft: '6px' } }, pct(m.anomalyScore, 0))),
      el('td', {}, m.rulEstimate != null ? int(m.rulEstimate) + ' steps' : '—'),
      el('td', {}, el('span', { class: 'muted small' }, (m.modelMode || '—')), el('div', { class: 'muted small' }, 'v' + (m.modelVersion || '—'))),
      el('td', { class: 'muted small' }, m.lastTelemetryAt ? timeAgo(m.lastTelemetryAt) : '—'));
  });
  return el('div', { style: { overflowX: 'auto' } },
    el('table', { class: 'tbl' }, el('thead', {}, thead), el('tbody', {}, trs)),
    el('div', { class: 'muted small', style: { marginTop: '8px' } }, rows.length + ' machines · risk from ML (confidence ' + modelConfidence() + ')'));
}

function modelConfidence() {
  const modes = (store.machines || []).map(m => m.modelMode);
  if (!modes.length) return 'unknown';
  return String(modes.filter(x => x === 'MODEL').length) + '/' + String(modes.length) + ' on ML model';
}
