/**
 * Shared E2E fixtures.
 *
 * Provides an authenticated page plus console/network collectors so every spec
 * can assert the browser stayed clean without duplicating instrumentation.
 */

import { test as base, expect, type Page } from '@playwright/test';

/*
 * The password has no fallback on purpose.
 *
 * docker-compose.yml reads FORGESENSE_DEV_PASSWORD with the `:?` form, so the
 * browser-run stack refuses to start without it. A default here would let the
 * suite silently fall back to a credential the stack never received, and the
 * E2E run would fail at sign-in with an error that looks like a UI bug. Failing
 * immediately with a message naming the variable is the useful failure.
 */
const e2ePassword = process.env.E2E_PASSWORD;
if (!e2ePassword) {
  throw new Error(
    'E2E_PASSWORD is not set. It must match FORGESENSE_DEV_PASSWORD, which the ' +
      'Compose stack requires (see .ci/boot-stack.sh, which exports both for CI).',
  );
}

export const CREDENTIALS = {
  username: process.env.E2E_USERNAME ?? 'admin',
  password: e2ePassword,
};

export interface Collector {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  badResponses: string[];
}

export const test = base.extend<{ collector: Collector; appPage: Page }>({
  collector: async ({ page }, use) => {
    const collector: Collector = { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [] };

    page.on('console', (message) => {
      if (message.type() === 'error') collector.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => collector.pageErrors.push(String(error)));
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? 'unknown';
      // A cancelled navigation is not a defect.
      if (failure.includes('ERR_ABORTED')) return;
      collector.failedRequests.push(`${request.method()} ${request.url()} ${failure}`);
    });
    page.on('response', (response) => {
      if (response.status() >= 400) collector.badResponses.push(`${response.status()} ${response.url()}`);
    });

    await use(collector);
  },

  appPage: async ({ page }, use) => {
    await page.goto('/');
    await signIn(page);
    await use(page);
  },
});

/**
 * Sign in through the real gate and wait for the shell to mount.
 *
 * Safe to call when the page is already authenticated: the tab-scoped session
 * is restored on load, so a refresh does not require signing in again.
 */
export async function signIn(page: Page, credentials = CREDENTIALS): Promise<void> {
  // Ensure the app is loaded even when the caller did not navigate first.
  if (!page.url().startsWith('http')) {
    await page.goto('/');
  }

  const nav = page.getByRole('navigation', { name: 'Operations sections' });
  const gate = page.getByRole('heading', { name: 'ForgeSense' });

  // Either the shell is already up (restored session) or the gate is showing.
  await expect(nav.or(gate).first()).toBeVisible({ timeout: 25_000 });

  if (await nav.isVisible().catch(() => false)) return;

  await page.getByLabel('Role').selectOption(credentials.username);
  await page.getByLabel('Password').fill(credentials.password);
  await page.getByRole('button', { name: /sign in/i }).click();

  await nav.waitFor({ state: 'visible', timeout: 25_000 });
}

/** Assert the browser produced no unexpected errors during the test. */
export async function expectCleanBrowser(collector: Collector): Promise<void> {
  expect(collector.pageErrors, `Uncaught exceptions: ${collector.pageErrors.join(' | ')}`).toEqual([]);
  expect(collector.consoleErrors, `Console errors: ${collector.consoleErrors.join(' | ')}`).toEqual([]);
  expect(collector.failedRequests, `Failed requests: ${collector.failedRequests.join(' | ')}`).toEqual([]);
  expect(collector.badResponses, `HTTP >= 400: ${collector.badResponses.join(' | ')}`).toEqual([]);
}

/** Assert the page has no horizontal overflow at the current viewport. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  // Allow 1px for sub-pixel rounding.
  expect(overflow.scrollWidth, 'Page overflows horizontally').toBeLessThanOrEqual(overflow.clientWidth + 1);
}

export { expect };
