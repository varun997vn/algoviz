import { describe, expect, it } from 'vitest'
import type { Viz} from './index.js';
import { BudgetExceededError, TraceReader, lastAtMost, resolveFrame, trace } from './index.js'
import type { StructureSnapshot, Trace } from './types.js'

/** Mirrors the reader's carry-forward semantics, written independently for the replay test. */
function stripTransient(snap: StructureSnapshot): StructureSnapshot {
  if (!('marks' in snap) || !Array.isArray(snap.marks)) return snap
  const kept = (snap.marks as { transient?: boolean }[]).filter((m) => m.transient !== true)
  return { ...snap, marks: kept } as StructureSnapshot
}

function arraySnapshot(t: Trace, frame: number, id = 'arr1'): Extract<StructureSnapshot, { kind: 'array' }> {
  const snap = new TraceReader(t).structureAt(id, frame)
  if (!snap || snap.kind !== 'array') throw new Error(`no array snapshot at frame ${frame}`)
  return snap
}

describe('array instrumentation', () => {
  it('records reads and writes through plain index syntax', () => {
    const { value, trace: t } = trace((viz) => {
      const a = viz.array([5, 3, 8])
      const first = a[0]
      a[1] = 99
      return first
    })

    expect(value).toBe(5)
    const reads = t.frames.filter((f) => f.op === 'read')
    const writes = t.frames.filter((f) => f.op === 'write')
    expect(reads).toHaveLength(1)
    expect(writes).toHaveLength(1)
    expect(reads[0]?.label).toBe('read [0] = 5')
    expect(writes[0]?.label).toBe('write [1] = 99')
    expect(arraySnapshot(t, writes[0]!.index).values).toEqual([5, 99, 8])
  })

  it('exposes length and iteration without breaking on the proxy', () => {
    const { value } = trace((viz) => {
      const a = viz.array([1, 2, 3])
      let sum = 0
      for (const v of a) sum += v
      return { sum, length: a.length }
    })
    expect(value).toEqual({ sum: 6, length: 3 })
  })

  it('records a swap as one frame with both indices marked', () => {
    const { trace: t } = trace((viz) => {
      const a = viz.array([1, 2])
      a.swap(0, 1)
      return a.toArray()
    })
    const swap = t.frames.find((f) => f.op === 'swap')
    expect(swap).toBeDefined()
    const snap = arraySnapshot(t, swap!.index)
    expect(snap.values).toEqual([2, 1])
    expect(snap.marks.filter((m) => m.class === 'swap').map((m) => m.index).sort()).toEqual([0, 1])
  })

  it('keeps persistent marks across later frames but drops transient ones', () => {
    const { trace: t } = trace((viz) => {
      const a = viz.array([1, 2, 3])
      a.mark(2, 'result')
      const x = a[0]
      return x
    })
    const last = t.frames[t.frames.length - 1]!
    const snap = arraySnapshot(t, last.index)
    expect(snap.marks).toEqual([{ index: 2, class: 'result' }])
  })

  it('shifts marks to follow their elements after a shift()', () => {
    const { trace: t } = trace((viz) => {
      const a = viz.array([10, 20, 30])
      a.mark(2, 'result')
      a.shift()
      return a.toArray()
    })
    const snap = arraySnapshot(t, t.frames[t.frames.length - 1]!.index)
    expect(snap.marks).toEqual([{ index: 1, class: 'result' }])
  })
})

