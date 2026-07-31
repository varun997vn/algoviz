import { beforeAll, describe, expect, it } from 'vitest'
import { executeRun, type CaseResult } from '@algoviz/runner'
import { requireProblem } from '@algoviz/problems'
import { TraceReader, type Frame, type StructureSnapshot, type Trace } from '@algoviz/tracer'
import { eachFrame, expectHolds } from '../invariants.js'

/**
 * Number of Recent Calls — frame-sequence assertions.
 *
 * The return value proves almost nothing here: `ping(t)` can be answered correctly by pushing
 * `t` into any growing bag and re-filtering it on every call, which draws a queue that only ever
 * grows. This file's load-bearing claim is the one stated in the problem's docstring — after
 * every `ping(t)` the queue holds *exactly* the pings in `[t - 3000, t]`, in arrival order, and
 * the returned count equals the queue's length at that moment — checked independently of the
 * reference's own control flow, and then run against an impostor that answers every case right
 * while failing it (`the invariant check has teeth`, below).
 */

const PROBLEM = 'number-of-recent-calls'
const QUEUE = 'recent'

type QueueSnapshot = Extract<StructureSnapshot, { kind: 'queue' }>

const CASES = requireProblem(PROBLEM).cases
const CASE_NAMES = CASES.map((c) => c.name)

let byName: Map<string, CaseResult>

beforeAll(() => {
  const run = executeRun({ problem: PROBLEM, useReference: true, caseIndex: 'all' })
  expect(run.diagnostics).toEqual([])
  byName = new Map(run.results.map((r) => [r.name, r]))
})

function caseByName(name: string): CaseResult {
  const result = byName.get(name)
  if (!result) throw new Error(`no case named "${name}" — cases: ${[...byName.keys()].join(', ')}`)
  return result
}

function pingsOf(name: string): number[] {
  const testCase = CASES.find((c) => c.name === name)
  if (!testCase) throw new Error(`no case named "${name}"`)
  return testCase.args[0] as number[]
}

function queueId(trace: Trace): string {
  const meta = trace.structures.find((s) => s.kind === 'queue')
  if (!meta) throw new Error('no queue in the trace')
  return meta.id
}

function queueAt(reader: TraceReader, id: string, frame: number): QueueSnapshot | undefined {
  const snap = reader.structureAt(id, frame)
  return snap?.kind === 'queue' ? snap : undefined
}

/**
 * The frame indices of every `enqueue` onto the queue, in order.
 *
 * A correct `ping` pushes `t` exactly once and never more than once, whatever narration the
 * solution wraps around it — so these boundaries exist independently of `viz.group`/`viz.step`,
 * and let the invariant below check *any* solution someone could submit, not just ones that
 * narrate the way the reference does.
 */
function enqueueFrames(trace: Trace): Frame[] {
  const id = queueId(trace)
  return trace.frames.filter((f) => f.op === 'enqueue' && f.structureId === id)
}

/**
 * The frame at which ping index `i`'s effect on the queue has finished settling — right before
 * the next ping's own enqueue, or the end of the trace for the last one.
 */
function settledFrame(enqueues: Frame[], reader: TraceReader, i: number): number {
  return i + 1 < enqueues.length ? enqueues[i + 1]!.index - 1 : reader.frameCount - 1
}

/** Every ping seen through index `i` that is still within `[pings[i] - 3000, pings[i]]`. */
function expectedWindow(pings: number[], i: number): number[] {
  const cutoff = pings[i]! - 3000
  return pings.slice(0, i + 1).filter((p) => p >= cutoff)
}

/**
 * The two claims a viewer relies on, checked at every ping. Returns violation strings rather
 * than asserting directly, so the same check both proves the reference right (empty) and proves
 * an impostor wrong (non-empty) — see "the invariant check has teeth" below.
 */
