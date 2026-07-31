import { describe, expect, it } from 'vitest'
import { executeRun } from '@algoviz/runner'
import { requireProblem } from '@algoviz/problems'
import { TraceReader, type StructureSnapshot, type Trace } from '@algoviz/tracer'

/**
 * LeetCode 724 — Find Pivot Index.
 *
 * The load-bearing check in this file is `expectRegionsMatchSums`. Everything else here would
 * also pass for a solution that returns the right index while showing nothing: only that one
 * assertion proves the *picture* is the algorithm — that at every step the array itself is split
 * into a `visited` region summing to `leftSum` and a `window` summing to `rightSum`, meeting at
 * the cursor. "the check has teeth" runs a solution that recomputes both sums with
 * `Array.prototype.reduce` on every index — same answer, same single read per index, same O(n)
 * cost — and proves the check rejects it anyway, because it never shows either region.
 */

const PROBLEM = 'find-pivot-index'
const NUMS = 'nums'

type ArraySnap = Extract<StructureSnapshot, { kind: 'array' }>

function idOf(trace: Trace, name: string): string {
  const meta = trace.structures.find((s) => s.name === name)
  if (!meta) {
    throw new Error(
      `no structure named "${name}" — got ${trace.structures.map((s) => s.name).join(', ')}`,
    )
  }
  return meta.id
}

function resolve(reader: TraceReader, name: string, frame: number): ArraySnap | undefined {
  const snap = reader.structureAt(idOf(reader.trace, name), frame)
  return snap?.kind === 'array' ? snap : undefined
}

/**
 * The invariant the whole problem rests on, checked at every `read` frame on `nums` (there is
 * exactly one per index the scan visits): the cells marked `visited` are exactly `[0..idx-1]` and
 * sum to `leftSum`, and the `window` (when the array is not exhausted) is exactly `[idx+1..n-1]`
 * and sums to `rightSum` — with `rightSum` computed independently, never trusting the watch panel
 * alone.
 */
function expectRegionsMatchSums(trace: Trace, nums: number[], label: string): void {
  const reader = new TraceReader(trace)
  const id = idOf(trace, NUMS)
  const total = nums.reduce((s, v) => s + v, 0)
  let checked = 0

  // Every frame that carries a `nums` snapshot, not just the `read` frames. Checking only reads
  // checked exactly the frames that were right and skipped exactly the ones that were wrong: the
  // sums used to be recomputed in the watch closure from a `leftSum` that had already advanced,
  // so the two `mark`/`window` frames per index reported a number matching neither region.
  for (const frame of trace.frames) {
    const snap = frame.snapshots[id]
    if (snap?.kind !== 'array') continue
    const watchNow = reader.watchAt(frame.index)
    if (watchNow) {
      const visitedNow = snap.marks
        .filter((m) => m.class === 'visited' && !m.transient)
        .map((m) => nums[m.index] ?? 0)
        .reduce((a, b) => a + b, 0)
      expect(
        watchNow.leftSum,
        `${label} frame ${frame.index} (${frame.op}): leftSum is not the sum of the visited cells`,
      ).toBe(visitedNow)
      const band = snap.window
      const bandSum = band
        ? nums.slice(band[0], band[1] + 1).reduce((a, b) => a + b, 0)
        : 0
      expect(
        watchNow.rightSum,
        `${label} frame ${frame.index} (${frame.op}): rightSum is not the sum of the banded cells`,
      ).toBe(bandSum)
    }
    if (frame.op !== 'read' || frame.structureId !== id) continue

    const readMark = snap.marks.find((m) => m.transient === true)
    expect(readMark, `${label} frame ${frame.index}: read frame with no transient mark`).toBeDefined()
    const idx = readMark!.index

    const watch = reader.watchAt(frame.index)
    expect(watch?.leftSum, `${label} frame ${frame.index}: no leftSum on a read frame`).not.toBe(
      undefined,
    )
    const leftSum = watch!.leftSum as number

    const visited = snap.marks
      .filter((m) => m.class === 'visited' && !m.transient)
      .map((m) => m.index)
      .sort((a, b) => a - b)
    expect(
      visited,
      `${label} frame ${frame.index}: visited region is not [0..${idx - 1}]`,
    ).toEqual(Array.from({ length: idx }, (_, k) => k))
    expect(
      visited.reduce((s, i2) => s + nums[i2]!, 0),
      `${label} frame ${frame.index}: visited cells do not sum to leftSum`,
    ).toBe(leftSum)

    const expectedRightSum = total - leftSum - nums[idx]!
    if (idx + 1 <= nums.length - 1) {
      expect(
        snap.window,
        `${label} frame ${frame.index}: no window shown for the region right of ${idx}`,
      ).toEqual([idx + 1, nums.length - 1])
      const windowSum = nums.slice(idx + 1).reduce((s, v) => s + v, 0)
      expect(
        windowSum,
        `${label} frame ${frame.index}: window does not sum to rightSum`,
      ).toBe(expectedRightSum)
    } else {
      expect(
        snap.window,
        `${label} frame ${frame.index}: a window is shown with nothing left to its right`,
      ).toBe(undefined)
    }
    expect(
      watch?.rightSum,
      `${label} frame ${frame.index}: watch panel rightSum disagrees with the picture`,
    ).toBe(expectedRightSum)
    checked += 1
  }

  expect(checked, `${label}: no read frame was checked`).toBeGreaterThan(0)
}

