import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TraceReader, trace, type StructureSnapshot, type Viz } from '@algoviz/tracer'
import { executeRun } from '@algoviz/runner'
import { Stage, VISUALIZERS, Visualizer, stageDigest } from './Visualizer.js'

/** Render one structure straight from a snapshot — visualizers are pure functions of one. */
function renderSnapshot(snapshot: StructureSnapshot): HTMLElement {
  const { container } = render(<Visualizer snapshot={snapshot} />)
  return container
}

function snapshotFrom(build: (viz: Viz) => unknown, id: string): StructureSnapshot {
  const { trace: t } = trace(build)
  const snap = new TraceReader(t).structureAt(id, t.frames.length - 1)
  if (!snap) throw new Error(`no snapshot for ${id}`)
  return snap
}

describe('VISUALIZERS registry', () => {
  it('has a component for every structure kind the tracer can emit', () => {
    // The mapped type makes this a compile error too; this asserts it at runtime as well so a
    // future `as any` can't sneak a hole through.
    const kinds: StructureSnapshot['kind'][] = [
      'array',
      'string',
      'matrix',
      'dp',
      'stack',
      'queue',
      'heap',
      'set',
      'map',
      'intervals',
      'tree',
      'graph',
      'trie',
      'list',
    ]
    for (const kind of kinds) expect(VISUALIZERS[kind], kind).toBeTypeOf('function')
    expect(Object.keys(VISUALIZERS).sort()).toEqual([...kinds].sort())
  })
})

describe('ArrayViz', () => {
  const snapshot: StructureSnapshot = {
    kind: 'array',
    values: [1, 8, 6, 2],
    cursors: [
      { name: 'left', index: 0, class: 'active' },
      { name: 'right', index: 3, class: 'active' },
    ],
    marks: [
      { index: 1, class: 'result' },
      { index: 2, class: 'active', transient: true },
    ],
    window: [1, 2],
  }

  it('renders one cell per value with its index', () => {
    const container = renderSnapshot(snapshot)
    const cells = container.querySelectorAll('[data-node-id]')
    expect(cells).toHaveLength(4)
    expect(cells[0]?.getAttribute('data-value')).toBe('1')
    expect(cells[3]?.getAttribute('data-value')).toBe('2')
  })

  it('exposes mark classes on the cell as a data attribute', () => {
    const container = renderSnapshot(snapshot)
    expect(container.querySelector('[data-node-id="1"]')?.getAttribute('data-highlight')).toBe('result')
    expect(container.querySelector('[data-node-id="2"]')?.getAttribute('data-highlight')).toBe('active')
    expect(container.querySelector('[data-node-id="0"]')?.getAttribute('data-highlight')).toBeNull()
  })

  it('renders a labelled caret per cursor', () => {
    renderSnapshot(snapshot)
    expect(screen.getByTestId('cursor-left')).toBeInTheDocument()
    expect(screen.getByTestId('cursor-right')).toBeInTheDocument()
  })

  it('outlines the sliding window', () => {
    const container = renderSnapshot(snapshot)
    expect(container.querySelectorAll('[data-testid="window-outline"]')).toHaveLength(2)
  })

  it('shows an empty state rather than a blank panel', () => {
    renderSnapshot({ kind: 'array', values: [], cursors: [], marks: [] })
    expect(screen.getByTestId('empty-structure')).toHaveTextContent('array is empty')
  })

  it('windows a very large array around the cursors instead of rendering 5000 cells', () => {
    const container = renderSnapshot({
      kind: 'array',
      values: Array.from({ length: 5000 }, (_, i) => i),
      cursors: [{ name: 'i', index: 2500 }],
      marks: [],
    })
    expect(screen.getByTestId('array-windowed')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-node-id]').length).toBeLessThan(300)
    // The cursor must stay on screen — that's the point of windowing around it.
    expect(screen.getByTestId('cursor-i')).toBeInTheDocument()
  })

  it('renders a caret resting one past the last element', () => {
    // The bug this pins: the filter was `c.index < to` with `to === values.length`, so a caret at
    // exactly `length` was dropped. Every `while (i < n)` loop ends there, which meant the final
    // frame of every array and string problem showed no carets at all.
    const container = renderSnapshot({
      kind: 'array',
      values: [1, 2, 3],
      cursors: [{ name: 'i', index: 3 }],
      marks: [],
    })
    const caret = screen.getByTestId('cursor-i')
    expect(caret).toBeInTheDocument()
    // It must sit past the last cell, not on top of it.
    const lastCell = container.querySelector('[data-node-id="2"] rect')
    const lastX = Number(lastCell?.getAttribute('x'))
    const caretX = Number(caret.querySelector('path')?.getAttribute('d')?.match(/M ([\d.]+)/)?.[1])
    expect(caretX).toBeGreaterThan(lastX)
    // And the SVG must be wide enough to actually show it.
    const svg = container.querySelector('svg')
    expect(Number(svg?.getAttribute('width'))).toBeGreaterThan(caretX)
  })

  it('still drops a caret that is genuinely out of bounds', () => {
    renderSnapshot({
      kind: 'array',
      values: [1, 2, 3],
      cursors: [{ name: 'far', index: 9 }],
      marks: [],
    })
    expect(screen.queryByTestId('cursor-far')).toBeNull()
  })

  it('gives two cursors on the same index different lanes so both stay readable', () => {
    const container = renderSnapshot({
      kind: 'array',
      values: [1, 2],
      cursors: [
        { name: 'slow', index: 1 },
        { name: 'fast', index: 1 },
      ],
      marks: [],
    })
    const slow = container.querySelector('[data-cursor-name="slow"] text')?.getAttribute('y')
    const fast = container.querySelector('[data-cursor-name="fast"] text')?.getAttribute('y')
    expect(slow).not.toBe(fast)
  })
})

