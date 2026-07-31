import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 724 — Find Pivot Index.
 *
 * The first `prefix-sum` problem in the set, and the animation it has to justify is not "the two
 * sums are equal" — that is just the stopping condition — but "the running sum from the left and
 * the running sum from the right are two shrinking/growing regions of the *same* array, and they
 * meet at the pivot." A `watch` panel with two numbers ticking would state the algorithm; it
 * would not show *why* one pass is enough.
 *
 * So every index `i` the scan visits gets three simultaneous facts on screen, not one:
 *
 *   - `nums` itself, with every index left of `i` marked `visited` — the region already folded
 *     into `leftSum`. That region only ever grows, one cell at a time.
 *   - a dashed `window` over every index right of `i` — the region `rightSum` describes. That
 *     region only ever shrinks, one cell at a time, and it is never re-summed to get there:
 *     `rightSum = total - leftSum - nums[i]` is read straight off two numbers already computed.
 *   - the `i` cursor sitting in the one cell that belongs to neither region — the candidate.
 *
 * The picture is the proof that a second pass was never needed: at every step the `visited`
 * region plus the `window` plus the single cursor cell already accounts for the whole array, so
 * there is nothing left for a hypothetical "sum the right side" loop to compute that has not
 * already been named. `tests/integration/problems/find-pivot-index.test.ts` checks exactly this,
 * at every `read` frame: the marked cells left of `i` sum to `leftSum`, the windowed cells right
 * of `i` sum to `rightSum`, and both match the watch panel. A solution that recomputes both sides
 * with `Array.prototype.reduce` on every index returns the identical answer and is rejected by
 * that check alone, because it never shows either region — see "the check has teeth" below.
 *
 * Two smaller decisions:
 *
 * - `v = nums[i]` is read exactly once per index and reused for both the comparison and the
 *   `leftSum` update, so the whole scan costs exactly `n` reads — the direct proof that this is
 *   one pass, not two.
 * - `windowRightOf` is called once before the loop (everything after index 0) and once at the
 *   tail of every non-pivot step (one cell narrower), rather than being folded into the
 *   comparison — so the band's lifecycle reads the same way `setWindow`/`clearWindow` already do
 *   in `maximum-average-subarray-i.ts`: the band is either exactly the region a number describes,
 *   or it is absent.
 */
export function reference(nums: number[], viz: Viz): number {
  const a = viz.array(nums, { name: 'nums' })
  const total = nums.reduce((sum, v) => sum + v, 0)
  let leftSum = 0
  const i = viz.cursor('i', 0, a)
  // `a.at` costs no frame, so the panel can recompute rightSum on every frame without a read of
  // its own — the number on screen always matches whatever the array is showing that frame.
  viz.watch(() => ({
    leftSum,
    rightSum: i.value < a.length ? total - leftSum - (a.at(i.value) ?? 0) : undefined,
    total,
  }))

  // The region strictly right of idx — the span whose sum *is* rightSum, shown as cells instead
  // of a number nobody can see being added up.
  const windowRightOf = (idx: number): void => {
    if (idx + 1 <= a.length - 1) a.setWindow(idx + 1, a.length - 1)
    else a.clearWindow()
  }
  windowRightOf(0)

  for (i.value = 0; i.value < a.length; i.inc()) {
    const v = a[i.value]
    const rightSum = total - leftSum - v
    if (leftSum === rightSum) {
      a.mark(i.value, 'result', `left ${leftSum} = right ${rightSum}`)
      a.clearWindow()
      viz.step(`index ${i.value}: left ${leftSum} meets right ${rightSum} — pivot`)
      return i.value
    }
    viz.step(`index ${i.value}: left ${leftSum}, right ${rightSum} — keep scanning`)
    leftSum += v
    a.mark(i.value, 'visited', `counted into leftSum (now ${leftSum})`)
    windowRightOf(i.value + 1)
  }

  return -1
}

/**
 * 300 elements, all `1`.
 *
 * `leftSum(i) = i` and `rightSum(i) = 299 - i`, equal only at `i = 149.5` — never an integer, so
 * this is the case where the scan runs to completion without ever finding a pivot. It is the
 * O(n) proof (300 reads, not 300²) and the case where the `visited` region and the `window` both
 * reach their full extent: `visited` ends at all 299 non-final cells and the window is cleared on
 * the very last step, with nothing left over.
 */
const longRun = Array.from({ length: 300 }, () => 1)

