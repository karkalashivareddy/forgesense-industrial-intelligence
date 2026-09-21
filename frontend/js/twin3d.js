import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { store } from './state.js';
import { machineState, statusInfo } from './util.js';

function tokenColor(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v ? v : fallback;
  } catch { return fallback; }
}

const GLOW = {
  good: new THREE.Color(tokenColor('--color-emerald', '#35c98f')),
  warn: new THREE.Color(tokenColor('--color-amber', '#e7a83b')),
  critical: new THREE.Color(tokenColor('--color-crimson', '#f06a74')),
  maint: new THREE.Color(tokenColor('--color-cyan', '#45c7e8')),
  down: new THREE.Color(tokenColor('--color-text-muted', '#5a6b7e')),
  info: new THREE.Color(tokenColor('--brand', '#4fa7ff')),
};

/* Cool industrial material ramp — graphite / steel / muted blue */
const BODY = 0x2c3a47;
const BODY_DARK = 0x1b2631;
const ACCENT = 0x2f5777;
const PLATE = 0x161d26;
const STEEL = 0x3c4d5e;
const BRAND = 0x4fa7ff;

/* Physical row order follows the material flow through the plant. */
const ZONE_ORDER = ['MACHINING', 'MATERIAL_HANDLING', 'ASSEMBLY', 'INSPECTION', 'PACKAGING', 'UTILITIES'];
const ZONE_SLAB = 0x1a2735;   /* single neutral graphite for every zone */
const ZONE_LABEL_COLOR = '#8aa2ba';

const ROW_PITCH = 6.9;
const ROW_OFFSET = 2.6;
const MACHINE_SPACING = 4.6;
const ZONE_DEPTH = 5.6;
const EDGE_Y = 1.35;

let container = null;
let scene = null;
let camera = null;
let renderer = null;
let controls = null;
let rafId = 0;
let onSelect = null;
let resizeObserver = null;
let domHandlers = [];

const machines = new Map();
const machines3d = new Map();
let depsGroup = null;
const depEdges = [];
const zoneBoxes = new Map();
const zoneSlabRefs = new Map();
const flowStrips = [];
let layoutSig = '';
let focusTarget = null;
let resetPose = null;
let highlightZone = null;
let layerMode = 'physical';   /* physical | risk | dependencies | selected */
let depsVersion = -1;
let disposed = false;
/* ---------------- view state ---------------- */
let hoveredId = null;
let keyboardIdx = -1;
let clock = new THREE.Clock();
let reducedMotion = false;
if (typeof window !== 'undefined' && window.matchMedia) {
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const SIM_OVERLAY = { active: false, ids: new Set() };

const QUALITY = {
  samples: 0,
  frames: 0,
  lastAt: 0,
  fps: 60,
  tiers: [],
  idx: 0,
};

function dprTiers() {
  const max = Math.min(window.devicePixelRatio || 1, 2);
  if (!QUALITY.tiers.length) {
    const n = 4;
    for (let i = 0; i < n; i++) QUALITY.tiers.push(1 + (max - 1) * (i / (n - 1)));
    QUALITY.tiers.push(max);
  }
  return QUALITY.tiers;
}

function applyDpr() {
  if (!renderer || !container) return;
  renderer.setPixelRatio(Math.min(dprTiers()[QUALITY.idx], 2));
  const w = container.clientWidth || 1;
  const h = container.clientHeight || 1;
  renderer.setSize(w, h);
}

function adaptQuality() {
  if (QUALITY.samples < 6) return;
  QUALITY.samples = 0;
  const tiers = dprTiers();
  if (QUALITY.idx >= tiers.length - 1) return;
  if (QUALITY.fps < 42) {
    QUALITY.idx = Math.max(0, QUALITY.idx - 1);
    applyDpr();
  }
}

export function isTwin() { return !!scene; }

function disposeObject(root) {
  if (!root) return;
  root.traverse(o => {
    if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.map && !m.map.userData?.shared) m.map.dispose();
      if (m.emissiveMap && !m.emissiveMap.userData?.shared) m.emissiveMap.dispose();
      m.dispose();
    }
  });
}

/* ---------- shared assets (created once, disposed once) ---------- */
const SHARED = {};

function sharedGeometry(key, make) {
  if (!SHARED[key]) {
    SHARED[key] = make();
    SHARED[key].userData.shared = true;
  }
  return SHARED[key];
}

function dashTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 8;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(111,135,160,0.9)';
  c.fillRect(0, 0, 54, 8);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  tex.userData.shared = true;
  return tex;
}

function safetyStripTexture() {
  const cv = document.createElement('canvas');
  cv.width = 16;
  cv.height = 16;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(56,72,90,0.32)';
  c.fillRect(0, 0, 16, 3);
  c.fillRect(0, 8, 16, 3);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40, 40);
  tex.userData.shared = true;
  return tex;
}

/* ---------- small factories ---------- */
function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
function cyl(r, h, seg = 20) { return new THREE.CylinderGeometry(r, r, h, seg); }

function stdMat(color = BODY, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.68,
    metalness: 0.55,
    ...opts,
  });
}

function glowMat(hex) {
  return new THREE.MeshStandardMaterial({
    color: 0x22313f,
    emissive: hex,
    emissiveIntensity: 0.42,
    roughness: 0.5,
    metalness: 0.55,
  });
}

function panelMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x243340,
    emissive: 0x2c4a63,
    emissiveIntensity: 0.32,
    roughness: 0.55,
    metalness: 0.5,
  });
}

