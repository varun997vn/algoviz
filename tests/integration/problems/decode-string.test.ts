import { describe, expect, it } from 'vitest'
import { executeRun } from '@algoviz/runner'
import { requireProblem } from '@algoviz/problems'
import { TraceReader, type StructureSnapshot, type Trace } from '@algoviz/tracer'

/**
 * LeetCode 394 — Decode String.
 *
 * The load-bearing test in this file is `the stack height is the nesting depth on every frame`.
 * Everything else here would also pass for a solution that decoded the string correctly while
 * animating nothing, which is not a hypothetical: **a recursive-descent parser returns the
 * identical string with both stack panels empty for the whole run**, because the nesting lives in
 * the JS call stack instead. `the depth check has teeth` runs exactly that solution and proves the
 * check rejects it.
 *
 * Two panels, so two claims about depth, and they are deliberately different strengths:
 *
 *  - On **every** frame, each stack's height is the nesting depth either side of the character the
 *    caret is on — never anything else. It cannot be a single number on every frame, because the
 *    two pushes at a `[` cannot share one frame (see the "one frame per op" note in CLAUDE.md).
 *  - On every **step** frame — the ones the player stops on — both heights are exactly the depth.
 *
 * That pair is the honest statement of what the picture promises, and it is strictly stronger than
 * "the stacks are used": it pins the height to the input at every point in the timeline.
 */

const PROBLEM = 'decode-string'
const INPUT = 's'
const COUNTS = 'repeat counts'
const SAVED = 'text before the ['
const OUT = 'the piece being built'

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

/** `depthAfter(i)` — bracket nesting depth once `s[0..i]` has been consumed. */
function depthTable(s: string): (index: number) => number {
  const after: number[] = []
  let d = 0
  for (const ch of s) {
    if (ch === '[') d += 1
    else if (ch === ']') d -= 1
    after.push(d)
  }
  return (index: number) => (index < 0 ? 0 : (after[Math.min(index, after.length - 1)] ?? 0))
}

/**
 * The piece being built, read off its **panel**.
 *
 * It used to be a watch value, and these assertions read it from `watchAt`. `VizString.replace`
 * exists so a wholesale rewrite is one frame instead of a clear-by-length idiom, which is what
 * demoted it to a watch value in the first place; now that the solution uses it, the panel is what
 * a viewer sees and so it is what these check.
 */
function builtAt(reader: TraceReader, frame: number): string {
  return resolve(reader, OUT, 'string', frame)?.value ?? ''
}

function caretAt(reader: TraceReader, frame: number): number {
  const input = resolve(reader, INPUT, 'string', frame)
  return input?.cursors.find((c) => c.name === 'i')?.index ?? 0
}

/**
 * The claim the whole visualization rests on, checked frame by frame.
 *
 * Split out and called from both the per-case loop and the teeth test, so the check that proves
 * the reference honest is literally the same code that rejects the impostor.
 */