describe('StringViz', () => {
  it('renders one cell per character', () => {
    const container = renderSnapshot({
      kind: 'string',
      value: 'abc',
      cursors: [],
      marks: [{ index: 1, class: 'match' }],
    })
    expect(container.querySelectorAll('[data-node-id]')).toHaveLength(3)
    expect(container.querySelector('[data-node-id="1"]')?.getAttribute('data-highlight')).toBe('match')
  })
})

describe('StackViz and QueueViz', () => {
  it('marks the top of the stack', () => {
    renderSnapshot({ kind: 'stack', values: [1, 2, 3], marks: [] })
    expect(screen.getByTestId('stack-top')).toBeInTheDocument()
  })

  it('renders the stack top-down so the last push is on top', () => {
    const container = renderSnapshot({ kind: 'stack', values: [1, 2, 3], marks: [] })
    const topCell = container.querySelector('[data-node-id="2"] rect')
    const bottomCell = container.querySelector('[data-node-id="0"] rect')
    expect(Number(topCell?.getAttribute('y'))).toBeLessThan(Number(bottomCell?.getAttribute('y')))
  })

  it('labels the front and back of a queue', () => {
    renderSnapshot({ kind: 'queue', values: [1, 2, 3], deque: false, marks: [] })
    expect(screen.getByTestId('queue-front')).toBeInTheDocument()
    expect(screen.getByTestId('queue-back')).toBeInTheDocument()
  })
})

describe('HeapViz', () => {
  it('renders both the array and the implied tree', () => {
    renderSnapshot({ kind: 'heap', values: [1, 3, 2, 7], comparatorLabel: 'min-heap', marks: [] })
    expect(screen.getByLabelText('heap as array')).toBeInTheDocument()
    expect(screen.getByLabelText('heap as tree')).toBeInTheDocument()
  })
})

describe('MapViz', () => {
  it('renders a key/value row per entry and highlights marked keys', () => {
    const container = renderSnapshot({
      kind: 'map',
      entries: [
        { key: 'a', value: 1 },
        { key: 'b', value: 2 },
      ],
      marks: [{ key: 'b', class: 'active' }],
    })
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(container.querySelector('[data-node-id="b"]')?.getAttribute('data-highlight')).toBe('active')
  })
})