function spriteLabel(lines, opts = {}) {
  const { width = 512, bg = 'rgba(10,16,24,0.78)', borderColor = 'rgba(150,182,208,0.22)' } = opts;
  const height = lines.length > 1 ? 148 : 72;
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(0,0,0,0)';
  c.fillRect(0, 0, width, height);
  c.strokeStyle = borderColor;
  c.lineWidth = 6;
  c.strokeRect(6, 6, width - 12, height - 12);
  const pad = 12;
  c.font = '600 34px "JetBrains Mono", monospace';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  lines.forEach((ln, i) => {
    const y = 38 + i * 40;
    c.fillStyle = ln.color || '#dbe6f2';
    c.font = ln.mono === false ? '600 30px Inter, sans-serif' : '600 34px "JetBrains Mono", monospace';
    c.fillText(ln.text, width / 2, y);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
  const h = lines.length > 1 ? 0.78 : 0.34;
  sp.scale.set(2.9 * (opts.scaleX || 1), h * (opts.scaleY || 1), 1);
  sp.userData.canvas = cv;
  sp.userData.baseScale = sp.scale.clone();
  return sp;
}

function addMesh(parent, geo, mat, x, y, z, rx = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  if (rz) m.rotation.z = rz;
  parent.add(m);
  return m;
}

function plinth(g, w, d, h = 0.3) {
  const plate = addMesh(g, box(w, h, d), stdMat(BODY_DARK, { roughness: 0.85, metalness: 0.3 }), 0, h / 2, 0);
  const edge = addMesh(g, box(w + 0.08, h * 0.6, d + 0.08), stdMat(STEEL, { roughness: 0.55, metalness: 0.7 }), 0, h * 0.2, 0);
  edge.material.transparent = true;
  edge.material.opacity = 0.55;
  return { w, d };
}

function statusIndicator(g, frontZ, w) {
  const ind = addMesh(g, box(Math.min(w * 0.72, 1.9), 0.09, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x22313f, emissive: GLOW.good, emissiveIntensity: 0.5, roughness: 0.5, metalness: 0.5 }),
    0, 0.62, frontZ + 0.16);
  return ind;
}

function buildGeometry(type) {
  const g = new THREE.Group();
  const spin = [];
  const body = stdMat(BODY);
  const dark = stdMat(BODY_DARK);
  const panel = panelMat();
  let dims = { w: 2.4, d: 1.8 };
  switch (type) {
    case 'CNC_MILL': {
      dims = plinth(g, 2.7, 2.2);
      addMesh(g, box(1.7, 1.55, 1.7), body, -0.3, 1.0, 0);
      addMesh(g, box(1.7, 0.85, 0.06), panel, 0.55, 1.15, 0.86);
      addMesh(g, box(0.75, 0.5, 0.9), dark, 0.7, 0.8, -0.45);
      const s = addMesh(g, cyl(0.16, 0.7, 14), stdMat(ACCENT, { metalness: 0.85, roughness: 0.3 }), 0.9, 1.55, -0.5, Math.PI / 2);
      spin.push(s);
      addMesh(g, box(0.6, 0.28, 0.5), body, 0.9, 1.9, -0.5);
      break;
    }
    case 'INDUSTRIAL_MOTOR': {
      dims = plinth(g, 2.3, 1.5);
      const s = addMesh(g, cyl(0.6, 1.5, 24), stdMat(ACCENT, { metalness: 0.8, roughness: 0.35 }), -0.2, 1.05, 0, Math.PI / 2);
      spin.push(s);
      addMesh(g, box(0.6, 0.85, 0.85), dark, 0.6, 1.05, 0);
      addMesh(g, box(0.35, 0.35, 0.35), body, 0.9, 1.55, 0);
      addMesh(g, cyl(0.1, 0.55, 10), stdMat(STEEL), 1.05, 1.05, 0, Math.PI / 2);
      break;
    }
    case 'HYDRAULIC_PUMP': {
      dims = plinth(g, 2.3, 1.6);
      addMesh(g, box(0.95, 1.05, 1.0), body, -0.35, 0.82, 0);
      addMesh(g, box(0.95, 0.45, 0.06), panel, -0.35, 1.0, 0.51);
      const s = addMesh(g, cyl(0.42, 0.95, 20), stdMat(ACCENT, { metalness: 0.8, roughness: 0.35 }), 0.5, 0.9, 0, Math.PI / 2);
      spin.push(s);
      addMesh(g, cyl(0.09, 0.8, 10), stdMat(STEEL), 0.5, 1.5, 0);
      addMesh(g, box(0.42, 0.42, 0.42), dark, -0.35, 1.55, 0);
      addMesh(g, cyl(0.06, 0.9, 8), stdMat(STEEL), -0.35, 1.6, 0.5, 0, Math.PI / 2);
      addMesh(g, cyl(0.06, 0.9, 8), stdMat(STEEL), -0.35, 1.6, -0.5, 0, Math.PI / 2);
      break;
    }
    case 'CONVEYOR_DRIVE_MOTOR': {
      dims = plinth(g, 2.8, 1.7);
      addMesh(g, box(2.7, 0.32, 0.9), dark, 0, 0.48, 0);
      for (let i = -1; i <= 1; i += 0.5) {
        addMesh(g, cyl(0.09, 1.7, 10), stdMat(STEEL, { metalness: 0.85, roughness: 0.3 }), i, 0.74, 0, Math.PI / 2);
      }
      const s = addMesh(g, cyl(0.42, 0.7, 20), stdMat(ACCENT, { metalness: 0.8, roughness: 0.35 }), 1.45, 0.85, 0, 0, Math.PI / 2);
      spin.push(s);
      addMesh(g, box(0.5, 0.5, 0.5), body, 1.05, 1.2, 0);
      break;
    }
    case 'COMPRESSOR': {
      dims = plinth(g, 2.5, 1.7);
      const tank = addMesh(g, cyl(0.78, 2.0, 24), stdMat(ACCENT, { metalness: 0.7, roughness: 0.32 }), -0.15, 1.35, 0);
      addMesh(g, cyl(0.8, 0.08, 24), stdMat(STEEL), -0.15, 0.4, 0, 0, 0);
      addMesh(g, box(0.7, 0.9, 1.2), body, 0.95, 0.9, 0);
      addMesh(g, box(0.7, 0.35, 0.06), panel, 0.95, 1.05, 0.61);
      addMesh(g, cyl(0.07, 1.1, 8), stdMat(STEEL), 0.95, 1.75, -0.3);
      addMesh(g, cyl(0.05, 0.6, 8), stdMat(STEEL), 0.95, 1.55, 0.55, 0, Math.PI / 2);
      break;
    }
    case 'ROBOTIC_ARM': {
      dims = plinth(g, 2.4, 2.2);
      const ped = addMesh(g, cyl(0.5, 0.95, 22), stdMat(ACCENT, { metalness: 0.7, roughness: 0.38 }), 0, 0.65, -0.15);
      addMesh(g, box(0.42, 0.5, 0.42), dark, 0.15, 1.55, -0.15);
      const armLower = addMesh(g, box(0.3, 0.9, 0.34), body, 0.55, 1.62, -0.05, 0.25);
      const armUpper = addMesh(g, box(0.24, 0.72, 0.3), stdMat(ACCENT, { metalness: 0.7, roughness: 0.4 }), 0.95, 2.14, 0.18, -0.5);
      addMesh(g, box(0.26, 0.22, 0.26), body, 1.18, 2.42, 0.34);
      spin.push(armLower);
      spin.push(armUpper);
      addMesh(g, cyl(0.12, 0.8, 10), stdMat(STEEL), -0.55, 0.9, -0.15, 0, Math.PI / 2);
      break;
    }
    case 'COOLING_UNIT': {
      dims = plinth(g, 2.5, 1.9);
      addMesh(g, box(2.05, 1.95, 1.05), body, 0, 1.3, 0);
      const fan = addMesh(g, cyl(0.42, 0.1, 22), panel, 0.5, 1.75, 0.54, Math.PI / 2);
      spin.push(fan);
      addMesh(g, cyl(0.5, 0.12, 26), stdMat(STEEL), 0.5, 1.75, 0.52, Math.PI / 2);
      for (let i = 0; i < 3; i++) addMesh(g, box(1.7, 0.1, 0.06), dark, 0, 0.7 + i * 0.5, -0.54);
      break;
    }
    case 'GENERATOR': {
      dims = plinth(g, 2.9, 1.9);
      addMesh(g, box(2.1, 1.25, 1.25), body, -0.2, 1.0, 0);
      for (let i = -2; i <= 2; i++) addMesh(g, box(0.08, 1.25, 1.35), stdMat(BODY_DARK), -0.2 + i * 0.28, 1.0, 0);
      addMesh(g, box(0.9, 0.7, 0.6), dark, 1.2, 0.8, 0);
      const s = addMesh(g, cyl(0.4, 1.15, 22), stdMat(ACCENT, { metalness: 0.85, roughness: 0.3 }), 1.2, 1.25, 0, 0, Math.PI / 2);
      spin.push(s);
      addMesh(g, cyl(0.12, 0.9, 10), stdMat(STEEL), -1.35, 1.85, 0.3, 0, 0);
      break;
    }
    default: {
      dims = plinth(g, 2.4, 1.8);
      addMesh(g, box(1.9, 1.3, 1.5), body, 0, 1.0, 0);
      addMesh(g, box(1.9, 0.5, 0.06), panel, 0, 1.1, 0.76);
      break;
    }
  }
  return { group: g, spin, glow: null, front: dims.d / 2 + 0.16, plateWidth: dims.w };
}

/* ---------------- layout ---------------- */

function zoneRowIndex(code) {
  const idx = ZONE_ORDER.indexOf(code);
  if (idx >= 0) return idx;
  return ZONE_ORDER.length; /* unknown zones park behind known ones */
}

function rowZ(rowIdx) {
  return -(rowIdx * ROW_PITCH + ROW_OFFSET);
}

function machineListByZone() {
  const byZone = new Map();
  for (const m of machines.values()) {
    if (!byZone.has(m.zone)) byZone.set(m.zone, []);
    byZone.get(m.zone).push(m);
  }
  for (const arr of byZone.values()) arr.sort((a, b) => (a.machineId < b.machineId ? -1 : 1));
  return byZone;
}

function machinePos(m) {
  const byZone = machineListByZone();
  const arr = byZone.get(m.zone) || [m];
  const i = arr.indexOf(m);
  const count = arr.length;
  const x = (i - (count - 1) / 2) * MACHINE_SPACING;
  return new THREE.Vector3(x, 0, rowZ(zoneRowIndex(m.zone)));
}

/* ---------------- scene building ---------------- */

const SELECT_COLOR = new THREE.Color(BRAND);
const SELECT_INTENSITY = new THREE.Color(BRAND);
const DIM_COLOR = new THREE.Color(0x0f151d);

function makeMachine3d(m) {
  const { group, spin, front, plateWidth } = buildGeometry(m.type);
  const pos = machinePos(m);
  group.position.copy(pos);
  group.userData.machineId = m.machineId;

  const plate = addMesh(group, box(3.3, 0.05, 3.0), stdMat(PLATE, { roughness: 0.9, metalness: 0.15 }), 0, 0.0, 0);
  plate.position.y = 0.012;

  /* thin selection outline — hairline brand ring, no double rings, no spin */
  const selGeo = sharedGeometry('selRing', () => new THREE.TorusGeometry(1.72, 0.028, 8, 64));
  const ring = new THREE.Mesh(selGeo, new THREE.MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.9 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.04;
  ring.visible = false;
  group.add(ring);

  const indicator = statusIndicator(group, front, plateWidth);

  const label = spriteLabel(defaultLines(m));
  label.position.set(0, 3.15, 0);
  label.visible = false;
  group.add(label);

  scene.add(group);
  return { group, spin, ring, indicator, label, pos, dir: 1, phase: Math.random() * Math.PI * 2, gain: 1, baseEmissive: null };
}

function defaultLines(m) {
  const s = machineState(m);
  const st = statusInfo(m);
  return [
    { text: m.machineId, color: '#e7eef6', mono: false },
    { text: (st.label || s.label || '') + (m.failureRisk != null ? ' · ' + Math.round(m.failureRisk * 100) + '%' : ''), color: toneHex(s.tone) },
  ];
}

function toneHex(tone) {
  if (tone === 'good') return '#35c98f';
  if (tone === 'warn') return '#e7a83b';
  if (tone === 'critical') return '#f06a74';
  if (tone === 'maint') return '#45c7e8';
  return '#8aa2ba';
}

function refreshLabel(node, m) {
  const s = machineState(m);
  const sig = s.tone + '|' + (m.failureRisk != null ? Math.round(m.failureRisk * 100) : '') + '|' + (SIM_OVERLAY.active && SIM_OVERLAY.ids.has(m.machineId));
  if (node.labelSig === sig) return;
  node.labelSig = sig;
  const sp = node.label;
  sp.material.map.dispose();
  const tex = makeCanvasTexture(defaultLines(m));
  sp.material.map = tex;
  sp.material.color.set(toneHex(s.tone === 'muted' ? 'good' : s.tone));
  sp.material.needsUpdate = true;
}

function makeCanvasTexture(lines) {
  const cv = document.createElement('canvas');
  cv.width = 600;
  cv.height = 148;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, cv.width, cv.height);
  c.strokeStyle = 'rgba(150,182,208,0.25)';
  c.lineWidth = 6;
  c.strokeRect(6, 6, cv.width - 12, cv.height - 12);
  c.font = '600 34px "JetBrains Mono", monospace';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  lines.forEach((ln, i) => {
    c.fillStyle = ln.color || '#dbe6f2';
    c.font = ln.mono === false ? '600 32px Inter, sans-serif' : '600 34px "JetBrains Mono", monospace';
    c.fillText(ln.text, cv.width / 2, 46 + i * 52);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------------- zone environment ---------------- */

function zoneSlabGeometry(w, d) {
  const geo = new THREE.BoxGeometry(w, 0.09, d);
  geo.userData.shared = true;
  return geo;
}

function buildZones() {
  for (const [code, ref] of zoneSlabRefs) {
    scene.remove(ref.group);
    disposeObject(ref.group);
  }
  zoneSlabRefs.clear();
  zoneBoxes.clear();

  const byZone = machineListByZone();
  const order = [...ZONE_ORDER.filter(z => byZone.has(z)), ...[...byZone.keys()].filter(z => !ZONE_ORDER.includes(z))];
  for (const code of order) {
    const arr = byZone.get(code) || [];
    const row = zoneRowIndex(code);
    const z = rowZ(row);
    const w = Math.max(14, arr.length * MACHINE_SPACING + 5.2);
    const group = new THREE.Group();

    const slab = new THREE.Mesh(zoneSlabGeometry(w, ZONE_DEPTH), new THREE.MeshStandardMaterial({
      color: ZONE_SLAB,
      transparent: true,
      opacity: 0.1,
      roughness: 0.9,
      metalness: 0,
      depthWrite: false,
    }));
    slab.position.set(0, -0.045, z);
    slab.userData.sharedGeo = true;
    group.add(slab);

    const edgeGeo = new THREE.BoxGeometry(w, 0.12, ZONE_DEPTH);
    edgeGeo.userData.shared = true;
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(edgeGeo),
      new THREE.LineBasicMaterial({ color: 0x34465a, transparent: true, opacity: 0.5 })
    );
    edge.position.set(0, 0.012, z);
    group.add(edge);

    const strip = addMesh(group, box(w, 0.05, 0.6), stdMat(PLATE, { roughness: 0.92, metalness: 0.1 }), 0, 0.02, z + ZONE_DEPTH / 2 + 0.35);
    strip.material.transparent = true;
    strip.material.opacity = 0.5;

    const lb = spriteLabel([{ text: code.replace(/_/g, ' '), color: ZONE_LABEL_COLOR }], { scaleY: 0.9, scaleX: 1.4 });
    lb.position.set(0, 0.25, z + ZONE_DEPTH / 2 + 0.75);
    lb.scale.set(5.2, 0.5, 1);
    lb.renderOrder = 2;
    group.add(lb);

    scene.add(group);
    zoneSlabRefs.set(code, { group });
    zoneBoxes.set(code, { x: 0, z, w, d: ZONE_DEPTH });
  }
}

/* ---------------- transit lanes / flow strips ---------------- */

function flowStripGeometry(length) {
  const geo = new THREE.PlaneGeometry(length, 0.16);
  geo.userData.shared = true;
  return geo;
}

function buildFlow() {
  for (const s of flowStrips) {
    if (s.mesh.material) {
      const map = s.mesh.material.map;
      if (map && !map.userData?.shared) map.dispose();
      s.mesh.material.dispose();
    }
    scene.remove(s.mesh);
  }
  flowStrips.length = 0;
  const dash = dashTexture();
  const dashMat = new THREE.MeshBasicMaterial({ map: dash, transparent: true, opacity: 0.26, depthWrite: false, color: 0x8fa6be });
  dashMat.map.repeat.set(1, 1);

  const byZone = machineListByZone();
  for (const [code, arr] of byZone) {
    if (!arr.length) continue;
    const row = zoneRowIndex(code);
    const z = rowZ(row);
    const w = Math.max(14, arr.length * MACHINE_SPACING + 5.2);
    const mesh = new THREE.Mesh(flowStripGeometry(w), dashMat.clone());
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.02, z - ZONE_DEPTH / 2 - 0.5);
    scene.add(mesh);
    flowStrips.push({ mesh, axis: 'x', speed: 4 });
  }

  const rows = machineListByZone();
  const n = Math.max(1, rows.size);
  const length = n * ROW_PITCH + 4;
  const spine = new THREE.Mesh(flowStripGeometry(length), dashMat.clone());
  spine.rotation.x = -Math.PI / 2;
  spine.rotation.z = Math.PI / 2;
  spine.position.set(-14.2, 0.02, rowZ(0) - (n - 1) * ROW_PITCH / 2);
  scene.add(spine);
  flowStrips.push({ mesh: spine, axis: 'y', speed: -6 });

  const coneGeo = sharedGeometry('arrow', () => new THREE.ConeGeometry(0.13, 0.3, 8));
  const coneMat = new THREE.MeshBasicMaterial({ color: 0x8fa6be, transparent: true, opacity: 0.4, depthWrite: false });
  const firstZ = rowZ(0);
  for (let i = 1; i < n; i++) {
    const cz = firstZ - (i - 0.5) * ROW_PITCH;
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(-14.2, 0.18, cz);
    cone.rotation.x = -Math.PI / 2;
    scene.add(cone);
    flowStrips.push({ mesh: cone, axis: null });
  }
}

/* ---------------- dependency edges (opt-in layers) ---------------- */

function buildEdges() {
  if (!depsGroup) return;
  for (const e of depEdges) {
    disposeObject(e.line);
    disposeObject(e.cone);
    depsGroup.remove(e.line);
    depsGroup.remove(e.cone);
  }
  depEdges.length = 0;
  const edges = updateEdges();
  if (!edges.length) return;
  const colors = {
    MATERIAL: new THREE.Color(tokenColor('--viz-1', '#4fa7ff')),
    POWER: new THREE.Color(tokenColor('--viz-2', '#19c9a6')),
    COOLING: new THREE.Color(tokenColor('--viz-3', '#7c8bee')),
    SERVICE: new THREE.Color(tokenColor('--viz-5', '#9db1c6')),
  };
  const defaultCol = colors.MATERIAL;
  for (const e of edges) {
    const aMach = machines3d.get(e.upstream);
    const bMach = machines3d.get(e.downstream);
    if (!aMach || !bMach) continue;
    const a = aMach.pos.clone();
    a.y = EDGE_Y;
    const b = bMach.pos.clone();
    b.y = EDGE_Y;
    const color = colors[e.relation] || defaultCol;
    const dir = new THREE.Vector3().subVectors(b, a);
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const len = dir.length();
    if (len < 0.01) continue;
    const lift = Math.min(2.0, 0.7 + len * 0.14);
    const control = mid.clone();
    control.y = EDGE_Y + lift;
    const curve = new THREE.CatmullRomCurve3([a, control, b]);
    const pts = curve.getPoints(16);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 })
    );
    depsGroup.add(line);
    const cone = new THREE.Mesh(sharedGeometry('arrow', () => new THREE.ConeGeometry(0.12, 0.3, 8)), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 }));
    cone.position.copy(b);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    depsGroup.add(cone);
    depEdges.push({ edge: e, line, cone });
  }
  syncDepsVisibility();
}

