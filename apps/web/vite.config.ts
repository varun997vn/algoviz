import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { workspaceAliases } from '../../vite.shared.js'

/**
 * Where the app is served from, as a URL path.
 *
 * `/` for development and for the e2e suite; `/algoviz/` for GitHub Pages, which serves a project
 * page under the repository name. It has to be a build-time constant because Vite bakes it into
 * every emitted asset URL — including the one inside `new Worker(new URL(...))`, which is the part
 * that would fail silently: the page would load and the editor would appear, and only *running* a
 * solution would 404.
 *
 * Driven by an explicit environment variable rather than by `process.env.CI` or `GITHUB_ACTIONS`,
 * because those are set for the test workflow too, and a build whose base depends on whether it
 * happens to be running in CI is a build nobody can reproduce locally.
 */
const base = process.env['ALGOVIZ_BASE'] ?? '/'

export default defineConfig({
  base,
  plugins: [react()],
  // Workspace packages are consumed as TypeScript source via the shared alias map, so Vite,
  // Vitest and tsc all resolve them the same way. Divergence here is silent and expensive.
  resolve: { alias: workspaceAliases },
  build: { target: 'es2022', sourcemap: true },
  server: { port: 5173 },
  preview: { port: 4173 },
})
