import { el, esc, pct, int, fmtDateTime, fmtTime, SCENARIO_LABELS, userCan } from '../util.js';
import { api, post, getRoles } from '../api.js';
import { store, selectMachine } from '../state.js';
import { openInspector } from './inspector.js';
import { kpi, card, emptyBox, toast } from '../shared.js';

let root = null;
let scens = [];
let ctrl = [];
let simCfg = null;
let lastTick = 0;

const RUN_TYPES = ['DEGRADATION', 'OVERHEATING', 'BEARING_FAILURE', 'VIBRATION_SPIKE', 'RPM_INSTABILITY', 'CURRENT_SPIKE', 'SENSOR_FAILURE', 'MACHINE_OFFLINE', 'LOAD_INCREASE'];

export function mount(container) {
  root = container;
  render();
}

export function unmount() { /* stateless */ }

export async function update(s) {
  if (!root) return;
  const now = Date.now();
  if (now - lastTick < 4000) return;
  lastTick = now;
  try {
    const [sc, cs, cfg] = await Promise.all([
      api('/api/v1/simulation/scenarios'),
      api('/api/v1/simulation/control'),
      api('/api/v1/simulator/config'),
    ]);
    scens = Array.isArray(sc) ? sc : [];
    ctrl = Array.isArray(cs) ? cs : [];
    simCfg = cfg || null;
    const ref = JSON.stringify([scens.map(x => x.id + x.status), ctrl.map(c => c.machineId + c.scenario + c.active + c.severity), (cfg || {}).paused]);
    const activeIds = ctrl.filter(c => c.active).map(c => c.machineId);
    window.dispatchEvent(new CustomEvent('forge:simoverlay', { detail: { active: activeIds.length > 0, ids: activeIds } }));
    if (ref !== root.dataset.ref) { root.dataset.ref = ref; render(); }
  } catch {
    window.dispatchEvent(new CustomEvent('forge:simoverlay', { detail: { active: false, ids: [] } }));
  }
}

function canEdit() { return userCan(getRoles(), 'ENGINEER'); }

function render() {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'sim-banner', style: { position: 'static', transform: 'none', width: 'fit-content', margin: '0 0 10px' } },
    'SIMULATION ONLY — applying a scenario changes the synthetic telemetry feed, not any real machine.'));
  root.appendChild(el('div', { class: 'page-title' }, 'Simulation', el('span', { class: 'sub' }, 'what-if scenarios against the digital twin')));

  const activeCount = ctrl.filter(c => c.active).length;
  root.appendChild(el('div', { class: 'grid cols-4' },
    kpi('Active scenario control', activeCount, activeCount ? 'injected into feed now' : 'feed running normal conditions', activeCount ? 'warn' : 'good'),
    kpi('Scenario runs', scens.length, 'recorded on the backend', 'info'),
    kpi('Feed paused', simCfg && simCfg.paused ? 'YES' : 'NO', 'global simulator pause', simCfg && simCfg.paused ? 'warn' : 'good'),
    kpi('Access', userCan(getRoles(), 'ENGINEER') ? 'ENGINEER' : 'OBSERVER', 'run/control need ENGINEER', 'maint')));

  root.appendChild(globalCard());
  root.appendChild(el('div', { class: 'grid cols-2', style: { marginTop: '12px' } },
    controlCard(),
    createCard()));

  root.appendChild(scenarioList());
}

function run(action) {
  return post(action).then(() => refresh()).catch(e => toast((e && e.message) ? e.message : 'Simulator command failed.', 'err'));
}

