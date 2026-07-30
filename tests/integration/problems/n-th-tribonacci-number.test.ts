import { describe, expect, it } from 'vitest'
import { executeRun, type CaseResult } from '@algoviz/runner'
import { TraceReader, type Frame, type Mark2D, type StructureSnapshot } from '@algoviz/tracer'

/**
 * LeetCode 1137 — trace semantics.
 *
 * The answer is a three-term sum; nothing here would catch a wrong one that the case list doesn't
 * already catch. What this file exists for is the *picture*: this is the first problem to drive
 * `VizDpTable`, and the thing that has to be true is that the table depicts **this** recurrence
 * rather than merely "a row of numbers filling up". So the load-bearing test is that every
 * computed cell's `dependsOn` frame highlights exactly its three predecessors — same three cells,
 * same three values, and those values really do sum to the cell just written.
 */

const SLUG = 'n-th-tribonacci-number'

type DpSnapshot = Extract<StructureSnapshot, { kind: 'dp' }>

function runCase(caseIndex: number): CaseResult {
  const result = executeRun({ problem: SLUG, useReference: true, caseIndex })
  expect(result.diagnostics).toEqual([])
  const caseResult = result.results[0]
  expect(caseResult, `case ${caseIndex} produced no result`).toBeDefined()
  expect(caseResult!.error).toBeUndefined()
  expect(caseResult!.passed).toBe(true)
  return caseResult!
}

function dpAt(reader: TraceReader, frame: number): DpSnapshot {
  const snap = [...reader.at(frame).values()].find((s) => s.kind === 'dp')
  expect(snap, `no dp table resolved at frame ${frame}`).toBeDefined()
  return snap as DpSnapshot
}

function dpIdOf(caseResult: CaseResult): string {
  const meta = caseResult.trace.structures.find((s) => s.kind === 'dp')
  expect(meta, 'the solution never created a dp table').toBeDefined()
  return meta!.id
}

/** `dp[5] = 7` -> 5. Writes are the only frames whose label has this shape. */
function writtenCell(frame: Frame): number {
  const match = /^dp\[(\d+)] = /.exec(frame.label ?? '')
  expect(match, `write frame ${frame.index} has an unparseable label: ${frame.label}`).toBeTruthy()
  return Number(match![1])
}

function compareMarks(frame: Frame, dpId: string): Mark2D[] {
  const snap = frame.snapshots[dpId]
  expect(snap?.kind, `compare frame ${frame.index} carries no dp snapshot`).toBe('dp')
  return (snap as DpSnapshot).marks.filter((m) => m.class === 'compare')
}

