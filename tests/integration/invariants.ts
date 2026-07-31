import { expect } from 'vitest'
import { requireProblem } from '@algoviz/problems'
import { TraceReader, type OpKind, type Primitive, type StructureSnapshot, type Trace } from '@algoviz/tracer'

/**
 * Shared vocabulary for frame-sequence assertions.
 *
 * ## Why this exists
 *
 * Every problem in this repo hand-rolled its own walk over the trace, and across nine problems
 * and two audits, **almost every animation defect that shipped had a test that looked like it
 * covered the claim and quietly sampled only the frames where the claim held**:
 *
 * - `single-number` checked the `n` step frames where the bit tally had finished catching up. The
 *   identity it exists to prove was false on 193 of the other frames.
 * - `find-pivot-index` checked `read` frames — exactly the frames that were right, skipping
 *   exactly the two frames per index that were wrong.
 * - `kth-largest-element-in-an-array` checked the watch panel on the final frame, the one frame
 *   where the value it checked could not be stale.
 * - `delete-node-in-a-bst` weakened a count to `>= 1` with a comment explaining why the exact
 *   number could not be pinned. The reason it could not be pinned was a tracer bug.
 *
 * Four of those were the defect written down as an expectation. The hand-rolling is where the
 * sampling error creeps in, so this module's job is not deduplication — it is to make *not
 * looking* the thing you have to do deliberately.
 *
 * ## The rule this encodes
 *
 * `eachFrame` takes **no filter**. It walks every frame in the trace and hands your check a
 * resolved view of each one. A check that only applies to some frames still has to look at every
 * frame in order to decide that, and returns nothing for the ones it does not care about. You
 * cannot accidentally fail to look, because there is no parameter for it.
 *
 * Where a subset genuinely is the right unit — "every narrated frame's caption names the window"
 * is a claim about captions, not about frames — use `eachStepFrame`, which is named after what it
 * skips so that the choice is visible in the test.
 *
 * Checks **collect complaints rather than throwing**, so one run reports every frame that
 * violates an invariant instead of only the first. A defect on 193 frames and a defect on one
 * frame are very different findings, and a bare `expect` inside a loop cannot tell them apart.
 */

type Of<K extends StructureSnapshot['kind']> = Extract<StructureSnapshot, { kind: K }>

/** One frame, with everything resolved through the reader's carry-forward semantics. */
export interface FrameView {
  readonly index: number
  readonly op: OpKind
  readonly label: string | undefined
  /** Enclosing `viz.group` labels, outermost first. */
  readonly groups: readonly string[]
  /** The innermost scope, which is what a caption is usually about. */
  readonly scope: string | undefined
  readonly watch: Record<string, Primitive> | undefined
  /**
   * A structure as it stands on this frame, by name — resolved by walking back, so it is what a
   * viewer parked here would see rather than only what this frame happened to change.
   */
  get<K extends StructureSnapshot['kind']>(name: string, kind: K): Of<K> | undefined
  /** Like `get`, but fails the test rather than returning `undefined`. */
  require<K extends StructureSnapshot['kind']>(name: string, kind: K): Of<K>
}

export function structureId(trace: Trace, name: string): string {
  const meta = trace.structures.find((s) => s.name === name)
  if (!meta) {
    throw new Error(
      `no structure named "${name}" — got ${trace.structures.map((s) => s.name).join(', ') || '(none)'}`,
    )
  }
  return meta.id
}

function viewOf(reader: TraceReader, trace: Trace, index: number): FrameView {
  const frame = trace.frames[index]!
  const get = <K extends StructureSnapshot['kind']>(name: string, kind: K): Of<K> | undefined => {
    const snap = reader.structureAt(structureId(trace, name), index)
    return snap?.kind === kind ? (snap as Of<K>) : undefined
  }
  return {
    index,
    op: frame.op,
    label: frame.label,
    groups: frame.groups,
    scope: frame.groups[frame.groups.length - 1],
    watch: reader.watchAt(index),
    get,
    require: (name, kind) => {
      const snap = get(name, kind)
      expect(snap, `frame ${index}: no ${kind} snapshot named "${name}"`).toBeDefined()
      return snap!
    },
  }
}

/** What a check reports: nothing when the frame is fine, or one or more complaints. */
export type Complaint = string | readonly string[] | void | undefined

function collect(
  trace: Trace,
  indices: readonly number[],
  check: (frame: FrameView) => Complaint,
): string[] {
  const reader = new TraceReader(trace)
  const complaints: string[] = []
  for (const i of indices) {
    const said = check(viewOf(reader, trace, i))
    if (typeof said === 'string') complaints.push(`frame ${i}: ${said}`)
    else if (Array.isArray(said)) complaints.push(...said.map((s) => `frame ${i}: ${s}`))
  }
  return complaints
}

/**
 * Walk **every** frame. There is deliberately no way to narrow this.
 *
 * Returns the complaints rather than asserting, so a caller can count them, and so `expectHolds`
 * can report the first handful alongside the total — "false on 193 of 214 frames" is a different
 * finding from "false on one frame", and a bare `expect` inside a loop reports neither.
 */
export function eachFrame(trace: Trace, check: (frame: FrameView) => Complaint): string[] {
  return collect(
    trace,
    trace.frames.map((_, i) => i),
    check,
  )
}

