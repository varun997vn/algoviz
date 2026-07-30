import { describe, expect, it } from 'vitest'
import { executeRun } from '@algoviz/runner'
import { requireProblem } from '@algoviz/problems'
import { TraceReader, type StructureSnapshot, type Trace } from '@algoviz/tracer'

/**
 * LeetCode 1207 — Unique Number of Occurrences.
 *
 * The first problem to drive `VizMap` and `VizSet`, so this file is doing two jobs: proving this
 * animation is faithful, and being the first place either structure is asserted against a *run*
 * rather than against a hand-built snapshot.
 *
 * The answer is a boolean, which makes the usual "did it return the right thing?" test almost
 * worthless — a coin flip passes half the cases, and `return true` passes any case set that is
 * mostly true. So almost everything here is about the *picture*:
 *
 *  - `the map is the true tally of the prefix scanned so far, at every frame` is the assertion a
 *    solution that computes the answer with a plain JS object on the side cannot pass, no matter
 *    how right its return value is. `the frame-sequence checks have teeth` proves that by running
 *    exactly such a solution.
 *  - `the set only ever grows, and only by a count no row had yet` is the same test for the second
 *    pass, which is the half of this problem worth animating at all.
 *  - `every false case has a collision frame` is the load-bearing one. If the moment two values
 *    turn out to share a count has no frame of its own, with both culprits lit, the animation
 *    explains nothing — it just stops.
 */

const PROBLEM = 'unique-number-of-occurrences'
const ARR = 'arr'
const MAP = 'occurrences (value -> count)'
const SET = 'counts claimed'

/** The narration that must exist on exactly the frame the answer becomes false. */
const COLLISION = /^(-?\d+) and (-?\d+) both occur exactly (\d+) time\(s\)/

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
  const snap = reader.structureAt(idOf(reader.trace, name), frame)
  return snap?.kind === kind ? (snap as Extract<StructureSnapshot, { kind: K }>) : undefined
}

/** The map panel, read back as the tally it claims to be. */
function tallyOf(snap: Extract<StructureSnapshot, { kind: 'map' }>): Map<string, number> {
  return new Map(snap.entries.map((e) => [e.key, e.value as number]))
}

/** Ground truth: the counts of the first `k` elements, for every k, keyed the way a snapshot is. */
function prefixTallies(input: readonly number[]): Map<string, number>[] {
  const out: Map<string, number>[] = [new Map()]
  const running = new Map<string, number>()
  for (const v of input) {
    running.set(String(v), (running.get(String(v)) ?? 0) + 1)
    out.push(new Map(running))
  }
  return out
}

function sameTally(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}

/**
 * The map panel is never a lie: at every frame it holds the exact counts of some prefix of the
 * input, and those prefixes only move forward.
 *
 * A solution that tallies into a plain object and leaves the declared map empty fails the *last*
 * frame of this (an empty map is only the tally of the empty prefix). A solution whose map lags,
 * double-counts, or is written from the final answer in one go fails somewhere in the middle.
 */
function expectMapIsATruePrefixTally(trace: Trace, input: readonly number[], label: string): void {
  const reader = new TraceReader(trace)
  const wanted = prefixTallies(input)
  let reached = 0
  let checked = 0

  for (let i = 0; i < reader.frameCount; i += 1) {
    const snap = resolve(reader, MAP, 'map', i)
    if (!snap) continue
    const shown = tallyOf(snap)
    const at = wanted.findIndex((t) => sameTally(t, shown))
    expect(
      at,
      `${label} frame ${i}: map shows ${JSON.stringify([...shown])}, which is not the tally of any prefix of the input`,
    ).toBeGreaterThanOrEqual(0)
    expect(at, `${label} frame ${i}: the tally went backwards`).toBeGreaterThanOrEqual(reached)
    reached = at
    checked += 1
  }

  expect(checked, `${label}: no frame carried the map at all`).toBeGreaterThan(0)
  expect(
    reached,
    `${label}: the map never reached the full tally — it stopped at the ${reached}-element prefix of ${input.length}`,
  ).toBe(input.length)
}

