import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 215 — Kth Largest Element in an Array.
 *
 * The first problem to drive `VizHeap`, and the reason a heap visualizer is worth having: the
 * answer is a single number, so *nothing* about the return value explains why a heap was the
 * right tool. What has to be on screen is the invariant — **a min-heap capped at k holds the k
 * largest values seen so far, so its root is the k-th largest** — and the only way to see that
 * it is maintained is to watch the root leave the moment something bigger arrives, and watch the
 * replacement sift down until the smallest survivor is back on top.
 *
 * Three panels split the job, the way Daily Temperatures splits stack and readings:
 *
 *  - `nums` carries the scan. A value that loses to the root is marked `excluded` on the spot,
 *    and that verdict is permanent: the root only ever rises, so a value that could not beat it
 *    then can never beat it later. Cells that are *not* excluded are the ones that got into the
 *    heap at some point — which is not the same as still being in it, so the array deliberately
 *    makes no membership claim. Membership is what the heap panel is for, and duplicated values
 *    make "which cell did that evicted 5 come from?" unanswerable without bookkeeping that would
 *    not survive the "reads like the interview solution" rule.
 *  - `the k largest so far` is the heap itself, rendered as its array *and* the implied tree.
 *    Every comparison and every swap of both sifts is a frame, so the restoration of the heap
 *    property after an eviction is watchable rather than instantaneous.
 *  - `k-th largest so far` is the payoff panel: once the heap is full, the root is written into
 *    the cell for the element just processed. It is blank until then — with fewer than k values
 *    seen there is no k-th largest yet, and `{ fill: null }` says so instead of asserting a zero
 *    that is indistinguishable from a real answer of zero. Reading it left to right shows the
 *    quantity the algorithm is tracking climbing to the returned value, and it is the panel that
 *    makes the invariant checkable frame by frame instead of only at the end.
 *
 * `peek()` is the silent twin, used to write the payoff panel — a recording read there would
 * double every frame. The *guard* uses `compareRoot`, which is the recording one: "is x bigger
 * than the smallest I am keeping?" is the only decision this algorithm makes, and with a silent
 * read it was narrated on every element and lit on none — the heap panel went grey while the
 * caption asserted a comparison the picture never showed.
 *
 * The watch panel reports only `i` and `kept`, both of which are true on every frame. It used to
 * report the k-th largest too, guarded on the heap being *full* — which is not the same as the
 * heap being *settled*, and mid-sift the root is not the minimum. That is the one kind of lag
 * ordering cannot fix, because a sampler fires on every frame whatever the solution does.
 */
