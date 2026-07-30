import { describe, expect, it } from 'vitest'
import { executeRun } from '@algoviz/runner'
import { requireProblem } from '@algoviz/problems'
import { TraceReader, type StructureSnapshot } from '@algoviz/tracer'

type StringSnapshot = Extract<StructureSnapshot, { kind: 'string' }>

/**
 * A structure does not exist before its own `init` frame, so the first few frames legitimately
 * resolve to nothing. `maybeStringNamed` returns undefined there; `stringNamed` insists.
 */
function maybeStringNamed(reader: TraceReader, frame: number, name: string): StringSnapshot | undefined {
  const meta = reader.trace.structures.find((s) => s.name === name)
  if (!meta) throw new Error(`trace has no structure named "${name}"`)
  const snapshot = reader.at(frame).get(meta.id)
  if (!snapshot) return undefined
  if (snapshot.kind !== 'string') {
    throw new Error(`"${name}" is a ${snapshot.kind}, not a string, at frame ${frame}`)
  }
  return snapshot
}

function stringNamed(reader: TraceReader, frame: number, name: string): StringSnapshot {
  const snapshot = maybeStringNamed(reader, frame, name)
  if (!snapshot) throw new Error(`"${name}" has no snapshot at frame ${frame}`)
  return snapshot
}

function cursorIndex(snapshot: StringSnapshot, name: string): number | undefined {
  return snapshot.cursors.find((c) => c.name === name)?.index
}

/**
 * The merged string implied by having consumed `ci` characters of `word1` and `cj` of `word2`.
 *
 * Appends happen word1-then-word2 within an iteration, so the content is fully determined by
 * the two cursor positions. This is the invariant the animation has to keep: if the picture
 * ever shows a `merged` that does not match where the carets are, the trace is lying.
 */
function interleave(word1: string, word2: string, ci: number, cj: number): string {
  let out = ''
  for (let k = 0; k < Math.max(ci, cj); k += 1) {
    if (k < ci) out += word1[k]
    if (k < cj) out += word2[k]
  }
  return out
}

const problem = requireProblem('merge-strings-alternately')

describe('Merge Strings Alternately trace semantics', () => {
  const result = executeRun({ problem: 'merge-strings-alternately', useReference: true, caseIndex: 0 })
  const caseResult = result.results[0]!
  const reader = new TraceReader(caseResult.trace)

  it('returns the canonical example answer', () => {
    expect(caseResult.returned).toBe('apbqcr')
    expect(caseResult.passed).toBe(true)
  })

  it('shows both sources and the output being built', () => {
    // Three string panels, or the user cannot see the transfer that is the whole problem.
    expect(reader.trace.structures.map((s) => `${s.name}:${s.kind}`)).toEqual([
      'word1:string',
      'word2:string',
      'merged:string',
    ])
  })

  it('ends with a merged string as long as both inputs combined', () => {
    const merged = stringNamed(reader, reader.frameCount - 1, 'merged')
    expect(merged.value).toHaveLength('abc'.length + 'pqr'.length)
  })

  it('grows merged monotonically — a character is never un-appended', () => {
    let previous = ''
    let seen = 0
    for (let i = 0; i < reader.frameCount; i += 1) {
      const merged = maybeStringNamed(reader, i, 'merged')
      if (!merged) continue
      seen += 1
      expect(merged.value.startsWith(previous), `frame ${i}: "${merged.value}" is not an extension of "${previous}"`).toBe(true)
      previous = merged.value
    }
    // Guard against the loop vacuously passing because nothing ever resolved.
    expect(seen).toBeGreaterThan(reader.frameCount - 4)
  })

  it('keeps merged consistent with the caret positions at every narrated step', () => {
    // The frame-sequence check that a correct return value cannot fake: at each step frame,
    // `merged` must be exactly the interleave of the consumed prefixes of word1 and word2.
    const steps = reader.stepFrames()
    expect(steps.length).toBe(3)
    for (const frame of steps) {
      const i = cursorIndex(stringNamed(reader, frame, 'word1'), 'i')!
      const j = cursorIndex(stringNamed(reader, frame, 'word2'), 'j')!
      expect(stringNamed(reader, frame, 'merged').value, `frame ${frame}`).toBe(
        interleave('abc', 'pqr', i, j),
      )
    }
  })

  it('marks every consumed source character as visited', () => {
    const last = reader.frameCount - 1
    for (const name of ['word1', 'word2']) {
      const snapshot = stringNamed(reader, last, name)
      const visited = snapshot.marks.filter((m) => m.class === 'visited')
      expect(visited, `${name} left characters unmarked`).toHaveLength(3)
    }
  })

  it('leaves no transient highlight parked on the output at the end', () => {
    const merged = stringNamed(reader, reader.frameCount - 1, 'merged')
    expect(merged.marks.filter((m) => m.class === 'active')).toEqual([])
  })
})