/**
 * The set is a set of *counts*, it only grows, and it only ever gains a count that some row in
 * the map actually has. That last clause is what stops a solution from parking a decorative set
 * beside a real answer computed elsewhere.
 */
function expectSetGrowsOnlyOnDistinctCounts(trace: Trace, label: string): void {
  const reader = new TraceReader(trace)
  let previous: number[] = []
  let checked = 0

  for (let i = 0; i < reader.frameCount; i += 1) {
    const set = resolve(reader, SET, 'set', i)
    if (!set) continue
    const values = set.values as number[]

    expect(
      new Set(values).size,
      `${label} frame ${i}: set shows ${values.join(',')} — a set cannot hold a duplicate`,
    ).toBe(values.length)
    expect(
      values.slice(0, previous.length),
      `${label} frame ${i}: the set lost or reordered a count it already held`,
    ).toEqual(previous)
    expect(
      values.length - previous.length,
      `${label} frame ${i}: the set jumped from ${previous.length} to ${values.length} counts in one frame`,
    ).toBeLessThanOrEqual(1)

    const map = resolve(reader, MAP, 'map', i)
    if (map) {
      const counts = new Set(map.entries.map((e) => e.value as number))
      for (const claimed of values) {
        expect(
          counts.has(claimed),
          `${label} frame ${i}: the set claims count ${claimed}, which no row of the map has`,
        ).toBe(true)
      }
    }

    previous = values
    checked += 1
  }
  expect(checked, `${label}: no frame carried the set at all`).toBeGreaterThan(0)
}

/**
 * On a false case there is exactly one frame where the answer is decided, and on it the two
 * culprits are lit in all three panels. On a true case there is no such frame and nothing is
 * ever crossed out.
 */
function expectCollisionFrame(
  trace: Trace,
  input: readonly number[],
  expected: boolean,
  label: string,
): void {
  const reader = new TraceReader(trace)
  const hits = trace.frames.filter((f) => f.op === 'step' && COLLISION.test(f.label ?? ''))

  if (expected) {
    expect(hits, `${label}: a true case narrated a collision`).toHaveLength(0)
    const last = reader.frameCount - 1
    const map = resolve(reader, MAP, 'map', last)
    const set = resolve(reader, SET, 'set', last)
    const arr = resolve(reader, ARR, 'array', last)
    expect(map?.marks.filter((m) => m.class === 'excluded')).toEqual([])
    expect(set?.marks.filter((m) => m.class === 'excluded')).toEqual([])
    expect(arr?.marks.filter((m) => m.class === 'excluded')).toEqual([])
    // "Unique" is not the absence of evidence: every row claimed a count, and says so.
    expect(map?.marks.filter((m) => m.class === 'result')).toHaveLength(map?.entries.length ?? -1)
    expect(set?.values).toHaveLength(map?.entries.length ?? -1)
    return
  }

  expect(hits, `${label}: no frame says where the two equal counts were found`).toHaveLength(1)
  const frame = hits[0]!
  const parsed = COLLISION.exec(frame.label ?? '')!
  const rival = Number(parsed[1])
  const value = Number(parsed[2])
  const count = Number(parsed[3])
  expect(rival, `${label}: the collision names one value twice`).not.toBe(value)

  // The claim in the caption has to be true of the input, not merely of the caption.
  const occurrencesOf = (v: number): number[] =>
    input.flatMap((x, k) => (x === v ? [k] : []))
  expect(occurrencesOf(rival), `${label}: ${rival} does not occur ${count} times`).toHaveLength(count)
  expect(occurrencesOf(value), `${label}: ${value} does not occur ${count} times`).toHaveLength(count)

  // And the picture on that frame has to show it, in all three panels, without the caption.
  const map = resolve(reader, MAP, 'map', frame.index)!
  const set = resolve(reader, SET, 'set', frame.index)!
  const arr = resolve(reader, ARR, 'array', frame.index)!

  const guilty = map.marks.filter((m) => m.class === 'excluded').map((m) => m.key).sort()
  expect(guilty, `${label} frame ${frame.index}: the map does not light exactly the two tied rows`)
    .toEqual([String(rival), String(value)].sort())
  for (const key of guilty) {
    expect(
      map.entries.find((e) => e.key === key)?.value,
      `${label}: row ${key} is crossed out but does not show ${count}`,
    ).toBe(count)
  }

  const contested = set.marks.filter((m) => m.class === 'excluded').map((m) => m.index)
  expect(contested, `${label} frame ${frame.index}: the set does not light the contested count`)
    .toHaveLength(1)
  expect(set.values[contested[0]!], `${label}: the wrong set cell is lit`).toBe(count)

  const inArr = arr.marks
    .filter((m) => m.class === 'excluded')
    .map((m) => m.index)
    .sort((a, b) => a - b)
  expect(inArr, `${label}: the input does not point back at the two tied values`).toEqual(
    [...occurrencesOf(rival), ...occurrencesOf(value)].sort((a, b) => a - b),
  )
}

