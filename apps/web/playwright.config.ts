import { defineConfig } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';

export default defineConfig({
  testDir: './browser-tests',
  testMatch: '**/*.pw.ts',
  workers: 1,
  retries: 0,
  timeout: 45000,
  reporter: 'list',
  outputDir: process.env.CRM_TEST_OUTPUT_DIR ?? path.join(os.tmpdir(), `shield-workspace-browser-${process.pid}`),
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000',
    channel: 'msedge',
    headless: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
