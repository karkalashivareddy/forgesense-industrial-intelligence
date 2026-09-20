import {
  el, esc, pct, num, int, fmtTime, fmtDateTime, timeAgo,
  statusInfo, riskInfo, healthInfo, anomalyInfo, sensorLabel, userCan, machineState,
} from '../util.js';
import { store, selectMachine, subscribe, refreshMaintenance } from '../state.js';
import { api, post, getRoles } from '../api.js';
import { drawLineChart, COLORS } from '../charts.js';

function flashError(e) {
  const box = document.getElementById('toast');
  if (!box) return;
  box.innerHTML = '';
  box.classList.remove('hidden');
  box.classList.add('err');
  box.appendChild(el('span', {}, (e && e.message) ? e.message : 'Action failed — check the backend connection.'));
  box.appendChild(el('button', { class: 'btn btn-sm', onClick: () => box.classList.add('hidden') }, 'OK'));
  window.setTimeout(() => box.classList.add('hidden'), 6000);
}

const TABS = [
  ['overview', 'Overview'],
  ['telemetry', 'Telemetry'],
  ['prediction', 'Prediction'],
  ['explanation', 'Explanation'],
  ['dependencies', 'Dependencies'],
  ['events', 'Events'],
  ['impact', 'Impact'],
  ['maintenance', 'Maintenance'],
];

const RANGES = [['300', '5m'], ['900', '15m'], ['21600', '6h']];

let id = null;
let tab = 'overview';
let mCache = {};
let lastBodyRender = 0;
let idleTimer = null;
let liveRenderTimer = null;
let previousFocus = null;
let trapHandler = null;
let lastLiveEventCount = 0;
const teleCfg = { metric: null, range: '300' };

function panel() { return document.getElementById('inspector'); }
function bodyEl() { return document.getElementById('inspBody'); }
function titleEl() { return document.getElementById('inspTitle'); }
function breadcrumbEl() { return document.getElementById('inspBreadcrumb'); }
function tabsEl() { return document.getElementById('inspTabs'); }

export function isOpen() {
  const p = panel();
  return !!p && !p.classList.contains('collapsed');
}

export function openInspector(machineId, tabName) {
  if (!isOpen()) previousFocus = document.activeElement;
  id = machineId;
  tab = tabName || 'overview';
  panel().classList.remove('collapsed');
  panel().setAttribute('aria-hidden', 'false');
  lastLiveEventCount = store.liveEventCount || 0;
  renderHead();
  renderTabs();
  renderTab();
  requestAnimationFrame(() => panel()?.focus());
  installFocusTrap();
  startIdleRefresh();
}

export function closeInspector() {
  stopIdleRefresh();
  panel().classList.add('collapsed');
  panel().setAttribute('aria-hidden', 'true');
  if (trapHandler) panel().removeEventListener('keydown', trapHandler);
  trapHandler = null;
  if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
  previousFocus = null;
}

