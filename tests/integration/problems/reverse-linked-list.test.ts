import { describe, expect, it } from 'vitest'
import { executeRun } from '@algoviz/runner'
import { TraceReader, type StructureSnapshot } from '@algoviz/tracer'

type ListSnapshot = Extract<StructureSnapshot, { kind: 'list' }>

function listAt(reader: TraceReader, frame: number): ListSnapshot {
  const snap = [...reader.at(frame).values()].find((s): s is ListSnapshot => s.kind === 'list')
  if (!snap) throw new Error(`no list snapshot resolved at frame ${frame}`)
  return snap
}

/** Node ids reachable from `head`, following `next`. Cycle-safe, like the renderer. */
function chain(snap: ListSnapshot): string[] {
  const byId = new Map(snap.nodes.map((n) => [n.id, n]))
  const out: string[] = []
  const seen = new Set<string>()
  let cursor = snap.head
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor)
    const node = byId.get(cursor)
    if (!node) break
    out.push(node.id)
    cursor = node.next
  }
  return out
}

function values(snap: ListSnapshot): unknown[] {
  const byId = new Map(snap.nodes.map((n) => [n.id, n]))
  return chain(snap).map((id) => byId.get(id)?.value)
}

/** Nodes the snapshot carries that the head cannot reach — the renderer's second row. */
function detached(snap: ListSnapshot): string[] {
  const reachable = new Set(chain(snap))
  return snap.nodes.filter((n) => !reachable.has(n.id)).map((n) => n.id)
}

const INPUT = [1, 2, 3, 4, 5]

describe('Reverse Linked List trace semantics', () => {
  const result = executeRun({ problem: 'reverse-linked-list', useReference: true, caseIndex: 0 })
  const caseResult = result.results[0]!
  const reader = new TraceReader(caseResult.trace)
  const first = listAt(reader, 0)
  const final = listAt(reader, reader.frameCount - 1)

  it('returns the reversed array for the canonical example', () => {
    expect(caseResult.returned).toEqual([5, 4, 3, 2, 1])
    expect(caseResult.passed).toBe(true)
  })

  it('starts with the list in input order', () => {
    expect(values(first)).toEqual(INPUT)
    expect(detached(first)).toEqual([])
  })

  it('ends with the picture showing the reversed list, not just returning it', () => {
    // The answer and the animation have to agree: if the final snapshot still read 1..5 the
    // return value would be right while the visualization lied.
    expect(values(final)).toEqual([...INPUT].reverse())
  })

  it('loses no node — every original id survives to the final snapshot', () => {
    const before = first.nodes.map((n) => n.id).sort()
    const after = final.nodes.map((n) => n.id).sort()
    expect(after).toEqual(before)
    expect(after).toHaveLength(INPUT.length)
  })

  it('leaves nothing detached at the end — the whole list is reachable from head', () => {
    // A reversal that forgets to move `head` still returns the right array via a stashed
    // pointer, but leaves the picture in pieces. This is the assertion that catches it.
    expect(detached(final)).toEqual([])
    expect(chain(final)).toHaveLength(INPUT.length)
  })

  it('ends with head at the node that was the tail at the start', () => {
    const originalTail = chain(first).at(-1)
    expect(originalTail).toBeDefined()
    expect(final.head).toBe(originalTail)
  })

  it('shows a genuinely detached node mid-reversal', () => {
    // The instructive moment, and the ListViz code path nothing else in the repo drives:
    // between the rewire and the end of the run, the untouched suffix is unreachable from
    // head and must be drawn on the second row. If this ever became empty the animation
    // would be hiding the only frames that explain the algorithm.
    const framesWithDetached: number[] = []
    for (let i = 0; i < reader.frameCount; i += 1) {
      if (detached(listAt(reader, i)).length > 0) framesWithDetached.push(i)
    }
    expect(framesWithDetached.length).toBeGreaterThan(0)
    // Not a one-frame blip: it is the state for most of the run.
    expect(framesWithDetached.length).toBeGreaterThan(INPUT.length)
    // And it is strictly mid-run — never at the first or last frame.
    expect(framesWithDetached).not.toContain(0)
    expect(framesWithDetached).not.toContain(reader.frameCount - 1)
  })

  it('grows the reversed chain by exactly one node per narrated step', () => {
    // The frame sequence, not just the endpoints: each viz.step() must land after one more
    // link has been flipped, so the animation cannot skip or repeat work.
    const lengths = reader.stepFrames().map((i) => chain(listAt(reader, i)).length)
    expect(lengths).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps the reversed prefix and the detached suffix accounting for every node', () => {
    for (let i = 0; i < reader.frameCount; i += 1) {
      const snap = listAt(reader, i)
      expect(chain(snap).length + detached(snap).length, `frame ${i}`).toBe(INPUT.length)
    }
  })

  it('walks the cursors down the list — prev trails current, and both end correctly', () => {
    // Cursors only exist from the frame that declares them, so the run-in frames are skipped.
    const declared = (snap: ListSnapshot): boolean =>
      snap.cursors.some((c) => c.name === 'prev') && snap.cursors.some((c) => c.name === 'current')
    const cursorOf = (snap: ListSnapshot, name: string): string | null | undefined =>
      snap.cursors.find((c) => c.name === name)?.id

    const startFrame = [...Array(reader.frameCount).keys()].find((i) => declared(listAt(reader, i)))
    expect(startFrame).toBeDefined()
    const start = listAt(reader, startFrame!)
    expect(cursorOf(start, 'prev')).toBe(null)
    expect(cursorOf(start, 'current')).toBe(first.head)
    expect(cursorOf(final, 'prev')).toBe(final.head)
    expect(cursorOf(final, 'current')).toBe(null)

    // `current` only ever moves forward along the ORIGINAL order, and `prev` is the node it
    // just left — so the two labels must never pile up on the same node, not even for one
    // frame while the pair is being updated.
    const order = chain(first)
    let lastSeen = -1
    for (let i = startFrame!; i < reader.frameCount; i += 1) {
      const snap = listAt(reader, i)
      const current = cursorOf(snap, 'current')
      if (current !== null && current !== undefined) {
        expect(cursorOf(snap, 'prev'), `prev and current collide at frame ${i}`).not.toBe(current)
        const at = order.indexOf(current)
        expect(at, `current went backwards at frame ${i}`).toBeGreaterThanOrEqual(lastSeen)
        lastSeen = at
      }
    }
    // It reached the last node of the original list.
    expect(lastSeen).toBe(order.length - 1)
  })

  it('marks the new head as the result exactly once', () => {
    const resultMarks = final.marks.filter((m) => m.class === 'result')
    expect(resultMarks).toHaveLength(1)
    expect(resultMarks[0]?.id).toBe(final.head)
  })

  it('narrates every rewire and stays linear in n', () => {
    expect(reader.stepFrames()).toHaveLength(INPUT.length)
    expect(caseResult.frameCount).toBeLessThan(10 * INPUT.length)
  })

  it('animates the empty list without breaking, and a single node without rewiring', () => {
    const empty = executeRun({ problem: 'reverse-linked-list', useReference: true, caseIndex: 2 })
      .results[0]!
    expect(empty.returned).toEqual([])
    expect(empty.frameCount).toBeGreaterThan(0)
    const emptySnap = listAt(new TraceReader(empty.trace), empty.frameCount - 1)
    expect(emptySnap.nodes).toEqual([])
    expect(emptySnap.head).toBe(null)

    const single = executeRun({ problem: 'reverse-linked-list', useReference: true, caseIndex: 3 })
      .results[0]!
    const singleReader = new TraceReader(single.trace)
    expect(single.returned).toEqual([7])
    for (let i = 0; i < singleReader.frameCount; i += 1) {
      expect(detached(listAt(singleReader, i)), `frame ${i}`).toEqual([])
    }
  })
})

