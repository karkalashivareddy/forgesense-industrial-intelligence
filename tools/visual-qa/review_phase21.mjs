/* ForgeSense Phase 21 visual review — programmatic substitute for human screenshot
 * inspection (this environment's model cannot interpret rendered images).
 *
 * Two independent passes:
 *   A) PIXEL: decodes the five _qa/final_<n>_<vp>.png screenshots (pure node:zlib PNG
 *      decoder + scanline unfilter) and measures colour composition:
 *        - copper/orange dominance      (must be ~absent: brand warm tone only in chips/pills)
 *        - factory-scene coverage       (twin should fill ~70-85% of the scene region, no void)
 *        - void ratio                   (near-background pixels inside the scene region)
 *        - brand-blue accent share      (accent, not dominant)
 *   B) DOM:   boots a fresh CDP browser through the login overlay and, at each of the five
 *      viewports, audits the live DOM for the visual-identity criteria:
 *        - pill density, sentence-case (no text-transform uppercase) micro labels
 *        - glass surface composition (opacity / rgba, restrained)
 *        - topbar/statusbar density (element + text counts)
 *        - factory scene coverage of viewport (canvas rect), dependency mesh hidden by default
 *        - inspector density after selecting a machine (mild nesting, no horizontal overflow)
 *        - no horizontal scroll at any viewport
 *
 * Output: <repo>/_qa/review.txt + console table. Fails non-zero only for hard violations.
 *
 * Configuration: same env as qa_final.mjs (BASE_URL / QA_PASS / QA_USER / QA_OUTPUT_DIR /
 * QA_CDP_PORT_REVIEW / QA_MIRROR_PORT).
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

if (typeof WebSocket === 'undefined') { console.error('need Node >= 22 (global WebSocket)'); process.exit(2); }

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.env.QA_OUTPUT_DIR || join(ROOT, '_qa');
const APP = process.env.BASE_URL || 'http://localhost:5173';
const PORT = Number(process.env.QA_CDP_PORT || 9351);
const MIRROR_PORT = Number(process.env.QA_MIRROR_PORT || 9456);
const USER = process.env.QA_USER || 'operator';
const PASSWD = process.env.QA_PASS || '';
const LOG = join(OUT, 'review.txt');
const MIRROR = join(OUT, '.mirror');
const PROFILE = join(tmpdir(), 'forgesense-review-' + Date.now());
const PNG = join(OUT, 'final');

const VIEWPORTS = [
  { w: 375, h: 812, mobile: true, name: '375' },
  { w: 768, h: 1024, mobile: false, name: '768' },
  { w: 1024, h: 768, mobile: false, name: '1024' },
  { w: 1440, h: 900, mobile: false, name: '1440' },
  { w: 1920, h: 1080, mobile: false, name: '1920' },
];

const log = (s) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${s}`; console.log(line); appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------------- Part A: PNG decode + pixel metrics ---------------- */

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePNG(buf) {
  let pos = 8; let ihdr = null; const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), bit: data[8], ct: data[9] };
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  if (!ihdr || ihdr.bit !== 8 || (ihdr.ct !== 6 && ihdr.ct !== 2)) throw new Error('unsupported PNG ' + JSON.stringify(ihdr));
  const { w, h } = ihdr; const ch = ihdr.ct === 6 ? 4 : 3;
  const stride = w * ch;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(w * h * ch);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; if (f > 4) throw new Error('bad filter ' + f);
    for (let x = 0; x < stride; x++) {
      const src = y * (stride + 1) + 1 + x;
      const dst = y * stride + x;
      const a = x >= ch ? px[dst - ch] : 0;
      const b = y ? px[dst - stride] : 0;
      const c = y && x >= ch ? px[dst - stride - ch] : 0;
      let v = raw[src];
      switch (f) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: v += paeth(a, b, c); break;
      }
      px[dst] = v & 0xff;
    }
  }
  return { w, h, ch, px };
}

