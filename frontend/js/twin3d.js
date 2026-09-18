import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { store } from './state.js';
import { statusInfo, machineState } from './util.js';

const GLOW = {
  good: 0x3bc97f,
  warn: 0xf0b450,
  critical: 0xf25c4c,
  maint: 0x8f7bff,
  down: 0x5a6780,
  info: 0x38c7ea,
};

const BODY = 0x33455c;
const ACCENT = 0x4d6d8a;
const ZONE_ORDER = ['MACHINING', 'ASSEMBLY', 'PACKAGING', 'UTILITIES'];

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
const depLines = [];
const zoneBoxes = new Map();
let focusTarget = null;
let resetPose = null;
let highlightZone = null;
let riskMode = false;
let depsVersion = -1;
let disposed = false;

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
  if (QUALITY.fps < 44) {
    QUALITY.idx = Math.max(0, QUALITY.idx - 1);
    applyDpr();
  }
}

export function isTwin() { return !!scene; }

function disposeObject(root) {
  if (!root) return;
  root.traverse(o => {
    if (!o.geometry && !o.material) return;
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.map) m.map.dispose();
      if (m.emissiveMap) m.emissiveMap.dispose();
      m.dispose();
    }
  });
}

function mat() { return new THREE.MeshStandardMaterial({ color: BODY, roughness: 0.5, metalness: 0.55 }); }
function glowMat() {
  return new THREE.MeshStandardMaterial({ color: 0x22313f, emissive: GLOW.good, emissiveIntensity: 0.55, roughness: 0.45, metalness: 0.6 });
}
function cyl(r, h, seg = 18, m) { return new THREE.CylinderGeometry(r, r, h, seg); }
function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

function spriteLabel(text, color = '#d9e4f0', sub = null) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = sub ? 128 : 64;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(0,0,0,0)';
  c.fillRect(0, 0, cv.width, cv.height);
  c.font = 'bold 42px Segoe UI, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = color;
  c.fillText(text, cv.width / 2, sub ? 40 : 32);
  if (sub) {
    c.font = '26px Segoe UI, sans-serif';
    c.fillStyle = '#9fb2c6';
    c.fillText(sub, cv.width / 2, 90);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(2.4, sub ? 0.6 : 0.3, 1);
  return sp;
}

function addBox(g, w, h, d, x, y, z, m) {
  const b = new THREE.Mesh(box(w, h, d), m);
  b.position.set(x, y, z);
  g.add(b);
  return b;
}
function addCyl(g, r, h, x, y, z, m, seg = 18) {
  const b = new THREE.Mesh(cyl(r, h, seg, m), m);
  b.position.set(x, y, z);
  g.add(b);
  return b;
}

