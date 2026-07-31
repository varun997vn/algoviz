import { beforeAll, describe, expect, it } from 'vitest'
import { executeRun, type CaseResult } from '@algoviz/runner'
import { requireProblem } from '@algoviz/problems'
import { TraceReader, type StructureSnapshot, type Trace } from '@algoviz/tracer'
import {
  eachFrame,
  expectHolds,
  expectMarksPartition,
  expectStarterTranscription,
  structureId,
} from '../invariants.js'

/**
 * Koko Eating Bananas — frame-sequence assertions.
 *
 * The return value is worth almost nothing here. A linear scan from 1 upwards returns the same
 * number on every case in the file, in the same `number` type, and it is not even slow enough to
 * time out — so `expected` cannot tell a binary search from a loop. What separates them is only
 * visible in the trace: how many speeds were *tested*, and whether ruling out a half was one
 * decision or a hundred.
 *
 * So the two load-bearing assertions here are:
 *
 *  - **the space is partitioned exactly**, with `excluded` below the answer, `match` above it, and
 *    every cell marked exactly once. That is the monotone predicate the algorithm relies on, drawn
 *    rather than asserted, and a solution that stops as soon as it finds the answer leaves the
 *    whole upper half unmarked.
 *  - **the probe count is logarithmic**, and each probe rules out its half in *one frame*. A
 *    linear scan fails both. `the checks have teeth` runs exactly that solution and proves it.
 */

const PROBLEM = 'koko-eating-bananas'
const PILES = 'piles'
const SPEEDS = 'speeds (bananas per hour)'

type ArraySnapshot = Extract<StructureSnapshot, { kind: 'array' }>

let byName: Map<string, CaseResult>

beforeAll(() => {
  const run = executeRun({ problem: PROBLEM, useReference: true, caseIndex: 'all' })
  expect(run.diagnostics).toEqual([])
  byName = new Map(run.results.map((r) => [r.name, r]))
})

const CASES = requireProblem(PROBLEM).cases.map((c) => c.name)

function arrayAt(reader: TraceReader, name: string, frame: number): ArraySnapshot | undefined {
  const snap = reader.structureAt(structureId(reader.trace, name), frame)
  return snap?.kind === 'array' ? snap : undefined
}

/** Every `speed N: …` scope the trace opened — one per probe, by construction. */
function probeLabels(trace: Trace): string[] {
  const seen: string[] = []
  for (const f of trace.frames) {
    const scope = f.groups[f.groups.length - 1]
    if (scope?.startsWith('speed ') && seen[seen.length - 1] !== scope) seen.push(scope)
  }
  return seen
}

describe('the answer space is partitioned, and the boundary is the answer', () => {
  it.each(CASES)('%s', (name) => {
    const result = byName.get(name)!
    const reader = new TraceReader(result.trace)
    const last = result.trace.frames.length - 1
    const speeds = arrayAt(reader, SPEEDS, last)!
    const answer = result.returned as number
    const fastest = Math.max(...(requireProblem(PROBLEM).cases.find((c) => c.name === name)!.args[0] as number[]))

    // Index is the speed, which is the only reason a caret named `mid` means anything.
    expect(speeds.values).toEqual(Array.from({ length: fastest + 1 }, (_, k) => k))

    // Exactly one mark per cell, and the classes read left to right as: too slow, the answer,
    // faster than necessary. Both halves catch something — a cell marked twice is a candidate
    // ruled out for two different reasons, a cell unmarked is a solution that stopped as soon as
    // it found the answer and left the upper half unaccounted for. Both return the right number.
    expectMarksPartition(
      speeds.marks,
      fastest + 1,
      (k) => (k < answer ? 'excluded' : k === answer ? 'result' : 'match'),
      `${name}: the answer space is partitioned, boundary at ${answer}`,
    )
  })
})

