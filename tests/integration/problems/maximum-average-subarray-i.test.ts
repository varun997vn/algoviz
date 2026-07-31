import { describe, expect, it } from 'vitest'
import { executeRun } from '@algoviz/runner'
import { requireProblem } from '@algoviz/problems'
import { TraceReader, type StructureSnapshot, type Trace } from '@algoviz/tracer'
import { eachFrame, expectHolds, structureId } from '../invariants.js'

/**
 * LeetCode 643 — Maximum Average Subarray I.
 *
 * The load-bearing tests here are `touches exactly the entering and leaving cell on every slide`
 * and `stays linear in n, whatever k is`. Everything else in this file would also pass for a
 * solution that re-sums all k values for every window — that solution returns the *identical
 * answer on every case*, moves an identical k-wide band by identical single steps, and ends with
 * identical marks. The only thing that separates the algorithm this problem exists to teach from
 * the one it exists to replace is which cells the animation touches and how many frames it takes,
 * so those two are the assertions that carry the weight. `the O(n) claim has teeth` runs the
 * re-sum version to prove they actually reject it rather than reading like they would.
 *
 * The `window` band is the thing being exercised for the first time in the whole problem set, so
 * the invariants on it are stated in full: exactly k wide whenever it exists, advancing by exactly
 * one and never backwards, covering every start, and gone by the last frame.
 *
 * Known viz limitation, deliberately not asserted here because it is not this problem's to fix:
 * `ArrayViz.visibleRange` picks its 240-cell viewport from the *cursors* only, so on the `long
 * run` case (n=300, no cursors) the band slides off the rendered region at start 200 and the
 * picture stops moving. The trace is right; the renderer needs the window as an anchor too.
 */

const PROBLEM = 'maximum-average-subarray-i'
const NUMS = 'nums'

type ArraySnap = Extract<StructureSnapshot, { kind: 'array' }>

function resolve(reader: TraceReader, name: string, frame: number): ArraySnap | undefined {
  const snap = reader.structureAt(structureId(reader.trace, name), frame)
  return snap?.kind === 'array' ? snap : undefined
}

/** The window as resolved at every frame — `undefined` before it is set and after it is cleared. */
function windowPerFrame(reader: TraceReader): (readonly [number, number] | undefined)[] {
  return Array.from({ length: reader.frameCount }, (_, i) => resolve(reader, NUMS, i)?.window)
}

/** Consecutive distinct window positions, i.e. the band's movement history. */
function windowMoves(reader: TraceReader): [number, number][] {
  const moves: [number, number][] = []
  for (const win of windowPerFrame(reader)) {
    if (!win) continue
    const last = moves[moves.length - 1]
    if (last && last[0] === win[0] && last[1] === win[1]) continue
    moves.push([win[0], win[1]])
  }
  return moves
}

/**
 * Which cell each `read` frame lit, in order.
 *
 * Taken from the transient mark the op itself carries rather than from the frame label, so it
 * describes what the *picture* highlighted.
 */
function readIndices(trace: Trace): number[] {
  const id = structureId(trace, NUMS)
  const out: number[] = []
  for (const frame of trace.frames) {
    if (frame.op !== 'read' || frame.structureId !== id) continue
    const snap = frame.snapshots[id]
    if (snap?.kind !== 'array') continue
    for (const mark of snap.marks) if (mark.transient) out.push(mark.index)
  }
  return out
}

/** The contiguous run of `result`-marked cells at the end of a run. */
function markedWindow(reader: TraceReader): number[] {
  const snap = resolve(reader, NUMS, reader.frameCount - 1)
  return (snap?.marks ?? [])
    .filter((m) => m.class === 'result' && !m.transient)
    .map((m) => m.index)
    .sort((a, b) => a - b)
}

/**
 * The band is k wide, starts at 0, and moves right one cell at a time to the last legal start.
 *
 * Shared by the reference and by the adversary in `the O(n) claim has teeth` — the point of that
 * block is that the adversary passes *this* and still fails the two that matter.
 */