function globalCard() {
  const paused = !!(simCfg && simCfg.paused);
  const body = el('div', {});
  const btnRow = el('div', { class: 'btn-row' },
    el('button', { class: 'btn', disabled: paused || !canEdit() ? 'disabled' : null, title: userCan(getRoles(), 'ENGINEER') ? (paused ? 'Already paused' : '') : 'Requires ENGINEER', onClick: () => run('/api/v1/simulation/pause') }, 'Pause feed'),
    el('button', { class: 'btn', disabled: !paused || !canEdit() ? 'disabled' : null, title: userCan(getRoles(), 'ENGINEER') ? (!paused ? 'Feed is running' : '') : 'Requires ENGINEER', onClick: () => run('/api/v1/simulation/resume') }, 'Resume feed'),
    el('button', { class: 'btn btn-danger', disabled: !canEdit() ? 'disabled' : null, title: userCan(getRoles(), 'ENGINEER') ? '' : 'Requires ENGINEER', onClick: () => run('/api/v1/simulation/reset') }, 'Reset feed'),
    el('span', { class: 'muted small' }, paused ? 'feed is paused — telemetry is not flowing' : 'feed is running — conditions normal unless a scenario is active'));
  body.appendChild(btnRow);
  body.appendChild(el('div', { class: 'muted small', style: { marginTop: '8px' } }, 'Controls the simulator process that feeds the pipeline. All telemetry is synthetic.'));
  return card('Global simulator control', (simCfg && simCfg.paused ? 'feed paused' : 'feed running'), body);
}

function controlCard() {
  const body = el('div', {});
  if (!ctrl.length) body.appendChild(emptyBox('No active per-machine control states.'));
  else {
    const tbl = el('table', { class: 'tbl' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Machine'), el('th', {}, 'Scenario'), el('th', {}, 'Severity'), el('th', {}, 'Active'), el('th', {}, 'Started'))),
      el('tbody', {}, ctrl.map(c => {
        const m = store.machineMap.get(c.machineId);
        return el('tr', { tabindex: '0', role: 'button', onClick: () => { selectMachine(c.machineId); openInspector(c.machineId); }, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMachine(c.machineId); openInspector(c.machineId); } }, style: { cursor: 'pointer' } },
          el('td', {}, c.machineId, el('div', { class: 'muted small' }, m ? esc(m.name) : '')),
          el('td', {}, SCENARIO_LABELS[c.scenario] || esc(c.scenario || 'NONE')),
          el('td', {}, c.severity != null ? pct(c.severity, 0) : '—'),
          el('td', {}, el('span', { class: 'pill-status ' + (c.active ? 'st-warn' : 'st-good') }, c.active ? 'ACTIVE' : 'IDLE')),
          el('td', { class: 'muted small' }, c.startedAt ? fmtTime(c.startedAt) : '—'));
      })));
    body.appendChild(el('div', { style: { overflowX: 'auto' } }, tbl));
  }
  body.appendChild(el('div', { class: 'muted small', style: { marginTop: '8px' } }, 'Current control states from /api/v1/simulation/control.'));
  return card('Active control states', 'per-machine simulator overrides', body);
}