function buildGeometry(type) {
  const g = new THREE.Group();
  const body = mat();
  const gm = glowMat();
  switch (type) {
    case 'CNC_MILL':
      addBox(g, 1.6, 0.25, 1.4, 0, 0.13, 0);
      addBox(g, 0.55, 1.1, 0.8, -0.45, 0.8, 0, gm);
      addBox(g, 0.9, 0.35, 0.9, 0.25, 1.55, 0, body);
      addCyl(g, 0.12, 0.5, 0.55, 1.4, 0, body, 12);
      g.position.y = 0;
      break;
    case 'INDUSTRIAL_MOTOR':
      addBox(g, 1.3, 0.22, 0.7, 0, 0.11, 0, body);
      addCyl(g, 0.42, 1.1, -0.15, 0.72, 0, gm, 20);
      addBox(g, 0.5, 0.7, 0.7, 0.6, 0.72, 0, body);
      addBox(g, 0.18, 0.18, 0.18, -0.5, 0.9, 0, body);
      break;
    case 'HYDRAULIC_PUMP':
      addBox(g, 1.5, 0.22, 1.0, 0, 0.11, 0, body);
      addBox(g, 0.9, 0.55, 0.8, -0.25, 0.5, 0, gm);
      addCyl(g, 0.32, 1.1, 0.45, 0.85, 0, body, 16);
      addBox(g, 0.3, 0.2, 0.3, 0.45, 1.35, 0, body);
      addCyl(g, 0.16, 0.3, -0.7, 0.55, 0, body, 10);
      break;
    case 'CONVEYOR_DRIVE_MOTOR':
      addBox(g, 1.4, 0.2, 0.9, 0, 0.1, 0, body);
      addCyl(g, 0.4, 0.9, -0.4, 0.65, 0, gm, 18);
      addCyl(g, 0.5, 0.35, 0.3, 0.45, 0, body, 18);
      addBox(g, 0.35, 0.35, 0.35, 0.6, 0.85, 0, body);
      break;
    case 'COMPRESSOR':
      addBox(g, 1.6, 0.2, 1.0, 0, 0.1, 0, body);
      addCyl(g, 0.6, 1.6, 0, 0.8, 0, gm, 20);
      addBox(g, 0.5, 0.6, 0.6, 0.95, 0.65, 0, body);
      addBox(g, 0.3, 0.25, 0.25, 0.7, 1.75, 0, body);
      break;
    case 'ROBOTIC_ARM':
      addBox(g, 1.3, 0.18, 1.2, 0, 0.09, 0, body);
      addCyl(g, 0.22, 0.7, -0.2, 0.55, 0, gm, 16);
      addBox(g, 0.4, 0.4, 0.8, 0.1, 1.05, 0, body);
      addBox(g, 0.3, 0.3, 0.9, 0.62, 1.05, 0.15, body);
      addBox(g, 0.25, 0.25, 0.4, 1.1, 1.05, 0.3, body);
      break;
    case 'COOLING_UNIT':
      addBox(g, 1.5, 0.2, 1.2, 0, 0.1, 0, body);
      addBox(g, 1.2, 1.7, 0.7, 0, 1.0, 0, gm);
      addBox(g, 0.7, 0.15, 0.15, 0, 1.6, 0.45, body);
      addBox(g, 0.7, 0.15, 0.15, 0, 1.35, 0.45, body);
      addBox(g, 0.7, 0.15, 0.15, 0, 1.1, 0.45, body);
      addBox(g, 0.7, 0.15, 0.15, 0, 0.85, 0.45, body);
      break;
    case 'GENERATOR':
      addBox(g, 2.0, 0.22, 1.4, 0, 0.11, 0, body);
      addBox(g, 1.6, 1.1, 0.9, -0.15, 0.75, 0, gm);
      addCyl(g, 0.42, 1.0, 0.75, 0.75, 0, body, 18);
      addBox(g, 0.14, 1.1, 0.9, 0.55, 0.75, 0.45, body);
      addBox(g, 0.14, 1.1, 0.9, 0.55, 0.75, -0.45, body);
      break;
    default:
      addBox(g, 1.3, 0.3, 1.0, 0, 0.2, 0, body);
      addBox(g, 1.3, 0.9, 1.0, 0, 0.85, 0, gm);
  }
  return { group: g, glow: gm };
}

function layoutZone(id) {
  const idx = ZONE_ORDER.indexOf(id);
  return { z: -9 + idx * 6 };
}

function machinePos(m, index, laneZ) {
  const perLane = [...machines.values()].filter(x => x.zone === m.zone).map(x => x.machineId).sort();
  const i = perLane.indexOf(m.machineId);
  const x = -8 + i * 5;
  return new THREE.Vector3(x, 0, laneZ);
}

function makeMachine3d(m) {
  const { group, glow } = buildGeometry(m.type);
  const pos = machinePos(m, 0, layoutZone(m.zone).z);
  group.position.copy(pos);
  group.userData.machineId = m.machineId;

  const ringGeo = new THREE.TorusGeometry(1.0, 0.045, 10, 40);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x38c7ea, transparent: true, opacity: 0.9 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.06;
  ring.visible = false;
  group.add(ring);

  const label = spriteLabel(m.machineId, '#d9e4f0', m.name);
  label.position.y = 3.1;
  group.add(label);

  scene.add(group);
  return { group, glow, ring, pos };
}

