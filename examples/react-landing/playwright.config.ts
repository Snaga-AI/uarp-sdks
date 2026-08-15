import { defineConfig } from '@playwright/test';

/**
 * The test drives the real page against the real API, so it needs a key:
 *
 *   UARP_API_KEY=uarp_… npm run test:e2e
 *
 * Without one it skips rather than fails — a contributor without a tenant
 * should still be able to run the suite.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 60_000 },
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