/** The one tie between the picture and the boolean: crossed-out rows exist iff the answer is false. */
function expectPictureAgreesWithAnswer(trace: Trace, returned: unknown, label: string): void {
  const reader = new TraceReader(trace)
  const last = reader.frameCount - 1
  const map = resolve(reader, MAP, 'map', last)!
  const crossedOut = map.marks.some((m) => m.class === 'excluded')
  expect(
    crossedOut,
    `${label}: returned ${String(returned)} while the final picture ${crossedOut ? 'shows' : 'shows no'} a tie`,
  ).toBe(returned === false)
}

describe('Unique Number of Occurrences — reference trace semantics', () => {
  // Located by name, not by position: the case order is a product decision (the workbench opens on
  // case 0, which must not be one an unwritten starter passes) and this block is about a specific
  // input, so pinning it to an index couples two unrelated things.
  const canonical = requireProblem(PROBLEM).cases.findIndex((c) =>
    c.name.includes('counts 3, 2 and 1'),
  )
  const result = executeRun({ problem: PROBLEM, useReference: true, caseIndex: canonical })
  const caseResult = result.results[0]!
  const trace = caseResult.trace
  const reader = new TraceReader(trace)
  const last = reader.frameCount - 1
  // [1,2,2,1,1,3] -> 1 occurs 3 times, 2 twice, 3 once.
  const input = [1, 2, 2, 1, 1, 3]

  it('returns true for the canonical example', () => {
    expect(caseResult.passed).toBe(true)
    expect(caseResult.returned).toBe(true)
  })

  it('animates exactly the declared structures, in declaration order', () => {
    expect(trace.structures.map((s) => `${s.name}:${s.kind}`)).toEqual([
      `${ARR}:array`,
      `${MAP}:map`,
      `${SET}:set`,
    ])
    // The registry's `structures` list drives the roadmap coverage matrix; if it disagrees with
    // what the run actually creates, the matrix quietly lies about map/set having a driver.
    expect(new Set(requireProblem(PROBLEM).structures)).toEqual(
      new Set(trace.structures.map((s) => s.kind)),
    )
  })

  it('ends with the true tally of the whole input', () => {
    const map = resolve(reader, MAP, 'map', last)!
    expect(map.entries).toEqual([
      { key: '1', value: 3 },
      { key: '2', value: 2 },
      { key: '3', value: 1 },
    ])
  })

  it('holds a true prefix tally at every frame', () => {
    expectMapIsATruePrefixTally(trace, input, 'example')
  })

  it('shows the first sighting of a value as a miss, not as a re-count', () => {
    // `occurrences.get(v)` over `peek(v)`: the miss is a real step of the algorithm, and it is
    // what makes "insert" and "update" legible as two different things in the op log.
    const labels = trace.frames.map((f) => f.label ?? '')
    expect(labels.filter((l) => l === 'get 1 -> miss')).toHaveLength(1)
    expect(labels.filter((l) => /^insert /.test(l))).toHaveLength(3)
    expect(labels.filter((l) => /^update /.test(l))).toHaveLength(input.length - 3)
  })

  it('interrogates the set once per row, before growing it', () => {
    const setId = idOf(trace, SET)
    const ops = trace.frames
      .filter((f) => f.structureId === setId && (f.op === 'read' || f.op === 'insert'))
      .map((f) => f.op)
    // has, add, has, add, has, add — the guard is a frame, and it is always the frame before.
    expect(ops).toEqual(['read', 'insert', 'read', 'insert', 'read', 'insert'])
  })

  it('claims every count and marks the row that claimed it', () => {
    const map = resolve(reader, MAP, 'map', last)!
    const set = resolve(reader, SET, 'set', last)!
    expect(set.values).toEqual([3, 2, 1])
    expect(map.marks.map((m) => `${m.key}:${m.class}`)).toEqual([
      '1:result',
      '2:result',
      '3:result',
    ])
  })

  it('never lets the set outrun the map', () => {
    expectSetGrowsOnlyOnDistinctCounts(trace, 'example')
  })

  it('narrates every element and every claim', () => {
    const steps = reader.stepFrames()
    // one per element counted, one closing the tally, one per row claimed, one closing the run
    expect(steps).toHaveLength(input.length + 1 + 3 + 1)
    expect(reader.captionAt(last)).toMatch(/all 3 count\(s\) were different/)
  })

  it('reports the same progress in the watch panel as the panels show', () => {
    for (let i = 0; i < reader.frameCount; i += 1) {
      const watch = reader.watchAt(i)
      const map = resolve(reader, MAP, 'map', i)
      const set = resolve(reader, SET, 'set', i)
      if (!watch || !map || !set) continue
      expect(watch.distinct, `frame ${i}: watch says ${String(watch.distinct)} distinct`).toBe(
        map.entries.length,
      )
      expect(watch.claimed, `frame ${i}: watch says ${String(watch.claimed)} claimed`).toBe(
        set.values.length,
      )
    }
  })
})