function windowViolations(
  trace: Trace,
  pings: number[],
  returned: number[],
  label: string,
): string[] {
  const violations: string[] = []
  const enqueues = enqueueFrames(trace)
  if (enqueues.length !== pings.length) {
    violations.push(`${label}: ${enqueues.length} enqueue op(s) recorded for ${pings.length} ping(s)`)
    return violations
  }
  const reader = new TraceReader(trace)
  const id = queueId(trace)

  pings.forEach((t, i) => {
    const frame = settledFrame(enqueues, reader, i)
    const snap = queueAt(reader, id, frame)
    if (!snap) {
      violations.push(`${label}: ping(${t}) — no queue snapshot at frame ${frame}`)
      return
    }
    const expected = expectedWindow(pings, i)
    if (JSON.stringify(snap.values) !== JSON.stringify(expected)) {
      violations.push(
        `${label}: ping(${t}) — queue holds [${snap.values.join(',')}], window is [${expected.join(',')}]`,
      )
    }
    if (snap.values.length !== returned[i]) {
      violations.push(
        `${label}: ping(${t}) — returned ${returned[i]} but the queue holds ${snap.values.length}`,
      )
    }
  })

  return violations
}

/**
 * The trace split into one run per `ping` call, using the `viz.group()` boundaries — only used
 * by the tests that check *narration and ordering*, never by `windowViolations`, which must work
 * on solutions that don't narrate at all.
 */
function calls(trace: Trace): { label: string; frames: Frame[] }[] {
  const out: { label: string; frames: Frame[] }[] = []
  for (const frame of trace.frames) {
    if (frame.op === 'group') {
      out.push({ label: (frame.label ?? '').replace(/^enter /, ''), frames: [frame] })
      continue
    }
    if (frame.groups.length === 0) continue
    out[out.length - 1]?.frames.push(frame)
  }
  return out
}

/** The ops that actually move the queue, with narration (`step`, `group`) stripped out. */
function structuralOps(frames: readonly Frame[]): string[] {
  return frames.map((f) => f.op).filter((op) => op !== 'step' && op !== 'group')
}