function expectDepthEveryFrame(trace: Trace, s: string, label: string): void {
  const reader = new TraceReader(trace)
  const depthAfter = depthTable(s)
  let checked = 0
  let deepest = 0

  for (let f = 0; f < reader.frameCount; f += 1) {
    const counts = resolve(reader, COUNTS, 'stack', f)
    const saved = resolve(reader, SAVED, 'stack', f)
    if (!counts || !saved) continue
    checked += 1
    deepest = Math.max(deepest, counts.values.length)

    const i = caretAt(reader, f)
    const lo = Math.min(depthAfter(i - 1), depthAfter(i))
    const hi = Math.max(depthAfter(i - 1), depthAfter(i))

    for (const [name, stack] of [
      [COUNTS, counts],
      [SAVED, saved],
    ] as const) {
      expect(
        stack.values.length >= lo && stack.values.length <= hi,
        `${label} frame ${f}: caret on s[${i}] = ${JSON.stringify(s[i])}, so the nesting depth is ${lo === hi ? lo : `${lo} or ${hi}`}, but "${name}" is ${stack.values.length} deep`,
      ).toBe(true)
    }

    // `counts` is pushed first and popped last, so it is never the shorter of the two. That is
    // what makes it the panel a viewer can read the depth off without a caveat.
    expect(
      saved.values.length,
      `${label} frame ${f}: stacks are ${counts.values.length} and ${saved.values.length} deep`,
    ).toBeGreaterThanOrEqual(counts.values.length - 1)
    expect(saved.values.length).toBeLessThanOrEqual(counts.values.length)
  }

  expect(checked, `${label}: no frame carried both stacks`).toBeGreaterThan(0)

  // The picture must actually go as deep as the string nests. Without this, a solution that
  // pushed and popped one throwaway cell per bracket would satisfy everything above on a
  // singly-nested case.
  const maxDepth = Math.max(0, ...[...s].map((_, i) => depthAfter(i)))
  expect(deepest, `${label}: the stack panel never gets deeper than ${deepest}`).toBe(maxDepth)

  // Exactly the depth on every narrated frame — the frames the player stops on.
  for (const f of reader.stepFrames()) {
    const counts = resolve(reader, COUNTS, 'stack', f)
    const saved = resolve(reader, SAVED, 'stack', f)
    if (!counts || !saved) continue
    const i = caretAt(reader, f)
    expect(
      [counts.values.length, saved.values.length],
      `${label} step frame ${f}: s[${i}] leaves depth ${depthAfter(i)}`,
    ).toEqual([depthAfter(i), depthAfter(i)])
  }
}

/** Push/pop history reconstructed from each stack's own snapshots, not from frame labels. */
function stackTraffic(trace: Trace, name: string): { pushes: number; pops: number } {
  const id = idOf(trace, name)
  let pushes = 0
  let pops = 0
  let prev = 0
  for (const frame of trace.frames) {
    const snap = frame.snapshots[id]
    if (!snap || snap.kind !== 'stack') continue
    if (snap.values.length > prev) pushes += 1
    if (snap.values.length < prev) pops += 1
    prev = snap.values.length
  }
  return { pushes, pops }
}