function createCard() {
  const machines = store.machines || [];
  const mSel = el('select', { className: 'search', style: { minWidth: '150px' } },
    machines.map(m => el('option', { value: m.machineId }, m.machineId + ' · ' + esc(m.name || ''))));
  const sc = el('select', { className: 'search', style: { minWidth: '150px' } },
    RUN_TYPES.map(t => el('option', { value: t }, SCENARIO_LABELS[t] || t)));
  const sev = el('input', { type: 'range', min: '0.2', max: '1', step: '0.1', value: '0.6' });
  const sevLabel = el('span', { class: 'muted small' }, '60%');
  sev.addEventListener('input', () => { sevLabel.textContent = Math.round(+sev.value * 100) + '%'; });
  const horizon = el('input', { type: 'number', min: '15', max: '1440', step: '15', value: '120', style: { width: '80px' } });
  const name = el('input', { type: 'text', placeholder: 'optional name', className: 'search', style: { minWidth: '160px' } });
  const msg = el('div', { class: 'muted small' });

  const form = el('div', { class: 'field-list' },
    field('Machine', mSel),
    field('Scenario', sc),
    fieldRow('Severity', sev, sevLabel),
    fieldRow('Failure horizon (min)', horizon, null),
    field('Name (optional)', name),
    el('div', { class: 'btn-row', style: { marginTop: '8px' } },
      el('button', {
        class: 'btn btn-primary',
        disabled: !canEdit() ? 'disabled' : null,
        title: userCan(getRoles(), 'ENGINEER') ? '' : 'Requires ENGINEER role',
        onClick: async () => {
          const body = {
            machineId: mSel.value,
            scenarioType: sc.value,
            severity: +sev.value,
            failureHorizonMinutes: +horizon.value,
          };
          if (name.value.trim()) body.name = name.value.trim();
          msg.textContent = 'Running scenario…';
          try {
            const r = await post('/api/v1/simulation/run', body);
            msg.innerHTML = 'Scenario queued: ' + esc((r && r.name) || r && r.id || '') + ' (status ' + esc((r && r.status) || '') + ')';
            refresh();
          } catch (e) {
            msg.textContent = 'Failed: ' + String(e);
          }
        },
      }, 'Run scenario'),
      msg),
    el('div', { class: 'hint', style: { marginTop: '6px' } }, 'Running a scenario records an impact run and (optionally) maps to simulator control. Scenarios are simulated inputs only.'));

  return card('Scenario run / what-if', 'what would break if…', form);

  function field(label, node) {
    return el('div', { class: 'field', style: { marginBottom: '8px' } }, el('label', {}, label), node);
  }
  function fieldRow(label, node, extra) {
    return el('div', { class: 'field', style: { marginBottom: '8px' } }, el('label', {}, label), el('div', { class: 'btn-row' }, node, extra));
  }
}

function scenarioList() {
  const body = el('div', {});
  if (!scens.length) {
    body.appendChild(emptyBox('No scenario runs recorded yet. Run one above, or apply per-machine control and observe the fleet change here.'));
  } else {
    const tbl = el('table', { class: 'tbl' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Run'), el('th', {}, 'Machine'), el('th', {}, 'Scenario'), el('th', {}, 'Sev'), el('th', {}, 'Affected'), el('th', {}, 'Expected downtime'), el('th', {}, 'Production loss'), el('th', {}, 'Status'), el('th', {}, 'Created'))),
      el('tbody', {}, scens.slice().reverse().map(s => {
        const m = store.machineMap.get(s.machineId);
        return el('tr', { tabindex: '0', role: 'button', onClick: () => { selectMachine(s.machineId); openInspector(s.machineId); }, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMachine(s.machineId); openInspector(s.machineId); } }, style: { cursor: 'pointer' } },
          el('td', { class: 'mono muted small' }, esc(String(s.id || '').slice(-8))),
          el('td', {}, s.machineId, el('div', { class: 'muted small' }, m ? esc(m.name) : esc(s.machineName || ''))),
          el('td', {}, SCENARIO_LABELS[s.scenarioType] || esc(s.scenarioType || '')),
          el('td', {}, s.severity != null ? pct(s.severity, 0) : '—'),
          el('td', { class: 'num' }, s.affectedMachineCount != null ? int(s.affectedMachineCount) : '—'),
          el('td', { class: 'num' }, s.expectedDowntimeMinutes != null ? int(s.expectedDowntimeMinutes) + 'm' : '—'),
          el('td', { class: 'num' }, s.productionLossUnits != null ? int(s.productionLossUnits) : '—'),
          el('td', {}, el('span', { class: 'pill-status ' + (s.status === 'COMPLETED' ? 'st-good' : 'st-warn') }, esc(s.status || '—'))),
          el('td', { class: 'muted small' }, s.createdAt ? fmtDateTime(s.createdAt) : '—'));
      })));
    body.appendChild(el('div', { style: { overflowX: 'auto' } }, tbl));
  }
  return card('Scenario history', 'recorded runs from /api/v1/simulation/scenarios', body);
}

function refresh() {
  lastTick = 0;
  update(store);
}