describe('MatrixViz and DpViz', () => {
  it('renders a grid cell per coordinate', () => {
    const container = renderSnapshot({
      kind: 'matrix',
      values: [
        [0, 1],
        [1, 0],
      ],
      cursors: [{ name: 'p', row: 1, col: 0 }],
      marks: [{ row: 0, col: 1, class: 'visited' }],
    })
    expect(container.querySelector('[data-node-id="0,1"]')?.getAttribute('data-highlight')).toBe('visited')
    expect(screen.getByTestId('cursor-p')).toBeInTheDocument()
  })

  it('renders a 1-D dp table as a single row', () => {
    const container = renderSnapshot({ kind: 'dp', values: [0, 1, 1, 2], dims: 1, marks: [] })
    expect(container.querySelectorAll('[data-node-id]')).toHaveLength(4)
  })

  it('slashes a ruled-out cell, so excluded is not told apart from visited by fill alone', () => {
    // Both are dim greys, and on the frame `excluded` exists for — the "no solution" answer of a
    // grid search — they are usually the only two fills on screen. Retuning the grey moved the
    // collision from `cell-bg` onto `visited`; the slash is the signal that does not have to be
    // traded against another one, and tokens.css promises hue is never the only cue.
    const container = renderSnapshot({
      kind: 'matrix',
      values: [
        [1, 2],
        [0, 0],
      ],
      cursors: [],
      marks: [
        { row: 0, col: 0, class: 'excluded' },
        { row: 0, col: 1, class: 'visited' },
      ],
    })
    const slashIn = (id: string): Element | null | undefined =>
      container.querySelector(`[data-node-id="${id}"] [data-testid="excluded-slash"]`)
    expect(slashIn('0,0')).not.toBeNull()
    expect(slashIn('0,1')).toBeNull()
    expect(slashIn('1,0')).toBeNull()
  })
})

describe('GraphViz edge-mark direction', () => {
  // The rule had two independent implementations — here and in the MCP text renderer — and they
  // *had* drifted: the SVG folded marks into a Map (last wins) where the renderer used `.find()`
  // (first wins), so on any frame where an edge carried both a settled state and the transient
  // highlight of a walk crossing it, the player and the tool the audits read their evidence from
  // showed different things. Both now call `edgeMarkFor`; these pin the behaviour it has to have.
  const nodes = [
    { id: 'a', label: 'a' },
    { id: 'b', label: 'b' },
  ]

  it('does not mirror a mark on a directed graph, where the two directions are different edges', () => {
    const container = renderSnapshot({
      kind: 'graph',
      nodes,
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
      directed: true,
      marks: [],
      edgeMarks: [{ from: 'a', to: 'b', class: 'tree' }],
    })
    expect(container.querySelector('[data-testid="edge-a-b"]')?.getAttribute('data-edge-state')).toBe('tree')
    // The reverse edge was deliberately not taken; mirroring lit it anyway.
    expect(
      container.querySelector('[data-testid="edge-b-a"]')?.getAttribute('data-edge-state'),
    ).not.toBe('tree')
  })

  it('still mirrors on an undirected graph, where there is only one edge to light', () => {
    // Reorder Routes records a decision as `next -> city` while the edge is drawn `city -> next`;
    // without mirroring its verdicts would render on nothing.
    const container = renderSnapshot({
      kind: 'graph',
      nodes,
      edges: [{ from: 'a', to: 'b' }],
      directed: false,
      marks: [],
      edgeMarks: [{ from: 'b', to: 'a', class: 'reversed' }],
    })
    expect(container.querySelector('[data-testid="edge-a-b"]')?.getAttribute('data-edge-state')).toBe(
      'reversed',
    )
  })

  it('draws the transient highlight over the settled state, not under it', () => {
    // An edge already settled `tree` and being crossed again carries two marks on one frame. The
    // frame is *about* the crossing, so that is what shows; the settled state is what remains when
    // the highlight goes. The order the two arrive in must not decide it.
    const snapshot = (edgeMarks: { from: string; to: string; class: string; transient?: boolean }[]) =>
      renderSnapshot({
        kind: 'graph',
        nodes,
        edges: [{ from: 'a', to: 'b' }],
        directed: true,
        marks: [],
        edgeMarks,
      } as never)
    const settled = { from: 'a', to: 'b', class: 'tree' }
    const crossing = { from: 'a', to: 'b', class: 'active', transient: true }
    const stateOf = (c: Element): string | null =>
      c.querySelector('[data-testid="edge-a-b"]')?.getAttribute('data-edge-state') ?? null

    expect(stateOf(snapshot([settled, crossing]))).toBe('active')
    expect(stateOf(snapshot([crossing, settled]))).toBe('active')
    expect(stateOf(snapshot([settled]))).toBe('tree')
  })
})

