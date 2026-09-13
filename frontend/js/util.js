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
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
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