describe('Decode String — reference trace semantics', () => {
  // '3[a2[c]]' — the nesting case, and the reason this problem is worth animating.
  const problem = requireProblem(PROBLEM)
  const caseIndex = problem.cases.findIndex((c) => c.args[0] === '3[a2[c]]')
  const result = executeRun({ problem: PROBLEM, useReference: true, caseIndex })
  const caseResult = result.results[0]!
  const trace = caseResult.trace
  const reader = new TraceReader(trace)
  const last = reader.frameCount - 1
  const returned = caseResult.returned as string

  it('returns the known answer for the nested example', () => {
    expect(caseResult.passed).toBe(true)
    expect(returned).toBe('accaccacc')
  })

  it('animates exactly the declared structures', () => {
    expect(trace.structures.map((s) => `${s.name}:${s.kind}`)).toEqual([
      `${INPUT}:string`,
      `${COUNTS}:stack`,
      `${SAVED}:stack`,
      `${OUT}:string`,
    ])
  })

  it('the stack height is the nesting depth on every frame', () => {
    expectDepthEveryFrame(trace, '3[a2[c]]', 'nested')
  })

  it('reaches depth 2 and comes back down, so the nesting is visible and not merely claimed', () => {
    const heights: number[] = []
    for (let f = 0; f < reader.frameCount; f += 1) {
      const counts = resolve(reader, COUNTS, 'stack', f)
      if (counts) heights.push(counts.values.length)
    }
    expect(Math.max(...heights)).toBe(2)
    // 0 -> 1 -> 2 -> 1 -> 0: every level is on screen on its own, in both directions.
    expect([...new Set(heights)].sort()).toEqual([0, 1, 2])
    expect(heights[heights.length - 1]).toBe(0)
  })

  it('ends with both stacks empty', () => {
    expect(resolve(reader, COUNTS, 'stack', last)!.values).toEqual([])
    expect(resolve(reader, SAVED, 'stack', last)!.values).toEqual([])
  })

  it('pops every cell it pushes, twice per bracket', () => {
    const brackets = [...'3[a2[c]]'].filter((c) => c === '[').length
    for (const name of [COUNTS, SAVED]) {
      const { pushes, pops } = stackTraffic(trace, name)
      expect(pushes, `${name} pushed ${pushes} times for ${brackets} brackets`).toBe(brackets)
      expect(pops, `${name}: ${pushes} pushes but ${pops} pops`).toBe(pushes)
    }
  })

  it('never holds a character the scan has not reached', () => {
    // The anti-lookahead check. A solution that decoded the string up front and replayed it
    // would show the finished answer from frame one; this pins every piece the algorithm is
    // holding — the work in progress *and* everything parked on the stack — to the prefix of
    // the input the caret has actually walked past.
    const s = '3[a2[c]]'
    for (let f = 0; f < reader.frameCount; f += 1) {
      const saved = resolve(reader, SAVED, 'stack', f)
      if (!saved) continue
      const i = caretAt(reader, f)
      const seen = new Set(s.slice(0, i + 1))
      const holding = [builtAt(reader, f), ...(saved.values as string[])]
      for (const piece of holding) {
        for (const ch of piece) {
          expect(
            seen.has(ch),
            `frame ${f}: holding ${JSON.stringify(piece)} with the caret only as far as s[${i}] = ${JSON.stringify(s.slice(0, i + 1))}`,
          ).toBe(true)
        }
      }
    }
  })

  it('marks every parked cell `path`, and the marks unwind with the pops', () => {
    // `path` is documented as "on the live recursion path — must unwind as the stack pops", and
    // `VizStack.mark` had no caller anywhere before this problem, so this is the first test that
    // the contract holds on a stack at all. A mark surviving above the top of the stack would
    // reappear on the *next* value pushed into that slot.
    for (let f = 0; f < reader.frameCount; f += 1) {
      for (const name of [COUNTS, SAVED]) {
        const stack = resolve(reader, name, 'stack', f)
        if (!stack) continue
        for (const mark of stack.marks) {
          expect(
            mark.index,
            `frame ${f}: "${name}" carries a ${mark.class} mark at index ${mark.index} of a ${stack.values.length}-deep stack`,
          ).toBeLessThan(stack.values.length)
        }
        // Every parked cell is marked, allowing the one frame between a push and its mark.
        const path = stack.marks.filter((m) => m.class === 'path' && !m.transient)
        expect(
          path.length,
          `frame ${f}: "${name}" is ${stack.values.length} deep with ${path.length} path marks`,
        ).toBeGreaterThanOrEqual(stack.values.length - 1)
      }
    }
    // And nothing is left marked once everything has unwound.
    expect(resolve(reader, COUNTS, 'stack', last)!.marks).toEqual([])
    expect(resolve(reader, SAVED, 'stack', last)!.marks).toEqual([])
  })

  it('gives every parked stack cell a note saying what it is for', () => {
    // For a stack of strings a cell shows the value and the note says what the value *means* —
    // which bracket parked it, and why. Notes were dead text everywhere until they were wired to
    // `title`; this asserts the wiring is being used, not just that it exists.
    //
    // The note used to carry a copy of the value too, because `""` drew a blank box and a long
    // prefix overflowed one. Both are fixed in `packages/viz` — an empty cell draws `ε`, and a
    // clipped cell's tooltip leads with the full value — so the copy became duplication and the
    // long-prefix tooltip read the value twice.
    let seenNotes = 0
    for (let f = 0; f < reader.frameCount; f += 1) {
      for (const name of [COUNTS, SAVED]) {
        const stack = resolve(reader, name, 'stack', f)
        if (!stack) continue
        for (const mark of stack.marks) {
          if (mark.class !== 'path' || mark.transient) continue
          expect(mark.note, `frame ${f}: "${name}" cell ${mark.index} is parked with no note`).toBeTruthy()
          seenNotes += 1
        }
      }
    }
    expect(seenNotes).toBeGreaterThan(0)
    // Each note names the bracket that parked the cell, so two cells of one stack are never
    // labelled the same thing — which is what makes the note a label rather than decoration.
    const savedNotes: string[] = []
    for (let f = 0; f < reader.frameCount; f += 1) {
      const stack = resolve(reader, SAVED, 'stack', f)
      for (const m of stack?.marks ?? []) if (m.note) savedNotes.push(m.note)
    }
    expect(savedNotes.every((n) => /at s\[\d+\]/.test(n))).toBe(true)
    for (let f = 0; f < reader.frameCount; f += 1) {
      const notes = (resolve(reader, SAVED, 'stack', f)?.marks ?? [])
        .map((m) => m.note)
        .filter((n): n is string => n !== undefined)
      expect(new Set(notes).size, `frame ${f}: two parked cells share a note`).toBe(notes.length)
    }
  })

  it('reads the input as content versus syntax', () => {
    // Letters end up in the answer, digits and brackets never do. The two mark classes make that
    // legible without a legend, and `excluded` draws a slash so it is not carried by fill alone.
    const s = '3[a2[c]]'
    const input = resolve(reader, INPUT, 'string', last)!
    const visited = input.marks
      .filter((m) => m.class === 'visited')
      .map((m) => m.index)
      .sort((a, b) => a - b)
    const excluded = input.marks
      .filter((m) => m.class === 'excluded')
      .map((m) => m.index)
      .sort((a, b) => a - b)
    expect(visited).toEqual([...s].flatMap((c, i) => (c >= 'a' && c <= 'z' ? [i] : [])))
    expect(excluded).toEqual([...s].flatMap((c, i) => (c >= 'a' && c <= 'z' ? [] : [i])))
    expect(visited.length + excluded.length).toBe(s.length)
  })

  it('never shows a context popped before the text it was kept for appears', () => {
    // The reassembly runs *ahead* of the two pops, so on the very frame a saved prefix leaves the
    // stack the finished piece is already in its panel. The other order leaves a frame where the
    // stack has given up the prefix and nothing on screen has received it — on the pop frames,
    // which are the ones worth stopping on.
    //
    // Checked exactly, not just "something changed": `1[a]` is a real case where the piece before
    // and after a pop are the same string, and a "did it change?" test would be vacuous there.
    // `inner` is therefore the panel's value as of the last frame on which it *differed*, not the
    // value one frame back — the rewrite is now its own frame, so "one frame back" is already the
    // reassembled piece and comparing against it would be circular.
    const savedId = idOf(trace, SAVED)
    let held: string[] = []
    let inner = ''
    let pops = 0
    for (const frame of trace.frames) {
      const current = builtAt(reader, frame.index)
      const snap = frame.snapshots[savedId]
      if (snap && snap.kind === 'stack') {
        if (snap.values.length < held.length) {
          const popped = held[held.length - 1] as string
          // `counts` is popped *after* `saved`, so the multiplier is still on screen right here.
          const counts = resolve(reader, COUNTS, 'stack', frame.index)!
          const times = counts.values[counts.values.length - 1] as number
          expect(
            current,
            `frame ${frame.index}: ${JSON.stringify(popped)} left the stack before it was glued onto ${times} × ${JSON.stringify(inner)}`,
          ).toBe(popped + inner.repeat(times))
          pops += 1
        }
        held = snap.values as string[]
      }
      if (current !== builtAt(reader, frame.index + 1)) inner = current
    }
    expect(pops).toBe(2)
  })

  it('narrates every character, plus a closing frame', () => {
    const steps = reader.stepFrames()
    expect(steps.length).toBe('3[a2[c]]'.length + 1)
    const labels = steps.map((i) => trace.frames[i]!.label ?? '')
    // The two events the animation exists to explain are each named in words.
    expect(labels.filter((l) => l.includes('parked')).length).toBe(2)
    expect(labels.filter((l) => l.includes('glued onto the end of')).length).toBe(2)
    expect(labels[labels.length - 1]).toMatch(/both stacks are empty/)
  })

  it('reports the answer in its panel and the depth in the watch panel', () => {
    expect(builtAt(reader, last)).toBe(returned)
    const watch = reader.watchAt(last)!
    expect(watch.depth).toBe(0)
    expect(watch.k).toBe(0)
  })
})

