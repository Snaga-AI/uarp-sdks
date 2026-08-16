import { defineConfig } from '@playwright/test';

/**
 * The test drives the real page against the real API, so it needs a key:
 *
 *   UARP_API_KEY=uarp_… npm run test:e2e
 *
 * Without one it skips rather than fails — a contributor without a tenant
 * should still be able to run the suite.
 *
 * Port: a dedicated, uncommon port (4317) with --strictPort and
 * reuseExistingServer:false. The default Vite port 5173 is shared with every
 * other project's dev server, and reuseExistingServer:true only checks that
 * *something* answers on the url — not that it is *this* app. That latched the
 * suite onto a stale `vite` from a different project running on 5173, and
 * every test went red against the wrong page while the code was fine. A loud
 * "port in use" is correct; a silent run against the wrong app is not.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 60_000 },
  use: { baseURL: 'http://localhost:4317', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --port 4317 --strictPort',
    url: 'http://localhost:4317',
    reuseExistingServer: false,
    timeout: 90_000,
  },
});