export function reference(nums: number[], k: number, viz: Viz): number {
  const a = viz.array(nums, { name: 'nums' })
  // A min-heap, capped at k. The root is the weakest value we are still keeping, so it is the
  // first thing to go and it is also, once the heap is full, the answer so far.
  const top = viz.heap<number>([], { name: 'the k largest so far' })
  const kth = viz.array<number>(nums.length, { name: 'k-th largest so far', fill: null })
  const i = viz.cursor('i', 0, a)
  // No `kth` here, deliberately. `top.peek()` is slot 0, which is the minimum only while the heap
  // property holds — and the frames where it deliberately does not are the ones this animation
  // exists for. A watch sampler fires on *every* frame, so mid-sift it reported a number that was
  // not the k-th largest at any point in the run: on `[7,6,5,4]` with k=4 it read 5 for four
  // consecutive frames while the answer was 4. That is not the documented one-frame-per-op lag,
  // which ordering fixes; nothing about ordering helps a sampler that runs unconditionally. The
  // payoff panel below carries the same quantity, is written only from a settled heap, and never
  // lies — so the watch panel keeps what it can state truthfully on every frame and nothing else.
  viz.watch(() => ({ i: i.value, kept: top.size }))

  for (i.value = 0; i.value < a.length; i.inc()) {
    const x = a[i.value]
    let outcome: string
    if (top.size < k) {
      top.push(x)
      outcome = `keeping ${x} — only ${top.size} of ${k} values so far, so nothing can be ruled out yet`
      // `compareRoot` lights the root and returns the ordering, so the guard that *is* this
      // algorithm is one frame showing the value being weighed against the value it is weighed
      // against. `x > (top.peek() as number)` reads the same and shows nothing.
    } else if (top.compareRoot(x) < 0) {
      // The heap is full and `x` beats its weakest member, so that member is out. `pop` lifts the
      // last leaf to the root and sifts it down; `push` puts `x` at the next leaf and sifts it up.
      // Both sifts are frames, which is the entire point of animating this with a heap.
      const evicted = top.pop() as number
      top.push(x)
      outcome =
        `${x} beats the weakest kept value ${evicted} — ${evicted} drops out, ${x} sifts into place, ` +
        `and the ${ordinal(k)} largest is now ${top.peek()}`
    } else {
      a.mark(i.value, 'excluded', `not bigger than the ${ordinal(k)} largest so far`)
      outcome =
        `${x} is not bigger than the ${ordinal(k)} largest so far (${top.peek()}) — the root only ever ` +
        `rises, so ${x} can never reach the top ${k}`
    }

    // Recorded *before* the narration, so the frame carrying the caption also carries the value the
    // caption is about. Written after `viz.step` this landed in its own unnarrated frame, and the
    // panel the problem exists for was one element short on every single narrated frame. The heap
    // has settled by here in all three branches, so nothing is reported early.
    if (top.size === k) kth[i.value] = top.peek() as number
    viz.step(outcome)
  }

  const answer = top.peek() as number
  // The last thing the animation says: of the k values still standing, the one on top is the k-th
  // largest overall. (An earlier version of this comment said the mark had to wait until the end
  // because `VizHeap` marks belong to array slots and do not move when the heap swaps. That was
  // true when this was written and is not any more — `IndexMarkStore` now swaps and moves marks
  // with their values, and the heap tests assert it. Marking mid-run would be safe; it is still
  // done here because the claim only becomes true once the scan is over.)
  top.mark(0, 'result', `the ${ordinal(k)} largest`)
  viz.step(
    `the heap holds the ${k} largest values in ${a.length}, and the smallest of them — its root, ` +
      `${answer} — is the ${ordinal(k)} largest`,
  )
  return answer
}

/** `1st`, `2nd`, `3rd`, `4th`… so the narration does not say "the 1th largest". */
function ordinal(k: number): string {
  const teen = k % 100
  if (teen >= 11 && teen <= 13) return `${k}th`
  return `${k}${['th', 'st', 'nd', 'rd'][k % 10] ?? 'th'}`
}

/**
 * A fixed permutation of 1..120: `(j * 37) % 120 + 1`, and 37 is coprime with 120 so every value
 * appears exactly once. The k-th largest of a permutation of 1..n is `n - k + 1` with no
 * hand-checking, and the order is scrambled enough that the heap keeps evicting throughout —
 * a sorted input would exercise only one branch.
 */
const scrambled = Array.from({ length: 120 }, (_, j) => ((j * 37) % 120) + 1)

const starter = `// Keep a min-heap of at most k values. Because the heap is capped at k and only ever
// holds the largest values seen so far, its root — the *smallest* thing you are keeping —
// is the k-th largest so far. That is the whole trick: to know the k-th largest you never
// need to sort, you only need to know which k values are still in the running.
export default function findKthLargest(nums: number[], k: number, viz: Viz): number {
  const a = viz.array(nums, { name: 'nums' })
  const top = viz.heap<number>([], { name: 'the k largest so far' })
  // { fill: null } seeds the panel blank: before k values have been seen there is no k-th
  // largest yet, and a blank cell says that where a 0 would look like a real answer.
  const kth = viz.array<number>(nums.length, { name: 'k-th largest so far', fill: null })
  const i = viz.cursor('i', 0, a)
  // No kth here: top.peek() is slot 0, which is the smallest value only while the heap property
  // holds, and a watch sampler runs on every frame — including the mid-sift ones where it does
  // not. The panel above reports the same quantity, written only from a settled heap.
  viz.watch(() => ({ i: i.value, kept: top.size }))

  for (i.value = 0; i.value < a.length; i.inc()) {
    const x = a[i.value]
    // TODO: three cases.
    //   - fewer than k values kept: x joins, no question asked.
    //   - x beats the root: the root is no longer in the top k, so pop it and push x.
    //   - otherwise: x loses to the weakest value you are keeping, so it can never be in
    //     the top k — mark it 'excluded' and move on.
    //
    // Use top.compareRoot(x) for the guard, not top.peek(). Both read the root, but
    // compareRoot records a frame with the root lit and returns the ordering the way a
    // comparator does (negative when the root is the smaller). That comparison is the only
    // decision this algorithm makes — with a silent read it is narrated on every element
    // and shown on none, and the heap panel just goes grey while the caption claims a
    // comparison happened.

    // Once the heap is full the root is the answer so far, so record it here — *before* the
    // narration below. Written after the viz.step it lands in its own uncaptioned frame, and
    // every narrated frame then shows this panel one element short of what its caption claims.
    if (top.size === k) kth[i.value] = top.peek() as number
    viz.step('at ' + x)
  }

  // TODO: return the root — the smallest of the k largest values, and mark it 'result' so
  // the final picture says which of the survivors is the answer.
  return 0
}
`