function expectWindowSlides(trace: Trace, n: number, k: number, label: string): void {
  const reader = new TraceReader(trace)

  let framesWithWindow = 0
  expectHolds(
    eachFrame(trace, (frame) => {
      const win = frame.get(NUMS, 'array')?.window
      if (!win) return
      framesWithWindow += 1
      const said: string[] = []
      if (win[1] - win[0] + 1 !== k) {
        said.push(`window ${win[0]}..${win[1]} is ${win[1] - win[0] + 1} wide, not k=${k}`)
      }
      if (win[0] < 0) said.push('window starts before the array')
      if (win[1] >= n) said.push('window ends past the array')
      return said
    }),
    `${label}: the window is exactly k wide and in bounds on every frame`,
  )
  expect(framesWithWindow, `${label}: no frame ever carried a window`).toBeGreaterThan(0)

  const moves = windowMoves(reader)
  expect(moves[0], `${label}: the first window is not the first k cells`).toEqual([0, k - 1])
  for (let m = 1; m < moves.length; m += 1) {
    expect(
      moves[m]![0] - moves[m - 1]![0],
      `${label}: window moved from ${moves[m - 1]![0]} to ${moves[m]![0]} — a slide is exactly one cell right`,
    ).toBe(1)
  }
  // Every window of length k is visited, and no more than that.
  expect(moves.map((w) => w[0])).toEqual([...Array(n - k + 1).keys()])

  // The band belongs to the scan, so it is gone once the scan is over.
  expect(
    windowPerFrame(reader)[reader.frameCount - 1],
    `${label}: the final frame still shows a window`,
  ).toBeUndefined()
}

describe('Maximum Average Subarray I — reference trace semantics', () => {
  const result = executeRun({ problem: PROBLEM, useReference: true, caseIndex: 0 })
  const caseResult = result.results[0]!
  const trace = caseResult.trace
  const reader = new TraceReader(trace)
  const nums = [1, 12, -5, -6, 50, 3]
  const k = 4

  it('returns the known answer for the canonical example', () => {
    expect(caseResult.passed).toBe(true)
    expect(caseResult.returned).toBeCloseTo(12.75, 10)
  })

  it('animates exactly the declared structures', () => {
    expect(trace.structures.map((s) => `${s.name}:${s.kind}`)).toEqual([`${NUMS}:array`])
  })

  it('slides a k-wide band from the first window to the last', () => {
    expectWindowSlides(trace, nums.length, k, 'example')
  })

  it('touches exactly the entering and leaving cell on every slide', () => {
    // The whole algorithm, stated as a property of the picture: after the k reads that build the
    // first window, every subsequent pair of lit cells is (i, i - k). A re-sum solution lights k
    // cells per window instead, and this is the assertion that says so.
    const reads = readIndices(trace)
    expect(reads.slice(0, k), 'the first window is built one cell at a time').toEqual([
      ...Array(k).keys(),
    ])

    const slides = reads.slice(k)
    expect(slides).toHaveLength(2 * (nums.length - k))
    for (let s = 0; s < slides.length; s += 2) {
      const entering = k + s / 2
      expect(
        [slides[s], slides[s + 1]],
        `slide ${s / 2}: expected the pair (entering ${entering}, leaving ${entering - k})`,
      ).toEqual([entering, entering - k])
    }
  })

  it('changes the sum on the same frame the band moves', () => {
    // The add and the drop are shown first, on their own cells; `sum` then updates in lockstep
    // with the band so the two never disagree about which k cells are being summed.
    for (let i = 0; i < reader.frameCount; i += 1) {
      const win = resolve(reader, NUMS, i)?.window
      const watch = reader.watchAt(i)
      if (!win || watch?.sum === undefined) continue
      const inWindow = nums.slice(win[0], win[1] + 1).reduce((s, v) => s + v, 0)
      expect(watch.sum, `frame ${i}: panel says sum ${String(watch.sum)} for window ${win.join('..')}`)
        .toBe(inWindow)
    }
  })

  it('marks the window whose average it returns, and nothing else', () => {
    const marked = markedWindow(reader)
    expect(marked).toEqual([1, 2, 3, 4])
    const mean = marked.reduce((s, i) => s + nums[i]!, 0) / k
    expect(mean).toBeCloseTo(caseResult.returned as number, 10)
  })

  it('keeps the marked window and the reported best in agreement on every frame', () => {
    // The half of "watch the best" that only shows up in the middle of a run: whenever the panel
    // claims a best, the green cells are a window with exactly that sum.
    let checked = 0
    for (let i = 0; i < reader.frameCount; i += 1) {
      const snap = resolve(reader, NUMS, i)
      const watch = reader.watchAt(i)
      if (!snap || watch?.best === undefined) continue
      const marks = snap.marks
        .filter((m) => m.class === 'result' && !m.transient)
        .map((m) => m.index)
      // One frame per improvement sits between `clearMarks` and `mark`, with nothing marked yet.
      if (marks.length === 0) continue
      expect(marks, `frame ${i}: ${marks.length} cells marked best, k is ${k}`).toHaveLength(k)
      expect(
        marks.reduce((s, idx) => s + nums[idx]!, 0),
        `frame ${i}: panel says best ${String(watch.best)}, marked cells sum to something else`,
      ).toBe(watch.best)
      expect(watch.average).toBeCloseTo((watch.best as number) / k, 10)
      checked += 1
    }
    expect(checked, 'no frame carried both a best and its marks').toBeGreaterThan(0)
  })

  it('never shows a best of zero that nobody computed', () => {
    // `best` is registered with the watch panel only after the first window exists, so no frame
    // reports the 0 that a `let best = 0` solution would show for the whole priming loop.
    const firstWithBest = Array.from({ length: reader.frameCount }, (_, i) => i).find(
      (i) => reader.watchAt(i)?.best !== undefined,
    )!
    const firstWithWindow = windowPerFrame(reader).findIndex((w) => w !== undefined)
    expect(firstWithBest).toBeGreaterThanOrEqual(firstWithWindow)
    expect(reader.watchAt(firstWithBest)!.best).toBe(nums.slice(0, k).reduce((s, v) => s + v, 0))
  })

  it('narrates the first window, every slide, and the conclusion', () => {
    const steps = reader.stepFrames()
    expect(steps).toHaveLength(nums.length - k + 2)
    const labels = steps.map((i) => trace.frames[i]!.label ?? '')
    expect(labels[0]).toMatch(/^first window/)
    expect(labels.filter((l) => /enters,.*leaves/.test(l))).toHaveLength(nums.length - k)
    expect(labels[labels.length - 1]).toMatch(/^best window is \[1\.\.4\]/)
    // The add/drop pair is named in the caption, not just drawn.
    expect(labels[1]).toBe('[4]=50 enters, [0]=1 leaves -> sum 51, best 51 (new best)')
    expect(labels[2]).toBe('[5]=3 enters, [1]=12 leaves -> sum 42, best 51')
  })
})