describe('Cell rendering of awkward values', () => {
  // Everything in every visualizer goes through `Cell`, so these two changes are the widest-blast-
  // radius edits in the package and neither shipped with a test.
  it('draws an empty string as a glyph rather than as nothing at all', () => {
    // `display('')` fell through to `String('')`, so a cell holding the empty string was pixel-wise
    // identical to one holding nothing. On Decode String the empty string is the *most common*
    // value on the stack — the saved prefix at every top-level `[`.
    const container = renderSnapshot({ kind: 'stack', values: ['', 'ab'], marks: [] })
    expect(container.querySelector('[data-node-id="0"] text')?.textContent).toBe('ε')
    expect(container.querySelector('[data-node-id="1"] text')?.textContent).toBe('ab')
  })

  it('truncates a value too wide for its cell while keeping the whole one addressable', () => {
    // `fontSizeFor` bottoms out at 9px and there was no truncation, so a 20-character value ran
    // ~94px out of a 44px cell — clipped at one end, overprinting the neighbouring label at the
    // other. `data-value` must stay the full string so DOM assertions elsewhere are unaffected,
    // and the tooltip has to fall back to it or the truncated text is unrecoverable.
    const long = 'abcdefghijklmnopqrst'
    const container = renderSnapshot({ kind: 'stack', values: [long, 'short'], marks: [] })
    const cell = container.querySelector('[data-node-id="0"]')
    expect(cell?.getAttribute('data-value')).toBe(long)
    expect(cell?.querySelector('text')?.textContent).toBe('abcdefgh…')
    expect(cell?.querySelector('title')?.textContent).toBe(long)

    // A value that fits is untouched, and gets no tooltip it did not ask for.
    const fits = container.querySelector('[data-node-id="1"]')
    expect(fits?.querySelector('text')?.textContent).toBe('short')
    expect(fits?.querySelector('title')).toBeNull()
  })

  it('prefers an explicit mark note over the truncation fallback', () => {
    const container = renderSnapshot({
      kind: 'stack',
      values: ['abcdefghijklmnop'],
      marks: [{ index: 0, class: 'result', note: 'the saved prefix' }],
    })
    expect(container.querySelector('[data-node-id="0"] title')?.textContent).toBe('the saved prefix')
  })
})

describe('GridViz labelling', () => {
  it('puts the column labels above the grid, beside the row they label', () => {
    // They used to be drawn under the bottom row, which is fine for a one-row 1-D table and wrong
    // for a tall one — on an LCS table the column numbers sat hundreds of pixels below row 1,
    // labelling one axis at its end while the other was labelled at its start.
    const container = renderSnapshot({
      kind: 'dp',
      values: [
        [0, 0, 0],
        [0, 1, 1],
        [0, 1, 2],
      ],
      dims: 2,
      marks: [],
    })
    const colLabelY = Number(container.querySelector('[data-testid="grid-col-label-1"]')?.getAttribute('y'))
    const firstRowY = Number(container.querySelector('[data-node-id="0,0"] rect')?.getAttribute('y'))
    const lastRowY = Number(container.querySelector('[data-node-id="2,0"] rect')?.getAttribute('y'))
    expect(colLabelY).toBeLessThan(firstRowY)
    expect(firstRowY).toBeLessThan(lastRowY)
  })

  it('labels the axes with the strings the recurrence is over, each on its own axis', () => {
    // `viz.dp2d` accepted `axisLabels` from the day it was written and nothing ever read it, so a
    // 2-D table left a viewer no way to know what row 3 stood for. Row/column 0 are the
    // empty-prefix base cases, so character k labels row k+1 and they keep their index.
    //
    // Asserted per label rather than as `textContent.toContain`, which is what this first did:
    // both strings appear *somewhere* whichever axis they land on, so that version passed with
    // rows and columns swapped — the single thing worth pinning about a prop nothing had read.
    const container = renderSnapshot({
      kind: 'dp',
      values: [
        [0, 0, 0],
        [0, 1, 1],
        [0, 1, 2],
      ],
      dims: 2,
      marks: [],
      axisLabels: ['ab', 'xy'],
    })
    const labelAt = (axis: 'row' | 'col', i: number): string | undefined =>
      container.querySelector(`[data-testid="grid-${axis}-label-${i}"]`)?.textContent ?? undefined

    expect([labelAt('row', 0), labelAt('row', 1), labelAt('row', 2)]).toEqual(['0', 'a', 'b'])
    expect([labelAt('col', 0), labelAt('col', 1), labelAt('col', 2)]).toEqual(['0', 'x', 'y'])
  })
})

