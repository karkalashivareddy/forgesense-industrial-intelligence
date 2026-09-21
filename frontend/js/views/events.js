import { el, esc, fmtDateTime, timeAgo } from '../util.js';
import { store } from '../state.js';
import { card, emptyBox, machineClick } from '../shared.js';

let root = null;
let query = '';
let lastRef = '';
export function mount(container) { root = container; render(); }
export function unmount() { root = null; }
export function activate() { render(); }
export function update(s) { const ref = `${s.liveEventCount}|${query}|${s.events?.items?.length || 0}`; if (ref !== lastRef) { lastRef = ref; render(); } }

function render() {
  if (!root) return;
  const rows = (store.events?.items || []).filter(e => {
    const q = query.trim().toLowerCase();
    return !q || `${e.eventType || ''} ${e.machineId || ''} ${e.source || ''} ${e.description || ''}`.toLowerCase().includes(q);
  });
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'page-title' }, 'Events', el('span', { class: 'sub' }, 'Unified operational timeline · synthetic simulator feed')));
  root.appendChild(el('div', { class: 'toolbar' },
    el('input', { className: 'search', placeholder: 'Search event type, asset or source…', 'aria-label': 'Search events', value: query, oninput: e => { query = e.target.value; render(); } }),
    el('span', { class: 'muted small' }, `${rows.length} of ${(store.events?.items || []).length} retained events`)));
  const list = rows.length ? rows.map(e => el('div', {
    class: 'ev', tabindex: e.machineId ? '0' : null,
    role: e.machineId ? 'button' : null,
    onClick: () => e.machineId && machineClick(store.machineMap.get(e.machineId) || { machineId: e.machineId }),
    onkeydown: x => {
      if (!e.machineId) return;
      if (x.key === 'Enter' || x.key === ' ') { x.preventDefault(); machineClick(store.machineMap.get(e.machineId) || { machineId: e.machineId }); }
    },
  },
    el('time', {}, fmtDateTime(e.timestamp || e.createdAt || e.eventTime)), el('span', { class: 'ec' }, esc(e.eventType || 'EVENT')), el('span', { class: 'em' }, esc(e.description || e.message || e.headline || 'Operational event')), el('span', { class: 'muted small' }, esc(e.machineId || e.source || 'system')))) : [emptyBox('No events in the current window — the feed carries synthetic telemetry; run a Simulation scenario to drive activity.')];
  root.appendChild(card('Event stream', 'Newest accepted events first', el('div', { class: 'feed' }, list)));
}