function pixelAnalysis(img) {
  const { w, h, ch, px } = img;
  let bg = 0, copper = 0, blue = 0, scene = 0, sceneBg = 0, total = 0;
  const y0 = Math.floor(h * 0.22), y1 = Math.floor(h * 0.85);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const isBg = r < 24 && g < 28 && b < 40;
      const isCopper = r > 150 && g < r - 45 && b < r - 110 && g > 60;
      const isBlue = b > 150 && b > r + 70 && b > g + 40;
      total++;
      if (isBg) bg++;
      if (isCopper) copper++;
      if (isBlue) blue++;
      if (y >= y0 && y <= y1) {
        if (isBg) sceneBg++; else scene++;
      }
    }
  }
  const sceneRegion = (y1 - y0 + 1) * w;
  return {
    w, h,
    copper: copper / total,
    copperStrongPx: copper,
    blueAccent: blue / total,
    sceneCoverage: (scene + sceneBg) > 0 ? scene / sceneRegion : 0,
    voidRatio: sceneRegion > 0 ? sceneBg / sceneRegion : 1,
  };
}

function runPixelPass() {
  log('--- Part A: pixel review of the 5 screenshots ---');
  const rows = [];
  for (const vp of VIEWPORTS) {
    const file = join(OUT, `final_${VIEWPORTS.indexOf(vp) + 1}_${vp.name}.png`);
    if (!existsSync(file)) { log(`  ${vp.name}: MISSING ${file}`); rows.push({ vp: vp.name, missing: true }); continue; }
    const img = decodePNG(readFileSync(file));
    const m = pixelAnalysis(img);
    rows.push({ vp: vp.name, ...m });
    log(`  ${vp.name} (${img.w}x${img.h}) copper=${(m.copper * 100).toFixed(2)}% blue=${(m.blueAccent * 100).toFixed(2)}% sceneCoverage=${(m.sceneCoverage * 100).toFixed(1)}% void=${(m.voidRatio * 100).toFixed(1)}%`);
  }
  const hard = rows.filter(r => !r.missing && (r.copper > 0.05 || r.sceneCoverage < 0.45 || r.sceneCoverage > 0.95));
  if (hard.length) log('PIXEL HARD VIOLATION: ' + JSON.stringify(hard));
  return hard;
}

/* ---------------- Part B: live DOM audit via CDP ---------------- */

function resolveBrowser() {
  if (process.env.QA_BROWSER) return process.env.QA_BROWSER;
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:/Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
    const cands = [
      join(pf, 'Google/Chrome/Application/chrome.exe'), join(pf86, 'Google/Chrome/Application/chrome.exe'),
      join(pf, 'Microsoft/Edge/Application/msedge.exe'), join(pf86, 'Microsoft/Edge/Application/msedge.exe'),
    ];
    for (const c of cands) try { if (existsSync(c)) return c; } catch {}
  }
  return null;
}

