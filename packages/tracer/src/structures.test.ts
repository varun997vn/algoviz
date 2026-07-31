import { describe, expect, it } from 'vitest'
import { TraceReader, trace } from './index.js'
import type { StructureSnapshot, Trace } from './types.js'

function finalOf<K extends StructureSnapshot['kind']>(
  t: Trace,
  id: string,
  kind: K,
): Extract<StructureSnapshot, { kind: K }> {
  const snap = new TraceReader(t).structureAt(id, t.frames.length - 1)
  if (!snap || snap.kind !== kind) throw new Error(`expected a ${kind} snapshot for ${id}`)
  return snap as Extract<StructureSnapshot, { kind: K }>
}

function labels(t: Trace): string[] {
  return t.frames.map((f) => f.label ?? '')
}

describe('VizStack', () => {
  it('records pushes and pops and reports emptiness', () => {
    const { value, trace: t } = trace((viz) => {
      const s = viz.stack<number>()
      s.push(1, 2)
      const popped = s.pop()
      return { popped, size: s.size, empty: s.isEmpty, top: s.top() }
    })
    expect(value).toEqual({ popped: 2, size: 1, empty: false, top: 1 })
    expect(finalOf(t, 'stk1', 'stack').values).toEqual([1])
    expect(labels(t)).toContain('push 1, 2')
    expect(labels(t)).toContain('pop -> 2')
  })

  it('peek records a frame but top() does not, so guards stay out of the timeline', () => {
    const { trace: t } = trace((viz) => {
      const s = viz.stack<number>([1])
      s.peek()
      s.top()
      return 0
    })
    expect(labels(t).filter((l) => l.startsWith('peek'))).toHaveLength(1)
    expect(labels(t).some((l) => l.startsWith('top'))).toBe(false)
  })

  it('is iterable and marks positions', () => {
    const { value, trace: t } = trace((viz) => {
      const s = viz.stack<number>([1, 2, 3])
      s.mark(1, 'result')
      return [...s]
    })
    expect(value).toEqual([1, 2, 3])
    expect(finalOf(t, 'stk1', 'stack').marks).toEqual([{ index: 1, class: 'result' }])
  })
})

describe('VizQueue', () => {
  it('records enqueue and dequeue ops distinctly from stack pushes', () => {
    // The op kind is what lets a BFS visualization label the frontier without being told.
    const { trace: t } = trace((viz) => {
      const q = viz.queue<number>()
      q.push(1, 2)
      q.shift()
      return q.toArray()
    })
    expect(t.frames.some((f) => f.op === 'enqueue')).toBe(true)
    expect(t.frames.some((f) => f.op === 'dequeue')).toBe(true)
    expect(finalOf(t, 'que1', 'queue').values).toEqual([2])
  })

  it('exposes front and back without recording', () => {
    const { value } = trace((viz) => {
      const q = viz.queue<number>([1, 2, 3])
      return { front: q.front(), back: q.back(), size: q.size, empty: q.isEmpty }
    })
    expect(value).toEqual({ front: 1, back: 3, size: 3, empty: false })
  })

  it('refuses deque operations on a plain queue with a message that says what to do', () => {
    expect(() =>
      trace((viz) => {
        const q = viz.queue<number>([1])
        q.pop()
        return 0
      }),
    ).toThrow(/pass \{ deque: true \}/)
  })

  it('supports both ends when created as a deque', () => {
    const { value, trace: t } = trace((viz) => {
      const d = viz.deque<number>([2])
      d.unshift(1)
      d.push(3)
      return { back: d.pop(), rest: d.toArray() }
    })
    expect(value).toEqual({ back: 3, rest: [1, 2] })
    expect(finalOf(t, 'que1', 'queue').deque).toBe(true)
  })
})

describe('VizHeap', () => {
  it('carries a mark with its value through a sift swap', () => {
    // Marks are keyed by slot and every sift moves values between slots, so a `result` mark put on
    // one value silently transferred to whatever landed in that slot next. A heap is where this
    // bites hardest and no problem had ever driven one.
    const { trace: t } = trace((viz) => {
      const h = viz.heap<number>([5])
      h.mark(0, 'result', 'the answer')
      h.push(1) // 1 sifts up past 5, so slot 0 changes hands
      return 0
    })
    const snap = finalOf(t, 'hp1', 'heap')
    expect(snap.values[0]).toBe(1)
    // The mark belongs to 5, which is now in slot 1 — not to whatever is sitting at the root.
    expect(snap.marks).toEqual([{ index: 1, class: 'result', note: 'the answer' }])
  })

  it('pops the departing root with its mark, and promotes the leaf with its own', () => {
    // This did both halves backwards: it deleted the mark on the leaf that was about to become the
    // root, and kept the root's, so the arriving value inherited a `result` belonging to the value
    // that had just left.
    const { value, trace: t } = trace((viz) => {
      const h = viz.heap<number>([1, 7])
      h.mark(0, 'result') // on 1, the root, which is about to leave
      h.mark(1, 'pinned') // on 7, the leaf, which is about to be promoted
      return h.pop()
    })
    expect(value).toBe(1)
    const snap = finalOf(t, 'hp1', 'heap')
    expect(snap.values).toEqual([7])
    expect(snap.marks).toEqual([{ index: 0, class: 'pinned' }])
  })

  it('compares against the root in one frame and returns the ordering', () => {
    const { value, trace: t } = trace((viz) => {
      const h = viz.heap<number>([4])
      return { bigger: h.compareRoot(9), smaller: h.compareRoot(1), equal: h.compareRoot(4) }
    })
    expect(value).toEqual({ bigger: -1, smaller: 1, equal: 0 })
    const frames = t.frames.filter((f) => f.op === 'compare')
    expect(frames).toHaveLength(3)
    for (const frame of frames) {
      const snap = frame.snapshots['hp1']
      expect(snap?.kind === 'heap' && snap.marks).toEqual([
        { index: 0, class: 'compare', transient: true },
      ])
    }
    expect(labels(t)).toContain('compare 9 with root 4')
  })

  it('returns -1 from compareRoot on an empty heap, where nothing is smaller', () => {
    const { value } = trace((viz) => viz.heap<number>().compareRoot(3))
    expect(value).toBe(-1)
  })

  it('retracts a mark, which it previously had no way to do', () => {
    const { trace: t } = trace((viz) => {
      const h = viz.heap<number>([1, 2])
      h.mark(0, 'result')
      h.unmark(0)
      h.mark(1, 'pinned')
      h.clearMarks('pinned')
      return 0
    })
    expect(finalOf(t, 'hp1', 'heap').marks).toEqual([])
  })

  it('maintains the min-heap invariant and records the sift comparisons', () => {
    const { value, trace: t } = trace((viz) => {
      const h = viz.heap<number>([5, 3, 8, 1])
      return { top: h.peek(), popped: h.pop(), size: h.size }
    })
    expect(value).toEqual({ top: 1, popped: 1, size: 3 })
    // Building the heap is setup, but the pop's sift-down must be visible.
    expect(t.frames.some((f) => f.op === 'compare')).toBe(true)
    expect(t.frames.some((f) => f.op === 'swap')).toBe(true)

    const heap = finalOf(t, 'hp1', 'heap')
    for (let i = 1; i < heap.values.length; i += 1) {
      const parent = heap.values[(i - 1) >> 1] as number
      expect(parent, `heap property at ${i}`).toBeLessThanOrEqual(heap.values[i] as number)
    }
  })

  it('honours a custom comparator and labels it', () => {
    const { value, trace: t } = trace((viz) => {
      const h = viz.heap<number>([1, 9, 5], {
        compare: (a, b) => b - a,
        comparatorLabel: 'max-heap',
      })
      return h.pop()
    })
    expect(value).toBe(9)
    expect(finalOf(t, 'hp1', 'heap').comparatorLabel).toBe('max-heap')
  })

  it('handles a pop on an empty heap without throwing', () => {
    const { value, trace: t } = trace((viz) => {
      const h = viz.heap<number>()
      return h.pop()
    })
    expect(value).toBeUndefined()
    expect(labels(t)).toContain('pop on empty heap')
  })

  it('defaults to min-heap when no comparator is given', () => {
    const { trace: t } = trace((viz) => {
      viz.heap<number>([2, 1])
      return 0
    })
    expect(finalOf(t, 'hp1', 'heap').comparatorLabel).toBe('min-heap')
  })
})

