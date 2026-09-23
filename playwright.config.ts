import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const DATA = process.env.E2E_PGLITE_DIR ?? `.data/e2e-${Date.now()}`;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PGLITE_DIR: DATA,
      SESSION_SECRET: 'e2e-session-secret-e2e-session-secret-0001',
      SETUP_TOKEN: 'e2e-setup-token',
      ACC_INPROCESS_WORKER: 'true',
      ACC_ALLOW_EPHEMERAL_DB: 'true',
      CRON_SECRET: 'e2e-cron-secret',
      APP_URL: `http://localhost:${PORT}`,
    },
  },
});
