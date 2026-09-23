/* ForgeSense RELEASE VERIFICATION — live browser via CDP.
 *
 * Reproducible, repository-local. Reuses the cached CDN mirror under _qa/.mirror
 * and drives real Chrome/Edge through the actual UI (login overlay, routes,
 * inspector, engineer control card, simulation form) while collecting console,
 * network, and response-body evidence.
 *
 * Env (optional):
 *   QA_BROWSER        chrome/edge executable (default auto-detect)
 *   BASE_URL          app url                         default http://localhost:5173
 *   QA_OUTPUT_DIR     artifacts dir                   default <repo>/_qa/release_verify
 *   QA_PASS           login password                  default forgesense-dev
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, mkdirSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

if (typeof WebSocket === 'undefined') {
  console.error('This script needs a global WebSocket (Node >= 22).');
  process.exit(2);
}

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.env.QA_OUTPUT_DIR || join(ROOT, '_qa', 'release_verify');
const APP = process.env.BASE_URL || 'http://localhost:5173';
const PORT = Number(process.env.QA_CDP_PORT || 9352);
const MIRROR_PORT = Number(process.env.QA_MIRROR_PORT || 9457);
const PASSWD = process.env.QA_PASS || 'forgesense-dev';
const DRIVER_LOG = join(OUT, 'driver.log');
const MIRROR = join(ROOT, '_qa', '.mirror');
const PROFILE = join(tmpdir(), 'forgesense-rel-' + Date.now());
const SCNS = join(OUT, 'screens');
mkdirSync(SCNS, { recursive: true });

const ROUTES = ['command', 'factory', 'fleet', 'telemetry', 'predictions', 'analytics', 'anomalies', 'alerts', 'events', 'maintenance', 'simulation', 'system'];
const VIEWPORTS = [
  { w: 375, h: 812, name: '375' },
  { w: 768, h: 1024, name: '768' },
  { w: 1024, h: 768, name: '1024' },
  { w: 1366, h: 768, name: '1366' },
  { w: 1920, h: 1080, name: '1920' },
];

const CHROME_ARGS = [
  '--headless=new', '--no-first-run', '--disable-default-apps', '--disable-extensions',
  '--disable-background-networking', '--enable-unsafe-swiftshader',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
];

const log = (s) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${s}`; console.log(line); appendFileSync(DRIVER_LOG, line + '\n'); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const results = { console: [], failedRequests: [], captured: {}, phases: {} };
const cap = (k, v) => { results.captured[k] = v; };

function resolveBrowser() {
  if (process.env.QA_BROWSER) return process.env.QA_BROWSER;
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:/Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
    const candidates = [
      join(pf, 'Google/Chrome/Application/chrome.exe'),
      join(pf86, 'Google/Chrome/Application/chrome.exe'),
      join(pf, 'Microsoft/Edge/Application/msedge.exe'),
      join(pf86, 'Microsoft/Edge/Application/msedge.exe'),
    ];
    for (const c of candidates) { try { if (existsSync(c)) return c; } catch {} }
  }
  return null;
}

async function waitJson(url, tries, ms = 250) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {}
    await sleep(ms);
  }
  throw new Error('CDP unreachable: ' + url);
}

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.events = []; }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('ws error')); });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null) {
        const p = this.pending.get(msg.id);
        if (p) { this.pending.delete(msg.id); msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result); }
      } else { this.events.push(msg); }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaljs(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

/* ---------- page helpers ---------- */
async function bootOverlay(cdp, user, label = 'login') {
  for (let i = 0; i < 60; i++) {
    try { if (await cdp.evaljs('!!document.getElementById("loginUser")')) break; } catch {}
    await sleep(250);
  }
  const got = await cdp.evaljs(`(() => {
    const u = document.getElementById('loginUser');
    const pw = document.getElementById('loginPassword');
    if (!u || !pw) return 'missing-fields';
    u.value = ${JSON.stringify(user)};
    pw.value = ${JSON.stringify(PASSWD)};
    const btn = [...document.querySelectorAll('button')].find(b => /^Connect$/.test(b.textContent.trim()));
    if (!btn) return 'missing-button';
    btn.click();
    return 'clicked';
  })()`);
  if (got !== 'clicked') throw new Error('login click failed: ' + got);
  for (let j = 0; j < 120; j++) {
    const s = await cdp.evaljs(`(() => {
      if (document.getElementById('loginUser')) return 'overlay-still';
      const pw = document.getElementById('loginPassword');
      if (pw && pw.style.borderColor) return 'LOGIN-FAILED';
      const st = document.getElementById('sysStatusText');
      const fs = document.getElementById('factoryState');
      const sim = /LIVE|SYNC|REST|DEGRADED/i.test((st || {}).textContent || '');
      if (fs && fs.textContent && fs.textContent !== '—' && sim) return 'BOOTED:' + (st.textContent || '');
      return 'booting';
    })()`).catch(() => 'err');
    if (s.startsWith('BOOTED')) { log(`${label}: ${s}`); return s; }
    if (s === 'LOGIN-FAILED') throw new Error('login failed (red border)');
    if (j % 60 === 0) log(`${label}@${(j * 0.25).toFixed(1)}s: ${s}`);
    await sleep(250);
  }
  throw new Error('boot timeout for ' + label);
}

async function go(cdp, route) {
  await cdp.evaljs(`location.hash = '#/${route}'`);
  const ok = await waitFor(cdp, `document.getElementById('view-${route}') && document.getElementById('view-${route}').classList.contains('active')`, 60, 250);
  if (!ok) throw new Error('route did not activate: ' + route);
  await sleep(2200);
}

