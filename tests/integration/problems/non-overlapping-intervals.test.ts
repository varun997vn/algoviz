import { describe, expect, it } from 'vitest'
import { executeRun } from '@algoviz/runner'
import { requireProblem } from '@algoviz/problems'
import { TraceReader, type StructureSnapshot, type Trace } from '@algoviz/tracer'

/**
 * LeetCode 435 — Non-overlapping Intervals.
 *
 * The load-bearing tests in this file are `expectGreedyPictureFaithful` and
 * `expectKeptSetOptimal`. Everything else here would also pass for a solution that computed the
 * right number arithmetically and drew nothing — which is exactly the failure this problem is
 * most exposed to, because the answer is a single integer. `describe('the picture checks have
 * teeth')` runs two such solutions and proves they are rejected.
 *
 * The invariants, in the order they matter:
 *
 *  - **Every bar ends with exactly one verdict.** `result` (kept) or `excluded` (removed), never
 *    both, never neither. `excluded` count == the returned number, so the picture and the answer
 *    cannot drift apart.
 *  - **The kept set is pairwise disjoint at every frame**, not just at the end — the green chain
 *    is correct while it is being built, not only once it is finished. Touching at an endpoint is
 *    *not* an overlap, which is the single most common way this problem is got wrong, so the
 *    predicate here is `a.start < b.end && b.start < a.end` and the `touching at an endpoint`
 *    case would fail a strict-inequality version.
 *  - **The kept set is maximal.** No excluded interval could be added back without colliding.
 *    That is what makes "minimum removals" checkable without trusting the solution's own count.
 *  - **The boundary never goes backwards.** `lastEnd` in the watch panel is non-decreasing, and
 *    at every frame equals the largest end among the bars currently marked kept — so the number
 *    beside the picture is always the right edge of the rightmost green bar, which is what the
 *    whole animation is about.
 */

const PROBLEM = 'non-overlapping-intervals'
const IVL = 'intervals (sorted by end)'

interface Ivl {
  start: number
  end: number
}

type IntervalsSnapshot = Extract<StructureSnapshot, { kind: 'intervals' }>

function idOf(trace: Trace, name: string): string {
  const meta = trace.structures.find((s) => s.name === name)
  if (!meta) {
    throw new Error(
      `no structure named "${name}" — got ${trace.structures.map((s) => s.name).join(', ')}`,
    )
  }
  return meta.id
}

function intervalsAt(reader: TraceReader, frame: number): IntervalsSnapshot | undefined {
  const snap = reader.structureAt(idOf(reader.trace, IVL), frame)
  return snap?.kind === 'intervals' ? snap : undefined
}

/** Touching at an endpoint is not an overlap — `[1,2]` and `[2,3]` may both stay. */
function overlap(a: Ivl, b: Ivl): boolean {
  return a.start < b.end && b.start < a.end
}

function persistent(snap: IntervalsSnapshot, cls: string): number[] {
  return snap.marks
    .filter((m) => m.class === cls && !m.transient)
    .map((m) => m.index)
    .sort((x, y) => x - y)
}

/**
 * Everything the animation claims, checked on every frame of a trace.
 *
 * Written to throw plain assertion failures with the frame number in the message, because the
 * frame it first breaks on is the only useful thing to know.
 */
