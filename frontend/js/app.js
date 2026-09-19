import { API_BASE, getRoles, getToken, login } from './api.js';
import { store, subscribe, selectMachine, startPolling, refreshMaintenance, refreshCore, applyRealtimeEvent, set, setLiveTransport } from './state.js';
import { el, esc, int, timeAgo, fleetSummary } from './util.js';
import { register, boot as bootRouter, go, onRoute } from './router.js';
import { initTwin, updateMachines, resetCamera, focusOnMachine, focusOnZone, setSimMode, setRiskMode, focusTop, isTwin } from './twin3d.js';
import * as commandView from './views/command.js';
import * as factoryView from './views/factoryView.js';
import * as fleetView from './views/fleet.js';
import * as alertsView from './views/alerts.js';
import * as predictionsView from './views/predictions.js';
import * as simulationView from './views/simulation.js';
import * as maintenanceView from './views/maintenance.js';
import * as analyticsView from './views/analytics.js';
import * as systemView from './views/system.js';
import * as telemetryView from './views/telemetry.js';
import * as anomaliesView from './views/anomalies.js';
import * as eventsView from './views/events.js';
import { openInspector, closeInspector, toggleInspector, subscribeInspector } from './views/inspector.js';
import { initPalette, togglePalette, closePalette, openPalette, isOpen as paletteOpen } from './command.js';
import { getRealtimeClient } from './realtime.js';

let lastSel = null;
const seenAlerts = new Map();
let tick = 0;
let health = null;

const SHORTCUTS = [
  ['1-9', 'Switch control-room section'],
  ['Ctrl+K', 'Open command palette'],
  ['F', 'Focus the selected machine in the 3D twin'],
  ['R', 'Reset the twin camera'],
  ['Esc', 'Close palette / dismiss toast / clear selection'],
];

function $id(s) { return document.getElementById(s); }

/* ---------- login ---------- */
async function bootLogin() {
  if (getToken()) return;
  await new Promise(resolve => showLogin(resolve));
}

function showLogin(done) {
  const input = el('input', { type: 'password', placeholder: 'configured operator password',
    onkeydown: async e => {
      if (e.key === 'Enter') {
        const u = document.getElementById('loginUser').value;
        try {
          await login(u, input.value);
          set({ user: u, roles: getRoles() });
          overlay.remove();
          done?.();
        } catch { input.style.borderColor = '#f25c4c'; }
      }
    } });
  const userSel = el('select', { id: 'loginUser' },
    ['operator', 'engineer', 'admin'].map(u => el('option', { value: u }, u)));
  const overlay = el('div', { style: { position: 'fixed', inset: 0, zIndex: 99, background: 'rgba(6,9,13,.92)', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
    el('div', { class: 'card', style: { width: 'min(360px, 90vw)' } },
      el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, 'ForgeSense sign-in')),
      userSel, ' ',
      input,
      el('button', { class: 'btn btn-primary', style: { marginTop: '10px', width: '100%' }, onClick: async () => {
        try { await login(userSel.value, input.value); set({ user: userSel.value, roles: getRoles() }); overlay.remove(); done?.(); }
        catch { input.style.borderColor = '#f25c4c'; }
      } }, 'Connect'),
      el('div', { class: 'muted small', style: { marginTop: '8px' } }, 'Demo users: operator · engineer · admin. Passwords come from FORGESENSE_DEV_PASSWORD.')));
  document.body.appendChild(overlay);
  input.focus();
}

/* ---------- 3D twin lifecycle ---------- */
function ensureTwin() {
  const container = $id('sceneContainer');
  if (!container) return false;
  if (isTwin()) return true;
  initTwin(container, {
    onSelect: (machineId) => { selectMachine(machineId); openInspector(machineId); },
  });
  updateMachines(store.machines || []);
  return true;
}