describe('Find Pivot Index — reference trace semantics', () => {
  const result = executeRun({ problem: PROBLEM, useReference: true, caseIndex: 0 })
  const caseResult = result.results[0]!
  const trace = caseResult.trace
  const reader = new TraceReader(trace)
  const nums = [1, 7, 3, 6, 5, 6]

  it('returns the known answer for the canonical example', () => {
    expect(caseResult.passed).toBe(true)
    expect(caseResult.returned).toBe(3)
  })

  it('animates exactly the declared structures', () => {
    expect(trace.structures.map((s) => `${s.name}:${s.kind}`)).toEqual([`${NUMS}:array`])
  })

  it('shows the two regions converging on every step', () => {
    expectRegionsMatchSums(trace, nums, 'example')
  })

  it('reads each index exactly once, and stops at the pivot — one pass, not two', () => {
    const id = idOf(trace, NUMS)
    const reads = trace.frames.filter((f) => f.op === 'read' && f.structureId === id)
    // The pivot is index 3, so the scan reads 0..3 and never touches 4 or 5.
    expect(reads.map((f) => (f.snapshots[id] as ArraySnap).marks.find((m) => m.transient)?.index)).toEqual(
      [0, 1, 2, 3],
    )
  })

  it('marks only the pivot as the result, and every index before it as visited', () => {
    const last = resolve(reader, NUMS, reader.frameCount - 1)!
    const result = last.marks.filter((m) => m.class === 'result').map((m) => m.index)
    const visited = last.marks
      .filter((m) => m.class === 'visited')
      .map((m) => m.index)
      .sort((a, b) => a - b)
    expect(result).toEqual([3])
    expect(visited).toEqual([0, 1, 2])
  })

  it('shows both regions on the frame that says they are equal', () => {
    // This used to assert the opposite — that the window was *cleared* when the pivot was found —
    // which is the defect written down as an expectation. The answer frame announces "left 11
    // meets right 11"; the left 11 is three `visited` cells and the right 11 was nothing at all,
    // so the one frame that has to show both regions was the only frame that showed one.
    const last = resolve(reader, NUMS, reader.frameCount - 1)!
    const answer = caseResult.returned as number
    expect(answer).toBeGreaterThanOrEqual(0)
    expect(last.window, 'the band was cleared on the payoff frame').toEqual([answer + 1, nums.length - 1])
    expect(last.marks.filter((m) => m.class === 'result').map((m) => m.index)).toEqual([answer])
  })

  it('narrates every index it checks, up to and including the pivot', () => {
    const steps = reader.stepFrames()
    const labels = steps.map((i) => trace.frames[i]!.label ?? '')
    expect(labels).toHaveLength(4)
    expect(labels.slice(0, 3).every((l) => /keep scanning/.test(l))).toBe(true)
    expect(labels[3]).toMatch(/pivot$/)
  })
})