const starter = `// Split the array into two running sums. The trick is a single pass: once you know
// the array's total and how much has been summed on the left, the right sum falls out for
// free -- rightSum = total - leftSum - nums[i] -- so nothing is ever re-summed.
export default function pivotIndex(nums: number[], viz: Viz): number {
  const a = viz.array(nums, { name: 'nums' })
  const total = nums.reduce((sum, v) => sum + v, 0)
  let leftSum = 0
  const i = viz.cursor('i', 0, a)
  viz.watch(() => ({
    leftSum,
    rightSum: i.value < a.length ? total - leftSum - (a.at(i.value) ?? 0) : undefined,
    total,
  }))

  // The window is the region strictly right of i -- the span whose sum is rightSum, shown as
  // cells instead of a number nobody can see being added up. It shrinks by one cell every time
  // the scan moves on without finding a pivot.
  const windowRightOf = (idx: number): void => {
    if (idx + 1 <= a.length - 1) a.setWindow(idx + 1, a.length - 1)
    else a.clearWindow()
  }
  windowRightOf(0)

  for (i.value = 0; i.value < a.length; i.inc()) {
    // TODO: read nums[i] once into a local v, then compute rightSum = total - leftSum - v.
    // If rightSum === leftSum, this is the pivot: mark i 'result', a.clearWindow(), and
    // return i.
    //
    // TODO: otherwise, add v to leftSum, mark i 'visited' (it is now counted on the left),
    // and call windowRightOf(i.value + 1) so the band always shows exactly the region right
    // of i -- one cell narrower than the step before.
    viz.step('index ' + i.value)
    break
  }

  return -1
}
`

export const findPivotIndex: ProblemDefinition = {
  id: 'p724',
  leetcode: 724,
  slug: 'find-pivot-index',
  title: 'Find Pivot Index',
  difficulty: 'easy',
  category: 'prefix-sum',
  statement:
    'Given an integer array `nums`, find the leftmost index whose left-hand elements sum to the ' +
    'same total as its right-hand elements (an empty side sums to 0), and return that index. ' +
    'Return `-1` if no such index exists.',
  structures: ['array'],
  comparator: 'deep',
  entry: 'pivotIndex',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    {
      name: 'example',
      args: [[1, 7, 3, 6, 5, 6]],
      expected: 3,
      tags: ['example'],
    },
    {
      name: 'pivot at the very first index',
      args: [[2, 1, -1]],
      expected: 0,
      tags: ['example'],
    },
    {
      name: 'no valid answer',
      args: [[1, 2, 3]],
      expected: -1,
      tags: ['example'],
    },
    {
      // Minimum length. Both sides are empty, so a single element is trivially its own pivot.
      name: 'single element',
      args: [[5]],
      expected: 0,
      tags: ['edge'],
    },
    {
      // rightSum is always 0 at the last index — the interesting case is a left side that also
      // happens to sum to 0.
      name: 'pivot at the very last index',
      args: [[1, -1, 0]],
      expected: 2,
      tags: ['edge'],
    },
    {
      name: 'all values equal',
      args: [[3, 3, 3, 3, 3]],
      expected: 2,
      tags: ['edge'],
    },
    {
      // Every index here is a valid pivot (leftSum = rightSum = 0 everywhere), so this is the
      // case that would silently pass with the *wrong* index if the scan did not stop at the
      // first match.
      name: 'zeros present — leftmost pivot wins immediately',
      args: [[0, 0, 0, 0]],
      expected: 0,
      tags: ['edge'],
    },
    {
      // Indices 2, 3 and 4 are all valid pivots; only the leftmost is correct.
      name: 'multiple pivots — leftmost wins',
      args: [[1, -1, 0, 0, 0]],
      expected: 2,
      tags: ['edge'],
    },
    {
      name: 'negative and positive values, symmetric duplicates',
      args: [[1, 2, 3, 4, 3, 2, 1]],
      expected: 3,
      tags: ['edge'],
    },
    {
      name: 'long run — full scan, no pivot exists',
      args: [longRun],
      expected: -1,
      tags: ['large'],
    },
  ],
  hints: [
    'Every element is on the left of `i`, on the right of `i`, or is `i` itself — never more ' +
      'than one of those — so the left sum, the right sum and `nums[i]` always add up to the ' +
      'same fixed total.',
    'Precompute that total once. Then scan left to right keeping a running `leftSum`; at each ' +
      '`i`, `rightSum = total - leftSum - nums[i]` falls out for free, with no second scan.',
    'Return the first `i` where `leftSum === rightSum`. If the scan finishes without one, the ' +
      'answer is `-1`.',
  ],
}