/**
 * Walk only the narrated frames — the ones the player stops on.
 *
 * Named after what it skips, because that is the decision worth seeing in a test. Use it for
 * claims that are genuinely *about captions* ("every give-up frame says which way it gave up").
 * A claim about state is a claim about every frame: use `eachFrame`.
 */
export function eachStepFrame(trace: Trace, check: (frame: FrameView) => Complaint): string[] {
  return collect(trace, new TraceReader(trace).stepFrames(), check)
}

/**
 * Assert a walk found nothing, reporting the scale of the failure as well as the first few cases.
 *
 * Truncated to five, because a defect on every frame of a 3000-frame trace should be readable.
 */
export function expectHolds(complaints: readonly string[], label: string): void {
  const summary =
    complaints.length === 0
      ? []
      : [`${complaints.length} frame(s) violated "${label}"`, ...complaints.slice(0, 5)]
  expect(summary, label).toEqual([])
}

/**
 * Assert that calling `fn` (an `expectHolds`-based check) rejects, and that one of its complaints
 * matches `pattern`.
 *
 * `expectHolds` collects every violating frame instead of throwing on the first, which is the
 * whole point — but it means a "the check has teeth" test can no longer assert the thrown message
 * *is* one specific complaint, only that the complaint is *among* what got reported.
 */
export function expectRejects(fn: () => void, pattern: RegExp): void {
  try {
    fn()
  } catch (err) {
    const actual = (err as { actual?: unknown }).actual
    const text = Array.isArray(actual) ? actual.join('\n') : String(err)
    expect(text, `expected a complaint matching ${pattern}`).toMatch(pattern)
    return
  }
  expect.fail(`expected ${fn} to reject, matching ${pattern}`)
}

/**
 * A watch value must equal a quantity independently recomputed from the picture, on every frame.
 *
 * The single most productive assertion in this repo — the watch panel is where a solution states
 * a number, and the picture is where it has to have earned it. Every problem that got this wrong
 * got it wrong the same way: the number moved on a line that costs no frame, so it described a
 * region or a total the picture reached one frame later, or never.
 *
 * `compute` returns `undefined` for frames where the value is not claimed at all.
 */
export function watchMatchesPicture(
  trace: Trace,
  key: string,
  compute: (frame: FrameView) => Primitive | undefined,
): string[] {
  return eachFrame(trace, (frame) => {
    const want = compute(frame)
    if (want === undefined) return
    const got = frame.watch?.[key]
    if (got !== want) return `watch ${key} = ${JSON.stringify(got)}, the picture says ${JSON.stringify(want)}`
  })
}

/**
 * Every index of a structure carries exactly one non-transient mark, and it is the expected one.
 *
 * "Exactly one" is the half that catches things: a partition with a cell marked twice is a
 * solution that ruled the same candidate out for two different reasons, and one with a cell
 * unmarked is a solution that stopped early and left the rest of the space unaccounted for. Both
 * return the right answer.
 */
export function expectMarksPartition(
  marks: readonly { index: number; class: string; transient?: boolean }[],
  length: number,
  classAt: (index: number) => string,
  label: string,
): void {
  const settled = marks.filter((m) => m.transient !== true)
  const byIndex = new Map<number, string[]>()
  for (const m of settled) byIndex.set(m.index, [...(byIndex.get(m.index) ?? []), m.class])

  const problems: string[] = []
  for (let i = 0; i < length; i += 1) {
    const classes = byIndex.get(i) ?? []
    if (classes.length === 0) problems.push(`index ${i} is unmarked, expected ${classAt(i)}`)
    else if (classes.length > 1) problems.push(`index ${i} is marked ${classes.join(' + ')}`)
    else if (classes[0] !== classAt(i)) problems.push(`index ${i} is ${classes[0]}, expected ${classAt(i)}`)
  }
  const extra = [...byIndex.keys()].filter((i) => i < 0 || i >= length)
  for (const i of extra) problems.push(`index ${i} is marked but outside 0..${length - 1}`)
  expectHolds(problems, label)
}

/**
 * A filled-in starter is a **transcription** of the shipped one, checked by order.
 *
 * Six problems shipped with a fix applied to the reference and the defect left in the starter,
 * and the guard against it was itself gotten wrong twice: comparing by *presence* passes a
 * program with every ordering inverted, which is exactly the drift worth catching, since almost
 * every fix in this repo is an ordering fix.
 *
 * The limit is worth stating rather than hiding: a starter's placeholder lines are not anchors,
 * so a statement moving across one is invisible here. What catches that is the test that runs the
 * filled program and reads its frames — which is the point of having one.
 */
export function expectStarterTranscription(
  slug: string,
  filled: string,
  placeholders: readonly string[],
): void {
  const scaffolding = requireProblem(slug)
    .starter.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 6 && !l.startsWith('//') && !l.startsWith('*'))
    .filter((l) => !placeholders.includes(l))

  const lines = filled.split('\n').map((l) => l.trim())
  const drift: string[] = []
  let at = -1
  for (const line of scaffolding) {
    const found = lines.indexOf(line, at + 1)
    if (found === -1) drift.push(lines.includes(line) ? `out of order: ${line}` : `missing: ${line}`)
    else at = found
  }
  expectHolds(drift, `the filled solution is a transcription of ${slug}'s shipped starter`)
}