describe('the search is a binary search, not a scan wearing its clothes', () => {
  it.each(CASES)('%s', (name) => {
    const result = byName.get(name)!
    const trace = result.trace
    const fastest = Math.max(...(requireProblem(PROBLEM).cases.find((c) => c.name === name)!.args[0] as number[]))
    const probes = probeLabels(trace)
    const answer = result.returned as number

    // The last probe is the closing one — the winner, re-run once the search is over so the final
    // picture shows it doing the job. Split it off rather than loosening the bound: it is a
    // different kind of thing from a search probe, and a test that cannot tell them apart would
    // also accept a search that took one probe too many.
    expect(probes[probes.length - 1], 'the closing probe is not on the answer').toBe(
      `speed ${answer}: does it finish within ${(requireProblem(PROBLEM).cases.find((c) => c.name === name)!.args[1] as number)} hours?`,
    )
    const search = probes.slice(0, -1)

    // Halving a space of `fastest` candidates takes at most ceil(log2(fastest)) probes; one spare
    // for the final comparison. A scan takes `answer` of them.
    const bound = Math.ceil(Math.log2(Math.max(2, fastest))) + 1
    expect(search.length, `${search.length} search probes over ${fastest} candidates: ${search.join(' | ')}`)
      .toBeLessThanOrEqual(bound)
    // No speed is searched twice — a probe that repeats is a loop that is not converging.
    expect(new Set(search).size).toBe(search.length)

    // The live window shrinks, and never by less than half.
    const reader = new TraceReader(trace)
    let previous: [number, number] | undefined
    for (let f = 0; f < reader.frameCount; f += 1) {
      const win = arrayAt(reader, SPEEDS, f)?.window
      if (!win) continue
      if (previous && (win[0] !== previous[0] || win[1] !== previous[1])) {
        const before = previous[1] - previous[0] + 1
        const after = win[1] - win[0] + 1
        expect(after, `frame ${f}: ${previous.join('..')} -> ${win.join('..')}`).toBeLessThanOrEqual(
          Math.ceil(before / 2),
        )
        expect(win[0]).toBeGreaterThanOrEqual(previous[0])
        expect(win[1]).toBeLessThanOrEqual(previous[1])
      }
      previous = [win[0], win[1]]
    }
  })

  it('rules out each half in a single frame, not one cell at a time', () => {
    // Ruling out half the space is one decision, and the number of frames it costs is the
    // difference between an animation of a binary search and an animation of a scan. Marking cell
    // by cell would leave the returned answer, the partition and the probe count all identical.
    const result = byName.get('240 scrambled piles in 300 hours, met exactly')!
    const speedsId = structureId(result.trace, SPEEDS)

    let previous = 0
    const bulk: number[] = []
    for (const frame of result.trace.frames) {
      const snap = frame.snapshots[speedsId]
      if (!snap || snap.kind !== 'array') continue
      const added = snap.marks.length - previous
      if (added > 0) bulk.push(added)
      previous = snap.marks.length
    }
    // 240 candidates ruled out across at most 9 marking frames, so the average frame carries tens
    // of cells. One-at-a-time marking would make every entry here 1.
    expect(bulk.length).toBeLessThanOrEqual(10)
    expect(Math.max(...bulk), `largest single rule-out: ${bulk.join(', ')}`).toBeGreaterThan(50)
    expect(bulk.reduce((a, b) => a + b, 0)).toBe(241)
  })
})

