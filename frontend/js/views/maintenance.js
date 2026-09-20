import { el, esc, pct, int, fmtDateTime, userCan, timeAgo } from '../util.js';
import { post, getRoles } from '../api.js';
import { store, selectMachine, refreshMaintenance, refreshSlow } from '../state.js';
import { openInspector } from './inspector.js';
import { kpi, card, emptyBox, toast } from '../shared.js';

let root = null;
let fStatus = 'ALL';
let lastRef = null;

const STATUS_OPTIONS = ['ALL', 'RECOMMENDED', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

export function mount(container) {
  root = container;
  render();
  if (!store.maintenance) refreshMaintenance();
}

export function unmount() { /* stateless */ }

export function update(s) {
  if (!root) return;
  const items = (s.maintenance && s.maintenance.items) || [];
  const stats = s.maintenanceStats || {};
  const ref = items.length + '|' + items.map(o => o.id + ':' + o.status).join('|') + '|' + JSON.stringify([stats.recommended, stats.scheduled, stats.active, stats.completed]);
  if (ref === lastRef) return;
  lastRef = ref;
  render();
}

function canEdit() { return userCan(getRoles(), 'ENGINEER'); }

function render() {
  root.innerHTML = '';
  const items = (store.maintenance && store.maintenance.items) || [];
  const stats = store.maintenanceStats || {};
  const openCount = items.filter(o => !['COMPLETED', 'CANCELLED'].includes(o.status)).length;
  const activeCount = items.filter(o => o.status === 'ACTIVE').length;
  const recommended = items.filter(o => o.status === 'RECOMMENDED').length;
  const completing = items.filter(o => o.status === 'COMPLETED').length;

  root.appendChild(el('div', { class: 'page-title' }, 'Maintenance', el('span', { class: 'sub' }, 'work orders · recovery · downtime planning')));

  root.appendChild(el('div', { class: 'grid cols-4' },
    kpi('Recommended', stats.recommended != null ? int(stats.recommended) : recommended, 'awaiting scheduling', recommended ? 'warn' : 'good'),
    kpi('Scheduled', stats.scheduled != null ? int(stats.scheduled) : items.filter(o => o.status === 'SCHEDULED').length, 'planned windows', 'info'),
    kpi('Active', stats.active != null ? int(stats.active) : activeCount, 'maintenance in progress', 'critical'),
    kpi('Completed', stats.completed != null ? int(stats.completed) : completing, 'work orders closed', 'good')));

  root.appendChild(recoveryPanel(items));
  root.appendChild(renderToolbar());
  root.appendChild(el('div', { class: 'list', style: { marginTop: '8px', gap: '8px' } }, itemList(items)));
}

function recoveryPanel(items) {
  const inMaint = (store.machines || []).filter(m => m.maintenanceStatus === 'MAINTENANCE' || m.status === 'MAINTENANCE');
  const recovering = (store.machines || []).filter(m => m.status === 'RECOVERING');
  const body = el('div', {},
    el('div', { class: 'kv' }, el('b', {}, 'Machines in maintenance'), el('span', {}, inMaint.length ? inMaint.map(m => m.machineId).join(', ') : 'none')),
    el('div', { class: 'kv' }, el('b', {}, 'Recovering now'), el('span', {}, recovering.length ? recovering.map(m => m.machineId).join(', ') : 'none')),
    el('div', { class: 'kv' }, el('b', {}, 'Work orders open'), el('span', {}, items.filter(o => !['COMPLETED', 'CANCELLED'].includes(o.status)).length)),
    el('div', { class: 'muted small', style: { marginTop: '6px' } },
      'Lifecycle on the backend: RECOMMENDED → SCHEDULED → ACTIVE → COMPLETED | CANCELLED. Completing work moves the machine ' +
      'through MAINTENANCE → RECOVERING → NORMAL (state machine, updated live). Recovery is triggered by the backend when work completes; it is not button-driven.'));
  return card('Recovery overview', 'downtime management', body);
}

function renderToolbar() {
  const out = el('div', { class: 'toolbar' },
    el('select', { className: 'search', onchange: e => { fStatus = e.target.value; render(); } },
      STATUS_OPTIONS.map(s => el('option', { value: s }, s === 'ALL' ? 'All work orders' : s))));
  out.querySelector('select').value = fStatus;
  return out;
}

function itemList(items) {
  const filtered = items.filter(o => fStatus === 'ALL' || o.status === fStatus);
  if (!filtered.length) return emptyBox('No work orders match. Recommended orders appear here when the ML pipeline flags risk.');
  return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, filtered.map(orderCard));
}