function expectGreedyPictureFaithful(trace: Trace, returned: number, label: string): void {
  const reader = new TraceReader(trace)
  const last = reader.frameCount - 1
  const final = intervalsAt(reader, last)
  expect(final, `${label}: no intervals snapshot on the final frame`).toBeDefined()
  const n = final!.items.length

  // The sort is what makes the greedy correct, and it has to be true of the *picture*, not just
  // of some array the solution kept to itself.
  for (let k = 1; k < n; k += 1) {
    expect(
      final!.items[k]!.end,
      `${label}: the timeline is not sorted by end — item ${k - 1} ends at ${final!.items[k - 1]!.end}, item ${k} at ${final!.items[k]!.end}`,
    ).toBeGreaterThanOrEqual(final!.items[k - 1]!.end)
  }

  let previousBoundary: number | null = null
  let framesChecked = 0

  for (let i = 0; i <= last; i += 1) {
    const snap = intervalsAt(reader, i)
    if (!snap) continue
    framesChecked += 1

    const kept = persistent(snap, 'result')
    const removed = persistent(snap, 'excluded')

    // No bar ever wears two verdicts at once, and the transient layer never leaks into state.
    expect(
      kept.filter((k) => removed.includes(k)),
      `${label} frame ${i}: interval(s) marked both kept and removed`,
    ).toEqual([])
    for (const cls of ['active', 'compare'] as const) {
      expect(
        persistent(snap, cls),
        `${label} frame ${i}: a "${cls}" mark survived as persistent state — it must be transient`,
      ).toEqual([])
    }

    // The green chain is disjoint *while it grows*, not only once it is done.
    for (const a of kept) {
      for (const b of kept) {
        if (a >= b) continue
        expect(
          overlap(snap.items[a]!, snap.items[b]!),
          `${label} frame ${i}: kept intervals [${snap.items[a]!.start},${snap.items[a]!.end}] and [${snap.items[b]!.start},${snap.items[b]!.end}] overlap`,
        ).toBe(false)
      }
    }

    // The boundary is the right edge of the rightmost kept bar, and it never retreats.
    const watch = reader.watchAt(i)
    if (watch && 'lastEnd' in watch) {
      const shown = watch['lastEnd'] as number | null
      const fromPicture = kept.length === 0 ? null : Math.max(...kept.map((k) => snap.items[k]!.end))
      expect(
        shown,
        `${label} frame ${i}: watch says lastEnd=${String(shown)}, but the rightmost kept bar ends at ${String(fromPicture)}`,
      ).toBe(fromPicture)
      if (shown !== null) {
        if (previousBoundary !== null) {
          expect(
            shown,
            `${label} frame ${i}: the boundary went backwards, ${previousBoundary} -> ${shown}`,
          ).toBeGreaterThanOrEqual(previousBoundary)
        }
        previousBoundary = shown
      }
      // The counter beside the picture counts exactly the red bars, on every frame.
      expect(
        watch['removed'],
        `${label} frame ${i}: watch says ${String(watch['removed'])} removed, picture shows ${removed.length}`,
      ).toBe(removed.length)
    }
  }

  expect(framesChecked, `${label}: no frame carried the intervals structure`).toBeGreaterThan(0)

  // Every bar reaches a verdict, and the red ones are the answer.
  const kept = persistent(final!, 'result')
  const removed = persistent(final!, 'excluded')
  expect(
    [...kept, ...removed].sort((a, b) => a - b),
    `${label}: ${kept.length} kept + ${removed.length} removed does not account for all ${n} intervals`,
  ).toEqual([...Array(n).keys()])
  expect(
    removed,
    `${label}: the picture removes ${removed.length} intervals but the solution returned ${returned}`,
  ).toHaveLength(returned)
}

/**
 * The kept set is a *maximum* non-overlapping subset, checked without trusting the solution.
 *
 * Pairwise disjointness alone is satisfied by keeping one interval and throwing away the rest,
 * which would return a large number and draw a perfectly consistent picture. Maximality — no
 * removed interval could be put back — is the property that makes the count minimal.
 */
function expectKeptSetOptimal(trace: Trace, label: string): void {
  const reader = new TraceReader(trace)
  const final = intervalsAt(reader, reader.frameCount - 1)!
  const kept = persistent(final, 'result').map((i) => final.items[i]!)
  const removed = persistent(final, 'excluded').map((i) => final.items[i]!)

  for (const gone of removed) {
    expect(
      kept.some((k) => overlap(k, gone)),
      `${label}: [${gone.start},${gone.end}] was removed but collides with nothing that was kept`,
    ).toBe(true)
  }

  // And independently: the greedy answer equals the true optimum, computed here by a different
  // method (sweep the kept-candidates in end order with no reference to the trace's decisions).
  const sorted = [...final.items].sort((a, b) => a.end - b.end)
  let boundary: number | null = null
  let optimum = 0
  for (const item of sorted) {
    if (boundary === null || item.start >= boundary) {
      boundary = item.end
      optimum += 1
    }
  }
  expect(kept, `${label}: kept ${kept.length} intervals, optimum keeps ${optimum}`).toHaveLength(
    optimum,
  )
}