describe('cursors', () => {
  it('renders as named carets on the attached array and re-snapshots on move', () => {
    const { trace: t } = trace((viz) => {
      const a = viz.array([1, 2, 3, 4])
      const left = viz.cursor('left', 0, a)
      const right = viz.cursor('right', 3, a)
      left.inc()
      right.dec()
      return [left.value, right.value]
    })

    // Two declarations plus two moves. Declaring re-snapshots too, so a caret is on screen from
    // the frame that creates it rather than from the next frame that happens to touch the array —
    // otherwise the opening frames show an array with no pointers while the watch panel beside it
    // already reports their values.
    const cursorFrames = t.frames.filter((f) => f.op === 'cursor')
    expect(cursorFrames.map((f) => f.label)).toEqual([
      'declare left',
      'declare right',
      'left -> 1',
      'right -> 2',
    ])
    // A cursor move must re-snapshot the array, or the caret would visibly lag.
    expect(cursorFrames.every((f) => f.snapshots['arr1'] !== undefined)).toBe(true)
    // The caret exists from its own declaration frame, not one frame later.
    expect(arraySnapshot(t, cursorFrames[0]!.index).cursors.map((c) => c.name)).toEqual(['left'])

    const final = arraySnapshot(t, t.frames[t.frames.length - 1]!.index)
    expect(final.cursors).toEqual([
      { name: 'left', index: 1, class: 'active' },
      { name: 'right', index: 2, class: 'active' },
    ])
  })

  it('attaches to a string as readily as to an array proxy', () => {
    // `viz.cursor` once read only `.$id`, which the array proxy exposed and `VizString` did not, so
    // attaching to a string type-checked, silently bound to the *first* structure instead, and
    // rendered as a missing caret with no error — while cursor-in-range passed vacuously because
    // the cursor was absent from the structure being asserted about. `VizString` exposing `$id` is
    // what fixes that without reopening the hole to the eleven kinds that cannot render a caret.
    const { trace: t } = trace((viz) => {
      const a = viz.array([1, 2, 3], { name: 'a' })
      const s = viz.string('xyz', { name: 's' })
      viz.cursor('i', 1, s)
      viz.cursor('j', 2, a)
      s.charAt(0)
      return 0
    })

    const reader = new TraceReader(t)
    const last = t.frames.length - 1
    const idOf = (name: string): string =>
      t.structures.find((x) => x.name === name)?.id ?? '(missing)'

    const onString = reader.structureAt(idOf('s'), last)
    const onArray = reader.structureAt(idOf('a'), last)
    expect(onString?.kind === 'string' && onString.cursors.map((c) => c.name)).toEqual(['i'])
    expect(onArray?.kind === 'array' && onArray.cursors.map((c) => c.name)).toEqual(['j'])
  })

  it('refuses at compile time to attach to a structure that cannot render a caret', () => {
    // Only `VizArrayStructure` and `VizString` resolve cursors through `Recorder.cursorsFor`, and
    // both expose `$id`. Everything else inherits `id` from `BaseStructure`, so an `AttachTarget`
    // accepting `{ id: string }` accepted all thirteen kinds — and for eleven of them `viz.cursor`
    // compiled, registered a cursor and rendered nothing, for ever, with no error anywhere.
    //
    // `VizMatrix` and `VizList` are the subtle pair: their snapshots *do* carry a `cursors` field,
    // but they fill it from their own `cursor()` / `setCursors()` methods, so a `viz.cursor` aimed
    // at them was dropped just the same. Those methods are the right API and the type now says so.
    trace((viz) => {
      const heap = viz.heap<number>([1])
      const grid = viz.matrix([[1]])
      const list = viz.list([1])
      const counts = viz.map<number, number>()
      // @ts-expect-error a heap has no caret to render
      viz.cursor('i', 0, heap)
      // @ts-expect-error a matrix takes grid.cursor(name, row, col) instead
      viz.cursor('j', 0, grid)
      // @ts-expect-error a list takes list.setCursors({ ... }) instead
      viz.cursor('k', 0, list)
      // @ts-expect-error a map has no ordinal position for a caret to sit at
      viz.cursor('m', 0, counts)
      return 0
    })
  })

  it('accepts a raw structure id as well as the structure itself', () => {
    const { trace: t } = trace((viz) => {
      const s = viz.string('ab', { name: 's' })
      viz.cursor('k', 0, s.id)
      s.charAt(0)
      return 0
    })
    const reader = new TraceReader(t)
    const id = t.structures.find((x) => x.name === 's')?.id ?? ''
    const snap = reader.structureAt(id, t.frames.length - 1)
    expect(snap?.kind === 'string' && snap.cursors.map((c) => c.name)).toEqual(['k'])
  })

  it('binds an unattached cursor to the first registered structure', () => {
    const { trace: t } = trace((viz) => {
      const a = viz.array([1, 2, 3])
      const i = viz.cursor('i', 1)
      i.inc()
      return a[i.value]
    })
    const final = arraySnapshot(t, t.frames[t.frames.length - 1]!.index)
    expect(final.cursors.map((c) => c.name)).toEqual(['i'])
    expect(final.cursors[0]?.index).toBe(2)
  })
})