describe('VizMap and VizSet', () => {
  it('distinguishes an insert from an update', () => {
    const { trace: t } = trace((viz) => {
      const m = viz.map<string, number>()
      m.set('a', 1)
      m.set('a', 2)
      return m.get('a')
    })
    expect(labels(t)).toContain('insert "a" -> 1')
    expect(labels(t)).toContain('update "a" -> 2')
    expect(finalOf(t, 'map1', 'map').entries).toEqual([{ key: 'a', value: 2 }])
  })

  it('records misses so a failed lookup is visible', () => {
    const { value, trace: t } = trace((viz) => {
      const m = viz.map<string, number>([['a', 1]])
      return { hit: m.get('a'), miss: m.get('z'), has: m.has('a'), hasnt: m.has('z') }
    })
    expect(value).toEqual({ hit: 1, miss: undefined, has: true, hasnt: false })
    expect(labels(t)).toContain('get "z" -> miss')
    expect(labels(t)).toContain('has "z" -> false')
  })

  it('deletes, peeks without recording, and exposes keys, values and entries', () => {
    const { value, trace: t } = trace((viz) => {
      const m = viz.map<string, number>([
        ['a', 1],
        ['b', 2],
      ])
      const deleted = m.delete('a')
      m.mark('b', 'result')
      return {
        deleted,
        peek: m.peek('b'),
        keys: m.keys(),
        values: m.values(),
        entries: m.toEntries(),
        size: m.size,
        spread: [...m],
      }
    })
    expect(value).toEqual({
      deleted: true,
      peek: 2,
      keys: ['b'],
      values: [2],
      entries: [['b', 2]],
      size: 1,
      spread: [['b', 2]],
    })
    expect(finalOf(t, 'map1', 'map').marks).toEqual([{ key: 'b', class: 'result' }])
  })

  it('marks set membership as visited, and re-adding is not an insert', () => {
    const { value, trace: t } = trace((viz) => {
      const s = viz.set<number>()
      s.add(1)
      s.add(1)
      return { has: s.has(1), contains: s.contains(2), size: s.size, all: s.toArray(), spread: [...s] }
    })
    expect(value).toEqual({ has: true, contains: false, size: 1, all: [1], spread: [1] })
    expect(labels(t)).toContain('add 1 (already present)')
  })

  it('deletes from a set and marks members', () => {
    const { value, trace: t } = trace((viz) => {
      const s = viz.set<number>([1, 2])
      s.mark(2, 'result')
      return s.delete(1)
    })
    expect(value).toBe(true)
    expect(finalOf(t, 'set1', 'set').values).toEqual([2])
    // This test set a mark, deleted, and then asserted only `values` — which is why the marks not
    // following their elements stayed green forever. The mark on 2 must still be on 2, at its new
    // index 0; left at index 1 it points past the end of a one-element set and the renderer, which
    // filters marks by index, drops the answer on the floor.
    expect(finalOf(t, 'set1', 'set').marks).toEqual([{ index: 0, class: 'result' }])
  })

  it('drops the mark on the deleted member rather than sliding it onto its neighbour', () => {
    const { trace: t } = trace((viz) => {
      const s = viz.set<number>([1, 2, 3])
      s.mark(2, 'result')
      s.delete(2)
      return 0
    })
    expect(finalOf(t, 'set1', 'set').values).toEqual([1, 3])
    expect(finalOf(t, 'set1', 'set').marks).toEqual([])
  })

  it('says so when marking a value the set does not hold, instead of claiming it marked one', () => {
    const { trace: t } = trace((viz) => {
      const s = viz.set<number>([1])
      s.mark(99, 'excluded')
      return 0
    })
    expect(finalOf(t, 'set1', 'set').marks).toEqual([])
    expect(labels(t)).toContain('mark 99 as excluded (not in the set)')
  })

  it('lights an insertion at least as brightly as a lookup', () => {
    // `add` flashed `visited` — the dim "already processed" class — so inserting into a set, the
    // operation the panel exists to show, rendered fainter than merely looking something up.
    const { trace: t } = trace((viz) => {
      const s = viz.set<number>()
      s.add(1)
      return 0
    })
    const added = t.frames.find((f) => f.label === 'add 1')
    const snap = added?.snapshots['set1']
    expect(snap?.kind === 'set' && snap.marks).toEqual([{ index: 0, class: 'active', transient: true }])
  })

  it('keys non-string values stably', () => {
    const { value } = trace((viz) => {
      const s = viz.set<number>([1])
      const m = viz.map<boolean, string>([[true, 'yes']])
      return { hasNumber: s.contains(1), byBool: m.peek(true) }
    })
    expect(value).toEqual({ hasNumber: true, byBool: 'yes' })
  })
})