async function waitJson(url, tries, ms = 250) {
  for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {} await sleep(ms); }
  throw new Error('unreachable ' + url);
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  open() {
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result || {}); }
      else if (m.method) this.events.push(m);
    });
    return new Promise((res, rej) => { this.ws.addEventListener('open', res); this.ws.addEventListener('error', rej); });
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
  async evaljs(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('evaljs: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result ? r.result.value : undefined; }
}

function startMirror() {
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

const AUDIT_CLIENT = `(function audit() {
  const vis = (el) => { if (!el) return false; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const pills = [...document.querySelectorAll('.pill')].filter(vis).map(p => p.textContent.trim());
  const smoothUpper = [...document.querySelectorAll('span,div,b,button,li')].filter(vis)
    .map(e => e.childNodes.length === 1 && e.firstChild.nodeType === 3 ? e.textContent : '')
    .filter(t => { const s = t.trim(); return s.length > 0 && s.length <= 12 && /^[0-9A-Z .·:/-]+$/.test(s) && /\D/.test(s) && /[A-Z0-9]/i.test(s.replace(/[·\s.:/-]/g, '')); })
    .filter((v, i, a) => a.indexOf(v) === i);
  const statusbar = document.querySelector('#statusbar, .statusbar');
  const topbar = document.querySelector('#topbar, .topbar');
  const rail = document.querySelector('.rail, #rail');
  const glass = (el) => { if (!el) return null; const s = getComputedStyle(el); return { bg: s.backgroundColor, op: s.opacity, blur: s.backdropFilter || s.filter || '', tr: s.transition }; };
  const canvas = [...document.querySelectorAll('canvas')].find(c => c.getBoundingClientRect().width > 200 && vis(c));
  const cnvRect = canvas ? canvas.getBoundingClientRect() : null;
  const scene = (window.forgesense && window.forgesense.scene) || document.getElementById('scene3d') || null;
  const layerBtn = [...document.querySelectorAll('[data-layer], .layer-toggle, .chk')].filter(vis).map(b => (b.textContent || '').trim());
  const twinAssets = document.querySelectorAll('.twin-asset').length;
  const depsEdges = document.querySelectorAll('.twin-dep, .dep-edge, [class*="dependency"] canvas, [data-dep]').length;
  const uppers = [...document.querySelectorAll('.pill .label, .pill span, .tag, .meter .label, .kv b')].filter(vis)
    .map(e => e.textContent.trim()).filter(t => t && t.length <= 10 && t === t.toUpperCase() && /[A-Z]/.test(t));
  return {
    vw: innerWidth, vh: innerHeight,
    hScroll: document.documentElement.scrollWidth > innerWidth,
    pills, smoothUpper: smoothUpper.slice(0, 24), uppers: [...new Set(uppers)].slice(0, 24),
    statusText: statusbar ? (statusbar.textContent || '').trim().slice(0, 200) : null,
    statusCells: statusbar ? statusbar.querySelectorAll('span, b, .cell, [id^="svc"]').length : 0,
    statusLen: statusbar ? (statusbar.textContent || '').length : 0,
    topbarPills: topbar ? topbar.querySelectorAll('.pill').length : 0,
    railBtnCount: rail ? rail.querySelectorAll('.rail-btn, button').length : 0,
    railOpen: rail ? (rail.classList.contains('open') || rail.classList.contains('expanded')) : null,
    envGlass: glass(topbar), statusGlass: glass(statusbar), railGlass: glass(rail),
    canvasCoverage: cnvRect ? (cnvRect.width * cnvRect.height) / (innerWidth * innerHeight) : 0,
    canvasRect: cnvRect ? { w: Math.round(cnvRect.width), h: Math.round(cnvRect.height) } : null,
    twinAssets, depsEdges, layerBtns: layerBtn,
    chips: document.querySelectorAll('#zoneChips .chip').length,
  };
})`;

const OVERFLOW = `(function() {
  const ip = document.getElementById('inspector');
  const o = [];
  if (ip) for (const e of ip.querySelectorAll('*')) {
    const cs = getComputedStyle(e);
    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
    if (e.scrollWidth > e.clientWidth + 2) o.push({ tag: e.tagName, cls: (e.className || '').toString().slice(0, 40), sw: e.scrollWidth, cw: e.clientWidth, t: (e.textContent || '').trim().slice(0, 30) });
  }
  return o.slice(0, 20);
})()`;

async function loginAndBoot(cdp) {
  for (let k = 0; k < 3; k++) {
    await cdp.send('Runtime.evaluate', { expression: `(() => document.querySelectorAll('body > div').length > 3 ? 'x' : 'y')()`, returnByValue: true });
    const geo = await cdp.evaljs(`(() => { const o = document.querySelector('.login-overlay, #login, [class*="login"]'); if (!o) return null; const r = o.getBoundingClientRect(); return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; })()`);
    if (geo) return { geo };
    await sleep(400);
  }
  return null;
}

async function runDomPass() {
  log('--- Part B: live DOM audit at five viewports ---');
  if (!PASSWD) { log('  SKIP: QA_PASS not set'); return { skipped: true }; }
  const browser = resolveBrowser();
  if (!browser) { log('  SKIP: no browser'); return { skipped: true }; }
  const srv = startMirror();
  const chrome = spawn(browser, ['--headless=new', '--no-first-run', '--disable-default-apps', '--disable-extensions',
    '--disable-background-networking', '--enable-unsafe-swiftshader', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill(); srv.close(); } catch {} };
  const rows = [];
  try {
    const version = await waitJson(`http://127.0.0.1:${PORT}/json/version`, 60);
    log('  CDP ' + (version.Browser || '?'));
    await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).catch(() => {});
    await sleep(700);
    const list = await waitJson(`http://127.0.0.1:${PORT}/json/list`, 20);
    const cdp = new CDP(new WebSocket(list[0].webSocketDebuggerUrl));
    await cdp.open();
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
    await cdp.send('Fetch.enable', { patterns: Object.entries({
      '*cdn.jsdelivr.net*': '/three.module.js', '*fonts.googleapis.com*': '/ph-regular.css',
      '*fonts.gstatic.com*': '/Phosphor.woff2',
    }).map(([k]) => ({ urlPattern: k })) });
    cdp.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method !== 'Fetch.requestPaused' || !m.params) return;
      const u = m.params.request.url || ''; const rid = m.params.requestId;
      let local = null;
      if (u.includes('three@0.169.0/build/three.module.js')) local = '/three.module.js';
      else if (u.includes('OrbitControls.js')) local = '/OrbitControls.js';
      else if (u.includes('@phosphor-icons') && u.includes('style.css')) local = '/ph-regular.css';
      else if (u.includes('@phosphor-icons') && u.includes('.woff2')) local = '/Phosphor.woff2';
      cdp.send('Fetch.continueRequest', { requestId: rid, ...(local ? { url: 'http://127.0.0.1:' + MIRROR_PORT + local } : {}) }).catch(() => {});
    });

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: APP + '/#/factory' });
    for (let i = 0; i < 60; i++) { try { if ((await cdp.evaljs('document.readyState')) === 'complete') break; } catch {} await sleep(250); }

    let loginGeo = null;
    for (let k = 0; k < 3 && !loginGeo; k++) {
      loginGeo = await cdp.evaljs(`(() => { const o = document.querySelector('.login-overlay, #login, [class*="login"]'); if (!o) return null; const r = o.getBoundingClientRect(); return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; })()`);
      if (!loginGeo) await sleep(400);
    }

    const booted = async () => cdp.evaljs(`(() => { if (document.getElementById('loginUser')) return false; const cv = [...document.querySelectorAll('canvas')].filter(c => { const r = c.getBoundingClientRect(); return r.width > 200; }).length; const chips = document.querySelectorAll('#zoneChips .chip').length; return cv > 0 && chips >= 6; })()`);
    const doLogin = async () => cdp.evaljs(`(() => { const u = document.getElementById('loginUser'); const p = document.querySelector('input[type=password]'); const b = [...document.querySelectorAll('button')].find(x => /^Connect$/.test(x.textContent.trim())); if (!u || !p || !b) return 'no-form'; u.value = ${JSON.stringify(USER)}; p.value = ${JSON.stringify(PASSWD)}; b.click(); return 'clicked'; })()`);
    const bootOnce = async (tag) => {
      for (let attempt = 1; attempt <= 4; attempt++) {
        await sleep(250);
        const gone = await cdp.evaljs(`(() => !document.getElementById('loginUser'))()`);
        if (gone) {
          for (let k = 0; k < 60; k++) { if (await booted()) return true; await sleep(250); }
        } else {
          await doLogin();
        }
      }
      const dbg = await cdp.evaljs(`(() => ({ login: !!document.getElementById('loginUser'), canvas: document.querySelectorAll('canvas').length, chips: document.querySelectorAll('#zoneChips .chip').length, active: (document.querySelector('.view.active') || {}).id }))()`);
      log(`  [${tag}] boot FAILED after retries: ${JSON.stringify(dbg)}`);
      return false;
    };

    await bootOnce('init');

    for (const vp of VIEWPORTS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.mobile ? 2 : 1, mobile: vp.mobile });
      await cdp.send('Page.navigate', { url: APP + '/#/factory' });
      for (let i = 0; i < 60; i++) { try { if ((await cdp.evaljs('document.readyState')) === 'complete') break; } catch {} await sleep(250); }
      await sleep(600);
      await bootOnce(vp.name);
      await sleep(2600);
      let a;
      try { a = await cdp.evaljs('(' + AUDIT_CLIENT + ')()'); }
      catch (e) { log('  [' + vp.name + '] audit error: ' + e.message); }
      if (!a) continue;
      const sel = await cdp.evaljs(`(() => { const t = document.querySelector('.twin-asset'); if (!t) return 'no-asset'; t.click(); return 'clicked'; })()`);
      await sleep(1100);
      const insp = await cdp.evaljs(`(() => { const ip = document.getElementById('inspector'); if (!ip) return null; const r = ip.getBoundingClientRect(); const overflow = [...ip.querySelectorAll('*')].some(e => { const cs = getComputedStyle(e); return cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && e.scrollWidth > e.clientWidth + 1; }); return { w: Math.round(r.width), blocks: ip.querySelectorAll(':scope > *').length, cards: ip.querySelectorAll('.card').length, meters: ip.querySelectorAll('.meter').length, overflow, textLen: ip.textContent.length }; })()`);
      rows.push({ vp: vp.name, a, insp });
      const s = a; 
      const of = await cdp.evaljs(OVERFLOW).catch(() => []);
      log(`  [${vp.name}] hScroll=${a.hScroll} pills=${a.pills.length} topbarPills=${a.topbarPills} statusLen=${a.statusLen} statusCells=${a.statusCells} railBtns=${a.railBtnCount} upperLabels=${a.uppers.length} canvasCover=${(a.canvasCoverage * 100).toFixed(0)}% deps=${a.depsEdges} chips=${a.chips} layers=[${a.layerBtns.join(',')}] glass.topbar=[${JSON.stringify(a.envGlass)}] overflow=${of.length ? JSON.stringify(of) : 'none'}`);
      if (s.uppers.length) log(`    uppercase micro-labels: ${s.uppers.join(' | ')}`);
      if (s.smoothUpper.length) log(`    smooth uppercase text: ${s.smoothUpper.join(' | ')}`);
    }
    if (loginGeo) log(`  login overlay covers ${loginGeo.w}x${loginGeo.h} of ${loginGeo.vw}x${loginGeo.vh} → ${(loginGeo.w / loginGeo.vw * 100).toFixed(0)}% x ${(loginGeo.h / loginGeo.vh * 100).toFixed(0)}%`);
    const violations = rows.filter(r => r.a.hScroll || r.a.uppers.length > 8 || r.a.canvasCoverage < 0.45 || r.a.canvasCoverage > 0.92 || (r.insp && r.insp.overflow));
    if (violations.length) log('DOM VIOLATION: ' + JSON.stringify(violations.map(v => v.vp)));
    log('  DOM review complete.');
    return { rows, loginGeo, violations };
  } finally { cleanup(); }
}

/* ---------------- main ---------------- */

rmSync(LOG, { force: true });
try {
  const pixel = runPixelPass();
  const dom = await runDomPass();
  const summary = {
    pixelPass: pixel.length === 0,
    pixelRows: pixel,
    domRows: dom.rows ? dom.rows.map(r => ({ vp: r.vp, hScroll: r.a.hScroll, pills: r.a.pills.length, statusCells: r.a.statusCells, uppers: r.a.uppers.length, canvasCoverage: +r.a.canvasCoverage.toFixed(3), depsEdges: r.a.depsEdges, chips: r.a.chips, inspectorOverflow: r.insp ? r.insp.overflow : null })) : null,
    loginGeo: dom.loginGeo,
    domViolations: dom.violations ? dom.violations.length : null,
    env: { node: process.version, date: new Date().toISOString() },
  };
  writeFileSync(join(OUT, 'review-summary.json'), JSON.stringify(summary, null, 1));
  log(JSON.stringify(summary));
  process.exit(dom.skipped ? 0 : (pixel.length === 0 && dom.violations.length === 0 ? 0 : 1));
} catch (e) {
  log('FATAL ' + (e.stack || e.message));
  process.exit(1);
}