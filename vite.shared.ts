import { fileURLToPath } from 'node:url'

/**
 * The single source of truth for workspace path aliases.
 *
 * Imported by `vite.config.ts`, `vitest.config.ts`, and mirrored in `tsconfig.base.json`
 * `paths`. A unit test asserts the two lists agree — the classic pnpm/Vite/tsc resolution
 * mismatch is silent and expensive, so it gets a test rather than a convention.
 */
const pkg = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))

export const workspaceAliases: Record<string, string> = {
  '@algoviz/tracer': pkg('tracer'),
  '@algoviz/problems': pkg('problems'),
  '@algoviz/runner': pkg('runner'),
  '@algoviz/viz': pkg('viz'),
  '@algoviz/roadmap': pkg('roadmap'),
  '@algoviz/testkit': pkg('testkit'),
}