describe('the O(n) claim has teeth', () => {
  // A re-sum solution: same answer on every case, same k-wide band moving one cell at a time,
  // same marks at the end. If the two assertions this problem rests on cannot tell it apart from
  // the reference, they are decoration. Run against the `long run` case, where k=40 and the
  // difference is ~1,200 frames against ~11,000.
  const source = `
export default function findMaxAverage(nums, k, viz) {
  const a = viz.array(nums, { name: 'nums' })
  let best = null
  let bestStart = 0
  for (let s = 0; s + k <= a.length; s += 1) {
    let sum = 0
    for (let j = 0; j < k; j += 1) sum += a[s + j]
    a.setWindow(s, s + k - 1)
    if (best === null || sum > best) { best = sum; bestStart = s }
    viz.step('window at ' + s + ' sums to ' + sum)
  }
  a.mark(Array.from({ length: k }, (_, j) => bestStart + j), 'result')
  a.clearWindow()
  return best / k
}
`
  const large = requireProblem(PROBLEM).cases.findIndex((c) => c.tags?.includes('large'))
  const [nums, k] = requireProblem(PROBLEM).cases[large]!.args as [number[], number]
  const naive = executeRun({ problem: PROBLEM, source, caseIndex: large })
  const reference = executeRun({ problem: PROBLEM, useReference: true, caseIndex: large })

  it('returns the identical answer and animates an identical band', () => {
    expect(naive.diagnostics).toEqual([])
    expect(naive.results[0]!.passed).toBe(true)
    expect(naive.results[0]!.returned).toBe(reference.results[0]!.returned)
    // It even satisfies every window invariant, which is the point.
    expectWindowSlides(naive.results[0]!.trace, nums.length, k, 're-sum')
    expect(new TraceReader(naive.results[0]!.trace).stepFrames().length).toBe(nums.length - k + 1)
  })

  it('is rejected by the frame bound the reference passes', () => {
    const bound = 6 * nums.length + 20
    expect(reference.results[0]!.frameCount).toBeLessThanOrEqual(bound)
    expect(
      naive.results[0]!.frameCount,
      `re-sum used ${naive.results[0]!.frameCount} frames, which is under the bound — the bound is too loose to mean anything`,
    ).toBeGreaterThan(bound)
  })

  it('is rejected by the add/drop pair assertion', () => {
    // The reference reads 2 cells per slide; the re-sum reads k. Same picture at a glance, and
    // the whole difference between O(n) and O(n*k).
    const referenceReads = readIndices(reference.results[0]!.trace).length
    const naiveReads = readIndices(naive.results[0]!.trace).length
    expect(referenceReads).toBe(k + 2 * (nums.length - k))
    expect(naiveReads).toBe(k * (nums.length - k + 1))
    expect(naiveReads).toBeGreaterThan(referenceReads * 5)
  })
})