async function waitFor(cdp, expr, tries = 40, ms = 250) {
  for (let i = 0; i < tries; i++) {
    try { if (await cdp.evaljs(expr)) return true; } catch {}
    await sleep(ms);
  }
  return false;
}

async function waitForValue(cdp, expr, tries = 40, ms = 250) {
  for (let i = 0; i < tries; i++) {
    try { const v = await cdp.evaljs(expr); if (v && v !== '—' && v !== '') return v; } catch {}
    await sleep(ms);
  }
  return null;
}

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = join(SCNS, name + '.png');
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}

function bodyProbeExpr(extra = '') {
  return `(() => {
    const bt = document.body.innerText || '';
    const bad = [];
    const tokens = ['No explanation available', 'No prediction available', 'Prediction unavailable', 'HTTP 404', 'Not Found', 'undefined', 'NaN', 'COMPLETED', '{', '}'];
    for (const t of tokens) if (bt.includes(t)) bad.push({ token: t, n: bt.split(t).length - 1 });
    const rawJson = bt.includes('"machineId":') ? bt.split('"machineId":').length - 1 : 0;
    const pcts = bt.match(/[0-9]+%/g) || [];
    const weirdPcts = pcts.filter(p => parseInt(p) > 100);
    const hscroll = document.documentElement.scrollWidth > innerWidth + 1;
    const tb = document.querySelector('.topbar');
    return {
      hscroll,
      docSW: document.documentElement.scrollWidth,
      vw: innerWidth,
      active: (document.querySelector('.view.active') || { id: null }).id,
      kpis: [...document.querySelectorAll('.kpi')].map(k => k.textContent.trim().replace(/\\s+/g, ' ')),
      titles: [...document.querySelectorAll('.page-title, h2, h3')].map(k => k.textContent.trim()).slice(0, 8),
      badges: [...document.querySelectorAll('.basis-badge, .st-live, .st-good, .st-warn, .st-critical, .st-maint')].map(b => b.className),
      basis: (document.getElementById('twinBasis') || {}).textContent || null,
      statusbar: (document.querySelector('.statusbar') || {}).textContent || '',
      liveText: (document.getElementById('sysStatusText') || {}).textContent || '',
      pills: [...document.querySelectorAll('.topbar-status .pill')].map(p => p.textContent.trim()),
      bad: bad.filter(b => b.n > 0),
      rawJson,
      pcts: pcts.length,
      weirdPcts,
      canvases: document.querySelectorAll('canvas').length,
      factoryState: (document.getElementById('factoryState') || {}).textContent || null,
      twinBasisText: (document.getElementById('twinBasis') || {}).textContent || null,
      ${extra}
    };
  })()`;
}

async function probe(cdp) {
  return cdp.evaljs(bodyProbeExpr());
}

/* ---------- network capture ---------- */
function setupNetwork(cdp) {
  cdp.ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      results.console.push({ kind: 'console.error', text: (m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 500) });
    }
    if (m.method === 'Runtime.exceptionThrown') {
      results.console.push({ kind: 'exception', text: (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 500) });
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      const text = m.params.entry.text || '';
      if (!text.includes('ERR_BLOCKED_BY_CLIENT')) results.console.push({ kind: 'log.error', text: text.slice(0, 500) });
    }
  });
}

function setupFailedRequests(cdp) {
  cdp.ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Network.loadingFailed') {
      const t = m.params.errorText || '';
      if (!t.includes('ERR_BLOCKED_BY_CLIENT')) {
        results.failedRequests.push({ errorText: t, type: m.params.type || '', url: m.params.url || '', canceled: m.params.canceled || false });
      }
    }
  });
}

function setupResponseCapture(cdp) {
  const bodies = {};
  results.evidence = [];
  const interesting = /\/api\/v1\/machines\/M-101\/|\/api\/v1\/machines$|\/api\/v1\/analytics\/|\/api\/v1\/simulation\/|\/api\/v1\/impact\/|\/api\/v1\/maintenance\?/;
  cdp.ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Network.responseReceived' && m.params.type !== 'WebSocket') {
      const u = m.params.response?.url || '';
      const status = m.params.response?.status;
      if (u.includes('/api/v1/')) {
        bodies[m.params.requestId] = { url: u, status };
      }
    }
    if (m.method === 'Network.loadingFinished') {
      const entry = bodies[m.params.requestId];
      if (!entry) return;
      cdp.send('Network.getResponseBody', { requestId: m.params.requestId }).then(r => {
        entry.body = (r && r.body) ? r.body.slice(0, 600_000) : null;
        results.captured[m.params.requestId] = entry;
        if (interesting.test(entry.url)) {
          results.evidence.push({ url: entry.url, status: entry.status, body: entry.body || null });
        }
      }).catch(() => {
        entry.body = null;
        results.captured[m.params.requestId] = entry;
      });
    }
  });
}

/* ---------- mirror ---------- */
async function fetchToFile(url, file) {
  const r = await fetch(url, { signal: AbortSignal.timeout(40000) });
  if (!r.ok) throw new Error('GET ' + url + ' -> HTTP ' + r.status);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}
