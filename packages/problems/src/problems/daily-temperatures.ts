import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 739 — Daily Temperatures.
 *
 * SCAFFOLD ONLY. Registered so `run_solution` can resolve it while the reference solution and
 * test cases are written; replace everything below.
 */
export function reference(_input: unknown, _viz: Viz): unknown {
  throw new Error('daily-temperatures: reference solution not implemented yet')
}

const starter = `export default function dailyTemperatures() {
  // scaffold
}
`

export const dailyTemperatures: ProblemDefinition = {
  id: 'p739',
  leetcode: 739,
  slug: 'daily-temperatures',
  title: 'Daily Temperatures',
  difficulty: 'medium',
  category: 'monotonic-stack',
  statement: 'TODO',
  structures: ['stack', 'array'],
  comparator: 'deep',
  entry: 'dailyTemperatures',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [],
  hints: [],
}
