import { containerWithMostWater } from './problems/container-with-most-water.js'
import { countGoodNodes } from './problems/count-good-nodes-in-binary-tree.js'
import { reorderRoutes } from './problems/reorder-routes.js'
import type { ProblemDefinition } from './types.js'

/**
 * Explicit registry, deliberately not `import.meta.glob`.
 *
 * Glob only works under Vite; this package is also consumed by Vitest under Node and by the
 * MCP server via tsx. One hand-written list resolves identically everywhere, and the
 * `scaffold_problem` MCP tool appends to it, so the maintenance cost is near zero.
 */
export const PROBLEMS: readonly ProblemDefinition[] = [
  containerWithMostWater,
  countGoodNodes,
  reorderRoutes,
]

export function listProblems(): ProblemDefinition[] {
  return [...PROBLEMS]
}

export function getProblem(idOrSlug: string): ProblemDefinition | undefined {
  return PROBLEMS.find(
    (p) => p.id === idOrSlug || p.slug === idOrSlug || String(p.leetcode) === idOrSlug,
  )
}

export function requireProblem(idOrSlug: string): ProblemDefinition {
  const problem = getProblem(idOrSlug)
  if (!problem) {
    throw new Error(
      `Unknown problem "${idOrSlug}". Known: ${PROBLEMS.map((p) => p.slug).join(', ')}`,
    )
  }
  return problem
}

export * from './types.js'
export { containerWithMostWater, countGoodNodes, reorderRoutes }