describe('Merge Strings Alternately — every case', () => {
  const cases = problem.cases.map((testCase, index) => {
    const [word1, word2] = testCase.args as [string, string]
    const run = executeRun({ problem: problem.slug, useReference: true, caseIndex: index })
    return { testCase, word1, word2, caseResult: run.results[0]!, reader: new TraceReader(run.results[0]!.trace) }
  })

  it.each(cases)('$testCase.name — final output snapshot equals the returned value', ({ caseResult, reader }) => {
    const merged = stringNamed(reader, reader.frameCount - 1, 'merged')
    expect(merged.value).toBe(caseResult.returned)
    expect(merged.value).toBe(caseResult.expected)
  })

  it.each(cases)('$testCase.name — merged length is |word1| + |word2|', ({ word1, word2, reader }) => {
    const merged = stringNamed(reader, reader.frameCount - 1, 'merged')
    expect(merged.value).toHaveLength(word1.length + word2.length)
  })

  it.each(cases)('$testCase.name — each caret stays inside the string it indexes', ({ word1, word2, reader }) => {
    let checked = 0
    for (let frame = 0; frame < reader.frameCount; frame += 1) {
      const a = maybeStringNamed(reader, frame, 'word1')
      const b = maybeStringNamed(reader, frame, 'word2')

      // A caret may rest one past the last character it consumed, but never further, and
      // never past the end of a *different* string than the one it belongs to.
      const i = a && cursorIndex(a, 'i')
      if (a && i !== undefined) {
        expect(i, `frame ${frame}: i`).toBeGreaterThanOrEqual(0)
        expect(i, `frame ${frame}: i beyond word1`).toBeLessThanOrEqual(word1.length)
        checked += 1
      }
      const j = b && cursorIndex(b, 'j')
      if (b && j !== undefined) {
        expect(j, `frame ${frame}: j`).toBeGreaterThanOrEqual(0)
        expect(j, `frame ${frame}: j beyond word2`).toBeLessThanOrEqual(word2.length)
        checked += 1
      }

      // Attachment must be right too: j on word1 would render a caret over the wrong letters.
      if (a) expect(cursorIndex(a, 'j'), `frame ${frame}: j attached to word1`).toBeUndefined()
      if (b) expect(cursorIndex(b, 'i'), `frame ${frame}: i attached to word2`).toBeUndefined()
    }
    expect(checked).toBeGreaterThan(0)
  })

  it.each(cases)('$testCase.name — one narrated step per iteration, carets at min(k, len)', ({ word1, word2, reader }) => {
    const steps = reader.stepFrames()
    expect(steps).toHaveLength(Math.max(word1.length, word2.length))
    steps.forEach((frame, k) => {
      const iteration = k + 1
      expect(cursorIndex(stringNamed(reader, frame, 'word1'), 'i'), `frame ${frame}: i`).toBe(
        Math.min(iteration, word1.length),
      )
      expect(cursorIndex(stringNamed(reader, frame, 'word2'), 'j'), `frame ${frame}: j`).toBe(
        Math.min(iteration, word2.length),
      )
      expect(stringNamed(reader, frame, 'merged').value, `frame ${frame}: merged`).toBe(
        interleave(word1, word2, Math.min(iteration, word1.length), Math.min(iteration, word2.length)),
      )
    })
  })

  it.each(cases)('$testCase.name — frame count is linear in the input, not quadratic', ({ word1, word2, caseResult }) => {
    const n = word1.length + word2.length
    // Constant per character: read + append + mark + cursor move, plus one step per iteration
    // and three inits. Quadratic behaviour on the 100-vs-1 case would be ~10k frames.
    expect(caseResult.frameCount).toBeGreaterThan(0)
    expect(caseResult.frameCount).toBeLessThanOrEqual(6 * n + 10)
    expect(caseResult.truncated).toBeUndefined()
  })

  it('catches a plausible-but-wrong animation that still returns the right answer', () => {
    // Drains word1 completely, then word2, so the picture never shows an interleave — while
    // the returned value is computed correctly on the side. Passing tests would call this
    // solution correct; the frame sequence is what exposes it.
    const source = [
      'export default function mergeAlternately(word1: string, word2: string, viz: Viz): string {',
      "  const a = viz.string(word1, { name: 'word1' })",
      "  const b = viz.string(word2, { name: 'word2' })",
      "  const merged = viz.string('', { name: 'merged' })",
      '  for (let i = 0; i < a.length; i += 1) merged.append(a.charAt(i))',
      '  for (let j = 0; j < b.length; j += 1) merged.append(b.charAt(j))',
      "  let answer = ''",
      '  for (let k = 0; k < Math.max(word1.length, word2.length); k += 1) {',
      '    if (k < word1.length) answer += word1[k]',
      '    if (k < word2.length) answer += word2[k]',
      '  }',
      '  return answer',
      '}',
    ].join('\n')

    const run = executeRun({ problem: problem.slug, source, caseIndex: 0 })
    expect(run.diagnostics).toEqual([])
    const bad = run.results[0]!
    expect(bad.passed, 'the wrong-picture solution should still pass on value').toBe(true)

    const reader = new TraceReader(bad.trace)
    expect(stringNamed(reader, reader.frameCount - 1, 'merged').value).toBe('abcpqr')
    expect(stringNamed(reader, reader.frameCount - 1, 'merged').value).not.toBe(bad.returned)
    expect(reader.stepFrames()).toEqual([])
  })

  it('scales linearly across cases, measured rather than assumed', () => {
    // Frames-per-character must not *grow* with n. Comparing the spread across all cases would be
    // the wrong test: a fixed per-run cost (three structure inits, two cursor declarations) is
    // amortised over the input, so it inflates the ratio on the smallest cases and a constant
    // overhead would read as non-linearity. Quadratic growth shows up as the ratio rising, so
    // that is what to assert.
    const sized = cases
      .map(({ word1, word2, caseResult }) => ({
        n: word1.length + word2.length,
        perChar: caseResult.frameCount / (word1.length + word2.length),
      }))
      .sort((x, y) => x.n - y.n)
    const smallest = sized[0]!
    const largest = sized[sized.length - 1]!
    expect(largest.n).toBeGreaterThan(smallest.n * 10)
    expect(largest.perChar).toBeLessThanOrEqual(smallest.perChar)
    // And the ratio itself is bounded, so "flat" cannot mean "flat and enormous".
    expect(largest.perChar).toBeLessThan(6)
  })
})
