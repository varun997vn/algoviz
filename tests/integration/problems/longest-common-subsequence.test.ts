import { describe, expect, it } from 'vitest'
import { executeRun, type CaseResult } from '@algoviz/runner'
import { requireProblem } from '@algoviz/problems'
import { TraceReader, type Frame, type Mark2D, type StructureSnapshot } from '@algoviz/tracer'

/**
 * LeetCode 1143 — trace semantics.
 *
 * The number this problem returns is worth almost nothing as evidence: a plain-JS solution that
 * never touches `viz` at all returns it, and so does one that computes the whole table in a local
 * array and pastes the finished result into the panel at the end. What has to be true is that the
 * *table explains the recurrence* — that each cell is written in a frame of its own, and that the
 * frame straight after it lights **exactly** the neighbour or neighbours that cell's value came
 * from: the diagonal when the two characters match, above-and-left when they do not.
 *
 * So every assertion here is written against the frame sequence and re-derived from the two input
 * strings inside the test, never from the trace itself. And the audit is applied to three
 * solutions: the reference, the shipped starter filled in from its own TODO comments, and two
 * deliberately wrong-but-answer-correct impostors that it must reject.
 */

const SLUG = 'longest-common-subsequence'

type DpSnapshot = Extract<StructureSnapshot, { kind: 'dp' }>
type StringSnapshot = Extract<StructureSnapshot, { kind: 'string' }>

/** The truth table, computed here so the trace is never checked against itself. */
function lcsTable(text1: string, text2: string): number[][] {
  const table = Array.from({ length: text1.length + 1 }, () => new Array<number>(text2.length + 1).fill(0))
  for (let r = 1; r <= text1.length; r += 1) {
    for (let c = 1; c <= text2.length; c += 1) {
      table[r]![c] =
        text1[r - 1] === text2[c - 1]
          ? table[r - 1]![c - 1]! + 1
          : Math.max(table[r - 1]![c]!, table[r]![c - 1]!)
    }
  }
  return table
}

function runReference(caseIndex: number): CaseResult {
  const result = executeRun({ problem: SLUG, useReference: true, caseIndex })
  expect(result.diagnostics).toEqual([])
  const caseResult = result.results[0]
  expect(caseResult, `case ${caseIndex} produced no result`).toBeDefined()
  expect(caseResult!.error).toBeUndefined()
  expect(caseResult!.passed).toBe(true)
  return caseResult!
}

function dpIdOf(trace: CaseResult['trace']): string {
  const meta = trace.structures.find((s) => s.kind === 'dp')
  expect(meta, 'the solution never created a dp table').toBeDefined()
  return meta!.id
}

function dpIn(frame: Frame, dpId: string): DpSnapshot {
  const snap = frame.snapshots[dpId]
  expect(snap?.kind, `frame ${frame.index} carries no dp snapshot`).toBe('dp')
  return snap as DpSnapshot
}

function dpAt(reader: TraceReader, dpId: string, index: number): DpSnapshot {
  const snap = reader.structureAt(dpId, index)
  expect(snap?.kind, `no dp table resolved at frame ${index}`).toBe('dp')
  return snap as DpSnapshot
}

