import { defineConfig } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1,
  timeout: 60000, expect: { timeout: 10000 },
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    browserName: 'chromium', viewport: { width: 1280, height: 900 },
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${path.resolve('tests/fixtures/microphone.wav')}`] },
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: { command: process.env.PLAYWRIGHT_SERVER_COMMAND || 'npm run dev', url: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000', reuseExistingServer: true, timeout: 60000 },
});