describe('the canvas agrees with the watch panel', () => {
  // The audit's highest-severity finding: cursor labels were one step stale on two frames in five,
  // and frame 24 drew `current` on a node while the panel beside it read `current=null` — the
  // picture claimed one more rewire was pending on an already-finished list. Both are on screen
  // simultaneously, so disagreement is not a nuance, it is the animation contradicting itself.
  it('never shows a caret position the watch panel disagrees with', () => {
    const result = executeRun({ problem: 'reverse-linked-list', useReference: true, caseIndex: 0 })
    const trace = result.results[0]!.trace
    const reader = new TraceReader(trace)
    const listId = trace.structures.find((s) => s.kind === 'list')!.id

    const disagreements: string[] = []
    for (let i = 0; i < reader.frameCount; i += 1) {
      const snap = reader.structureAt(listId, i)
      const watch = reader.watchAt(i)
      if (!snap || snap.kind !== 'list' || !watch) continue

      const valueOf = (id: string | null | undefined): string =>
        id ? String(snap.nodes.find((n) => n.id === id)?.value ?? 'null') : 'null'
      const caret = new Map(snap.cursors.map((c) => [c.name, c.id]))

      for (const name of ['prev', 'current', 'next']) {
        const onCanvas = valueOf(caret.get(name))
        const inPanel = String(watch[name])
        if (onCanvas !== inPanel) {
          disagreements.push(`frame ${i}: canvas ${name}=${onCanvas}, panel ${name}=${inPanel}`)
        }
      }
    }
    expect(disagreements).toEqual([])
  })

  it('shows all three references, including the stashed next', () => {
    // The problem's own hint calls the stash the crux; the animation used to show only two.
    const result = executeRun({ problem: 'reverse-linked-list', useReference: true, caseIndex: 0 })
    const reader = new TraceReader(result.results[0]!.trace)
    const mid = Math.floor(reader.frameCount / 2)
    expect(Object.keys(reader.watchAt(mid) ?? {}).sort()).toEqual(['current', 'next', 'prev'])
  })

  it('labels the stash on the canvas, on a frame where it is distinct from the others', () => {
    // Putting `next` in the watch panel was half a fix: by the time each iteration narrated
    // itself the stash had already been copied into `current`, so on every narrated frame of
    // every case the panel showed `next === current` — the crux rendered as a duplicate of
    // something else, and no node on the canvas ever labelled as the rest of the saved list.
    const result = executeRun({ problem: 'reverse-linked-list', useReference: true, caseIndex: 0 })
    const trace = result.results[0]!.trace
    const reader = new TraceReader(trace)
    const listId = trace.structures.find((s) => s.kind === 'list')!.id

    const framesShowingStash = new Set<number>()
    for (let i = 0; i < reader.frameCount; i += 1) {
      const snap = reader.structureAt(listId, i)
      if (snap?.kind !== 'list') continue
      const by = new Map(snap.cursors.map((c) => [c.name, c.id]))
      const stash = by.get('next')
      if (stash == null) continue
      framesShowingStash.add(i)
      // While it is on screen it is always a third node, never a relabelling of another caret.
      expect(stash, `frame ${i}: the stash duplicates another caret`).not.toBe(by.get('current'))
      expect(stash, `frame ${i}: the stash duplicates another caret`).not.toBe(by.get('prev'))
    }
    // Every rewire but the last has a stash to show, and it is on screen for that whole span.
    expect(framesShowingStash.size).toBeGreaterThanOrEqual(INPUT.length - 1)

    // And it is never left set once consumed, which is what made it a duplicate before.
    for (const i of reader.stepFrames()) {
      const snap = reader.structureAt(listId, i)
      if (snap?.kind !== 'list') continue
      const by = new Map(snap.cursors.map((c) => [c.name, c.id]))
      expect(by.get('next'), `frame ${i} still shows a consumed stash`).toBe(null)
    }
  })

  it('is what the starter tells a learner to write, not just what the reference does', () => {
    // The fix landed in the reference and the starter kept prescribing the defect: two
    // single-pointer `list.cursor()` calls and "assign list.head = prev". A solution following
    // that TODO literally still contradicted itself on 10 of its 29 frames — and on a product
    // whose premise is watching *your own* code run, the learner's trace is the artifact that
    // matters. This is the starter's guidance, transcribed, with the same check applied.
    const source = `
export default function reverseList(head: number[], viz: Viz): number[] {
  const list = viz.list(head, { name: 'list' })
  let current = list.head
  let prev: typeof current = null
  let next: typeof current = null
  list.setCursors({ prev, current, next })
  viz.watch(() => ({
    prev: prev ? prev.rawValue : 'null',
    current: current ? current.rawValue : 'null',
    next: next ? next.rawValue : 'null',
  }))

  while (current) {
    next = current.rawNext
    list.setCursors({ prev, current, next })
    current.next = prev
    list.head = current
    prev = current
    current = next
    next = null
    list.setCursors({ prev, current, next })
    viz.step('rewire one link')
  }

  return list.toArray()
}
`
    const run = executeRun({ problem: 'reverse-linked-list', source, caseIndex: 0 })
    expect(run.diagnostics).toEqual([])
    expect(run.results[0]?.passed).toBe(true)

    const trace = run.results[0]!.trace
    const reader = new TraceReader(trace)
    const listId = trace.structures.find((s) => s.kind === 'list')!.id
    const disagreements: string[] = []
    for (let i = 0; i < reader.frameCount; i += 1) {
      const snap = reader.structureAt(listId, i)
      const watch = reader.watchAt(i)
      if (snap?.kind !== 'list' || !watch) continue
      const caret = new Map(snap.cursors.map((c) => [c.name, c.id]))
      for (const name of ['prev', 'current', 'next']) {
        const id = caret.get(name)
        const onCanvas = id ? String(snap.nodes.find((n) => n.id === id)?.value ?? 'null') : 'null'
        if (onCanvas !== String(watch[name])) {
          disagreements.push(`frame ${i}: canvas ${name}=${onCanvas}, panel ${name}=${watch[name]}`)
        }
      }
    }
    expect(disagreements).toEqual([])
  })

  it('narrates the empty list instead of saying nothing at all', () => {
    const empty = executeRun({ problem: 'reverse-linked-list', useReference: true })
    const emptyCase = empty.results.find((r) => Array.isArray(r.expected) && r.expected.length === 0)
    expect(emptyCase).toBeDefined()
    const steps = new TraceReader(emptyCase!.trace).stepFrames()
    expect(steps.length).toBeGreaterThan(0)
  })
})
