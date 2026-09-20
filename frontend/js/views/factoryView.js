import { el, esc, fleetSummary, statusInfo } from '../util.js';
import { store, selectMachine } from '../state.js';
import { isTwin, disposeTwin } from '../twin3d.js';
import { openInspector } from './inspector.js';

let root = null;
let activeZone = null;
let lastRef = null;

export function mount(container) {
  root = container;
  renderChips();
}

export function unmount() {
  if (isTwin()) disposeTwin();
}

export function activate() {
  window.dispatchEvent(new CustomEvent('forge:ensure3d'));
  renderChips();
}

export function update(s) {
  if (!root) return;
  renderBasis(s);
  const ref = (s.machines || []).map(m => m.machineId + m.status + m.zone).join('|')
    + '|' + (s.zones || []).map(z => z.code).join('|');
  if (ref === lastRef) return;
  lastRef = ref;
  renderChips();
}

export function setActiveZone(code) {
  activeZone = code;
  renderChips();
}

function renderBasis(s) {
  const badge = document.getElementById('twinBasis');
  if (!badge) return;
  const live = s.liveTransport && s.liveTransport.state === 'open';
  const f = s.freshness || { ok: false };
  const sim = !!((s.status && s.status.demoMode) || (s.status && s.status.dataBasis && s.status.dataBasis.includes('SIMULATED')));
  let label = '';
  let tone = 't-warn';
  if (!f.ok) {
    label = 'DISCONNECTED · RETRY';
    tone = 't-err';
  } else if (live) {
    label = 'LIVE · STOMP';
    tone = 't-live';
  } else if (sim) {
    label = 'SIMULATION';
    tone = 't-sim';
  } else {
    label = 'REST SNAPSHOT';
    tone = 't-warn';
  }
  badge.textContent = label;
  badge.className = 'basis-badge ' + tone;
  badge.title = live
    ? 'Live stream: STOMP over WebSocket to ' + (s.liveTransport && s.liveTransport.detail ? s.liveTransport.detail : 'backend')
    : f.ok ? 'Telemetry delivered over REST snapshots (3s poll)' : 'Transport failed — retrying against the backend';
}

function renderChips() {
  if (!root) return;
  const host = document.getElementById('zoneChips');
  if (!host) return;
  host.innerHTML = '';
  for (const z of store.zones || []) {
    const inZone = (store.machines || []).filter(m => m.zone === z.code);
    const warn = inZone.filter(m => m.status !== 'NORMAL').length;
    const btn = el('button', {
      class: 'chip' + (activeZone === z.code ? ' active' : ''),
      'data-zone': z.code,
      'aria-pressed': String(activeZone === z.code),
      onClick: () => window.dispatchEvent(new CustomEvent('forge:zone', { detail: { code: z.code, toggle: true } })),
    }, (z.code || '') + ' · ' + inZone.length + (warn ? ' · ' + warn + '! ' : ''));
    host.appendChild(btn);
  }
  const assets = document.getElementById('twinAssetList');
  if (assets) {
    assets.innerHTML = '';
    for (const m of store.machines || []) {
      const selected = store.selectedMachineId === m.machineId;
      const button = el('button', {
        class: 'twin-asset' + (selected ? ' selected' : ''),
        'aria-pressed': String(selected),
        onClick: () => { selectMachine(m.machineId); openInspector(m.machineId); },
      }, el('span', { class: 'twin-asset-dot st-' + (m.status === 'CRITICAL' ? 'critical' : m.status === 'WARNING' ? 'warn' : 'good'), 'aria-hidden': 'true' }),
      el('span', {}, el('b', {}, m.machineId), el('small', {}, m.name || m.typeLabel || 'asset')));
      assets.appendChild(button);
    }
  }
}