describe('mark notes reach the picture', () => {
  // `mark(index, class, note)` has stored notes since the tracer was written, and only ArrayViz and
  // GridViz ever rendered them — so every note a stack, queue, heap, set, map or intervals solution
  // attached was dead text, including ones written specifically to say why a cell was ruled out.
  const cases: { kind: string; snapshot: StructureSnapshot; nodeId: string }[] = [
    {
      kind: 'stack',
      snapshot: { kind: 'stack', values: [7, 8], marks: [{ index: 1, class: 'pinned', note: 'still waiting' }] },
      nodeId: '1',
    },
    {
      kind: 'queue',
      snapshot: { kind: 'queue', values: [1, 2], deque: false, marks: [{ index: 0, class: 'frontier', note: 'rots next' }] },
      nodeId: '0',
    },
    {
      kind: 'heap',
      snapshot: { kind: 'heap', values: [3, 9], comparatorLabel: 'min-heap', marks: [{ index: 0, class: 'result', note: 'the 2nd largest' }] },
      nodeId: '0',
    },
    {
      kind: 'set',
      snapshot: { kind: 'set', values: [4, 5], marks: [{ index: 1, class: 'excluded', note: 'already claimed' }] },
      nodeId: '1',
    },
  ]

  it.each(cases)('$kind renders its note as a title', ({ snapshot, nodeId }) => {
    const container = renderSnapshot(snapshot)
    const node = container.querySelector(`[data-node-id="${nodeId}"] title`)
    expect(node?.textContent).toBeTruthy()
  })

  it('a map row carries its note, which is keyed rather than indexed', () => {
    const container = renderSnapshot({
      kind: 'map',
      entries: [{ key: '7', value: 2 }],
      marks: [{ key: '7', class: 'excluded', note: 'two values want 2' }],
    })
    expect(container.querySelector('[data-node-id="7"]')?.getAttribute('title')).toBe(
      'two values want 2',
    )
  })

  it('an interval bar carries its note', () => {
    const container = renderSnapshot({
      kind: 'intervals',
      items: [{ id: 'i0', start: 0, end: 3 }],
      marks: [{ index: 0, class: 'excluded', note: 'removed' }],
    })
    expect(container.querySelector('[data-node-id="i0"] title')?.textContent).toBe('removed')
  })

  it('leaves title absent when a mark has no note', () => {
    const container = renderSnapshot({ kind: 'set', values: [1], marks: [{ index: 0, class: 'result' }] })
    expect(container.querySelector('[data-node-id="0"] title')).toBeNull()
  })
})

describe('IntervalsViz', () => {
  it('packs overlapping intervals into separate lanes', () => {
    const container = renderSnapshot({
      kind: 'intervals',
      items: [
        { id: 'i0', start: 0, end: 5 },
        { id: 'i1', start: 2, end: 7 },
      ],
      marks: [{ index: 1, class: 'excluded' }],
    })
    const first = container.querySelector('[data-node-id="i0"] rect')?.getAttribute('y')
    const second = container.querySelector('[data-node-id="i1"] rect')?.getAttribute('y')
    expect(first).not.toBe(second)
    expect(container.querySelector('[data-node-id="i1"]')?.getAttribute('data-highlight')).toBe('excluded')
  })
})