function syncDepsVisibility() {
  const selected = store.selectedMachineId;
  for (const d of depEdges) {
    const on = layerMode === 'dependencies'
      || (layerMode === 'selected' && (d.edge.upstream === selected || d.edge.downstream === selected));
    d.line.visible = on;
    d.cone.visible = on;
  }
}

function updateEdges() {
  return store.dependencies
    .filter(e => machines3d.has(e.upstream) && machines3d.has(e.downstream))
    .map(e => ({ upstream: e.upstream, downstream: e.downstream, relation: (e.relation || '').toUpperCase() }));
}

/* ---------------- status ---------------- */

function applyStatus(m) {
  const node = machines3d.get(m.machineId);
  if (!node) return;
  const s = machineState(m);
  let tone = s.tone === 'muted' ? 'good' : s.tone;
  const risk = Number(m.failureRisk ?? 0);
  const riskTone = risk >= 0.8 ? 'critical' : risk >= 0.5 ? 'warn' : tone;
  const simHit = SIM_OVERLAY.active && SIM_OVERLAY.ids.has(m.machineId);
  if (s.state === 'STALE' || s.state === 'OFFLINE') tone = 'down';

  const sel = store.selectedMachineId === m.machineId;
  node.gain = 1;
  let indicatorIntensity = tone === 'critical' ? 1.1 : tone === 'good' ? 0.5 : 0.75;
  if (simHit) {
    node.indicator.material.emissive.copy(GLOW.info);
    indicatorIntensity = 0.95;
  } else if (layerMode === 'risk') {
    node.indicator.material.emissive.copy(GLOW[riskTone]);
    indicatorIntensity = risk >= 0.5 ? 0.95 : 0.3;
  } else {
    node.indicator.material.emissive.copy(GLOW[tone]);
  }
  node.indicator.material.emissiveIntensity = indicatorIntensity;
  node.baseEmissive = node.indicator.material.emissive.clone();

  const dim = (highlightZone && m.zone !== highlightZone)
    || (layerMode === 'risk' && risk < 0.5 && !sel)
    || (hoveredId && hoveredId !== m.machineId && !sel);
  const bumps = (s.state === 'STALE' || s.state === 'OFFLINE') ? 0.96 : null;
  node.group.traverse(o => {
    if (o.isMesh && o.material && o !== node.ring && o !== node.indicator) {
      o.material.transparent = true;
      o.material.opacity = dim ? 0.24 : 1;
      if (o.material.emissive) {
        if (sel) {
          o.material.emissive.copy(SELECT_INTENSITY);
          o.material.emissiveIntensity = 0.16;
        } else if (simHit) {
          o.material.emissive.copy(GLOW.info);
          o.material.emissiveIntensity = 0.08;
        } else if (s.state === 'STALE' || s.state === 'OFFLINE') {
          o.material.emissive.copy(DIM_COLOR);
          o.material.emissiveIntensity = 0.05;
        } else {
          o.material.emissive.copy(DIM_COLOR);
          o.material.emissiveIntensity = 0;
        }
      }
    }
  });
  if (dim) node.group.scale.setScalar(0.96);
  else node.group.scale.set(1, bumps != null ? bumps : 1, 1);

  const running = !['OFFLINE', 'MAINTENANCE', 'STALE'].includes(s.state) && m.status !== 'CRITICAL';
  node.running = running ? 1 : s.state === 'CRITICAL' ? 0.35 : 0;
  node.dim = dim;

  node.ring.visible = sel;
  refreshLabel(node, m);
}