describe('VizMatrix', () => {
  it('reads, writes, bounds-checks and tracks a 2D cursor', () => {
    const { value, trace: t } = trace((viz) => {
      const g = viz.matrix([
        [1, 2],
        [3, 4],
      ])
      g.cursor('p', 1, 0)
      g.set(0, 1, 9)
      g.mark(1, 1, 'visited')
      return {
        read: g.get(0, 1),
        peek: g.peek(1, 1),
        rows: g.rows,
        cols: g.cols,
        inside: g.inBounds(1, 1),
        outside: g.inBounds(2, 0),
        all: g.toArray(),
      }
    })
    expect(value).toEqual({
      read: 9,
      peek: 4,
      rows: 2,
      cols: 2,
      inside: true,
      outside: false,
      all: [
        [1, 9],
        [3, 4],
      ],
    })
    const snap = finalOf(t, 'mtx1', 'matrix')
    expect(snap.cursors).toEqual([{ name: 'p', row: 1, col: 0, class: 'active' }])
    expect(snap.marks).toEqual([{ row: 1, col: 1, class: 'visited' }])
  })

  it('rejects a write outside the grid rather than growing it silently', () => {
    expect(() =>
      trace((viz) => {
        const g = viz.matrix([[1]])
        g.set(5, 0, 1)
        return 0
      }),
    ).toThrow(/out of bounds/)
  })

  it('clears marks', () => {
    const { trace: t } = trace((viz) => {
      const g = viz.matrix([[1]])
      g.mark(0, 0, 'visited')
      g.clearMarks()
      return 0
    })
    expect(finalOf(t, 'mtx1', 'matrix').marks).toEqual([])
  })
})

describe('VizDpTable', () => {
  it('fills a 1-D table and reports its values', () => {
    const { value, trace: t } = trace((viz) => {
      const dp = viz.dp1d(4, 0)
      dp.set(0, 1)
      dp.set(1, 2)
      return { at1: dp.get(1), peek: dp.peek(0), all: dp.toArray() }
    })
    expect(value).toEqual({ at1: 2, peek: 1, all: [1, 2, 0, 0] })
    const snap = finalOf(t, 'dp1', 'dp')
    expect(snap.dims).toBe(1)
    expect(snap.values).toEqual([1, 2, 0, 0])
  })

  it('fills a 2-D table with axis labels', () => {
    const { value, trace: t } = trace((viz) => {
      const dp = viz.dp2d(2, 3, 0, { axisLabels: ['i', 'j'] })
      dp.set(1, 2, 7)
      return { got: dp.get(1, 2), peek: dp.peek(0, 0), all: dp.toArray() }
    })
    expect(value).toEqual({ got: 7, peek: 0, all: [[0, 0, 0], [0, 0, 7]] })
    const snap = finalOf(t, 'dp1', 'dp')
    expect(snap.dims).toBe(2)
    expect(snap.axisLabels).toEqual(['i', 'j'])
  })

  it('marks the cells a recurrence read from, then releases them', () => {
    // Showing the dependency cells is what makes a DP table explain itself.
    const { trace: t } = trace((viz) => {
      const dp = viz.dp2d(2, 2, 0)
      dp.dependsOn([[0, 0], [0, 1]], 'max of left and up')
      return 0
    })
    const compare = t.frames.find((f) => f.op === 'compare')
    expect(compare?.label).toBe('max of left and up')
    const marked = compare?.snapshots['dp1']
    expect(marked?.kind === 'dp' && marked.marks).toHaveLength(2)
    // Released afterwards, so they don't accumulate across the whole fill.
    expect(finalOf(t, 'dp1', 'dp').marks).toEqual([])
  })

  it('does not destroy persistent marks on the cells a recurrence names', () => {
    // Regression: Mark2DStore keyed by cell alone, so dependsOn's class-blind delete wiped any
    // visited/result state on those cells. Same defect NodeMarkStore was written to avoid — a
    // correct algorithm produced an animation that showed nothing, every test still green.
    const { trace: t } = trace((viz) => {
      const dp = viz.dp1d(6, 0)
      dp.mark(0, 0, 'visited')
      dp.mark(0, 1, 'visited')
      dp.mark(0, 2, 'visited')
      dp.dependsOn([0, 1, 2], 'recurrence')
      return 0
    })
    const marks = finalOf(t, 'dp1', 'dp').marks
    expect(marks.filter((m) => m.class === 'visited')).toHaveLength(3)
  })

  it('lets two classes coexist on one cell, newest winning visually', () => {
    const { trace: t } = trace((viz) => {
      const dp = viz.dp1d(2, 0)
      dp.mark(0, 0, 'visited')
      dp.mark(0, 0, 'result')
      return 0
    })
    const marks = finalOf(t, 'dp1', 'dp').marks
    expect(marks.map((m) => m.class)).toEqual(['visited', 'result'])
  })

  it('removes only the named class from a cell', () => {
    const { trace: t } = trace((viz) => {
      const g = viz.matrix([[1, 2]])
      g.mark(0, 0, 'visited')
      g.mark(0, 0, 'path')
      g.unmarkClass(0, 0, 'path')
      return 0
    })
    expect(finalOf(t, 'mtx1', 'matrix').marks.map((m) => m.class)).toEqual(['visited'])
  })

  it('keeps a dependency highlight to exactly one frame, even across later narration', () => {
    // It used to be written to the persistent store, so it survived every carried-forward frame
    // until the table was next touched — stale arrows against captions that had moved on. And
    // because the terminal frame is re-snapshotted after the delete, `never-marked-at-end
    // compare` could not fail, so nothing caught it.
    const { trace: t } = trace((viz) => {
      const dp = viz.dp1d(6, 0)
      dp.set(3, 2)
      dp.dependsOn([0, 1, 2], 'T(3) = T(2)+T(1)+T(0)')
      viz.step('store it')
      viz.step('advance i')
      return 0
    })
    const reader = new TraceReader(t)
    const compareAt = t.frames.findIndex((f) => f.op === 'compare')
    const at = (i: number): number => {
      const snap = reader.structureAt('dp1', i)
      return snap && 'marks' in snap ? snap.marks.filter((m) => m.class === 'compare').length : 0
    }
    expect(at(compareAt)).toBe(3)
    expect(at(compareAt + 1)).toBe(0)
    expect(at(compareAt + 2)).toBe(0)
  })

  it('accepts plain indices for a 1-D table and pairs for a 2-D one', () => {
    const { trace: t } = trace((viz) => {
      const one = viz.dp1d(3, 0)
      const two = viz.dp2d(2, 2, 0)
      one.dependsOn([0, 1])
      two.dependsOn([[0, 0], [1, 1]])
      return 0
    })
    const compares = t.frames.filter((f) => f.op === 'compare')
    expect(compares).toHaveLength(2)
    const first = compares[0]?.snapshots['dp1']
    expect(first?.kind === 'dp' && first.marks.map((m) => [m.row, m.col])).toEqual([
      [0, 0],
      [0, 1],
    ])
  })

  it('rejects a write outside a 2-D table', () => {
    expect(() =>
      trace((viz) => {
        const dp = viz.dp2d(1, 1, 0)
        dp.set(5, 0, 1)
        return 0
      }),
    ).toThrow(/out of bounds/)
  })

  it('rejects a column outside a 2-D table, and a 2-D write given no value', () => {
    // Only the row was checked. The 1-D overload `set(i, value)` sits on the class regardless of
    // `dims`, so `dp.set(1, 7)` on a 2-D table typechecked and wrote `undefined` with no error
    // anywhere — and a bad column extended one row past the others into a ragged grid, which
    // `GridViz` silently truncates by taking its column count from row 0.
    expect(() =>
      trace((viz) => {
        const dp = viz.dp2d(2, 2, 0)
        dp.set(0, 5, 1)
        return 0
      }),
    ).toThrow(/column 5 out of bounds/)

    expect(() =>
      trace((viz) => {
        const dp = viz.dp2d<number>(2, 2, 0)
        ;(dp as unknown as { set: (i: number, v: number) => void }).set(1, 7)
        return 0
      }),
    ).toThrow(/is 2-D — use set\(row, col, value\)/)
  })

  it('leaves the 1-D form alone, which shares the same overload', () => {
    const { value } = trace((viz) => {
      const dp = viz.dp1d<number>(3, 0)
      dp.set(0, 5)
      dp.set(2, 9)
      return dp.toArray()
    })
    expect(value).toEqual([5, 0, 9])
  })

  it('rejects a 2-D write on a 1-D table, and an index outside it', () => {
    // The 2-D arm was guarded and the 1-D arm was not, which left the worse of the two mismatches
    // live. `dp.set(0, 1, 42)` typechecks against the class's own `set(i, j, value)` overload; the
    // 1-D branch ignored `third` and wrote the *column index* — `dp[0] = 1` — then captioned the
    // frame `dp[0] = 1`, so the picture and the caption corroborated each other and neither was
    // the value the solution passed. The 2-D mismatch at least wrote a visible `undefined`.
    expect(() =>
      trace((viz) => {
        const dp = viz.dp1d<number>(3, 0)
        ;(dp as unknown as { set: (i: number, j: number, v: number) => void }).set(0, 1, 42)
        return 0
      }),
    ).toThrow(/is 1-D — use set\(index, value\)/)

    // And no index bound at all, so a 1-D table could grow past its declared size: `set(9, 5)` on
    // a table of 3 produced `[null × 9, 5]` — the ragged shape the 2-D column check exists to stop.
    expect(() =>
      trace((viz) => {
        const dp = viz.dp1d<number>(3, 0)
        dp.set(9, 5)
        return 0
      }),
    ).toThrow(/index 9 out of bounds \(0\.\.2\)/)
  })

  it('marks arbitrary cells', () => {
    const { trace: t } = trace((viz) => {
      const dp = viz.dp1d(2, 0)
      dp.mark(0, 1, 'result')
      return 0
    })
    expect(finalOf(t, 'dp1', 'dp').marks).toEqual([{ row: 0, col: 1, class: 'result' }])
  })
})