describe('Non-overlapping Intervals — reference trace semantics', () => {
  const result = executeRun({ problem: PROBLEM, useReference: true, caseIndex: 0 })
  const caseResult = result.results[0]!
  const trace = caseResult.trace
  const reader = new TraceReader(trace)
  const last = reader.frameCount - 1
  const returned = caseResult.returned as number

  it('returns the known answer for the canonical example', () => {
    expect(result.diagnostics).toEqual([])
    expect(caseResult.passed).toBe(true)
    expect(returned).toBe(1)
  })

  it('animates exactly the declared structures', () => {
    // The first problem to drive VizIntervals at all, so a run that animates nothing would still
    // return 1 and look fine everywhere else.
    expect(trace.structures.map((s) => `${s.name}:${s.kind}`)).toEqual([`${IVL}:intervals`])
  })

  it('holds every claim the picture makes, on every frame', () => {
    expectGreedyPictureFaithful(trace, returned, 'example')
    expectKeptSetOptimal(trace, 'example')
  })

  it('shows the timeline sorted by end, which is the whole trick', () => {
    // [[1,2],[2,3],[3,4],[1,3]] sorted by end (stably) is [1,2] [2,3] [1,3] [3,4]. The bar that
    // gets thrown away is [1,3], and it is examined third — after both of the intervals it
    // collides with have already been kept.
    const first = intervalsAt(reader, 0)!
    expect(first.items.map((i) => [i.start, i.end])).toEqual([
      [1, 2],
      [2, 3],
      [1, 3],
      [3, 4],
    ])
  })

  it('gives every interval a verdict and removes exactly the one that collides', () => {
    const final = intervalsAt(reader, last)!
    expect(persistent(final, 'excluded')).toEqual([2])
    expect(persistent(final, 'result')).toEqual([0, 1, 3])
  })

  it('puts the incumbent and the candidate on screen together, in one frame', () => {
    // The comparison against the running boundary is the only decision this algorithm makes.
    // Written as two separate reads it would emit two frames, neither of which ever showed the
    // boundary and the candidate side by side — and `compare` would never appear in the trace.
    const compareFrames = trace.frames.filter((f) => f.op === 'compare')
    // One per interval after the first: the first has no incumbent to compare against.
    expect(compareFrames).toHaveLength(3)
    for (const frame of compareFrames) {
      const snap = frame.snapshots[idOf(trace, IVL)]
      expect(snap?.kind).toBe('intervals')
      const lit = snap?.kind === 'intervals' ? snap.marks.filter((m) => m.class === 'compare') : []
      expect(lit, `frame ${frame.index} lights ${lit.length} bars`).toHaveLength(2)
      expect(lit.every((m) => m.transient)).toBe(true)
    }
  })

  it('never leaves a bar lit after the frame that touched it', () => {
    // Trace invariant 3: the transient layer strips, the verdict underneath survives. A kept bar
    // is briefly re-lit as `compare` when it is the incumbent; it must be green again next frame.
    const finalKept = persistent(intervalsAt(reader, last)!, 'result')
    expect(finalKept.length).toBeGreaterThan(1)
    const comparedIncumbents = trace.frames
      .filter((f) => f.op === 'compare')
      .flatMap((f) => {
        const snap = f.snapshots[idOf(trace, IVL)]
        return snap?.kind === 'intervals' ? snap.marks.filter((m) => m.class === 'compare').map((m) => m.index) : []
      })
    // Bar 0 is the incumbent for the very first comparison and is kept, so it is the witness.
    expect(comparedIncumbents).toContain(0)
    for (let i = 0; i <= last; i += 1) {
      const snap = intervalsAt(reader, i)
      if (!snap) continue
      const lit = snap.marks.filter((m) => m.class === 'compare')
      expect(
        lit.length === 0 || trace.frames[i]?.op === 'compare',
        `frame ${i}: a compare highlight survived past its own frame`,
      ).toBe(true)
    }
  })

  it('narrates every decision plus a closing summary', () => {
    const steps = reader.stepFrames()
    const labels = steps.map((i) => trace.frames[i]!.label ?? '')
    expect(steps).toHaveLength(5) // four intervals, one summary
    expect(labels.filter((l) => l.startsWith('keep '))).toHaveLength(3)
    expect(labels.filter((l) => l.startsWith('remove '))).toHaveLength(1)
    expect(labels[labels.length - 1]).toMatch(/^1 removed, 3 kept/)
  })

  it('names the boundary in the narration, not just in the watch panel', () => {
    // "it starts at 1, before the boundary 3" — the reject branch is where a viewer needs to be
    // told *what* it collided with; without the number the frame just shows a bar turning red.
    const labels = reader.stepFrames().map((i) => trace.frames[i]!.label ?? '')
    expect(labels.filter((l) => /before the boundary \d+/.test(l)).length).toBeGreaterThan(0)
    expect(labels.filter((l) => /boundary moves to \d+/.test(l)).length).toBeGreaterThan(0)
  })

  it('reports the answer in the watch panel', () => {
    const watch = reader.watchAt(last)!
    expect(watch['removed']).toBe(returned)
    expect(watch['lastEnd']).toBe(4)
  })
})