/* ---------------- public update path ---------------- */

function layoutChanged() {
  const sig = [...machines.values()].map(m => m.zone + m.machineId).sort().join('|');
  if (sig === layoutSig) return false;
  layoutSig = sig;
  return true;
}

export function updateTwin() {
  if (!scene) return;
  for (const id of machines3d.keys()) {
    if (!machines.has(id)) {
      scene.remove(machines3d.get(id).group);
      disposeObject(machines3d.get(id).group);
      machines3d.delete(id);
    }
  }
  if (layoutChanged()) {
    for (const m of machines.values()) {
      const node = machines3d.get(m.machineId);
      if (node) {
        node.pos.copy(machinePos(m));
        node.group.position.copy(node.pos);
      }
    }
    buildZones();
    buildFlow();
    depsVersion = -1;
  }
  for (const m of machines.values()) {
    if (!machines3d.has(m.machineId)) machines3d.set(m.machineId, makeMachine3d(m));
    applyStatus(m);
  }
  if (depsVersion !== store.dependencies.length) {
    depsVersion = store.dependencies.length;
    buildEdges();
  } else {
    syncDepsVisibility();
  }
}

/* ---------------- interaction ---------------- */

function pick(x, y) {
  const rc = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const dom = renderer.domElement;
  const rect = dom.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  ndc.x = ((x - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((y - rect.top) / rect.height) * 2 + 1;
  rc.setFromCamera(ndc, camera);
  const hits = [];
  for (const [id, node] of machines3d) {
    const r = rc.intersectObject(node.group, true);
    if (r.length) hits.push({ id, dist: r[0].distance });
  }
  hits.sort((a, b) => a.dist - b.dist);
  if (!hits.length) return null;
  return machines3d.get(hits[0].id) || null;
}

function attachEvents() {
  const dom = renderer.domElement;
  const onClick = (e) => {
    const node = pick(e.clientX, e.clientY);
    if (node) onSelect && onSelect(node.group.userData.machineId);
  };
  const onDblClick = (e) => {
    const node = pick(e.clientX, e.clientY);
    if (node) focusOnMachine(node.group.userData.machineId);
  };
  dom.addEventListener('click', onClick);
  dom.addEventListener('dblclick', onDblClick);
  const onMove = (e) => {
    const node = pick(e.clientX, e.clientY);
    setHovered(node ? node.group.userData.machineId : null);
  };
  const onLeave = () => setHovered(null);
  dom.addEventListener('pointermove', onMove);
  dom.addEventListener('pointerleave', onLeave);
  domHandlers.push(
    ['click', onClick], ['dblclick', onDblClick],
    ['pointermove', onMove], ['pointerleave', onLeave],
  );

  window.addEventListener('keydown', onSceneKey);
  domHandlers.push(['window-keydown', onSceneKey]);
}

function setHovered(id) {
  if (hoveredId === id) return;
  hoveredId = id;
  for (const [mid] of machines3d) {
    const m = machines.get(mid);
    if (m) applyStatus(m);
  }
  if (renderer) renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
}

function onSceneKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!isTwin()) return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
  if (e.target && e.target.closest && e.target.closest('#inspector')) return;
  const activeView = document.querySelector('.view.active');
  if (!activeView || activeView.id !== 'view-factory') return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'Enter') {
    const order = [...machines.keys()].sort();
    if (!order.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') keyboardIdx = (keyboardIdx + 1) % order.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') keyboardIdx = (keyboardIdx - 1 + order.length) % order.length;
    else {
      if (keyboardIdx < 0 || keyboardIdx >= order.length) keyboardIdx = 0;
    }
    const id = order[keyboardIdx];
    e.preventDefault();
    onSelect && onSelect(id);
  }
}

