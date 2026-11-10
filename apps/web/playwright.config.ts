import { defineConfig } from '@playwright/test';

const ci = Boolean(process.env['CI']);

/**
 * `nx e2e web -- <spec>`: every screen at 390 and 1280 px, Chromium only (the
 * captures stay the same from one run to the next), against `pnpm dev` (the
 * server with the fakes, the page on 4200), seeded through
 * `/api/testing/scenarios/:name` (`e2e/fixtures.ts`).
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  // One server, one database: the scenarios reset it, so the tests run one at a time.
  workers: 1,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4200',
    browserName: 'chromium',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'phone',
      use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
    },
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    cwd: '../..',
    // Through the page's proxy: ready once both the page and the server answer.
    url: 'http://localhost:4200/api/health',
    reuseExistingServer: !ci,
    timeout: 180_000,
    // SIGTERM, which Nx passes on to the server and the page: a SIGKILL to the group would leave them running.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