describe('the picture checks have teeth', () => {
  // An invariant test that cannot fail reads like evidence and is worse than no test. The answer
  // here is a single integer, so a solution can compute it correctly while animating nothing at
  // all; both of these do exactly that and must be rejected.

  it('rejects a solution that counts the overlaps but marks nothing', () => {
    const source = `
export default function eraseOverlapIntervals(intervals, viz) {
  const byEnd = [...intervals].sort((a, b) => a[1] - b[1])
  const iv = viz.intervals(byEnd.map((p) => [p[0], p[1]]), { name: '${IVL}' })
  let lastEnd = null
  let removed = 0
  for (let i = 0; i < iv.length; i += 1) {
    const cur = iv.read(i)
    if (lastEnd === null || cur.start >= lastEnd) lastEnd = cur.end
    else removed += 1
    viz.step('interval ' + i)
  }
  return removed
}
`
    const run = executeRun({ problem: PROBLEM, source, caseIndex: 0 })
    expect(run.diagnostics).toEqual([])
    // It gets the right answer, and it does create the structure — the trace looks populated.
    expect(run.results[0]?.passed).toBe(true)
    expect(() => expectGreedyPictureFaithful(run.results[0]!.trace, 1, 'marks nothing')).toThrow(
      /does not account for all 4 intervals/,
    )
  })

  it('rejects a solution that marks every interval as kept', () => {
    const source = `
export default function eraseOverlapIntervals(intervals, viz) {
  const byEnd = [...intervals].sort((a, b) => a[1] - b[1])
  const iv = viz.intervals(byEnd.map((p) => [p[0], p[1]]), { name: '${IVL}' })
  let lastEnd = null
  let removed = 0
  for (let i = 0; i < iv.length; i += 1) {
    const cur = iv.read(i)
    if (lastEnd === null || cur.start >= lastEnd) lastEnd = cur.end
    else removed += 1
    iv.mark(i, 'result', 'kept')
    viz.step('interval ' + i)
  }
  return removed
}
`
    const run = executeRun({ problem: PROBLEM, source, caseIndex: 0 })
    expect(run.diagnostics).toEqual([])
    expect(run.results[0]?.passed).toBe(true)
    expect(() => expectGreedyPictureFaithful(run.results[0]!.trace, 1, 'marks everything')).toThrow(
      /overlap/,
    )
  })

  it('rejects a picture that keeps a valid but non-maximal set', () => {
    // Correct-looking and internally consistent: it keeps only the first interval, marks the rest
    // removed, and returns a number that matches its own picture exactly. It is simply not the
    // minimum, and only `expectKeptSetOptimal` can tell.
    const source = `
export default function eraseOverlapIntervals(intervals, viz) {
  const byEnd = [...intervals].sort((a, b) => a[1] - b[1])
  const iv = viz.intervals(byEnd.map((p) => [p[0], p[1]]), { name: '${IVL}' })
  let removed = 0
  let lastEnd = null
  viz.watch(() => ({ lastEnd, removed }))
  for (let i = 0; i < iv.length; i += 1) {
    const cur = iv.read(i)
    if (i === 0) { lastEnd = cur.end; iv.mark(i, 'result', 'kept') }
    else { removed += 1; iv.mark(i, 'excluded', 'removed') }
    viz.step('interval ' + i)
  }
  return removed
}
`
    const run = executeRun({ problem: PROBLEM, source, caseIndex: 0 })
    expect(run.diagnostics).toEqual([])
    // Wrong answer, so the run itself fails — but the picture is self-consistent, which is the
    // point: the frame-level checks pass and only optimality catches it.
    expect(run.results[0]?.passed).toBe(false)
    expectGreedyPictureFaithful(run.results[0]!.trace, run.results[0]!.returned as number, 'lazy')
    expect(() => expectKeptSetOptimal(run.results[0]!.trace, 'lazy')).toThrow(
      /collides with nothing that was kept|optimum keeps/,
    )
  })
})

