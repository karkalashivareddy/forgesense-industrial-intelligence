import { el, esc, int, num, timeAgo, machineState, sensorLabel } from '../util.js';
import { store } from '../state.js';
import { card, emptyBox, machineClick, statusPill } from '../shared.js';

let root = null;
let query = '';
let lastRef = '';

export function mount(container) { root = container; render(); }
export function unmount() { root = null; }
export function activate() { render(); }
export function update(s) {
  const ref = `${s.liveEventCount}|${s.selectedMachineId}|${s.liveTransport ? s.liveTransport.state : ''}|${query}`;
  if (ref !== lastRef) { lastRef = ref; render(); }
}

function render() {
  if (!root) return;
  const rows = (store.machines || []).filter(m => {
    const q = query.trim().toLowerCase();
    return !q || `${m.machineId} ${m.name || ''} ${m.zone || ''}`.toLowerCase().includes(q);
  });
  const transport = store.liveTransport || {};
  const live = transport.state === 'open';
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'page-title' }, 'Telemetry', el('span', { class: 'sub' }, 'Live condition-monitoring stream')));
  root.appendChild(el('div', { class: 'toolbar' },
    el('input', { className: 'search', placeholder: 'Search assets…', 'aria-label': 'Search assets', value: query, oninput: e => { query = e.target.value; render(); } }),
    el('span', { class: 'pill-status st-' + (live ? 'good' : 'warn') }, live ? 'LIVE · STOMP' : 'REST FALLBACK'),
    el('span', { class: 'muted small' }, `${store.liveEventCount || 0} accepted events`)));
  if (!live) {
    root.appendChild(el('p', { class: 'page-note', role: 'status' },
      'Sensors in this view are fed by the live stream; while transport is down, asset states below reflect the last REST snapshot and sensor samples are not available.'));
  }
  const table = el('table', { class: 'tbl' },
    el('thead', {}, el('tr', {}, ['Asset', 'State', 'Temperature', 'Vibration', 'RPM', 'Pressure', 'Current', 'Last sample'].map(h => el('th', {}, h)))),
    el('tbody', {}, rows.map(m => {
      const t = store.liveTelemetry[m.machineId] || {};
      const state = machineState(m);
      return el('tr', { class: store.selectedMachineId === m.machineId ? 'selected' : '', tabindex: '0', onClick: () => machineClick(m), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); machineClick(m); } } },
        el('td', {}, el('b', {}, m.machineId), el('div', { class: 'muted small' }, esc(m.name || m.typeLabel || ''))),
        el('td', {}, statusPill(m)),
        el('td', { class: 'mono' }, t.temperature == null ? '—' : `${num(t.temperature, 1)} °C`),
        el('td', { class: 'mono' }, t.vibration == null ? '—' : `${num(t.vibration, 2)} mm/s`),
        el('td', { class: 'mono' }, t.rpm == null ? '—' : int(t.rpm)),
        el('td', { class: 'mono' }, t.pressure == null ? '—' : `${num(t.pressure, 1)} bar`),
        el('td', { class: 'mono' }, t.current == null ? '—' : `${num(t.current, 1)} A`),
        el('td', { class: 'muted small' }, t.receivedAt ? timeAgo(new Date(t.receivedAt).toISOString()) : (m.lastTelemetryAt ? timeAgo(m.lastTelemetryAt) : '—')));
    })));
  root.appendChild(card('Sensor register', `${rows.length} assets`, rows.length ? el('div', { style: { overflowX: 'auto' } }, table) : emptyBox('No telemetry matches this filter.')));
}