function focusables() {
  const p = panel();
  return p ? [...p.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')] : [];
}

function installFocusTrap() {
  if (trapHandler) panel().removeEventListener('keydown', trapHandler);
  trapHandler = e => {
    if (e.key === 'Escape') { e.preventDefault(); closeInspector(); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const tabs = [...tabsEl().querySelectorAll('[role="tab"]')];
      const current = tabs.indexOf(document.activeElement);
      if (current >= 0) { e.preventDefault(); const next = tabs[(current + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; next.focus(); next.click(); return; }
    }
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0]; const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  panel().addEventListener('keydown', trapHandler);
}

function startIdleRefresh() {
  stopIdleRefresh();
  idleTimer = setInterval(() => {
    if (!isOpen() || !id) return;
    const now = Date.now();
    if (now - lastBodyRender > 15000 && document.visibilityState === 'visible') renderTab();
    else renderHead();
  }, 4000);
}

function stopIdleRefresh() {
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
  if (liveRenderTimer) { clearTimeout(liveRenderTimer); liveRenderTimer = null; }
}

export function toggleInspector() {
  if (isOpen()) closeInspector();
  else if (id) openInspector(id, tab);
}

function machine() { return id ? store.machineMap.get(id) : null; }

function renderHead() {
  const m = machine();
  titleEl().textContent = m ? m.name + ' · ' + m.machineId : 'Machine Inspector';
  breadcrumbEl().textContent = m ? 'Factory Alpha / ' + (m.zone || '—') + ' / ' + (m.line || '—') : 'Factory Alpha';
}

function renderTabs() {
  const host = tabsEl();
  host.innerHTML = '';
  for (const [key, label] of TABS) {
    host.appendChild(el('button', {
      class: 'tab-btn' + (key === tab ? ' active' : ''),
      role: 'tab',
      'aria-selected': key === tab ? 'true' : 'false',
      tabindex: key === tab ? '0' : '-1',
      'aria-controls': 'inspBody',
      onClick: () => { tab = key; renderTabs(); renderTab(); },
    }, label));
  }
}

function cacheSet(key, p) {
  mCache[key] = { pending: true, p };
  p.then(
    res => { mCache[key] = { resolved: res }; },
    () => { mCache[key] = { resolved: null }; }
  );
  return mCache[key].p;
}

function fetcher(key, fn) {
  const c = mCache[key];
  if (c && c.pending) return c.p;
  if (c && c.resolved !== undefined) return Promise.resolve(c.resolved);
  return cacheSet(key, Promise.resolve().then(fn));
}

function bust() { mCache = {}; }

function renderTab() {
  const host = bodyEl();
  lastBodyRender = Date.now();
  host.innerHTML = '';
  if (!id) { host.innerHTML = '<div class="empty">Select a machine to inspect it.</div>'; return; }
  const m = machine();
  if (!m) { host.innerHTML = '<div class="empty">Machine no longer present.</div>'; return; }
  switch (tab) {
    case 'overview': return overview(host, m);
    case 'telemetry': return telemetryTab(host, m);
    case 'prediction': return predictionTab(host, m);
    case 'explanation': return explanationTab(host, m);
    case 'dependencies': return dependenciesTab(host, m);
    case 'events': return eventsTab(host, m);
    case 'impact': return impactTab(host, m);
    case 'maintenance': return maintenanceTab(host, m);
  }
}

function meterBox(frac, tone) {
  const f = clamp01(frac == null ? 0 : +frac);
  return el('div', { class: 'meter' }, el('div', { class: 'meter-fill m-' + tone, style: { width: pct(f, 0) } }));
}

function statBox(label, value, sub, meter) {
  const cls = 'stat-box' + (meter && meter.tone ? ' tone-' + meter.tone : '');
  return el('div', { class: cls },
    el('div', { class: 'l' }, label),
    el('div', { class: 'v' }, value),
    sub ? el('div', { class: 's' }, sub) : null,
    meter ? meterBox(meter.frac, meter.tone) : null);
}

function kvRow(label, value) {
  return el('div', { class: 'kv' }, el('b', {}, label), el('span', {}, value == null ? '—' : value));
}

function emptyLine(msg) { return el('div', { class: 'empty' }, msg); }
function errorBox(msg) { return el('div', { class: 'error-box' }, msg); }

async function overview(host, m) {
  const a = anomalyInfo(m.anomalyScore);
  const s = machineState(m);
  const hTone = healthInfo(m.healthScore);
  host.appendChild(el('div', { class: 'insp-head-line' },
    el('div', { class: 'name' }, m.name,
      el('span', { class: 'pill-status st-' + (s.state === 'STALE' ? 'stale' : s.tone), title: s.hint }, s.label.toUpperCase()),
      el('span', { class: 'tag tag-' + (a.tone === 'good' ? 'info' : a.tone) }, 'Anomaly ' + a.band)),
    el('div', { class: 'meta' }, `${m.zone || '—'} / ${m.line || '—'} · ${esc(m.typeLabel || m.type || '')} · criticality ${esc(m.criticality || 'standard')}`)));
  if (s.state !== 'NORMAL' && s.state !== 'UNKNOWN' && s.guidance) {
    host.appendChild(el('div', { class: 'alert-guide', style: { marginTop: '6px', marginBottom: '4px' } }, s.guidance));
  }
  host.appendChild(el('div', { class: 'stat-grid' },
    statBox('Health', m.healthScore != null ? num(m.healthScore, 1) + '%' : '—', hTone === 'good' ? 'within operating bounds' : hTone === 'warn' ? 'low — inspect' : 'critical — act now', m.healthScore != null ? { frac: m.healthScore / 100, tone: hTone } : null),
    statBox('Anomaly score', pct(m.anomalyScore), a.band + ' divergence from baseline', m.anomalyScore != null ? { frac: m.anomalyScore, tone: a.tone } : null),
    statBox('Failure risk', pct(m.failureRisk), riskInfo(m.failureRisk).band + ' over modeled horizon', m.failureRisk != null ? { frac: m.failureRisk, tone: riskInfo(m.failureRisk).tone } : null),
    statBox('Est. remaining steps', m.rulEstimate != null ? int(m.rulEstimate) + ' steps' : '—', 'synthetic model output'),
    statBox('Model', (m.modelMode || '—') + ' · v' + (m.modelVersion || '—'), 'mode · version'),
    statBox('Last telemetry', m.lastTelemetryAt ? timeAgo(m.lastTelemetryAt) : '—', 'sample received')));

  const detail = await fetcher('detail', () => api(`/api/v1/machines/${id}`));
  const d = (detail && typeof detail === 'object') ? detail : null;
  host.appendChild(el('div', { class: 'card', style: { marginTop: '10px' } },
    el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, 'Machine facts')),
    el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
      kvRow('Operating hours', d && d.operatingHours != null ? int(d.operatingHours) + ' h' : '—'),
      kvRow('Throughput', d && d.throughputPerHour != null ? d.throughputPerHour + ' /h' : '—'),
      kvRow('Last maintenance', d && d.lastMaintenance ? fmtDateTime(d.lastMaintenance) : 'never recorded'),
      kvRow('Next due', d && d.nextMaintenance ? fmtDateTime(d.nextMaintenance) : '—'),
      kvRow('Maintenance state', d && d.maintenanceStatus ? esc(d.maintenanceStatus) : '—'),
      kvRow('Sensors', (d && d.sensors && d.sensors.length) ? d.sensors.join(', ') : '—'),
      kvRow('Connectivity', d && d.connectivity ? esc(d.connectivity) : (m.connectivity || '—')),
      kvRow('Description', d && d.description ? esc(d.description) : '—'))));
}

