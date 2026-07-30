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