describe('Unique Number of Occurrences — the collision on a false case', () => {
  // [1,1,2,2]: both values occur twice, and the tie is found on the second row examined.
  const index = 5
  const problem = requireProblem(PROBLEM)
  const result = executeRun({ problem: PROBLEM, useReference: true, caseIndex: index })
  const caseResult = result.results[0]!
  const trace = caseResult.trace
  const reader = new TraceReader(trace)

  it('returns false', () => {
    expect(problem.cases[index]?.expected).toBe(false)
    expect(caseResult.passed).toBe(true)
    expect(caseResult.returned).toBe(false)
  })

  it('gives the collision a frame of its own, with both culprits lit', () => {
    expectCollisionFrame(trace, [1, 1, 2, 2], false, 'tied at 2')
  })

  it('stops at the collision instead of finishing the sweep', () => {
    // The set is interrogated twice and grown once: the second `has` is the answer, and nothing
    // after it happens. A solution that keeps walking is animating work it did not need to do.
    const setId = idOf(trace, SET)
    const ops = trace.frames
      .filter((f) => f.structureId === setId && (f.op === 'read' || f.op === 'insert'))
      .map((f) => `${f.op}:${f.label ?? ''}`)
    expect(ops).toEqual(['read:has 2 -> false', 'insert:add 2', 'read:has 2 -> true'])
  })

  it('crosses out nothing until the frame that decides the answer', () => {
    const collision = trace.frames.findIndex(
      (f) => f.op === 'step' && COLLISION.test(f.label ?? ''),
    )
    expect(collision).toBeGreaterThan(0)
    for (let i = 0; i < reader.frameCount; i += 1) {
      const excluded = [
        ...(resolve(reader, MAP, 'map', i)?.marks ?? []),
        ...(resolve(reader, SET, 'set', i)?.marks ?? []),
        ...(resolve(reader, ARR, 'array', i)?.marks ?? []),
      ].filter((m) => m.class === 'excluded')
      if (i < collision - 5) {
        expect(excluded, `frame ${i} crosses something out before the tie is found`).toEqual([])
      }
    }
    // And by the deciding frame everything is crossed out at once: 2 map rows, 1 set cell,
    // 4 array cells.
    const map = resolve(reader, MAP, 'map', collision)!
    const set = resolve(reader, SET, 'set', collision)!
    const arr = resolve(reader, ARR, 'array', collision)!
    expect(map.marks.filter((m) => m.class === 'excluded')).toHaveLength(2)
    expect(set.marks.filter((m) => m.class === 'excluded')).toHaveLength(1)
    expect(arr.marks.filter((m) => m.class === 'excluded')).toHaveLength(4)
  })

  it('leaves the deciding frame as the last thing on screen', () => {
    const last = reader.frameCount - 1
    expect(reader.captionAt(last)).toMatch(COLLISION)
  })
})