function metricChoices(m) {
  const sensors = (m.sensors || []).filter(nm => sensorLabel(nm.toLowerCase()).sensor);
  const all = ['TEMPERATURE', 'VIBRATION', 'PRESSURE', 'RPM', 'TORQUE', 'CURRENT', 'VOLTAGE', 'POWER', 'FLOW'];
  const have = sensors.length ? sensors : all;
  return have;
}

async function telemetryTab(host, m) {
  const metrics = metricChoices(m);
  if (!metrics.includes(teleCfg.metric)) teleCfg.metric = metrics[0];
  const sel = metrics[0];
  teleCfg.metric = teleCfg.metric || sel;
  teleCfg.metric = metrics.includes(teleCfg.metric) ? teleCfg.metric : sel;

  const controls = el('div', { class: 'toolbar' },
    el('select', {
      className: 'search',
      style: { minWidth: '150px' },
      onChange: e => { teleCfg.metric = e.target.value; renderTab(); },
    }, metrics.map(mm => el('option', { value: mm }, sensorLabel(mm.toLowerCase()).label))),
    RANGES.map(([sec, lbl]) => el('button', {
      class: 'btn btn-sm' + (teleCfg.range === sec ? ' btn-primary' : ''),
      onClick: () => { teleCfg.range = sec; renderTab(); },
    }, lbl)));
  controls.querySelector('select').value = teleCfg.metric;
  host.appendChild(el('div', { class: 'insp-head-line' },
    el('div', { class: 'name' }, m.machineId + ' · telemetry'),
    el('div', { class: 'meta' }, 'sample basis OBSERVED (simulator→Kafka→API)')));

  const secs = Number(teleCfg.range);
  let res = secs > 4200
    ? await fetcher('tel-l', () => api(`/api/v1/machines/${id}/telemetry?limit=240`))
    : await fetcher('tel-r' + secs, () => api(`/api/v1/machines/${id}/telemetry/range?seconds=${secs}`));

  const rows = (res && Array.isArray(res.rows) && res.rows) || [];
  host.appendChild(controls);
  if (!rows.length) { host.appendChild(emptyLine('No telemetry rows in this window (GET /api/v1/machines/' + esc(id) + '/telemetry/range?seconds=' + secs + ').')); return; }

  const meta = sensorLabel(teleCfg.metric.toLowerCase());
  const key = teleCfg.metric.toLowerCase();
  const data = rows.map(r => r[key]);
  const times = rows.map(r => { const t = new Date(r.timestamp); return Number.isNaN(t.getTime()) ? null : t; });
  const cv = el('canvas', { class: 'chart', style: { height: '220px' } });
  host.appendChild(cv);
  drawLineChart(cv, {
    labels: times.map(t => t ? t : new Date(rows[0].timestamp)),
    series: [{ color: COLORS[key] || COLORS[teleCfg.metric.toLowerCase()] || COLORS.temperature, data }],
    yFormat: v => Number(v).toFixed(1),
    xTicks: times.map(t => t ? t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''),
  });
  const latest = rows[rows.length - 1];
  host.appendChild(el('div', { class: 'kv', style: { marginTop: '8px' } },
    el('b', {}, 'Latest ' + meta.label),
    el('span', { class: 'mono' }, (latest[key] != null ? num(latest[key], 2) : '—') + (meta.unit ? ' ' + meta.unit : ''))));
  host.appendChild(el('div', { class: 'muted small', style: { marginTop: '4px' } },
    rows.length + ' samples · every ~5s · basis OBSERVED'));
}