/* ---------------- camera / framing ---------------- */

function sceneBounds() {
  const bb = new THREE.Box3();
  let any = false;
  for (const node of machines3d.values()) {
    bb.expandByPoint(node.pos.clone().add(new THREE.Vector3(-1.8, 0, -1.5)));
    bb.expandByPoint(node.pos.clone().add(new THREE.Vector3(1.8, 3.6, 1.5)));
    any = true;
  }
  for (const zb of zoneBoxes.values()) {
    bb.expandByPoint(new THREE.Vector3(zb.x - zb.w / 2, 0, zb.z - zb.d / 2 - 0.8));
    bb.expandByPoint(new THREE.Vector3(zb.x + zb.w / 2, 0.4, zb.z + zb.d / 2 + 0.8));
  }
  if (!any) {
    bb.set(new THREE.Vector3(-10, 0, -4), new THREE.Vector3(10, 3, -16));
  }
  return bb;
}

/* Frame the whole factory so it occupies ~70% of the viewport. */
function fitPose(dirVec) {
  const bb = sceneBounds();
  const center = bb.getCenter(new THREE.Vector3());
  const size = bb.getSize(new THREE.Vector3());
  const fovY = (STATE.fov * Math.PI) / 180;
  const aspect = camera ? camera.aspect : 1.6;
  const fovX = 2 * Math.atan(Math.tan(fovY / 2) * aspect);
  const distX = size.x / (2 * Math.tan(fovX / 2));
  const distZ = size.z / (2 * Math.tan(fovY / 2));
  const fit = Math.max(distX, distZ, 6);
  const dist = fit * 1.14;
  const pos = center.clone().add(dirVec.normalize().multiplyScalar(dist));
  pos.y = Math.max(pos.y, center.y + 7);
  return { pos, tgt: center.clone().add(new THREE.Vector3(0, -0.3, 0)) };
}