function compareCells(frame: Frame, dpId: string): [number, number][] {
  return dpIn(frame, dpId)
    .marks.filter((m: Mark2D) => m.class === 'compare')
    .map((m: Mark2D): [number, number] => [m.row, m.col])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

/** `dp[3][2] = 7` -> [3, 2, 7]. Writes are the only frames whose label has this shape. */
function parseWrite(frame: Frame): [number, number, number] {
  const match = /^dp\[(\d+)]\[(\d+)] = (-?\d+)$/.exec(frame.label ?? '')
  expect(match, `write frame ${frame.index} has an unparseable label: ${frame.label}`).toBeTruthy()
  return [Number(match![1]), Number(match![2]), Number(match![3])]
}

interface Audit {
  text1: string
  text2: string
  trace: CaseResult['trace']
  returned: unknown
  who: string
}

/**
 * Everything that has to be true of the animation, in one place, so the reference, the filled-in
 * starter and the impostors are all held to the identical bar.
 */
function auditAnimation({ text1, text2, trace, returned, who }: Audit): void {
  const m = text1.length
  const n = text2.length
  const truth = lcsTable(text1, text2)
  const reader = new TraceReader(trace)
  const dpId = dpIdOf(trace)

  // ---- the table is the 2-D one this problem needs, labelled with the two strings ------------
  // The declaring frame, not frame 0: the two strings are created first, so the table does not
  // exist yet at the start of the trace.
  const declared = trace.frames.find((f) => f.snapshots[dpId])
  expect(declared, `${who}: the dp table is never snapshotted`).toBeDefined()
  const first = dpIn(declared!, dpId)
  expect(first.dims, `${who}: the table must be 2-D`).toBe(2)
  expect((first.values as (number | null)[][]).length, `${who}: row count`).toBe(m + 1)
  expect((first.values as (number | null)[][])[0]!.length, `${who}: column count`).toBe(n + 1)
  // Dead in the renderer today (nothing reads `axisLabels`), and declared anyway: the moment
  // `DpViz` grows a header row this is what puts the characters on the axes.
  expect(first.axisLabels, `${who}: axis labels`).toEqual([text1, text2])

  const allWrites = trace.frames.filter((f) => f.op === 'write' && f.structureId === dpId)
  // The cells the *recurrence* decides. The border is seeded separately and checked below.
  const writes = allWrites.filter((f) => {
    const [r, c] = parseWrite(f)
    return r >= 1 && c >= 1
  })

  // ---- THE assertion: dependsOn lights exactly the source cells, for exactly one frame -------
  for (const write of writes) {
    const [r, c, value] = parseWrite(write)
    const matched = text1[r - 1] === text2[c - 1]
    const expectedSources: [number, number][] = matched
      ? [[r - 1, c - 1]]
      : [
          [r - 1, c],
          [r, c - 1],
        ].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!) as [number, number][]

    // Immediately after the write, so the viewer sees the new value and its origin together.
    const dependsOn = trace.frames[write.index + 1]
    expect(dependsOn?.op, `${who}: dp[${r}][${c}] is not followed by a dependency frame`).toBe(
      'compare',
    )
    expect(
      compareCells(dependsOn!, dpId),
      `${who}: dp[${r}][${c}] (${matched ? 'match' : 'no match'}) named the wrong source cells`,
    ).toEqual(expectedSources)

    // Not merely the right coordinates — the values standing in those cells at that moment must
    // actually produce the value written. This is what a solution that lights a fixed pair of
    // neighbours regardless of the match cannot satisfy.
    const values = dpIn(dependsOn!, dpId).values as (number | null)[][]
    const source = expectedSources.map(([sr, sc]) => values[sr]![sc])
    expect(
      matched ? (source[0] as number) + 1 : Math.max(...(source as number[])),
      `${who}: the cells dp[${r}][${c}] pointed at do not add up to ${value}`,
    ).toBe(value)

    // Transient by construction: gone on the very next frame, never accumulating.
    const after = dpAt(reader, dpId, dependsOn!.index + 1)
    expect(
      after.marks.filter((mk) => mk.class === 'compare'),
      `${who}: the dependency highlight on dp[${r}][${c}] leaked past its frame`,
    ).toEqual([])
  }
  expect(
    trace.frames.filter((f) => f.op === 'compare').length,
    `${who}: one dependency frame per computed cell`,
  ).toBe(m * n)

  // ---- the border first, then one visible write per interior cell, row-major -----------------
  const expectedOrder: string[] = []
  for (let c = 0; c <= n; c += 1) expectedOrder.push(`0,${c}`)
  for (let r = 1; r <= m; r += 1) expectedOrder.push(`${r},0`)
  for (let r = 1; r <= m; r += 1) for (let c = 1; c <= n; c += 1) expectedOrder.push(`${r},${c}`)
  expect(
    allWrites.map((f) => parseWrite(f).slice(0, 2).join(',')),
    `${who}: the border is not laid down before a row-major fill of the interior`,
  ).toEqual(expectedOrder)

  // ---- every written value is the real recurrence value for that prefix pair -----------------
  for (const write of allWrites) {
    const [r, c, value] = parseWrite(write)
    expect(value, `${who}: dp[${r}][${c}] is not the LCS of the two prefixes`).toBe(truth[r]![c])
  }

  // ---- the carets agree with the cell being decided -----------------------------------------
  const stringIds = trace.structures.filter((s) => s.kind === 'string').map((s) => s.id)
  expect(stringIds.length, `${who}: both strings should be on screen`).toBe(2)
  for (const write of writes) {
    const [r, c] = parseWrite(write)
    const [a, b] = stringIds.map(
      (id) => reader.structureAt(id, write.index) as StringSnapshot,
    ) as [StringSnapshot, StringSnapshot]
    expect(a.cursors.find((cur) => cur.name === 'i')?.index, `${who}: caret i at dp[${r}][${c}]`).toBe(
      r - 1,
    )
    expect(b.cursors.find((cur) => cur.name === 'j')?.index, `${who}: caret j at dp[${r}][${c}]`).toBe(
      c - 1,
    )
  }

  // ---- blank ahead of the fill front --------------------------------------------------------
  // By the first narrated frame the border is down; everything the algorithm has not reached yet
  // must still be `null`, so "not computed" and "computed, equals zero" never look alike — and a
  // solution that pastes a finished table in cannot pass this.
  for (const step of reader.stepFrames()) {
    const done = writes.filter((w) => w.index < step).length
    const values = dpAt(reader, dpId, step).values as (number | null)[][]
    for (let c = 0; c <= n; c += 1) expect(values[0]![c], `${who}: row 0 at frame ${step}`).toBe(0)
    for (let r = 1; r <= m; r += 1) {
      expect(values[r]![0], `${who}: column 0 at frame ${step}`).toBe(0)
      for (let c = 1; c <= n; c += 1) {
        const rank = (r - 1) * n + c // 1-based position in row-major fill order
        if (rank <= done) {
          expect(values[r]![c], `${who}: dp[${r}][${c}] behind the front at frame ${step}`).toBe(
            truth[r]![c],
          )
        } else {
          expect(values[r]![c], `${who}: dp[${r}][${c}] filled ahead of the front at frame ${step}`).toBe(
            null,
          )
        }
      }
    }
  }

  // ---- narration: one caption per computed cell, plus the base-case one ----------------------
  expect(reader.stepFrames().length, `${who}: one narrated step per cell, plus the seed`).toBe(
    m * n + 1,
  )

  // ---- the end state ------------------------------------------------------------------------
  const final = dpAt(reader, dpId, reader.frameCount - 1)
  const values = final.values as (number | null)[][]
  expect(values, `${who}: the finished table`).toEqual(truth)
  expect(values[m]![n], `${who}: the corner is the answer`).toBe(returned)
  expect(
    final.marks.filter((mk) => mk.class === 'result').map((mk) => [mk.row, mk.col]),
    `${who}: the answer cell is marked`,
  ).toEqual([[m, n]])
  expect(
    final.marks.filter((mk) => mk.class === 'compare'),
    `${who}: dependency highlights must not survive to the end`,
  ).toEqual([])
  expect((reader.watchAt(reader.frameCount - 1) as { lcs?: number }).lcs, `${who}: watch`).toBe(
    returned,
  )
}

