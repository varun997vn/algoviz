import { describe, expect, it } from 'vitest'
import { executeRun } from '@algoviz/runner'
import { requireProblem } from '@algoviz/problems'
import { TraceReader, type StructureSnapshot, type Trace } from '@algoviz/tracer'

/**
 * LeetCode 215 — Kth Largest Element in an Array.
 *
 * The answer is one number, so nothing about the return value distinguishes a heap solution from
 * a sort. Every load-bearing assertion in this file is therefore about the *picture*:
 *
 *  - `expectCappedKLargestEveryStep` is the one that matters. At every narrated frame it recomputes
 *    the k largest values of the prefix the cursor has scanned and demands the heap hold exactly
 *    those — never more than k of them, and arranged so the root is the smallest. That is the
 *    entire claim this problem exists to make ("a min-heap of size k holds the k largest seen so
 *    far, so its root is the k-th largest"), asserted frame by frame rather than at the end.
 *  - `expectSiftIsAnimated` guards the other half. A heap whose sifts are atomic renders as a list
 *    that occasionally changes contents; the compares and swaps of both sifts have to be frames,
 *    including frames where the heap is *temporarily not a heap*, or the viewer never sees the
 *    invariant being restored.
 *
 * Two deliberately wrong solutions at the bottom prove those two checks have teeth: a full sort
 * that returns the right number while animating nothing heap-shaped, and a heap that swallows the
 * whole array before draining it — the right answer, real sifts, and the wrong invariant.
 */

const PROBLEM = 'kth-largest-element-in-an-array'
const NUMS = 'nums'
const HEAP = 'the k largest so far'
const PANEL = 'k-th largest so far'

