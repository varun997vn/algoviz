import { describe, expect, it } from 'vitest'
import { executeRun } from '@algoviz/runner'
import { requireProblem } from '@algoviz/problems'
import {
  TraceReader,
  trace as runTrace,
  type StructureSnapshot,
  type Trace,
  type Viz,
} from '@algoviz/tracer'
import { singleNumber } from '@algoviz/problems'

/**
 * LeetCode 136 — Single Number.
 *
 * `nums.reduce((a, b) => a ^ b)` passes every case in this file. That is exactly the problem:
 * a running accumulator changing on screen shows a viewer that XOR does *something*, not *why*
 * it finds the lone value. The two facts that make it work — `x ^ x === 0`, and that XOR does
 * not care what order it happens in — are invisible in a decimal number.
 *
 * `single-number.ts` picks a per-bit tally as the structure that makes both facts checkable
 * rather than merely plausible: `tally[b]` is the count of values scanned so far with bit `b`
 * set, and `acc`'s bit `b` is *by definition* `tally[b] % 2` — an even count cancelled, an odd
 * one is what survives. So almost everything below is checking that agreement mechanically,
 * frame by frame, rather than trusting the return value:
 *
 *  - `the tally is a true prefix bit-count at every checkpoint` is the assertion a solution that
 *    computes the XOR with a bare accumulator beside an untouched `tally` panel cannot pass, no
 *    matter how right its return value is — `the frame-sequence checks have teeth` proves that
 *    by running exactly such a solution.
 *  - `the final tally parity reconstructs the returned value, bit for bit` is the concrete form
 *    of "every bit appears an even number of times except the lone value's" — computed from the
 *    picture, not asserted about it.
 *  - `two orderings of the same multiset end at the same tally` is the commutativity claim from
 *    the docstring, checked rather than described.
 */

const PROBLEM = 'single-number'
const NUMS = 'nums'
const TALLY = 'bit tally (count of 1s, MSB->LSB)'

function idOf(trace: Trace, name: string): string {
  const meta = trace.structures.find((s) => s.name === name)
  if (!meta) {
    throw new Error(
      `no structure named "${name}" — got ${trace.structures.map((s) => s.name).join(', ')}`,
    )
  }
  return meta.id
}

function resolve<K extends StructureSnapshot['kind']>(
  reader: TraceReader,
  name: string,
  kind: K,
  frame: number,
): Extract<StructureSnapshot, { kind: K }> | undefined {
  const meta = reader.trace.structures.find((s) => s.name === name)
  if (!meta) return undefined
  const snap = reader.structureAt(meta.id, frame)
  return snap?.kind === kind ? (snap as Extract<StructureSnapshot, { kind: K }>) : undefined
}

/** Bit `b` (0 = MSB / sign bit, 31 = LSB) of `num`, treating it as an unsigned 32-bit pattern. */
function bitAt(num: number, b: number): number {
  return (num >>> (31 - b)) & 1
}

/** Ground truth: for each of the 32 columns, how many of `prefix` have that bit set. */
function trueTally(prefix: readonly number[]): number[] {
  const out = new Array<number>(32).fill(0)
  for (const num of prefix) {
    for (let b = 0; b < 32; b += 1) out[b] += bitAt(num, b)
  }
  return out
}

/** The 32-bit signed value whose bit `b` is 1 exactly where `tally[b]` is odd. */
function fromParity(tally: readonly number[]): number {
  let v = 0
  for (let b = 0; b < 32; b += 1) {
    if ((tally[b] as number) % 2 === 1) v |= 1 << (31 - b)
  }
  return v
}

/**
 * `tally` is a true prefix bit-count at every checkpoint — the frame right after the step that
 * narrates processing `nums[k]`, for every k. A solution that folds `nums` with a bare `^=` and
 * leaves `tally` untouched (or wrong) fails this at k = 0, the first checkpoint there is.
 */
function expectTallyIsATruePrefixBitCount(trace: Trace, input: readonly number[], label: string): void {
  const reader = new TraceReader(trace)
  let checked = 0
  for (let k = 0; k < input.length; k += 1) {
    const stepFrame = trace.frames.find(
      (f) => f.op === 'step' && (f.label ?? '').startsWith(`xor in nums[${k}] =`),
    )
    expect(stepFrame, `${label}: no checkpoint frame for nums[${k}]`).toBeDefined()
    const tally = resolve(reader, TALLY, 'array', stepFrame!.index)
    expect(tally, `${label} frame ${stepFrame!.index}: no tally panel`).toBeDefined()
    expect(
      tally!.values,
      `${label} frame ${stepFrame!.index}: tally does not match the true bit-count of nums[0..${k}]`,
    ).toEqual(trueTally(input.slice(0, k + 1)))
    checked += 1
  }
  expect(checked, `${label}: no checkpoint was found at all`).toBe(input.length)
}