describe('Longest Common Subsequence — the reference animates the recurrence', () => {
  // Case 0 is "abcde" / "ace": both branches of the recurrence fire, and it is small enough to
  // read cell by cell.
  const caseResult = runReference(0)

  it('returns 3 for "abcde" / "ace"', () => {
    expect(caseResult.returned).toBe(3)
  })

  it('passes the full animation audit', () => {
    auditAnimation({
      text1: 'abcde',
      text2: 'ace',
      trace: caseResult.trace,
      returned: caseResult.returned,
      who: 'reference',
    })
  })

  it('names the diagonal on a match and the two neighbours otherwise', () => {
    // Spelled out on the three cells a reader would check by hand, so a regression says *which*
    // branch broke rather than only that the audit failed.
    const dpId = dpIdOf(caseResult.trace)
    const byLabel = (label: string): Frame =>
      caseResult.trace.frames.find((f) => f.op === 'compare' && f.label === label)!

    expect(compareCells(byLabel('dp[1][1] = dp[0][0] + 1'), dpId)).toEqual([[0, 0]])
    expect(compareCells(byLabel('dp[3][2] = dp[2][1] + 1'), dpId)).toEqual([[2, 1]])
    expect(compareCells(byLabel('dp[5][3] = dp[4][2] + 1'), dpId)).toEqual([[4, 2]])
    expect(compareCells(byLabel('dp[2][2] = max(dp[1][2], dp[2][1])'), dpId)).toEqual([
      [1, 2],
      [2, 1],
    ])
  })

  it('narrates the two branches in words a learner can follow', () => {
    const steps = caseResult.trace.frames.filter((f) => f.op === 'step').map((f) => f.label)
    expect(steps[0]).toBe('row 0 and column 0 are 0 — an empty prefix has no common subsequence')
    expect(steps[1]).toBe("text1[0] = text2[0] = 'a' — match, extend the diagonal to 1")
    expect(steps[2]).toBe(
      "text1[0] = 'a', text2[1] = 'c' — no match, better of above (0) and left (1) = 1",
    )
    expect(steps.at(-1)).toBe("text1[4] = text2[2] = 'e' — match, extend the diagonal to 3")
  })

  it('lays the border down on screen, inside its own group, before the fill starts', () => {
    // Not `viz.quiet`. Quiet suppresses frame emission and a structure's snapshot only exists on
    // the frames that touch it, so a border written entirely inside a quiet block leaves the dp
    // resolving to its pre-quiet snapshot: the frame captioned "row 0 and column 0 are 0" would
    // show an empty table. m + n + 1 frames against the m * n the fill spends is a fair price.
    const reader = new TraceReader(caseResult.trace)
    const dpId = dpIdOf(caseResult.trace)
    const values = dpAt(reader, dpId, reader.stepFrames()[0]!).values as (number | null)[][]
    expect(values[0]).toEqual([0, 0, 0, 0])
    expect(values.map((row) => row[0])).toEqual([0, 0, 0, 0, 0, 0])
    expect(values[1]!.slice(1)).toEqual([null, null, null])

    const seeded = caseResult.trace.frames.filter(
      (f) =>
        f.op === 'write' &&
        f.groups.includes('base cases — an empty prefix has no common subsequence'),
    )
    expect(seeded.map((f) => f.label)).toEqual([
      'dp[0][0] = 0',
      'dp[0][1] = 0',
      'dp[0][2] = 0',
      'dp[0][3] = 0',
      'dp[1][0] = 0',
      'dp[2][0] = 0',
      'dp[3][0] = 0',
      'dp[4][0] = 0',
      'dp[5][0] = 0',
    ])
  })

  it('keeps the frame count proportional to the table, not to something worse', () => {
    // 5 x 3 interior cells, at most ten frames each.
    expect(caseResult.frameCount).toBeLessThan(20 + 10 * 15)
  })
})