describe('Unique Number of Occurrences — every case, animation and answer', () => {
  const problem = requireProblem(PROBLEM)
  const result = executeRun({ problem: PROBLEM, useReference: true })

  it('passes all of its own cases', () => {
    expect(result.results.map((r) => [r.name, r.passed])).toEqual(
      problem.cases.map((c) => [c.name, true]),
    )
  })

  it('is not a case set a constant could pass', () => {
    // A boolean answer with a lopsided case set grades `return true` as a correct solution.
    const trues = problem.cases.filter((c) => c.expected === true).length
    const falses = problem.cases.length - trues
    expect(trues).toBeGreaterThanOrEqual(4)
    expect(falses).toBeGreaterThanOrEqual(4)
    // And the comparator is declared by the problem, not decided by the solution.
    expect(problem.comparator).toBe('boolean')
  })

  for (const [index, testCase] of problem.cases.entries()) {
    it(`${testCase.name}`, () => {
      const caseResult = result.results[index]!
      const trace = caseResult.trace
      const input = testCase.args[0] as number[]

      expectMapIsATruePrefixTally(trace, input, testCase.name)
      expectSetGrowsOnlyOnDistinctCounts(trace, testCase.name)
      expectCollisionFrame(trace, input, testCase.expected === true, testCase.name)
      expectPictureAgreesWithAnswer(trace, caseResult.returned, testCase.name)

      // Two linear passes, a bounded number of frames each. A solution that compared every pair
      // of values would be quadratic and would blow past this on the 217-element case.
      expect(
        caseResult.frameCount,
        `${testCase.name}: ${caseResult.frameCount} frames for n=${input.length}`,
      ).toBeLessThanOrEqual(8 * input.length + 30)
    })
  }

  it('shows one map row per distinct value and one set cell per distinct count', () => {
    for (const [index, testCase] of problem.cases.entries()) {
      const reader = new TraceReader(result.results[index]!.trace)
      const last = reader.frameCount - 1
      const input = testCase.args[0] as number[]
      const map = resolve(reader, MAP, 'map', last)!
      const set = resolve(reader, SET, 'set', last)!
      expect(map.entries, testCase.name).toHaveLength(new Set(input).size)
      // On a true case every count is claimed; on a false case the run stops at the tie, so the
      // set holds one cell per row examined before it.
      const counts = map.entries.map((e) => e.value as number)
      const expectedClaims = testCase.expected === true ? new Set(counts).size : set.values.length
      expect(set.values, testCase.name).toHaveLength(expectedClaims)
      expect(new Set(set.values).size, testCase.name).toBe(set.values.length)
    }
  })

  it('shows a single map row and a single claim when every element is the same value', () => {
    const index = problem.cases.findIndex((c) => c.name.startsWith('all equal'))
    const reader = new TraceReader(result.results[index]!.trace)
    const last = reader.frameCount - 1
    expect(resolve(reader, MAP, 'map', last)!.entries).toEqual([{ key: '5', value: 4 }])
    expect(resolve(reader, SET, 'set', last)!.values).toEqual([4])
  })

  it('carries 20 successful claims before the tie on the large false case', () => {
    const index = problem.cases.findIndex((c) => c.name === 'twenty distinct counts and then one repeat')
    const trace = result.results[index]!.trace
    const reader = new TraceReader(trace)
    const last = reader.frameCount - 1
    expect(resolve(reader, SET, 'set', last)!.values).toEqual([...Array(20).keys()].map((k) => k + 1))
    const collision = trace.frames.find((f) => f.op === 'step' && COLLISION.test(f.label ?? ''))
    expect(collision?.label).toMatch(/^7 and 21 both occur exactly 7 time\(s\)/)
  })
})

