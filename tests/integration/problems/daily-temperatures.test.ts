import { describe, expect, it } from 'vitest'
import { executeRun } from '@algoviz/runner'
import { requireProblem } from '@algoviz/problems'
import { TraceReader, type Primitive, type StructureSnapshot, type Trace } from '@algoviz/tracer'

/**
 * LeetCode 739 — Daily Temperatures.
 *
 * The load-bearing test in this file is `holds the monotonic invariant at every frame`. Every
 * other assertion here would also pass for a solution that used *some* stack; only that one
 * proves the animation depicts a **monotonic** stack, which is the entire thing this problem
 * exists to show.
 *
 * Note the invariant is non-increasing, not strictly decreasing: "warmer" is strict, so an equal
 * temperature never pops and two tied days sit on the stack together. Asserting strict decrease
 * would fail on the `all equal` and `duplicates mid-array` cases — the animation would be right
 * and the test wrong.
 */

const PROBLEM = 'daily-temperatures'
const TEMPS = 'temperatures'
const ANSWER = 'answer'
const STACK = 'waiting (day #)'

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

/** Push/pop history reconstructed from the stack's own snapshots, not from frame labels. */
function stackHistory(trace: Trace): { pushed: number[]; popped: number[] } {
  const stackId = idOf(trace, STACK)
  const pushed: number[] = []
  const popped: number[] = []
  let prev: Primitive[] = []
  for (const frame of trace.frames) {
    const snap = frame.snapshots[stackId]
    if (!snap || snap.kind !== 'stack') continue
    if (snap.values.length > prev.length) {
      pushed.push(...(snap.values.slice(prev.length) as number[]))
    } else if (snap.values.length < prev.length) {
      popped.push(...(prev.slice(snap.values.length) as number[]))
    }
    prev = snap.values
  }
  return { pushed, popped }
}

/**
 * The invariant, checked on every frame of a trace.
 *
 * Two separate claims, both visible in the picture:
 *  - the stack holds *day numbers* in increasing order (days are pushed as the scan passes them),
 *  - the temperatures at those days never increase from the bottom of the stack to the top.
 */
function expectMonotonicEveryFrame(trace: Trace, label: string): void {
  const reader = new TraceReader(trace)
  let checked = 0

  for (let i = 0; i < reader.frameCount; i += 1) {
    const stack = resolve(reader, STACK, 'stack', i)
    const temps = resolve(reader, TEMPS, 'array', i)
    if (!stack || !temps) continue
    const days = stack.values as number[]

    for (const day of days) {
      expect(
        Number.isInteger(day) && day >= 0 && day < temps.values.length,
        `${label} frame ${i}: stack holds ${day}, which is not a day index`,
      ).toBe(true)
    }

    const onStack = days.map((day) => temps.values[day] as number)
    for (let k = 1; k < days.length; k += 1) {
      expect(
        days[k]!,
        `${label} frame ${i}: stack days ${days.join(',')} are not in scan order`,
      ).toBeGreaterThan(days[k - 1]!)
      expect(
        onStack[k]!,
        `${label} frame ${i}: stack temps bottom->top are ${onStack.join(',')} — slot ${k} is warmer than the one below it, so this is not a monotonic stack`,
      ).toBeLessThanOrEqual(onStack[k - 1]!)
    }
    checked += 1
  }

  // Guard against the invariant "holding" because nothing was ever resolved.
  expect(checked, `${label}: no frame carried both structures`).toBeGreaterThan(0)
}