describe('Longest Common Subsequence — every shape of input holds up', () => {
  for (const [caseIndex, text1, text2] of [
    [1, 'abc', 'abc'], // every cell a match
    [2, 'abc', 'def'], // no cell a match; the whole table stays 0
    [3, 'a', 'a'], // the smallest table with a computed cell
    [4, 'a', 'b'], // the smallest table whose answer is 0
    [5, 'aaaa', 'aa'], // duplicates on both sides
    [6, 'abcdefg', 'g'], // one column
    [7, 'g', 'abcdefg'], // one row
    [8, 'abcba', 'abcbcba'], // interleaved repeats
  ] as const) {
    it(`"${text1}" / "${text2}"`, () => {
      const caseResult = runReference(caseIndex)
      auditAnimation({
        text1,
        text2,
        trace: caseResult.trace,
        returned: caseResult.returned,
        who: `reference ${text1}/${text2}`,
      })
    })
  }

  it('never lets the answer cell be 0 by accident when there is no common subsequence', () => {
    // "abc"/"def": the returned 0 and the table full of 0s are both correct, and the picture must
    // still distinguish them from "not computed" — every cell is written, none is left blank.
    const caseResult = runReference(2)
    const reader = new TraceReader(caseResult.trace)
    const dpId = dpIdOf(caseResult.trace)
    const values = dpAt(reader, dpId, reader.frameCount - 1).values as (number | null)[][]
    expect(values.flat().some((v) => v === null)).toBe(false)
    expect(caseResult.returned).toBe(0)
    expect(caseResult.trace.frames.filter((f) => f.op === 'compare')).toHaveLength(9)
  })
})

/**
 * The starter is what a learner actually opens, and this repo has shipped fixes that landed in a
 * reference and missed the starter. So the starter is executed, not trusted.
 */
