import { el, esc, fleetSummary, statusInfo } from '../util.js';
import { store } from '../state.js';

let root = null;
let activeZone = null;
let lastRef = null;

export function mount(container) {
  root = container;
  renderChips();
}

export function unmount() { /* stateless */ }

export function activate() {
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
}