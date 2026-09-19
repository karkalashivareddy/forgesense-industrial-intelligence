export function clamp(v, lo, hi) {
  if (v == null || Number.isNaN(+v)) return lo;
  return Math.min(hi, Math.max(lo, +v));
}

export function pct(v, digits = 1) {
  if (v == null || Number.isNaN(+v)) return '—';
  return (v * 100).toFixed(digits) + '%';
}

export function num(v, digits = 1) {
  if (v == null || Number.isNaN(+v)) return '—';
  return Number(v).toFixed(digits);
}

export function int(v) {
  if (v == null || Number.isNaN(+v)) return '—';
  return Math.round(v).toLocaleString('en-US');
}

export function fmtTime(iso, now = Date.now()) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function ageSec(iso, now = Date.now()) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, (now - t) / 1000);
}

export function timeAgo(iso, now = Date.now()) {
  const s = ageSec(iso, now);
  if (s == null) return '—';
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function ageBand(ageSec) {
  if (ageSec == null) return { label: 'UNKNOWN', tone: 'down' };
  if (ageSec < 15) return { label: 'LIVE', tone: 'good' };
  if (ageSec < 60) return { label: 'DELAYED', tone: 'warn' };
  return { label: 'STALE', tone: 'down' };
}

/* ---------- Unified machine state machine ----------
 * One derivation path for every view (fleet card, 3D halo, inspector,
 * command center). States: NORMAL → ESCALATED → CRITICAL → RECOVERING → back
 * to NORMAL, plus OFFLINE (explicit disconnect) / STALE (silent, feed up but
 * quiet) / MAINTENANCE which override the health-derived ladder.
 */
export const STALE_AFTER_S = 60;
export const RECOVERY_CONFIRM = 3;

export const MACHINE_STATE = {
  NORMAL: {
    state: 'NORMAL', tone: 'good', label: 'Normal', hint: 'Operating within normal bounds',
    guidance: 'No action needed — values inside modeled limits.',
  },
  ESCALATED: {
    state: 'ESCALATED', tone: 'warn', label: 'Escalated', hint: 'Anomaly or risk elevated — monitor',
    guidance: 'Advisory: risk or anomaly is above its operating baseline. Watch the trend and plan an inspection window if it persists.',
  },
  CRITICAL: {
    state: 'CRITICAL', tone: 'critical', label: 'Critical', hint: 'Critical condition — act now',
    guidance: 'Maintenance guidance: treat as urgent. Open machine detail for attribution, estimated RUL and production impact; schedule or advance a work order.',
  },
  RECOVERING: {
    state: 'RECOVERING', tone: 'info', label: 'Recovering', hint: 'Stabilizing — needs consecutive healthy readings to clear',
    guidance: 'Stabilizing after an incident. Clears automatically once consecutive healthy readings are confirmed.',
  },
  MAINTENANCE: {
    state: 'MAINTENANCE', tone: 'maint', label: 'Maintenance', hint: 'Maintenance in progress',
    guidance: 'In maintenance — excluded from health scoring until it returns to service.',
  },
  OFFLINE: {
    state: 'OFFLINE', tone: 'down', label: 'Offline', hint: 'Connection dropped — not reporting',
    guidance: 'Explicit disconnect. Check power/network; last-known values are unconfirmed.',
  },
  STALE: {
    state: 'STALE', tone: 'down', label: 'Stale', hint: 'No new telemetry for longer than expected',
    guidance: 'No new telemetry received — showing last known values with an age marker.',
  },
  UNKNOWN: {
    state: 'UNKNOWN', tone: 'muted', label: 'Unknown', hint: 'No telemetry on record',
    guidance: 'No data on record for this machine yet.',
  },
};

export function deriveMachineState(m, ctx = {}) {
  const base = { ...MACHINE_STATE.UNKNOWN, ageSec: null, recoveryConsecutive: 0, remaining: 0 };
  if (!m) return base;
  if (m.status == null && m.healthScore == null && !m.lastTelemetryAt) return base;
  const now = ctx.now || Date.now();
  const age = ageSec(m.lastTelemetryAt, now);
  const consecutive = Number(ctx.consecutive) || 0;
  const recovering = ctx.recovering === true || m.status === 'RECOVERING';
  const wrap = st => ({ ...st, ageSec: age, recoveryConsecutive: consecutive, remaining: 0 });

  if (m.status === 'MAINTENANCE') return wrap(MACHINE_STATE.MAINTENANCE);
  if (m.connectivity === 'OFFLINE' || m.status === 'OFFLINE' || ctx.disconnected === true) return wrap(MACHINE_STATE.OFFLINE);
  if (age != null && age > (ctx.staleAfterS ?? STALE_AFTER_S)) return wrap(MACHINE_STATE.STALE);

  if (recovering) {
    const need = Number(ctx.confirmReadings) || RECOVERY_CONFIRM;
    const confirmed = consecutive >= need && m.status !== 'RECOVERING';
    if (!confirmed) return { ...MACHINE_STATE.RECOVERING, ageSec: age, recoveryConsecutive: consecutive, remaining: Math.max(0, need - consecutive) };
  }

  if (m.status === 'CRITICAL' || (Number(m.failureRisk) || 0) >= 0.8) return wrap(MACHINE_STATE.CRITICAL);
  if (m.status === 'WARNING' || m.status === 'DEGRADED' || (Number(m.failureRisk) || 0) >= 0.5 || (Number(m.anomalyScore) || 0) >= 0.6) return wrap(MACHINE_STATE.ESCALATED);
  return wrap(MACHINE_STATE.NORMAL);
}

export function machineState(m, now) {
  const ui = m && m.uiState;
  return ui || deriveMachineState(m, { now });
}

export function modelGrade(mode) {
  const key = String(mode || '').toUpperCase();
  if (key === 'MODEL') return { label: 'High', tone: 'good', scale: 'HIGH' };
  if (key === 'HYBRID') return { label: 'Moderate', tone: 'warn', scale: 'MID' };
  return { label: 'Low', tone: 'warn', scale: 'LOW' };
}

const ST = {
  NORMAL:      { label: 'NORMAL',      tone: 'good',     hint: 'Operating within normal bounds' },
  DEGRADED:    { label: 'DEGRADED',    tone: 'warn',     hint: 'Performance degraded — monitor' },
  WARNING:     { label: 'WARNING',     tone: 'warn',     hint: 'Anomaly flagged — inspect' },
  CRITICAL:    { label: 'CRITICAL',    tone: 'critical', hint: 'Critical condition — act now' },
  MAINTENANCE: { label: 'MAINTENANCE', tone: 'maint',    hint: 'Maintenance in progress' },
  OFFLINE:     { label: 'OFFLINE',     tone: 'down',     hint: 'Not reporting telemetry' },
  RECOVERING:  { label: 'RECOVERING',  tone: 'info',     hint: 'Recovering after maintenance or outage' },
  ONLINE:      { label: 'ONLINE',      tone: 'good',     hint: 'Connected and reporting' },
};

export function statusInfo(m) {
  if (!m) return { label: '—', tone: 'muted', hint: '' };
  if (m.connectivity === 'OFFLINE' || m.status === 'OFFLINE') return ST.OFFLINE;
  return ST[m.status] || { label: m.status || '—', tone: 'muted', hint: '' };
}

const STATE_KEY = {
  NORMAL: 'normal', DEGRADED: 'degraded', WARNING: 'warning', CRITICAL: 'critical',
  MAINTENANCE: 'maintenance', OFFLINE: 'offline', RECOVERING: 'recovering', ONLINE: 'normal',
};

export function fleetSummary(machines) {
  const s = { total: 0, normal: 0, degraded: 0, warning: 0, critical: 0, maintenance: 0, offline: 0, recovering: 0 };
  for (const m of machines || []) {
    s.total += 1;
    if (m.connectivity === 'OFFLINE' || m.status === 'OFFLINE') s.offline += 1;
    else s[STATE_KEY[m.status] || 'normal'] += 1;
  }
  s.attn = s.critical + s.warning + s.degraded;
  s.atRisk = (machines || []).filter(m => (m.failureRisk ?? 0) >= 0.5).length;
  return s;
}

export function avgHealth(machines) {
  const vals = (machines || []).map(m => m.healthScore).filter(v => v != null && !Number.isNaN(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function riskInfo(risk) {
  const r = risk == null ? 0 : +risk;
  if (r >= 0.8) return { tone: 'critical', band: 'HIGH' };
  if (r >= 0.5) return { tone: 'warn', band: 'MODERATE' };
  if (r >= 0.3) return { tone: 'warn', band: 'ELEVATED' };
  return { tone: 'good', band: 'LOW' };
}

export function healthInfo(h) {
  const x = h == null ? 100 : +h;
  if (x < 60) return 'critical';
  if (x < 80) return 'warn';
  return 'good';
}

export function anomalyInfo(a) {
  const x = a == null ? 0 : +a;
  if (x >= 0.85) return { tone: 'critical', band: 'CRITICAL' };
  if (x >= 0.6) return { tone: 'warn', band: 'ELEVATED' };
  return { tone: 'good', band: 'LOW' };
}

export const SENSOR_META = {
  TEMPERATURE: { key: 'temperature', label: 'Temperature', unit: '°C' },
  VIBRATION:   { key: 'vibration',   label: 'Vibration', unit: 'mm/s' },
  PRESSURE:    { key: 'pressure',    label: 'Pressure', unit: 'bar' },
  RPM:         { key: 'rpm',         label: 'Rotational speed', unit: 'rpm' },
  TORQUE:      { key: 'torque',      label: 'Torque', unit: 'Nm' },
  CURRENT:     { key: 'current',     label: 'Current', unit: 'A' },
  VOLTAGE:     { key: 'voltage',     label: 'Voltage', unit: 'V' },
  POWER:       { key: 'power',       label: 'Power', unit: 'kW' },
  FLOW:        { key: 'flow',        label: 'Flow', unit: 'L/min' },
  FREQUENCY:   { key: 'frequency',   label: 'Frequency', unit: 'Hz' },
};

const KEY_META = Object.fromEntries(
  Object.entries(SENSOR_META).map(([name, meta]) => [meta.key, { name, label: meta.label, unit: meta.unit }])
);

export function sensorLabel(key) {
  const m = KEY_META[key];
  return m ? { label: m.label, unit: m.unit, sensor: m.name } : { label: key || '—', unit: '', sensor: null };
}

export const SCENARIO_LABELS = {
  NONE: 'None',
  DEGRADATION: 'Gradual degradation',
  OVERHEATING: 'Overheating',
  BEARING_FAILURE: 'Bearing failure',
  VIBRATION_SPIKE: 'Vibration spike',
  RPM_INSTABILITY: 'RPM instability',
  CURRENT_SPIKE: 'Current spike',
  SENSOR_FAILURE: 'Sensor failure',
  MACHINE_OFFLINE: 'Machine offline',
  LOAD_INCREASE: 'Load increase',
  MAINTENANCE: 'Maintenance',
  RECOVERY: 'Recovery',
};

export const RELATION_LABELS = {
  MATERIAL: { label: 'Material', tone: 'material' },
  POWER:    { label: 'Power',    tone: 'power' },
  COOLING:  { label: 'Cooling',  tone: 'cooling' },
  SERVICE:  { label: 'Service',  tone: 'service' },
};

export function alertSeverityTag(sev) {
  const s = String(sev || '').toUpperCase();
  return { cls: s === 'CRITICAL' ? 'critical' : s === 'WARNING' ? 'warning' : 'info', label: s || 'INFO' };
}

export function userCan(roles, need) {
  return Array.isArray(roles) && roles.includes('ROLE_' + need);
}

export function safeJson(str) {
  if (!str) return {};
  try { return JSON.parse(str); } catch { return {}; }
}

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') node.value = v;
    else if (k === 'html') node.innerHTML = v;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function iconFor(type) {
  const map = {
    CNC_MILL: '∟', INDUSTRIAL_MOTOR: '◯', HYDRAULIC_PUMP: '⏣',
    CONVEYOR_DRIVE_MOTOR: '➤', COMPRESSOR: '⛽', ROBOTIC_ARM: '⌁',
    COOLING_UNIT: '❄', GENERATOR: '⚡',
  };
  return map[type] || '◇';
}