describe('Daily Temperatures — reference trace semantics', () => {
  const result = executeRun({ problem: PROBLEM, useReference: true, caseIndex: 0 })
  const caseResult = result.results[0]!
  const trace = caseResult.trace
  const reader = new TraceReader(trace)
  const last = reader.frameCount - 1
  const returned = caseResult.returned as number[]

  it('returns the known answer for the canonical example', () => {
    expect(caseResult.passed).toBe(true)
    expect(returned).toEqual([1, 1, 4, 2, 1, 1, 0, 0])
  })

  it('animates exactly the declared structures', () => {
    expect(trace.structures.map((s) => `${s.name}:${s.kind}`)).toEqual([
      `${TEMPS}:array`,
      `${ANSWER}:array`,
      `${STACK}:stack`,
    ])
  })

  it('holds the monotonic invariant at every frame', () => {
    expectMonotonicEveryFrame(trace, 'example')
  })

  it('is strictly decreasing on this case, where no two stacked days ever tie', () => {
    // The general invariant is non-increasing; on distinct temperatures it tightens to strict,
    // and that is the picture a learner is shown first.
    for (let i = 0; i < reader.frameCount; i += 1) {
      const stack = resolve(reader, STACK, 'stack', i)
      const temps = resolve(reader, TEMPS, 'array', i)
      if (!stack || !temps) continue
      const onStack = (stack.values as number[]).map((d) => temps.values[d] as number)
      for (let k = 1; k < onStack.length; k += 1) {
        expect(onStack[k]!, `frame ${i}: ${onStack.join(',')}`).toBeLessThan(onStack[k - 1]!)
      }
    }
  })

  it('shows a resolved day for every non-zero answer, and no others', () => {
    const temps = resolve(reader, TEMPS, 'array', last)!
    const resolvedDays = temps.marks
      .filter((m) => m.class === 'result')
      .map((m) => m.index)
      .sort((a, b) => a - b)
    const nonZero = returned.flatMap((v, i) => (v > 0 ? [i] : []))
    // The count in the picture matching the count in the answer is the point; the identity of
    // the days is a free bonus that catches an off-by-one in the mark index.
    expect(resolvedDays).toHaveLength(nonZero.length)
    expect(resolvedDays).toEqual(nonZero)
  })

  it('leaves nothing pinned — every waiting day ends up resolved or ruled out', () => {
    const temps = resolve(reader, TEMPS, 'array', last)!
    expect(temps.marks.filter((m) => m.class === 'pinned')).toEqual([])
    const classes = new Set(temps.marks.map((m) => m.class))
    expect([...classes].sort()).toEqual(['excluded', 'result'])
  })

  it('ends with a stack holding only days that never warmed up', () => {
    const stack = resolve(reader, STACK, 'stack', last)!
    const temps = resolve(reader, TEMPS, 'array', last)!
    const stranded = stack.values as number[]
    // [73,74,75,71,69,72,76,73] — days 6 and 7 are the only ones with no warmer future.
    expect(stranded).toEqual([6, 7])
    for (const day of stranded) expect(returned[day]).toBe(0)
    expect(returned.flatMap((v, i) => (v === 0 ? [i] : []))).toEqual(stranded)
    expect(temps.marks.filter((m) => m.class === 'excluded').map((m) => m.index)).toEqual(stranded)
  })

  it('fills in the answer panel to match the value it returns', () => {
    // Tests can pass while the picture shows a stale or empty answer array; this is the only
    // assertion that ties the two together.
    const answer = resolve(reader, ANSWER, 'array', last)!
    expect(answer.values).toEqual(returned)
  })

  it('pushes each day exactly once and pops it at most once', () => {
    // The real O(n) proof: not a frame budget, but the fact that no day is ever revisited.
    const { pushed, popped } = stackHistory(trace)
    const n = returned.length
    expect(pushed).toEqual([...Array(n).keys()])
    expect(new Set(popped).size).toBe(popped.length)
    expect(popped.every((d) => d < n)).toBe(true)
    expect(popped).toHaveLength(returned.filter((v) => v > 0).length)
  })

  it('narrates every day and every resolution', () => {
    const steps = reader.stepFrames()
    expect(steps.length).toBeGreaterThanOrEqual(3)
    // One step per day parked, plus one per day resolved, plus the closing summary.
    expect(steps.length).toBe(returned.length + returned.filter((v) => v > 0).length + 1)
  })

  it('never shows a zero in the answer panel that is not a decided zero', () => {
    // `viz.array<number>(n)` zero-fills, so the panel named `answer` asserted `0` for every day
    // from the first frame — the same digit as the days whose real answer is 0, with nothing to
    // tell them apart. On the cold snap that was 484 frames of 498 carrying at least one lie.
    // Seeded with `{ fill: null }`, an untouched cell is blank, so this holds: at every frame,
    // every non-blank cell already equals its final answer.
    for (let i = 0; i < reader.frameCount; i += 1) {
      const answer = resolve(reader, ANSWER, 'array', i)
      if (!answer) continue
      for (const [day, shown] of answer.values.entries()) {
        if (shown === null) continue
        expect(shown, `frame ${i}: answer[${day}] shows ${String(shown)}`).toBe(returned[day])
      }
    }
    // And the panel is genuinely blank early on, rather than this passing because it fills instantly.
    const early = resolve(reader, ANSWER, 'array', 1)!
    expect(early.values.filter((v) => v === null).length).toBe(returned.length)
  })

  it('flips a day out of "still waiting" no later than the frame that pops it', () => {
    // The split-panel design's payoff is that the array alone tells the story: the rightmost
    // pinned cell is the top of the stack. A day that has left the stack while still marked
    // `pinned` inverts exactly that, and it did so for two frames per pop — on the pop frames,
    // which are the ones worth stopping on. Marking before the pop removes it entirely.
    const stackId = idOf(trace, STACK)
    let onStack: number[] = []
    for (let i = 0; i < reader.frameCount; i += 1) {
      const temps = resolve(reader, TEMPS, 'array', i)
      const stack = trace.frames[i]?.snapshots[stackId]
      if (stack?.kind === 'stack') onStack = stack.values as number[]
      if (!temps) continue
      const pinned = temps.marks.filter((m) => m.class === 'pinned' && !m.transient).map((m) => m.index)
      expect(
        pinned.filter((d) => !onStack.includes(d)),
        `frame ${i}: day(s) marked "still waiting" are no longer on the stack`,
      ).toEqual([])
    }
  })

  it('puts both compared temperatures on screen together, in one frame', () => {
    // The guard is the only real decision this algorithm makes. Written as two array reads it
    // emitted two frames, neither of which ever showed the pair being compared — the `compare`
    // mark class never appeared once in the whole trace.
    const compareFrames = trace.frames.filter((f) => f.op === 'compare')
    expect(compareFrames.length).toBeGreaterThan(0)
    for (const frame of compareFrames) {
      const snap = frame.snapshots[idOf(trace, TEMPS)]
      expect(snap?.kind).toBe('array')
      const lit = snap?.kind === 'array' ? snap.marks.filter((m) => m.class === 'compare') : []
      expect(lit, `frame ${frame.index} lights ${lit.length} cells`).toHaveLength(2)
    }
  })

  it('names the rejection, not just the pushes', () => {
    // "day 3 at 71 is not warmer than day 2 at 75 — both keep waiting". The reject branch is the
    // common case and had no narration at all: a viewer inferred it from the absence of a pop.
    const labels = reader.stepFrames().map((i) => trace.frames[i]!.label ?? '')
    expect(labels.filter((l) => /is not warmer than day/.test(l)).length).toBeGreaterThan(0)
  })

  it('reports progress in the watch panel', () => {
    const watch = reader.watchAt(last)!
    expect(watch.resolved).toBe(returned.filter((v) => v > 0).length)
    expect(watch.waiting).toBe(2)
  })
})