describe('VizString', () => {
  it('reads, writes, appends, truncates and swaps characters', () => {
    const { value, trace: t } = trace((viz) => {
      const s = viz.string('abc')
      s.set(0, 'z')
      s.append('de')
      s.removeLast(1)
      s.swap(1, 2)
      s.mark([0, 1], 'result')
      return { char: s.charAt(0), peek: s.peek(1), length: s.length, text: s.toString() }
    })
    expect(value).toEqual({ char: 'z', peek: 'c', length: 4, text: 'zcbd' })
    expect(finalOf(t, 'str1', 'string').value).toBe('zcbd')
  })

  it('returns an empty string for an out-of-range read rather than undefined', () => {
    const { value } = trace((viz) => {
      const s = viz.string('a')
      return { off: s.charAt(9), peeked: s.peek(9) }
    })
    expect(value).toEqual({ off: '', peeked: '' })
  })

  it('clears marks', () => {
    const { trace: t } = trace((viz) => {
      const s = viz.string('ab')
      s.mark(0, 'active')
      s.clearMarks()
      return 0
    })
    expect(finalOf(t, 'str1', 'string').marks).toEqual([])
  })
})

describe('VizString.replace', () => {
  it('rewrites the whole string in one frame', () => {
    // Not every string problem builds left to right. Decode String rewrites its accumulator
    // wholesale at every `]` (`before + inner.repeat(times)`), and the only way to say that
    // otherwise is `removeLast(s.length)` then `append(...)` — two ops and a clear-by-length idiom
    // standing in for one assignment, in the line that is the algorithm.
    const { value, trace: t } = trace((viz) => {
      const s = viz.string('ab', { name: 's' })
      s.replace('xyzxyz')
      return s.toString()
    })
    expect(value).toBe('xyzxyz')

    const frames = t.frames.filter((f) => f.label?.startsWith('replace'))
    expect(frames).toHaveLength(1)
    expect(frames[0]?.label).toBe('replace -> "xyzxyz"')
    // The whole new string is lit for that one frame, and the highlight does not persist.
    const snap = frames[0]?.snapshots['str1']
    expect(snap?.kind === 'string' && snap.marks.filter((m) => m.transient).length).toBe(6)
    expect(finalOf(t, 'str1', 'string').marks).toEqual([])
  })

  it('handles replacing with the empty string', () => {
    const { value } = trace((viz) => {
      const s = viz.string('abc')
      s.replace('')
      return { text: s.toString(), length: s.length }
    })
    expect(value).toEqual({ text: '', length: 0 })
  })
})