describe('TreeViz', () => {
  const snapshot = snapshotFrom((viz) => {
    const t = viz.tree([3, 1, 4, 3, null, 1, 5], { name: 'tree' })
    if (t.root) t.visit(t.root)
    return 0
  }, 'tree1')

  it('renders a node per tree node and an edge per parent-child link', () => {
    const container = renderSnapshot(snapshot)
    expect(container.querySelectorAll('[data-node-id]')).toHaveLength(6)
    expect(container.querySelectorAll('[data-testid^="edge-"]').length).toBeGreaterThan(0)
  })

  it('lays nodes out deterministically — the same snapshot renders identically twice', () => {
    // No force simulation, no randomness: this is what makes UI assertions stable.
    const a = renderSnapshot(snapshot).innerHTML
    const b = renderSnapshot(snapshot).innerHTML
    expect(a).toBe(b)
  })

  it('places children below their parent', () => {
    const container = renderSnapshot(snapshot)
    const circles = [...container.querySelectorAll('circle')]
    const ys = circles.map((c) => Number(c.getAttribute('cy')))
    expect(Math.max(...ys)).toBeGreaterThan(Math.min(...ys))
  })
})

describe('GraphViz', () => {
  const result = executeRun({
    problem: 'reorder-routes-to-make-all-paths-lead-to-the-city-zero',
    useReference: true,
    caseIndex: 0,
  })
  const reader = new TraceReader(result.results[0]!.trace)
  const finalWorld = reader.at(reader.frameCount - 1)
  const graph = [...finalWorld.values()].find((s) => s.kind === 'graph')!

  it('renders every city and road from a real solution run', () => {
    const container = renderSnapshot(graph)
    expect(container.querySelectorAll('circle')).toHaveLength(6)
    expect(container.querySelectorAll('[data-testid^="edge-"]')).toHaveLength(5)
  })

  it('exposes edge state so the reversed roads are assertable', () => {
    const container = renderSnapshot(graph)
    const reversed = [...container.querySelectorAll('[data-edge-state="reversed"]')]
    expect(reversed).toHaveLength(3)
  })

  it('lays the graph out deterministically', () => {
    expect(renderSnapshot(graph).innerHTML).toBe(renderSnapshot(graph).innerHTML)
  })
})

describe('TrieViz', () => {
  it('rings terminal nodes so word ends are visible', () => {
    const snapshot = snapshotFrom((viz) => {
      viz.trie(['ab'], { name: 'trie' })
      return 0
    }, 'tri1')
    const container = renderSnapshot(snapshot)
    expect(container.querySelectorAll('[data-testid^="terminal-"]').length).toBeGreaterThan(0)
  })
})