describe('grouping and narration', () => {
  it('nests group labels and unwinds them even when the body throws', () => {
    const { trace: t } = trace((viz) => {
      const a = viz.array([1])
      viz.group('outer', () => {
        viz.group('inner', () => {
          a.mark(0, 'active')
        })
        try {
          viz.group('boom', () => {
            throw new Error('kaboom')
          })
        } catch {
          /* swallowed on purpose — the group stack must still unwind */
        }
        viz.step('after the throw')
      })
      return 0
    })

    const marked = t.frames.find((f) => f.label === 'mark 0 as active')
    expect(marked?.groups).toEqual(['outer', 'inner'])
    const after = t.frames.find((f) => f.label === 'after the throw')
    expect(after?.groups).toEqual(['outer'])
  })

  it('samples watch variables into every frame', () => {
    const { trace: t } = trace((viz) => {
      const a = viz.array([1, 2, 3])
      let best = 0
      viz.watch(() => ({ best }))
      best = 7
      const v = a[0]
      return v
    })
    const read = t.frames.find((f) => f.op === 'read')
    expect(read?.watch).toEqual({ best: 7 })
  })

  it('carries a step label forward as the caption, including onto the return frame', () => {
    // `viz.step` has always documented its label as "carried forward as the player's current
    // caption" and the player read `frame.label ?? frame.op`, so it was not carried anywhere.
    // The frame that suffered was the last one: `trace()` appends a `return` frame unconditionally,
    // so a solution's closing narration landed at N-1 and pressing End showed `return 7` over a
    // picture identical to the frame that explained it.
    const { trace: t } = trace((viz) => {
      const a = viz.array([1, 2])
      viz.step('the interesting bit')
      a.mark(0, 'result')
      return 7
    })
    const reader = new TraceReader(t)
    const last = reader.frameCount - 1

    // The frame keeps its mechanical label — `trace_inspect` and the op log want it — but the
    // caption shown over the picture is the narration that explains that picture. The first version
    // of this test asserted `return 7` here, which was the defect written down as an expectation.
    expect(t.frames[last]?.op).toBe('return')
    expect(t.frames[last]?.label).toBe('return 7')
    expect(reader.captionAt(last)).toBe('the interesting bit')

    // The unlabelled mark frame between the step and the return inherits the narration.
    const marked = t.frames.findIndex((f) => f.label === 'mark 0 as result')
    expect(reader.captionAt(marked)).toBe('mark 0 as result')
    const stepAt = t.frames.findIndex((f) => f.label === 'the interesting bit')
    expect(reader.captionAt(stepAt)).toBe('the interesting bit')
  })

  it('falls back to the most recent narration when a frame has no label of its own', () => {
    const t: Trace = {
      frames: [
        { index: 0, op: 'step', groups: [], snapshots: {}, label: 'the explanation' },
        { index: 1, op: 'return', groups: [], snapshots: {} },
      ],
      structures: [],
      opCount: 2,
    }
    const reader = new TraceReader(t)
    expect(reader.captionAt(1)).toBe('the explanation')
    // Past the end clamps rather than returning undefined.
    expect(reader.captionAt(99)).toBe('the explanation')
  })

  it('carries work done inside quiet() onto the next frame that is emitted', () => {
    // This comment used to claim the change altered the snapshot contract for every problem,
    // because `viz.heap`, `viz.list`, `viz.map`, `viz.set`, `viz.graph`, `viz.tree` and `viz.trie`
    // all build their initial state inside `rec.quiet` in their constructors. That is wrong, and
    // measurably so: `viz.ts` calls `rec.register(s)` *after* each constructor returns, and
    // `register` emits an `init` frame carrying that very structure — which consumes the muted
    // entry before any other frame can inherit it. Across all 18 problems × every case, exactly
    // one frame in the repo carries a catch-up snapshot: `evaluate-division` frame 2, where a
    // *hand-written* `viz.quiet` block marks the graph and the next thing to happen is the
    // creation of another structure. Constructor quiet blocks contribute nothing.
    //
    // A snapshot only exists on frames that touch the structure, so a structure changed *only*
    // while quiet kept resolving to its pre-quiet state — seed a table quietly, narrate "the border
    // is filled in", and the caption and the picture flatly disagreed. Structures mutated while
    // quiet now ride along on the next emitted frame.
    //
    // The sibling test below reads the *terminal* frame, which `recordAll` snapshots wholesale, so
    // it passes with or without this. This one reads the frame in the middle, which is the only
    // place the difference is observable.
    const { trace: t } = trace((viz) => {
      const a = viz.array([1, 2, 3], { name: 'a' })
      const b = viz.array([9], { name: 'b' })
      viz.quiet(() => {
        a.mark(0, 'result')
        a.mark(1, 'visited')
      })
      b.mark(0, 'active') // the next emitted frame — belongs to `b`, must carry `a` as well
      viz.step('the marks are in')
      return 0
    })

    const idOf = (name: string): string => t.structures.find((x) => x.name === name)?.id ?? ''
    const catchUp = t.frames.find((f) => f.label === 'mark 0 as active')
    expect(catchUp, 'no frame for the post-quiet mark').toBeDefined()

    // The frame is *about* b, and carries a too.
    expect(catchUp!.structureId).toBe(idOf('b'))
    const carried = catchUp!.snapshots[idOf('a')]
    expect(carried, 'the quietly-marked array never caught up').toBeDefined()
    expect(carried?.kind === 'array' && carried.marks.map((m) => m.class).sort()).toEqual([
      'result',
      'visited',
    ])

    // And the catch-up happens once — a later frame is not still re-snapshotting `a`.
    const narrated = t.frames.find((f) => f.label === 'the marks are in')
    expect(Object.keys(narrated?.snapshots ?? {})).toEqual([])
  })

  it('owes no catch-up for a quiet block that only read', () => {
    // The catch-up was owed on *every* op inside quiet, reads included. A read's whole contribution
    // to a frame is its transient highlight, and a catch-up snapshot does not carry transients — so
    // a quiet read forced a snapshot deep-equal to the one already on screen but a **distinct
    // object**, which is precisely what invariant 2 forbids: `TraceReader` returns the same
    // reference for an unchanged structure so `React.memo` can skip the redraw. Reads that changed
    // nothing were redrawing the panel.
    const { trace: t } = trace((viz) => {
      const a = viz.array([1, 2, 3], { name: 'a' })
      const b = viz.array([9], { name: 'b' })
      viz.quiet(() => {
        void a[0]
        a.compare(0, 1)
      })
      b.mark(0, 'active')
      return 0
    })

    const idOf = (name: string): string => t.structures.find((x) => x.name === name)?.id ?? ''
    const next = t.frames.find((f) => f.label === 'mark 0 as active')
    expect(Object.keys(next?.snapshots ?? {})).toEqual([idOf('b')])

    // The identity contract, stated the way a memoised renderer sees it.
    const reader = new TraceReader(t)
    const at = t.frames.indexOf(next!)
    expect(reader.structureAt(idOf('a'), at)).toBe(reader.structureAt(idOf('a'), at - 1))
  })

  it('still emits no frames of its own for a quiet block', () => {
    // The catch-up must not turn quiet into "delayed loud": the ops inside stay unnarrated, and
    // three quiet marks must still cost zero frames rather than arriving late as three.
    const { trace: t } = trace((viz) => {
      const a = viz.array([1, 2, 3])
      viz.quiet(() => {
        a.mark(0, 'result')
        a.mark(1, 'visited')
        a.mark(2, 'excluded')
      })
      return 0
    })
    expect(t.frames.filter((f) => f.label?.startsWith('mark'))).toEqual([])
  })

  it('suppresses frames inside quiet() but still counts the ops', () => {
    const { trace: t } = trace((viz) => {
      const a = viz.array([1, 2, 3])
      const before = 0
      viz.quiet(() => {
        for (let i = 0; i < 3; i += 1) a.mark(i, 'visited')
      })
      return before
    })
    expect(t.frames.some((f) => f.label?.startsWith('mark'))).toBe(false)
    // The marks still took effect — they just weren't narrated.
    const final = new TraceReader(t).structureAt('arr1', t.frames.length - 1)
    expect(final?.kind === 'array' && final.marks).toHaveLength(3)
  })
})