/** The odd columns of the final tally reconstruct the returned value, bit for bit. */
function expectFinalTallyReconstructsAnswer(trace: Trace, returned: number, label: string): void {
  const reader = new TraceReader(trace)
  const last = reader.frameCount - 1
  const tally = resolve(reader, TALLY, 'array', last)
  expect(tally, `${label}: no tally panel on the final frame`).toBeDefined()
  expect(fromParity(tally!.values as number[]), `${label}: tally parity disagrees with the answer`).toBe(
    returned,
  )
  // And every odd column is explicitly marked 'result' — the picture says so, not just the math.
  const marked = tally!.marks.filter((m) => m.class === 'result').map((m) => m.index).sort((a, b) => a - b)
  const odd = (tally!.values as number[])
    .map((v, idx) => [v, idx] as const)
    .filter(([v]) => v % 2 === 1)
    .map(([, idx]) => idx)
    .sort((a, b) => a - b)
  expect(marked, `${label}: marked result columns do not match the odd-count columns`).toEqual(odd)
}

/** Exactly one cell of `nums` is marked `result`, and it is the cell holding the answer. */
function expectNumsResultMarksTheAnswer(trace: Trace, input: readonly number[], returned: number, label: string): void {
  const reader = new TraceReader(trace)
  const last = reader.frameCount - 1
  const arr = resolve(reader, NUMS, 'array', last)
  expect(arr, `${label}: no nums panel on the final frame`).toBeDefined()
  const marked = arr!.marks.filter((m) => m.class === 'result')
  expect(marked, `${label}: expected exactly one result mark on nums`).toHaveLength(1)
  expect(input[marked[0]!.index], `${label}: the marked cell is not the answer`).toBe(returned)
}

describe('Single Number — reference trace semantics', () => {
  const problem = requireProblem(PROBLEM)
  const result = executeRun({ problem: PROBLEM, useReference: true, caseIndex: 0 })
  const caseResult = result.results[0]!
  const trace = caseResult.trace

  it('returns 1 for the canonical example', () => {
    expect(caseResult.passed).toBe(true)
    expect(caseResult.returned).toBe(1)
  })

  it('animates exactly the declared structures, in declaration order', () => {
    expect(trace.structures.map((s) => `${s.name}:${s.kind}`)).toEqual([
      `${NUMS}:array`,
      `${TALLY}:array`,
    ])
    expect(new Set(problem.structures)).toEqual(new Set(trace.structures.map((s) => s.kind)))
  })

  it('starts the tally at all zeros', () => {
    const reader = new TraceReader(trace)
    const tallyId = idOf(trace, TALLY)
    const createdAt = trace.frames.findIndex((f) => f.snapshots[tallyId] !== undefined)
    expect(createdAt, 'tally is never snapshotted').toBeGreaterThanOrEqual(0)
    const first = resolve(reader, TALLY, 'array', createdAt)
    expect(first?.values).toEqual(new Array(32).fill(0))
  })

  for (const [index, testCase] of problem.cases.entries()) {
    it(`holds a true prefix bit-count at every checkpoint — ${testCase.name}`, () => {
      const run = executeRun({ problem: PROBLEM, useReference: true, caseIndex: index })
      const r = run.results[0]!
      expect(r.passed, testCase.name).toBe(true)
      expectTallyIsATruePrefixBitCount(r.trace, testCase.args[0] as number[], testCase.name)
      expectFinalTallyReconstructsAnswer(r.trace, r.returned as number, testCase.name)
      expectNumsResultMarksTheAnswer(r.trace, testCase.args[0] as number[], r.returned as number, testCase.name)
    })
  }

  it('leaves no active marks on the tally once the scan is over', () => {
    const reader = new TraceReader(trace)
    const last = reader.frameCount - 1
    const tally = resolve(reader, TALLY, 'array', last)
    expect(tally?.marks.filter((m) => m.class === 'active')).toEqual([])
  })

  it('handles a negative value: the sign-bit column (index 0) counts it correctly', () => {
    // [-1, 2, -1]: -1 has every one of its 32 bits set, including the sign bit, and it appears
    // twice — so column 0 should read 2 at the checkpoint after the second -1, then reconstruct
    // to the even (0) contribution it actually makes to the final answer, 2.
    const idx = problem.cases.findIndex((c) => c.name === 'all-ones bit pattern cancels')
    const run = executeRun({ problem: PROBLEM, useReference: true, caseIndex: idx })
    const r = run.results[0]!
    expect(r.returned).toBe(2)
    const reader = new TraceReader(r.trace)
    const stepFrame = r.trace.frames.find(
      (f) => f.op === 'step' && (f.label ?? '').startsWith('xor in nums[2] ='),
    )!
    const tally = resolve(reader, TALLY, 'array', stepFrame.index)!
    expect(tally.values[0], 'sign-bit column after both -1s').toBe(2)
    const last = reader.frameCount - 1
    const finalTally = resolve(reader, TALLY, 'array', last)!
    // Column 0 (the sign bit) ended even, so bit 0 of the answer (2 = 0b10, sign bit 0) is unset.
    expect(finalTally.values[0]).toBe(2)
    expect((finalTally.values[0] as number) % 2).toBe(0)
  })

  it('two orderings of the same multiset end at the same tally', () => {
    // Commutativity, checked rather than asserted: two different scan orders of the same
    // multiset must reach the same final tally, because addition (what the tally does) does not
    // care what order it happens in — the same reason XOR does not. Driven straight through the
    // reference function via the tracer's own `trace()` harness, bypassing the registered case
    // list entirely, since the point is to try an order that is not one of the shipped cases.
    const reference = singleNumber.reference as unknown as (nums: number[], viz: Viz) => number
    const a = [3, -9, 47, 999999, -9, 3, 47]
    const b = [999999, 47, -9, 3, 3, 47, -9]
    expect([...a].sort()).toEqual([...b].sort())

    const ta = runTrace((viz) => reference(a, viz))
    const tb = runTrace((viz) => reference(b, viz))
    expect(ta.value).toBe(999999)
    expect(tb.value).toBe(999999)

    const readerA = new TraceReader(ta.trace)
    const readerB = new TraceReader(tb.trace)
    const lastA = resolve(readerA, TALLY, 'array', readerA.frameCount - 1)!
    const lastB = resolve(readerB, TALLY, 'array', readerB.frameCount - 1)!
    expect(lastA.values).toEqual(lastB.values)
    // The two runs do not have to take the same number of frames to get there — only the
    // destination has to agree.
    expect(lastA.values).toEqual(trueTally(a))
  })
})