describe('Longest Common Subsequence — the starter teaches the same picture', () => {
  const problem = requireProblem(SLUG)

  it('creates both strings and the 2-D table before a single TODO is filled in', () => {
    const run = executeRun({ problem: SLUG, source: problem.starter, caseIndex: 0 })
    expect(run.diagnostics).toEqual([])
    const result = run.results[0]!
    expect(result.trace.structures.map((s) => s.kind)).toEqual(['string', 'string', 'dp'])

    // And it fails in the one way that points straight back at the TODO: the answer cell was
    // never computed. `null`-filling the table is what buys that message instead of a plausible 0.
    expect(result.error?.name).toBe('RangeError')
    expect(result.error?.message).toContain('has not been computed yet')
  })

  it('produces the same faithful animation when filled in exactly as its comments say', () => {
    // Written only from the starter's own TODO text — no peeking at the reference.
    const source = problem.starter.replace(
      / {6}\/\/ TODO[\s\S]*?viz\.step\('dp\[' \+ r \+ '\]\[' \+ c \+ '\]'\)\n/,
      `      if (a.charAt(i.value) === b.charAt(j.value)) {
        dp.set(r, c, dp.get(r - 1, c - 1) + 1)
        dp.dependsOn([[r - 1, c - 1]], 'dp[' + r + '][' + c + '] = dp[' + (r - 1) + '][' + (c - 1) + '] + 1')
      } else {
        dp.set(r, c, Math.max(dp.get(r - 1, c), dp.get(r, c - 1)))
        dp.dependsOn([[r - 1, c], [r, c - 1]], 'dp[' + r + '][' + c + '] = max(above, left)')
      }
      viz.step('dp[' + r + '][' + c + ']')
`,
    )
    expect(source, 'the starter TODO block no longer matches this test').not.toBe(problem.starter)

    const run = executeRun({ problem: SLUG, source, caseIndex: 0 })
    expect(run.diagnostics).toEqual([])
    const result = run.results[0]!
    expect(result.error).toBeUndefined()
    expect(result.passed).toBe(true)
    auditAnimation({
      text1: 'abcde',
      text2: 'ace',
      trace: result.trace,
      returned: result.returned,
      who: 'filled starter',
    })
  })
})

/**
 * The audit's teeth.
 *
 * Both impostors return the correct number for every case, so `passed` is true for both and the
 * case list has nothing to say about them. What separates them from a real solution is only
 * visible in the frame sequence — which is the entire argument for this file existing.
 */
/** Correct answer, zero explanation: the table is computed in a local array and pasted in. */
const BULK_DUMP = `export default function longestCommonSubsequence(text1, text2, viz) {
  const m = text1.length
  const n = text2.length
  const table = []
  for (let r = 0; r <= m; r += 1) table.push(new Array(n + 1).fill(0))
  for (let r = 1; r <= m; r += 1) {
    for (let c = 1; c <= n; c += 1) {
      table[r][c] = text1[r - 1] === text2[c - 1]
        ? table[r - 1][c - 1] + 1
        : Math.max(table[r - 1][c], table[r][c - 1])
    }
  }
  const a = viz.string(text1, { name: 'text1' })
  const b = viz.string(text2, { name: 'text2' })
  const dp = viz.dp2d(m + 1, n + 1, null, { name: 'dp', axisLabels: [text1, text2] })
  viz.cursor('i', 0, a)
  viz.cursor('j', 0, b)
  viz.watch(() => ({ lcs: table[m][n] }))
  for (let r = 0; r <= m; r += 1) {
    for (let c = 0; c <= n; c += 1) dp.set(r, c, table[r][c])
  }
  dp.mark(m, n, 'result', 'LCS length')
  viz.step('done')
  return table[m][n]
}`