describe('a probe shows its own work', () => {
  it('walks every pile inside the probe that is testing that speed', () => {
    const result = byName.get('example')!
    const reader = new TraceReader(result.trace)
    const piles = requireProblem(PROBLEM).cases[0]!.args[0] as number[]

    for (let f = 0; f < reader.frameCount; f += 1) {
      const frame = result.trace.frames[f]!
      const scope = frame.groups[frame.groups.length - 1]
      if (!scope?.startsWith('speed ')) continue
      const marked = (arrayAt(reader, PILES, f)?.marks ?? []).filter((m) => m.transient !== true)
      // Never more marks than there are piles, which is what a probe that failed to clear the
      // previous probe's picture would produce.
      expect(marked.length, `frame ${f} in "${scope}"`).toBeLessThanOrEqual(piles.length)
    }
  })

  it('starts each probe from a clean piles panel', () => {
    // Without `p.clearMarks()` the second probe's picture is the first probe's picture with more
    // paint on it, and the panel stops meaning "the piles this speed has eaten".
    const result = byName.get('example')!
    const reader = new TraceReader(result.trace)
    const opened = result.trace.frames.filter(
      (f, i) =>
        f.groups[f.groups.length - 1]?.startsWith('speed ') === true &&
        result.trace.frames[i - 1]?.groups[result.trace.frames[i - 1]!.groups.length - 1] !==
          f.groups[f.groups.length - 1],
    )
    expect(opened.length).toBeGreaterThan(1)
    for (const frame of opened) {
      // On the frame that *enters* the scope, not a frame or two later. Clearing inside the group
      // left the entering frame showing the previous probe's eaten piles and its hour total under
      // a caption naming this speed — one frame of two panels describing different probes.
      const settled = (arrayAt(reader, PILES, frame.index)?.marks ?? []).filter(
        (m) => m.transient !== true,
      )
      expect(settled, `probe at frame ${frame.index} opened on the last probe's marks`).toEqual([])
      expect(reader.watchAt(frame.index)?.hours, `probe at frame ${frame.index}`).toBe(0)
    }
  })

  it.each(CASES)('%s — no frame reports a speed or an hour count the piles contradict', (name) => {
    // The general form, over every frame of every case rather than the probe frames of one. Two
    // defects hid in the gaps this did not cover. `testing` and the `mid` caret used to move
    // *before* the previous probe's marks and hour count were retired, so 115 frames across the
    // set named one speed beside another's work — the worst of them reporting 360 hours on the
    // frame that first names the winning speed, whose true cost is exactly the 300-hour deadline.
    // And the closing frames reset `hours` to 0, putting "finishes in 0 hours" beside three piles
    // drawn as eaten, on the one frame a viewer parks on.
    // `eachFrame` has no filter, which is the point: a check that only applies to probe frames
    // still has to look at the others to know they are not probe frames.
    const result = byName.get(name)!
    const piles = requireProblem(PROBLEM).cases.find((c) => c.name === name)!.args[0] as number[]

    expectHolds(
      eachFrame(result.trace, (frame) => {
        const speed = frame.watch?.testing as number | undefined
        if (!speed) return
        const said: string[] = []
        const eaten = (frame.get(PILES, 'array')?.marks ?? [])
          .filter((m) => m.transient !== true)
          .map((m) => m.index)
        const accounted = eaten.reduce((sum, i) => sum + Math.ceil(piles[i]! / speed), 0)
        if (frame.watch?.hours !== accounted) {
          said.push(
            `watch says ${String(frame.watch?.hours)}h at speed ${speed}, ` +
              `${eaten.length} pile(s) drawn eaten cost ${accounted}h`,
          )
        }
        const mid = frame.get(SPEEDS, 'array')?.cursors.find((c) => c.name === 'mid')
        if (mid && mid.index !== speed) said.push(`watch says speed ${speed}, the mid caret is on ${mid.index}`)
        return said
      }),
      `${name}: the watch panel agrees with the picture beside it`,
    )
  })

  it.each(CASES)('%s — the closing frames describe the winner, not the last speed probed', (name) => {
    // The assertion that was missing, and its absence is instructive: the every-frame check above
    // uses `eachFrame` correctly and its invariant genuinely held — but the invariant is *internal
    // consistency* (`hours` equals the cost of the drawn piles at the speed `testing` names), and
    // a losing probe satisfies that perfectly. Nothing tied the closing frame to the answer.
    //
    // So the same failure mode as a filtered walk, one level up: an unfiltered walk of the wrong
    // quantity. Nine of twelve cases ended announcing the answer beside the readout of a speed
    // that missed the deadline — the largest reading 301 hours against a 300-hour deadline.
    const result = byName.get(name)!
    const reader = new TraceReader(result.trace)
    const piles = requireProblem(PROBLEM).cases.find((c) => c.name === name)!.args[0] as number[]
    const answer = result.returned as number
    const cost = piles.reduce((sum, p) => sum + Math.ceil(p / answer), 0)

    const last = reader.frameCount - 1
    const watch = reader.watchAt(last)!
    expect(watch.testing, 'the closing readout names a speed that is not the answer').toBe(answer)
    expect(watch.hours, 'the closing readout is not the answer’s own cost').toBe(cost)
    expect(watch.hours as number).toBeLessThanOrEqual(watch.deadline as number)

    // And the caret and the piles agree with it.
    const mid = arrayAt(reader, SPEEDS, last)?.cursors.find((c) => c.name === 'mid')
    expect(mid?.index).toBe(answer)
    const eaten = (arrayAt(reader, PILES, last)?.marks ?? []).filter((m) => m.transient !== true)
    expect(eaten).toHaveLength(piles.length)
  })

  it('never reports an hour count the piles panel has not accounted for', () => {
    // The watch panel's `hours` is the running total, and the piles panel shows which piles it is
    // the total *of*. If `hours` were updated after the mark rather than before, every frame would
    // show a total one pile behind the picture beside it.
    const result = byName.get('example')!
    const reader = new TraceReader(result.trace)
    const piles = requireProblem(PROBLEM).cases[0]!.args[0] as number[]

    for (let f = 0; f < reader.frameCount; f += 1) {
      const frame = result.trace.frames[f]!
      const scope = frame.groups[frame.groups.length - 1]
      const at = /^speed (\d+):/.exec(scope ?? '')
      if (!at) continue
      const speed = Number(at[1])
      // Settled marks only. The transient highlight on the cell being *read* is not a pile
      // that has been eaten — it is the frame saying which one is about to be.
      const marked = (arrayAt(reader, PILES, f)?.marks ?? [])
        .filter((m) => m.transient !== true)
        .map((m) => m.index)
      const hours = reader.watchAt(f)?.hours as number
      const accounted = marked.reduce((sum, i) => sum + Math.ceil(piles[i]! / speed), 0)
      expect(hours, `frame ${f}: ${marked.length} pile(s) marked at speed ${speed}`).toBe(accounted)
    }
  })
})

