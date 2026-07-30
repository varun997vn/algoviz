import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 435 — Non-overlapping Intervals.
 *
 * The first problem to drive `VizIntervals` / `IntervalsViz`. Everything they had before this was
 * a two-item hand-built snapshot in the DOM test, so this is also the first time the lane packing
 * has been asked to lay out a genuinely overlapping set.
 *
 * **What has to be visible.** "Remove the fewest" is the same question as "keep the most", and the
 * whole trick is the order you consider candidates in: sort by **end** time and greedily keep
 * anything that starts at or after the last kept interval's end. The reason that works — always
 * keeping the interval that frees the timeline soonest — is invisible unless the picture shows the
 * running boundary against each candidate. There is no vertical-rule affordance on the intervals
 * timeline (see the API note below), so the boundary is shown two ways instead:
 *
 *  - `iv.compare(lastKept, i)` lights **both bars in the same frame** — the incumbent whose right
 *    edge *is* the boundary, and the candidate being judged against it. That single frame is the
 *    greedy decision, and it is why the guard is not written as two lone reads.
 *  - `lastEnd` is watched, so the number beside the picture is the x-coordinate of that right edge.
 *
 * **The lane packing does the rest, for free, and this is the nicest thing about the picture.**
 * `IntervalsViz` packs items into lanes greedily in array order: an item goes into the first lane
 * whose last interval ends at or before this one starts. Once the items are sorted by end, that
 * recurrence for lane 0 is *character for character* the accept test this algorithm runs. So after
 * the sort, **lane 0 — the top row — is exactly the set the algorithm keeps**, and every bar the
 * algorithm removes is a bar pushed down into a lower lane. The viewer sees a single unbroken
 * chain of green forming along the top row while the rejects pile up beneath it. Nothing had to be
 * added to the visualizer to get that; it falls out of sorting by end, which is the point.
 *
 * That also shows why sorting by *start* would be wrong, on the `sorting by start would keep the
 * wrong one` case: `[1,100]` is examined **last**, and the one bar that spans the entire timeline
 * is the one thrown away. Start-sorted, that monster would have been kept first and would have
 * evicted both of the small intervals that fit beside each other.
 *
 * **The sort is not animated, deliberately.** Two reasons. Structurally, a bar's position on this
 * timeline is a function of its `start`/`end` values, so permuting the array moves nothing
 * horizontally — the only visible effect of a `reorder()` frame is bars hopping between lanes,
 * which reads as noise, not as an ordering being established. And pedagogically, `Array#sort` is
 * not the algorithm being taught: the interesting part starts *after* the input is ordered. So the
 * structure is built already sorted and the first frames the viewer sees are the scan.
 *
 * **Mark vocabulary.** `result` = kept, `excluded` = removed, and both are permanent; `active`
 * (from `read`) and `compare` are transient, so a bar goes back to showing its verdict the moment
 * the frame that touched it passes. The two mutations that set state are ordered against the marks
 * on purpose: `lastEnd` moves *before* the `result` mark, so no frame ever shows a bar as kept
 * while the boundary is still behind it; `removed` increments *before* the `excluded` mark, so the
 * counter in the watch panel and the count of red bars can never disagree.
 *
 * **API gaps found while writing this** (reported rather than patched — `packages/tracer` and
 * `packages/viz` are owned elsewhere):
 *
 *  1. `viz.intervals` takes `readonly (readonly [number, number])[]`, but every intervals problem
 *     on LeetCode hands you `number[][]`, which is not assignable to it. Hence the
 *     `.map((p) => [p[0], p[1]] as const)` below, which is pure ceremony.
 *  2. `VizIntervals.read()` returns `IntervalItem | undefined`, so the one line that should read
 *     like the plain solution needs a `!`. `VizStack.requireTop()` is the precedent for a twin
 *     typed present.
 *  3. There is no way to draw the boundary itself on the timeline, which is the one thing this
 *     problem most wants to show.
 */