describe('the starter teaches the same picture, not just the same answer', () => {
  // Every assertion above runs on `useReference: true`, and the reference is not what a learner
  // opens. Five problems have shipped with a fix in the reference and the same defect left in the
  // starter, so the starter gets executed rather than trusted — and compared against the
  // reference's declaration *order*, not just checked for the same structures being present.
  const problem = requireProblem(PROBLEM)

  it('runs as shipped, with both panels on screen, nothing thrown, and the placeholder answer wrong', () => {
    const run = executeRun({ problem: PROBLEM, source: problem.starter, caseIndex: 0 })
    expect(run.diagnostics).toEqual([])
    const first = run.results[0]!
    expect(first.error).toBeUndefined()
    // The untouched starter's `acc` never leaves 0, and case 0 expects 1 — it must not
    // accidentally pass, or a learner's first impression is a green tick for code they wrote none
    // of.
    expect(first.returned).toBe(0)
    expect(first.passed).toBe(false)
    expect(first.trace.structures.map((s) => `${s.name}:${s.kind}`)).toEqual([
      `${NUMS}:array`,
      `${TALLY}:array`,
    ])
  })

  it('produces the same faithful animation when filled in exactly as its comments say', () => {
    // Written only from the starter's TODOs — no copying from the reference.
    const source = `
export default function singleNumber(nums, viz) {
  const a = viz.array(nums, { name: 'nums' })
  const tally = viz.array(32, { name: 'bit tally (count of 1s, MSB->LSB)' })
  const i = viz.cursor('i', 0, a)
  let acc = 0
  viz.watch(() => ({ acc, i: i.value }))

  for (i.value = 0; i.value < a.length; i.inc()) {
    const num = a[i.value]
    acc ^= num
    const bits = []
    for (let bit = 0; bit < 32; bit++) {
      if ((num >>> (31 - bit)) & 1) bits.push(bit)
    }
    tally.clearMarks('active')
    tally.mark(bits, 'active')
    for (const bit of bits) tally[bit] = tally[bit] + 1
    viz.step('xor in nums[' + i.value + '] = ' + num)
  }

  const resultBits = []
  for (let bit = 0; bit < 32; bit++) {
    if (tally.at(bit) % 2 === 1) resultBits.push(bit)
  }
  tally.mark(resultBits, 'result')

  for (let k = 0; k < a.length; k++) {
    if (a.at(k) === acc) {
      a.mark(k, 'result')
      break
    }
  }
  return acc
}
`
    const run = executeRun({ problem: PROBLEM, source })
    expect(run.diagnostics).toEqual([])
    expect(run.results.map((r) => [r.name, r.passed])).toEqual(
      problem.cases.map((c) => [c.name, true]),
    )

    // Declaration order matches the shipped starter's own — the same two panels, same order.
    const first = run.results[0]!
    expect(first.trace.structures.map((s) => `${s.name}:${s.kind}`)).toEqual([
      `${NUMS}:array`,
      `${TALLY}:array`,
    ])

    for (const [index, testCase] of problem.cases.entries()) {
      const r = run.results[index]!
      const input = testCase.args[0] as number[]
      expectTallyIsATruePrefixBitCount(r.trace, input, `starter: ${testCase.name}`)
      expectFinalTallyReconstructsAnswer(r.trace, r.returned as number, `starter: ${testCase.name}`)
      expectNumsResultMarksTheAnswer(r.trace, input, r.returned as number, `starter: ${testCase.name}`)
    }
  })
})