const STATE = {
  camera: new THREE.Vector3(30, 26, 12),
  target: new THREE.Vector3(0, 0, -16),
  near: 0.1,
  far: 300,
  fov: 50,
};

const DEFAULT_DIR = new THREE.Vector3(0.5, 0.66, 0.9);

export function resetCamera() {
  if (!scene) return;
  resetPose = fitPose(DEFAULT_DIR.clone());
  focusTarget = { pos: resetPose.pos.clone(), tgt: resetPose.tgt.clone() };
  highlightZone = null;
  for (const m of machines.values()) applyStatus(m);
}

export function focusTop() {
  if (!scene) return;
  highlightZone = null;
  const b = sceneBounds();
  const c = b.getCenter(new THREE.Vector3());
  const size = b.getSize(new THREE.Vector3());
  const dist = Math.max(size.x, size.z) * 0.94;
  focusTarget = { pos: new THREE.Vector3(c.x, dist + 1.5, c.z + 0.01), tgt: c.clone() };
  for (const m of machines.values()) applyStatus(m);
}

export function focusOnMachine(id) {
  if (!scene) return;
  const node = machines3d.get(id);
  if (!node) return;
  keyboardIdx = [...machines.keys()].sort().indexOf(id);
  const dir = new THREE.Vector3(0.5, 0.5, 0.85).normalize();
  const pos = node.pos.clone().add(dir.multiplyScalar(9.5));
  pos.y = Math.max(pos.y, 4.6);
  focusTarget = { pos, tgt: node.pos.clone().add(new THREE.Vector3(0, 0.9, 0)) };
  highlightZone = null;
  for (const m of machines.values()) applyStatus(m);
}