describe('the depth check has teeth', () => {
  // An invariant test that cannot fail is worse than no test, because it reads like evidence.
  // This is the wrong-but-passing solution the problem invites: recursive descent. It returns the
  // *identical string*, walks the same caret over the same input and marks the same cells — and
  // the two stack panels stay empty for the entire run, because the nesting is in the JS call
  // stack where nobody can see it. Every assertion in this file about the answer passes; only
  // `expectDepthEveryFrame` rejects it.
  const source = `
export default function decodeString(s, viz) {
  const input = viz.string(s, { name: 's' })
  const i = viz.cursor('i', 0, input)
  const counts = viz.stack([], { name: 'repeat counts' })
  const saved = viz.stack([], { name: 'text before the [' })
  let built = ''
  viz.watch(() => ({ i: i.value, depth: counts.size, k: 0, built }))

  function parse() {
    let out = ''
    let k = 0
    while (i.value < input.length) {
      const ch = input.charAt(i.value)
      input.mark(i.value, ch >= 'a' && ch <= 'z' ? 'visited' : 'excluded')
      if (ch >= '0' && ch <= '9') { k = k * 10 + Number(ch); i.inc() }
      else if (ch === '[') { i.inc(); out += parse().repeat(k); k = 0 }
      else if (ch === ']') { i.inc(); return out }
      else { out += ch; i.inc() }
      built = out
      viz.step('s[' + i.value + ']')
    }
    return out
  }
  return parse()
}
`
  const problem = requireProblem(PROBLEM)
  const caseIndex = problem.cases.findIndex((c) => c.args[0] === '3[a2[c]]')
  const result = executeRun({ problem: PROBLEM, source, caseIndex })

  it('accepts the recursive answer and rejects its empty stack panels', () => {
    expect(result.diagnostics).toEqual([])
    expect(result.results[0]?.passed).toBe(true)
    expect(result.results[0]?.returned).toBe('accaccacc')
    expect(() => expectDepthEveryFrame(result.results[0]!.trace, '3[a2[c]]', 'recursive')).toThrow(
      /nesting depth/,
    )
  })
})

