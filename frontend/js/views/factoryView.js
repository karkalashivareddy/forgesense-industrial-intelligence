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
  const ref = JSON.stringify((s.machines || []).map(m => m.machineId + m.status + m.zone));
  if (ref === lastRef) return;
  lastRef = ref;
  renderChips();
}

export function setActiveZone(code) {
  activeZone = code;
  renderChips();
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
        role: 'listitem',
        'aria-pressed': String(selected),
        onClick: () => { selectMachine(m.machineId); openInspector(m.machineId); },
      }, el('span', { class: 'twin-asset-dot st-' + (m.status === 'CRITICAL' ? 'critical' : m.status === 'WARNING' ? 'warn' : 'good'), 'aria-hidden': 'true' }),
      el('span', {}, el('b', {}, m.machineId), el('small', {}, m.name || m.typeLabel || 'asset')));
      assets.appendChild(button);
    }
  }
}