export function focusOnZone(code) {
  if (!scene) return;
  const zb = zoneBoxes.get(code);
  if (!zb) return;
  const pos = new THREE.Vector3(0, 15, zb.z - 9);
  if (zb.z > -14) pos.x = 12;
  else pos.x = -12;
  focusTarget = { pos, tgt: new THREE.Vector3(0, 0, zb.z) };
  highlightZone = code;
  for (const m of machines.values()) applyStatus(m);
}

/* ---------------- init / loop / dispose ---------------- */

function stopAnim() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

function animate() {
  rafId = requestAnimationFrame(animate);
  if (document.hidden) return;
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = performance.now() / 1000;

  if (focusTarget) {
    const k = 0.09;
    camera.position.lerp(focusTarget.pos, k);
    controls.target.lerp(focusTarget.tgt, k);
    if (camera.position.distanceTo(focusTarget.pos) < 0.15) focusTarget = null;
  }
  controls.update();

  if (!reducedMotion) {
    for (const node of machines3d.values()) {
      const m = machines.get(node.group.userData.machineId);
      const speed = (m && m.status === 'NORMAL') ? 1 : (node.running || 0);
      for (const sp of node.spin) {
        sp.rotation.y += dt * 1.1 * speed;
        sp.rotation.z += dt * 0.35 * speed;
      }
      if (node.indicator.material && node.baseEmissive) {
        const pul = 0.06 * Math.sin(t * 2.0 + node.phase);
        node.indicator.material.emissiveIntensity = Math.max(0.12, (node.indicator.material.emissiveIntensity || 0.5) + pul);
      }
      /* labels appear on hover / selection / risk-scan / sim — never all at once */
      if (node.label) {
        const sel = store.selectedMachineId === m.machineId;
        const show = sel || hoveredId === m.machineId || layerMode === 'risk' && (Number(m.failureRisk ?? 0) >= 0.5)
          || layerMode === 'selected' || SIM_OVERLAY.active;
        node.label.visible = show && !node.dim;
        if (show) {
          const d = camera.position.distanceTo(node.pos);
          const k = THREE.MathUtils.clamp((20 / Math.max(d, 1)), 0.6, 1.5) * (sel ? 1.2 : 1);
          node.label.scale.copy(node.label.userData.baseScale).multiplyScalar(k);
        }
      }
    }
  }

  renderer.render(scene, camera);

  const now = performance.now();
  if (!QUALITY.lastAt) QUALITY.lastAt = now;
  QUALITY.frames += 1;
  if (now - QUALITY.lastAt >= 1200) {
    QUALITY.fps = (QUALITY.frames * 1000) / (now - QUALITY.lastAt);
    QUALITY.frames = 0;
    QUALITY.lastAt = now;
    QUALITY.samples += 1;
    adaptQuality();
  }
}

