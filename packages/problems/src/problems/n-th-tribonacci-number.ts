import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 1137 — N-th Tribonacci Number.
 *
 * The arithmetic is a one-liner; the *table* is the reason this problem is in the set. It is the
 * first problem to drive `VizDpTable`, and nine more 1-D DP problems are queued behind it, so the
 * job here is to prove a DP table can explain a recurrence rather than just fill up.
 *
 * Deliberately the bottom-up table form, not the O(1) rolling-variables form:
 *
 *   let a = 0, b = 1, c = 1
 *   for (let i = 3; i <= n; i += 1) [a, b, c] = [b, c, a + b + c]
 *
 * That version is better code — constant space — and a strictly worse explanation. Three scalars
 * being reassigned show *nothing*: you cannot see "every term is the sum of the three before it"
 * in a picture where the three predecessors have already been overwritten. The table keeps every
 * term on screen, so `dependsOn` can point at the exact three cells the new one came from. When a
 * later problem needs the space optimisation it can say so; this one exists to teach the table.
 */
export function reference(n: number, viz: Viz): number {
  // At least three cells wide even when n < 3: the recurrence needs three predecessors, so the
  // three base cases are part of the table's definition, and for n <= 2 they are the only thing
  // there is to look at. `null` as the fill means an unwritten cell renders as empty rather than
  // as a plausible-looking 0 — "not computed yet" and "computed, equals zero" must not look alike.
  const dp = viz.dp1d<number>(Math.max(n + 1, 3), null, { name: 'T' })
  viz.watch(() => ({ n, Tn: dp.peek(n) }))

  // Narrated, not quiet. Seeding a table is usually setup, but here the three base cases *are*
  // the definition of the sequence, and for n = 0, 1, 2 the loop below never runs — quieting the
  // seeds would leave those three cases with a completely empty animation.
  dp.set(0, 0)
  dp.set(1, 1)
  dp.set(2, 1)
  viz.step('base cases: T(0) = 0, T(1) = 1, T(2) = 1')

  for (let i = 3; i <= n; i += 1) {
    dp.set(i, dp.get(i - 1) + dp.get(i - 2) + dp.get(i - 3))
    dp.dependsOn([i - 1, i - 2, i - 3], `T(${i}) = T(${i - 1}) + T(${i - 2}) + T(${i - 3})`)
    viz.step(`T(${i}) = ${dp.peek(i - 1)} + ${dp.peek(i - 2)} + ${dp.peek(i - 3)} = ${dp.peek(i)}`)
  }

  dp.mark(0, n, 'result', `T(${n})`)
  return dp.get(n)
}

const starter = `// Bottom-up table. T(i) is the sum of the three terms before it, so fill dp[0..n]
// left to right and the answer is the last cell you wrote.
export default function tribonacci(n: number, viz: Viz): number {
  // Always at least three wide, so the base cases are visible even when the loop never runs.
  const dp = viz.dp1d<number>(Math.max(n + 1, 3), null, { name: 'T' })
  viz.watch(() => ({ n, Tn: dp.peek(n) }))

  dp.set(0, 0)
  dp.set(1, 1)
  dp.set(2, 1)
  viz.step('base cases: T(0) = 0, T(1) = 1, T(2) = 1')

  for (let i = 3; i <= n; i += 1) {
    // TODO: the Tribonacci recurrence. Write dp[i] as the sum of dp[i-1], dp[i-2] and dp[i-3],
    // then call dp.dependsOn([i - 1, i - 2, i - 3], 'why') so the animation shows
    // which three cells the new value came from instead of leaving it implied.
    viz.step('T(' + i + ')')
  }

  dp.mark(0, n, 'result', 'answer')
  return dp.get(n)
}
`

export const tribonacci: ProblemDefinition = {
  id: 'p1137',
  leetcode: 1137,
  slug: 'n-th-tribonacci-number',
  title: 'N-th Tribonacci Number',
  difficulty: 'easy',
  category: 'dp-1d',
  statement:
    'The Tribonacci sequence is defined by `T(0) = 0`, `T(1) = 1`, `T(2) = 1`, and ' +
    '`T(n + 3) = T(n) + T(n + 1) + T(n + 2)` for every `n >= 0`. Given `n`, return `T(n)`. ' +
    'Fill a table `dp[0..n]` left to right so each cell is visibly the sum of the three cells ' +
    'before it. Constraints: `0 <= n <= 37`, and the answer always fits in a 32-bit integer.',
  structures: ['dp'],
  comparator: 'deep',
  entry: 'tribonacci',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    { name: 'example n = 4', args: [4], expected: 4, tags: ['example'] },
    { name: 'example n = 25', args: [25], expected: 1389537, tags: ['example'] },
    { name: 'n = 0 — first base case, loop never runs', args: [0], expected: 0, tags: ['edge'] },
    { name: 'n = 1 — second base case, loop never runs', args: [1], expected: 1, tags: ['edge'] },
    { name: 'n = 2 — third base case, loop never runs', args: [2], expected: 1, tags: ['edge'] },
    { name: 'n = 3 — first computed cell, one iteration', args: [3], expected: 2, tags: ['edge'] },
    { name: 'n = 8 — table long enough to read the pattern', args: [8], expected: 44, tags: [] },
    {
      name: 'n = 37 — largest input, answer near the 32-bit ceiling',
      args: [37],
      expected: 2082876103,
      tags: ['edge', 'large'],
    },
  ],
  hints: [
    'Three base cases, not two: `T(0) = 0`, `T(1) = 1`, `T(2) = 1`. For `n <= 2` you are done ' +
      'before the loop starts.',
    'Every later term only ever needs the three immediately before it, so a single left-to-right ' +
      'pass over `dp[3..n]` is enough — no recursion and no repeated work.',
    'After writing `dp[i]`, call `dp.dependsOn([i - 1, i - 2, i - 3])`. ' +
      'That is what turns the picture from "a row of numbers" into "this cell came from those ' +
      'three".',
  ],
}
