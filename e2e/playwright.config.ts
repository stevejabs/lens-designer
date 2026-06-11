import { defineConfig, devices } from '@playwright/test';

// Playwright config for the lens-designer e2e suite.
//
// Prerequisites for `pnpm test`:
//   - Sandbox LS running (with the __LENS_DESIGNER_SANDBOX__ marker SO).
//   - Bridge daemon running on its default WS port (`pnpm bridge:dev`
//     from tools/lens-designer/bridge/).
//   - Web app running on :3001 (`pnpm dev` from tools/lens-designer/web/).
//
// CI strategy (later phase): use Playwright's `webServer` block to start
// the web app automatically. The bridge daemon and sandbox LS still need
// to be running on the runner — they're not auto-started by this config.

export default defineConfig({
  testDir: './test',
  fullyParallel: false, // tests share a single bridge + sandbox; serial.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: process.env.LENS_DESIGNER_WEB_URL ?? 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
