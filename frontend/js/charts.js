function dpr() {
  return Math.min(window.devicePixelRatio || 1, 2);
}

function token(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}
const TOKEN_MONO = () => token('--font-mono', 'monospace');
const TOKEN_MUTED = () => token('--color-text-muted', '#7b93ab');
const TOKEN_CRIMSON = () => token('--color-crimson', '#f25c4c');

function hexA(hex, alpha) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return 'rgba(123,147,171,.14)';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
const TOKEN_GRID = () => {
  const m = TOKEN_MUTED();
  return /^#[0-9a-f]{6}$/i.test(m) ? hexA(m, 0.14) : 'rgba(123,147,171,.14)';
};
const TOKEN_THRESHOLD = () => hexA(TOKEN_CRIMSON(), 0.75);

function resizeCanvas(canvas) {
  const w = Math.max(canvas.clientWidth, 40);
  const h = Math.max(canvas.clientHeight || 200, 40);
  const d = dpr();
  if (canvas.width !== Math.round(w * d) || canvas.height !== Math.round(h * d)) {
    canvas.width = Math.round(w * d);
    canvas.height = Math.round(h * d);
  }
  return { w, h, d };
}

function niceBounds(values, thresholds = [], pad = 0.06) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v == null || Number.isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  for (const t of thresholds) {
    if (t.value < min) min = t.value;
    if (t.value > max) max = t.value;
  }
  if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1 };
  if (min === max) { min -= 1; max += 1; }
  const r = Math.max(max - min, 1e-9);
  const padVal = r * pad;
  let lo = min - padVal;
  let hi = max + padVal;
  if (min >= 0 && lo < 0) lo = 0;
  if (max <= 0 && hi > 0) hi = 0;
  return { min: lo, max: hi };
}

export function drawLineChart(canvas, cfg = {}) {
  const { w, h, d } = resizeCanvas(canvas);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const bg = getComputedStyle(canvas).backgroundColor || '#16202c';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const labels = cfg.labels || [];
  const series = cfg.series || [];
  const thresholds = cfg.thresholds || [];
  const margins = { l: 46, r: 12, t: 12, b: 20 };
  const pw = w - margins.l - margins.r;
  const ph = h - margins.t - margins.b;
  const bound = niceBounds(series.flatMap(s => s.data), thresholds);
  const range = bound.max - bound.min;
  const n = labels.length;
  const nx = Math.max(1, (labels[0] instanceof Date ? labels : labels.map(x => x)).length - 1);
  const xClip = Math.max(1, n - 1);

  const fmt = cfg.yFormat || ((v) => Number(v).toFixed(1));
  ctx.font = '10px ' + TOKEN_MONO();
  ctx.textBaseline = 'middle';
  ctx.fillStyle = TOKEN_MUTED();
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const v = bound.min + (range * i) / yTicks;
    const y = margins.t + ph - (ph * (v - bound.min)) / range;
    ctx.beginPath();
    ctx.moveTo(margins.l, y);
    ctx.lineTo(margins.l + pw, y);
    ctx.strokeStyle = TOKEN_GRID();
    ctx.stroke();
    ctx.fillText(fmt(v), margins.l - 6, y);
  }

  for (const t of thresholds) {
    const y = margins.t + ph - (ph * (t.value - bound.min)) / range;
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = t.color || TOKEN_THRESHOLD();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margins.l, y);
    ctx.lineTo(margins.l + pw, y);
    ctx.stroke();
    ctx.restore();
    if (t.label) {
      ctx.textBaseline = 'top';
      ctx.fillStyle = t.color || TOKEN_CRIMSON();
      ctx.fillText(t.label, margins.l + 4, y + 2);
      ctx.textBaseline = 'middle';
    }
  }

  const timeStep = Math.max(1, Math.ceil(xClip / 6));
  for (let i = 0; i <= xClip; i++) {
    if (i % timeStep !== 0 && i !== xClip) continue;
    const x = margins.l + (pw * i) / Math.max(1, xClip);
    ctx.beginPath();
    ctx.moveTo(x, margins.t);
    ctx.lineTo(x, margins.t + ph);
    ctx.strokeStyle = TOKEN_GRID();
    ctx.stroke();
  }

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';

  for (const s of series) {
    const data = s.data || [];
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v == null || Number.isNaN(v)) { started = false; continue; }
      const x = margins.l + (pw * i) / Math.max(1, n - 1);
      const y = margins.t + ph - (ph * (v - bound.min)) / range;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width || 1.6;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.textAlign = 'left';

  if (cfg.xTicks) {
    ctx.textAlign = 'center';
    ctx.fillStyle = TOKEN_MUTED();
    for (let i = 0; i < labels.length; i += timeStep) {
      const x = margins.l + (pw * i) / Math.max(1, n - 1);
      ctx.fillText(cfg.xTicks[i] || '', x, h - 6);
    }
    ctx.textAlign = 'left';
  }
}

export const COLORS = {
  temperature: token('--viz-6', '#4fc4e6'),
  vibration: token('--viz-3', '#e7a83b'),
  pressure: token('--viz-4', '#7c8bee'),
  rpm: token('--viz-2', '#19c9a6'),
  torque: token('--viz-3', '#e7a83b'),
  current: token('--viz-4', '#7c8bee'),
  voltage: token('--viz-2', '#19c9a6'),
  power: token('--viz-1', '#4fa7ff'),
  flow: token('--viz-7', '#9db1c6'),
  frequency: token('--viz-5', '#f06a74'),
  health: token('--color-emerald', '#3bc97f'),
  anomaly: token('--color-amber', '#e7a83b'),
  risk: token('--color-crimson', '#f06a74'),
};