function sizeOf(file) { try { return statSync(file).size; } catch { return 0; } }
async function prepareMirror() {
  mkdirSync(MIRROR, { recursive: true });
  const jobs = [
    ['https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js', join(MIRROR, 'three.module.js')],
    ['https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/controls/OrbitControls.js', join(MIRROR, 'OrbitControls.js')],
    ['https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.2/src/regular/style.css', join(MIRROR, 'ph-regular.css')],
    ['https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.2/src/regular/Phosphor.woff2', join(MIRROR, 'Phosphor.woff2')],
  ];
  for (const [url, file] of jobs) {
    if (sizeOf(file) > 0) continue;
    log('mirror fetch ' + url);
    await fetchToFile(url, file);
  }
}
function startMirrorServer() {
  const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = join(MIRROR, p.split('/').pop() || 'index');
    try {
      const data = readFileSync(file);
      const ext = p.slice(p.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
      res.end('not found');
    }
  });
  srv.listen(MIRROR_PORT, '127.0.0.1');
  return srv;
}

/* ---------- api helper (node side) ---------- */
let nodeToken = null;
async function nodeLogin() {
  if (nodeToken) return nodeToken;
  const r = await fetch('http://localhost:8080/api/v1/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'engineer', password: PASSWD }),
  });
  if (!r.ok) throw new Error('node login failed ' + r.status);
  const j = await r.json();
  nodeToken = j.accessToken;
  return nodeToken;
}
async function nodeApi(path) {
  const tok = await nodeLogin();
  const r = await fetch('http://localhost:8080' + path, { headers: { Authorization: 'Bearer ' + tok } });
  return { status: r.status, body: r.status === 200 ? await r.json() : await r.text() };
}
async function nodePost(path, body) {
  const tok = await nodeLogin();
  const r = await fetch('http://localhost:8080' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
    body: JSON.stringify(body || {}),
  });
  return { status: r.status, body: r.status === 200 ? await r.json() : await r.text() };
}