describe('the checks have teeth', () => {
  // Returns the right answer on every case, in the same type, fast enough to finish — and animates
  // a linear scan. If the assertions above pass for this, they are asserting nothing.
  const scanner = `export default function minEatingSpeed(piles: number[], h: number, viz: Viz): number {
  const p = viz.array(piles, { name: 'piles' })
  const fastest = Math.max(...piles)
  const speeds = viz.array(
    Array.from({ length: fastest + 1 }, (_, k) => k),
    { name: 'speeds (bananas per hour)' },
  )
  speeds.mark(0, 'excluded', 'eating nothing never finishes')
  let hours = 0
  viz.watch(() => ({ hours }))
  for (let k = 1; k <= fastest; k += 1) {
    speeds.setWindow(k, fastest)
    const total = viz.group('speed ' + k + ': does it finish within ' + h + ' hours?', () => {
      p.clearMarks()
      hours = 0
      let sum = 0
      for (let i = 0; i < p.length; i += 1) {
        sum += Math.ceil(p[i] / k)
        hours = sum
        p.mark(i, 'visited')
      }
      viz.step(sum + ' hours at ' + k + '/h')
      return sum
    })
    if (total <= h) {
      speeds.mark(k, 'result', 'the answer')
      for (let j = k + 1; j <= fastest; j += 1) speeds.mark(j, 'match', 'also fast enough')
      viz.step(k + ' is the answer')
      return k
    }
    speeds.mark(k, 'excluded', 'too slow')
  }
  return fastest
}
`

  it('returns the right answer, so only the trace can reject it', () => {
    // Every case but the large one, which the scan cannot even finish: 180 probes over 240 piles
    // is 86,000 frames against a 20,000 budget. That is a fact about the scan being slow, not
    // about the picture, so it is not what these checks rest on — the two below hold on cases the
    // scan completes comfortably.
    const smallCases = requireProblem(PROBLEM).cases.length - 1
    for (let i = 0; i < smallCases; i += 1) {
      const run = executeRun({ problem: PROBLEM, source: scanner, caseIndex: i })
      expect(run.diagnostics, `case ${i}`).toEqual([])
      expect(run.results.filter((r) => !r.passed).map((r) => r.name)).toEqual([])
    }
  })

  it('is rejected by the probe count', () => {
    const run = executeRun({ problem: PROBLEM, source: scanner, caseIndex: 3 })
    const probes = probeLabels(run.results[0]!.trace)
    // Nine candidates, answer 3: a binary search probes at most four, this probes three but would
    // probe nine on a case whose answer is the maximum. Use the case that makes it unambiguous.
    const big = executeRun({ problem: PROBLEM, source: scanner, caseIndex: 6 })
    const bigProbes = probeLabels(big.results[0]!.trace)
    expect(probes.length).toBeGreaterThan(0)
    expect(bigProbes.length, 'a scan over 1000 speeds probed each one').toBeGreaterThan(
      Math.ceil(Math.log2(1000)) + 1,
    )
  })

  it('is rejected by the one-frame rule-out, even where its probe count is small', () => {
    // Case 3 is `[9], h=4`, answer 3 — a scan finds it in three probes, inside the logarithmic
    // bound. What it cannot fake is ruling out the upper half in one frame: it marks the six
    // faster speeds one at a time.
    const run = executeRun({ problem: PROBLEM, source: scanner, caseIndex: 3 })
    const trace = run.results[0]!.trace
    const speedsId = structureId(trace, SPEEDS)
    let previous = 0
    const bulk: number[] = []
    for (const frame of trace.frames) {
      const snap = frame.snapshots[speedsId]
      if (!snap || snap.kind !== 'array') continue
      const added = snap.marks.length - previous
      if (added > 0) bulk.push(added)
      previous = snap.marks.length
    }
    expect(Math.max(...bulk), 'the scan ruled out more than one speed in a frame').toBe(1)
  })
})

