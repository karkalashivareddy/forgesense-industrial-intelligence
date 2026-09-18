import { el, esc, pct, num, int, fmtTime, timeAgo, statusInfo, riskInfo, anomalyInfo, machineState, fleetSummary, avgHealth } from '../util.js';
import { api } from '../api.js';
import { store, selectMachine } from '../state.js';
import { openInspector } from './inspector.js';
import { kpi, card, statusPill, healthBar, statusDot, toneColor, fleetBar } from '../shared.js';

let root = null;
let lastRef = null;
let impactCache = null;

export function mount(container) {
  root = container;
  render();
  loadImpact();
}

export function unmount() { /* stateless */ }

export function update(s) {
  if (!root) return;
  const ref = (s.machines || []).map(m =>
    m.machineId + ':' + m.status + ':' + (m.failureRisk != null ? Math.round(m.failureRisk * 100) : '-') + ':' + (m.healthScore != null ? Math.round(m.healthScore) : '-')).join('|')
    + '|' + ((s.events || {}).count ?? '') + '|' + s.selectedMachineId;
  if (ref === lastRef) return;
  lastRef = ref;
  render();
}

async function loadImpact() {
  const top = ranked()[0];
  if (!top) return;
  try {
    const r = await api(`/api/v1/impact/${top.machineId}`);
    impactCache = r && r.hasImpact ? r : null;
    if (root && root.querySelector('#impactHost')) renderImpact();
  } catch {
    impactCache = null;
  }
}

function ranked() {
  return (store.machines || []).slice().sort((a, b) => (b.failureRisk ?? -1) - (a.failureRisk ?? -1) || String(a.machineId || '').localeCompare(String(b.machineId || '')));
}

function opState(fs) {
  if (fs.offline || fs.critical) return { label: 'OUTAGE', tone: 'critical' };
  if (fs.attn) return { label: 'ATTENTION', tone: 'warn' };
  return { label: 'OPERATIONAL', tone: 'good' };
}

function render() {
  root.innerHTML = '';
  root.className = 'view active command-page';
  const fs = fleetSummary(store.machines);
  const avg = avgHealth(store.machines);
  const op = opState(fs);
  const critList = (store.machines || []).filter(m => m.status !== 'NORMAL');

  root.appendChild(el('div', { class: 'page-title command-masthead' }, 'Command Center',
    el('span', { class: 'pill-status st-' + op.tone, id: 'cmdOpState' }, 'Factory ' + op.label),
    el('span', { class: 'sub' }, 'avg health ' + (avg != null ? num(avg, 0) + '%' : '—') + ' · synthetic demo plant')));

  root.appendChild(el('div', { class: 'ops-strip' },
    kpi('Healthy', fs.normal + '/' + fs.total, 'operating within bounds', 'good'),
    kpi('Attention', fs.attn, fs.degraded + ' degraded · ' + fs.warning + ' warning', 'warn'),
    kpi('Critical', fs.critical, 'immediate focus', fs.critical ? 'critical' : 'good'),
    kpi('Offline & maintenance', (fs.offline + fs.maintenance), fs.offline + ' offline · ' + fs.maintenance + ' in maint', 'maint'),
    kpi('At risk (≥ 50%)', fs.atRisk, 'modeled failure risk', fs.atRisk ? 'warn' : 'good')));

  root.appendChild(el('div', { class: 'card fleet-signal', style: { marginTop: '12px' } },
    el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, 'Fleet health'),
      el('span', { class: 'card-sub' }, 'aggregate across zones · live from telemetry feed')),
    fleetBar(fs)));

  root.appendChild(el('div', { class: 'command-layout', style: { marginTop: '12px' } },
    situationsCard(critList),
    zoneMapCard(),
    sideColumn(fs)));

  root.appendChild(detectionChain());
}

function situationsCard(critList) {
  const body = el('div', { class: 'list', style: { gap: '8px' } });
  if (!critList.length) {
    body.appendChild(el('div', { class: 'empty' }, 'All machines are NORMAL right now. Run a degrade scenario (Simulation) to animate this screen.'));
  }
  for (const m of critList.slice(0, 6)) {
    const s = machineState(m);
    const r = riskInfo(m.failureRisk);
    const a = anomalyInfo(m.anomalyScore);
    body.appendChild(el('div', {
      class: 'list-item clickable',
      onClick: () => { selectMachine(m.machineId); openInspector(m.machineId); },
    },
      el('div', { class: 'alert-main' },
        el('div', { class: 'alert-title' }, statusDot(m), ' ', m.machineId, ' · ', esc(m.name || ''), ' ',
          el('span', { class: 'pill-status st-' + (s.state === 'STALE' ? 'stale' : s.tone), style: { marginLeft: '4px' } }, s.label.toUpperCase())),
        el('div', { class: 'alert-meta' },
          el('span', { class: 'badge2' }, esc(m.zone || '')),
          el('span', {}, 'risk ' + pct(m.failureRisk)),
          el('span', {}, 'anomaly ' + pct(m.anomalyScore) + ' · ' + a.band),
          m.rulEstimate != null ? el('span', {}, 'est steps ' + int(m.rulEstimate)) : null), s.guidance ? el('div', { class: 'alert-guide' }, s.guidance) : null)));
  }
  const panel = card('Situation', 'machines not NORMAL', body);
  panel.classList.add('situation-panel');
  return panel;
}

