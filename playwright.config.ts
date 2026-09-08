import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the PRODUCTION build served by `vite preview`, at the same
 * project subpath GitHub Pages serves, so what passes here is what ships.
 *
 * Port 4626 is unique to this lab across the fleet (never the Vite default
 * 4173 — with 170+ labs side by side a shared port means `reuseExistingServer`
 * silently scans a different lab's preview).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 180_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4626/crypto-lab-factor-forge/',
  },
  projects: [
    {
      name: 'a11y',
      testMatch: /a11y\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark' },
    },
    { name: 'claims', testMatch: /claims\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'claims-mobile', testMatch: /claims\.spec\.ts/, use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    // Build before serving: `vite preview` only serves whatever is already in
    // dist/, so without this a failing build leaves the previous good bundle in
    // place and the suite passes green against code that no longer compiles.
    command: 'npm run build && npm run preview -- --port 4626 --strictPort',
    url: 'http://localhost:4626/crypto-lab-factor-forge/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