/* ---------- top bar ---------- */
function topbar(s) {
  const f = s.freshness || { ok: false, failures: 0, lastOk: null };
  const age = f.lastOk ? Math.max(0, Math.floor((Date.now() - f.lastOk) / 1000)) : null;
  const sys = $id('sysStatus');
  const icon = $id('sysIcon');
  const txt = $id('sysStatusText');
  const live = s.liveTransport || {};
  const liveOpen = live.state === 'open';
  if (liveOpen) {
    txt.textContent = 'LIVE · STOMP' + (s.liveEventCount ? ` · ${int(s.liveEventCount)} events` : '');
    sys.classList.remove('stale');
    if (icon) icon.className = 'ph ph-broadcast';
  } else if (!f.ok) {
    txt.textContent = 'DEGRADED · REST retry ' + f.failures;
    sys.classList.add('stale');
    if (icon) icon.className = 'ph ph-warning';
  } else if (age == null) {
    txt.textContent = 'SYNCING · REST snapshot';
    sys.classList.remove('stale');
    if (icon) icon.className = 'ph ph-arrows-clockwise';
  } else {
    txt.textContent = 'REST FALLBACK · age ' + age + 's';
    sys.classList.toggle('stale', age >= 12);
    if (icon) icon.className = 'ph ph-arrows-clockwise';
  }
  const tel = s.telemetryStatus || {};
  const thr = $id('thrRate');
  const thrPill = $id('thrPill');
  const v = tel.telemetryPerMinute;
  if (thr) thr.textContent = v != null ? int(v) : '—';
  if (thrPill) thrPill.classList.toggle('stale', !f.ok);

  const ml = s.status || {};
  const mlIcon = $id('mlIcon');
  const mlModel = $id('mlModel');
  if (mlModel) mlModel.textContent = ml.mlServiceAvailable ? '· v' + (ml.mlModelVersion || '?') : 'DOWN';
  if (mlIcon) mlIcon.className = 'ph ' + (ml.mlServiceAvailable ? 'ph-brain' : 'ph-warning');
  const mlPill = mlIcon?.closest('.pill');
  if (mlPill) mlPill.classList.toggle('stale', !ml.mlServiceAvailable);

  const fs = fleetSummary(s.machines);
  const os = osLabel(fs);
  const fc = $id('factoryState');
  if (fc) { fc.textContent = os.label; fc.className = 'fc-state st-' + os.tone; }

  const uc = $id('userChip');
  if (uc) {
    uc.innerHTML = '';
    uc.appendChild(el('span', {}, '◉ '));
    uc.appendChild(el('b', {}, esc(s.user || '—')));
    uc.appendChild(el('span', {}, ' · ' + (s.roles || []).map(r => r.replace('ROLE_', '')).join('/')));
    uc.title = 'Signed in · roles control which actions are enabled';
  }
}

function osLabel(fs) {
  if (fs.offline || fs.critical) return { label: 'OUTAGE', tone: 'critical' };
  if (fs.attn) return { label: 'ATTENTION', tone: 'warn' };
  return { label: 'OPERATIONAL', tone: 'good' };
}

/* ---------- status bar ---------- */
function statusbar(s) {
  const f = s.freshness || { ok: false, failures: 0 };
  $id('svcBackend').textContent = f.ok ? 'OK' : 'DOWN ×' + f.failures;
  const ml = s.status || {};
  $id('svcMl').textContent = ml.mlServiceAvailable ? 'v' + (ml.mlModelVersion || '?') + ' up' : 'down';
  $id('svcKafka').textContent = s.liveTransport?.state === 'open'
    ? 'STOMP live' : (s.telemetryStatus && s.telemetryStatus.transport ? s.telemetryStatus.transport : 'REST fallback');
  const st = s.status || {};
  $id('svcPg').textContent = st.database == null ? '—' : (typeof st.database === 'string' ? esc(st.database) : 'connected');
  $id('svcRedis').textContent = health && health.status === 'UP' && health.components && health.components.redis ? (health.components.redis.status === 'UP' ? 'up' : 'down') : '—';
  const ev = s.events || {};
  $id('svcEvents').textContent = ev.count != null ? int(ev.count) : (ev.items || []).length;
  let newest = null;
  for (const m of s.machines || []) {
    if (m.lastTelemetryAt && (!newest || m.lastTelemetryAt > newest)) newest = m.lastTelemetryAt;
  }
  $id('svcLastTel').textContent = newest ? timeAgo(newest) : '—';
  const basis = st.demoMode ? 'SIMULATED' : '';
  $id('svcBasis').textContent = (st.dataBasis || [basis || 'SIMULATED']).join('/') + (s.liveTransport?.state === 'open' ? ' · STOMP live' : ' · REST fallback 3s');
}

