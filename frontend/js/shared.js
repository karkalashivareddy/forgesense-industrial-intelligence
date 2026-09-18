import { el, esc, pct, num, int, statusInfo, riskInfo, healthInfo, anomalyInfo, machineState } from './util.js';
import { store, selectMachine } from './state.js';
import { openInspector } from './views/inspector.js';

export function toneColor(tone) {
  return { good: '#3bc97f', warn: '#f0b450', critical: '#f25c4c', maint: '#8f7bff', down: '#5a6780', info: '#38c7ea', muted: '#4d5a6b' }[tone] || '#4d5a6b';
}

export function statusPill(m) {
  const s = machineState(m);
  const cls = s.state === 'STALE' ? 'stale' : s.tone;
  return el('span', { class: 'pill-status st-' + cls, title: s.hint },
    el('span', { class: 'sq' }), s.label.toUpperCase());
}

export function riskPill(m) {
  const r = riskInfo(m && m.failureRisk);
  return el('span', { class: 'pill-status st-' + r.tone }, r.band, ' ', pct(m && m.failureRisk, 0));
}

export function kpi(label, value, sub, tone) {
  return el('div', { class: 'kpi' + (tone ? ' tone-' + tone : '') },
    el('div', { class: 'kpi-label' }, label),
    el('div', { class: 'kpi-value' }, value == null ? '—' : value),
    sub ? el('div', { class: 'kpi-sub' }, sub) : null);
}

export function card(title, sub, ...body) {
  const head = el('div', { class: 'card-head' },
    el('h3', { class: 'card-title' }, title),
    sub ? el('span', { class: 'card-sub' }, sub) : null);
  return el('div', { class: 'card' }, head, ...body);
}

export function healthBar(m) {
  const h = m && m.healthScore;
  const tone = healthInfo(h);
  return el('div', { class: 'bar-row' },
    el('div', { class: 'bar' }, el('div', { class: 'bar-fill f-' + tone, style: { width: pct(h == null ? 0 : h / 100, 0) } })),
    el('div', { class: 'bar-cap' }, el('span', {}, 'Health'), el('b', {}, num(h) + '%')));
}

export function segBar(label, value, tone, sub) {
  return el('div', { class: 'bar-row' },
    el('div', { class: 'bar' }, el('div', { class: 'bar-fill f-' + tone, style: { width: pct(value, 0) } })),
    el('div', { class: 'bar-cap' }, el('span', {}, label), el('b', {}, sub || pct(value, 0))));
}

export function kv(label, value) {
  return el('div', { class: 'kv' }, el('b', {}, label), el('span', {}, value == null ? '—' : value));
}

export function emptyBox(msg) {
  return el('div', { class: 'empty' }, msg || 'No data to display yet.');
}

export function loadingBox() {
  return el('div', { class: 'loading' }, 'Loading…');
}

export function errorBox(msg) {
  return el('div', { class: 'error-box' }, msg || 'Request failed.');
}

export function fleetSegments(fs) {
  const total = fs && fs.total ? fs.total : 0;
  const segs = [
    { key: 'good', label: 'Healthy', tone: 'good', count: (fs.normal || 0) + (fs.recovering || 0) },
    { key: 'warn', label: 'Attention', tone: 'warn', count: fs.attn || 0 },
    { key: 'down', label: 'Offline / Maint', tone: 'down', count: (fs.offline || 0) + (fs.maintenance || 0) },
  ];
  return { total, segs: segs.map(s => ({ ...s, pct: total ? s.count / total : 0 })) };
}

export function fleetBar(fs) {
  const { total, segs } = fleetSegments(fs);
  const bar = el('div', { class: 'fleetbar', role: 'img', 'aria-label': 'Fleet health: ' + total + ' machines total' },
    segs.map(s => el('div', {
      class: 'fleetbar-seg f-' + s.tone,
      style: { width: s.count ? pct(s.pct, 0) : '0%' },
      title: s.label + ': ' + s.count,
    })));
  const legend = el('div', { class: 'fleetbar-legend' },
    segs.map(s => el('span', { class: 'f-' + s.tone },
      el('i', { class: 'sq' }), s.label, ' ', el('b', {}, s.count))));
  return el('div', { class: 'fleetbar-wrap' }, bar, legend);
}

export function insightCard({ tone = 'info', title, lead, conf, why }) {
  const box = el('div', { class: 'insight' });
  const main = el('div', { class: 'insight-main' },
    el('div', { class: 'insight-acc a-' + tone }),
    el('div', { class: 'insight-content' },
      el('div', { class: 'insight-head' },
        el('span', { class: 'insight-title' }, title),
        conf ? el('span', { class: 'conf-tag conf-' + conf.scale }, conf.label + ' confidence') : null),
      lead ? el('div', { class: 'insight-lead' }, lead) : null,
      why ? el('button', { class: 'btn btn-sm insight-toggle', onClick: () => why.classList.toggle('hidden') }, 'Why?') : null));
  box.appendChild(main);
  if (why) {
    why.classList.add('insight-why');
    why.classList.add('hidden');
    box.appendChild(why);
  }
  return box;
}

export function statusDot(m) {
  const s = machineState(m);
  return el('span', {
    style: { background: toneColor(s.tone), width: '7px', height: '7px', borderRadius: '2px', display: 'inline-block' },
  });
}

export function machineClick(m) {
  selectMachine(m.machineId);
  openInspector(m.machineId);
}

export function chartLegend(entries) {
  return el('div', { class: 'chart-legend' },
    entries.map(([color, label]) =>
      el('span', {}, el('span', { class: 'csw', style: { background: color } }), label)));
}