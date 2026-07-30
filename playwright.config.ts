import { defineConfig, devices } from '@playwright/test'

/**
 * `@playwright/test` is pinned to 1.56.1 on purpose: that is the version whose
 * `browsers.json` names chromium revision 1194, which is the build already present at
 * `PLAYWRIGHT_BROWSERS_PATH` (/opt/pw-browsers). A newer Playwright expects a revision that
 * isn't there and tries to download one. Never run `playwright install` locally.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 2,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['html'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @algoviz/web preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
})
