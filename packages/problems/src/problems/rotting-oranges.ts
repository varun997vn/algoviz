import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 994 — Rotting Oranges.
 *
 * SCAFFOLD ONLY. Registered so `run_solution` can resolve it while the reference solution and
 * test cases are written; replace everything below.
 */
export function reference(_input: unknown, _viz: Viz): unknown {
  throw new Error('rotting-oranges: reference solution not implemented yet')
}

const starter = `export default function orangesRotting() {
  // scaffold
}
`

export const rottingOranges: ProblemDefinition = {
  id: 'p994',
  leetcode: 994,
  slug: 'rotting-oranges',
  title: 'Rotting Oranges',
  difficulty: 'medium',
  category: 'graphs-bfs',
  statement: 'TODO',
  structures: ['matrix', 'queue'],
  comparator: 'deep',
  entry: 'orangesRotting',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [],
  hints: [],
}