describe('VizIntervals', () => {
  it('reads intervals, records comparisons and reorders after a sort', () => {
    const { value, trace: t } = trace((viz) => {
      const iv = viz.intervals([
        [5, 9],
        [1, 3],
      ])
      iv.compare(0, 1)
      iv.reorder([1, 0], 'sort by start')
      iv.mark(0, 'result')
      return { first: iv.at(0), read: iv.read(1), length: iv.length, all: iv.toArray() }
    })
    expect(value.first).toMatchObject({ start: 1, end: 3 })
    expect(value.read).toMatchObject({ start: 5, end: 9 })
    expect(value.length).toBe(2)
    expect(labels(t)).toContain('sort by start')
    expect(finalOf(t, 'ivl1', 'intervals').items.map((i) => i.start)).toEqual([1, 5])
  })

  it('refuses a reorder that is not a permutation, instead of silently losing bars', () => {
    // It used to `map` then `filter(x => x !== undefined)`, so a duplicate or out-of-range index
    // quietly *shrank* the timeline: three items in, two out, two of them sharing `id: "i0"` —
    // duplicate React keys and missing bars, with no error anywhere. Nothing in the repo calls
    // `reorder` yet, which is exactly why it survived.
    const bad = (order: number[]) => (): unknown =>
      trace((viz) => {
        const iv = viz.intervals([
          [1, 2],
          [3, 4],
          [5, 6],
        ])
        iv.reorder(order)
        return iv.toArray()
      })
    expect(bad([0, 0, 2])).toThrow(/needs a permutation of 0\.\.2/)
    expect(bad([0, 1, 9])).toThrow(/needs a permutation of 0\.\.2/)
    expect(bad([0, 1])).toThrow(/needs a permutation of 0\.\.2/)

    // A real permutation still works, and still clears marks — which the docstring now says.
    const { value, trace: t } = trace((viz) => {
      const iv = viz.intervals([
        [1, 2],
        [3, 4],
        [5, 6],
      ])
      iv.mark(0, 'result')
      iv.reorder([2, 0, 1])
      return iv.toArray().map((i) => i.start)
    })
    expect(value).toEqual([5, 1, 3])
    expect(finalOf(t, 'ivl1', 'intervals').marks).toEqual([])
  })

  it('reports an out-of-range read instead of failing', () => {
    const { value, trace: t } = trace((viz) => {
      const iv = viz.intervals([[0, 1]])
      return iv.read(9)
    })
    expect(value).toBeUndefined()
    expect(labels(t)).toContain('read [9] (out of range)')
  })
})

describe('VizTrie', () => {
  it('inserts words and finds them', () => {
    const { value, trace: t } = trace((viz) => {
      const tr = viz.trie(['cat', 'car'])
      return {
        cat: tr.search('cat'),
        ca: tr.search('ca'),
        prefix: tr.startsWith('ca'),
        missing: tr.startsWith('dog'),
        under: tr.wordsUnder(tr.root),
      }
    })
    expect(value).toEqual({
      cat: true,
      ca: false,
      prefix: true,
      missing: false,
      under: ['car', 'cat'],
    })
    const snap = finalOf(t, 'tri1', 'trie')
    expect(snap.nodes.filter((n) => n.terminal)).toHaveLength(2)
  })

  it('records the walk down a branch and stops at a missing edge', () => {
    const { value, trace: t } = trace((viz) => {
      const tr = viz.trie(['ab'])
      return { found: tr.walk('ab'), missing: tr.walk('az') }
    })
    expect(value.found).toBeTruthy()
    expect(value.missing).toBeNull()
    expect(labels(t)).toContain("no branch for 'z'")
  })

  it('limits suggestions and marks nodes', () => {
    const { value, trace: t } = trace((viz) => {
      const tr = viz.trie(['a', 'ab', 'abc'])
      tr.mark(tr.root, 'active')
      tr.clearMarks()
      return { limited: tr.wordsUnder(tr.root, 2), unknown: tr.wordsUnder('nope') }
    })
    expect(value.limited).toHaveLength(2)
    expect(value.unknown).toEqual([])
    expect(finalOf(t, 'tri1', 'trie').marks).toEqual([])
  })
})

describe('VizTrie backtracking', () => {
  it('takes a node off the live branch while leaving its conclusions alone', () => {
    // `child`/`addChild` set a persistent `path` mark on the way down and the class had no way to
    // remove one: no `unmark`, no `removeClass`, no `exitPath`. So the first problem to backtrack
    // on a trie kept its own array of the live branch and re-lit it after a global
    // `clearMarks('path')` — `1 + depth` frames per un-choose instead of one.
    const { trace: t } = trace((viz) => {
      const tr = viz.trie()
      const a = tr.addChild(tr.root, 'a')
      const b = tr.addChild(a, 'b')
      tr.setTerminal(b, 'ab') // a conclusion about b, set while we are down here
      tr.exitPath(b)
      return 0
    })

    const snap = finalOf(t, 'tri1', 'trie')
    const on = (id: string, cls: string): boolean =>
      snap.marks.some((m) => m.id === id && m.class === cls)
    // `b` leaves the branch...
    expect(on('p3', 'path')).toBe(false)
    // ...`a` is still on it, and `b`'s terminal flag — the conclusion — survives.
    expect(on('p2', 'path')).toBe(true)
    expect(snap.nodes.find((n) => n.id === 'p3')?.terminal).toBe(true)
    expect(labels(t)).toContain("unchoose 'b'")
  })

  it('unwinds through onPath even when the body throws', () => {
    const { trace: t } = trace((viz) => {
      const tr = viz.trie()
      const a = tr.addChild(tr.root, 'a')
      try {
        tr.onPath(a, () => {
          throw new Error('boom')
        })
      } catch {
        /* swallowed — the branch must still unwind */
      }
      return 0
    })
    expect(finalOf(t, 'tri1', 'trie').marks.filter((m) => m.class === 'path')).toEqual([])
  })
})