describe('ListViz', () => {
  it('renders the chain from head and labels it', () => {
    const snapshot = snapshotFrom((viz) => {
      const l = viz.list([1, 2, 3], { name: 'list' })
      l.cursor('cur', l.head)
      return 0
    }, 'lst1')
    const container = renderSnapshot(snapshot)
    expect(screen.getByTestId('list-head')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-node-id]')).toHaveLength(3)
    expect(screen.getByTestId('cursor-cur')).toBeInTheDocument()
  })

  it('shows detached nodes on their own row instead of hiding them', () => {
    // Mid-reversal there is always a node unlinked from the chain; hiding it is exactly when a
    // linked-list animation stops explaining anything.
    const snapshot = snapshotFrom((viz) => {
      const l = viz.list([1, 2, 3], { name: 'list' })
      const first = l.head
      if (first) l.head = first.rawNext
      return 0
    }, 'lst1')
    renderSnapshot(snapshot)
    expect(screen.getByTestId('list-detached-label')).toBeInTheDocument()
  })

  it('draws an arrow for every real link and none that does not exist', () => {
    // The bug this pins: arrows used to be positional (`i < row.length - 1`), so on every rewire
    // frame the renderer drew the link that had just been destroyed and drew the newly created
    // one nowhere. The frame whose whole purpose was to show the rewire showed its opposite.
    const snapshot = snapshotFrom((viz) => {
      const l = viz.list([1, 2, 3], { name: 'list' })
      const first = l.head
      const second = first?.rawNext
      // Mid-reversal state: n1 now points backwards at nothing, n2 still points at n3.
      if (first) first.next = null
      if (second) l.head = second
      return 0
    }, 'lst1')

    const container = renderSnapshot(snapshot)
    const drawn = [...container.querySelectorAll('[data-testid^="list-edge-"]')].map((el) =>
      el.getAttribute('data-testid'),
    )
    const expected = (snapshot.kind === 'list' ? snapshot.nodes : [])
      .filter((n) => n.next !== null)
      .map((n) => `list-edge-${n.id}-${String(n.next)}`)

    expect(drawn.sort()).toEqual(expected.sort())
    // n1.next is null, so nothing may leave it.
    expect(container.querySelector('[data-testid^="list-edge-n1-"]')).toBeNull()
  })

  it('does not invent arrows between unrelated detached nodes', () => {
    // Confirmed latent bug: two nodes spliced out in a different order than they were created
    // sat adjacent on the detached row, and the positional renderer asserted a link between them
    // even though neither pointed at the other.
    const snapshot = snapshotFrom((viz) => {
      const l = viz.list([1, 2, 3, 4], { name: 'list' })
      const n1 = l.head
      const n2 = n1?.rawNext
      const n3 = n2?.rawNext
      const n4 = n3?.rawNext
      // Splice n3 out, then n2 — both end up pointing at n4, neither at each other.
      if (n2 && n4) n2.next = n4
      if (n1 && n4) n1.next = n4
      if (n3 && n4) n3.next = n4
      return 0
    }, 'lst1')

    const container = renderSnapshot(snapshot)
    const drawn = [...container.querySelectorAll('[data-testid^="list-edge-"]')].map((el) =>
      el.getAttribute('data-testid'),
    )
    // Whatever ends up detached, no arrow may connect two nodes that do not link to each other.
    const links = new Set(
      (snapshot.kind === 'list' ? snapshot.nodes : [])
        .filter((n) => n.next !== null)
        .map((n) => `list-edge-${n.id}-${String(n.next)}`),
    )
    for (const id of drawn) expect(links.has(id ?? ''), `${String(id)} is not a real link`).toBe(true)
  })

  it('draws a cycle as an arc rather than hanging', () => {
    const snapshot = snapshotFrom((viz) => {
      const l = viz.list([1, 2, 3], { name: 'list' })
      const head = l.head
      const second = head?.rawNext
      const third = second?.rawNext
      if (third && second) third.next = second
      return 0
    }, 'lst1')
    renderSnapshot(snapshot)
    expect(screen.getByTestId('list-cycle')).toBeInTheDocument()
  })
})

describe('Stage', () => {
  const result = executeRun({ problem: 'container-with-most-water', useReference: true, caseIndex: 0 })
  const caseResult = result.results[0]!
  const reader = new TraceReader(caseResult.trace)

  it('renders a panel per structure with its declared name', () => {
    render(<Stage reader={reader} frame={reader.frameCount - 1} structures={caseResult.trace.structures} />)
    expect(screen.getByTestId('stage')).toBeInTheDocument()
    expect(screen.getByText('height')).toBeInTheDocument()
  })

  it('exposes a structural digest that changes when the picture changes', () => {
    const { container: a } = render(<Stage reader={reader} frame={0} structures={caseResult.trace.structures} />)
    const { container: b } = render(
      <Stage reader={reader} frame={reader.frameCount - 1} structures={caseResult.trace.structures} />,
    )
    const digestA = a.querySelector('[data-testid="stage"]')?.getAttribute('data-digest')
    const digestB = b.querySelector('[data-testid="stage"]')?.getAttribute('data-digest')
    expect(digestA).toBeTruthy()
    expect(digestA).not.toBe(digestB)
  })

  it('produces the same digest for the same frame every time', () => {
    // This is the property the e2e layer leans on instead of pixel snapshots.
    expect(stageDigest(reader.at(5))).toBe(stageDigest(reader.at(5)))
  })

  it('tells the user what to do when nothing has been created yet', () => {
    const empty = new TraceReader({ frames: [], structures: [], opCount: 0 })
    render(<Stage reader={empty} frame={0} structures={[]} />)
    expect(screen.getByTestId('stage-empty')).toBeInTheDocument()
  })
})
