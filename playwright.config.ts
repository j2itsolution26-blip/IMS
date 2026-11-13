import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests of the offline-first till (e2e/). They drive a running app
 * on this machine, started with a local throwaway database; see
 * docs/offline-pos.md, "Browser tests". `npm run test:e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/support/global-setup.ts',
  // Each test seeds its own store, but they share one app and database.
  workers: 1,
  fullyParallel: false,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3107',
    // A phone, where the till is used most.
    ...devices['Pixel 7'],
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