describe('the starter teaches the same picture, not just the same answer', () => {
  // Every assertion above runs on `useReference: true`, and the reference is not what a learner
  // opens. Three problems in this repo have now had a fix land in the reference and miss the
  // starter, so the starter gets executed rather than trusted.
  const problem = requireProblem(PROBLEM)

  it('runs as shipped, with all three panels on screen and nothing thrown', () => {
    const run = executeRun({ problem: PROBLEM, source: problem.starter, caseIndex: 0 })
    expect(run.diagnostics).toEqual([])
    const first = run.results[0]!
    expect(first.error).toBeUndefined()
    // It returns a placeholder `true`, so it is allowed to be wrong — but it must not be wrong
    // by crashing, and the panels it declares must exist from frame one.
    expect(first.trace.structures.map((s) => s.kind)).toEqual(['array', 'map', 'set'])
  })

  it('produces the same faithful animation when filled in exactly as its comments say', () => {
    // Written only from the starter's TODOs — no peeking at the reference.
    const source = `
export default function uniqueOccurrences(arr, viz) {
  const a = viz.array(arr, { name: 'arr' })
  const occurrences = viz.map([], { name: 'occurrences (value -> count)' })
  const claimed = viz.set([], { name: 'counts claimed' })
  const i = viz.cursor('i', 0, a)
  viz.watch(() => ({ i: i.value, distinct: occurrences.size, claimed: claimed.size }))

  for (i.value = 0; i.value < a.length; i.inc()) {
    const value = a[i.value]
    const soFar = occurrences.get(value) || 0
    occurrences.set(value, soFar + 1)
    viz.step('counting arr[' + i.value + ']')
  }

  for (const [value, count] of occurrences) {
    if (claimed.has(count)) {
      const rival = occurrences.toEntries().find(([, c]) => c === count)[0]
      occurrences.mark(rival, 'excluded')
      occurrences.mark(value, 'excluded')
      viz.step(rival + ' and ' + value + ' both occur ' + count + ' times')
      return false
    }
    claimed.add(count)
    occurrences.mark(value, 'result')
  }
  return true
}
`
    const run = executeRun({ problem: PROBLEM, source })
    expect(run.diagnostics).toEqual([])
    expect(run.results.map((r) => [r.name, r.passed])).toEqual(
      problem.cases.map((c) => [c.name, true]),
    )

    for (const [index, testCase] of problem.cases.entries()) {
      const trace = run.results[index]!.trace
      const input = testCase.args[0] as number[]
      expectMapIsATruePrefixTally(trace, input, `starter: ${testCase.name}`)
      expectSetGrowsOnlyOnDistinctCounts(trace, `starter: ${testCase.name}`)

      // The starter does not dictate the wording, so this is the collision check reduced to
      // what the comments actually promise: the run stops on a narrated frame, and on it two
      // map rows carrying the same count are crossed out.
      const reader = new TraceReader(trace)
      const last = reader.frameCount - 1
      const map = resolve(reader, MAP, 'map', last)!
      const excluded = map.marks.filter((m) => m.class === 'excluded').map((m) => m.key)
      if (testCase.expected === true) {
        expect(excluded, `starter: ${testCase.name}`).toEqual([])
        continue
      }
      expect(excluded, `starter: ${testCase.name}: expected two crossed-out rows`).toHaveLength(2)
      const counts = excluded.map((k) => map.entries.find((e) => e.key === k)?.value)
      expect(new Set(counts).size, `starter: ${testCase.name}: the crossed-out rows disagree`).toBe(1)
      expect(reader.captionAt(last), `starter: ${testCase.name}`).toMatch(/both occur \d+ times/)
    }
  })
})