describe('Decode String — the depth invariant holds on every case', () => {
  const problem = requireProblem(PROBLEM)
  const result = executeRun({ problem: PROBLEM, useReference: true })

  it('passes all of its own cases', () => {
    expect(result.results.map((r) => [r.name, r.passed])).toEqual(
      problem.cases.map((c) => [c.name, true]),
    )
  })

  for (const [index, testCase] of problem.cases.entries()) {
    it(`${testCase.name}`, () => {
      const s = testCase.args[0] as string
      const caseResult = result.results[index]!
      const trace = caseResult.trace
      const reader = new TraceReader(trace)
      const last = reader.frameCount - 1

      expectDepthEveryFrame(trace, s, testCase.name)

      // Both stacks empty at the end, on every case — including the ones with no brackets at
      // all, where they are empty for the whole run.
      expect(resolve(reader, COUNTS, 'stack', last)!.values).toEqual([])
      expect(resolve(reader, SAVED, 'stack', last)!.values).toEqual([])
      expect(resolve(reader, COUNTS, 'stack', last)!.marks).toEqual([])
      expect(resolve(reader, SAVED, 'stack', last)!.marks).toEqual([])

      // One push and one matching pop per bracket, per stack. This is the O(n) proof: no
      // character is ever pushed twice, so a 28-character input cannot produce a quadratic trace
      // no matter how long the decoded string gets.
      const brackets = [...s].filter((c) => c === '[').length
      for (const name of [COUNTS, SAVED]) {
        const { pushes, pops } = stackTraffic(trace, name)
        expect([pushes, pops], `${name} on ${s}`).toEqual([brackets, brackets])
      }

      // Nothing held that the scan has not reached — on every case, not just the showcase one.
      for (let f = 0; f < reader.frameCount; f += 1) {
        const saved = resolve(reader, SAVED, 'stack', f)
        if (!saved) continue
        const i = caretAt(reader, f)
        const seen = new Set(s.slice(0, i + 1))
        for (const piece of [builtAt(reader, f), ...(saved.values as string[])]) {
          for (const ch of piece) {
            expect(
              seen.has(ch),
              `${testCase.name} frame ${f}: holding ${JSON.stringify(piece)} with the caret at s[${i}]`,
            ).toBe(true)
          }
        }
      }

      // The picture agrees with the answer, and the whole input has been consumed.
      const input = resolve(reader, INPUT, 'string', last)!
      expect(input.marks.filter((m) => !m.transient)).toHaveLength(s.length)
      expect(builtAt(reader, last)).toBe(caseResult.returned)

      // Frames scale with the *input*, not with the decoded string. `10[ab]` decodes to twenty
      // characters from six, and `2[2[2[2[a]]]]` to sixteen from thirteen; if the repeats were
      // animated character by character this would blow up.
      expect(
        caseResult.frameCount,
        `${testCase.name}: ${caseResult.frameCount} frames for a ${s.length}-character input`,
      ).toBeLessThanOrEqual(6 * s.length + 20)
    })
  }

  it('shows a bracket-free input as two empty stacks for the whole run', () => {
    // The animation's honest statement of "nothing here needed deferring", and the case that
    // would look identical to the recursive-descent impostor if the depth check only ever ran on
    // bracketed inputs.
    const index = problem.cases.findIndex((c) => c.args[0] === 'abcdef')
    const reader = new TraceReader(result.results[index]!.trace)
    for (let f = 0; f < reader.frameCount; f += 1) {
      const counts = resolve(reader, COUNTS, 'stack', f)
      if (!counts) continue
      expect(counts.values, `frame ${f}`).toEqual([])
    }
    expect(result.results[index]!.returned).toBe('abcdef')
  })

  it('accumulates multi-digit counts into one stack cell', () => {
    // `10[ab]` must park a single 10, not a 1 and then a 0. The cell value is the check: a
    // solution that pushed per digit would show two cells and decode to something else.
    const index = problem.cases.findIndex((c) => c.args[0] === '10[ab]')
    const reader = new TraceReader(result.results[index]!.trace)
    const seen = new Set<number>()
    let deepest = 0
    for (let f = 0; f < reader.frameCount; f += 1) {
      const counts = resolve(reader, COUNTS, 'stack', f)
      if (!counts) continue
      deepest = Math.max(deepest, counts.values.length)
      for (const v of counts.values as number[]) seen.add(v)
    }
    expect(deepest).toBe(1)
    expect([...seen]).toEqual([10])
  })

  it('drains four levels of nesting on the deepest case', () => {
    const index = problem.cases.findIndex((c) => c.args[0] === '2[2[2[2[a]]]]')
    const reader = new TraceReader(result.results[index]!.trace)
    let deepest = 0
    for (let f = 0; f < reader.frameCount; f += 1) {
      const counts = resolve(reader, COUNTS, 'stack', f)
      if (counts) deepest = Math.max(deepest, counts.values.length)
    }
    expect(deepest).toBe(4)
    expect(result.results[index]!.returned).toBe('a'.repeat(16))
  })

  it('returns the depth to zero between siblings', () => {
    // `2[a]2[b]2[c]` is the case that proves the gauge is not merely monotonic: it has to come
    // all the way back down twice in the middle of the run, not only at the end.
    const index = problem.cases.findIndex((c) => c.args[0] === '2[a]2[b]2[c]')
    const reader = new TraceReader(result.results[index]!.trace)
    const heights: number[] = []
    for (let f = 0; f < reader.frameCount; f += 1) {
      const counts = resolve(reader, COUNTS, 'stack', f)
      if (counts) heights.push(counts.values.length)
    }
    // 0 -> 1 -> 0 -> 1 -> 0 -> 1 -> 0: three separate climbs.
    const transitions = heights.filter((h, i) => i > 0 && h !== heights[i - 1])
    expect(transitions).toEqual([1, 0, 1, 0, 1, 0])
  })
})