describe('the starter teaches the same picture, not just the same answer', () => {
  // Filled in from the starter's own TODO comments and nothing else.
  const filled = `export default function minEatingSpeed(piles: number[], h: number, viz: Viz): number {
  const p = viz.array(piles, { name: 'piles' })
  const fastest = Math.max(...piles)

  const speeds = viz.array(
    Array.from({ length: fastest + 1 }, (_, k) => k),
    { name: 'speeds (bananas per hour)' },
  )
  let lo = 1
  let hi = fastest
  let hours = 0
  let testing = 0
  const loAt = viz.cursor('lo', lo, speeds)
  const hiAt = viz.cursor('hi', hi, speeds)
  const midAt = viz.cursor('mid', lo, speeds)
  viz.watch(() => ({ lo, hi, testing, hours, deadline: h }))

  speeds.mark(0, 'excluded', 'eating nothing never finishes')
  speeds.setWindow(lo, hi)
  viz.step('any speed from 1 to ' + fastest + ' would do; which is the smallest?')

  const hoursAt = (speed: number): number => {
    hours = 0
    p.clearMarks()
    testing = speed
    midAt.value = speed
    return viz.group('speed ' + speed + ': does it finish within ' + h + ' hours?', () => {
      let total = 0
      for (let i = 0; i < p.length; i += 1) {
        const pile = p[i]
        const needed = Math.ceil(pile / speed)
        total += needed
        hours = total
        p.mark(i, 'visited', pile + ' bananas at ' + speed + '/h takes ' + needed + ' hour(s)')
      }
      viz.step(total + ' hours at ' + speed + '/h')
      return total
    })
  }

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const spent = hoursAt(mid)

    if (spent <= h) {
      if (mid < hi) {
        speeds.mark(
          Array.from({ length: hi - mid }, (_, k) => mid + 1 + k),
          'match',
          'also fast enough, but ' + mid + ' already is',
        )
      }
      hi = mid
    } else {
      speeds.mark(
        Array.from({ length: mid - lo + 1 }, (_, k) => lo + k),
        'excluded',
        spent + ' hours at ' + mid + '/h misses the deadline',
      )
      lo = mid + 1
    }

    loAt.value = lo
    hiAt.value = hi
    speeds.setWindow(lo, hi)
    viz.step(lo + '..' + hi + ' still in the running')
  }

  speeds.mark(lo, 'result', 'the slowest speed that finishes in ' + h + ' hours')
  return lo
}
`

  it('is a transcription of the shipped starter, not a different program', () => {
    // By order, not presence — see `expectStarterTranscription`, which states the limit this
    // check has and which sibling test covers it. Every ordering decision in this solution is
    // load-bearing: `hours` before the mark, the clear before the caret, the window after the
    // bounds move.
    expectStarterTranscription(PROBLEM, filled, [
      "viz.step(total + ' hours at ' + speed + '/h')",
      "viz.step(lo + '..' + hi + ' still in the running')",
      'return 0',
    ])
  })

  it('produces the picture its comments promise when followed literally', () => {
    const run = executeRun({ problem: PROBLEM, source: filled, caseIndex: 'all' })
    expect(run.diagnostics).toEqual([])
    expect(run.results.filter((r) => !r.passed).map((r) => r.name)).toEqual([])

    // The partition — the claim the closing TODO makes in words.
    for (const [i, result] of run.results.entries()) {
      const reader = new TraceReader(result.trace)
      const last = result.trace.frames.length - 1
      const speeds = arrayAt(reader, SPEEDS, last)!
      const answer = result.returned as number
      const fastest = Math.max(...(requireProblem(PROBLEM).cases[i]!.args[0] as number[]))
      const classAt = new Map(speeds.marks.map((m) => [m.index, m.class]))
      expect(classAt.size, `case "${result.name}"`).toBe(fastest + 1)
      for (let k = 1; k <= fastest; k += 1) {
        expect(classAt.get(k), `case "${result.name}", speed ${k}, answer ${answer}`).toBe(
          k < answer ? 'excluded' : k === answer ? 'result' : 'match',
        )
      }
    }
  })
})