function orderCard(o) {
  const roles = getRoles();
  const canEdit = userCan(roles, 'ENGINEER');
  const actions = el('div', { class: 'alert-actions' });
  const act = (label, fn, onlyWhen) => {
    const dis = !canEdit || (onlyWhen && !onlyWhen(o.status));
    return el('button', {
      class: 'btn btn-sm' + (dis ? '' : ' btn-primary'),
      disabled: dis ? 'disabled' : null,
      title: !canEdit ? 'Requires ENGINEER role' : '',
      onClick: async () => {
        try { await fn(); refreshMaintenance(); refreshSlow(); }
        catch (e) { toast((e && e.message) ? e.message : 'Action failed — check the backend connection.', 'err'); }
      },
    }, label);
  };
  if (o.status === 'RECOMMENDED') actions.appendChild(act('Schedule', () => schedulePrompt(o), s => s === 'RECOMMENDED'));
  if (['RECOMMENDED', 'SCHEDULED'].includes(o.status)) actions.appendChild(act('Start', () => post(`/api/v1/maintenance/${o.id}/start`), s => ['RECOMMENDED', 'SCHEDULED'].includes(s)));
  if (['ACTIVE', 'SCHEDULED'].includes(o.status)) {
    actions.appendChild(act('Complete', () => post(`/api/v1/maintenance/${o.id}/complete`, { notes: 'Completed from control room.' }), s => ['ACTIVE', 'SCHEDULED'].includes(s)));
  }
  if (!['COMPLETED', 'CANCELLED'].includes(o.status)) {
    actions.appendChild(act('Cancel', () => post(`/api/v1/maintenance/${o.id}/cancel`), s => !['COMPLETED', 'CANCELLED'].includes(s)));
  }
  const stTone = { RECOMMENDED: 'warn', SCHEDULED: 'info', ACTIVE: 'critical', COMPLETED: 'good', CANCELLED: 'down' }[o.status] || 'muted';
  return el('div', { class: 'list-item' },
    el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
      el('span', { class: 'pill-status st-' + stTone }, o.status || '—'),
      o.priority ? el('span', { class: 'badge2' }, 'P' + esc(o.priority)) : null,
      o.assignedRole ? el('span', { class: 'badge2' }, esc(o.assignedRole)) : null,
      o.riskAtCreation != null ? el('span', { class: 'muted small' }, 'risk at creation ' + pct(o.riskAtCreation)) : null,
      el('button', {
        class: 'rail-link',
        style: { marginLeft: 'auto', cursor: 'pointer' },
        onClick: () => { selectMachine(o.machineId); openInspector(o.machineId, 'maintenance'); },
      }, 'view ' + o.machineId + ' →')),
    el('div', { style: { fontWeight: '600', fontSize: 'var(--text-13)', margin: '6px 0 2px' } }, esc(o.title || 'Work order')),
    el('div', { class: 'alert-desc' }, esc(o.description || '')),
    o.recommendedAction ? el('div', { class: 'alert-meta', style: { marginTop: '4px' } }, el('span', { style: { color: 'var(--color-emerald)' } }, 'Recommended: ' + esc(o.recommendedAction))) : null,
    el('div', { class: 'alert-meta', style: { marginTop: '6px' } },
      (o.estimatedDurationMinutes ? '~' + int(o.estimatedDurationMinutes) + ' min · ' : ''),
      (o.scheduledAt ? 'scheduled ' + fmtDateTime(o.scheduledAt) + ' · ' : ''),
      (o.startedAt ? 'started ' + fmtDateTime(o.startedAt) + ' · ' : ''),
      (o.completedAt ? 'completed ' + fmtDateTime(o.completedAt) + ' · ' : ''),
      (o.resultSummary ? 'result: ' + esc(o.resultSummary) : ''),
      (o.createdAt ? 'created ' + timeAgo(o.createdAt) : '')),
    actions);
}

function schedulePrompt(o) {
  const val = new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 16);
  const input = el('input', { type: 'datetime-local', value: val });
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
        await post(`/api/v1/maintenance/${o.id}/schedule`, { scheduledAt: iso });
        refreshMaintenance();
      } catch (e) { toast((e && e.message) ? e.message : 'Schedule failed — check the backend connection.', 'err'); }
    },
  }, 'Schedule'));
  toast.appendChild(el('button', { class: 'btn btn-sm', onClick: () => toast.classList.add('hidden') }, 'Cancel'));
  window.setTimeout(() => toast.classList.add('hidden'), 25000);
}