describe('budgets', () => {
  it('throws BudgetExceededError carrying the partial trace on a runaway loop', () => {
    let caught: BudgetExceededError | undefined
    try {
      trace(
        (viz) => {
          const a = viz.array([1, 2, 3])
          for (;;) a.mark(0, 'active')
        },
        { maxFrames: 50 },
      )
    } catch (e) {
      caught = e as BudgetExceededError
    }
    expect(caught).toBeInstanceOf(BudgetExceededError)
    expect(caught?.reason).toBe('maxFrames')
    expect(caught?.partial.frames.length).toBeGreaterThan(0)
    expect(caught?.partial.truncated?.reason).toBe('maxFrames')
    expect(caught?.message).toContain('infinite loop')
  })

  it('trips the op budget independently of the frame budget', () => {
    expect(() =>
      trace(
        (viz) => {
          const a = viz.array([1])
          viz.quiet(() => {
            for (;;) a.mark(0, 'active')
          })
          return 0
        },
        { maxOps: 100 },
      ),
    ).toThrow(BudgetExceededError)
  })
})

describe('TraceReader', () => {
  it('resolves a structure to its most recent snapshot at or before a frame', () => {
    const { trace: t } = trace((viz) => {
      const a = viz.array([1, 2])
      const b = viz.array([9])
      a[0] = 5
      b[0] = 8
      a[1] = 6
      return 0
    })

    const reader = new TraceReader(t)
    const lastFrame = t.frames.length - 1
    const world = reader.at(lastFrame)
    expect(world.size).toBe(2)

    const a = world.get('arr1')
    const b = world.get('arr2')
    expect(a?.kind === 'array' && a.values).toEqual([5, 6])
    expect(b?.kind === 'array' && b.values).toEqual([8])
  })

  it('returns identical snapshot references when a structure did not change', () => {
    const { trace: t } = trace((viz) => {
      const a = viz.array([1])
      const b = viz.array([2])
      a[0] = 3
      b[0] = 4
      b[0] = 5
      return 0
    })
    const reader = new TraceReader(t)
    const firstB = t.frames.findIndex((f) => f.label === 'write [0] = 4')
    const secondB = t.frames.findIndex((f) => f.label === 'write [0] = 5')

    // `a` is carried forward across both of b's writes, so the UI must see one stable object —
    // that identity is what lets React.memo skip re-rendering an untouched structure.
    // (The terminal `return` frame deliberately re-snapshots everything, so it's excluded.)
    expect(reader.at(firstB).get('arr1')).toBe(reader.at(secondB).get('arr1'))
    expect(reader.at(firstB).get('arr2')).not.toBe(reader.at(secondB).get('arr2'))
  })

  it('omits structures that did not exist yet at the requested frame', () => {
    const { trace: t } = trace((viz) => {
      const a = viz.array([1])
      a[0] = 2
      const b = viz.array([3])
      b[0] = 4
      return 0
    })
    const reader = new TraceReader(t)
    const beforeB = t.frames.findIndex((f) => f.label === 'write [0] = 2')
    expect(reader.at(beforeB).has('arr2')).toBe(false)
  })

  it('drops transient highlights from a snapshot carried forward, but keeps persistent ones', () => {
    const { trace: t } = trace((viz) => {
      const a = viz.array([1])
      const b = viz.array([2])
      a.mark(0, 'result') // persistent
      a[0] = 3 // transient 'active' on index 0, overriding the persistent mark
      b[0] = 4 // a is now stale
      return 0
    })
    const reader = new TraceReader(t)
    const aWrite = t.frames.findIndex((f) => f.label === 'write [0] = 3')
    const last = t.frames.length - 1

    // On its own frame, the transient highlight layers over the persistent one (last wins).
    const onFrame = reader.structureAt('arr1', aWrite)
    expect(onFrame?.kind === 'array' && onFrame.marks).toEqual([
      { index: 0, class: 'result' },
      { index: 0, class: 'active', transient: true },
    ])

    // Carried forward, the transient layer is gone but the persistent mark survives.
    const carried = reader.structureAt('arr1', last)
    expect(carried?.kind === 'array' && carried.marks).toEqual([{ index: 0, class: 'result' }])

    // ...and identity is still stable across repeated resolution.
    expect(reader.structureAt('arr1', last)).toBe(reader.structureAt('arr1', last))
  })

  it('agrees with a naive full-snapshot replay at every frame', () => {
    // Replay equivalence: the encoding must be indistinguishable from having snapshotted
    // everything on every frame, modulo the deliberate transient-mark stripping above.
    // This is the invariant the whole model rests on.
    const { trace: t } = trace((viz) => {
      const a = viz.array([4, 1, 3, 2])
      const seen = viz.set<number>()
      const st = viz.stack<number>()
      for (let i = 0; i < a.length; i += 1) {
        const v = a[i]
        seen.add(v)
        st.push(v)
        if (i % 2 === 0) a.swap(0, i)
      }
      while (!st.isEmpty) st.pop()
      return a.toArray()
    })

    const reader = new TraceReader(t)
    const naive = new Map<string, StructureSnapshot>()
    for (const frame of t.frames) {
      for (const [id, snap] of Object.entries(frame.snapshots)) naive.set(id, snap)
      const resolved = reader.at(frame.index)
      expect([...resolved.keys()].sort()).toEqual([...naive.keys()].sort())
      for (const [id, snap] of naive) {
        const changedHere = frame.snapshots[id] !== undefined
        expect(resolved.get(id)).toEqual(changedHere ? snap : stripTransient(snap))
      }
    }
  })

  it('lists step frames for the player to jump between', () => {
    const { trace: t } = trace((viz) => {
      const a = viz.array([1, 2])
      viz.step('one')
      a[0] = 9
      viz.step('two')
      return 0
    })
    const reader = new TraceReader(t)
    expect(reader.stepFrames()).toHaveLength(2)
    expect(t.frames[reader.stepFrames()[0]!]?.label).toBe('one')
  })
})