describe('the monotonic-stack check has teeth', () => {
  // An invariant test that cannot fail is worse than no test, because it reads like evidence.
  // This runs a brute-force solution that returns the *right answer* while parking every day on
  // the stack, so the picture is a stack animation but not a monotonic one, and checks that
  // `expectMonotonicEveryFrame` rejects it.
  const source = `
export default function dailyTemperatures(temperatures, viz) {
  const t = viz.array(temperatures, { name: 'temperatures' })
  const answer = viz.array(temperatures.length, { name: 'answer' })
  const waiting = viz.stack([], { name: 'waiting (day #)' })
  for (let i = 0; i < t.length; i += 1) {
    waiting.push(i)
    for (let j = i + 1; j < t.length; j += 1) {
      if (t.at(j) > t.at(i)) { answer[i] = j - i; break }
    }
  }
  return answer.toArray()
}
`
  const result = executeRun({ problem: PROBLEM, source, caseIndex: 0 })

  it('accepts the brute-force answer but rejects its stack', () => {
    expect(result.diagnostics).toEqual([])
    expect(result.results[0]?.passed).toBe(true)
    expect(() => expectMonotonicEveryFrame(result.results[0]!.trace, 'brute force')).toThrow(
      /not a monotonic stack/,
    )
  })
})

