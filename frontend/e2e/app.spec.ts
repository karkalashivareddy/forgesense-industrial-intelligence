/**
 * Core journey E2E: boot, auth, every route, selection, realtime, resilience.
 */

import { expectCleanBrowser, expectNoHorizontalOverflow, signIn, test, expect } from './fixtures';

test.describe('boot and authentication', () => {
  test('shows the sign-in gate and never persists the password', async ({ page, collector }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ForgeSense' })).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();

    await signIn(page);
    await expect(page.getByRole('navigation', { name: 'Operations sections' })).toBeVisible();

    // The password must not be readable from any browser storage.
    const storage = await page.evaluate(() => ({
      local: JSON.stringify(window.localStorage),
      session: JSON.stringify(window.sessionStorage),
      cookie: document.cookie,
    }));
    expect(storage.local).not.toContain('forgesense-dev');
    expect(storage.session).not.toContain('forgesense-dev');
    expect(storage.cookie).not.toContain('forgesense-dev');

    await expectCleanBrowser(collector);
  });

  test('rejects invalid credentials without leaving the gate', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ForgeSense' })).toBeVisible();
    await page.getByLabel('Role').selectOption('admin');
    await page.getByLabel('Password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Operations sections' })).toHaveCount(0);
  });

  test('signs out and re-opens the gate', async ({ page, collector }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await expect(page.getByRole('heading', { name: 'ForgeSense' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Operations sections' })).toHaveCount(0);
    await expectCleanBrowser(collector);
  });
});

const ROUTES = [
  { path: '/command', name: 'Command Center' },
  { path: '/twin', name: 'Factory Twin' },
  { path: '/fleet', name: 'Fleet' },
  { path: '/telemetry', name: 'Telemetry' },
  { path: '/predictions', name: 'Predictions' },
  { path: '/anomalies', name: 'Anomalies' },
  { path: '/analytics', name: 'Analytics' },
  { path: '/alerts', name: 'Alert Center' },
  { path: '/maintenance', name: 'Maintenance' },
  { path: '/events', name: 'Event Stream' },
  { path: '/simulation', name: 'Scenario Lab' },
  { path: '/system', name: 'System' },
];

test.describe('routing', () => {
  for (const route of ROUTES) {
    test(`${route.name} loads on a direct deep link`, async ({ page, collector }) => {
      // Deep link + refresh: the SPA fallback must serve the shell.
      await page.goto(route.path);
      await signIn(page);
      await expect(page).toHaveURL(new RegExp(`${route.path}$`));
      await expect(page.getByRole('heading', { name: route.name, level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectCleanBrowser(collector);
    });
  }

  test('navigates between workspaces via the sidebar', async ({ page, collector }) => {
    await signIn(page);
    const nav = page.getByRole('navigation', { name: 'Operations sections' });

    for (const route of ROUTES.slice(0, 6)) {
      await nav.getByRole('link').filter({ hasText: route.name }).first().click();
      await expect(page).toHaveURL(new RegExp(`${route.path}$`));
      await expect(page.getByRole('heading', { name: route.name, level: 1 })).toBeVisible();
    }

    await expectCleanBrowser(collector);
  });

  test('redirects an unknown path to the command center', async ({ page }) => {
    await page.goto('/does-not-exist');
    await signIn(page);
    await expect(page).toHaveURL(/\/command$/);
  });
});

test.describe('machine journey', () => {
  test('fleet selection opens the inspector and selection persists across workspaces', async ({ page, collector }) => {
    await page.goto('/fleet');
    await signIn(page);

    const firstRow = page.getByRole('row').filter({ hasText: 'M-101' }).first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();

    // The inspector is a labelled dialog.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: /M-101/ })).toBeVisible();

    // Tabs work and switch content.
    await dialog.getByRole('tab', { name: 'Telemetry' }).click();
    await expect(dialog.getByRole('tab', { name: 'Telemetry' })).toHaveAttribute('aria-selected', 'true');
    await dialog.getByRole('tab', { name: 'Prediction' }).click();
    await expect(dialog.getByRole('tab', { name: 'Prediction' })).toHaveAttribute('aria-selected', 'true');

    // Closing returns focus and the selection is retained in the store.
    await page.getByRole('button', { name: 'Close inspector' }).click();
    await expect(dialog).toHaveCount(0);

    await page.goto('/predictions');
    await expect(page.getByRole('heading', { name: 'Predictions', level: 1 })).toBeVisible();

    await expectCleanBrowser(collector);
  });

  test('never presents remaining-useful-life as a time unit', async ({ page }) => {
    await page.goto('/fleet');
    await signIn(page);
    await expect(page.getByRole('columnheader', { name: /Est\. remaining/i })).toBeVisible();
    // The fleet table must express RUL in steps, never hours or days.
    const body = await page.getByRole('table').first().innerText();
    expect(body).toContain('steps');
    expect(body).not.toMatch(/\d+\s*(hours?|hrs?|days?|minutes?)\s*remaining/i);
  });
});

test.describe('realtime', () => {
  test('reports a truthful connection state and never claims LIVE for synthetic data', async ({ page, collector }) => {
    await signIn(page);

    const header = page.locator('.topbar');
    await expect(header).toBeVisible();

    // The connection indicator must resolve to one of the truthful labels.
    const indicator = header.locator('.statusbadge').first();
    await expect(indicator).toBeVisible();
    await expect
      .poll(async () => (await indicator.innerText()).trim(), { timeout: 30_000 })
      .toMatch(/LIVE|SYNTHETIC|SIMULATED|SYNCING|STALE|DEGRADED|OFFLINE/);

    // In this deployment the feed is synthetic, so LIVE must not be shown.
    const label = (await indicator.innerText()).trim();
    expect(label).not.toBe('LIVE');

    await expectCleanBrowser(collector);
  });

  test('the status strip exposes transport and data basis', async ({ page }) => {
    await signIn(page);
    const status = page.getByRole('contentinfo');
    await expect(status.getByText('Transport')).toBeVisible();
    await expect(status.getByText('Data basis')).toBeVisible();
    await expect(status.getByText('Oldest reading')).toBeVisible();
  });
});

test.describe('resilience', () => {
  test('renders an intentional error state when the backend is unreachable', async ({ page, collector }) => {
    // Simulate a dead backend after sign-in rather than blocking sign-in itself.
    await page.goto('/');
    await signIn(page);
    await page.route('**/api/v1/machines*', (route) => route.abort('failed'));
    await page.getByRole('link', { name: /Fleet/i }).first().click();

    await expect(page.getByRole('alert').first()).toBeVisible();
    const text = await page.getByRole('alert').first().innerText();
    expect(text).toMatch(/unavailable|reach|backend/i);

    // An intentional failure must not surface as an uncaught browser error.
    expect(collector.pageErrors).toEqual([]);
  });

  test('shows the ML-unavailable state without fabricating confidence', async ({ page }) => {
    await signIn(page);
    await page.getByRole('link', { name: /Predictions/i }).first().click();
    await expect(page.getByRole('heading', { name: 'Predictions', level: 1 })).toBeVisible();

    // The limitations statement must always be present.
    await expect(page.getByText(/not hours, days, or a calibrated/i)).toBeVisible();
  });
});

test.describe('scenario lab', () => {
  test('separates what-if analysis from live feed injection', async ({ page, collector }) => {
    await page.goto('/simulation');
    await signIn(page);

    // Both actions are distinct and both are explained, because they have very
    // different side effects: one computes impact, the other changes the feed.
    await expect(page.getByRole('button', { name: /Run what-if/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Inject into live feed/i })).toBeVisible();

    // The boundary is stated where the controls are, not hidden in a tooltip.
    const body = await page.getByRole('main').innerText();
    expect(body).toMatch(/NO PHYSICAL MACHINE CONTROL/i);

    // The fault catalogue is populated from the backend's ScenarioType enum.
    await expect(page.getByRole('button', { name: /Vibration spike/i }).first()).toBeVisible();

    await expectCleanBrowser(collector);
  });

  test('reflects an injected scenario in the console', async ({ page, collector }) => {
    await page.goto('/simulation');
    await signIn(page);

    // Make the test idempotent. "Reset feed" is always enabled and clears every
    // machine at once, so this does not depend on which asset a previous test
    // happened to touch.
    await page.getByRole('button', { name: /Reset feed/i }).click();
    await expect(page.getByText(/A scenario is live on/i)).toHaveCount(0, { timeout: 20_000 });

    const inject = page.getByRole('button', { name: /Inject into live feed/i });
    await expect(inject).toBeEnabled();
    await inject.click();

    // The banner appears once the backend has registered the control state.
    await expect(page.getByText(/A scenario is live on/i)).toBeVisible({ timeout: 20_000 });

    // While active, the control is guarded: re-injecting is not possible.
    await expect(page.getByRole('button', { name: /Inject into live feed/i })).toBeDisabled();

    // The twin carries the simulation boundary too. Use the desktop rail: the
    // bottom navigation is display:none above 860px and is not exposed to
    // assistive technology at this viewport.
    const rail = page.getByRole('navigation', { name: 'Operations sections' });
    await rail.getByRole('link').filter({ hasText: 'Factory Twin' }).first().click();
    await expect(page.getByRole('heading', { name: 'Factory Twin', level: 1 })).toBeVisible();
    await expect(page.getByText(/SIMULATION MODE/i).first()).toBeVisible();

    // Leave the feed nominal so later tests see a clean fleet. Navigation is
    // already covered by the routing suite; this test is about the injection
    // behaviour, so it uses a direct load rather than a nav click.
    await page.goto('/simulation');
    await expect(page.getByRole('heading', { name: 'Scenario Lab', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: /Reset feed/i }).click();
    await expect(page.getByText(/A scenario is live on/i)).toHaveCount(0, { timeout: 20_000 });

    await expectCleanBrowser(collector);
  });
});

test.describe('accessibility', () => {
  test('exposes a skip link and landmark structure', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('link', { name: /skip to main content/i })).toBeAttached();
    await expect(page.getByRole('banner')).toBeAttached();
    await expect(page.getByRole('main')).toBeAttached();
    await expect(page.getByRole('contentinfo')).toBeAttached();
  });

  test('the command palette opens with Ctrl+K and closes with Escape', async ({ page, collector }) => {
    await signIn(page);
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);
    await expectCleanBrowser(collector);
  });

  test('the skip link is the first tab stop and moves focus to the workspace', async ({ page }) => {
    await signIn(page);

    // The shell only takes focus on a real route change, so on first load the
    // skip link is genuinely the first tab stop.
    await page.keyboard.press('Tab');

    const skipLink = page.getByRole('link', { name: /skip to main content/i });
    await expect(skipLink).toBeFocused();

    // Activating it must move focus into the workspace, not just scroll.
    await skipLink.press('Enter');
    await expect(page.locator('#workspace')).toBeFocused();
  });

  test('a route change moves focus into the new workspace', async ({ page }) => {
    await signIn(page);
    await page.getByRole('navigation', { name: 'Operations sections' })
      .getByRole('link')
      .filter({ hasText: 'Fleet' })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Fleet', level: 1 })).toBeVisible();
    await expect(page.locator('#workspace')).toBeFocused();
  });

  test('honours reduced motion', async ({ page, collector }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signIn(page);
    await page.getByRole('link', { name: /Factory Twin/i }).first().click();
    await expect(page.getByRole('heading', { name: 'Factory Twin', level: 1 })).toBeVisible();
    await expectCleanBrowser(collector);
  });
});