function seedLabels(times) {
  if (times.length < 2) return ['', ''];
  const step = Math.max(1, Math.floor(times.length / 40));
  const out = [];
  for (let i = 0; i < times.length; i += step) out.push(times[i]);
  if (out[out.length - 1] !== times[times.length - 1]) out.push(times[times.length - 1]);
  return out;
}

async function predictionTab(host, m) {
  host.appendChild(el('div', { class: 'loading' }, 'Loading predictions…'));
  const preds = await fetcher('preds', () => api(`/api/v1/machines/${id}/predictions`));
  host.lastChild && host.lastChild.remove();
  const list = Array.isArray(preds) ? preds.slice().sort((a, b) => {
    const at = new Date(a.timestamp).getTime();
    const bt = new Date(b.timestamp).getTime();
    return Number.isNaN(bt) - Number.isNaN(at) || (Number.isNaN(at) && Number.isNaN(bt) ? 0 : bt - at || (b.id || '') > (a.id || '') ? 1 : -1);
  }) : [];
  const latest = list.length ? list[list.length - 1] : null;
  if (!latest) {
    host.appendChild(emptyLine('No predictions recorded yet — the ML pipeline has not produced an output for ' + esc(id) + '.'));
    return;
  }
  const a = anomalyInfo(latest.anomalyScore);
  host.appendChild(el('div', { class: 'insp-head-line' },
    el('div', { class: 'name' }, 'Latest prediction',
      el('span', { class: 'tag tag-' + (a.tone === 'good' ? 'info' : a.tone) }, a.band)),
    el('div', { class: 'meta' }, (latest.timestamp ? 'as of ' + fmtDateTime(latest.timestamp) : '') + ' · mode ' + esc(latest.mode || '—') + ' · v' + esc(latest.modelVersion || 'none'))));
  host.appendChild(el('div', { class: 'stat-grid' },
    statBox('Failure risk', pct(latest.failureRisk), riskInfo(latest.failureRisk).band),
    statBox('Anomaly score', pct(latest.anomalyScore), a.band),
    statBox('Health', latest.healthScore != null ? num(latest.healthScore, 1) + '%' : '—', healthInfo(latest.healthScore))));

  if (list.length > 1) {
    const chrono = list.slice().reverse();
    const cv = el('canvas', { class: 'chart sm', style: { height: '140px' } });
    host.appendChild(el('div', { style: { marginTop: '10px' } },
      el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, 'Prediction history'), el('span', { class: 'card-sub' }, chrono.length + ' points')),
      cv));
    const times = chrono.map(p => (p.timestamp ? new Date(p.timestamp) : new Date((chrono[0] || {}).timestamp)));
    drawLineChart(cv, {
      labels: times,
      series: [
        { color: COLORS.risk, data: chrono.map(p => p.failureRisk) },
        { color: COLORS.anomaly, data: chrono.map(p => p.anomalyScore) },
      ],
      yFormat: v => pct(v, 0),
      xTicks: times.map(t => t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })),
    });
  }
  host.appendChild(el('div', { class: 'muted small', style: { marginTop: '10px' } },
    'Mode ' + esc((latest.mode || '')).toUpperCase() + (latest.modelVersion && latest.modelVersion !== 'none' ? ' (model v' + esc(latest.modelVersion) + ')' : '') + ' — when the ML service is slow or down the backend continues with a heuristic estimator and labels this honestly. Attribution is baseline-perturbation feature attribution, not SHAP.'));
}