describe('VizList', () => {
  it('records traversal through the next accessor', () => {
    const { value, trace: t } = trace((viz) => {
      const l = viz.list([1, 2, 3], { name: 'list' })
      let node = l.head
      const seen: number[] = []
      while (node) {
        seen.push(node.val)
        node = node.next
      }
      return seen
    })
    expect(value).toEqual([1, 2, 3])
    // Reading .val and following .next both show up, so a traversal animates itself.
    expect(t.frames.some((f) => f.op === 'read')).toBe(true)
    expect(t.frames.some((f) => f.op === 'visit')).toBe(true)
    expect(finalOf(t, 'lst1', 'list').nodes).toHaveLength(3)
  })

  it('animates a reversal, including the detached node mid-flight', () => {
    const { value, trace: t } = trace((viz) => {
      const l = viz.list([1, 2, 3])
      let prev: ReturnType<typeof l.createNode> | null = null
      let current = l.head
      while (current) {
        const next = current.rawNext
        current.next = prev
        prev = current
        current = next
      }
      l.head = prev
      return l.toArray()
    })
    expect(value).toEqual([3, 2, 1])
    expect(finalOf(t, 'lst1', 'list').head).toBeTruthy()
    expect(t.frames.some((f) => f.label?.includes('.next ->'))).toBe(true)
  })

  it('snapshots a cycle instead of hanging', () => {
    // The most common way a linked-list solution goes wrong; the renderer must survive it.
    const { value, trace: t } = trace((viz) => {
      const l = viz.list([1, 2, 3])
      const first = l.head
      const second = first?.rawNext
      const third = second?.rawNext
      if (third && second) third.next = second
      return l.toArray()
    })
    expect(value).toEqual([1, 2, 3])
    expect(finalOf(t, 'lst1', 'list').nodes).toHaveLength(3)
  })

  it('tracks named cursors and marks nodes', () => {
    const { trace: t } = trace((viz) => {
      const l = viz.list([1, 2])
      const head = l.head
      l.cursor('slow', head)
      if (head) l.mark(head, 'active')
      return 0
    })
    const snap = finalOf(t, 'lst1', 'list')
    expect(snap.cursors[0]?.name).toBe('slow')
    expect(snap.marks).toHaveLength(1)
  })

  it('moves several cursors as one frame, so no frame catches them half-updated', () => {
    // Its whole reason to exist. One cursor per frame forces an order, and every order leaves a
    // frame where one caret has moved and the other has not — on a list reversal that was two
    // frames in five showing a stale pointer, contradicting the watch panel beside it. It also
    // creates an instant where two pointers look collided when they never were.
    const { trace: t } = trace((viz) => {
      const l = viz.list([1, 2, 3])
      const first = l.head
      const second = first?.rawNext ?? null
      const third = second?.rawNext ?? null
      l.setCursors({ prev: first, current: second })
      l.setCursors({ prev: second, current: third })
      return 0
    })

    const ids = new TraceReader(t)
    const pairs: string[] = []
    for (let i = 0; i < ids.frameCount; i += 1) {
      const snap = ids.structureAt('lst1', i)
      if (snap?.kind !== 'list') continue
      const by = new Map(snap.cursors.map((c) => [c.name, c.id]))
      if (by.has('prev') && by.has('current')) {
        pairs.push(`${String(by.get('prev'))}/${String(by.get('current'))}`)
      }
      // Never both on the same node, not even for the frame in between.
      if (by.get('prev') !== undefined) expect(by.get('prev')).not.toBe(by.get('current'))
    }
    // Two distinct pairs, and nothing in between: n1/n2 then n2/n3, never n2/n2 or n1/n3.
    expect([...new Set(pairs)]).toEqual(['n1/n2', 'n2/n3'])
    // One frame per batch, not one per pointer.
    expect(t.frames.filter((f) => f.op === 'cursor')).toHaveLength(2)
    expect(labels(t)).toContain('prev -> n2, current -> n3')
  })

  it('supports a doubly-linked list', () => {
    const { trace: t } = trace((viz) => {
      viz.list([1, 2], { doubly: true })
      return 0
    })
    const snap = finalOf(t, 'lst1', 'list')
    expect(snap.doubly).toBe(true)
    expect(snap.nodes[1]?.prev).toBe(snap.nodes[0]?.id)
  })

  it('records a value write through the val setter', () => {
    const { value, trace: t } = trace((viz) => {
      const l = viz.list([1])
      const head = l.head
      if (head) head.val = 9
      return l.toArray()
    })
    expect(value).toEqual([9])
    expect(labels(t).some((l) => l.includes('.val = 9'))).toBe(true)
  })
})

describe('VizTree', () => {
  it('builds from level-order form, including gaps', () => {
    const { value, trace: t } = trace((viz) => {
      const tr = viz.tree([3, 9, 20, null, null, 15, 7])
      return { size: tr.size, order: tr.toLevelOrder() }
    })
    expect(value).toEqual({ size: 5, order: [3, 9, 20, 15, 7] })
    expect(finalOf(t, 'tree1', 'tree').nodes).toHaveLength(5)
  })

  it('builds from a node object graph', () => {
    const { value } = trace((viz) => {
      const tr = viz.tree({ val: 1, left: { val: 2 }, right: { val: 3 } })
      return tr.toLevelOrder()
    })
    expect(value).toEqual([1, 2, 3])
  })

  it('treats an empty or null-rooted input as an empty tree', () => {
    const { value } = trace((viz) => {
      const a = viz.tree([])
      const b = viz.tree(null)
      const c = viz.tree([null])
      return [a.root, b.root, c.root, a.toLevelOrder()]
    })
    expect(value).toEqual([null, null, null, []])
  })

  it('lights the traversed edge for exactly the frame that walks it', () => {
    // This asserted the edge marks were still there at the end, which is what the defect looked
    // like: `left`/`right` wrote `active` into the *persistent* edge store, so a traversal left
    // every edge it had ever walked permanently lit. On the first real tree BFS that was the whole
    // tree, all of it claiming to be under consideration on the final frame — invariant 3, broken
    // by the tree's headline API, because until now nothing had called it.
    const { trace: t } = trace((viz) => {
      const tr = viz.tree([1, 2, 3])
      const root = tr.root as string
      tr.left(root)
      tr.right(root)
      return 0
    })

    const reader = new TraceReader(t)
    const walk = t.frames.filter((f) => f.label?.includes('.left') || f.label?.includes('.right'))
    expect(walk).toHaveLength(2)

    // Lit on its own frame...
    for (const frame of walk) {
      const snap = frame.snapshots['tree1']
      expect(snap?.kind === 'tree' && snap.edgeMarks.filter((e) => e.class === 'active')).toHaveLength(1)
    }
    // ...and gone from every frame that merely carries the structure forward.
    const final = finalOf(t, 'tree1', 'tree')
    expect(final.edgeMarks.filter((e) => e.class === 'active')).toEqual([])
    const carried = reader.structureAt('tree1', t.frames.length - 1)
    expect(carried?.kind === 'tree' && carried.edgeMarks).toEqual([])
  })

  it('names what a step found, and lights the child rather than the parent', () => {
    // A step onto a missing child used to emit a frame captioned `4.left` in which nothing
    // observably happened — indistinguishable from a productive one.
    const { trace: t } = trace((viz) => {
      const tr = viz.tree([1, 2])
      const root = tr.root as string
      tr.left(root)
      tr.right(root)
      return 0
    })
    expect(labels(t)).toContain('1.left -> 2')
    expect(labels(t)).toContain('1.right -> none')

    const found = t.frames.find((f) => f.label === '1.left -> 2')
    const snap = found?.snapshots['tree1']
    // The interesting node is the one just arrived at, matching `VizGraph.neighbors`.
    expect(snap?.kind === 'tree' && snap.marks.filter((m) => m.class === 'active').map((m) => m.id))
      .toEqual(['t2'])
  })

  it('drops one class of mark from a node without touching its others', () => {
    const { trace: t } = trace((viz) => {
      const tr = viz.tree([1])
      const root = tr.root as string
      tr.mark(root, 'frontier')
      tr.mark(root, 'result')
      tr.unmarkClass(root, 'frontier')
      return 0
    })
    expect(finalOf(t, 'tree1', 'tree').marks.map((m) => m.class)).toEqual(['result'])
    expect(labels(t)).toContain('unmark frontier on 1')
  })

  it('unwinds a path mark while keeping a result mark set beneath it', () => {
    // The exact bug this API exists to prevent: exitPath must not wipe conclusions.
    const { trace: t } = trace((viz) => {
      const tr = viz.tree([1])
      const root = tr.root as string
      tr.onPath(root, () => {
        tr.mark(root, 'result')
      })
      return 0
    })
    const marks = finalOf(t, 'tree1', 'tree').marks
    expect(marks.map((m) => m.class)).toEqual(['result'])
  })

  it('removes the path mark even when the body throws', () => {
    const { trace: t } = trace((viz) => {
      const tr = viz.tree([1])
      const root = tr.root as string
      try {
        tr.onPath(root, () => {
          throw new Error('boom')
        })
      } catch {
        /* expected */
      }
      return 0
    })
    expect(finalOf(t, 'tree1', 'tree').marks).toEqual([])
  })

  it('exposes children without recording, and values with recording', () => {
    const { value, trace: t } = trace((viz) => {
      const tr = viz.tree([1, 2, 3])
      const root = tr.root as string
      const quiet = tr.childrenOf(root)
      return { value: tr.value(root), peek: tr.peek(root), hasBoth: quiet.left !== null && quiet.right !== null }
    })
    expect(value).toEqual({ value: 1, peek: 1, hasBoth: true })
    expect(labels(t)).toContain('read 1')
  })

  it('unmarks and clears', () => {
    const { trace: t } = trace((viz) => {
      const tr = viz.tree([1])
      const root = tr.root as string
      tr.mark(root, 'visited')
      tr.unmark(root)
      tr.mark(root, 'result')
      tr.clearMarks()
      return 0
    })
    expect(finalOf(t, 'tree1', 'tree').marks).toEqual([])
  })

  it('rejects an unknown node id loudly', () => {
    expect(() =>
      trace((viz) => {
        const tr = viz.tree([1])
        tr.value('nope')
        return 0
      }),
    ).toThrow(/Unknown tree node/)
  })
})