describe('serialization', () => {
  it('round-trips through JSON and structuredClone', () => {
    const { trace: t } = trace((viz) => {
      const a = viz.array([1, 2])
      const m = viz.map<string, number>([['x', 1]])
      const g = viz.graph({ n: 3, edges: [[0, 1], [1, 2]] })
      const tr = viz.tree([1, 2, 3])
      a[0] = 5
      m.set('y', 2)
      g.visit(0)
      if (tr.root) tr.visit(tr.root)
      return 'done'
    })

    expect(JSON.parse(JSON.stringify(t))).toEqual(t)
    expect(structuredClone(t)).toEqual(t)
  })
})

describe('lastAtMost', () => {
  it('finds the largest element <= target, or undefined', () => {
    const xs = [0, 3, 7, 11]
    expect(lastAtMost(xs, 0)).toBe(0)
    expect(lastAtMost(xs, 6)).toBe(3)
    expect(lastAtMost(xs, 7)).toBe(7)
    expect(lastAtMost(xs, 100)).toBe(11)
    expect(lastAtMost(xs, -1)).toBeUndefined()
    expect(lastAtMost([], 5)).toBeUndefined()
  })
})

describe('resolveFrame convenience', () => {
  it('matches TraceReader.at', () => {
    const { trace: t } = trace((viz) => {
      const a = viz.array([1])
      a[0] = 2
      return 0
    })
    const last = t.frames.length - 1
    expect(resolveFrame(t, last)).toEqual(new TraceReader(t).at(last))
  })
})

describe('Viz facade', () => {
  it('registers every structure kind it exposes', () => {
    const { trace: t } = trace((viz: Viz) => {
      viz.array([1])
      viz.matrix([[1, 2], [3, 4]])
      viz.string('ab')
      viz.stack<number>()
      viz.queue<number>()
      viz.deque<number>()
      viz.set<number>()
      viz.map<string, number>()
      viz.heap<number>([3, 1])
      viz.list([1, 2])
      viz.tree([1, 2, 3])
      viz.graph({ n: 2, edges: [[0, 1]] })
      viz.dp1d(3)
      viz.dp2d(2, 2)
      viz.intervals([[0, 2]])
      viz.trie(['ab'])
      return 0
    })

    const kinds = t.structures.map((s) => s.kind)
    expect(new Set(kinds)).toEqual(
      new Set([
        'array',
        'matrix',
        'string',
        'stack',
        'queue',
        'set',
        'map',
        'heap',
        'list',
        'tree',
        'graph',
        'dp',
        'intervals',
        'trie',
      ]),
    )
    // queue and deque are the same kind but distinct structures.
    expect(kinds.filter((k) => k === 'queue')).toHaveLength(2)
  })
})