describe('N-th Tribonacci Number — the recurrence is visible in the table', () => {
  // Case 6 is n = 8: long enough that the pattern is readable, short enough to assert cell by cell.
  const caseResult = runCase(6)
  const reader = new TraceReader(caseResult.trace)
  const dpId = dpIdOf(caseResult)
  const writes = caseResult.trace.frames.filter((f) => f.op === 'write')

  it('returns T(8) = 44', () => {
    expect(caseResult.returned).toBe(44)
  })

  it('names exactly the three predecessors of every computed cell', () => {
    // THE assertion. If this passes, the animation is showing the Tribonacci recurrence; if it
    // only showed a table filling up, the dependency marks would be missing, wrong, or generic.
    const computed = writes.filter((f) => writtenCell(f) >= 3)
    expect(computed.map(writtenCell)).toEqual([3, 4, 5, 6, 7, 8])

    for (const write of computed) {
      const i = writtenCell(write)
      // The dependency frame is the one immediately after the write, so a viewer sees the new
      // value and the three cells it came from together rather than pages apart.
      const dependsOn = caseResult.trace.frames[write.index + 1]
      expect(dependsOn?.op, `dp[${i}] is not followed by a dependency frame`).toBe('compare')

      const marked = compareMarks(dependsOn!, dpId)
      expect(marked.every((m) => m.row === 0), `dp[${i}] marked outside row 0`).toBe(true)
      expect(
        marked.map((m) => m.col).sort((a, b) => a - b),
        `dp[${i}] highlighted the wrong cells`,
      ).toEqual([i - 3, i - 2, i - 1])
      expect(dependsOn!.label).toBe(`T(${i}) = T(${i - 1}) + T(${i - 2}) + T(${i - 3})`)

      // Not just the right cells — the values on screen must actually satisfy the recurrence.
      const values = (dependsOn!.snapshots[dpId] as DpSnapshot).values as (number | null)[]
      expect(values[i]).toBe(
        (values[i - 1] as number) + (values[i - 2] as number) + (values[i - 3] as number),
      )
    }
  })

  it('narrates each computed cell with the arithmetic that produced it', () => {
    const steps = caseResult.trace.frames.filter((f) => f.op === 'step')
    // One for the seeds, one per computed cell.
    expect(steps).toHaveLength(1 + 6)
    expect(steps[0]?.label).toBe('base cases: T(0) = 0, T(1) = 1, T(2) = 1')
    expect(steps[1]?.label).toBe('T(3) = 1 + 1 + 0 = 2')
    expect(steps[6]?.label).toBe('T(8) = 24 + 13 + 7 = 44')
  })

  it('releases the dependency highlight instead of accumulating it', () => {
    // dependsOn() marks then unmarks. If it leaked, the whole table would end up lit `compare`.
    const final = dpAt(reader, reader.frameCount - 1)
    expect(final.marks.filter((m) => m.class === 'compare')).toEqual([])
    // And no frame ever shows more than the three inputs of a single recurrence step.
    for (const frame of caseResult.trace.frames) {
      if (frame.op !== 'compare') continue
      expect(compareMarks(frame, dpId)).toHaveLength(3)
    }
  })

  it('fills every cell exactly once, strictly left to right', () => {
    expect(writes.map(writtenCell)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('never changes a cell that already holds a value', () => {
    // Left-to-right write order is not enough on its own: a rolling-variable solution mislabelled
    // as a table would also revisit cells. Once a cell has a value it must stay put forever.
    let previous: (number | null)[] | undefined
    for (let i = 0; i < reader.frameCount; i += 1) {
      const values = dpAt(reader, i).values as (number | null)[]
      if (previous) {
        for (let c = 0; c < values.length; c += 1) {
          if (previous[c] === null || previous[c] === undefined) continue
          expect(values[c], `cell ${c} changed at frame ${i}`).toBe(previous[c])
        }
      }
      previous = values
    }
  })

  it('leaves unwritten cells empty rather than showing a plausible zero', () => {
    // `null` renders as blank; a 0 fill would make "not computed yet" indistinguishable from
    // "computed, equals zero" — and T(0) really is 0.
    const midStep = reader.stepFrames()[2]
    expect(midStep).toBeDefined()
    const values = dpAt(reader, midStep!).values as (number | null)[]
    expect(values.slice(0, 5)).toEqual([0, 1, 1, 2, 4])
    expect(values.slice(5)).toEqual([null, null, null, null])
  })

  it('ends with the answer in the last cell, marked as the result', () => {
    const final = dpAt(reader, reader.frameCount - 1)
    expect((final.values as number[])[8]).toBe(caseResult.returned)
    expect(final.marks.filter((m) => m.class === 'result')).toEqual([
      { row: 0, col: 8, class: 'result', note: 'T(8)' },
    ])
    expect(reader.watchAt(reader.frameCount - 1)).toEqual({ n: 8, Tn: 44 })
  })

  it('keeps the frame count linear in n', () => {
    // Six frames per computed cell (three reads, the write, the dependency, the narration).
    expect(caseResult.frameCount).toBeLessThan(20 + 8 * 8)
  })
})

describe('N-th Tribonacci Number — base-case-only inputs still draw the table', () => {
  // The loop body never executes for n <= 2. A trace with almost no frames is honest, but it must
  // not be an *empty* one: the three seeds are the whole animation in that case.
  for (const [caseIndex, n, expected] of [
    [2, 0, 0],
    [3, 1, 1],
    [4, 2, 1],
  ] as const) {
    it(`n = ${n} shows the three seeds and marks T(${n}) = ${expected}`, () => {
      const caseResult = runCase(caseIndex)
      expect(caseResult.returned).toBe(expected)
      const reader = new TraceReader(caseResult.trace)

      // Nothing was computed, so there is no recurrence to depict — and none is faked.
      expect(caseResult.trace.frames.filter((f) => f.op === 'compare')).toEqual([])

      const final = dpAt(reader, reader.frameCount - 1)
      expect(final.dims).toBe(1)
      expect(final.values).toEqual([0, 1, 1])
      expect(final.marks.filter((m) => m.class === 'result').map((m) => m.col)).toEqual([n])
      expect(reader.stepFrames().length).toBeGreaterThan(0)
      expect(caseResult.frameCount).toBeGreaterThan(3)
    })
  }
})

describe('N-th Tribonacci Number — the extremes', () => {
  it('computes exactly one cell for n = 3, the first non-base case', () => {
    const caseResult = runCase(5)
    expect(caseResult.returned).toBe(2)
    const compares = caseResult.trace.frames.filter((f) => f.op === 'compare')
    expect(compares).toHaveLength(1)
    expect(compares[0]?.label).toBe('T(3) = T(2) + T(1) + T(0)')
  })

  it('fills the whole table for n = 37 and lands on the known value', () => {
    const caseResult = runCase(7)
    expect(caseResult.returned).toBe(2082876103)
    const reader = new TraceReader(caseResult.trace)
    const final = dpAt(reader, reader.frameCount - 1)
    const values = final.values as number[]

    expect(values).toHaveLength(38)
    expect(values.some((v) => v === null)).toBe(false)
    // Every cell in the finished picture satisfies the recurrence, base cases included.
    expect(values.slice(0, 3)).toEqual([0, 1, 1])
    for (let i = 3; i < values.length; i += 1) {
      expect(values[i], `dp[${i}]`).toBe(values[i - 1]! + values[i - 2]! + values[i - 3]!)
    }
    // The stated constraint: the answer fits in a signed 32-bit integer.
    expect(values[37]).toBeLessThan(2 ** 31)
    expect(values[37]).toBe(caseResult.returned)
    expect(caseResult.frameCount).toBeLessThan(300)
  })
})