describe('Non-overlapping Intervals — the invariants hold on every case', () => {
  const problem = requireProblem(PROBLEM)
  const result = executeRun({ problem: PROBLEM, useReference: true })

  it('passes all of its own cases', () => {
    expect(result.diagnostics).toEqual([])
    expect(result.results.map((r) => [r.name, r.passed])).toEqual(
      problem.cases.map((c) => [c.name, true]),
    )
  })

  for (const [index, testCase] of problem.cases.entries()) {
    it(`${testCase.name}`, () => {
      const caseResult = result.results[index]!
      const n = (testCase.args[0] as number[][]).length
      const returned = caseResult.returned as number

      expectGreedyPictureFaithful(caseResult.trace, returned, testCase.name)
      expectKeptSetOptimal(caseResult.trace, testCase.name)

      // O(n) after the sort: a fixed handful of frames per interval, never a nested scan.
      expect(
        caseResult.frameCount,
        `${testCase.name}: ${caseResult.frameCount} frames for n=${n}`,
      ).toBeLessThanOrEqual(6 * n + 10)
    })
  }

  it('keeps both intervals that only touch at an endpoint', () => {
    // The single most common way this problem is got wrong: `[1,2]` and `[2,3]` do not overlap,
    // so a `>` where the predicate needs `>=` removes one of them. The answer is 0 and the
    // picture must show two kept bars and no red one.
    const index = problem.cases.findIndex((c) => c.name.startsWith('touching at an endpoint'))
    const caseResult = result.results[index]!
    const reader = new TraceReader(caseResult.trace)
    const final = intervalsAt(reader, reader.frameCount - 1)!
    expect(caseResult.returned).toBe(0)
    expect(persistent(final, 'result')).toEqual([0, 1])
    expect(persistent(final, 'excluded')).toEqual([])
  })

  it('throws away the one bar that spans the whole timeline, not the two that fit', () => {
    // [[1,100],[2,3],[3,4]] — sorted by end, the monster is examined last and is the only bar
    // removed. Start-sorted it would have been kept first and evicted both of the others, and
    // this is the case in the set where that difference is visible in the picture.
    const index = problem.cases.findIndex((c) => c.name === 'sorting by start would keep the wrong one')
    const caseResult = result.results[index]!
    const reader = new TraceReader(caseResult.trace)
    const final = intervalsAt(reader, reader.frameCount - 1)!
    expect(caseResult.returned).toBe(1)
    const removed = persistent(final, 'excluded').map((i) => final.items[i]!)
    expect(removed.map((r) => [r.start, r.end])).toEqual([[1, 100]])
  })

  it('removes every duplicate but one', () => {
    const index = problem.cases.findIndex((c) => c.name.startsWith('identical duplicates'))
    const caseResult = result.results[index]!
    const reader = new TraceReader(caseResult.trace)
    const final = intervalsAt(reader, reader.frameCount - 1)!
    expect(persistent(final, 'result')).toHaveLength(1)
    expect(persistent(final, 'excluded')).toHaveLength(2)
  })

  it('keeps every third bar of the staircase and the boundary steps by three', () => {
    // 50 intervals [i, i+3]: the boundary advances 0 -> 3 -> 6 -> ... -> 48, and the kept bars
    // are exactly the multiples of 3. A solution that is off by one on `>=` keeps a different
    // stride, which is invisible in the returned integer alone on most cases but not on this one.
    const index = problem.cases.findIndex((c) => c.tags?.includes('large'))
    const caseResult = result.results[index]!
    const reader = new TraceReader(caseResult.trace)
    const final = intervalsAt(reader, reader.frameCount - 1)!
    const kept = persistent(final, 'result').map((i) => final.items[i]!)
    expect(kept.map((k) => k.start)).toEqual(Array.from({ length: 17 }, (_, k) => k * 3))
    expect(caseResult.returned).toBe(33)
  })
})