describe('the frame-sequence checks have teeth', () => {
  // An animation test that cannot fail reads like evidence and is worse than nothing. Both
  // solutions below return the *right answer for every case*, correctly narrated, while showing a
  // viewer nothing about why — which is the exact failure mode this problem exists to make
  // impossible to sneak past the tests.

  it('rejects a one-line XOR fold that never builds a tally at all', () => {
    // `nums.reduce((a, b) => a ^ b)`, instrumented just enough to declare `nums` and narrate each
    // step with the same wording the reference uses. Every case passes. That is the point.
    const source = `
export default function singleNumber(nums, viz) {
  const a = viz.array(nums, { name: 'nums' })
  const i = viz.cursor('i', 0, a)
  let acc = 0
  viz.watch(() => ({ acc, i: i.value }))
  for (i.value = 0; i.value < a.length; i.inc()) {
    const num = a[i.value]
    acc ^= num
    viz.step('xor in nums[' + i.value + '] = ' + num + ' -> running xor = ' + acc)
  }
  return acc
}
`
    const run = executeRun({ problem: PROBLEM, source })
    expect(run.diagnostics).toEqual([])
    expect(run.results.every((r) => r.passed)).toBe(true)

    const example = requireProblem(PROBLEM).cases.findIndex((c) => c.name.startsWith('example'))
    const input = requireProblem(PROBLEM).cases[example]!.args[0] as number[]
    expect(() =>
      expectTallyIsATruePrefixBitCount(run.results[example]!.trace, input, 'no tally'),
    ).toThrow(/no tally panel/)
  })

  it('rejects a tally that is declared but never actually filled in', () => {
    // The subtlest of the two: both panels exist, `structures` declares exactly `array` (which is
    // all this problem promises), and the answer is right, computed by a bare accumulator off to
    // the side. The tally panel sits on screen doing nothing, which is indistinguishable from
    // insight only if nobody checks whether the numbers in it are true.
    const source = `
export default function singleNumber(nums, viz) {
  const a = viz.array(nums, { name: 'nums' })
  const tally = viz.array(32, { name: 'bit tally (count of 1s, MSB->LSB)' })
  const i = viz.cursor('i', 0, a)
  let acc = 0
  viz.watch(() => ({ acc, i: i.value }))
  for (i.value = 0; i.value < a.length; i.inc()) {
    const num = a[i.value]
    acc ^= num
    viz.step('xor in nums[' + i.value + '] = ' + num + ' -> running xor = ' + acc)
  }
  return acc
}
`
    const run = executeRun({ problem: PROBLEM, source })
    expect(run.diagnostics).toEqual([])
    expect(run.results.every((r) => r.passed)).toBe(true)

    // The structure-kind check alone is fooled: both declared kinds were created.
    const first = run.results[0]!
    expect(new Set(first.trace.structures.map((s) => s.kind))).toEqual(
      new Set(requireProblem(PROBLEM).structures),
    )

    const example = requireProblem(PROBLEM).cases.findIndex((c) => c.name.startsWith('example'))
    const input = requireProblem(PROBLEM).cases[example]!.args[0] as number[]
    expect(() =>
      expectTallyIsATruePrefixBitCount(run.results[example]!.trace, input, 'decorative tally'),
    ).toThrow(/does not match the true bit-count/)
  })
})
