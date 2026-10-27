import { defineConfig, devices } from '@playwright/test';

// End-to-end tests of the import flow, run against the production build.
// First time on a new machine: npx playwright install chromium
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4174',
    ...devices['Pixel 7'],
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
