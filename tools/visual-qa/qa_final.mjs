/* ForgeSense visual QA driver — reproducible, repository-local.
 *
 * Runs five viewport classes (375/768/1024/1440/1920) against a live stack via CDP,
 * boots the app through the real login overlay, and asserts layout/twin/runtime behavior.
 *
 * Prerequisites
 *   - Node >= 22 (uses the built-in global WebSocket — no dependencies).
 *   - Chrome or Edge (or any Chromium binary) reachable for CDP; SwiftShader software
 *     GL is enabled so headless WebGL works (three.js renderer).
 *   - App + backend live: BASE_URL must be served (e.g. `docker compose up -d` and the
 *     frontend reachable at http://localhost:5173).
 *   - First run downloads the four CDN assets (three, OrbitControls, phosphor css/woff2)
 *     into <QA_OUTPUT_DIR>/.mirror and caches them there.
 *
 * Configuration (all optional, environment variables):
 *   BASE_URL        app URL                         default http://localhost:5173
 *   QA_OUTPUT_DIR   artifacts dir                   default <repo>/_qa
 *   QA_CDP_PORT     CDP debug port                  default 9350
 *   QA_MIRROR_PORT  local mirror port               default 9456
 *   QA_BROWSER      chrome/edge executable          default auto-detect on Windows
 *   QA_USER         login username                  default operator
 *   QA_PASS         login password                  default forgesense-dev (dev seed)
 *   QA_VPS          viewports as JSON               default five sizes below
 *
 * Console error policy:
 *   - EXPECTED / INTENTIONAL: resource blocks produced by THIS harness (Google font hosts
 *     failing with ERR_BLOCKED_BY_CLIENT while fonts are served from the phosphor mirror).
 *   - UNEXPECTED APPLICATION ERROR: any Runtime.exceptionThrown or console error that is
 *     not the harness font block. Any unexpected error fails the run.
 *
 * Output: <QA_OUTPUT_DIR>/qafinal.txt (log) + final_<n>_<vp>.png screenshots.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

if (typeof WebSocket === 'undefined') {
  console.error('This script needs a global WebSocket (Node >= 22).');
  process.exit(2);
}

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.env.QA_OUTPUT_DIR || join(ROOT, '_qa');
const APP = process.env.BASE_URL || 'http://localhost:5173';
const PORT = Number(process.env.QA_CDP_PORT || 9350);
const MIRROR_PORT = Number(process.env.QA_MIRROR_PORT || 9456);
const USER = process.env.QA_USER || 'operator';
const PASSWD = process.env.QA_PASS || 'forgesense-dev';
const LOG = join(OUT, 'qafinal.txt');
const MIRROR = join(OUT, '.mirror');
const PROFILE = join(tmpdir(), 'forgesense-qafinal-' + Date.now());

const VIEWPORTS = JSON.parse(process.env.QA_VPS || JSON.stringify([
  { w: 375, h: 812, mobile: true, name: '375' },
  { w: 768, h: 1024, mobile: false, name: '768' },
  { w: 1024, h: 768, mobile: false, name: '1024' },
  { w: 1440, h: 900, mobile: false, name: '1440' },
  { w: 1920, h: 1080, mobile: false, name: '1920' },
]));

const CHROME_ARGS = [
  '--headless=new', '--no-first-run', '--disable-default-apps', '--disable-extensions',
  '--disable-background-networking', '--enable-unsafe-swiftshader',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
];

const log = (s) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${s}`; console.log(line); appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

function checkSecrets(extra = {}) {
  const names = ['QA_USER', 'USERNAME', 'PASSWORD', 'TOKEN', 'SECRET', 'API_KEY'];
  const leaked = Object.keys(process.env).filter(k => names.some(n => k.toUpperCase().includes(n)));
  if (leaked.length) {
    appendFileSync(LOG, `WARNING: only whitelisted creds used; unexpected env keys seen: ${leaked.join(', ')}\n`);
  }
  const out = { user: extra.user || '<not-set>', pass: extra.pass ? '<set>' : '<not-set>' };
  return out;
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

const PROBE = `(() => {
  const bp = (n, child) => {
    if (!n) return null;
    const t = child ? n.querySelector(child) : n;
    return t ? { display: getComputedStyle(t).display, fs: getComputedStyle(t).fontSize, text: t.textContent } : null;
  };
  const tb = document.querySelector('.topbar');
  const insp = document.getElementById('inspector');
  const hud = document.getElementById('factoryHud');
  const ir = insp ? insp.getBoundingClientRect() : null;
  const hr = hud ? hud.getBoundingClientRect() : null;
  const cv = document.querySelector('#sceneContainer canvas');
  const active = document.querySelector('.view.active');
  const pills = [...document.querySelectorAll('.topbar-status .pill')].map(p => {
    const r = p.getBoundingClientRect();
    return { cls: p.className, vis: getComputedStyle(p).display, right: Math.round(r.right) };
  });
  const chips = [...document.querySelectorAll('#zoneChips .chip')].map(c => c.textContent.trim());
  const rail = document.querySelector('.rail');
  const rr = rail ? rail.getBoundingClientRect() : null;
  return {
    url: location.hash,
    vw: innerWidth, vh: innerHeight,
    docSW: document.documentElement.scrollWidth,
    bodySW: document.body.scrollWidth,
    hScroll: document.documentElement.scrollWidth > innerWidth + 1,
    railW: rr ? Math.round(rr.width) : 0,
    railPos: rr ? getComputedStyle(rail).position : null,
    railLabels: [...document.querySelectorAll('.rail-btn .label')].map(n => ({ text: n.textContent, fs: getComputedStyle(n).fontSize, display: getComputedStyle(n).display })),
    topbarOverflow: tb ? tb.scrollWidth - tb.clientWidth : null,
    pills,
    insp: ir && ir.width ? { w: Math.round(ir.width), left: Math.round(ir.left), right: Math.round(ir.right), top: Math.round(ir.top), bottom: Math.round(ir.bottom), pos: getComputedStyle(insp).position, transform: getComputedStyle(insp).transform } : null,
    hud: hr && hr.width ? { left: Math.round(hr.left), right: Math.round(hr.right), top: Math.round(hr.top), bottom: Math.round(hr.bottom) } : null,
    scene: cv ? { cssW: cv.clientWidth, cssH: cv.clientHeight, bufW: cv.width, bufH: cv.height, attachedToSceneContainer: cv.closest('#sceneContainer') === document.getElementById('sceneContainer') } : null,
    basis: (document.getElementById('twinBasis') || {}).textContent || null,
    chips,
    twinAssets: document.querySelectorAll('.twin-asset').length,
    activeView: active ? active.id : null,
    canvasCount: document.querySelectorAll('canvas').length,
    webgl: (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })(),
    navBtn: !!document.querySelector('.rail-btn[data-route="factory"]'),
    statusbarText: (document.querySelector('.statusbar') || {}).textContent || '',
  };
})()`;

async function fetchToFile(url, file) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`GET ${url} -> HTTP ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  writeFileSync(file, b);
  return b.length;
}

function sizeOf(file) {
  try { return statSync(file).size; } catch { return 0; }
}

async function prepareMirror() {
  mkdirSync(MIRROR, { recursive: true });
  // These four URLs are exactly what frontend/index.html + twin3d.js request via the import map.
  const jobs = [
    ['https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js', join(MIRROR, 'three.module.js')],
    ['https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/controls/OrbitControls.js', join(MIRROR, 'OrbitControls.js')],
    ['https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.2/src/regular/style.css', join(MIRROR, 'ph-regular.css')],
    ['https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.2/src/regular/Phosphor.woff2', join(MIRROR, 'Phosphor.woff2')],
  ];
  for (const [url, file] of jobs) {
    if (sizeOf(file) > 0) { log('mirror cache hit ' + file); continue; }
    const n = await fetchToFile(url, file);
    log('mirror fetched ' + n + ' bytes -> ' + file);
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
      res.end('not found: ' + p);
    }
  });
  srv.listen(MIRROR_PORT, '127.0.0.1');
  return srv;
}

const EXPECTED_CONSOLE_MARKERS = ['ERR_BLOCKED_BY_CLIENT'];

function isExpectedConsoleEntry(method, params) {
  const text =
    method === 'Runtime.exceptionThrown' ? (params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || '')
    : method === 'Log.entryAdded' ? (params.entry?.text || '')
    : '';
  return EXPECTED_CONSOLE_MARKERS.some(m => text.includes(m));
}

async function bootAndVerify(cdp) {
  for (const attempt of [1, 2, 3]) {
    let foundAt = -1;
    const tF = Date.now();
    for (let i = 0; i < 160; i++) {
      try { if (await cdp.evaljs('!!document.getElementById("loginUser")')) { foundAt = i; break; } } catch {}
      await sleep(250);
    }
    if (foundAt < 0) {
      const dbg = await cdp.evaljs(`(() => ({
        ready: document.readyState,
        appScripts: document.querySelectorAll('script').length,
        canvases: document.querySelectorAll('canvas').length,
        active: (document.querySelector('.view.active') || {}).id || null,
        chips: document.querySelectorAll('#zoneChips .chip').length,
        basis: (document.getElementById('twinBasis') || {}).textContent || '',
      }))()`).catch(() => null);
      if (dbg && dbg.active === 'view-factory' && dbg.canvases > 0 && dbg.basis !== 'SYNCING…' && dbg.chips > 0) {
        log('bootAndVerify: already booted (no overlay present) — treating as success');
        return true;
      }
      log(`bootAndVerify: overlay never appeared in ${((Date.now() - tF) / 1000).toFixed(1)}s — ` + JSON.stringify(dbg));
      return false;
    }
    const got = await cdp.evaljs(`(() => {
      const u = document.getElementById('loginUser');
      const pw = document.querySelector('input[type=password]');
      if (!u || !pw) return 'missing-fields';
      u.value = ${JSON.stringify(USER)};
      pw.value = ${JSON.stringify(PASSWD)};
      const btn = [...document.querySelectorAll('button')].find(b => /^Connect$/.test(b.textContent.trim()));
      if (!btn) return 'missing-button';
      btn.click();
      return 'clicked';
    })()`);
    log(`bootAndVerify attempt ${attempt}: overlay at ${(foundAt * 0.25).toFixed(1)}s, submit=${got}`);
    if (got !== 'clicked') return false;
    for (let j = 0; j < 80; j++) {
      try {
        const ok = await cdp.evaljs(`(() => {
          const pw = document.querySelector('input[type=password]');
          const border = pw ? pw.style.borderColor : null;
          if (border) return 'LOGIN-FAILED';
          if (!document.getElementById('loginUser')) {
            const cv = document.querySelectorAll('canvas').length;
            const chips = document.querySelectorAll('#zoneChips .chip').length;
            const basis = (document.getElementById('twinBasis') || {}).textContent || '';
            const active = (document.querySelector('.view.active') || {}).id || null;
            // Twin mounted on FIRST activation after a fresh load = the forge:ensure3d
            // listener was already registered before the router activated factory.
            if (active === 'view-factory' && cv > 0 && basis !== 'SYNCING…' && chips > 0) return 'BOOTED';
            return 'booting:' + active + ',cv=' + cv + ',chips=' + chips + ',basis=' + basis;
          }
          return 'overlay-still';
        })()`);
        if (ok === 'BOOTED') { log('bootAndVerify attempt ' + attempt + ': BOOTED'); return true; }
        if (ok === 'LOGIN-FAILED') { log('bootAndVerify attempt ' + attempt + ': login failed (red border), retrying'); break; }
        if (j % 40 === 0) log('bootAndVerify attempt ' + attempt + '@' + (j * 0.25).toFixed(1) + 's: ' + ok);
      } catch {}
      await sleep(250);
    }
    log('bootAndVerify attempt ' + attempt + ': not booted, retrying');
  }
  log('bootAndVerify: failed after 3 attempts');
  return false;
}

async function selectMachineAndCheck(cdp) {
  const sel = await cdp.evaljs(`(() => {
    const t = document.querySelector('.twin-asset');
    if (!t) return 'no-twin-asset';
    t.click();
    return 'clicked';
  })()`);
  await sleep(900);
  const insp = await cdp.evaljs(`(() => {
    const ip = document.getElementById('inspector');
    const head = (ip.querySelector('.insp-head, .insp-name, h3') || {}).textContent || '';
    const hasMeter = !!ip.querySelector('.meter');
    const hasMachine = /M-|LATHE|MILL|CNC|PRESS|WELD|ASSEMBLY|CONVEYOR|PUMP|COMPRESSOR|FURNACE|CART|ROBOT|DRYER|COATER/.test((ip.textContent || '').slice(0, 400));
    return { head: head.trim().slice(0, 60), hasMeter, hasMachine, len: (ip.textContent || '').length };
  })()`);
  return { sel, insp };
}

async function runViewport(cdp, vp, step, results) {
  const mark = { vp: vp.name };
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.mobile ? 2 : 1, mobile: vp.mobile });
    await cdp.send('Page.navigate', { url: APP + '/#/factory' });
    for (let i = 0; i < 60; i++) {
      try { if ((await cdp.evaljs('document.readyState')) === 'complete') break; } catch {}
      await sleep(250);
    }
    const ok = await bootAndVerify(cdp);
    if (!ok) { mark.checks = { boot: false, reason: 'boot failed' }; log(`[${vp.name}] FAIL boot`); results.push(mark); return; }
    await sleep(3500);
    const a = await cdp.evaljs(PROBE);
    const sel = await selectMachineAndCheck(cdp);
    await sleep(600);
    const post = await cdp.evaljs(PROBE);

    const checks = {
      boot: a.activeView === 'view-factory'
        && a.canvasCount > 0
        && a.twinAssets === 18
        && a.basis && a.basis.includes('LIVE')
        && a.basis.includes('STOMP'),
      layout: !a.hScroll
        && a.railW > 0
        && !!a.navBtn
        && a.railLabels.every(l => parseFloat(l.fs) >= 12 && l.display !== 'none')
        && !!a.insp,
      twin: a.scene && a.scene.attachedToSceneContainer && a.scene.cssW > 0 && a.scene.cssH > 0
        && a.twinAssets === 18
        && sel.sel === 'clicked'
        && sel.insp.hasMachine && sel.insp.hasMeter
        && a.chips.length === 6,
      runtime: a.basis.includes('STOMP')
        && /stomp/i.test(a.statusbarText || '')
        && a.pills.some(p => /ml/i.test(p.cls)),
    };

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = join(OUT, `final_${step}_${vp.name}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));

    mark.checks = checks;
    mark.probe = a; mark.select = sel; mark.probePost = post; mark.file = file;
    const all = Object.entries(checks).every(([, v]) => v);
    log(`[${vp.name}] ${all ? 'PASS' : 'FAIL'} boot=${checks.boot} layout=${checks.layout} twin=${checks.twin} runtime=${checks.runtime} hScroll=${a.hScroll} rail=${a.railW} twin=${a.scene ? a.scene.cssW + 'x' + a.scene.cssH : 'NONE'} basis=${a.basis} assets=${a.twinAssets} chips=${a.chips.length} select=${sel.sel}/${sel.insp.hasMachine ? 'insp' : 'noinsp'}`);
  } catch (e) {
    mark.checks = { boot: false, reason: e.message };
    log(`[${vp.name}] FAIL ${e.stack || e.message}`);
  }
  results.push(mark);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  rmSync(LOG, { force: true });

  const cred = checkSecrets({ user: USER });
  log('username=' + cred.user + ' password=' + cred.pass);

  const browser = resolveBrowser();
  if (!browser) {
    log('FATAL no Chromium browser found; set QA_BROWSER to a chrome.exe/msedge.exe path.');
    process.exit(2);
  }
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

  const redirect = (reqUrl) => {
    if (reqUrl.includes('/three@0.169.0/build/three.module.js')) return `http://127.0.0.1:${MIRROR_PORT}/three.module.js`;
    if (reqUrl.includes('/examples/jsm/controls/OrbitControls.js')) return `http://127.0.0.1:${MIRROR_PORT}/OrbitControls.js`;
    if (reqUrl.includes('/@phosphor-icons/web@2.1.2/src/regular/style.css')) return `http://127.0.0.1:${MIRROR_PORT}/ph-regular.css`;
    if (reqUrl.includes('/@phosphor-icons/web@2.1.2/src/regular/Phosphor.woff2')) return `http://127.0.0.1:${MIRROR_PORT}/Phosphor.woff2`;
    return null;
  };
  let inters = 0; let blockedFonts = 0;
  cdp.ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method !== 'Fetch.requestPaused' || !m.params) return;
    const u = m.params.request.url || '';
    const rid = m.params.requestId;
    inters++;
    if (u.includes('fonts.googleapis.com') || u.includes('fonts.gstatic.com')) {
      blockedFonts++;
      cdp.send('Fetch.failRequest', { requestId: rid, errorReason: 'BlockedByClient' }).catch(() => {});
      return;
    }
    const local = redirect(u);
    const p = local ? { requestId: rid, url: local } : { requestId: rid };
    cdp.send('Fetch.continueRequest', p).catch(() => {});
  });

  const results = [];
  for (let i = 0; i < VIEWPORTS.length; i++) {
    const t0 = Date.now();
    await runViewport(cdp, VIEWPORTS[i], i + 1, results);
    log(`[${VIEWPORTS[i].name}] took ${Math.round((Date.now() - t0) / 1000)}s (intercepts=${inters}, fontsBlocked=${blockedFonts})`);
  }

  const unexpected = [];
  const expectedCount = { blockedByClient: 0 };
  for (const ev of cdp.events) {
    if (ev.method === 'Runtime.exceptionThrown') {
      const text = ev.params.exceptionDetails?.exception?.description || ev.params.exceptionDetails?.text || '';
      if (isExpectedConsoleEntry('Runtime.exceptionThrown', ev.params)) expectedCount.blockedByClient++;
      else unexpected.push('EXC: ' + text);
    }
    if (ev.method === 'Log.entryAdded' && ev.params.entry.level === 'error') {
      const text = ev.params.entry.text || '';
      if (isExpectedConsoleEntry('Log.entryAdded', ev.params)) expectedCount.blockedByClient++;
      else unexpected.push('CONSOLE: ' + text);
    }
  }
  const fails = cdp.events
    .filter(m => m.method === 'Network.loadingFailed')
    .map(e => (e.params.errorText || '') + ' url=' + (e.params.url || '') + ' id=' + e.params.requestId);

  const vpPass = results.filter(r => r.checks && Object.entries(r.checks).every(([, v]) => v === true)).length;
  const allPass = vpPass === VIEWPORTS.length && unexpected.length === 0;

  writeFileSync(join(OUT, 'qafinal.txt'),
    '=== RESULT ===\n' + JSON.stringify(results, null, 1)
    + '\n\n=== UNEXPECTED console/Runtime errors ===\n' + (unexpected.join('\n') || '(none)')
    + '\n\n=== EXPECTED (harness-intentional) console markers ===\n' + JSON.stringify(expectedCount)
    + '\n\n=== Failed resources ===\n' + (fails.join('\n') || '(none)')
    + '\n\n=== SUMMARY ===\n' + JSON.stringify({ viewports: vpPass + '/' + VIEWPORTS.length, unexpectedConsoleErrors: unexpected.length, pass: allPass }));

  log('done. viewports=' + vpPass + '/' + VIEWPORTS.length + ' unexpectedConsole=' + unexpected.length + ' pass=' + allPass);
  process.exit(allPass ? 0 : 1);
}

main().catch(e => { log('FATAL ' + (e.stack || e.message)); process.exit(1); });