function zoneMapCard() {
  const zones = store.zones || [];
  const body = el('div', { class: 'zone-map' });
  if (!zones.length) {
    body.appendChild(el('div', { class: 'empty' }, 'Zone layout not loaded from /api/v1/zones yet.'));
    return card('Zones', 'click to focus the 3D twin', body);
  }
  for (const z of zones) {
    const inZone = (store.machines || []).filter(m => m.zone === z.code);
    const stc = {};
    inZone.forEach(m => { const t = machineState(m).tone; stc[t] = (stc[t] || 0) + 1; });
    body.appendChild(el('div', {
      class: 'zone-cell',
      onClick: () => window.dispatchEvent(new CustomEvent('forge:zone', { detail: { code: z.code } })),
    },
      el('div', { class: 'zc-head' },
        el('span', { class: 'zc-name' }, z.name || z.code),
        el('span', { class: 'muted small' }, inZone.length + ' machines')),
      el('div', { class: 'zc-stat' },
        inZone.length ? inZone.map(m => {
          const t = machineState(m).tone;
          return el('span', { class: 'm' }, el('span', { style: { width: '8px', height: '8px', borderRadius: '2px', background: toneColor(t), display: 'inline-block' } }),
            m.machineId + ' · ' + num(m.healthScore, 0) + '%');
        }) : el('span', { class: 'muted small' }, 'no machines'),
        el('span', { class: 'muted small', style: { marginLeft: 'auto' } },
          Object.keys(stc).map(k => k + ':' + stc[k]).join(' ')))));
  }
  const panel = card('Factory map', 'zoom into 3D or open inspector', body);
  panel.classList.add('zone-panel');
  return panel;
}

function sideColumn(fs) {
  const top = ranked()[0];
  const body = el('div', {});
  if (top) {
    body.appendChild(el('div', { class: 'kv' }, el('b', {}, 'Top risk'), el('span', {}, el('a', { class: 'link', href: '#/factory', onclick: e => { e.preventDefault(); selectMachine(top.machineId); openInspector(top.machineId, 'prediction'); } }, top.machineId + ' · ' + pct(top.failureRisk)))));
  }
  body.appendChild(el('div', { class: 'kv' }, el('b', {}, 'Production efficiency'), el('span', {},
    store.analytics && store.analytics.productionEfficiency ? pct(store.analytics.productionEfficiency.value, 0) : '—')));
  body.appendChild(el('div', { class: 'kv' }, el('b', {}, 'Downtime risk horizon'), el('span', {},
    store.analytics && store.analytics.estimatedDowntimeRiskMinutes != null ? int(store.analytics.estimatedDowntimeRiskMinutes) + ' min' : '—')));
  body.appendChild(el('div', { id: 'impactHost' }));
  body.appendChild(el('div', { class: 'btn-row', style: { marginTop: '10px', flexDirection: 'column', alignItems: 'stretch', gap: '6px' } },
    el('button', { class: 'btn btn-primary', onClick: () => window.location.hash = '#/factory' }, '◉ Open the interactive 3D twin'),
    el('button', { class: 'btn', onClick: () => window.location.hash = '#/simulation' }, 'Run a what-if scenario')));
  const panel = card('Production impact', 'estimate from impact engine', body);
  panel.classList.add('impact-panel');
  return panel;
}

function renderImpact() {
  const host = root && root.querySelector('#impactHost');
  if (!host || !impactCache || !impactCache.latest) { if (host) { host.innerHTML = ''; host.appendChild(el('div', { class: 'kv' }, el('b', {}, 'Impact on record'), el('span', {}, 'none — run "Analyze" in a machine inspector'))); } return; }
  const l = impactCache.latest;
  host.innerHTML = '';
  host.appendChild(el('div', { class: 'kv' }, el('b', {}, 'Estimated downtime'), el('span', {}, l.estimatedDowntimeMinutes != null ? int(l.estimatedDowntimeMinutes) + ' min' : '—')));
  host.appendChild(el('div', { class: 'kv' }, el('b', {}, 'Production loss'), el('span', {}, l.productionLossUnits != null ? int(l.productionLossUnits) + ' units' : '—')));
  host.appendChild(el('div', { class: 'kv' }, el('b', {}, 'Affected'), el('span', {}, (l.affectedMachineIds || []).slice(0, 3).join(', '))));
  host.appendChild(el('div', { class: 'muted small' }, el('span', { class: 'tag tag-warning' }, 'ESTIMATED')));
}

function detectionChain() {
  const panel = card('Detection chain', 'from sensor to action (live snapshot + event stream)',
    el('div', { class: 'btn-row', style: { justifyContent: 'space-between', flexWrap: 'wrap' } },
      ['Telemetry', 'ML · risk/anomaly', 'State', 'Alert', 'Impact', 'Maintenance', 'Recovery → Normal'].map((s, i) =>
        el('span', { class: 'badge2', style: { fontSize: '11px' } }, (i + 1) + '. ' + s))));
  panel.classList.add('detection-chain');
  return panel;
}
