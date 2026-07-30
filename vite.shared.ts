import { fileURLToPath } from 'node:url'

export interface AliasEntry {
  find: RegExp
  replacement: string
}

const at = (path: string): string => fileURLToPath(new URL(`./${path}`, import.meta.url))

const PACKAGES = ['tracer', 'problems', 'runner', 'viz', 'roadmap', 'testkit'] as const

/**
 * The single source of truth for workspace path aliases, shared by `vite.config.ts` and
 * `vitest.config.ts` and mirrored in `tsconfig.base.json` `paths`.
 *
 * Anchored regexes rather than bare string prefixes: a plain `'@algoviz/viz'` alias also
 * swallows `'@algoviz/viz/tokens.css'`, rewriting it to `…/src/index.ts/tokens.css`. Subpath
 * exports get their own explicit entries below.
 */
export const workspaceAliases: AliasEntry[] = [
  ...PACKAGES.map((name) => ({
    find: new RegExp(`^@algoviz/${name}$`),
    replacement: at(`packages/${name}/src/index.ts`),
  })),
  { find: /^@algoviz\/viz\/tokens\.css$/, replacement: at('packages/viz/src/tokens.css') },
  { find: /^@algoviz\/runner\/node$/, replacement: at('packages/runner/src/node.ts') },
  { find: /^@algoviz\/roadmap\/node$/, replacement: at('packages/roadmap/src/node.ts') },
]

/** The same mapping as a plain record, for tooling that wants `paths`-style input. */
export const aliasRecord: Record<string, string> = Object.fromEntries(
  PACKAGES.map((name) => [`@algoviz/${name}`, at(`packages/${name}/src/index.ts`)]),
)
