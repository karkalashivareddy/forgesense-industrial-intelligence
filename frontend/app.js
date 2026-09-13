import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const API = localStorage.getItem('forgesense.api') || 'http://localhost:8080';

let token = null;
let machines = [];
let selectedId = 'M-101';
let pods = new Map();

// ---------- API helpers ----------
async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(API + path, { ...opts, headers });
    if (res.status === 401 && !opts._retry) {
        await login();
        return api(path, { ...opts, _retry: true });
    }
    if (!res.ok) throw new Error((await res.text().catch(() => res.status)) ||
        `HTTP ${res.status} on ${path}`);
    return res.status === 204 ? null : res.json();
}
async function login() {
    const pass = localStorage.getItem('forgesense.pw') ||
        (window.prompt('ForgeSense admin password (dev default: forgesense-dev)') || 'forgesense-dev');
    const r = await api('/api/v1/auth/login', {
        method: 'POST', _retry: true,
        body: JSON.stringify({ username: 'admin', password: pass })
    });
    token = r.accessToken;
    localStorage.setItem('forgesense.pw', pass);
}

// ---------- 3D scene ----------
const container = document.getElementById('sceneContainer');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1117);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
camera.position.set(16, 14, 18);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x22303d, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.1);
key.position.set(10, 18, 8);
scene.add(key);
const grid = new THREE.GridHelper(16, 16, 0x22303d, 0x16222e);
scene.add(grid);

const GLOW = { healthy: 0x35d07f, watch: 0xf2b544, anomaly: 0xf2594b, down: 0x5a6780 };

function makePod(id, index) {
    const g = new THREE.Group();
    const bodyGeo = new THREE.BoxGeometry(1.7, 1.4, 1.1);
    const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0x2a3a4d, roughness: 0.55, metalness: 0.4 }));
    body.position.y = 0.7;
    g.add(body);
    const lamp = new THREE.SphereGeometry(0.16, 16, 16);
    const light = new THREE.Mesh(lamp, new THREE.MeshStandardMaterial({ color: GLOW.healthy, emissive: GLOW.healthy, emissiveIntensity: 0.9 }));
    light.position.set(0, 1.65, 0.58);
    g.add(light);
    g.userData = { id, light };

    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#d7e2ee'; ctx.font = 'bold 30px Segoe UI, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(id, 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sprite.scale.set(2, 0.375, 1); sprite.position.y = 2.35;
    g.add(sprite);

    const x = (index % 4) * 3.2 - 4.8;
    const z = Math.floor(index / 4) * 3.2 - 1.6;
    g.position.set(x, 0, z);
    scene.add(g);
    return g;
}

function colorFor(m) {
    const health = m.healthScore ?? 100;
    const anomaly = m.anomalyScore ?? 0;
    if (m.status === 'OFFLINE' || m.status === 'DOWN') return GLOW.down;
    if (anomaly >= 0.85) return GLOW.anomaly;
    if (anomaly >= 0.6 || health < 60) return GLOW.watch;
    return GLOW.healthy;
}

function updateScene() {
    machines.forEach((m, i) => {
        let pod = pods.get(m.machineId);
        if (!pod) { pod = makePod(m.machineId, i); pods.set(m.machineId, pod); }
        const col = colorFor(m);
        pod.userData.light.material.color.setHex(col);
        pod.userData.light.material.emissive.setHex(col);
        pod.userData.light.material.emissiveIntensity = (col === GLOW.anomaly) ? 1.6 : 0.9;
        pod.scale.y = (col === GLOW.anomaly) ? 1.08 : 1;
    });
}

renderer.domElement.addEventListener('click', onSceneClick);
function onSceneClick() {
    const hit = pick();
    if (hit) selectMachine(hit.userData.id);
}
function pick() {
    const rc = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((eventClientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((eventClientY - rect.top) / rect.height) * 2 + 1;
    rc.setFromCamera(ndc, camera);
    return rc.intersectObjects([...pods.values()], true).find(x => x.object.userData && x.object.userData.id)?.object;
}
let eventClientX = 0, eventClientY = 0;
renderer.domElement.addEventListener('mousemove', e => { eventClientX = e.clientX; eventClientY = e.clientY; });

function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}
new ResizeObserver(resize).observe(container);
resize();

function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }
animate();

// ---------- data refresh ----------
async function refresh() {
    try {
        const status = await api('/api/v1/system/status');
        document.getElementById('mlMode').textContent =
            status?.mlServiceAvailable ? 'online' : 'offline';
        setApi(true);
    } catch { setApi(false); return; }

    try {
        machines = await api('/api/v1/machines');
        renderFleet();
        updateScene();
        if (selectedId) {
            const sel = machines.find(m => m.machineId === selectedId);
            if (sel) renderDetail(sel);
        }
    } catch (e) { console.warn('machines refresh failed', e); }

    try {
        const alerts = await api('/api/v1/alerts');
        renderAlerts(alerts);
    } catch { /* non-fatal */ }

    try {
        const evs = await api('/api/v1/events?limit=40');
        renderEvents(evs);
    } catch { /* non-fatal */ }
}
function setApi(ok) {
    document.getElementById('apiStatus').className = 'dot ' + (ok ? 'up' : 'down');
    document.getElementById('apiStatusText').textContent =
        ok ? 'connected (REST poll 3s)' : 'disconnected';
}