export const kthLargestElementInAnArray: ProblemDefinition = {
  id: 'p215',
  leetcode: 215,
  slug: 'kth-largest-element-in-an-array',
  title: 'Kth Largest Element in an Array',
  difficulty: 'medium',
  category: 'heap-priority-queue',
  statement:
    'Given an integer array `nums` and an integer `k`, return the `k`-th largest element in the ' +
    'array. That is the `k`-th element in sorted-descending order, **not** the `k`-th distinct ' +
    'value — duplicates each take a place. Solve it without sorting the whole array.',
  structures: ['array', 'heap'],
  comparator: 'deep',
  entry: 'findKthLargest',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    { name: 'example', args: [[3, 2, 1, 5, 6, 4], 2], expected: 5, tags: ['example'] },
    {
      name: 'example with duplicates — the 4th largest is a repeated value',
      args: [[3, 2, 3, 1, 2, 4, 5, 5, 6], 4],
      expected: 4,
      tags: ['example'],
    },
    { name: 'k = 1 — just the maximum', args: [[2, 1, 9, 3], 1], expected: 9, tags: ['example'] },
    {
      name: 'single element, k = 1 — the smallest legal input',
      args: [[1], 1],
      expected: 1,
      tags: ['edge'],
    },
    {
      name: 'k = n — the minimum, and the heap never evicts anything',
      args: [[7, 6, 5, 4], 4],
      expected: 4,
      tags: ['edge'],
    },
    {
      name: 'all equal — ties still take separate places',
      args: [[5, 5, 5, 5], 3],
      expected: 5,
      tags: ['edge'],
    },
    {
      name: 'duplicates straddling the boundary',
      args: [[1, 2, 2, 3], 2],
      expected: 2,
      tags: ['edge'],
    },
    {
      name: 'all negative — the k-th largest is the least negative but one',
      args: [[-1, -1, -2, -3], 2],
      expected: -1,
      tags: ['edge'],
    },
    {
      name: 'descending input — the heap fills and then rejects everything after',
      args: [[9, 8, 7, 6, 5], 3],
      expected: 7,
      tags: ['edge'],
    },
    {
      name: 'ascending input — every element after the first k evicts the root',
      args: [[1, 2, 3, 4, 5, 6], 2],
      expected: 5,
      tags: ['edge'],
    },
    {
      name: 'constraint bounds, k in the middle',
      args: [[10000, -10000, 0, 10000, -10000], 3],
      expected: 0,
      tags: ['edge'],
    },
    {
      name: '120 scrambled values, k = 17',
      args: [scrambled, 17],
      expected: 104,
      tags: ['large'],
    },
  ],
  hints: [
    'You do not need the whole array sorted — you only need to know which k values are the ' +
      'largest, and which of *those* is the smallest. Everything else can be thrown away as ' +
      'soon as you see it.',
    'Keep at most k values in a min-heap. Once it holds k values, its root is the smallest ' +
      'thing you are keeping, so it is exactly the k-th largest of everything seen so far.',
    'For each new value: if the heap holds fewer than k, push it. Otherwise compare it with the ' +
      'root — if it is bigger, the root can no longer be in the top k, so pop the root and push ' +
      'the new value; if it is not bigger, discard it, because the root only ever rises. The ' +
      'answer is the root at the end. That is O(n log k) with O(k) memory.',
  ],
}
