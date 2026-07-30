import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 643 — Maximum Average Subarray I.
 *
 * The first problem in the set to use `setWindow`/`clearWindow`, and the reason to pick a
 * genuinely easy one for it: the whole visual argument is a single dashed band that moves one
 * cell to the right, k cells wide, exactly once per element.
 *
 * **The thing the animation has to prove is not the answer.** A naive re-sum — add all k values
 * for every window — returns the identical number for every case in this file. What separates it
 * from the real algorithm is only visible in the *picture*: the sliding version touches exactly
 * two cells per step, the one entering on the right and the one leaving on the left, and never
 * re-reads the k-2 in the middle. So the frame order here is deliberate:
 *
 *   1. `a[i]`      — the cell entering lights up, just outside the band's right edge
 *   2. `a[i - k]`  — the cell leaving lights up, on the band's left edge
 *   3. `setWindow` — the band slides one cell right, and `sum` changes on that same frame
 *
 * Three frames per element, forever, regardless of k. The re-sum version emits k of them and its
 * band jumps to a fresh set of cells with no add/drop pair to explain it. That difference is what
 * `tests/integration/problems/maximum-average-subarray-i.test.ts` asserts, and it is why the
 * `long run` case exists — at n=300 the two are 1.2k frames apart.
 *
 * Two smaller decisions worth keeping:
 *
 * - `best` is seeded from the first window's sum, never from `0`. Values go down to -10^4, so on
 *   the all-negative case a `best = 0` start returns 0 and every test with a positive answer
 *   still passes. The `average` watch line makes the seeding visible: it reads the first window's
 *   average from the frame the window exists, and never shows a 0 nobody computed.
 * - The band is *cleared* at the end rather than left parked wherever the scan stopped. The final
 *   frame then says exactly one thing — the k green cells are the window whose average is
 *   returned — instead of showing a band at the array's tail next to a result somewhere else.
 */
export function reference(nums: number[], k: number, viz: Viz): number {
  const a = viz.array(nums, { name: 'nums' })
  // The k cells of the window whose sum is `best` — marked, not banded, so they stay put while
  // the band moves on. `Array.from` rather than a loop: `mark` takes a list of indices and there
  // is no range twin of `setWindow` for marks.
  const cellsFrom = (start: number): number[] => Array.from({ length: k }, (_, j) => start + j)

  let sum = 0
  viz.watch(() => ({ k, sum }))

  // Build the first window one element at a time. This is the only place the algorithm ever
  // reads k cells in a row, and the band appears the moment it is complete.
  for (let i = 0; i < k; i += 1) sum += a[i]
  a.setWindow(0, k - 1)

  // `best = sum`, not `best = 0`: every value may be negative, so zero is not a floor.
  let best = sum
  let bestStart = 0
  viz.watch(() => ({ best, average: best / k }))
  a.mark(cellsFrom(bestStart), 'result', `best so far: sum ${best}`)
  viz.step(`first window [0..${k - 1}] sums to ${sum}`)

  for (let i = k; i < a.length; i += 1) {
    // One add, one drop. Two cells touched per step is the entire reason this is O(n) and not
    // O(n*k), and it is two frames — entering cell first, then leaving cell — before the band
    // slides onto its new k cells.
    sum += a[i] - a[i - k]
    a.setWindow(i - k + 1, i)

    const improved = sum > best
    if (improved) {
      best = sum
      bestStart = i - k + 1
      a.clearMarks('result')
      a.mark(cellsFrom(bestStart), 'result', `best so far: sum ${best}`)
    }
    // Narrate the pair, not the window: "[4]=50 enters, [0]=1 leaves" is the O(1) step itself.
    viz.step(
      `[${i}]=${a.at(i)} enters, [${i - k}]=${a.at(i - k)} leaves -> sum ${sum}, best ${best}` +
        (improved ? ' (new best)' : ''),
    )
  }

  // The scan is over, so there is no current window any more. Dropping the band leaves the
  // marked cells as the only claim on screen.
  a.clearWindow()
  viz.step(
    `best window is [${bestStart}..${bestStart + k - 1}], sum ${best}, average ${best / k}`,
  )
  return best / k
}

/**
 * 300 values, all 1 except a 40-wide plateau of 100 at indices 200..239, with k = 40.
 *
 * Three jobs. It is the O(n) proof: a re-sum solution needs ~10,400 frames here against the
 * reference's ~1,200, which is the gap the frame-count assertion lives in. It is the long
 * stretch where `best` does *not* change — 160 slides where the band moves and the green cells
 * do not, which is the half of "watch the best" that a short case never shows. And it is over
 * the 240-cell limit `ArrayViz` renders, so it is the case that shows the band scrolling out of
 * view (see the note in the test file).
 *
 * Hand-derivable: a window covering c plateau cells sums to 100c + (40 - c), maximised at c = 40,
 * which happens only at start 200. Best sum 4000, average exactly 100.
 */
