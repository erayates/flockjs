import { defineConfig } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './packages/core/integration',
  testMatch: '**/*.test.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 20_000,
  },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: baseUrl,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
      },
    },
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
      },
    },
    {
      name: 'webkit',
      use: {
        browserName: 'webkit',
      },
    },
  ],
  webServer: {
    command: 'node packages/core/integration/static-server.mjs',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
