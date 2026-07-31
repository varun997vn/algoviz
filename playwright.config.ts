import { defineConfig, devices } from '@playwright/test'

/**
 * `@playwright/test` is pinned to 1.56.1 on purpose: that is the version whose
 * `browsers.json` names chromium revision 1194, which is the build already present at
 * `PLAYWRIGHT_BROWSERS_PATH` (/opt/pw-browsers). A newer Playwright expects a revision that
 * isn't there and tries to download one. Never run `playwright install` locally.
 */
/**
 * The path the preview server serves the app under — see `apps/web/vite.config.ts`.
 *
 * Kept in step with the build so `ALGOVIZ_BASE=/algoviz/ pnpm test:ui` exercises the *deployed*
 * artifact rather than a differently-based one. The asset path a subpath deployment gets wrong is
 * the worker URL, and nothing but running a solution would reveal it, so the e2e suite is the only
 * thing that can prove a Pages build actually works before it ships.
 */
const base = process.env['ALGOVIZ_BASE'] ?? '/'
const origin = 'http://127.0.0.1:4173'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 2,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['html'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: `${origin}${base}`,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @algoviz/web preview --port 4173 --strictPort --host 127.0.0.1',
    url: `${origin}${base}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
})