const longRun = Array.from({ length: 300 }, (_, i) => (i >= 200 && i < 240 ? 100 : 1))

const starter = `// A fixed-size window of k elements slides across the array. Each step adds the one
// element entering on the right and drops the one leaving on the left, so the sum costs
// O(1) per step. Re-adding all k values every time returns the same answer — and animates
// a scan that is O(n*k).
export default function findMaxAverage(nums: number[], k: number, viz: Viz): number {
  const a = viz.array(nums, { name: 'nums' })
  const cellsFrom = (start: number): number[] => Array.from({ length: k }, (_, j) => start + j)
  let sum = 0
  viz.watch(() => ({ k, sum }))

  // TODO: build the first window from nums[0..k-1], then show it with a.setWindow(0, k - 1).

  // best is seeded from the first window, never from 0 — every value may be negative.
  let best = sum
  let bestStart = 0
  viz.watch(() => ({ best, average: best / k }))
  a.mark(cellsFrom(bestStart), 'result', 'best so far')
  viz.step('first window')

  for (let i = k; i < a.length; i += 1) {
    // TODO: slide one step. Add a[i] and drop a[i - k] in a single expression — two cells
    // touched, never k — then a.setWindow(i - k + 1, i) so the band follows the sum.
    // If this window beats best, remember its sum and its start, and move the 'result'
    // marks onto cellsFrom(bestStart) so the picture shows which window is winning.
    viz.step('slide')
  }

  a.clearWindow()
  return best / k
}
`

export const maximumAverageSubarrayI: ProblemDefinition = {
  id: 'p643',
  leetcode: 643,
  slug: 'maximum-average-subarray-i',
  title: 'Maximum Average Subarray I',
  difficulty: 'easy',
  category: 'sliding-window',
  statement:
    'Given an integer array `nums` and an integer `k`, find the contiguous subarray of length ' +
    'exactly `k` with the largest average, and return that average. Values may be negative, and ' +
    'an answer within `1e-5` of the true one is accepted.',
  structures: ['array'],
  // `approx`, not `deep`. The answer is a division, so the expected value in a case is a decimal
  // literal somebody typed — `two thirds of a window` below is written to the precision LeetCode
  // itself accepts and would fail an exact comparison while being the right answer.
  comparator: 'approx',
  entry: 'findMaxAverage',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    {
      name: 'example',
      args: [[1, 12, -5, -6, 50, 3], 4],
      expected: 12.75,
      tags: ['example'],
    },
    { name: 'single element, k = 1', args: [[5], 1], expected: 5, tags: ['example'] },
    {
      // k = 1 degenerates to "find the maximum", and the band is one cell wide.
      name: 'k = 1 is just the maximum',
      args: [[3, -1, 7, 2], 1],
      expected: 7,
      tags: ['edge'],
    },
    {
      // The case a `best = 0` start silently gets wrong: it returns 0, which is larger than
      // every real window average, and every other case here still passes.
      name: 'all negative — zero is not a floor',
      args: [[-3, -9, -1, -8], 2],
      expected: -4.5,
      tags: ['edge'],
    },
    {
      // k = n: the window is built and never slides. The main loop body never runs.
      name: 'k equals the whole array',
      args: [[4, 0, 4, 0], 4],
      expected: 2,
      tags: ['edge'],
    },
    {
      // No window ever beats the first, so `best` and its marks never move for the whole scan.
      name: 'all equal — best never improves',
      args: [[7, 7, 7, 7, 7], 3],
      expected: 7,
      tags: ['edge'],
    },
    {
      name: 'best window at the very start',
      args: [[9, 9, 1, 1, 1], 2],
      expected: 9,
      tags: ['edge'],
    },
    {
      name: 'best window at the very end',
      args: [[1, 1, 1, 9, 9], 2],
      expected: 9,
      tags: ['edge'],
    },
    {
      // 7/3. Written to five decimals on purpose: this is the case that proves the comparator is
      // `approx`, and it mirrors the 1e-5 tolerance the real judge uses.
      name: 'average is not exactly representable',
      args: [[0, 1, 1, 3, 3], 3],
      expected: 2.33333,
      tags: ['edge'],
    },
    {
      name: 'long run — 160 slides where best does not change',
      args: [longRun, 40],
      expected: 100,
      tags: ['large'],
    },
  ],
  hints: [
    'The next window holds the same elements as this one, minus the leftmost and plus one new ' +
      'element on the right — so almost all of the work of re-adding them is wasted.',
    'Prime a running `sum` with the first k values, then slide: `sum += nums[i] - nums[i - k]`. ' +
      'That is one add and one subtract per element, whatever k is.',
    'Track the best *sum* and divide once at the end, and start `best` at the first window’s ' +
      'sum rather than at 0 — every value can be negative, so 0 would win outright.',
  ],
}