function renderFleet() {
    const healthy = machines.filter(m => (m.anomalyScore ?? 0) < 0.6).length;
    const watch = machines.filter(m => { const a = m.anomalyScore ?? 0; return a >= 0.6 && a < 0.85; }).length;
    const bad = machines.length - healthy - watch;
    document.getElementById('fleetStats').innerHTML =
        `<div class="stat"><b>${machines.length}</b><span>machines</span></div>` +
        `<div class="stat"><b style="color:var(--good)">${healthy}</b><span>healthy</span></div>` +
        `<div class="stat"><b style="color:var(--warn)">${watch}</b><span>watch</span></div>` +
        `<div class="stat"><b style="color:var(--bad)">${bad}</b><span>anomaly</span></div>`;

    const rows = machines.map(m => {
        const a = m.anomalyScore ?? 0;
        const cls = a >= 0.85 ? 'bad' : a >= 0.6 ? 'warn' : 'good';
        const hp = Math.round(m.healthScore ?? 100);
        return `<tr data-id="${m.machineId}" class="${m.machineId === selectedId ? 'selected' : ''}">
          <td>${m.machineId}</td><td>${m.typeLabel ?? m.type ?? '—'}</td>
          <td><span class="hp ${cls}">${hp}</span></td>
          <td>${((m.failureRisk ?? 0) * 100).toFixed(1)}%</td><td>${m.status ?? 'NORMAL'}</td></tr>`;
    }).join('');
    document.querySelector('#machineTable tbody').innerHTML = rows;
    document.querySelectorAll('#machineTable tbody tr').forEach(tr =>
        tr.addEventListener('click', () => selectMachine(tr.dataset.id)));
}

async function renderDetail(m) {
    selectedId = m.machineId;
    document.querySelectorAll('#machineTable tbody tr').forEach(tr =>
        tr.classList.toggle('selected', tr.dataset.id === selectedId));
    document.getElementById('detailTitle').textContent = `Machine Detail · ${m.machineId}`;

    let expl = null;
    try { expl = await api(`/api/v1/machines/${m.machineId}/explanation`); } catch { /* old data ok */ }
    const a = m.anomalyScore ?? 0;
    const cls = a >= 0.85 ? 'bad' : a >= 0.6 ? 'warn' : 'good';
    const mode = expl?.mode ?? '—';

    const factors = (expl?.factors ?? []).slice(0, 5).map(f =>
        `<div class="f"><span>${f.feature}</span>` +
        `<span>${(f.contribution * 100).toFixed(1)}% <i class="${f.label === 'REDUCED' ? 'green' : f.label === 'ELEVATED' ? 'red' : 'neutral'}">${f.label}</i></span></div>`
    ).join('') || '<div class="empty">No factors — model not running yet.</div>';

    document.getElementById('detailBody').innerHTML = `
      <div class="row"><b>Status</b><span>${m.status ?? '—'}</span></div>
      <div class="row"><b>Health score</b><span class="hp ${cls}">${Math.round(m.healthScore ?? 100)}</span></div>
      <div class="row"><b>Anomaly score</b><span>${((a) * 100).toFixed(1)}%</span></div>
      <div class="row"><b>Failure risk score</b><span>${((m.failureRisk ?? 0) * 100).toFixed(1)}%</span></div>
      <div class="row"><b>Model</b><span>${mode}</span></div>
      <canvas id="spark" width="380" height="54"></canvas>
      <div class="factors">${factors}</div>`;

    loadSpark(m.machineId);
}
async function loadSpark(machineId) {
    try {
        const tl = await api(`/api/v1/machines/${machineId}/telemetry?limit=120`);
        if (!Array.isArray(tl) || !tl.length) return;
        const key = tl[0].temperature != null ? 'temperature' : Object.keys(tl[0]).find(k =>
            ['vibration', 'pressure', 'rpm', 'current'].includes(k)) || 'rpm';
        const c = document.getElementById('spark');
        const ctx = c.getContext('2d');
        const vals = tl.map(x => x[key]).filter(v => typeof v === 'number');
        if (!vals.length) return;
        const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.beginPath();
        vals.forEach((v, i) => {
            const x = (i / (vals.length - 1)) * c.width;
            const y = c.height - 8 - ((v - min) / span) * (c.height - 16);
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.strokeStyle = '#35c4e6'; ctx.lineWidth = 1.6; ctx.stroke();
    } catch { /* sparkline best-effort */ }
}

function renderAlerts(alerts) {
    const el = document.getElementById('alertFeed');
    const list = (alerts?.items ?? alerts ?? []).slice(0, 8);
    el.innerHTML = list.length ? list.map(al =>
        `<div class="ev"><span class="tag">${al.severity ?? 'INFO'}</span>` +
        `<span>${al.machineId ?? ''} — ${al.headline ?? al.description ?? al.message ?? ''}</span></div>`
    ).join('') : '<div class="empty">No active alerts.</div>';
}
function renderEvents(events) {
    const el = document.getElementById('eventFeed');
    const list = (events?.items ?? events ?? []).slice(0, 40);
    el.innerHTML = list.map(ev => {
        const t = ev.eventTime ? new Date(ev.eventTime).toLocaleTimeString() : '';
        return `<div class="ev"><time>${t}</time><span>${ev.machineId ?? ''}</span>` +
            `<span class="tag">${ev.eventType ?? ''}</span><span>${ev.detail ?? ''}</span></div>`;
    }).join('') || '<div class="empty">Feed idle…</div>';
}

function selectMachine(id) {
    selectedId = id;
    const m = machines.find(x => x.machineId === id);
    if (m) renderDetail(m);
    else refresh();
}

// ---------- lifecycle ----------
document.getElementById('reconnectBtn').addEventListener('click', () => { token = null; refresh(); });

setInterval(() => {
    document.getElementById('clock').textContent = new Date().toLocaleTimeString();
}, 1000);

(async function start() {
    setInterval(refresh, 3000);
    await login();
    await refresh();
})();