function idOf(trace: Trace, name: string): string {
  const meta = trace.structures.find((s) => s.name === name)
  if (!meta) {
    throw new Error(
      `no structure named "${name}" — got ${trace.structures.map((s) => s.name).join(', ') || '(none)'}`,
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

/** Independent oracle: the k-th largest by sorting, which is what the heap must agree with. */
function kthLargestOf(values: readonly number[], k: number): number {
  return [...values].sort((a, b) => b - a)[k - 1] as number
}

function isMinHeap(values: readonly number[]): boolean {
  return values.every((v, i) => i === 0 || v >= (values[(i - 1) >> 1] as number))
}

/**
 * The invariant, at every frame the algorithm narrates.
 *
 * Three claims at once, and all three are visible in the picture:
 *  - the heap never holds more than k values (the cap is what makes it O(k) memory, and it is
 *    what separates this from "heapify everything and pop"),
 *  - it is a valid min-heap whenever the algorithm has finished a step, so the root really is the
 *    smallest thing being kept,
 *  - its contents are *exactly* the k largest values of the prefix scanned so far — read off the
 *    `i` cursor in the picture, compared against a sort of that same prefix.
 */
function expectCappedKLargestEveryStep(
  trace: Trace,
  nums: readonly number[],
  k: number,
  label: string,
): void {
  const reader = new TraceReader(trace)
  let checked = 0

  for (let i = 0; i < reader.frameCount; i += 1) {
    const heap = resolve(reader, HEAP, 'heap', i)
    if (!heap) continue
    const values = heap.values as number[]

    // The cap holds on *every* frame, mid-sift included: the algorithm pops before it pushes, so
    // the heap dips to k-1 and comes back, and never once overshoots.
    expect(
      values.length,
      `${label} frame ${i}: heap holds ${values.length} values, more than k=${k}`,
    ).toBeLessThanOrEqual(k)

    const frame = trace.frames[i]
    if (frame?.op !== 'step') continue

    const nums$ = resolve(reader, NUMS, 'array', i)
    if (!nums$) continue
    const cursor = nums$.cursors.find((c) => c.name === 'i')
    expect(cursor, `${label} frame ${i}: no "i" caret on nums`).toBeDefined()

    const scanned = nums.slice(0, Math.min((cursor as { index: number }).index + 1, nums.length))
    const wanted = [...scanned].sort((a, b) => b - a).slice(0, k)

    expect(
      isMinHeap(values),
      `${label} frame ${i}: heap is [${values.join(', ')}], which is not a min-heap — the root is not the smallest kept value`,
    ).toBe(true)
    expect(
      [...values].sort((a, b) => b - a),
      `${label} frame ${i}: heap holds [${values.join(', ')}] but the ${k} largest of nums[0..${scanned.length - 1}] are [${wanted.join(', ')}]`,
    ).toEqual(wanted)
    checked += 1
  }

  // An invariant that was never evaluated is not evidence.
  expect(checked, `${label}: no narrated frame carried both the heap and nums`).toBeGreaterThan(0)
}

/**
 * The sift has to be a process, not a jump.
 *
 * A heap whose `pop` relocated the last leaf and restored order in one frame would satisfy every
 * assertion above and still animate as a list: the viewer would see the contents change without
 * ever seeing *why* the new root is the smallest. So the trace must contain the comparisons and
 * swaps, and it must contain frames where the heap is momentarily **not** a valid heap — those
 * are precisely the frames in which the invariant is being restored.
 */
function expectSiftIsAnimated(trace: Trace, label: string): void {
  const heapId = idOf(trace, HEAP)
  const ops = trace.frames.filter((f) => f.structureId === heapId).map((f) => f.op)
  expect(ops.filter((o) => o === 'compare').length, `${label}: heap never compares`).toBeGreaterThan(0)
  expect(ops.filter((o) => o === 'swap').length, `${label}: heap never swaps`).toBeGreaterThan(0)

  const midSift = trace.frames.filter((f) => {
    const snap = f.snapshots[heapId]
    return snap?.kind === 'heap' && !isMinHeap(snap.values as number[])
  })
  expect(
    midSift.length,
    `${label}: the heap is never caught mid-sift, so the restoration of the heap property is invisible`,
  ).toBeGreaterThan(0)
}

describe('Kth Largest Element in an Array — reference trace semantics', () => {
  // Case 1 rather than 0: k=4 over nine values, so the heap is three levels deep and both sifts
  // have somewhere to travel. With k=2 every sift is a single comparison and the tree view is a
  // line, which is exactly the picture this problem exists to avoid.
  const result = executeRun({ problem: PROBLEM, useReference: true, caseIndex: 1 })
  const caseResult = result.results[0]!
  const trace = caseResult.trace
  const reader = new TraceReader(trace)
  const last = reader.frameCount - 1
  const nums = [3, 2, 3, 1, 2, 4, 5, 5, 6]
  const k = 4
  const returned = caseResult.returned as number

  it('returns the known answer', () => {
    expect(caseResult.passed).toBe(true)
    expect(returned).toBe(4)
  })

  it('animates exactly the declared structures', () => {
    expect(trace.structures.map((s) => `${s.name}:${s.kind}`)).toEqual([
      `${NUMS}:array`,
      `${HEAP}:heap`,
      `${PANEL}:array`,
    ])
  })

  it('keeps a capped min-heap of exactly the k largest values seen so far', () => {
    expectCappedKLargestEveryStep(trace, nums, k, 'example')
  })

  it('animates both sifts rather than teleporting the heap into shape', () => {
    expectSiftIsAnimated(trace, 'example')
  })

  it('drops the root the moment something bigger arrives', () => {
    // The eviction is the moment the whole animation exists for, and it is visible as the heap
    // momentarily standing at k-1: the root has left and its replacement has not arrived yet.
    // Every such dip must be immediately preceded by a full heap and followed by a full one.
    const heapId = idOf(trace, HEAP)
    const sizes: { frame: number; size: number }[] = []
    for (const frame of trace.frames) {
      const snap = frame.snapshots[heapId]
      if (snap?.kind === 'heap') sizes.push({ frame: frame.index, size: snap.values.length })
    }
    const dips = sizes.filter((s, idx) => idx > 0 && s.size === k - 1 && sizes[idx - 1]!.size === k)
    const popFrames = trace.frames.filter((f) => f.op === 'pop' && f.structureId === heapId)
    expect(dips.length, 'no frame shows the heap one short — the eviction is never on screen').toBe(
      popFrames.length,
    )
    expect(popFrames.length).toBeGreaterThan(0)
    // …and every one of them is a real eviction: the value that left was the old root.
    for (const pop of popFrames) {
      expect(pop.label, `frame ${pop.index}`).toMatch(/^pop -> /)
    }
  })

  it('ends with the root marked as the answer it returns', () => {
    const heap = resolve(reader, HEAP, 'heap', last)!
    expect(heap.values).toHaveLength(k)
    expect(heap.values[0]).toBe(returned)
    expect(heap.marks.filter((m) => m.class === 'result').map((m) => m.index)).toEqual([0])
    // Nothing moves after the mark is set, so slot 0 is the answer for good. (This comment used
    // to justify that by claiming `VizHeap` never moves marks when it swaps. That was true when
    // it was written and is not now — `IndexMarkStore.swap`/`move` carry a mark with its value,
    // and the heap tests assert it. The assertion below still holds; its old reason did not.)
    expect(reader.captionAt(last)).toMatch(/is the 4th largest/)
  })

  it('never shows a k-th largest the algorithm has not settled on', () => {
    // The payoff panel. `viz.array<number>(n)` would zero-fill it, so the cell for every element
    // before the k-th would assert "0" — a plausible-looking answer for an input containing
    // zeros. Seeded blank, every non-blank cell is a decided value, and this checks that each one
    // is the k-th largest of the prefix ending at that cell, on every frame it is visible.
    for (let i = 0; i < reader.frameCount; i += 1) {
      const panel = resolve(reader, PANEL, 'array', i)
      if (!panel) continue
      for (const [j, shown] of panel.values.entries()) {
        if (shown === null) continue
        expect(shown, `frame ${i}: panel[${j}] shows ${String(shown)}`).toBe(
          kthLargestOf(nums.slice(0, j + 1), k),
        )
      }
    }
    const final = resolve(reader, PANEL, 'array', last)!
    // Blank exactly where there is no k-th largest yet — the first k-1 elements — and nowhere else.
    expect(final.values.flatMap((v, j) => (v === null ? [j] : []))).toEqual([0, 1, 2])
    expect(final.values[nums.length - 1]).toBe(returned)
  })

  it('rules a value out only when it can never come back', () => {
    // `excluded` is a permanent verdict in this animation: the root only ever rises, so a value
    // that could not beat it then can never beat it later. Anything greater than the final answer
    // wearing that mark would be a lie on screen.
    const scan = resolve(reader, NUMS, 'array', last)!
    const excluded = scan.marks.filter((m) => m.class === 'excluded').map((m) => m.index)
    for (const index of excluded) {
      expect(nums[index]!, `nums[${index}] is excluded but beats the answer`).toBeLessThanOrEqual(
        returned,
      )
    }
    // And the mark, once set, is never taken back or moved.
    let seen = new Set<number>()
    for (let i = 0; i < reader.frameCount; i += 1) {
      const snap = resolve(reader, NUMS, 'array', i)
      if (!snap) continue
      const now = new Set(
        snap.marks.filter((m) => m.class === 'excluded' && !m.transient).map((m) => m.index),
      )
      for (const index of seen) {
        expect(now.has(index), `frame ${i}: nums[${index}] stopped being excluded`).toBe(true)
      }
      seen = now
    }
  })

  it('narrates every element and the conclusion', () => {
    const steps = reader.stepFrames()
    expect(steps).toHaveLength(nums.length + 1)
    const labels = steps.map((i) => trace.frames[i]!.label ?? '')
    // The three branches each get a voice; the reject branch is the one that is easy to leave
    // silent, because nothing on screen changes except a mark.
    expect(labels.filter((l) => /beats the weakest kept value/.test(l)).length).toBeGreaterThan(0)
    expect(labels.filter((l) => /only \d+ of 4 values so far/.test(l)).length).toBe(4)
    expect(labels[labels.length - 1]).toMatch(/the heap holds the 4 largest values/)
  })

  it('reports the running answer in the watch panel', () => {
    const watch = reader.watchAt(last)!
    expect(watch.kept).toBe(k)
    expect(watch.kth).toBe(returned)
    expect(watch.i).toBe(nums.length)
  })
})

describe('the heap checks have teeth', () => {
  const args = requireProblem(PROBLEM).cases[1]!.args
  const nums = args[0] as number[]
  const k = args[1] as number

  it('rejects a full sort that returns the right number', () => {
    // The obvious cheat, and the one the animation exists to rule out: correct answer, no heap,
    // nothing on screen that explains anything.
    const source = `
export default function findKthLargest(nums, k, viz) {
  const a = viz.array(nums, { name: 'nums' })
  const sorted = [...nums].sort((x, y) => y - x)
  for (let i = 0; i < k; i += 1) a.mark(i, 'result')
  return sorted[k - 1]
}
`
    const run = executeRun({ problem: PROBLEM, source, caseIndex: 1 })
    expect(run.diagnostics).toEqual([])
    expect(run.results[0]?.passed).toBe(true)
    expect(() =>
      expectCappedKLargestEveryStep(run.results[0]!.trace, nums, k, 'sorted'),
    ).toThrow(/no structure named "the k largest so far"/)
  })

  it('rejects a heap that swallows the whole array before draining it', () => {
    // Subtler, and the reason the cap is asserted on every frame rather than at the end: this one
    // builds a real heap, animates real sifts, and returns the right number — but its heap grows
    // to n, so at no point does the picture show "the k values still in the running".
    const source = `
export default function findKthLargest(nums, k, viz) {
  const a = viz.array(nums, { name: 'nums' })
  const top = viz.heap([], { name: 'the k largest so far' })
  for (let i = 0; i < a.length; i += 1) top.push(a.at(i))
  for (let i = 0; i < a.length - k; i += 1) top.pop()
  return top.peek()
}
`
    const run = executeRun({ problem: PROBLEM, source, caseIndex: 1 })
    expect(run.diagnostics).toEqual([])
    expect(run.results[0]?.passed).toBe(true)
    // It really is a heap animation — the sift check passes, which is what makes it dangerous.
    expectSiftIsAnimated(run.results[0]!.trace, 'whole-array heap')
    expect(() =>
      expectCappedKLargestEveryStep(run.results[0]!.trace, nums, k, 'whole-array heap'),
    ).toThrow(/more than k=4/)
  })
})

describe('Kth Largest Element in an Array — the invariant holds on every case', () => {
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
      const nums = testCase.args[0] as number[]
      const k = testCase.args[1] as number
      const returned = caseResult.returned as number

      expectCappedKLargestEveryStep(trace, nums, k, testCase.name)

      const last = reader.frameCount - 1
      const heap = resolve(reader, HEAP, 'heap', last)!
      const panel = resolve(reader, PANEL, 'array', last)!
      const scan = resolve(reader, NUMS, 'array', last)!

      // The picture agrees with the number: the root is the answer, and it is the only cell of
      // the heap wearing `result`.
      expect(heap.values).toHaveLength(Math.min(k, nums.length))
      expect(heap.values[0]).toBe(returned)
      expect(heap.marks.filter((m) => m.class === 'result').map((m) => m.index)).toEqual([0])

      // The running panel agrees with an independent sort at every cell it has filled in, and is
      // blank exactly for the elements before the k-th.
      for (const [j, shown] of panel.values.entries()) {
        if (j < k - 1) {
          expect(shown, `${testCase.name}: panel[${j}] should still be blank`).toBeNull()
          continue
        }
        expect(shown, `${testCase.name}: panel[${j}]`).toBe(kthLargestOf(nums.slice(0, j + 1), k))
      }
      expect(panel.values[nums.length - 1]).toBe(returned)

      // Excluded cells are the rejects, and no reject can beat the answer.
      for (const mark of scan.marks) {
        if (mark.class !== 'excluded') continue
        expect(nums[mark.index]!).toBeLessThanOrEqual(returned)
      }

      // One narrated frame per element, plus the conclusion.
      expect(reader.stepFrames()).toHaveLength(nums.length + 1)

      // O(n log k), not O(n log n) and certainly not O(n^2): the reference sits near 10 frames
      // per element on the 120-value case, and the cost per element is bounded by the depth of a
      // k-heap, not by n.
      expect(
        caseResult.frameCount,
        `${testCase.name}: ${caseResult.frameCount} frames for n=${nums.length}`,
      ).toBeLessThanOrEqual(nums.length * (8 + 4 * Math.ceil(Math.log2(k + 1))) + 40)
    })
  }

  it('fills the heap to exactly k and keeps it there on the large case', () => {
    // A heap that never reaches k would satisfy the cap vacuously; this is the other side of it.
    const index = problem.cases.findIndex((c) => c.tags?.includes('large'))
    const caseResult = result.results[index]!
    const reader = new TraceReader(caseResult.trace)
    const k = problem.cases[index]!.args[1] as number
    let deepest = 0
    for (let i = 0; i < reader.frameCount; i += 1) {
      const heap = resolve(reader, HEAP, 'heap', i)
      if (heap) deepest = Math.max(deepest, heap.values.length)
    }
    expect(deepest).toBe(k)
    expectSiftIsAnimated(caseResult.trace, 'large')
  })

  it('never evicts anything when k equals the length of the array', () => {
    // Everything is in the top k, so the heap only ever grows and the answer is the minimum.
    const index = problem.cases.findIndex((c) => c.name.startsWith('k = n'))
    const caseResult = result.results[index]!
    const heapId = idOf(caseResult.trace, HEAP)
    expect(
      caseResult.trace.frames.filter((f) => f.op === 'pop' && f.structureId === heapId),
    ).toEqual([])
    const scan = resolve(new TraceReader(caseResult.trace), NUMS, 'array', caseResult.frameCount - 1)!
    expect(scan.marks.filter((m) => m.class === 'excluded')).toEqual([])
  })

  it('rules out every duplicate that ties the answer but arrives too late', () => {
    // `all equal`: four 5s, k=3. The first three are kept; the fourth is not *bigger* than the
    // root, so it is excluded — ties take separate places, and the picture has to show that the
    // late one lost rather than quietly returning the right number.
    const index = problem.cases.findIndex((c) => c.name.startsWith('all equal'))
    const caseResult = result.results[index]!
    const reader = new TraceReader(caseResult.trace)
    const scan = resolve(reader, NUMS, 'array', reader.frameCount - 1)!
    expect(scan.marks.filter((m) => m.class === 'excluded').map((m) => m.index)).toEqual([3])
    const heap = resolve(reader, HEAP, 'heap', reader.frameCount - 1)!
    expect(heap.values).toEqual([5, 5, 5])
  })
})

