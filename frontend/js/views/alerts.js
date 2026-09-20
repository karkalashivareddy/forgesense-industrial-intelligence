import { el, esc, pct, num, fmtDateTime, timeAgo, alertSeverityTag, statusInfo, userCan } from '../util.js';
import { api, post, getRoles } from '../api.js';
import { store, selectMachine, refreshCore } from '../state.js';
import { openInspector } from './inspector.js';
import { kpi, toast } from '../shared.js';

let root = null;
let fStatus = 'ALL';
let lastRef = null;

// Backend AlertStatus is authoritative: NEW -> ACKNOWLEDGED -> INVESTIGATING -> RESOLVED.
const STATUS_OPTIONS = ['ALL', 'NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED'];

export function mount(container) {
  root = container;
  render();
}

export function unmount() { /* stateless */ }

export function update(s) {
  if (!root) return;
  const items = ((s.alerts || {}).items) || [];
  const sig = items.map(a => a.id + ':' + a.status + ':' + a.severity).join('|');
  const ref = (s.alerts.total || 0) + '|' + sig + '|' + fStatus;
  if (ref === lastRef) return;
  lastRef = ref;
  render();
}

function render() {
  root.innerHTML = '';
  const items = (store.alerts && store.alerts.items) || [];
  const open = items.filter(a => ['NEW', 'ACKNOWLEDGED', 'INVESTIGATING'].includes(a.status));
  const crit = open.filter(a => String(a.severity).toUpperCase() === 'CRITICAL').length;
  const warn = open.filter(a => String(a.severity).toUpperCase() === 'WARNING').length;
  const inv = items.filter(a => a.status === 'INVESTIGATING').length;
  const ack = items.filter(a => a.status === 'ACKNOWLEDGED').length;

  root.appendChild(el('div', { class: 'page-title' }, 'Alerts',
    el('span', { class: 'sub' }, (store.alerts.total != null ? store.alerts.total + ' total · ' : '') + 'most recent ' + items.length)));
  root.appendChild(el('div', { class: 'grid cols-4' },
    kpi('Active alerts', open.length, crit + ' critical · ' + warn + ' warning', open.length ? 'warn' : 'good'),
    kpi('Critical', crit, 'needs immediate attention', 'critical'),
    kpi('Investigating', inv, 'assigned to engineers', 'info'),
    kpi('Acknowledged', ack, 'acknowledged, open', 'maint')));
  root.appendChild(renderToolbar());
  root.appendChild(el('div', { class: 'list', style: { marginTop: '8px', gap: '8px' } }, renderItems()));
}

function renderToolbar() {
  const out = el('div', { class: 'toolbar' },
    el('select', { className: 'search', onchange: e => { fStatus = e.target.value; renderBody(); } },
      STATUS_OPTIONS.map(s => el('option', { value: s }, s === 'ALL' ? 'All alert states' : s))),
    el('span', { class: 'muted small' }, 'Filters applied client-side against the live alert feed (limit 100).'));
  out.querySelector('select').value = fStatus;
  return out;
}

function renderBody() {
  if (!root) return;
  const host = root.querySelector('.list');
  if (host) {
    host.innerHTML = '';
    host.append(...renderItems().children);
  }
}

function renderItems() {
  const items = ((store.alerts && store.alerts.items) || [])
    .filter(a => fStatus === 'ALL' || a.status === fStatus)
    .slice()
    .sort((a, b) => {
      const ta = new Date(a.openedAt).getTime();
      const tb = new Date(b.openedAt).getTime();
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return (tb - ta) || String(b.id || '').localeCompare(String(a.id || ''));
    });
  if (!items.length) return el('div', { class: 'empty' }, 'No alerts match. When the simulator injects conditions, alerts appear here and the top-bar counter reacts.');
  return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
    items.map(a => alertCard(a)));
}