describe('the check has teeth', () => {
  // A close impostor: same single read per index, same O(n) cost, correct answer — but both
  // sides are recomputed with Array.prototype.reduce from the raw JS array on every step, so no
  // running leftSum is ever shown as a growing region and no window ever shows rightSum's span.
  const source = `
export default function pivotIndex(nums, viz) {
  const a = viz.array(nums, { name: 'nums' })
  const i = viz.cursor('i', 0, a)
  for (i.value = 0; i.value < a.length; i.inc()) {
    const v = a[i.value]
    const left = nums.slice(0, i.value).reduce((s, x) => s + x, 0)
    const right = nums.slice(i.value + 1).reduce((s, x) => s + x, 0)
    if (left === right) {
      viz.step('pivot ' + i.value)
      return i.value
    }
    viz.step('checked ' + i.value)
  }
  return -1
}
`
  const result = executeRun({ problem: PROBLEM, source, caseIndex: 0 })

  it('returns the right answer with the right number of reads', () => {
    expect(result.diagnostics).toEqual([])
    expect(result.results[0]?.passed).toBe(true)
    expect(result.results[0]?.returned).toBe(3)
    const trace = result.results[0]!.trace
    const id = idOf(trace, NUMS)
    expect(trace.frames.filter((f) => f.op === 'read' && f.structureId === id)).toHaveLength(4)
  })

  it('is rejected by the region check the reference passes', () => {
    // It fails at the very first thing the check asks for: a running `leftSum` on the watch
    // panel. The impostor never calls `viz.watch` at all — the two sums are computed and thrown
    // away every step, never shown as a number or as a region — which is exactly the defect this
    // problem's animation exists to make visible.
    expect(() =>
      expectRegionsMatchSums(result.results[0]!.trace, [1, 7, 3, 6, 5, 6], 'impostor'),
    ).toThrow(/no leftSum on a read frame/)
  })
})

describe('Find Pivot Index — the invariant holds on every case', () => {
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
      const [nums] = testCase.args as [number[]]
      const returned = caseResult.returned as number

      expectRegionsMatchSums(caseResult.trace, nums, testCase.name)

      // Independently confirm the returned index really is the leftmost pivot.
      const total = nums.reduce((s, v) => s + v, 0)
      let leftSum = 0
      let expected = -1
      for (let k = 0; k < nums.length; k += 1) {
        if (leftSum === total - leftSum - nums[k]!) {
          expected = k
          break
        }
        leftSum += nums[k]!
      }
      expect(returned).toBe(expected)

      // One read per index, whatever the outcome — never a re-sum of either side.
      const id = idOf(caseResult.trace, NUMS)
      const reads = caseResult.trace.frames.filter((f) => f.op === 'read' && f.structureId === id)
      const scanned = returned === -1 ? nums.length : returned + 1
      expect(reads, `${testCase.name}: expected ${scanned} reads`).toHaveLength(scanned)

      expect(
        caseResult.frameCount,
        `${testCase.name}: ${caseResult.frameCount} frames for n=${nums.length}`,
      ).toBeLessThanOrEqual(6 * nums.length + 20)
    })
  }

  it('stops at the leftmost pivot even when several indices qualify', () => {
    const index = problem.cases.findIndex((c) => c.name.startsWith('multiple pivots'))
    const caseResult = result.results[index]!
    expect(caseResult.returned).toBe(2)
    const reader = new TraceReader(caseResult.trace)
    const last = resolve(reader, NUMS, reader.frameCount - 1)!
    expect(last.marks.filter((m) => m.class === 'result').map((m) => m.index)).toEqual([2])
    // Indices 3 and 4 are also valid pivots and are never even read.
    const id = idOf(caseResult.trace, NUMS)
    const readIndices = caseResult.trace.frames
      .filter((f) => f.op === 'read' && f.structureId === id)
      .map((f) => (f.snapshots[id] as ArraySnap).marks.find((m) => m.transient)?.index)
    expect(readIndices).toEqual([0, 1, 2])
  })

  it('is trivially its own pivot at the minimum length', () => {
    const index = problem.cases.findIndex((c) => c.name === 'single element')
    const caseResult = result.results[index]!
    expect(caseResult.returned).toBe(0)
    const reader = new TraceReader(caseResult.trace)
    // No window is ever shown — there is nothing to either side of the only element.
    for (let i = 0; i < reader.frameCount; i += 1) {
      expect(resolve(reader, NUMS, i)?.window).toBe(undefined)
    }
  })

  it('runs the full O(n) scan and finds nothing on the long run', () => {
    const index = problem.cases.findIndex((c) => c.tags?.includes('large'))
    const caseResult = result.results[index]!
    const [nums] = problem.cases[index]!.args as [number[]]
    expect(caseResult.returned).toBe(-1)
    const id = idOf(caseResult.trace, NUMS)
    expect(caseResult.trace.frames.filter((f) => f.op === 'read' && f.structureId === id)).toHaveLength(
      nums.length,
    )
    const reader = new TraceReader(caseResult.trace)
    expect(resolve(reader, NUMS, reader.frameCount - 1)?.window).toBe(undefined)
    // No pivot exists, so every index — including the last — takes the "not a pivot" branch
    // and ends up visited.
    const visited = resolve(reader, NUMS, reader.frameCount - 1)!
      .marks.filter((m) => m.class === 'visited')
      .map((m) => m.index)
    expect(visited).toHaveLength(nums.length)
  })
})