function buildEdges() {
  if (!scene) return;
  depLines.forEach(([x1, x2]) => {
    scene.remove(x1);
    scene.remove(x2);
  });
  depLines.length = 0;
  const ALL = depsVersion < 0;
  const edges = updateEdges();
  if (!edges.length) return;
  const colors = { MATERIAL: 0x8fb8d8, POWER: 0xe8a33d, COOLING: 0x4f9fdd, SERVICE: 0x62c99b };
  const defaultCol = 0x8fb8d8;
  for (const e of edges) {
    const aMach = machines3d.get(e.upstream);
    const bMach = machines3d.get(e.downstream);
    if (!aMach || !bMach) continue;
    const a = aMach.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    const b = bMach.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    const color = colors[e.relation] || defaultCol;
    const pts = [a, b];
    const geoLine = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geoLine, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 }));
    scene.add(line);
    const dir = new THREE.Vector3().subVectors(b, a);
    const arrow = new THREE.ConeGeometry(0.14, 0.34, 8);
    const coneMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const cone = new THREE.Mesh(arrow, coneMat);
    cone.position.copy(b);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    scene.add(cone);
    depLines.push([line, cone]);
  }
}

function updateEdges() {
  return store.dependencies
    .filter(e => machines3d.has(e.upstream) && machines3d.has(e.downstream))
    .map(e => ({ upstream: e.upstream, downstream: e.downstream, relation: (e.relation || '').toUpperCase() }));
}

function zoneSlab(code, name, zRow) {
  const w = 18.5;
  const d = 4.6;
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.06, d),
    new THREE.MeshBasicMaterial({ color: 0x1b2b3d, transparent: true, opacity: 0.35 })
  );
  slab.position.set(0, -0.2, zRow);
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.08, d)),
    new THREE.LineBasicMaterial({ color: 0x2d4256 })
  );
  edge.position.copy(slab.position);
  scene.add(slab);
  scene.add(edge);
  const lb = spriteLabel(name, '#8fb0cc');
  lb.position.set(-10.5, 0.05, zRow + 2.75);
  lb.scale.set(2, 0.25, 1);
  scene.add(lb);
  zoneBoxes.set(code, { x: 0, z: zRow, w, d });
}

function applyStatus(m) {
  const node = machines3d.get(m.machineId);
  if (!node) return;
  const s = machineState(m);
  const tone = s.tone === 'muted' ? 'good' : s.tone;
  const risk = Number(m.failureRisk ?? 0);
  const riskTone = risk >= 0.8 ? 'critical' : risk >= 0.5 ? 'warn' : tone;
  if (SIM_OVERLAY.active && SIM_OVERLAY.ids.has(m.machineId)) {
    node.glow.emissive.setHex(0x38c7ea);
    node.glow.emissiveIntensity = 1.0;
  } else if (riskMode) {
    node.glow.emissive.setHex(GLOW[riskTone]);
    node.glow.emissiveIntensity = risk >= 0.5 ? 1.0 : 0.35;
  } else {
    node.glow.emissive.setHex(GLOW[tone]);
    node.glow.emissiveIntensity = tone === 'critical' ? 1.1 : 0.62;
  }
  node.group.scale.set(1, tone === 'critical' ? 1.06 : 1, 1);
  const showRing = store.selectedMachineId === m.machineId || s.state === 'STALE' || (riskMode && risk >= 0.5);
  node.ring.visible = showRing;
  const dim = (highlightZone && m.zone !== highlightZone)
    || (riskMode && risk < 0.5 && store.selectedMachineId !== m.machineId);
  node.group.traverse(o => {
    if (o.isMesh && o.material && !o.isSprite) {
      o.material.transparent = true;
      o.material.opacity = dim ? 0.18 : 1;
    }
  });
}

export function updateTwin() {
  if (!scene) return;
  for (const id of machines3d.keys()) {
    if (!machines.has(id)) { scene.remove(machines3d.get(id).group); machines3d.delete(id); }
  }
  for (const m of machines.values()) {
    if (!machines3d.has(m.machineId)) machines3d.set(m.machineId, makeMachine3d(m));
    applyStatus(m);
  }
  if (depsVersion !== store.dependencies.length) {
    depsVersion = store.dependencies.length;
    buildEdges();
  }
}

function stopAnim() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