describe('the starter teaches the same picture, not just the same answer', () => {
  // Three times in this repo's history a fix has landed in a reference solution and left the
  // starter prescribing the defect — and the starter is what a learner actually runs, so it is the
  // trace that matters most. This block fills the starter in from its own TODO comments and holds
  // the result to the same standard as the reference.
  const filled = `
export default function findKthLargest(nums: number[], k: number, viz: Viz): number {
  const a = viz.array(nums, { name: 'nums' })
  const top = viz.heap<number>([], { name: 'the k largest so far' })
  const kth = viz.array<number>(nums.length, { name: 'k-th largest so far', fill: null })
  const i = viz.cursor('i', 0, a)
  viz.watch(() => ({ i: i.value, kept: top.size, kth: top.size === k ? top.peek() : null }))

  for (i.value = 0; i.value < a.length; i.inc()) {
    const x = a[i.value]
    let outcome: string
    if (top.size < k) {
      top.push(x)
      outcome = 'keeping ' + x
    } else if (top.compareRoot(x) < 0) {
      const evicted = top.pop() as number
      top.push(x)
      outcome = x + ' beats ' + evicted
    } else {
      a.mark(i.value, 'excluded', 'not big enough')
      outcome = x + ' is not big enough'
    }
    if (top.size === k) kth[i.value] = top.peek() as number
    viz.step(outcome)
  }

  const answer = top.peek() as number
  top.mark(0, 'result', 'the answer')
  viz.step('the root is the answer')
  return answer
}
`

  it('is a transcription of the shipped starter, not a different program', () => {
    // Without this, the block below tests whatever the *test* happens to say. That is not
    // hypothetical: this file's `filled` snippet put the `kth` write above `viz.step` while the
    // shipped starter had it below, so "keeps the payoff panel level with the caption" passed
    // against a program no learner would ever have — and the starter reproduced, verbatim, the
    // 140-frame lag the reference had just been fixed for. An audit found it; CI could not.
    // The starter's own placeholders, which its TODOs explicitly say to replace. Everything else
    // is scaffolding the learner is told to leave alone, so a difference there is drift.
    const placeholders = ["viz.step('at ' + x)", 'return 0']
    const starter = requireProblem(PROBLEM).starter
    const scaffolding = starter
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 6 && !l.startsWith('//') && !l.startsWith('*'))
      .filter((l) => !placeholders.includes(l))
    const missing = scaffolding.filter((l) => !filled.includes(l))
    expect(missing, 'the filled solution has drifted from the starter it claims to fill in').toEqual(
      [],
    )
  })

  it('produces a passing, invariant-holding trace when followed literally', () => {
    const run = executeRun({ problem: PROBLEM, source: filled, caseIndex: 'all' })
    expect(run.diagnostics).toEqual([])
    expect(run.results.filter((r) => !r.passed)).toEqual([])
    const problem = requireProblem(PROBLEM)
    const args = problem.cases[1]!.args as [number[], number]
    expectCappedKLargestEveryStep(run.results[1]!.trace, args[0], args[1], 'filled starter')
    expectSiftIsAnimated(run.results[1]!.trace, 'filled starter')
  })

  it('lights the guard, which a silent peek() never did', () => {
    // The one decision this algorithm makes. Written `x > (top.peek() as number)` it was narrated
    // on every element and shown on none: the heap panel went grey while the caption asserted a
    // comparison the picture never made. The starter now names `compareRoot`, so this holds for a
    // learner's trace too, not only the reference.
    for (const source of [undefined, filled]) {
      const run = executeRun(
        source === undefined
          ? { problem: PROBLEM, useReference: true, caseIndex: 1 }
          : { problem: PROBLEM, source, caseIndex: 1 },
      )
      const trace = run.results[0]!.trace
      const heapId = idOf(trace, HEAP)
      const lit = trace.frames.filter((f) => {
        const snap = f.snapshots[heapId]
        return snap?.kind === 'heap' && snap.marks.some((m) => m.class === 'compare' && m.transient)
      })
      expect(lit.length, source === undefined ? 'reference' : 'filled starter').toBeGreaterThan(0)
    }
  })

  it('keeps the payoff panel level with the caption describing it', () => {
    // The `kth` write used to sit after `viz.step`, so it landed in its own unnarrated frame and
    // every single narrated frame showed the panel one element short of what its caption claimed.
    for (const source of [undefined, filled]) {
      const run = executeRun(
        source === undefined
          ? { problem: PROBLEM, useReference: true, caseIndex: 1 }
          : { problem: PROBLEM, source, caseIndex: 1 },
      )
      const trace = run.results[0]!.trace
      const reader = new TraceReader(trace)
      const k = 4
      for (const frame of reader.stepFrames()) {
        const heap = resolve(reader, HEAP, 'heap', frame)
        const panel = resolve(reader, PANEL, 'array', frame)
        const cursor = panel?.cursors ?? []
        if (!heap || !panel || heap.values.length < k) continue
        // The cell for the element the caption is about must already hold the root.
        const scan = resolve(reader, NUMS, 'array', frame)
        const at = scan?.cursors.find((c) => c.name === 'i')?.index ?? cursor.length
        if (at >= panel.values.length) continue
        expect(
          panel.values[at],
          `frame ${frame}: caption describes element ${at} but its cell is still blank`,
        ).not.toBeNull()
      }
    }
  })

  it('ends with the answer marked, so the final picture says which survivor it is', () => {
    const run = executeRun({ problem: PROBLEM, source: filled, caseIndex: 1 })
    const reader = new TraceReader(run.results[0]!.trace)
    const heap = resolve(reader, HEAP, 'heap', reader.frameCount - 1)!
    const marked = heap.marks.filter((m) => m.class === 'result')
    expect(marked).toHaveLength(1)
    expect(heap.values[marked[0]!.index]).toBe(run.results[0]!.returned)
  })
})