describe('Longest Common Subsequence — the audit rejects answer-correct impostors', () => {
  function auditOf(source: string, who: string): () => void {
    const run = executeRun({ problem: SLUG, source, caseIndex: 0 })
    expect(run.diagnostics, `${who} should compile`).toEqual([])
    const result = run.results[0]!
    expect(result.error, `${who} should not throw`).toBeUndefined()
    // The point: it is *correct*. The comparator is happy, the case bar is green.
    expect(result.passed, `${who} should return the right answer`).toBe(true)
    expect(result.returned, `${who} should return the right answer`).toBe(3)
    return () =>
      auditAnimation({
        text1: 'abcde',
        text2: 'ace',
        trace: result.trace,
        returned: result.returned,
        who,
      })
  }

  it('rejects a solution that computes in plain arrays and pastes the finished table in', () => {
    const audit = auditOf(BULK_DUMP, 'bulk-dump impostor')
    expect(audit).toThrow(/is not followed by a dependency frame/)

    // Named explicitly, because "it throws" is not the same as "it throws for the right reason":
    // the table fills, the corner is right and the answer is right, and not one frame in the whole
    // run says where a value came from.
    const trace = executeRun({ problem: SLUG, source: BULK_DUMP, caseIndex: 0 }).results[0]!.trace
    expect(trace.frames.filter((f) => f.op === 'compare')).toEqual([])
    expect(trace.frames.filter((f) => f.op === 'step')).toHaveLength(1)
  })

  it('rejects a solution that always blames the same two neighbours', () => {
    // Subtler, and the one this problem is really about: the table fills cell by cell, every cell
    // is narrated, `dependsOn` fires on every cell — and it points at "above and left" even on a
    // match, where the value came from the diagonal. The number is right; the explanation is a lie.
    const audit = auditOf(
      `export default function longestCommonSubsequence(text1, text2, viz) {
  const a = viz.string(text1, { name: 'text1' })
  const b = viz.string(text2, { name: 'text2' })
  const dp = viz.dp2d(a.length + 1, b.length + 1, null, { name: 'dp', axisLabels: [text1, text2] })
  const i = viz.cursor('i', 0, a)
  const j = viz.cursor('j', 0, b)
  viz.watch(() => ({ lcs: dp.peek(a.length, b.length) }))
  viz.group('base cases — an empty prefix has no common subsequence', () => {
    for (let c = 0; c <= b.length; c += 1) dp.set(0, c, 0)
    for (let r = 1; r <= a.length; r += 1) dp.set(r, 0, 0)
  })
  viz.step('seed')
  for (i.value = 0; i.value < a.length; i.inc()) {
    for (j.value = 0; j.value < b.length; j.inc()) {
      const r = i.value + 1
      const c = j.value + 1
      if (a.charAt(i.value) === b.charAt(j.value)) dp.set(r, c, dp.get(r - 1, c - 1) + 1)
      else dp.set(r, c, Math.max(dp.get(r - 1, c), dp.get(r, c - 1)))
      dp.dependsOn([[r - 1, c], [r, c - 1]], 'above and left')
      viz.step('dp[' + r + '][' + c + ']')
    }
  }
  dp.mark(a.length, b.length, 'result', 'LCS length')
  return dp.get(a.length, b.length)
}`,
      'fixed-neighbour impostor',
    )
    expect(audit).toThrow(/named the wrong source cells/)
  })

  it('rejects a solution that zero-fills the table instead of leaving it blank', () => {
    // The likeliest real mistake, and the reason the reference passes `null` as the fill. Every
    // frame is right; the table just starts as a wall of zeros, so there is no fill front to
    // watch and, on a case whose answer is 0, "not computed" and "computed, equals zero" are the
    // same picture. One character of the solution differs from a correct one.
    const audit = auditOf(
      `export default function longestCommonSubsequence(text1, text2, viz) {
  const a = viz.string(text1, { name: 'text1' })
  const b = viz.string(text2, { name: 'text2' })
  const dp = viz.dp2d(a.length + 1, b.length + 1, 0, { name: 'dp', axisLabels: [text1, text2] })
  const i = viz.cursor('i', 0, a)
  const j = viz.cursor('j', 0, b)
  viz.watch(() => ({ lcs: dp.peek(a.length, b.length) }))
  viz.group('base cases — an empty prefix has no common subsequence', () => {
    for (let c = 0; c <= b.length; c += 1) dp.set(0, c, 0)
    for (let r = 1; r <= a.length; r += 1) dp.set(r, 0, 0)
  })
  viz.step('seed')
  for (i.value = 0; i.value < a.length; i.inc()) {
    for (j.value = 0; j.value < b.length; j.inc()) {
      const r = i.value + 1
      const c = j.value + 1
      if (a.charAt(i.value) === b.charAt(j.value)) {
        dp.set(r, c, dp.get(r - 1, c - 1) + 1)
        dp.dependsOn([[r - 1, c - 1]], 'diagonal')
      } else {
        dp.set(r, c, Math.max(dp.get(r - 1, c), dp.get(r, c - 1)))
        dp.dependsOn([[r - 1, c], [r, c - 1]], 'above and left')
      }
      viz.step('dp[' + r + '][' + c + ']')
    }
  }
  dp.mark(a.length, b.length, 'result', 'LCS length')
  return dp.get(a.length, b.length)
}`,
      'zero-fill impostor',
    )
    expect(audit).toThrow(/filled ahead of the front/)
  })
})