async function explanationTab(host, m) {
  host.appendChild(el('div', { class: 'loading' }, 'Loading attribution…'));
  const ex = await fetcher('expl', () => api(`/api/v1/machines/${id}/explanation`));
  host.lastChild && host.lastChild.remove();
  const factors = (ex && Array.isArray(ex.factors)) ? ex.factors : [];
  if (!factors.length) {
    host.appendChild(emptyLine('No attribution yet — the model has not run for ' + esc(id) + '. (GET /api/v1/machines/' + esc(id) + '/explanation)' + (ex && ex.message ? ' · ' + esc(ex.message) : '')));
    return;
  }
  host.appendChild(el('div', { class: 'insp-head-line' },
    el('div', { class: 'name' }, 'Feature attribution'),
    el('div', { class: 'meta' }, (ex.timestamp ? 'as of ' + fmtDateTime(ex.timestamp) : '') + ' · mode ' + esc(ex.mode || '—') + ' · risk ' + pct(ex.failureRisk))));
  host.appendChild(el('div', { class: 'muted small', style: { marginBottom: '8px' } },
    'Which signals pushed the risk score away from its operating baseline. Longer bars = larger contribution to the anomaly/risk decision.'));

  for (const f of factors) {
    const meta = sensorLabel(f && f.feature);
    const mag = clamp01(f.contribution);
    const up = String(f.direction || 'high').toLowerCase() !== 'low';
    host.appendChild(el('div', { class: 'factor-row' },
      el('div', { class: 'fa' }, meta.label),
      el('div', { class: 'fb' },
        el('div', { class: 'pc' },
          el('div', { class: 'bar' }, el('div', { class: 'bar-fill f-' + (up ? 'warn' : 'good'), style: { width: pct(mag, 0) } })),
          el('div', { class: 'bar-cap' },
            el('span', {}, esc(f.label || '') + ' · ' + (up ? 'elevated' : 'within bounds'))))),
      el('div', { class: 'pv' }, pct(mag))));
    host.appendChild(el('div', { class: 'kv' },
      el('b', meta.label),
      el('span', { class: 'muted small' }, (up ? 'drives risk up' : 'drives risk down') + ' by ' + pct(mag))));
  }
  host.appendChild(el('div', { class: 'muted small', style: { marginTop: '10px' } },
    'Method: the ML service perturbs inputs against an operating baseline and attributes the risk delta to each signal. This is model-agnostic attribution; the UI does not claim SHAP values.'));
}