describe('VizGraph', () => {
  it('builds from n plus an edge list and yields neighbours', () => {
    const { value, trace: t } = trace((viz) => {
      const g = viz.graph({ n: 3, edges: [[0, 1], [1, 2]] })
      return { size: g.size, nodes: g.nodes, of0: [...g.neighbors(0)], quiet: g.neighborsOf(1) }
    })
    expect(value.size).toBe(3)
    expect(value.nodes).toEqual(['0', '1', '2'])
    expect(value.of0).toEqual(['1'])
    expect(value.quiet.sort()).toEqual(['0', '2'])
    expect(finalOf(t, 'gph1', 'graph').edges).toHaveLength(2)
  })

  it('builds from an adjacency list', () => {
    const { value } = trace((viz) => {
      const g = viz.graph({ adjacency: [[1], [0, 2], [1]] })
      return { size: g.size, degree: g.degree(1) }
    })
    expect(value.size).toBe(3)
    expect(value.degree).toBeGreaterThanOrEqual(2)
  })

  it('carries edge weights', () => {
    const { value, trace: t } = trace((viz) => {
      const g = viz.graph({ weighted: true, edges: [[0, 1, 7]] })
      return g.weightOf(0, 1)
    })
    expect(value).toBe(7)
    expect(finalOf(t, 'gph1', 'graph').edges[0]?.weight).toBe(7)
  })

  it('records edge state in both directions for an undirected graph', () => {
    // A decision recorded as `b -> a` must light up the edge stored as `a -> b` — and must be
    // *labelled* `a -> b` too. Only the lookup key was normalised, so the mark kept the caller's
    // endpoints; every renderer matches marks to drawn edges by endpoint, so an undirected walk
    // taken the undeclared way produced a mark that matched no edge and drew nothing.
    const { trace: t } = trace((viz) => {
      const g = viz.graph({ n: 2, edges: [[0, 1]] })
      g.edge(1, 0, 'tree')
      return 0
    })
    expect(finalOf(t, 'gph1', 'graph').edgeMarks).toEqual([{ from: '0', to: '1', class: 'tree' }])
  })

  it('keeps two decisions about a directed pair apart instead of losing one', () => {
    // `a -> b` and `b -> a` are two different edges on a directed graph, and Evaluate Division
    // declares every equation as exactly that pair. Normalising the key without normalising the
    // endpoints collapsed both decisions into one mark, keyed `a->b` and labelled `b->a` — so the
    // first decision was destroyed and the survivor matched no drawn edge. Two decisions in,
    // nothing on screen.
    const { trace: t } = trace((viz) => {
      const g = viz.graph({ directed: true, edges: [['a', 'b'], ['b', 'a']] })
      g.edge('a', 'b', 'tree')
      g.edge('b', 'a', 'rejected')
      return 0
    })
    expect(finalOf(t, 'gph1', 'graph').edgeMarks).toEqual([
      { from: 'a', to: 'b', class: 'tree' },
      { from: 'b', to: 'a', class: 'rejected' },
    ])
  })

  it('refuses a decision about an edge that does not exist', () => {
    // The other half of the same hole: on a directed graph with only `a -> b` declared, marking
    // `b -> a` used to succeed and silently overwrite the `a -> b` decision. A traversal that
    // decides something about an edge it does not have is a bug in the traversal.
    expect(() =>
      trace((viz) => {
        const g = viz.graph({ name: 'g', directed: true, edges: [['a', 'b']] })
        g.edge('b', 'a', 'rejected')
        return 0
      }),
    ).toThrow(/g has no directed edge b -> a/)
  })

  it('clears one edge state without touching the others', () => {
    // `clearEdges(state)` shipped with no caller and no test; only the no-arg form is exercised
    // by a problem.
    const { trace: t } = trace((viz) => {
      const g = viz.graph({ n: 4, edges: [[0, 1], [1, 2], [2, 3]] })
      g.edge(0, 1, 'tree')
      g.edge(1, 2, 'rejected')
      g.edge(2, 3, 'tree')
      g.clearEdges('tree')
      return 0
    })
    expect(finalOf(t, 'gph1', 'graph').edgeMarks).toEqual([
      { from: '1', to: '2', class: 'rejected' },
    ])
  })

  it('yields the weight of the edge it just lit', () => {
    // `weightedNeighbors` exists because `neighbors` destructures `{ to }` from an entry holding
    // `{ to, weight }`, forcing `weightOf(at, next) ?? 1` — a fallback for an edge that provably
    // exists — into the line that is the arithmetic of a step.
    const { value, trace: t } = trace((viz) => {
      const g = viz.graph({ weighted: true, directed: true, edges: [['a', 'b', 2], ['a', 'c', 5]] })
      return [...g.weightedNeighbors('a')]
    })
    expect(value).toEqual([
      { to: 'b', weight: 2 },
      { to: 'c', weight: 5 },
    ])
    // Each one lights its edge for exactly the frame that yielded it.
    const lit = t.frames.filter((f) => f.label?.startsWith('consider a ->'))
    expect(lit.map((f) => f.label)).toEqual(['consider a -> b', 'consider a -> c'])
  })

  it('marks visited nodes and clears marks', () => {
    const { trace: t } = trace((viz) => {
      const g = viz.graph({ n: 2 })
      g.visit(0)
      g.mark(1, 'frontier')
      g.unmark(1)
      return 0
    })
    const snap = finalOf(t, 'gph1', 'graph')
    expect(snap.marks.map((m) => m.class)).toEqual(['visited'])
  })

  it('accepts string node ids', () => {
    const { value } = trace((viz) => {
      const g = viz.graph({ edges: [['a', 'b']] })
      return { nodes: g.nodes, neighbours: g.neighborsOf('a') }
    })
    expect(value).toEqual({ nodes: ['a', 'b'], neighbours: ['b'] })
  })

  it('clears a whole mark class', () => {
    const { trace: t } = trace((viz) => {
      const g = viz.graph({ n: 2 })
      g.visit(0)
      g.visit(1)
      g.clearMarks('visited')
      return 0
    })
    expect(finalOf(t, 'gph1', 'graph').marks).toEqual([])
  })
})