describe('Daily Temperatures — the invariant holds on every case', () => {
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
      const trace = caseResult.trace
      const reader = new TraceReader(trace)
      const n = (testCase.args[0] as number[]).length
      const returned = caseResult.returned as number[]

      expectMonotonicEveryFrame(trace, testCase.name)

      // Every day is pushed once; nothing is ever pushed twice. This is what makes the frame
      // count linear, and it is checked per case because a tie or a plateau is exactly where a
      // hand-rolled monotonic stack starts pushing the same day twice.
      const { pushed, popped } = stackHistory(trace)
      expect(pushed).toEqual([...Array(n).keys()])
      expect(new Set(popped).size).toBe(popped.length)

      // The picture agrees with the answer: resolved marks == non-zero answers, and the days
      // left on the stack are exactly the zeros.
      const last = reader.frameCount - 1
      const temps = resolve(reader, TEMPS, 'array', last)!
      const stack = resolve(reader, STACK, 'stack', last)!
      const answer = resolve(reader, ANSWER, 'array', last)!
      expect(answer.values).toEqual(returned)
      expect(temps.marks.filter((m) => m.class === 'result')).toHaveLength(
        returned.filter((v) => v > 0).length,
      )
      expect(temps.marks.filter((m) => m.class === 'pinned')).toEqual([])
      expect(stack.values).toEqual(returned.flatMap((v, i) => (v === 0 ? [i] : [])))

      // O(n), not O(n^2). The reference sits near 12 frames per day; a quadratic scan on the
      // 42-day cold snap would need well over a thousand.
      expect(caseResult.frameCount, `${testCase.name}: ${caseResult.frameCount} frames for n=${n}`)
        .toBeLessThanOrEqual(20 * n + 20)
    })
  }

  it('keeps tied days on the stack together — warmer is strict', () => {
    // The case that would break a solution written to the "strictly decreasing" folklore.
    const index = problem.cases.findIndex((c) => c.name.startsWith('all equal'))
    const caseResult = result.results[index]!
    const reader = new TraceReader(caseResult.trace)
    const stack = resolve(reader, STACK, 'stack', reader.frameCount - 1)!
    const temps = resolve(reader, TEMPS, 'array', reader.frameCount - 1)!
    expect(stack.values).toEqual([0, 1, 2, 3])
    expect(new Set((stack.values as number[]).map((d) => temps.values[d])).size).toBe(1)
    expect(temps.marks.filter((m) => m.class === 'excluded')).toHaveLength(4)
  })

  it('drains a deep stack in one run of pops', () => {
    // The 41-day cold snap: the animation's best moment, and the one that would be a nested
    // loop in disguise if the pops were not amortised.
    const index = problem.cases.findIndex((c) => c.tags?.includes('large'))
    const caseResult = result.results[index]!
    const reader = new TraceReader(caseResult.trace)
    const stackId = idOf(caseResult.trace, STACK)

    let deepest = 0
    for (let i = 0; i < reader.frameCount; i += 1) {
      const stack = resolve(reader, STACK, 'stack', i)
      if (stack) deepest = Math.max(deepest, stack.values.length)
    }
    expect(deepest).toBe(41)

    const popFrames = caseResult.trace.frames.filter(
      (f) => f.op === 'pop' && f.structureId === stackId,
    )
    expect(popFrames).toHaveLength(40)
    // All 40 pops happen on the final day, so they are contiguous in the tail of the trace.
    const firstPop = popFrames[0]!.index
    expect(popFrames[popFrames.length - 1]!.index - firstPop).toBeLessThan(
      6 * popFrames.length,
    )
  })
})