export function reference(intervals: number[][], viz: Viz): number {
  // Sort by END, not by start. Among intervals that conflict, the one that finishes soonest is
  // always the safest to keep, because it leaves the most room for everything after it.
  const byEnd = [...intervals].sort((a, b) => a[1] - b[1])
  const iv = viz.intervals(
    byEnd.map((p) => [p[0], p[1]] as const),
    { name: 'intervals (sorted by end)' },
  )

  // The boundary: the right edge of the interval we kept most recently, and the only thing the
  // next decision depends on. `null` until something is kept — deliberately not `-Infinity`,
  // which is not representable in a plain-JSON snapshot and so cannot be watched honestly.
  let lastEnd: number | null = null
  // Its *index*, which exists only so the picture can light the incumbent next to the candidate.
  // With a boundary marker on the timeline this variable would not need to exist.
  let lastKept = -1
  let removed = 0
  viz.watch(() => ({ lastEnd, removed }))

  for (let i = 0; i < iv.length; i += 1) {
    const cur = iv.read(i)!
    if (lastKept >= 0) {
      // One frame, both bars lit: the incumbent's right edge against the candidate's left edge.
      // This is the entire decision, and written as two separate reads it would never appear on
      // screen *as* a comparison.
      iv.compare(lastKept, i, `does [${cur.start},${cur.end}] start at or after ${lastEnd}?`)
    }

    if (lastEnd === null || cur.start >= lastEnd) {
      lastEnd = cur.end
      lastKept = i
      iv.mark(i, 'result', 'kept')
      viz.step(
        `keep [${cur.start},${cur.end}] — it starts at or after the boundary, so the boundary moves to ${cur.end}`,
      )
    } else {
      removed += 1
      iv.mark(i, 'excluded', 'removed')
      viz.step(
        `remove [${cur.start},${cur.end}] — it starts at ${cur.start}, before the boundary ${lastEnd}, so it overlaps something already kept`,
      )
    }
  }

  // Say what the two colours add up to. `iv.length - removed` is the kept count, and those bars
  // form one unbroken non-overlapping chain left to right along the top of the timeline.
  viz.step(
    `${removed} removed, ${iv.length - removed} kept — the kept intervals form a single chain along the timeline with no two of them overlapping`,
  )

  return removed
}

/** 50 intervals of width 3 stepping one unit at a time: keep every third, remove the other 33. */
const staircase = Array.from({ length: 50 }, (_, i) => [i, i + 3])

const starter = `// Removing the fewest intervals is the same as keeping the most, so this is a greedy
// selection problem. The scaffolding sorts by END time before building the picture —
// hint 2 says why that, and not start time, is the whole algorithm.
export default function eraseOverlapIntervals(intervals: number[][], viz: Viz): number {
  const byEnd = [...intervals].sort((a, b) => a[1] - b[1])
  const iv = viz.intervals(byEnd.map((p) => [p[0], p[1]] as const), {
    name: 'intervals (sorted by end)',
  })

  // The boundary: the right edge of the interval kept most recently. null until we keep one.
  let lastEnd: number | null = null
  // Its index, so the picture can light the incumbent beside the candidate.
  let lastKept = -1
  let removed = 0
  viz.watch(() => ({ lastEnd, removed }))

  for (let i = 0; i < iv.length; i += 1) {
    const cur = iv.read(i)!

    // TODO: decide whether to keep or remove interval i.
    //
    // Keep it when it starts at or after the boundary — >=, not >, because intervals that
    // merely touch at an endpoint do not overlap. Keeping it moves the boundary to its end.
    // Otherwise it overlaps something already kept, so count it as removed.
    //
    // Mark the outcome so the picture shows it: iv.mark(i, 'result', 'kept') or
    // iv.mark(i, 'excluded', 'removed'). Update lastEnd/removed *before* the mark, so no
    // frame ever shows a verdict the numbers beside it do not agree with.
    //
    // For the comparison itself prefer iv.compare(lastKept, i, '...') over reading the two
    // ends separately: one frame with both bars lit instead of two frames showing one each.
    viz.step('interval ' + i)
  }

  return removed
}
`