describe('VizArray extras', () => {
  it('supports push, pop, unshift, compare, unmark and window', () => {
    const { value, trace: t } = trace((viz) => {
      const a = viz.array<number>([2, 3])
      a.unshift(1)
      a.push(4)
      a.compare(0, 3, 'ends')
      a.mark(1, 'result')
      a.unmark(1)
      a.setWindow(1, 2)
      const popped = a.pop()
      return { popped, values: a.toArray(), at: a.at(0), length: a.length }
    })
    expect(value).toEqual({ popped: 4, values: [1, 2, 3], at: 1, length: 3 })
    const snap = finalOf(t, 'arr1', 'array')
    expect(snap.window).toEqual([1, 2])
    expect(snap.marks).toEqual([])
    expect(labels(t)).toContain('ends')
  })

  it('clears a window and a mark class', () => {
    const { trace: t } = trace((viz) => {
      const a = viz.array([1, 2])
      a.setWindow(0, 1)
      a.clearWindow()
      a.mark(0, 'visited')
      a.clearMarks('visited')
      return 0
    })
    const snap = finalOf(t, 'arr1', 'array')
    expect(snap.window).toBeUndefined()
    expect(snap.marks).toEqual([])
  })

  it('creates a zero-filled array from a length', () => {
    const { value } = trace((viz) => {
      const a = viz.array<number>(3)
      return a.toArray()
    })
    expect(value).toEqual([0, 0, 0])
  })

  it('seeds a blank array so an untouched cell is not a plausible-looking zero', () => {
    // Zero-filled, an output panel asserts `0` for every cell from the first frame, and those
    // zeros are indistinguishable from the ones that are the real answer.
    const { trace: t } = trace((viz) => {
      const a = viz.array<number>(3, { fill: null })
      a[1] = 7
      return 0
    })
    expect(finalOf(t, 'arr1', 'array').values).toEqual([null, 7, null])
  })

  it('refuses to hand back a blank cell instead of inventing a default for it', () => {
    expect(() =>
      trace((viz) => {
        const a = viz.array<number>(3, { fill: null })
        a[0] = 1
        return a.toArray()
      }),
    ).toThrow(/\[1\], \[2\] was never written/)

    const { value } = trace((viz) => {
      const a = viz.array<number>(2, { fill: null })
      a[0] = 4
      a[1] = 0
      return a.toArray()
    })
    expect(value).toEqual([4, 0])
  })

  it('reads a blank cell as absent, and leaves an explicit fill alone', () => {
    const { value } = trace((viz) => {
      const blank = viz.array<number>(2, { fill: null })
      const filled = viz.array<number>(2, { fill: -1 })
      return { blank: blank.at(0), peeked: blank[1], filled: filled.toArray() }
    })
    expect(value).toEqual({ blank: undefined, peeked: undefined, filled: [-1, -1] })
  })

  it('compares in one frame, lighting both cells and returning the ordering', () => {
    // Written as two array reads, the single comparison a monotonic stack turns on emitted two
    // frames and never put the pair on screen together — `compare` never appeared at all.
    const { value, trace: t } = trace((viz) => {
      const a = viz.array([75, 71, 75])
      return { less: a.compare(1, 0), more: a.compare(0, 1), same: a.compare(0, 2) }
    })
    expect(value).toEqual({ less: -1, more: 1, same: 0 })

    const frames = t.frames.filter((f) => f.op === 'compare')
    expect(frames).toHaveLength(3)
    for (const frame of frames) {
      const snap = frame.snapshots['arr1']
      expect(snap?.kind).toBe('array')
      const lit = snap?.kind === 'array' ? snap.marks.filter((m) => m.class === 'compare') : []
      expect(lit).toHaveLength(2)
    }
    // The label carries the values, not just the indices — a caption of pure mechanics is useless
    // exactly on the frame someone has stopped to read it.
    expect(labels(t)).toContain('compare [1] = 71 vs [0] = 75')
  })

  it('compares strings by their ordering, not by coercion', () => {
    const { value } = trace((viz) => {
      const a = viz.array(['apple', 'banana'])
      return [a.compare(0, 1), a.compare(1, 0)]
    })
    expect(value).toEqual([-1, 1])
  })

  it('reports membership through the proxy has trap', () => {
    const { value } = trace((viz) => {
      const a = viz.array([1, 2])
      return { inside: 1 in a, outside: 5 in a, hasLength: 'length' in a }
    })
    expect(value).toEqual({ inside: true, outside: false, hasLength: true })
  })

  it('exposes its structure id so a cursor can attach to it', () => {
    const { value } = trace((viz) => {
      const a = viz.array([1])
      return typeof (a as unknown as { $id: string }).$id
    })
    expect(value).toBe('string')
  })

  it('refuses a non-numeric property write rather than silently accepting it', () => {
    expect(() =>
      trace((viz) => {
        const a = viz.array([1])
        ;(a as unknown as Record<string, unknown>)['nope'] = 1
        return 0
      }),
    ).toThrow()
  })
})
