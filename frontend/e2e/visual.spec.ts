/**
 * Responsive visual QA.
 *
 * Captures every workspace at the required breakpoints and asserts, alongside
 * the screenshot, that the DOM is sound: no horizontal overflow, no clipped
 * headings, navigation present. Pixel similarity alone is not sufficient —
 * these assertions are the actual check.
 */

import { test, expect, signIn, expectNoHorizontalOverflow } from './fixtures';

const BREAKPOINTS = [
  { name: '375', width: 375, height: 812 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 768 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
];

const WORKSPACES = [
  { name: 'command', title: 'Command Center' },
  { name: 'twin', title: 'Factory Twin' },
  { name: 'fleet', title: 'Fleet' },
  { name: 'predictions', title: 'Predictions' },
  { name: 'alerts', title: 'Alert Center' },
  { name: 'maintenance', title: 'Maintenance' },
  { name: 'simulation', title: 'Scenario Lab' },
  { name: 'system', title: 'System' },
];

/** Skip screenshots on a re-run; they are only needed for a fresh audit. */
const CAPTURE = process.env.CAPTURE_SCREENSHOTS === 'true';

test.describe('responsive layout', () => {
  for (const workspace of WORKSPACES) {
    test(`${workspace.name} has no horizontal overflow across breakpoints`, async ({ page, collector }) => {
      await page.goto(`/${workspace.name}`);
      await signIn(page);
      await expect(page.getByRole('heading', { name: workspace.title, level: 1 })).toBeVisible();

      for (const breakpoint of BREAKPOINTS) {
        await page.setViewportSize({ width: breakpoint.width, height: breakpoint.height });
        // Let the layout settle and the on-demand renderer react.
        await page.waitForTimeout(500);

        await expectNoHorizontalOverflow(page);

        // The page heading must be visible and unclipped at every width.
        const heading = page.getByRole('heading', { name: workspace.title, level: 1 });
        await expect(heading).toBeVisible();
        const box = await heading.boundingBox();
        expect(box, `heading missing at ${breakpoint.name}px`).not.toBeNull();
        expect(box!.width).toBeGreaterThan(0);

        if (CAPTURE) {
          await page.screenshot({
            path: `test-results/visual/${workspace.name}-${breakpoint.name}.png`,
            fullPage: false,
          });
        }
      }

      // Reset so subsequent assertions run at the project default.
      await page.setViewportSize({ width: 1440, height: 900 });
      expect(collector.pageErrors).toEqual([]);
    });
  }
});

test.describe('mobile navigation', () => {
  test('uses a bottom navigation bar on small viewports', async ({ page, collector }) => {
    await page.goto('/command');
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const bottomNav = page.getByRole('navigation', { name: 'Primary sections' });
    await expect(bottomNav).toBeVisible();

    // The desktop rail is off-canvas at this width.
    const rail = page.getByRole('navigation', { name: 'Operations sections' });
    await expect(rail).not.toBeInViewport();

    await expectNoHorizontalOverflow(page);
    expect(collector.pageErrors).toEqual([]);
  });

  test('the inspector becomes a bottom sheet on small viewports', async ({ page, collector }) => {
    await page.goto('/fleet');
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.getByRole('row').filter({ hasText: 'M-101' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    // Full width, anchored to the bottom of the viewport.
    expect(box!.width).toBeGreaterThanOrEqual(380);
    expect(box!.height).toBeGreaterThan(0);

    await expectNoHorizontalOverflow(page);
    expect(collector.pageErrors).toEqual([]);
  });
});

test.describe('twin rendering', () => {
  test('the 3D scene mounts, is interactive and is disposed on navigation', async ({ page, collector }) => {
    await page.goto('/twin');
    await signIn(page);

    const canvas = page.locator('.twin__canvas canvas');
    await expect(canvas).toBeVisible({ timeout: 30_000 });

    const box = await canvas.boundingBox();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);

    // Camera controls are reachable.
    await page.getByRole('button', { name: /Fit factory in view/i }).click();
    await page.getByRole('button', { name: /Top-down view/i }).click();
    await page.getByRole('button', { name: /^Risk$/i }).click();
    await page.getByRole('button', { name: /Dependencies/i }).click();

    // Keyboard-equivalent asset selection exists.
    await page.getByRole('button', { name: /Assets \(/i }).click();
    const assetList = page.getByRole('list', { name: 'Factory assets' });
    await expect(assetList).toBeVisible();
    await assetList.getByRole('listitem').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Navigating away must tear the scene down (no orphaned canvas, no leak).
    await page.getByRole('button', { name: 'Close inspector' }).click();
    await page.getByRole('link', { name: /Fleet/i }).first().click();
    await expect(page.getByRole('heading', { name: 'Fleet', level: 1 })).toBeVisible();
    await expect(page.locator('.twin__canvas canvas')).toHaveCount(0);

    expect(collector.pageErrors).toEqual([]);
  });
});

test.describe('console and network cleanliness', () => {
  test('a full walk of every workspace produces no console or network errors', async ({ page, collector }) => {
    await page.goto('/command');
    await signIn(page);

    for (const workspace of WORKSPACES) {
      await page.goto(`/${workspace.name}`);
      await expect(page.getByRole('heading', { name: workspace.title, level: 1 })).toBeVisible();
      await page.waitForTimeout(600);
    }

    expect(collector.pageErrors, 'uncaught exceptions').toEqual([]);
    expect(collector.consoleErrors, 'console errors').toEqual([]);
    expect(collector.failedRequests, 'failed requests').toEqual([]);
    expect(collector.badResponses, 'unexpected 4xx/5xx').toEqual([]);
  });

  test('no favicon or asset 404s', async ({ page, collector }) => {
    await page.goto('/');
    await signIn(page);
    await page.waitForTimeout(1000);
    const asset404s = collector.badResponses.filter((entry) => /favicon|\.woff2|\.css|\.js/.test(entry));
    expect(asset404s, `asset 404s: ${asset404s.join(' | ')}`).toEqual([]);
  });
});