export function initTwin(el, opts = {}) {
  container = el;
  onSelect = opts.onSelect || null;
  disposed = false;
  clock = new THREE.Clock();
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1017);
  scene.fog = new THREE.Fog(0x0a1017, 70, 180);
  camera = new THREE.PerspectiveCamera(STATE.fov, 1, STATE.near, STATE.far);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  QUALITY.tiers = [];
  QUALITY.idx = dprTiers().length - 1;
  QUALITY.samples = 0;
  QUALITY.frames = 0;
  QUALITY.lastAt = 0;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 4;
  controls.maxDistance = 100;
  controls.maxPolarAngle = Math.PI * 0.52;
  controls.target.copy(STATE.target);

  scene.add(new THREE.HemisphereLight(0xdbe9f7, 0x141d27, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.05);
  key.position.set(16, 26, 10);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9db8d4, 0.42);
  rim.position.set(-14, 12, -14);
  scene.add(rim);
  const uplight = new THREE.AmbientLight(0x2a3850, 0.4);
  scene.add(uplight);

  const floorGeo = new THREE.PlaneGeometry(120, 90);
  floorGeo.userData.shared = true;
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ color: 0x0a1017, roughness: 1, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.09;
  scene.add(floor);

  const slabGeo = new THREE.PlaneGeometry(54, 52);
  slabGeo.userData.shared = true;
  const slab = new THREE.Mesh(slabGeo, new THREE.MeshStandardMaterial({ color: 0x0d141d, roughness: 0.95, metalness: 0 }));
  slab.rotation.x = -Math.PI / 2;
  slab.position.set(0, -0.07, -18);
  scene.add(slab);

  /* quiet structural grid — large cells, low contrast */
  const grid = new THREE.GridHelper(52, 26, 0x1b2733, 0x121b24);
  grid.position.set(0, -0.045, -18);
  grid.material.transparent = true;
  grid.material.opacity = 0.7;
  scene.add(grid);

  const safety = new THREE.Mesh(
    new THREE.PlaneGeometry(52, 52),
    new THREE.MeshStandardMaterial({ map: safetyStripTexture(), transparent: true, opacity: 0.5, roughness: 1 })
  );
  safety.rotation.x = -Math.PI / 2;
  safety.position.set(0, 0.005, -18);
  scene.add(safety);

  const depsGroupEl = new THREE.Group();
  depsGroup = depsGroupEl;
  scene.add(depsGroupEl);

  for (const m of store.machines) machines.set(m.machineId, m);
  layoutSig = '';
  updateTwin();
  const fit = fitPose(DEFAULT_DIR.clone());
  resetPose = fit;
  camera.position.copy(fit.pos);
  controls.target.copy(fit.tgt);
  camera.lookAt(fit.tgt);
  camera.updateProjectionMatrix();
  attachEvents();

  const resize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (resetPose) resetPose = fitPose(DEFAULT_DIR.clone());
  };
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();
  animate();
  return { resetCamera, focusOnMachine, focusOnZone };
}

export function syncMachines(list) {
  machines.clear();
  for (const m of list) machines.set(m.machineId, m);
  updateTwin();
}

export function updateMachines(list) {
  if (!scene) return;
  const seen = new Set();
  for (const m of list) {
    machines.set(m.machineId, m);
    seen.add(m.machineId);
  }
  for (const k of machines.keys()) {
    if (!seen.has(k)) machines.delete(k);
  }
  updateTwin();
}

export function setSimMode(active, ids = []) {
  if (!scene) return;
  SIM_OVERLAY.active = !!active;
  SIM_OVERLAY.ids = new Set(ids);
  for (const m of machines.values()) applyStatus(m);
}

export function setRiskMode(active) {
  layerMode = active ? 'risk' : 'physical';
  syncDepsVisibility();
  for (const m of machines.values()) applyStatus(m);
}

/* Opt-in dependency layers: physical (default) | risk | dependencies | selected */
export function setLayerMode(mode) {
  const next = (['physical', 'risk', 'dependencies', 'selected'].includes(mode)) ? mode : 'physical';
  layerMode = next;
  syncDepsVisibility();
  for (const m of machines.values()) applyStatus(m);
}

export function setDepMode(active) {
  setLayerMode(active ? 'dependencies' : 'physical');
}

export function disposeTwin() {
  if (disposed) return;
  disposed = true;
  stopAnim();
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (controls) {
    controls.dispose();
    controls = null;
  }
  if (renderer) {
    for (const [type, fn] of domHandlers) {
      if (type.startsWith('window-')) {
        window.removeEventListener('keydown', fn);
      } else {
        renderer.domElement.removeEventListener(type, fn);
      }
    }
    disposeObject(scene);
    renderer.dispose();
    renderer.domElement.remove();
    renderer = null;
  }
  domHandlers = [];
  scene = null;
  camera = null;
  container = null;
  onSelect = null;
  machines.clear();
  machines3d.clear();
  depEdges.length = 0;
  depsGroup = null;
  zoneBoxes.clear();
  zoneSlabRefs.clear();
  flowStrips.length = 0;
  layoutSig = '';
  focusTarget = null;
  resetPose = null;
  highlightZone = null;
  hoveredId = null;
  keyboardIdx = -1;
  layerMode = 'physical';
  depsVersion = -1;
  QUALITY.tiers = [];
}
