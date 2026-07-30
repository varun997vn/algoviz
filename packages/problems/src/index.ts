import { containerWithMostWater } from './problems/container-with-most-water.js'
import { countGoodNodes } from './problems/count-good-nodes-in-binary-tree.js'
import { reorderRoutes } from './problems/reorder-routes.js'
import { mergeStringsAlternately } from './problems/merge-strings-alternately.js'
import { reverseLinkedList } from './problems/reverse-linked-list.js'
import { dailyTemperatures } from './problems/daily-temperatures.js'
import { tribonacci } from './problems/n-th-tribonacci-number.js'
import { rottingOranges } from './problems/rotting-oranges.js'
import { kthLargestElementInAnArray } from './problems/kth-largest-element-in-an-array.js'
import { uniqueNumberOfOccurrences } from './problems/unique-number-of-occurrences.js'
import { implementTrie } from './problems/implement-trie-prefix-tree.js'
import { nonOverlappingIntervals } from './problems/non-overlapping-intervals.js'
import { maximumAverageSubarrayI } from './problems/maximum-average-subarray-i.js'
import { binaryTreeRightSideView } from './problems/binary-tree-right-side-view.js'
import { longestCommonSubsequence } from './problems/longest-common-subsequence.js'
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
  mergeStringsAlternately,
  reverseLinkedList,
  dailyTemperatures,
  tribonacci,
  rottingOranges,
  kthLargestElementInAnArray,
  uniqueNumberOfOccurrences,
  implementTrie,
  nonOverlappingIntervals,
  maximumAverageSubarrayI,
  binaryTreeRightSideView,
  longestCommonSubsequence,
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
export { mergeStringsAlternately, reverseLinkedList, dailyTemperatures, tribonacci, rottingOranges }
export { kthLargestElementInAnArray, uniqueNumberOfOccurrences, implementTrie }
export { nonOverlappingIntervals, maximumAverageSubarrayI, binaryTreeRightSideView }
export { longestCommonSubsequence }