describe('the reference solution', () => {
  it('passes every one of its own cases', () => {
    const failures = [...byName.values()].filter((r) => !r.passed)
    expect(
      failures.map((f) => `${f.name}: got ${JSON.stringify(f.returned)}, want ${JSON.stringify(f.expected)}`),
    ).toEqual([])
  })

  it('drives a queue, plus a panel for the answers it returns', () => {
    // The queue is the algorithm; the array is what it produces. Kept as a plain local the answer
    // sequence was the one thing a viewer parked at the end could not see — the queue shows the
    // last window and the watch shows its size, and the counts the problem actually returns
    // appeared nowhere.
    for (const result of byName.values()) {
      expect(result.trace.structures.map((s) => s.kind), result.name).toEqual(['queue', 'array'])
    }
  })

  it('fills the answer panel one call at a time, ahead of the caption that reads it out', () => {
    for (const [name, result] of byName.entries()) {
      const reader = new TraceReader(result.trace)
      const answers = result.returned as number[]
      const id = result.trace.structures.find((s) => s.kind === 'array')!.id
      const last = reader.structureAt(id, reader.frameCount - 1)
      expect(last?.kind === 'array' && last.values, name).toEqual(answers)

      // Every `ping(t) -> n` caption has its own cell already written on the frame that says it.
      for (const f of reader.stepFrames()) {
        const label = result.trace.frames[f]?.label ?? ''
        const said = /^ping\((-?\d+)\) -> (\d+)/.exec(label)
        if (!said) continue
        const snap = reader.structureAt(id, f)
        const filled = snap?.kind === 'array' ? snap.values.filter((v) => v !== null) : []
        expect(filled[filled.length - 1], `${name} frame ${f}: ${label}`).toBe(Number(said[2]))
      }
    }
  })

  it('reports nothing in the watch panel that the queue beside it contradicts', () => {
    // The panel's window bound was called `oldest_kept` and held the *cutoff*, which is a
    // different quantity and usually a different number — a timestamp no ping ever had, wrong on
    // 106 of 157 frames and right only on the boundary cases, i.e. exactly when it looked right.
    // Adding a caption that named the genuinely-oldest kept ping is what made the two visibly
    // disagree, one frame apart, about the same thing.
    for (const [name, result] of byName.entries()) {
      expectHolds(
        eachFrame(result.trace, (frame) => {
          const q = frame.get(QUEUE, 'queue')
          if (!q || !frame.watch) return
          const said: string[] = []
          if (frame.watch.pings !== q.values.length) {
            said.push(`watch says ${String(frame.watch.pings)} pings, the queue holds ${q.values.length}`)
          }
          // The panel's bound is the *current* call's, never a previous one. That is what the
          // rename and the reorder are for: it held the cutoff under a name meaning something
          // else, and it was set after the push, so an enqueue frame showed the new ping beside
          // the window of the call before it.
          const opensAt = frame.watch.window_opens_at as number
          const newest = (q.values as number[])[q.values.length - 1]
          if (newest !== undefined && opensAt !== newest - 3000 && opensAt !== 0) {
            said.push(`newest ping is ${newest} but the window claims to open at ${opensAt}`)
          }
          return said

          // Deliberately *not* asserted here: that nothing older than the bound is still queued.
          // That is true only once the sweep finishes — between the push and the first eviction
          // mark there is one frame where the bound has moved and the doomed ping has not yet been
          // marked, which is the documented one-frame-per-op gap running in the direction I chose
          // (a true not-yet-swept queue beats a stale bound). The claim belongs to the report
          // frames, and `windowViolations` already checks it there, exactly.
        }),
        `${name}: the watch panel agrees with the queue`,
      )
    }
  })

  it('names the window on every call, not only when something is evicted', () => {
    // `recent.front()` is the silent read, so an eviction test that comes back *false* has no
    // frame of its own. On the case that exists to prove the boundary is inclusive, that was
    // every test in the run: its animation was shape-identical to one with no boundary in it,
    // and the single thing it was written to show never reached the screen.
    for (const [name, result] of byName.entries()) {
      const reader = new TraceReader(result.trace)
      const answers = reader
        .stepFrames()
        .map((f) => result.trace.frames[f]?.label ?? '')
        .filter((l) => /^ping\(/.test(l) && / -> /.test(l))
      expect(answers.length, name).toBe((result.returned as number[]).length)
      for (const label of answers) {
        expect(label, `${name}: a call that does not say what its window is`).toMatch(
          /the window is \[-?\d+, -?\d+\]/,
        )
      }
    }
  })

  it('says so on the frame where a ping sits exactly on the boundary', () => {
    const result = byName.get('a ping exactly 3000ms old stays — the window is inclusive')!
    const reader = new TraceReader(result.trace)
    const labels = reader.stepFrames().map((f) => result.trace.frames[f]?.label ?? '')
    expect(labels.some((l) => /exactly on the boundary, which counts/.test(l))).toBe(true)
  })

  it('covers at least one case where a single ping evicts several at once, and one where nothing is ever evicted', () => {
    const burst = pingsOf('one ping evicts several at once')
    expect(burst.some((t, i) => expectedWindow(burst, i).length < i + 1)).toBe(true)

    const calm = pingsOf('nothing is ever evicted — every ping is well within the window')
    expect(calm.every((t, i) => expectedWindow(calm, i).length === i + 1)).toBe(true)
  })
})

describe('the queue is exactly the trailing 3000ms window, after every ping', () => {
  it.each(CASE_NAMES)('%s', (name) => {
    const result = caseByName(name)
    const violations = windowViolations(result.trace, pingsOf(name), result.returned as number[], name)
    expect(violations).toEqual([])
  })
})

describe('marks distinguish arrival from eviction', () => {
  const CASE = 'one ping evicts several at once'

  it('flags a newly pushed ping as frontier for exactly the one frame it arrives', () => {
    const result = caseByName(CASE)
    const reader = new TraceReader(result.trace)
    const id = queueId(result.trace)
    const enqueues = enqueueFrames(result.trace)
    expect(enqueues.length).toBeGreaterThan(0)

    for (const frame of enqueues) {
      const arriving = reader.at(frame.index).get(id) as QueueSnapshot | undefined
      expect(arriving?.kind, `frame ${frame.index}`).toBe('queue')
      const frontier = arriving!.marks.filter((m) => m.class === 'frontier')
      expect(frontier.length, `frame ${frame.index}`).toBeGreaterThan(0)
      expect(frontier.every((m) => m.transient), `frame ${frame.index}: not transient`).toBe(true)

      if (frame.index + 1 < reader.frameCount) {
        const after = reader.at(frame.index + 1).get(id) as QueueSnapshot | undefined
        if (after?.kind === 'queue') {
          expect(after.marks.filter((m) => m.class === 'frontier'), `frame ${frame.index + 1}`).toEqual([])
        }
      }
    }
  })

  it('marks a ping excluded the frame before it leaves, and the mark leaves with it', () => {
    const result = caseByName(CASE)
    const reader = new TraceReader(result.trace)
    const id = queueId(result.trace)
    const dequeues = result.trace.frames.filter((f) => f.op === 'dequeue' && f.structureId === id)
    expect(dequeues.length).toBeGreaterThan(0)

    for (const frame of dequeues) {
      expect(frame.index).toBeGreaterThan(0)
      const before = reader.at(frame.index - 1).get(id) as QueueSnapshot | undefined
      expect(before?.kind, `frame ${frame.index - 1}`).toBe('queue')
      const excluded = before!.marks.filter((m) => m.class === 'excluded' && !m.transient)
      expect(excluded, `frame ${frame.index - 1}`).toHaveLength(1)
      expect(excluded[0]?.index).toBe(0)

      const after = reader.at(frame.index).get(id) as QueueSnapshot | undefined
      expect(after?.kind, `frame ${frame.index}`).toBe('queue')
      expect(after!.marks.filter((m) => m.class === 'excluded'), `frame ${frame.index}`).toEqual([])
    }
  })

  it('leaves nothing excluded in the final picture of any case', () => {
    for (const name of CASE_NAMES) {
      const result = caseByName(name)
      const reader = new TraceReader(result.trace)
      const id = queueId(result.trace)
      const final = reader.at(reader.frameCount - 1).get(id) as QueueSnapshot | undefined
      if (final?.kind === 'queue') {
        expect(final.marks.filter((m) => m.class === 'excluded'), name).toEqual([])
      }
    }
  })
})

describe('the invariant check has teeth', () => {
  // Answers every case correctly by recomputing the count with `filter` on every call instead of
  // evicting — the queue it draws only ever grows. Same shape as "keeping a plain array and
  // counting with filter each time" from a plain (uninstrumented) solution, just wearing a
  // `viz.queue` so `structures:` would still read "queue" to a reviewer skimming the trace.
  const source = `
export default function recentCounter(pings: number[], viz: Viz): number[] {
  const recent = viz.queue<number>([], { name: 'recent' })
  const out: number[] = []
  for (const t of pings) {
    recent.push(t)
    out.push(recent.toArray().filter((p) => p >= t - 3000).length)
  }
  return out
}
`
  let byImpostorName: Map<string, CaseResult>

  beforeAll(() => {
    const run = executeRun({ problem: PROBLEM, source, caseIndex: 'all' })
    expect(run.diagnostics).toEqual([])
    byImpostorName = new Map(run.results.map((r) => [r.name, r]))
  })

  it('answers every case correctly', () => {
    const failures = [...byImpostorName.values()].filter((r) => !r.passed)
    expect(failures.map((f) => f.name)).toEqual([])
  })

  it('is rejected by the window invariant on every case that ever evicts', () => {
    let evictingCases = 0
    for (const name of CASE_NAMES) {
      const pings = pingsOf(name)
      const evicts = pings.some((t, i) => expectedWindow(pings, i).length < i + 1)
      if (!evicts) continue
      evictingCases += 1
      const result = byImpostorName.get(name)!
      const violations = windowViolations(result.trace, pings, result.returned as number[], name)
      expect(violations.length, name).toBeGreaterThan(0)
    }
    // Guards against the loop vacuously passing because no case ever evicts.
    expect(evictingCases).toBeGreaterThan(0)
  })

  it('is caught concretely on the burst-eviction case, naming the stale contents', () => {
    const name = 'one ping evicts several at once'
    const pings = pingsOf(name)
    const result = byImpostorName.get(name)!
    const violations = windowViolations(result.trace, pings, result.returned as number[], name)
    expect(violations.length).toBeGreaterThan(0)
    // The impostor's queue at ping(3003) still holds 1 and 2, which fell out of the window.
    expect(violations.join('\n')).toContain('queue holds [1,2,3,3003]')
    expect(violations.join('\n')).toContain('window is [3,3003]')
  })

  it('never evicts — the queue only grows across the whole run', () => {
    const result = byImpostorName.get('one ping evicts several at once')!
    const id = queueId(result.trace)
    expect(result.trace.frames.some((f) => f.op === 'dequeue' && f.structureId === id)).toBe(false)
  })
})

describe('the starter, filled in from its own TODO comments, produces the promised animation', () => {
  // Transcribed from the starter's TODOs alone — push, evict-while-older-than-the-cutoff with a
  // mark before each shift, then push the size — without copying the reference's extra
  // per-eviction narration, which the starter's comment never promises. If a future edit fixes
  // an ordering bug in the reference and leaves the starter's comment describing the old order,
  // this drifts from the reference's structural op sequence and fails.
  const source = `
export default function recentCounter(pings: number[], viz: Viz): number[] {
  const recent = viz.queue<number>([], { name: 'recent' })
  const out = viz.array<number>(pings.length, { name: 'calls in the last 3000ms', fill: null })
  let cutoff = 0
  viz.watch(() => ({ pings: recent.size, window_opens_at: cutoff }))

  pings.forEach((t, call) => {
    viz.group(\`ping(\${t})\`, () => {
      cutoff = t - 3000
      recent.push(t)
      while (!recent.isEmpty && (recent.front() as number) < cutoff) {
        recent.mark(0, 'excluded', \`evicted before ping(\${t})\`)
        recent.shift()
      }
      out[call] = recent.size
      viz.step(\`ping(\${t}) -> \${recent.size} — the window is [\${cutoff}, \${t}]\`)
    })
  })

  return out.toArray()
}
`
  let transcribed: Map<string, CaseResult>

  beforeAll(() => {
    const run = executeRun({ problem: PROBLEM, source, caseIndex: 'all' })
    expect(run.diagnostics).toEqual([])
    transcribed = new Map(run.results.map((r) => [r.name, r]))
  })

  it('passes every case', () => {
    const failures = [...transcribed.values()].filter((r) => !r.passed)
    expect(failures.map((f) => `${f.name}: got ${JSON.stringify(f.returned)}`)).toEqual([])
  })

  it('holds the sliding-window invariant on every case, exactly like the reference', () => {
    for (const name of CASE_NAMES) {
      const result = transcribed.get(name)!
      const violations = windowViolations(result.trace, pingsOf(name), result.returned as number[], name)
      expect(violations).toEqual([])
    }
  })

  it('matches the reference structural op order, ping for ping, on every case', () => {
    // "By order, not just presence": the same multiset of ops in a different order (shift before
    // mark, say) would still pass every count above while showing the eviction backwards.
    for (const name of CASE_NAMES) {
      const referenceRuns = calls(caseByName(name).trace)
      const transcribedRuns = calls(transcribed.get(name)!.trace)
      expect(transcribedRuns.map((c) => c.label), name).toEqual(referenceRuns.map((c) => c.label))
      referenceRuns.forEach((run, i) => {
        expect(structuralOps(transcribedRuns[i]!.frames), `${name} — ${run.label}`).toEqual(
          structuralOps(run.frames),
        )
      })
    }
  })

  it('marks every eviction excluded before the shift that removes it', () => {
    const result = transcribed.get('one ping evicts several at once')!
    const id = queueId(result.trace)
    const reader = new TraceReader(result.trace)
    const dequeues = result.trace.frames.filter((f) => f.op === 'dequeue' && f.structureId === id)
    expect(dequeues.length).toBeGreaterThan(0)
    for (const frame of dequeues) {
      const before = reader.at(frame.index - 1).get(id) as QueueSnapshot | undefined
      expect(before?.marks.filter((m) => m.class === 'excluded' && !m.transient), `frame ${frame.index - 1}`)
        .toHaveLength(1)
    }
  })
})