function alertCard(a) {
  const sev = alertSeverityTag(a.severity);
  const m = store.machineMap.get(a.machineId);
  const roles = getRoles();
  const st = a.status || 'NEW';

  const actions = el('div', { class: 'alert-actions' });
  const act = (label, fn, need, onlyWhen) => {
    const dis = !userCan(roles, need) || (onlyWhen && !onlyWhen(st));
    return el('button', {
      class: 'btn btn-sm' + (dis ? '' : ' btn-primary'),
      disabled: dis ? 'disabled' : null,
      title: !userCan(roles, need) ? 'Requires ' + need + ' role' : '',
      onClick: async () => {
        try { await fn(); refreshCore(); }
        catch (e) { toast((e && e.message) ? e.message : 'Action failed — check the backend connection.', 'err'); }
      },
    }, label);
  };
  const active = s => s === 'NEW';
  const notResolved = s => !['RESOLVED'].includes(s);

  if (active(st)) actions.appendChild(act('Acknowledge', () => post(`/api/v1/alerts/${a.id}/acknowledge`), 'OPERATOR', active));
  if (['NEW', 'ACKNOWLEDGED'].includes(st)) actions.appendChild(act('Investigate', () => post(`/api/v1/alerts/${a.id}/investigate`), 'ENGINEER', notResolved));
  if (['NEW', 'ACKNOWLEDGED', 'INVESTIGATING'].includes(st)) {
    actions.appendChild(act('Resolve', () => post(`/api/v1/alerts/${a.id}/resolve`, { notes: 'Resolved from control room UI.' }), 'ENGINEER', notResolved));
  }

  const stTone = { NEW: 'critical', ACKNOWLEDGED: 'warn', INVESTIGATING: 'info', RESOLVED: 'good' }[st] || 'muted';

  return el('div', { class: 'list-item', style: { padding: '0' } },
    el('div', { class: 'alert-row' },
      el('div', { class: 'alert-sev st-' + (sev.cls === 'critical' ? 'critical' : sev.cls === 'warning' ? 'warn' : 'info') },
        (sev.cls === 'critical' ? 'CRITICAL' : sev.cls === 'warning' ? 'WARNING' : 'INFO').padEnd(8)),
      el('div', { class: 'alert-main' },
        el('div', {
          class: 'alert-title',
          style: 'cursor:pointer',
          tabindex: '0',
          role: 'button',
          onClick: () => { selectMachine(a.machineId); openInspector(a.machineId); },
          onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMachine(a.machineId); openInspector(a.machineId); } },
        }, esc(a.headline || 'Alert ' + a.id)),
        el('div', { class: 'alert-meta' },
          el('span', { class: 'pill-status st-' + stTone }, st),
          el('span', {
            onClick: () => { selectMachine(a.machineId); openInspector(a.machineId); },
            tabindex: '0', role: 'button',
            style: { cursor: 'pointer' },
            onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMachine(a.machineId); openInspector(a.machineId); } },
          },
            m ? m.machineId + ' · ' + esc(m.name) : esc(a.machineId)),
          el('span', { class: 'badge2' }, esc(a.type || '')),
          a.riskAtCreation != null ? el('span', {}, 'risk ' + pct(a.riskAtCreation) + ' at creation') : null,
          el('span', {}, timeAgo(a.openedAt)),
          (a.acknowledgedAt ? el('span', {}, 'acked ' + fmtDateTime(a.acknowledgedAt)) : null),
          (a.resolvedAt ? el('span', {}, 'resolved ' + fmtDateTime(a.resolvedAt)) : null))),
      el('div', { class: 'alert-desc' }, esc(a.description || '')),
      a.factorsSummary ? el('div', { class: 'alert-meta' },
        String(a.factorsSummary).split(/\s+/).filter(Boolean).map(f => el('span', { class: 'badge2' }, esc(String(f || '')).slice(0, 24)))) : null,
      a.recommendedAction ? el('div', { class: 'alert-meta' },
        el('span', { style: { color: 'var(--color-emerald)' } }, 'Recommended: ' + esc(a.recommendedAction))) : null,
      actions));
}