function clamp01(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function dependenciesTab(host, m) {
  const edges = store.dependencies || [];
  const up = edges.filter(e => e.downstream === id);
  const down = edges.filter(e => e.upstream === id);
  host.appendChild(el('div', { class: 'insp-head-line' },
    el('div', { class: 'name' }, 'Dependencies'),
    el('div', { class: 'meta' }, up.length + ' upstream · ' + down.length + ' downstream · configured model')));
  function group(title, items) {
    if (!items.length) return emptyLine('No ' + title.toLowerCase() + ' edges for ' + esc(id) + '.');
    return el('div', { style: { marginTop: '8px' } },
      el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, title)),
      el('div', { class: 'list' }, items.map(e => {
        const other = e.downstream === id ? e.upstream : e.downstream;
        const otherM = store.machineMap.get(other);
        const rel = (e.relation || '').toUpperCase();
        return el('div', { class: 'list-item clickable', onClick: () => { selectMachine(other); openInspector(other); } },
          el('div', { class: 'alert-main' },
            el('div', { class: 'alert-title' }, esc(otherM ? otherM.name + ' · ' + other : other)),
            el('div', { class: 'alert-meta' },
              el('span', { class: 'badge2' }, esc(rel)),
              el('span', {}, 'delay ' + esc(e.delayMinutes != null ? e.delayMinutes + 'm' : '—')),
              el('span', {}, 'propagation ' + pct(e.propagationFactor)))));
      })));
  }
  host.appendChild(group('Upstream — feeds this machine', up));
  host.appendChild(group('Downstream — this machine feeds', down));
  host.appendChild(el('div', { class: 'muted small', style: { marginTop: '8px' } },
    'Edges describe plant-model relations (material, power, cooling, service) and how a condition may propagate. They are configured plant knowledge, not ML output.'));
}

async function eventsTab(host, m) {
  host.appendChild(el('div', { class: 'loading' }, 'Loading events…'));
  const evs = await fetcher('evs', () => api(`/api/v1/machines/${id}/events?limit=50`));
  host.lastChild && host.lastChild.remove();
  const list = Array.isArray(evs) ? evs : [];
  if (!list.length) { host.appendChild(emptyLine('No events recorded for ' + esc(id) + ' yet.')); return; }
  host.appendChild(el('div', { class: 'feed' }, list.map(e => el('div', { class: 'ev' },
    el('time', {}, fmtTime(e.eventTime)),
    el('span', { class: 'ec' }, esc(e.eventType || 'EVENT')),
    el('span', { class: 'em' }, esc(e.detail || '')),
    el('span', {}, el('span', { class: 'muted small' }, esc(e.source || '')))))));
}

