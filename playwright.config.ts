import { defineConfig, devices } from '@playwright/test';

// End-to-end smoke tests against the real built app. e2e/global-setup.ts builds
// the SPA, starts `node server/index.js` on a free port with a throwaway
// DATA_DIR and seeds it; the specs share that one server, so they run serially.
// Specs are named *.e2e.ts so Vitest's default *.test/*.spec glob never sees them.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    // A fresh context per test also means a fresh service worker, so a stale
    // precached build can never be served. Blocking SW registration outright
    // keeps the PWA from intercepting anything mid-test.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
