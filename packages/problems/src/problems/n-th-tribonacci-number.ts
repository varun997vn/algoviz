import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 1137 — N-th Tribonacci Number.
 *
 * SCAFFOLD ONLY. Registered so `run_solution` can resolve it while the reference solution and
 * test cases are written; replace everything below.
 */
export function reference(_input: unknown, _viz: Viz): unknown {
  throw new Error('n-th-tribonacci-number: reference solution not implemented yet')
}

const starter = `export default function tribonacci() {
  // scaffold
}
`

export const tribonacci: ProblemDefinition = {
  id: 'p1137',
  leetcode: 1137,
  slug: 'n-th-tribonacci-number',
  title: 'N-th Tribonacci Number',
  difficulty: 'easy',
  category: 'dp-1d',
  statement: 'TODO',
  structures: ['dp'],
  comparator: 'deep',
  entry: 'tribonacci',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [],
  hints: [],
}