/* ======================================================================= */
async function main() {
  rmSync(DRIVER_LOG, { force: true });
  log('start release verification. app=' + APP + ' pass=' + (PASSWD ? '<set>' : '<missing>'));
  if (!PASSWD) { log('FATAL QA_PASS missing'); process.exit(2); }

  const browser = resolveBrowser();
  if (!browser) { log('FATAL no Chromium'); process.exit(2); }
  log('browser=' + browser);

  await prepareMirror();
  const srv = startMirrorServer();
  const chrome = spawn(browser, CHROME_ARGS, { stdio: 'ignore' });
  process.on('exit', () => { try { chrome.kill(); if (srv) srv.close(); } catch {} });

  const version = await waitJson(`http://127.0.0.1:${PORT}/json/version`, 60);
  log('CDP ' + (version.Browser || '?'));
  await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).catch(() => {});
  await sleep(700);
  const list = await waitJson(`http://127.0.0.1:${PORT}/json/list`, 20);
  const cdp = new CDP(list[0].webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Fetch.enable', { patterns: [
    { urlPattern: '*cdn.jsdelivr.net*' },
    { urlPattern: '*fonts.googleapis.com*' },
    { urlPattern: '*fonts.gstatic.com*' },
  ] });
  setupNetwork(cdp);
  setupFailedRequests(cdp);
  setupResponseCapture(cdp);

  cdp.ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method !== 'Fetch.requestPaused' || !m.params) return;
    const u = m.params.request.url || '';
    const rid = m.params.requestId;
    if (u.includes('fonts.googleapis.com') || u.includes('fonts.gstatic.com')) {
      cdp.send('Fetch.failRequest', { requestId: rid, errorReason: 'BlockedByClient' }).catch(() => {});
      return;
    }
    const redirect = (uu) => {
      if (uu.includes('/three@0.169.0/build/three.module.js')) return `http://127.0.0.1:${MIRROR_PORT}/three.module.js`;
      if (uu.includes('/examples/jsm/controls/OrbitControls.js')) return `http://127.0.0.1:${MIRROR_PORT}/OrbitControls.js`;
      if (uu.includes('/@phosphor-icons/web@2.1.2/src/regular/style.css')) return `http://127.0.0.1:${MIRROR_PORT}/ph-regular.css`;
      if (uu.includes('/@phosphor-icons/web@2.1.2/src/regular/Phosphor.woff2')) return `http://127.0.0.1:${MIRROR_PORT}/Phosphor.woff2`;
      return null;
    };
    const local = redirect(u);
    const p = local ? { requestId: rid, url: local } : { requestId: rid };
    cdp.send('Fetch.continueRequest', p).catch(() => {});
  });

  const vp = (w, h) => cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });

  /* ============ PART A — LOGIN + ROUTE SWEEP (operator, 1366) ============ */
  const routeSweep = { login: null, routes: {}, notes: [] };
  await vp(1366, 768);
  await cdp.send('Page.navigate', { url: APP + '/#/command' });
  await cdp.evaljs('document.readyState');
  const loginProbe = await bootOverlay(cdp, 'operator', 'login-operator');
  routeSweep.login = loginProbe;
  await sleep(2500);

  for (const route of ROUTES) {
    try {
      await go(cdp, route);
      const p = await probe(cdp);
      const active = (await cdp.evaljs(`document.getElementById('view-${route}') && document.getElementById('view-${route}').classList.contains('active')`));
      const f = await shot(cdp, `a_${route}_1366`);
      routeSweep.routes[route] = { active, hscroll: p.hscroll, basis: p.basis, kpis: p.kpis.slice(0, 6), title: `${p.titles[0] || ''}`, canvases: p.canvases, docSW: p.docSW, vw: p.vw, file: f, bad: p.bad, rawJson: p.rawJson, weirdPcts: p.weirdPcts, live: p.liveText };
      log(`route ${route}: active=${active} hscroll=${p.hscroll} rawJson=${p.rawJson} weird=${JSON.stringify(p.weirdPcts)} errors=${p.bad.length}`);
    } catch (e) {
      routeSweep.routes[route] = { error: e.message };
      log('route ' + route + ' FAIL ' + e.message);
    }
  }
  results.phases.routeSweep = routeSweep;

  /* ============ PART B — PREDICTIONS M-101 DEEP (operator) ============ */
  log('--- PART B predictions deep');
  const pred = { seriesCount: 0, ui: {}, explanation: {} };
  try {
    await go(cdp, 'predictions');
    const okRows = await waitFor(cdp, `document.querySelectorAll('#view-predictions .tbl tbody tr').length >= 1`, 40, 300);
    pred.tableRows = await cdp.evaljs(`(() => {
      const rows = [...document.querySelectorAll('#view-predictions .tbl tbody tr')];
      return rows.map(r => r.textContent.trim().replace(/\\s+/g, ' ').slice(0, 180));
    })()`).catch(() => []);
    pred.hasM101Row = (pred.tableRows || []).some(r => r.includes('M-101'));
    const clicked = await cdp.evaljs(`(() => {
      const row = [...document.querySelectorAll('#view-predictions .tbl tbody tr')].find(r => r.textContent.includes('M-101'));
      if (!row) return 'no-row';
      row.click();
      return 'clicked';
    })()`);
    await waitFor(cdp, `document.getElementById('inspector') && !document.getElementById('inspector').classList.contains('collapsed') && document.getElementById('inspBody').textContent.includes('Latest prediction')`, 50, 300);
    pred.clicked = clicked;
    pred.ui.inspectorPredictionText = (await cdp.evaljs(`document.getElementById('inspBody').textContent`)).slice(0, 2500);
    pred.ui.hasHistoryChart = await cdp.evaljs(`!!document.querySelector('#inspBody canvas.chart.sm')`);
    pred.ui.historyPointsText = await cdp.evaljs(`(() => { const el = [...document.querySelectorAll('#inspBody .card-sub')].map(n => n.textContent).find(t => /points/.test(t)); return el || null; })()`);
    pred.ui.hasRiskStat = await cdp.evaljs(`/Failure risk/.test(document.getElementById('inspBody').textContent)`);
    pred.ui.hasAnomalyStat = await cdp.evaljs(`/Anomaly score/.test(document.getElementById('inspBody').textContent)`);
    pred.ui.hasHealthStat = await cdp.evaljs(`/Health/.test(document.getElementById('inspBody').textContent)`);
    pred.ui.hasModelId = await cdp.evaljs(`/mode/i.test(document.getElementById('inspBody').textContent) && /v[0-9a-z.\\-]+/.test(document.getElementById('inspBody').textContent)`);
    pred.ui.hasHistoryHeading = await cdp.evaljs(`/Prediction history/.test(document.getElementById('inspBody').textContent)`);
    pred.ui.modelLine = await cdp.evaljs(`(() => { const m = document.querySelector('#inspBody .insp-head-line .meta'); return m ? m.textContent : null; })()`);
    pred.ui.riskValueText = await cdp.evaljs(`(() => { const els = [...document.querySelectorAll('#inspBody .stat-box')]; const r = els.find(e => e.textContent.includes('Failure risk')); return r ? r.textContent.replace(/\\s+/g,' ').trim() : null; })()`);
    pred.ui.anomalyValueText = await cdp.evaljs(`(() => { const els = [...document.querySelectorAll('#inspBody .stat-box')]; const r = els.find(e => e.textContent.includes('Anomaly score')); return r ? r.textContent.replace(/\\s+/g,' ').trim() : null; })()`);
    pred.ui.healthValueText = await cdp.evaljs(`(() => { const els = [...document.querySelectorAll('#inspBody .stat-box')]; const r = els.find(e => e.textContent.includes('Health')); return r ? r.textContent.replace(/\\s+/g,' ').trim() : null; })()`);
    const f = await shot(cdp, 'b_predictions_m101_prediction_tab_1366');
    pred.ui.screenshot = f;

    /* switch to Explanation tab */
    const tabClick = await cdp.evaljs(`(() => {
      const t = [...document.querySelectorAll('#inspTabs .tab-btn')].find(b => b.textContent.trim() === 'Explanation');
      if (!t) return 'no-tab';
      t.click();
      return 'clicked';
    })()`);
    await waitFor(cdp, `document.getElementById('inspBody').textContent.includes('Feature attribution') || document.getElementById('inspBody').textContent.includes('No explanation available')`, 50, 300);
    pred.explanation.tabClick = tabClick;
    pred.explanation.bodyText = (await cdp.evaljs(`document.getElementById('inspBody').textContent`)).slice(0, 2200);
    pred.explanation.factorRows = await cdp.evaljs(`(() => [...document.querySelectorAll('#inspBody .factor-row')].map(r => r.textContent.replace(/\\s+/g, ' ').trim()))()`);
    pred.explanation.hasFactors = pred.explanation.factorRows && pred.explanation.factorRows.length > 0;
    pred.explanation.screenshot = await shot(cdp, 'b_explanation_factors_1366');
  } catch (e) { pred.error = e.message; log('PART B FAIL ' + e.message); }
  results.phases.predictions = pred;

  /* ============ PART C — ENGINEER CONTROL + STATE TRANSITIONS ============ */
  log('--- PART C engineer control');
  const eng = { steps: {} };
  try {
    await cdp.send('Page.reload', {});
    await sleep(800);
    const l = await bootOverlay(cdp, 'engineer', 'login-engineer');
    eng.login = l;
    await go(cdp, 'fleet');
    await waitFor(cdp, `document.querySelectorAll('#view-fleet .tbl tbody tr').length >= 1`, 40, 300);
    const cl = await cdp.evaljs(`(() => {
      const row = [...document.querySelectorAll('#view-fleet .tbl tbody tr')].find(r => r.textContent.includes('M-101'));
      if (!row) return 'no-row';
      row.click();
      return 'clicked';
    })()`);
    await waitFor(cdp, `document.getElementById('inspector') && !document.getElementById('inspector').classList.contains('collapsed') && document.getElementById('inspBody').textContent.includes('Machine control')`, 50, 300);
    eng.steps.overviewOpen = cl;

    const controlProbe = () => cdp.evaljs(`(() => {
      const cards = [...document.querySelectorAll('#inspBody .card')];
      const card = cards.find(c => (c.querySelector('.card-title') || {}).textContent === 'Machine control');
      if (!card) return { present: false, body: document.getElementById('inspBody').textContent.slice(0, 200) };
      const btns = [...card.querySelectorAll('.btn-row button')].map(b => ({ text: b.textContent.trim(), disabled: b.disabled, cls: b.className, title: b.title }));
      const cs = getComputedStyle(card);
      const csGrid = getComputedStyle(card.parentElement || document.body);
      return {
        present: true,
        title: card.querySelector('.card-title').textContent,
        sub: (card.querySelector('.muted.small') || {}).textContent || '',
        status: (card.querySelector('.card-head .muted, .card-head span') || {}).textContent || '',
        btns,
        cardDisplay: cs.display, cardMarginTop: cs.marginTop, padding: cs.padding,
        gridDisplay: csGrid.display, gridGap: csGrid.gap,
        parentCls: card.parentElement.className,
      };
    })()`);
    eng.steps.controlProbeBefore = await controlProbe();

    const clickBtn = async (label) => cdp.evaljs(`(() => {
      const cards = [...document.querySelectorAll('#inspBody .card')];
      const card = cards.find(c => (c.querySelector('.card-title') || {}).textContent === 'Machine control');
      if (!card) return 'no-card';
      const b = [...card.querySelectorAll('.btn-row button')].find(x => x.textContent.trim() === ${JSON.stringify(label)});
      if (!b) return 'no-btn';
      if (b.disabled) return 'disabled:' + ${JSON.stringify(label)};
      b.click();
      return 'clicked:' + ${JSON.stringify(label)};
    })()`);

    const readState = async () => cdp.evaljs(`(document.querySelector('#inspBody .pill-status') || {}).textContent`);

    const waitState = async (st) => waitFor(cdp, `document.getElementById('inspBody').textContent.includes('status ${st}') || (document.querySelector('#inspBody .pill-status')||{}).textContent === '${st}'`, 40, 300);

    // Normalize to NORMAL first (machine state may persist from an earlier DB session)
    eng.steps.norm = {}; eng.steps.maint = {}; eng.steps.recover = {}; eng.steps.normal = {};
    const stBefore = (await nodeApi('/api/v1/machines/M-101')).body || {};
    eng.steps.startStatus = stBefore.status || null;
    if (eng.steps.startStatus === 'MAINTENANCE') {
      eng.steps.norm.normalizeMaint = await clickBtn('Recover');
      await sleep(1400);
      eng.steps.norm.normalizeRecover = await clickBtn('Resume');
      await sleep(1600);
    } else if (eng.steps.startStatus === 'RECOVERING') {
      eng.steps.norm.normalizeResume = await clickBtn('Resume');
      await sleep(1600);
    }
    eng.steps.normalizedTo = await readState();

    // NORMAL -> MAINTENANCE
    eng.steps.maint.click = await clickBtn('Maintenance');
    await waitState('Maintenance').catch(() => {});
    await sleep(1500);
    eng.steps.maint = {
      click: eng.steps.maint.click,
      pill: await cdp.evaljs(`(document.querySelector('#inspBody .pill-status') || {}).textContent`),
      toast: await cdp.evaljs(`(document.getElementById('toast').textContent || '').trim()`),
      headText: await cdp.evaljs(`(document.querySelector('#inspBody .insp-head-line') || {}).textContent`),
      screenshot: await shot(cdp, 'c_maint_inspector_1366'),
    };
    /* fleet reflects MAINTENANCE */
    await go(cdp, 'fleet');
    await waitFor(cdp, `document.querySelectorAll('#view-fleet .tbl tbody tr').length >= 1`, 40, 300);
    eng.steps.maint.fleetRow = await cdp.evaljs(`(() => {
      const row = [...document.querySelectorAll('#view-fleet .tbl tbody tr')].find(r => r.textContent.includes('M-101'));
      return row ? row.textContent.replace(/\\s+/g, ' ').slice(0, 220) : null;
    })()`);
    eng.steps.maint.fleetScreenshot = await shot(cdp, 'c_maint_fleet_1366');
    /* command center reflects */
    await go(cdp, 'command');
    eng.steps.maint.commandText = (await cdp.evaljs(`document.getElementById('view-command').textContent.replace(/\\s+/g, ' ')`)).slice(0, 900);
    eng.steps.maint.commandScreenshot = await shot(cdp, 'c_maint_command_1366');
    /* factory 3D reflects */
    await go(cdp, 'factory');
    await waitFor(cdp, `document.querySelectorAll('#sceneContainer canvas').length >= 1`, 40, 300);
    await sleep(1500);
    const sel = await cdp.evaljs(`(() => { const a = [...document.querySelectorAll('.twin-asset')].find(x => x.textContent.includes('M-101')); if (!a) return 'no-asset'; a.click(); return 'clicked'; })()`);
    await sleep(1200);
    eng.steps.maint.factory = { sel, basis: await cdp.evaljs(`(document.getElementById('twinBasis')||{}).textContent`), assetsM101: await cdp.evaljs(`(() => { const a = [...document.querySelectorAll('.twin-asset')].find(x => x.textContent.includes('M-101')); return a ? a.textContent.replace(/\\s+/g,' ').slice(0,120) : null; })()`) };
    eng.steps.maint.factoryScreenshot = await shot(cdp, 'c_maint_factory_1366');

    /* MAINTENANCE -> RECOVERING */
    eng.steps.recover.click = await clickBtn('Recover');
    await waitState('Recovering').catch(() => {});
    await sleep(1200);
    eng.steps.recover = {
      click: eng.steps.recover.click,
      pill: await cdp.evaljs(`(document.querySelector('#inspBody .pill-status') || {}).textContent`),
      toast: await cdp.evaljs(`(document.getElementById('toast').textContent || '').trim()`),
      screenshot: await shot(cdp, 'c_recovering_1366'),
    };

    /* RECOVERING -> NORMAL */
    eng.steps.normal.click = await clickBtn('Resume');
    await waitState('Normal').catch(() => {});
    await sleep(1500);
    eng.steps.normal = {
      click: eng.steps.normal.click,
      pill: await cdp.evaljs(`(document.querySelector('#inspBody .pill-status') || {}).textContent`),
      toast: await cdp.evaljs(`(document.getElementById('toast').textContent || '').trim()`),
      screenshot: await shot(cdp, 'c_normal_1366'),
    };
    eng.steps.normal.fleetRow = await cdp.evaljs(`(() => {
      const rows = [...document.querySelectorAll('#view-fleet .tbl tbody tr')];
      const row = rows.find(r => r.textContent.includes('M-101'));
      return row ? row.textContent.replace(/\\s+/g, ' ').slice(0, 220) : null;
    })()`).catch(() => null);
    eng.steps.controlProbeAfter = await controlProbe();
    const stFinal = (await nodeApi('/api/v1/machines/M-101')).body || {};
    eng.steps.finalStatus = stFinal.status || null;
  } catch (e) { eng.error = e.message; log('PART C FAIL ' + e.message); }
  results.phases.engineerControl = eng;

  /* ============ PART D — REALTIME TELEMETRY STABILITY ============ */
  log('--- PART D realtime');
  const rt = {};
  try {
    await go(cdp, 'telemetry');
    await waitFor(cdp, `document.querySelectorAll('#view-telemetry .tbl tbody tr').length >= 1 || document.querySelector('#view-telemetry canvas')`, 40, 300);
    await cdp.evaljs(`(() => { window.__mcount = { add: 0, remove: 0, samples: [] }; const mo = new MutationObserver(muts => { for (const m of muts) { if (m.type === 'childList') { __mcount.add += m.addedNodes.length; __mcount.remove += m.removedNodes.length; } } }); mo.observe(document.querySelector('#view-telemetry'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }); window.__mo = mo; return true; })()`).catch(() => {});
    const live0 = await cdp.evaljs(`(document.getElementById('sysStatusText')||{}).textContent`);
    await sleep(18000);
    const live1 = await cdp.evaljs(`(document.getElementById('sysStatusText')||{}).textContent`);
    rt.live0 = live0; rt.live1 = live1;
    const counts = await cdp.evaljs(`(() => { const c = window.__mcount; c.rows = document.querySelectorAll('#view-telemetry .tbl tbody tr').length; return c; })()`);
    rt.dom = counts;
    rt.basis = await cdp.evaljs(`(document.getElementById('twinBasis')||{}).textContent`);
    rt.lastTel = await cdp.evaljs(`(document.getElementById('svcLastTel')||{}).textContent`);
    rt.telemetryRows = await cdp.evaljs(`(() => { const rows = [...document.querySelectorAll('#view-telemetry .tbl tbody tr')]; return rows.length ? rows.slice(0,2).map(r => r.textContent.replace(/\\s+/g,' ').slice(0,160)) : []; })()`);
    rt.screenshot = await shot(cdp, 'd_telemetry_1366');
  } catch (e) { rt.error = e.message; log('PART D FAIL ' + e.message); }
  results.phases.realtime = rt;

  /* ============ PART E — COMMAND CENTER CONTENT + WEIRD PERCENT SCAN ============ */
  log('--- PART E command');
  const cmd = {};
  try {
    await go(cdp, 'command');
    cmd.text = (await cdp.evaljs(`document.getElementById('view-command').textContent.replace(/\\s+/g, ' ')`)).slice(0, 3000);
    cmd.globalPercentScan = await cdp.evaljs(`(() => {
      const bt = document.body.innerText || '';
      const pcts = bt.match(/[0-9]+%/g) || [];
      const weird = pcts.filter(p => parseInt(p) > 100);
      const has9700 = bt.includes('9700%');
      return { pcts: pcts.slice(0, 40), weird, has9700 };
    })()`);
    cmd.screenshot = await shot(cdp, 'e_command_1366');
  } catch (e) { cmd.error = e.message; }
  results.phases.command = cmd;

  /* ============ PART F — FACTORY TWIN at 1920 + risk mode ============ */
  log('--- PART F factory twin');
  const fac = {};
  try {
    await vp(1920, 1080);
    await go(cdp, 'factory');
    await waitFor(cdp, `document.querySelectorAll('#sceneContainer canvas').length >= 1`, 40, 300);
    await sleep(2500);
    fac.assets = await cdp.evaljs(`document.querySelectorAll('.twin-asset').length`);
    fac.basis = await cdp.evaljs(`(document.getElementById('twinBasis')||{}).textContent`);
    fac.chips = await cdp.evaljs(`[...document.querySelectorAll('#zoneChips .chip')].map(c => c.textContent.trim())`);
    fac.shotA = await shot(cdp, 'f_factory_1920');
    await cdp.evaljs(`(() => { const b = document.getElementById('riskBtn'); if (b) { b.click(); return 'clicked'; } return 'no-btn'; })()`);
    await sleep(1200);
    fac.riskModePressed = await cdp.evaljs(`(document.getElementById('riskBtn')||{getAttribute:()=>null}).getAttribute('aria-pressed')`);
    fac.shotRisk = await shot(cdp, 'f_factory_risk_1920');
  } catch (e) { fac.error = e.message; log('PART F FAIL ' + e.message); }
  results.phases.factory = fac;

  /* ============ PART G — PREDICTION SIMULATION FLOW ============ */
  log('--- PART G simulation flow');
  const sim = {};
  try {
    const before = await nodeApi('/api/v1/machines/M-101/predictions');
    const explBefore = await nodeApi('/api/v1/machines/M-101/explanation');
    sim.beforePredictions = { status: before.status, count: (before.body || []).length, latest: (before.body || [])[0] || null };
    sim.explBefore = { status: explBefore.status, latest: explBefore.body };

    await vp(1366, 768);
    await go(cdp, 'predictions');
    await waitFor(cdp, `document.querySelectorAll('#view-predictions .tbl tbody tr').length >= 1`, 40, 300);
    sim.uiBeforePredictionsPage = await cdp.evaljs(`(() => {
      const row = [...document.querySelectorAll('#view-predictions .tbl tbody tr')].find(r => r.textContent.includes('M-101'));
      return row ? row.textContent.replace(/\\s+/g, ' ').slice(0, 240) : null;
    })()`);

    await go(cdp, 'simulation');
    await waitFor(cdp, `document.querySelector('#view-simulation select')`, 40, 300);
    const form = await cdp.evaljs(`(() => {
      const sels = [...document.querySelectorAll('#view-simulation select')];
      const mSel = sels[0]; const scSel = sels[1];
      const sev = document.querySelector('#view-simulation input[type=range]');
      const name = [...document.querySelectorAll('#view-simulation input')].find(i => i.type === 'text' || i.placeholder === 'optional name');
      const optM101 = mSel ? [...mSel.options].find(o => o.value === 'M-101') : null;
      if (optM101) mSel.value = 'M-101'; else if (mSel) mSel.selectedIndex = 0;
      const sevBefore = sev.value;
      sev.value = '0.9';
      sev.dispatchEvent(new Event('input', { bubbles: true }));
      if (name) { name.value = 'release-verify'; }
      const btn = [...document.querySelectorAll('#view-simulation button')].find(b => b.textContent.trim() === 'Run scenario');
      if (!btn) return 'no-run-btn';
      btn.click();
      return { machine: mSel.value, scenario: scSel.value, sevBefore, btnDisabled: btn.disabled };
    })()`);
    sim.form = form;

    await waitFor(cdp, `document.getElementById('view-simulation').textContent.includes('Scenario queued') || document.getElementById('view-simulation').textContent.includes('Failed')`, 40, 400).catch(() => {});
    await sleep(2000);
    sim.afterRunMsg = await cdp.evaljs(`(() => { const m = [...document.querySelectorAll('#view-simulation .muted.small')].map(e => e.textContent).find(t => /Scenario queued|Failed/.test(t)); return m || '?'; })()`);
    sim.bannerAfterRun = await cdp.evaljs(`(document.getElementById('simBanner')||{}).textContent || null`);
    sim.bannerVisibleAfterRun = await cdp.evaljs(`!(document.getElementById('simBanner')||{}).classList.contains('hidden')`);
    sim.runScreenshot = await shot(cdp, 'g_sim_run_1366');

    /* live weather: apply DEGRADATION control to M-101 (what the queued scenario maps to) */
    const control = await nodePost('/api/v1/simulation/control', { machineId: 'M-101', scenario: 'DEGRADATION', severity: 0.9 });
    sim.controlApplied = { status: control.status, body: control.body };
    log('control applied: ' + JSON.stringify(control.body));

    /* observe ~5 ticks @5s GT */
    log('observing scenario effect 45s...');
    await sleep(45000);

    sim.mid = {
      simOverlay: await cdp.evaljs(`(document.getElementById('simBanner')||{}).textContent`),
      simBannerVisible: await cdp.evaljs(`!(document.getElementById('simBanner')||{}).classList.contains('hidden')`),
      controlStates: await nodeApi('/api/v1/simulation/control'),
    };

    /* prediction change via API + UI */
    const mid = await nodeApi('/api/v1/machines/M-101/predictions');
    sim.midPredictions = { status: mid.status, count: (mid.body || []).length, latest: (mid.body || [])[0] || null };
    const midM = await nodeApi('/api/v1/machines');
    sim.midMachines = (midM.body || []).find(m => m.machineId === 'M-101') || null;
    const midExpl = await nodeApi('/api/v1/machines/M-101/explanation');
    sim.midExplanation = midExpl.body;

    await go(cdp, 'predictions');
    await waitFor(cdp, `document.querySelectorAll('#view-predictions .tbl tbody tr').length >= 1`, 40, 300);
    sim.uiMidPredictionsRow = await cdp.evaljs(`(() => {
      const row = [...(document.querySelectorAll('#view-predictions .tbl tbody tr') || [])].find(r => r.textContent.includes('M-101'));
      return row ? row.textContent.replace(/\\s+/g, ' ').slice(0, 240) : null;
    })()`);
    if (sim.uiMidPredictionsRow) {
      await cdp.evaljs(`(() => { const row = [...document.querySelectorAll('#view-predictions .tbl tbody tr')].find(r => r.textContent.includes('M-101')); if (row) row.click(); })()`).catch(() => {});
      await waitFor(cdp, `document.getElementById('inspector') && document.getElementById('inspBody').textContent.includes('Latest prediction')`, 50, 300).catch(() => {});
      sim.uiMidPredictionTab = (await cdp.evaljs(`document.getElementById('inspBody').textContent`)).slice(0, 1600);
      sim.uiMidScreenshot = await shot(cdp, 'g_mid_prediction_1366');
    }

    /* reset feed */
    await go(cdp, 'simulation');
    await waitFor(cdp, `document.querySelector('#view-simulation button')`, 30, 300);
    const reset = await cdp.evaljs(`(() => { const b = [...document.querySelectorAll('#view-simulation button')].find(x => x.textContent.trim() === 'Reset feed'); if (!b) return 'no-btn'; if (b.disabled) return 'disabled'; b.click(); return 'clicked'; })()`);
    sim.reset = reset;
    await sleep(2500);
    sim.afterResetControl = await nodeApi('/api/v1/simulation/control');
    await sleep(25000);
    const after = await nodeApi('/api/v1/machines/M-101/predictions');
    sim.afterPredictions = { status: after.status, count: (after.body || []).length, latest: (after.body || [])[0] || null };
    const afterM = await nodeApi('/api/v1/machines');
    sim.afterMachines = (afterM.body || []).find(m => m.machineId === 'M-101') || null;
    sim.recoveryScreenshot = await shot(cdp, 'g_after_reset_1366');
  } catch (e) { sim.error = e.message; log('PART G FAIL ' + e.message); }
  results.phases.simulation = sim;

  /* ============ PART H — RESPONSIVE SWEEP ============ */
  log('--- PART H responsive');
  const resp = {};
  try {
    await go(cdp, 'command');
    for (const v of VIEWPORTS) {
      await vp(v.w, v.h);
      const rec = { vp: v.name };
      for (const route of ['command', 'factory', 'predictions', 'fleet']) {
        try {
          await cdp.evaljs(`location.hash = '#/${route}'`);
          await waitFor(cdp, `document.getElementById('view-${route}').classList.contains('active')`, 30, 250);
          await sleep(1800);
          const p = await probe(cdp);
          const tb = await cdp.evaljs(`(() => { const t = document.querySelector('.topbar'); return t ? { sw: t.scrollWidth, cw: t.clientWidth } : null; })()`);
          const insp = await cdp.evaljs(`(() => { const i = document.getElementById('inspector'); if (!i || i.classList.contains('collapsed')) return null; const r = i.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), pos: getComputedStyle(i).position, w: Math.round(r.width) }; })()`);
          rec[route] = { hscroll: p.hscroll, docSW: p.docSW, vw: p.vw, topbar: tb, insp, bad: p.bad, title: p.titles[0] || '' };
        } catch (e) { rec[route] = { error: e.message }; }
      }
      rec.shot = await shot(cdp, 'h_' + v.name);
      resp[v.name] = rec;
      log('resp ' + v.name + ' done');
    }
  } catch (e) { resp.error = e.message; }
  results.phases.responsive = resp;

  /* ============ FINAL REPORT ============ */
  const unexpectedConsole = results.console;
  const failed = results.failedRequests;

  /* summary */
  const F = (route) => {
    const r = results.phases.routeSweep.routes[route];
    return r && r.active ? 'PASS' : 'BLOCKED';
  };

  const summary = {
    routes: Object.fromEntries(ROUTES.map(r => [r, F(r)])),
    login: routeSweep.login || 'FAIL',
    engineFull: !!results.phases.engineerControl.steps && results.phases.engineerControl.steps.normal && !results.phases.engineerControl.error ? 'PASS' : 'BLOCKED',
    m101Predictions: Object.fromEntries(Object.entries(results.phases.predictions || {}).filter(([k]) => !['ui','explanation','tableRows'].includes(k))),
    unexpectedConsole: results.console.length,
    failedRequests: results.failedRequests.length,
  };

  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ summary, phases: results.phases, evidence: results.evidence, console: results.console, failedRequests: results.failedRequests, capturedKeys: Object.keys(results.captured).length }, null, 1));

  log('--- FINAL ---');
  log(JSON.stringify({ routePass: ROUTES.filter(r => F(r) === 'PASS').length + '/' + ROUTES.length, consoleErrors: results.console.length, failedRequests: results.failedRequests.length }, null, 1));
  log('report written to ' + join(OUT, 'report.json'));
  process.exit(0);
}

main().catch(e => { log('FATAL ' + (e.stack || e.message)); process.exit(1); });