function connectLive() {
  const wsBase = API_BASE.replace(/^http/, 'ws');
  const client = getRealtimeClient({
    url: wsBase + '/ws',
    tokenProvider: getToken,
    onEvent: (topic, event) => {
      applyRealtimeEvent(topic, event);
      if (topic.startsWith('maintenance.') || topic.startsWith('simulation.')) refreshMaintenance();
    },
    onState: (state, detail) => {
      setLiveTransport(state, detail);
      if (state === 'open') refreshCore();
    },
    onDiagnostic: detail => setLiveTransport('degraded', detail),
  });
  client.connect().catch(() => setLiveTransport('closed', 'REST snapshot fallback active'));
}

/* ---------- notifications ---------- */
let toastTimer = null;
function toast(msg, kind, stickySecs = 6) {
  const box = $id('toast');
  box.innerHTML = '';
  box.classList.remove('hidden');
  box.classList.toggle('err', kind === 'err');
  box.classList.toggle('ok', kind === 'ok');
  box.appendChild(el('span', {}, msg));
  const close = el('button', { class: 'btn btn-sm', onClick: () => box.classList.add('hidden') }, 'OK');
  box.appendChild(close);
  clearTimeout(toastTimer);
  if (stickySecs == null) return;
  toastTimer = setTimeout(() => box.classList.add('hidden'), stickySecs * 1000);
}

function alertWatcher(s) {
  const items = (s.alerts && s.alerts.items) || [];
  const now = Date.now();
  const present = new Set();
  for (const a of items) {
    if (a.status !== 'NEW') continue;
    present.add(a.id);
    if (!seenAlerts.has(a.id)) {
      seenAlerts.set(a.id, { at: now, sev: String(a.severity || '').toUpperCase() });
      if (['CRITICAL', 'WARNING'].includes(seenAlerts.get(a.id).sev)) {
        toast(`New ${seenAlerts.get(a.id).sev} alert · ${esc(a.machineId || '')} — ${esc(a.headline || a.type || '')}`, 'err', 8);
      }
    }
  }
  for (const [id, v] of seenAlerts) {
    if (!present.has(id) && (now - v.at) > 15000) seenAlerts.delete(id);
  }
}

/* ---------- selection → twin ---------- */
function selectionFocus(s) {
  if (s.selectedMachineId && s.selectedMachineId !== lastSel) {
    lastSel = s.selectedMachineId;
    if (isTwin()) focusOnMachine(s.selectedMachineId);
  }
  if (!s.selectedMachineId) lastSel = null;
}

/* ---------- shortcuts ---------- */
const ROUTE_KEYS = { '1': 'command', '2': 'factory', '3': 'fleet', '4': 'telemetry', '5': 'alerts', '6': 'predictions', '7': 'maintenance', '8': 'analytics', '9': 'system' };

function onKey(e) {
  if (e.ctrlKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); togglePalette(); return; }
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if (typing) return;
  if (ROUTE_KEYS[e.key]) {
    e.preventDefault();
    go(ROUTE_KEYS[e.key]);
  } else if (e.key === 'f' || e.key === 'F') {
    if (store.selectedMachineId) { ensureTwin(); focusOnMachine(store.selectedMachineId); }
  } else if (e.key === 'r' || e.key === 'R') {
    if (ensureTwin()) resetCamera();
  } else if (e.key === 'Escape') {
    if (paletteOpen()) { closePalette(); return; }
    const box = $id('toast');
    if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
    if (store.selectedMachineId) { selectMachine(null); closeInspector(); }
  } else if (e.key === '?') {
    e.preventDefault();
    showShortcuts();
  }
}

function showShortcuts() {
  const box = $id('toast');
  box.innerHTML = '';
  box.classList.remove('hidden');
  const dlEl = el('div', { class: 'dl' });
  for (const [k, v] of SHORTCUTS) {
    dlEl.appendChild(el('dt', { class: 'mono' }, k));
    dlEl.appendChild(el('dd', {}, v));
  }
  box.appendChild(dlEl);
  box.appendChild(el('button', { class: 'btn btn-sm', style: { marginLeft: 'auto' }, onClick: () => box.classList.add('hidden') }, 'Close'));
}