async function impactTab(host, m) {
  host.appendChild(el('div', { class: 'loading' }, 'Loading impact…'));
  const imp = await fetcher('imp', () => api(`/api/v1/impact/${id}`));
  host.lastChild && host.lastChild.remove();
  const hasImpact = imp && imp.hasImpact && imp.latest;
  if (!hasImpact) {
    host.appendChild(emptyLine((imp && imp.message) ? esc(imp.message) : 'No production-impact estimate on record for ' + esc(id) + '.'));
    host.appendChild(el('div', { class: 'btn-row', style: { marginTop: '10px' } },
      el('button', { class: 'btn', onClick: () => doAnalyze(m) }, 'Analyze production impact')));
    return;
  }
  const l = imp.latest;
  host.appendChild(el('div', { class: 'spacer', style: { height: '8px' } }));
  host.appendChild(el('div', { class: 'tag tag-warning', style: { display: 'inline-block', marginBottom: '8px' } }, 'ESTIMATED — modeled assumption, not a measurement'));
  host.appendChild(el('div', { class: 'stat-grid' },
    statBox('Downtime', l.estimatedDowntimeMinutes != null ? int(l.estimatedDowntimeMinutes) + ' min' : '—', 'estimated duration'),
    statBox('Throughput loss', (l.throughputLossUnits != null ? int(l.throughputLossUnits) : '—') + (l.throughputLossUnits != null ? ' units' : ''), 'estimated'),
    statBox('Production loss', (l.productionLossUnits != null ? int(l.productionLossUnits) : '—') + (l.productionLossUnits != null ? ' units' : ''), 'estimated'),
    statBox('Affected machines', l.affectedMachineCount != null ? int(l.affectedMachineCount) : '—', (l.affectedMachineIds || []).slice(0, 4).join(', ')),
    statBox('Criticality', esc(l.criticality || '—'), 'impact level'),
    statBox('Recovery assumption', esc(l.recoveryAssumption || '—'), 'assumption')));
  host.appendChild(kvRow('Affected lines', (l.affectedLines || []).join(', ') || '—'));
  host.appendChild(kvRow('Affected zones', (l.affectedZones || []).join(', ') || '—'));
  host.appendChild(kvRow('Generated', l.createdAt ? fmtDateTime(l.createdAt) : '—'));

const hist = (imp.history || []).filter(h => !l.id || h.id !== l.id).slice(0, 8);
  if (hist.length) {
    const feed = el('div', { class: 'feed' });
    for (const h of hist) {
      feed.appendChild(el('div', { class: 'ev' },
        el('time', {}, fmtDateTime(h.createdAt)),
        el('span', { class: 'ec' }, esc(h.impactType || 'IMPACT')),
        el('span', { class: 'em' }, int(h.estimatedDowntimeMinutes) + ' min · ' + int(h.productionLossUnits) + ' production units')));
    }
    host.appendChild(el('div', { style: { marginTop: '10px' } },
      el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, 'Impact history')),
      feed));
  }
  host.appendChild(el('div', { class: 'btn-row', style: { marginTop: '10px' } },
    el('button', { class: 'btn', onClick: () => doAnalyze(m) }, 'Re-analyze impact')));
}

async function doAnalyze(m) {
  const res = await post('/api/v1/impact/analyze', { machineId: m.machineId });
  if (res && res.latest) {
    mCache.imp = { resolved: res };
    renderTab();
  } else {
    mCache.imp = { resolved: res };
    renderTab();
  }
}

const W_ORDER_ENDPOINT = '/api/v1/maintenance';

async function maintenanceTab(host, m) {
  const orders = (store.maintenance && store.maintenance.items || []).filter(o => o.machineId === id);
  host.appendChild(el('div', { class: 'insp-head-line' },
    el('div', { class: 'name' }, 'Maintenance'),
    el('div', { class: 'meta' }, (m.maintenanceStatus || 'none') + ' maintenance state · ' + orders.length + ' work order(s)')));
  if (!orders.length) { host.appendChild(emptyLine('No work orders on record for ' + esc(id) + '.')); return; }
  for (const o of orders) host.appendChild(orderCard(o));
  host.appendChild(el('div', { class: 'muted small', style: { marginTop: '8px' } },
    'Completing work moves the machine through the backend state machine (MAINTENANCE → RECOVERING → NORMAL). Transitions happen on the backend; the UI reflects live status.'));
}