describe('Maximum Average Subarray I — the invariants hold on every case', () => {
  const problem = requireProblem(PROBLEM)
  const result = executeRun({ problem: PROBLEM, useReference: true })

  it('passes all of its own cases', () => {
    expect(result.results.map((r) => [r.name, r.passed])).toEqual(
      problem.cases.map((c) => [c.name, true]),
    )
  })

  for (const [index, testCase] of problem.cases.entries()) {
    it(`${testCase.name}`, () => {
      const caseResult = result.results[index]!
      const reader = new TraceReader(caseResult.trace)
      const [nums, k] = testCase.args as [number[], number]
      const n = nums.length
      const returned = caseResult.returned as number

      expectWindowSlides(caseResult.trace, n, k, testCase.name)

      // Two cells per slide, k to prime — never k per window.
      expect(readIndices(caseResult.trace)).toHaveLength(k + 2 * (n - k))

      // The picture's claim and the returned number are the same claim.
      const marked = markedWindow(reader)
      expect(marked, `${testCase.name}: ${marked.length} cells marked, k is ${k}`).toHaveLength(k)
      expect(marked).toEqual([...Array(k).keys()].map((j) => marked[0]! + j))
      const mean = marked.reduce((s, i) => s + nums[i]!, 0) / k
      expect(mean).toBeCloseTo(returned, 10)

      // And it really is the maximum, checked independently of the algorithm under test.
      const bestPossible = Math.max(
        ...Array.from({ length: n - k + 1 }, (_, s) =>
          nums.slice(s, s + k).reduce((a, b) => a + b, 0),
        ),
      )
      expect(mean).toBeCloseTo(bestPossible / k, 10)

      // Frames per element bounded by a constant that does not depend on k.
      expect(
        caseResult.frameCount,
        `${testCase.name}: ${caseResult.frameCount} frames for n=${n}, k=${k}`,
      ).toBeLessThanOrEqual(6 * n + 20)
    })
  }

  it('never seeds best at zero — the all-negative case would return 0 if it did', () => {
    const index = problem.cases.findIndex((c) => c.name.startsWith('all negative'))
    const caseResult = result.results[index]!
    const reader = new TraceReader(caseResult.trace)
    expect(caseResult.returned).toBeCloseTo(-4.5, 10)
    for (let i = 0; i < reader.frameCount; i += 1) {
      const best = reader.watchAt(i)?.best
      if (best === undefined) continue
      expect(best, `frame ${i}: best is ${String(best)}, which no window here can produce`)
        .toBeLessThan(0)
    }
  })

  it('builds the window and never slides it when k is the whole array', () => {
    const index = problem.cases.findIndex((c) => c.name === 'k equals the whole array')
    const reader = new TraceReader(result.results[index]!.trace)
    expect(windowMoves(reader)).toEqual([[0, 3]])
    expect(reader.stepFrames()).toHaveLength(2)
  })

  it('leaves the best marks where they are when no window ever improves', () => {
    // All equal: `sum > best` is never true after the first window, so the green cells are set
    // once and never move while the band slides across the whole array.
    const index = problem.cases.findIndex((c) => c.name.startsWith('all equal'))
    const trace = result.results[index]!.trace
    const reader = new TraceReader(trace)
    expect(windowMoves(reader)).toHaveLength(3)
    const markOps = trace.frames.filter((f) => f.label?.startsWith('mark '))
    expect(markOps, 'the result marks were rewritten during a scan that never improved').toHaveLength(1)
    expect(markedWindow(reader)).toEqual([0, 1, 2])
  })

  it('finds the best window when it sits at either end', () => {
    const start = problem.cases.findIndex((c) => c.name === 'best window at the very start')
    const end = problem.cases.findIndex((c) => c.name === 'best window at the very end')
    expect(markedWindow(new TraceReader(result.results[start]!.trace))).toEqual([0, 1])
    expect(markedWindow(new TraceReader(result.results[end]!.trace))).toEqual([3, 4])
  })

  it('needs the approx comparator — the exact answer is not the expected literal', () => {
    // 7/3. `deep` would reject the right answer here, which is why the problem declares `approx`.
    const index = problem.cases.findIndex((c) => c.name.startsWith('average is not exactly'))
    const caseResult = result.results[index]!
    const expected = problem.cases[index]!.expected as number
    expect(caseResult.passed).toBe(true)
    expect(caseResult.returned).not.toBe(expected)
    expect(Math.abs((caseResult.returned as number) - expected)).toBeLessThan(1e-5)
    expect(problem.comparator).toBe('approx')
  })

  it('holds the best still for 160 consecutive slides on the long run', () => {
    // The stretch a short case cannot show: the band moves and the green cells do not, which is
    // what "the running best" means when it is not changing.
    const index = problem.cases.findIndex((c) => c.tags?.includes('large'))
    const reader = new TraceReader(result.results[index]!.trace)
    const [nums, k] = problem.cases[index]!.args as [number[], number]

    let unchangedRun = 0
    let longest = 0
    let previous: string | undefined
    for (let i = 0; i < reader.frameCount; i += 1) {
      const snap = resolve(reader, NUMS, i)
      if (!snap?.window) continue
      const marks = snap.marks
        .filter((m) => m.class === 'result' && !m.transient)
        .map((m) => m.index)
        .join(',')
      if (marks === previous) unchangedRun += 1
      else unchangedRun = 0
      previous = marks
      longest = Math.max(longest, unchangedRun)
    }
    expect(longest).toBeGreaterThan(160)
    expect(markedWindow(reader)).toEqual([...Array(k).keys()].map((j) => 200 + j))
    expect(nums[200]).toBe(100)
  })
})