describe('the frame-sequence checks have teeth', () => {
  // An animation test that cannot fail reads like evidence and is worse than nothing. Both of
  // these return the *right answer for every case* while showing a viewer nothing, which is the
  // exact failure mode this problem is here to make impossible.

  const declarations = `
  const a = viz.array(arr, { name: 'arr' })
  const occurrences = viz.map([], { name: 'occurrences (value -> count)' })
  const claimed = viz.set([], { name: 'counts claimed' })
`

  it('rejects a solution that tallies into a plain object beside an empty map panel', () => {
    const source = `
export default function uniqueOccurrences(arr, viz) {${declarations}
  const counts = {}
  for (const v of arr) counts[v] = (counts[v] || 0) + 1
  const seen = new Set()
  for (const c of Object.values(counts)) {
    if (seen.has(c)) return false
    seen.add(c)
  }
  return true
}
`
    const run = executeRun({ problem: PROBLEM, source })
    expect(run.diagnostics).toEqual([])
    // Every case passes. That is the point.
    expect(run.results.every((r) => r.passed)).toBe(true)
    expect(() =>
      expectMapIsATruePrefixTally(run.results[0]!.trace, [1, 2, 2, 1, 1, 3], 'plain object'),
    ).toThrow(/never reached the full tally/)
  })

  it('rejects a solution that fills the map honestly and then decides the answer off-screen', () => {
    const source = `
export default function uniqueOccurrences(arr, viz) {${declarations}
  const i = viz.cursor('i', 0, a)
  for (i.value = 0; i.value < a.length; i.inc()) {
    const value = a[i.value]
    occurrences.set(value, (occurrences.peek(value) || 0) + 1)
  }
  const seen = new Set()
  for (const [, count] of occurrences) {
    if (seen.has(count)) return false
    seen.add(count)
  }
  return true
}
`
    const run = executeRun({ problem: PROBLEM, source })
    expect(run.diagnostics).toEqual([])
    expect(run.results.every((r) => r.passed)).toBe(true)

    // The map half is genuinely animated, so the tally check passes...
    const canonical = requireProblem(PROBLEM).cases.findIndex((c) =>
      c.name.includes('counts 3, 2 and 1'),
    )
    expectMapIsATruePrefixTally(
      run.results[canonical]!.trace,
      requireProblem(PROBLEM).cases[canonical]!.args[0] as number[],
      'off-screen decision',
    )
    // ...and the half that matters is missing: the set never grows, and no false case can say
    // where its answer came from.
    const falseCase = requireProblem(PROBLEM).cases.findIndex((c) => c.expected === false)
    const trace = run.results[falseCase]!.trace
    const input = requireProblem(PROBLEM).cases[falseCase]!.args[0] as number[]
    expect(() => expectCollisionFrame(trace, input, false, 'off-screen decision')).toThrow(
      /no frame says where the two equal counts were found/,
    )
    const reader = new TraceReader(trace)
    expect(resolve(reader, SET, 'set', reader.frameCount - 1)!.values).toEqual([])
  })

  it('rejects a solution that narrates the collision but only points at one culprit', () => {
    // The subtlest of the three, and the one the caption cannot save you from: the run stops in
    // the right place and says the right sentence, and the picture under it lights one of the two
    // rows that tie. A viewer reading the panels instead of the prose learns nothing.
    const source = `
export default function uniqueOccurrences(arr, viz) {${declarations}
  const i = viz.cursor('i', 0, a)
  for (i.value = 0; i.value < a.length; i.inc()) {
    const value = a[i.value]
    occurrences.set(value, (occurrences.get(value) || 0) + 1)
  }
  for (const [value, count] of occurrences) {
    if (claimed.has(count)) {
      const rival = occurrences.toEntries().find(([, c]) => c === count)[0]
      occurrences.mark(value, 'excluded')
      viz.step(rival + ' and ' + value + ' both occur exactly ' + count + ' time(s) — not unique')
      return false
    }
    claimed.add(count)
    occurrences.mark(value, 'result')
  }
  return true
}
`
    const run = executeRun({ problem: PROBLEM, source })
    expect(run.diagnostics).toEqual([])
    expect(run.results.every((r) => r.passed)).toBe(true)

    const problem = requireProblem(PROBLEM)
    const falseCase = problem.cases.findIndex((c) => c.expected === false)
    const input = problem.cases[falseCase]!.args[0] as number[]
    expect(() =>
      expectCollisionFrame(run.results[falseCase]!.trace, input, false, 'one culprit'),
    ).toThrow(/does not light exactly the two tied rows/)
  })
})