function orderCard(o) {
  const canEdit = userCan(getRoles(), 'ENGINEER');
  const actions = el('div', { class: 'alert-actions' });
  const act = (label, fn, onlyWhen) => {
    const dis = !canEdit || (onlyWhen && !onlyWhen());
    return el('button', {
      class: 'btn btn-sm',
      disabled: dis ? 'disabled' : null,
      title: !canEdit ? 'Requires ENGINEER role' : '',
      onClick: async () => {
      try { await fn(); refreshMaintenance(); }
      catch (e) { flashError(e); }
    },
    }, label);
  };
  const isOpen = s => !['COMPLETED', 'CANCELLED'].includes(s);
  if (o.status === 'RECOMMENDED') actions.appendChild(act('Schedule', () => schedulePrompt(o), () => true));
  if (['RECOMMENDED', 'SCHEDULED'].includes(o.status)) {
    actions.appendChild(act('Start', () => post(`${W_ORDER_ENDPOINT}/${o.id}/start`), () => true));
  }
  if (['ACTIVE', 'SCHEDULED'].includes(o.status)) {
    actions.appendChild(act('Complete', () => post(`${W_ORDER_ENDPOINT}/${o.id}/complete`, { notes: 'Completed from control room.' }), () => true));
  }
  if (isOpen(o.status)) {
    actions.appendChild(act('Cancel', () => post(`${W_ORDER_ENDPOINT}/${o.id}/cancel`), () => true));
  }
  const stTone = { RECOMMENDED: 'warn', SCHEDULED: 'info', ACTIVE: 'critical', COMPLETED: 'good', CANCELLED: 'down' }[o.status] || 'muted';
  return el('div', { class: 'list-item', style: { marginTop: '8px' } },
    el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
      el('span', { class: 'pill-status st-' + stTone }, o.status || '—'),
      o.priority ? el('span', { class: 'badge2' }, 'P' + esc(o.priority)) : null,
      o.assignedRole ? el('span', { class: 'badge2' }, esc(o.assignedRole)) : null,
      o.riskAtCreation != null ? el('span', { class: 'muted small' }, 'risk at creation ' + pct(o.riskAtCreation)) : null),
    el('div', { style: { fontWeight: '600', fontSize: 'var(--text-13)', margin: '6px 0 2px' } }, esc(o.title || 'Work order')),
    el('div', { class: 'alert-desc' }, esc(o.description || '')),
    el('div', { class: 'alert-meta', style: { marginTop: '6px' } },
      (o.estimatedDurationMinutes ? '~' + int(o.estimatedDurationMinutes) + ' min · ' : ''),
      (o.scheduledAt ? 'scheduled ' + fmtDateTime(o.scheduledAt) + ' · ' : ''),
      (o.startedAt ? 'started ' + fmtDateTime(o.startedAt) + ' · ' : ''),
      (o.completedAt ? 'completed ' + fmtDateTime(o.completedAt) + ' · ' : ''),
      (o.resultSummary ? 'result: ' + esc(o.resultSummary) : '')),
    actions);
}

function schedulePrompt(o) {
  const val = new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 16);
  const input = el('input', { type: 'datetime-local', value: val, onchange: () => { /* keep */ } });
  const toast = document.getElementById('toast');
  toast.innerHTML = '';
  toast.classList.remove('hidden');
  toast.appendChild(el('span', {}, 'Schedule "' + esc(o.title) + '"?'));
  toast.appendChild(input);
  toast.appendChild(el('button', {
    class: 'btn btn-sm',
    onClick: async () => {
      const iso = new Date(input.value).toISOString();
      toast.classList.add('hidden');
      try {
        await post(`${W_ORDER_ENDPOINT}/${o.id}/schedule`, { scheduledAt: iso });
        refreshMaintenance();
      } catch (e) { flashError(e); }
    },
  }, 'Schedule'));
  toast.appendChild(el('button', { class: 'btn btn-sm', onClick: () => toast.classList.add('hidden') }, 'Cancel'));
  window.setTimeout(() => toast.classList.add('hidden'), 20000);
}

export function subscribeInspector() {
  return subscribe(s => {
    if (s.selectedMachineId && s.selectedMachineId !== id) {
      id = s.selectedMachineId;
      tab = 'overview';
      bust();
      renderHead();
      renderTabs();
      if (isOpen()) renderTab();
    }
    if (isOpen() && s.selectedMachineId === id && s.liveEventCount !== lastLiveEventCount) {
      lastLiveEventCount = s.liveEventCount;
      if (tab === 'overview' || tab === 'telemetry' || tab === 'prediction') {
        if (liveRenderTimer) window.clearTimeout(liveRenderTimer);
        liveRenderTimer = window.setTimeout(() => { liveRenderTimer = null; if (isOpen()) { bust(); renderHead(); renderTab(); } }, 120);
      }
    }
  });
}

export function forceRefresh() {
  if (isOpen()) { bust(); renderTab(); }
}

export function selectedTab() { return tab; }
export function selectedId() { return id; }
