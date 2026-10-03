const { chromium } = require('@playwright/test');

const ROUTES = [
  ['/command', 'Command Center'],
  ['/fleet', 'Fleet'],
  ['/telemetry', 'Telemetry'],
  ['/predictions', 'Predictions'],
  ['/anomalies', 'Anomalies'],
  ['/analytics', 'Analytics'],
  ['/alerts', 'Alerts'],
  ['/maintenance', 'Maintenance'],
  ['/simulation', 'Simulation Lab'],
  ['/events', 'Event Stream'],
  ['/twin', 'Factory Twin'],
  ['/system', 'System'],
];

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const netfail = [];
  p.on('pageerror', (e) => errors.push(`${p.url().split('/').pop()}: ${String(e).slice(0, 120)}`));
  p.on('response', (r) => {
    if (r.status() >= 400) netfail.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 90)}`);
  });

  await p.goto('http://127.0.0.1:4180/command');
  await p.getByLabel('Role').selectOption('admin');
  await p.getByLabel('Password').fill('forgesense-dev');
  await p.getByRole('button', { name: /sign in/i }).click();
  await p.getByRole('navigation', { name: 'Operations sections' }).waitFor({ timeout: 30000 });

  const report = [];
  for (const [path, name] of ROUTES) {
    const before = errors.length + netfail.length;
    await p.goto(`http://127.0.0.1:4180${path}`);
    await p.waitForTimeout(2600);
    const h1 = await p.getByRole('heading', { level: 1 }).first().textContent().catch(() => null);
    const overflow = await p.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    const canvases = await p.locator('canvas').count();
    report.push({
      route: path,
      name: (h1 || '').trim(),
      newErrors: errors.length + netfail.length - before,
      overflow,
      canvases,
    });
    await p.screenshot({ path: `../_qa/sweep${path.replace(/\//g, '_')}.png` });
  }

  console.log('route                | h1                     | err | overflow | canvas');
  for (const r of report) {
    console.log(
      `${r.route.padEnd(20)} | ${r.name.slice(0, 23).padEnd(23)} | ${String(r.newErrors).padStart(3)} | ${String(r.overflow).padStart(8)} | ${r.canvases}`,
    );
  }
  console.log('\nTOTAL page errors:', errors.length);
  errors.slice(0, 12).forEach((e) => console.log('  ERR', e));
  console.log('TOTAL network failures:', netfail.length);
  [...new Set(netfail)].slice(0, 12).forEach((e) => console.log('  NET', e));

  await b.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
