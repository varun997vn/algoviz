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
