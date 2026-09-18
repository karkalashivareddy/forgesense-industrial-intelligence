import { el, esc, pct, timeAgo, anomalyInfo, machineState } from '../util.js';
import { store } from '../state.js';
import { card, emptyBox, machineClick, statusPill } from '../shared.js';

let root = null;
let severity = 'ALL';
let lastRef = '';
export function mount(container) { root = container; render(); }
export function unmount() { root = null; }
export function activate() { render(); }
export function update(s) { const ref = `${s.liveEventCount}|${severity}`; if (ref !== lastRef) { lastRef = ref; render(); } }

function render() {
  if (!root) return;
  const alerts = (store.alerts?.items || []).filter(a => ['NEW', 'ACKNOWLEDGED', 'INVESTIGATING'].includes(a.status));
  const machines = (store.machines || []).filter(m => Number(m.anomalyScore) >= 0.6 || ['CRITICAL', 'WARNING', 'DEGRADED'].includes(m.status));
  const rows = machines.filter(m => severity === 'ALL' || (severity === 'CRITICAL' ? Number(m.failureRisk) >= .8 : Number(m.failureRisk) >= .5 && Number(m.failureRisk) < .8));
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'page-title' }, 'Anomalies', el('span', { class: 'sub' }, `${rows.length} condition signals requiring review`)));
  root.appendChild(el('div', { class: 'toolbar' },
    el('select', { className: 'search', value: severity, onchange: e => { severity = e.target.value; render(); } },
      ['ALL', 'CRITICAL', 'WARNING'].map(v => el('option', { value: v }, v === 'ALL' ? 'All severities' : v))),
    el('span', { class: 'muted small' }, `${alerts.length} active alert records · scores are model/heuristic outputs as labelled by backend`)));
  const body = rows.length ? rows.map(m => {
    const a = anomalyInfo(m.anomalyScore);
    const linked = alerts.find(x => x.machineId === m.machineId);
    return el('div', { class: 'list-item clickable', tabindex: '0', onClick: () => machineClick(m), onkeydown: e => { if (e.key === 'Enter') machineClick(m); } },
      el('div', { class: 'alert-row' },
        el('div', { class: 'alert-sev st-' + (a.tone === 'critical' ? 'critical' : 'warn') }, a.band),
        el('div', { class: 'alert-main' }, el('div', { class: 'alert-title' }, `${m.machineId} · ${esc(m.name || '')}`),
          el('div', { class: 'alert-meta' }, statusPill(m), el('span', {}, `anomaly ${pct(m.anomalyScore)}`), el('span', {}, `risk ${pct(m.failureRisk)}`), linked ? el('span', {}, esc(linked.headline || linked.type || 'active alert')) : null, el('span', {}, m.lastTelemetryAt ? timeAgo(m.lastTelemetryAt) : 'no timestamp'))),
        el('div', { class: 'alert-desc' }, machineState(m).guidance || 'Investigate the contributing telemetry signals in the inspector.')));
  }) : [emptyBox('No active anomalies. The current asset set is inside its monitored operating bands.')];
  root.appendChild(card('Condition deviations', 'Prioritized by current asset state', el('div', { class: 'list' }, body)));
}