describe('the starter teaches the same picture, not just the same answer', () => {
  // Every assertion above runs on `useReference: true`, and the reference is not what a learner
  // opens. This repo has had fixes land in a reference and miss the starter, so the starter is
  // executed rather than trusted.
  const problem = requireProblem(PROBLEM)

  it('runs as shipped, with the array on screen and nothing thrown', () => {
    const run = executeRun({ problem: PROBLEM, source: problem.starter, caseIndex: 0 })
    expect(run.diagnostics).toEqual([])
    expect(run.results[0]!.error).toBeUndefined()
    // The TODOs are unfilled, so the answer is allowed to be wrong — but the panel a learner is
    // meant to watch has to exist from frame one.
    expect(run.results[0]!.trace.structures.map((s) => s.kind)).toEqual(['array'])
  })

  it('produces the same faithful animation when filled in exactly as its comments say', () => {
    // Written only from the starter's TODOs — no peeking at the reference.
    const source = `
export default function findMaxAverage(nums, k, viz) {
  const a = viz.array(nums, { name: 'nums' })
  const cellsFrom = (start) => Array.from({ length: k }, (_, j) => start + j)
  let sum = 0
  viz.watch(() => ({ k, sum }))

  for (let i = 0; i < k; i += 1) sum += a[i]
  a.setWindow(0, k - 1)

  let best = sum
  let bestStart = 0
  viz.watch(() => ({ best, average: best / k }))
  a.mark(cellsFrom(bestStart), 'result', 'best so far')
  viz.step('first window')

  for (let i = k; i < a.length; i += 1) {
    sum += a[i] - a[i - k]
    a.setWindow(i - k + 1, i)
    if (sum > best) {
      best = sum
      bestStart = i - k + 1
      a.clearMarks('result')
      a.mark(cellsFrom(bestStart), 'result', 'best so far')
    }
    viz.step('slide')
  }

  a.clearWindow()
  return best / k
}
`
    const run = executeRun({ problem: PROBLEM, source })
    expect(run.diagnostics).toEqual([])
    expect(run.results.map((r) => [r.name, r.passed])).toEqual(
      problem.cases.map((c) => [c.name, true]),
    )

    for (const [index, testCase] of problem.cases.entries()) {
      const trace = run.results[index]!.trace
      const [nums, k] = testCase.args as [number[], number]
      expectWindowSlides(trace, nums.length, k, `starter: ${testCase.name}`)
      // The instruction that carries the whole lesson — "two cells touched, never k".
      expect(readIndices(trace), `starter: ${testCase.name}`).toHaveLength(
        k + 2 * (nums.length - k),
      )
      const marked = markedWindow(new TraceReader(trace))
      const mean = marked.reduce((s, i) => s + nums[i]!, 0) / k
      expect(mean, `starter: ${testCase.name}`).toBeCloseTo(run.results[index]!.returned as number, 10)
    }
  })
})
