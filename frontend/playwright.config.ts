import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration.
 *
 * Resource discipline: a single worker and a single browser instance, reused
 * across tests. Tracing and video are OFF by default and enabled only for a
 * failing run via `--trace on-retry`. Screenshots are captured only on failure.
 *
 * The suite runs against a production build served by `vite preview` and the
 * real backend, because the browser is the product.
 */
const PORT = 4173;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      // Functional suite. The visual spec has its own project so screenshots
      // and breakpoint sweeps are not duplicated on every run.
      name: 'chromium',
      testIgnore: /visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'visual',
      testMatch: /visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run build && npm run preview -- --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 240_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
