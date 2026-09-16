import { el, esc, pct, num, int, fmtDateTime, timeAgo, statusInfo, riskInfo, anomalyInfo } from '../util.js';
import { api } from '../api.js';
import { store, selectMachine } from '../state.js';
import { openInspector } from './inspector.js';
import { kpi, card, segBar, riskPill, statusPill, errorBox, emptyBox } from '../shared.js';

let root = null;
let lastRef = null;
let explanationCache = {};

export function mount(container) {
  root = container;
  render();
}

export function unmount() { /* stateless */ }

export function update(s) {
  if (!root) return;
  const ref = (s.machines || []).length + '|' + (s.riskRanking || []).length;
  if (ref === lastRef) return;
  lastRef = ref;
  render();
}

function ranked() {
  const machines = store.machines || [];
  return machines.slice().sort((a, b) => (b.failureRisk ?? -1) - (a.failureRisk ?? -1));
}

function modes() {
  const machines = store.machines || [];
  return {
    model: machines.filter(m => m.modelMode === 'MODEL').length,
    heuristic: machines.filter(m => m.modelMode === 'HEURISTIC' || !m.modelMode).length,
    total: machines.length,
  };
}

async function render() {
  root.innerHTML = '';
  const rankedList = ranked();
  const top = rankedList[0] || null;
  const mod = modes();

  root.appendChild(el('div', { class: 'page-title' }, 'Predictions', el('span', { class: 'sub' }, 'failure risk · anomaly · attribution for Factory Alpha')));
  root.appendChild(el('div', { class: 'grid cols-4' },
    kpi('Machines below 80% health', (store.machines || []).filter(m => (m.healthScore ?? 100) < 80).length, 'aggregate of live health scores', (store.machines || []).filter(m => (m.healthScore ?? 100) < 80).length ? 'warn' : 'good'),
    kpi('At risk (risk ≥ 50%)', (store.machines || []).filter(m => (m.failureRisk ?? 0) >= 0.5).length, 'modeled failure risk over horizon', 'warn'),
    kpi('Top driver in model', top ? (top.failureRisk != null ? pct(top.failureRisk, 0) : '—') : '—', top ? top.machineId : 'no machine data', 'info'),
    kpi('Model coverage', mod.model + '/' + mod.total, mod.heuristic ? mod.heuristic + ' on heuristic fallback' : 'all predictions from ML model', mod.heuristic ? 'warn' : 'good')));

  root.appendChild(el('div', { class: 'grid cols-2', style: { marginTop: '12px' } },
    riskTable(rankedList),
    attributionPanel(top)));

  root.appendChild(el('div', { class: 'card', style: { marginTop: '12px' } },
    el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, 'How predictions are made'), el('span', { class: 'card-sub' }, 'honest methodology')),
    el('div', { class: 'muted small' },
      'The ML service scores each machine from sensor streams against a learned operating baseline: ' +
      'failure risk (0-1) and anomaly score (0-1) plus a normalized feature attribution per signal. ' +
      'If the ML service is unavailable the backend falls back to a labelled heuristic estimator (mode HEURISTIC) so the UI never goes dark. ' +
      'Attribution is baseline-perturbation feature attribution and is intentionally not presented as SHAP values. ' +
      'Estimated remaining steps are a synthetic model output, not physical hours or a certified failure prediction.')));
}

function riskTable(list) {
  const rows = list.map(m => {
    const s = statusInfo(m);
    const r = riskInfo(m.failureRisk);
    return el('tr', { onClick: () => { selectMachine(m.machineId); openInspector(m.machineId, 'prediction'); }, style: { cursor: 'pointer' } },
      el('td', {}, m.machineId, el('div', { class: 'muted small' }, esc(m.name || '') + ' · ' + esc(m.zone || ''))),
      el('td', {}, statusPill(m)),
      el('td', {}, el('span', { class: 'tag tag-' + r.tone }, r.band), el('span', { class: 'muted small', style: { marginLeft: '6px' } }, pct(m.failureRisk))),
      el('td', {}, num(m.healthScore, 1) + '%', el('div', { class: 'bar', style: { marginTop: '4px' } }, el('div', { class: 'bar-fill f-' + (m.healthScore < 80 ? 'warn' : m.healthScore < 60 ? 'critical' : 'good'), style: { width: pct(m.healthScore / 100, 0) } }))),
      el('td', {}, pct(m.anomalyScore, 0)),
      el('td', {}, m.rulEstimate != null ? int(m.rulEstimate) + ' steps' : '—'));
  });
  return card('Ranked by failure risk', 'click a row to open its prediction detail',
    el('div', { style: { overflowX: 'auto' } },
      el('table', { class: 'tbl' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Machine'), el('th', {}, 'Status'), el('th', {}, 'Failure risk'), el('th', {}, 'Health'), el('th', {}, 'Anomaly'), el('th', {}, 'Est RUL'))),
        rows.length ? el('tbody', {}, rows) : el('tbody', {}, el('tr', {}, el('td', { colspan: '6' }, emptyBox()))))));
}

function attributionPanel(top) {
  const body = el('div', { class: 'loading' }, 'Loading attribution…');
  const host = card('Top attribution', top ? ('why ' + top.machineId + ' is flagged') : 'no machine data yet', body);
  if (!top) return host;
  const key = top.machineId;
  const p = explanationCache[key]
    ? Promise.resolve(explanationCache[key])
    : api(`/api/v1/machines/${top.machineId}/explanation`);
  if (!explanationCache[key]) explanationCache[key] = p;
  p.then(ex => {
    if (!host.isConnected) return;
    if (explanationCache[key] && typeof explanationCache[key].then === 'function' && explanationCache[key] !== p) return;
    body.innerHTML = '';
    const factors = (ex && Array.isArray(ex.factors)) ? ex.factors : [];
    if (!factors.length) {
      body.appendChild(emptyBox('No attribution yet for ' + esc(top.machineId) + ' — the model has not produced a prediction.'));
      return;
    }
    const max = Math.max(...factors.slice(0, 5).map(f => Number(f.contribution) || 0), 0.01);
    for (const f of factors.slice(0, 5)) {
      const up = String(f.direction || 'high').toLowerCase() !== 'low';
      body.appendChild(segBar((f.feature || 'signal').toUpperCase(), (Number(f.contribution) || 0) / max, up ? 'warn' : 'good',
        (up ? 'elevated' : 'bounded') + ' · ' + pct(Number(f.contribution) || 0)));
    }
    body.appendChild(el('div', { class: 'muted small', style: { marginTop: '8px' } },
      'Attribution relative to the learned baseline of ' + esc(top.machineId) + (ex.timestamp ? ' · as of ' + fmtDateTime(ex.timestamp) : '') + '. Baseline-perturbation attribution; not SHAP.'));
  }, e => {
    if (!host.isConnected) return;
    body.innerHTML = '';
    body.appendChild(errorBox('Explanation unavailable: ' + esc(String(e))));
  });
  return host;
}