describe('the starter teaches the same picture, not just the same answer', () => {
  const problem = requireProblem(PROBLEM)

  it('runs as shipped, with the array on screen and nothing thrown', () => {
    const run = executeRun({ problem: PROBLEM, source: problem.starter, caseIndex: 0 })
    expect(run.diagnostics).toEqual([])
    expect(run.results[0]!.error).toBeUndefined()
    expect(run.results[0]!.trace.structures.map((s) => s.kind)).toEqual(['array'])
  })

  it('does not already pass the example case untouched', () => {
    const run = executeRun({ problem: PROBLEM, source: problem.starter, caseIndex: 0 })
    expect(run.results[0]!.passed).toBe(false)
  })

  /**
   * Every non-comment, non-placeholder line of the shipped starter must appear in the filled
   * version, *in the same order*. This is stronger than "the same lines appear somewhere": it
   * fails if a future fix lands in the reference and the starter's boilerplate silently drifts
   * out of sync with it — the defect this repo has shipped five times.
   */
  function assertTranscribesInOrder(starter: string, filled: string): void {
    const placeholders = new Set([`viz.step('index ' + i.value)`, 'break'])
    const starterLines = starter
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('//') && !placeholders.has(l))

    let cursor = 0
    for (const line of starterLines) {
      const at = filled.indexOf(line, cursor)
      expect(at, `line not found in order after position ${cursor}: ${JSON.stringify(line)}`).toBeGreaterThanOrEqual(
        0,
      )
      cursor = at + line.length
    }
  }

  it('produces the same faithful animation when filled in exactly as its comments say', () => {
    // Written only from the starter's TODOs — no peeking at the reference.
    // Typed exactly like the shipped starter (sucrase strips the types before running), so the
    // transcription check below can compare lines verbatim rather than fighting a JS/TS mismatch.
    const filled = `
export default function pivotIndex(nums: number[], viz: Viz): number {
  const a = viz.array(nums, { name: 'nums' })
  const total = nums.reduce((sum, v) => sum + v, 0)
  let leftSum = 0
  let rightSum = total - (nums[0] ?? 0)
  const i = viz.cursor('i', 0, a)
  viz.watch(() => ({ leftSum, rightSum, total }))

  const windowRightOf = (idx: number): void => {
    if (idx + 1 <= a.length - 1) a.setWindow(idx + 1, a.length - 1)
    else a.clearWindow()
  }
  windowRightOf(0)

  for (i.value = 0; i.value < a.length; i.inc()) {
    const v = a[i.value]
    rightSum = total - leftSum - v
    if (rightSum === leftSum) {
      a.mark(i.value, 'result', 'left ' + leftSum + ' = right ' + rightSum)
      viz.step('index ' + i.value)
      return i.value
    }
    viz.step('index ' + i.value)
    leftSum += v
    rightSum = total - leftSum
    a.mark(i.value, 'visited', 'counted into leftSum')
    rightSum = total - leftSum - (a.at(i.value + 1) ?? 0)
    windowRightOf(i.value + 1)
  }

  return -1
}
`
    assertTranscribesInOrder(problem.starter, filled)

    const run = executeRun({ problem: PROBLEM, source: filled })
    expect(run.diagnostics).toEqual([])
    expect(run.results.map((r) => [r.name, r.passed])).toEqual(
      problem.cases.map((c) => [c.name, true]),
    )

    for (const [index, testCase] of problem.cases.entries()) {
      const trace = run.results[index]!.trace
      const [nums] = testCase.args as [number[]]
      expectRegionsMatchSums(trace, nums, `starter: ${testCase.name}`)
    }
  })
})