export const nonOverlappingIntervals: ProblemDefinition = {
  id: 'p435',
  leetcode: 435,
  slug: 'non-overlapping-intervals',
  title: 'Non-overlapping Intervals',
  difficulty: 'medium',
  category: 'intervals',
  statement:
    'Given an array `intervals` where `intervals[i] = [start, end]`, return the **minimum** ' +
    'number of intervals you have to remove so that no two of the remaining intervals overlap. ' +
    'Intervals that only touch at an endpoint do **not** overlap: `[1,2]` and `[2,3]` can both ' +
    'stay.',
  structures: ['intervals'],
  comparator: 'deep',
  entry: 'eraseOverlapIntervals',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    {
      name: 'example — one interval spans two others',
      args: [
        [
          [1, 2],
          [2, 3],
          [3, 4],
          [1, 3],
        ],
      ],
      expected: 1,
      tags: ['example'],
    },
    {
      name: 'identical duplicates — all but one must go',
      args: [
        [
          [1, 2],
          [1, 2],
          [1, 2],
        ],
      ],
      expected: 2,
      tags: ['example'],
    },
    {
      name: 'touching at an endpoint is not an overlap',
      args: [
        [
          [1, 2],
          [2, 3],
        ],
      ],
      expected: 0,
      tags: ['example', 'edge'],
    },
    { name: 'a single interval', args: [[[1, 2]]], expected: 0, tags: ['edge'] },
    {
      name: 'already disjoint with gaps — nothing to remove',
      args: [
        [
          [1, 2],
          [3, 4],
          [5, 6],
          [7, 8],
        ],
      ],
      expected: 0,
      tags: ['edge'],
    },
    {
      name: 'one interval contains another',
      args: [
        [
          [1, 10],
          [2, 3],
        ],
      ],
      expected: 1,
      tags: ['edge'],
    },
    {
      name: 'fully nested — each interval contains the next',
      args: [
        [
          [1, 100],
          [2, 50],
          [3, 10],
          [4, 5],
        ],
      ],
      expected: 3,
      tags: ['edge'],
    },
    {
      name: 'sorting by start would keep the wrong one',
      args: [
        [
          [1, 100],
          [2, 3],
          [3, 4],
        ],
      ],
      expected: 1,
      tags: ['edge'],
    },
    {
      name: 'a chain where every interval overlaps its neighbour',
      args: [
        [
          [1, 5],
          [2, 6],
          [3, 7],
          [4, 8],
        ],
      ],
      expected: 3,
      tags: ['edge'],
    },
    {
      name: 'ties on the end time',
      args: [
        [
          [1, 3],
          [2, 3],
          [3, 4],
        ],
      ],
      expected: 1,
      tags: ['edge'],
    },
    {
      name: 'constraint bounds, touching at zero',
      args: [
        [
          [-50000, 0],
          [0, 50000],
        ],
      ],
      expected: 0,
      tags: ['edge'],
    },
    {
      name: 'staircase of 50 — keep every third',
      args: [staircase],
      expected: 33,
      tags: ['large'],
    },
  ],
  hints: [
    'Removing the fewest intervals is the same question as *keeping the most*: you want the ' +
      'largest set of intervals no two of which overlap, and the answer is everything else.',
    'Build that set greedily by scanning the intervals in sorted order — but sort them by their ' +
      '**end** time, not their start. When two intervals conflict you can only keep one, and the ' +
      'one that finishes soonest leaves the most room for everything that comes after it. Sorting ' +
      'by start lets one long interval get picked first and block several short ones.',
    'Track `lastEnd`, the end of the interval you kept most recently. Keep the next interval ' +
      'when `start >= lastEnd` and set `lastEnd = end`; otherwise it overlaps something you have ' +
      'already kept, so count it as removed. `>=` and not `>`, because touching at an endpoint ' +
      'is not an overlap.',
  ],
}
