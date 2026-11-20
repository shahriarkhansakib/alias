import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

const shellPort = process.env.PORT;
const shellApiInternalUrl = process.env.API_INTERNAL_URL;

const rootEnvPath = path.resolve(import.meta.dirname, '../../.env');
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: false });
}

const webPort = Number(shellPort ?? process.env.E2E_WEB_PORT ?? '3100');
const apiInternalUrl = (
  shellApiInternalUrl ??
  process.env.E2E_API_INTERNAL_URL ??
  'http://127.0.0.1:4100'
).replace(/\/+$/, '');
const apiPort = Number(new URL(apiInternalUrl).port || '4100');
const webOrigin = `http://localhost:${webPort}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: webOrigin,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'node ../api/dist/server.js',
      url: `${apiInternalUrl}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        API_PORT: String(apiPort),
        API_HOST: '127.0.0.1',
        BETTER_AUTH_URL: webOrigin,
        WEB_ORIGIN: webOrigin,
        TRUSTED_ORIGINS: webOrigin,
        AUTH_RATE_LIMIT_ENABLED: 'false',
      },
    },
    {
      command: `pnpm exec next start -p ${webPort}`,
      url: webOrigin,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(webPort),
        API_INTERNAL_URL: apiInternalUrl,
      },
    },
  ],
});