function animate() {
  rafId = requestAnimationFrame(animate);
  if (document.hidden) return;
  controls.update();
  if (focusTarget) {
    const k = 0.09;
    camera.position.lerp(focusTarget.pos, k);
    controls.target.lerp(focusTarget.tgt, k);
    if (camera.position.distanceTo(focusTarget.pos) < 0.15) focusTarget = null;
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

function attachEvents() {
  const dom = renderer.domElement;
  const onClick = (e) => {
    const hit = pick(e.clientX, e.clientY);
    if (hit) onSelect && onSelect(hit.userData.machineId);
  };
  let hovered = null;
  const onMove = (e) => {
    const hit = pick(e.clientX, e.clientY);
    const next = hit ? hit.userData.machineId : null;
    if (next !== hovered) {
      hovered = next;
      dom.style.cursor = next ? 'pointer' : 'grab';
    }
  };
  dom.addEventListener('click', onClick);
  dom.addEventListener('mousemove', onMove);
  domHandlers.push(['click', onClick], ['mousemove', onMove]);
}

function pick(x, y) {
  const rc = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((x - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((y - rect.top) / rect.height) * 2 + 1;
  rc.setFromCamera(ndc, camera);
  const nodes = [];
  for (const [id, node] of machines3d) {
    rc.intersectObject(node.group, true).some(hit => {
      if (hit.object) { nodes.push({ id, dist: hit.distance }); return true; }
      return false;
    });
  }
  nodes.sort((a, b) => a.dist - b.dist);
  const hitId = nodes[0] && nodes[0].id;
  const m = machines3d.get(hitId);
  return m ? m.group : null;
}

const STATE = {
  camera: new THREE.Vector3(14, 16, 18),
  target: new THREE.Vector3(0, 0, -2),
  near: 0.1,
  far: 200,
  fov: 52,
};

export function resetCamera() {
  if (!scene) return;
  focusTarget = { pos: STATE.camera.clone(), tgt: STATE.target.clone() };
  highlightZone = null;
  for (const m of machines.values()) applyStatus(m);
}

export function focusTop() {
  if (!scene) return;
  highlightZone = null;
  focusTarget = { pos: new THREE.Vector3(0, 22, 0.5), tgt: new THREE.Vector3(0, 0, -0.5) };
  for (const m of machines.values()) applyStatus(m);
}

export function focusOnMachine(id) {
  if (!scene) return;
  const node = machines3d.get(id);
  if (!node) return;
  const pos = node.pos.clone().add(new THREE.Vector3(4.5, 5, 7));
  focusTarget = { pos, tgt: node.pos.clone().add(new THREE.Vector3(0, 0.8, 0)) };
}

export function focusOnZone(code) {
  if (!scene) return;
  const zb = zoneBoxes.get(code);
  if (!zb) return;
  focusTarget = { pos: new THREE.Vector3(0, 12, zb.z - 8), tgt: new THREE.Vector3(0, 0, zb.z) };
  highlightZone = code;
  for (const m of machines.values()) applyStatus(m);
}

export function initTwin(el, opts = {}) {
  container = el;
  onSelect = opts.onSelect || null;
  disposed = false;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e14);
  camera = new THREE.PerspectiveCamera(STATE.fov, 1, STATE.near, STATE.far);
  camera.position.copy(STATE.camera);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  QUALITY.tiers = [];
  QUALITY.idx = dprTiers().length - 1;
  QUALITY.samples = 0;
  QUALITY.frames = 0;
  QUALITY.lastAt = 0;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(STATE.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x22303d, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.05);
  key.position.set(12, 20, 10);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8fb0cc, 0.35);
  fill.position.set(-10, 8, -8);
  scene.add(fill);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 26),
    new THREE.MeshStandardMaterial({ color: 0x0d141d, roughness: 1, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.06;
  scene.add(floor);
  const grid = new THREE.GridHelper(30, 30, 0x223345, 0x16222e);
  grid.position.y = 0.005;
  scene.add(grid);

  for (const z of store.zones) zoneSlab(z.code, z.name, layoutZone(z.code).z);
  for (const m of store.machines) machines.set(m.machineId, m);
  updateTwin();
  attachEvents();

  const resize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
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
  riskMode = !!active;
  for (const m of machines.values()) applyStatus(m);
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
    for (const [type, fn] of domHandlers) renderer.domElement.removeEventListener(type, fn);
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
  depLines.length = 0;
  zoneBoxes.clear();
  focusTarget = null;
  highlightZone = null;
  riskMode = false;
  depsVersion = -1;
  QUALITY.tiers = [];
}