/* ---------- init ---------- */
function registerViews() {
  register('command', commandView);
  register('factory', factoryView);
  register('fleet', fleetView);
  register('alerts', alertsView);
  register('predictions', predictionsView);
  register('simulation', simulationView);
  register('maintenance', maintenanceView);
  register('analytics', analyticsView);
  register('system', systemView);
  register('telemetry', telemetryView);
  register('anomalies', anomaliesView);
  register('events', eventsView);
}

function globalEvents() {
  window.addEventListener('forge:zone', (e) => {
    const { code, toggle } = e.detail || {};
    if (!code) return;
    if (!ensureTwin()) return;
    focusOnZone(code);
    factoryView.setActiveZone(code);
    if (toggle) {
      const btn = document.querySelector('.chip[data-zone="' + code + '"]');
      if (btn && btn.classList.contains('active')) { resetCamera(); factoryView.setActiveZone(null); }
    }
  });
  window.addEventListener('forge:focus3d', (e) => {
    if (!ensureTwin()) return;
    focusOnMachine(e.detail && e.detail.machineId);
  });
  window.addEventListener('forge:simoverlay', (e) => {
    const { active, ids } = e.detail || {};
    const banner = $id('simBanner');
    if (active) {
      banner.classList.remove('hidden');
      banner.textContent = 'SIMULATION MODE — scenario ' + (ids || []).join(', ') + ' affected · visualization only, no physical control';
    } else {
      banner.classList.add('hidden');
    }
    if (isTwin()) setSimMode(!!active, ids || []);
  });
  window.addEventListener('forge:ensure3d', () => { ensureTwin(); });
  window.addEventListener('forge:shortcuts', () => showShortcuts());
}

function clock() {
  const c = $id('clock');
  const tick2 = () => { c.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  tick2();
  setInterval(tick2, 1000);
}

function main() {
  bootLogin().then(() => {
    registerViews();
    initPalette();
    subscribeInspector();
    subscribe(s => {
      topbar(s);
      statusbar(s);
      alertWatcher(s);
      selectionFocus(s);
      const v = currentView();
      if (v && v.update) v.update(s);
      if (isTwin() && s.machines) updateMachines(s.machines);
      if (++tick % 5 === 0) refreshMaintenance();
    });
    onRoute(({ type, payload }) => {
      if (type === 'palette') togglePalette();
      else if (type === 'inspector-toggle') toggleInspector();
      else if (type === 'inspector-close') closeInspector();
      else if (type === 'camera-reset') { if (ensureTwin()) resetCamera(); }
      else if (type === 'camera-top') { if (ensureTwin()) focusTop(); }
      else if (type === 'risk-mode-toggle') {
        if (ensureTwin()) {
          const button = $id('riskBtn');
          const active = button?.getAttribute('aria-pressed') !== 'true';
          setRiskMode(active);
          if (button) { button.setAttribute('aria-pressed', String(active)); button.classList.toggle('active', active); }
        }
      }
      else if (type === 'zone-filter') { if (ensureTwin()) { focusOnZone(payload); factoryView.setActiveZone(payload); } }
      else if (type === 'shortcuts') showShortcuts();
    });
    const routeViews = { command: commandView, factory: factoryView, fleet: fleetView, telemetry: telemetryView, anomalies: anomaliesView, alerts: alertsView, events: eventsView, predictions: predictionsView, simulation: simulationView, maintenance: maintenanceView, analytics: analyticsView, system: systemView };
    globalEvents();
    document.addEventListener('keydown', onKey, true);
    clock();
    bootRouter('command', Object.keys(routeViews));
    startPolling();
    connectLive();
    setInterval(() => { topbar(store); statusbar(store); }, 1000);
    apiHealth();
  });
}

function apiHealth() {
  fetch(API_BASE + '/actuator/health')
    .then(r => r.json().catch(() => null))
    .then(v => { health = v && v.status ? v : { __err: true }; })
    .catch(() => { health = { __err: true }; });
}

function currentView() {
  const byId = {
    'view-command': commandView, 'view-factory': factoryView, 'view-fleet': fleetView,
    'view-telemetry': telemetryView, 'view-anomalies': anomaliesView, 'view-alerts': alertsView, 'view-events': eventsView, 'view-predictions': predictionsView, 'view-simulation': simulationView,
    'view-maintenance': maintenanceView, 'view-analytics': analyticsView, 'view-system': systemView,
  };
  const active = document.querySelector('.view.active');
  return active ? byId[active.id] : null;
}

main();
