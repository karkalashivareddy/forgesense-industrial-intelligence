import { el, esc, userCan } from './util.js';
import { store, selectMachine } from './state.js';
import { getRoles, post } from './api.js';
import { go } from './router.js';
import { openInspector } from './views/inspector.js';

let open = false;
let items = [];
let sel = 0;

const overlay = () => document.getElementById('palette');
const input = () => document.getElementById('paletteInput');
const listEl = () => document.getElementById('paletteList');

export function isOpen() { return open; }

export function openPalette() {
  open = true;
  overlay().classList.remove('hidden');
  build();
  input().value = '';
  input().focus();
}

export function closePalette() {
  open = false;
  overlay().classList.add('hidden');
}

export function togglePalette() {
  if (open) closePalette();
  else openPalette();
}

function fire3d(id) {
  window.dispatchEvent(new CustomEvent('forge:focus3d', { detail: { machineId: id } }));
}

function build() {
  items = [];
  const roles = getRoles();
  const machines = store.machines || [];
  const alerts = (store.alerts && store.alerts.items) || [];

  items.push.apply(items, [
    { g: 'Navigate', label: 'Command Center', k: '1', run: () => go('command') },
    { g: 'Navigate', label: 'Factory Twin (3D)', k: '2', run: () => go('factory') },
    { g: 'Navigate', label: 'Fleet', k: '3', run: () => go('fleet') },
    { g: 'Navigate', label: 'Alerts', k: '4', run: () => go('alerts') },
    { g: 'Navigate', label: 'Predictions', k: '5', run: () => go('predictions') },
    { g: 'Navigate', label: 'Simulation', k: '6', run: () => go('simulation') },
    { g: 'Navigate', label: 'Maintenance', k: '7', run: () => go('maintenance') },
    { g: 'Navigate', label: 'Analytics', k: '8', run: () => go('analytics') },
    { g: 'Navigate', label: 'System', k: '9', run: () => go('system') },
  ]);

  for (const m of machines) {
    items.push({
      g: 'Machines',
      label: m.machineId + ' · ' + (m.name || '') + ' (' + (m.status || '') + ')',
      k: '',
      run: () => { selectMachine(m.machineId); openInspector(m.machineId); fire3d(m.machineId); },
    });
  }
  for (const z of store.zones || []) {
    items.push({
      g: 'Zones',
      label: 'Zone ' + (z.code || '') + ' — ' + (z.name || ''),
      k: '',
      run: () => { go('factory'); window.dispatchEvent(new CustomEvent('forge:zone', { detail: { code: z.code } })); },
    });
  }
  for (const a of alerts.slice(0, 12)) {
    items.push({
      g: 'Alerts',
      label: (a.headline || a.type || 'Alert ' + a.id) + ' — ' + (a.machineId || ''),
      k: '',
      run: () => { go('alerts'); selectMachine(a.machineId); openInspector(a.machineId); },
    });
  }
  items.push({
    g: 'Actions',
    label: userCan(roles, 'ENGINEER') ? 'Run a what-if scenario (Simulation)' : 'View Simulation (run needs ENGINEER)',
    k: '6',
    run: () => go('simulation'),
  });
  items.push({
    g: 'Actions',
    label: 'Keyboard shortcuts & guides',
    k: '?',
    run: () => window.dispatchEvent(new CustomEvent('forge:shortcuts')),
  });
  renderList('');
  sel = 0;
}

function renderList(filter) {
  const host = listEl();
  const q = filter.trim().toLowerCase();
  const visible = q
    ? items.filter(i => (i.label + ' ' + i.k + ' ' + i.g).toLowerCase().includes(q))
    : items;
  host.innerHTML = '';
  let lastG = null;
  visible.forEach((it, idx) => {
    if (lastG !== it.g) {
      host.appendChild(el('li', { class: 'pl-g muted small', style: { padding: '4px 10px', letterSpacing: '1px', textTransform: 'uppercase' } }, it.g));
      lastG = it.g;
    }
    const li = el('li', { class: 'pl-item' + (idx === sel ? ' active' : ''), 'data-i': idx, role: 'option' },
      el('span', { class: 'k' }, it.k || ''),
      el('span', {}, it.label), el('span', { class: 'g' }, it.g));
    li.addEventListener('click', () => run(it));
    li.addEventListener('mousemove', () => { sel = idx; paint(); });
    host.appendChild(li);
    li.dataset.i = idx;
  });
  host.scrollTop = 0;
  sel = Math.min(sel, Math.max(0, visible.length - 1));
}

function paint() {
  Array.from(listEl().querySelectorAll('.pl-item')).forEach((li, idx) => {
    li.classList.toggle('active', idx === sel);
    if (idx === sel) li.scrollIntoView({ block: 'nearest' });
  });
}

function run(it) {
  closePalette();
  it.run();
}

export function initPalette() {
  const inp = input();
  inp.addEventListener('input', () => renderList(inp.value));
  inp.addEventListener('keydown', (e) => {
    const vis = Array.from(listEl().querySelectorAll('.pl-item'));
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, vis.length - 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); const li = vis[sel]; if (li) { const idx = +li.dataset.i; const q = inp.value.trim().toLowerCase(); const source = q ? items.filter(i => (i.label + ' ' + i.k + ' ' + i.g).toLowerCase().includes(q)) : items; run(source[idx]); } }
    else if (e.key === 'Escape') { closePalette(); }
  });
  overlay().addEventListener('click', (e) => { if (e.target === overlay()) closePalette(); });
}