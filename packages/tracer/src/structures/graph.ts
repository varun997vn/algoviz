import type { Recorder } from '../recorder.js'
import type {
  EdgeMark,
  EdgeState,
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
  Mark,
  MarkClass,
  NodeId,
  NodeMark,
  Primitive,
  StructureKind,
  StructureSnapshot,
} from '../types.js'
import { BaseStructure, NodeMarkStore, type StructureInit } from './base.js'

export interface GraphInit extends StructureInit {
  directed?: boolean
  weighted?: boolean
  /** Node count for `0..n-1` graphs — the LeetCode default. */
  n?: number
  /** `[u, v]` or `[u, v, weight]`. */
  edges?: readonly (readonly [number | string, number | string] | readonly [number | string, number | string, number])[]
  /** Adjacency list form: `adjacency[i]` lists i's neighbours. */
  adjacency?: readonly (readonly (number | string)[])[]
}

/**
 * A graph.
 *
 * `viz.graph({ n, edges })` builds the adjacency list, so `g.neighbors(u)` replaces the
 * hand-rolled `adj` array a plain solution needs. That makes the instrumented version of a
 * BFS/DFS *shorter* than the uninstrumented one — the clearest possible sign the API is
 * pulling its weight rather than taxing the user.
 */
export class VizGraph extends BaseStructure {
  readonly kind: StructureKind = 'graph'
  readonly directed: boolean
  readonly weighted: boolean

  private readonly nodeOrder: NodeId[] = []
  private readonly nodeMeta = new Map<NodeId, GraphNodeSnapshot>()
  private readonly adj = new Map<NodeId, { to: NodeId; weight?: number }[]>()
  private readonly edges: GraphEdgeSnapshot[] = []
  private readonly marks = new NodeMarkStore()
  private readonly edgeMarks = new Map<string, EdgeMark>()
  private pending: NodeMark[] | undefined
  /** Edge highlights belonging to the current frame only — see `EdgeMark.transient`. */
  private pendingEdges: EdgeMark[] | undefined

  constructor(rec: Recorder, init: GraphInit = {}) {
    super(rec, 'gph', init.name, 'graph')
    this.directed = init.directed ?? false
    this.weighted = init.weighted ?? false

    rec.quiet(() => {
      if (init.n !== undefined) {
        for (let i = 0; i < init.n; i += 1) this.addNode(i)
      }
      if (init.adjacency) {
        init.adjacency.forEach((neighbours, i) => {
          this.addNode(i)
          for (const j of neighbours) {
            this.addNode(j)
            this.addEdge(i, j)
          }
        })
      }
      for (const edge of init.edges ?? []) {
        const [u, v, w] = edge as readonly [number | string, number | string, number?]
        this.addNode(u)
        this.addNode(v)
        this.addEdge(u, v, w)
      }
    })
  }

  private key(raw: number | string): NodeId {
    return String(raw)
  }

  override snapshot(_transient?: readonly Mark[]): StructureSnapshot {
    return {
      kind: 'graph',
      nodes: this.nodeOrder.map((id) => this.nodeMeta.get(id) as GraphNodeSnapshot),
      edges: this.edges.map((e) => ({ ...e })),
      directed: this.directed,
      weighted: this.weighted,
      marks: this.marks.list(this.pending),
      edgeMarks: [
        ...this.edgeMarks.values(),
        ...(this.pendingEdges ?? []).map((e) => ({ ...e, transient: true })),
      ],
    }
  }

  get size(): number {
    return this.nodeOrder.length
  }

  get nodes(): NodeId[] {
    return [...this.nodeOrder]
  }

  addNode(raw: number | string, value?: Primitive): NodeId {
    const id = this.key(raw)
    if (this.nodeMeta.has(id)) return id
    const meta: GraphNodeSnapshot = { id, label: String(raw) }
    if (value !== undefined) meta.value = value
    this.nodeMeta.set(id, meta)
    this.nodeOrder.push(id)
    this.adj.set(id, [])
    this.rec.record({ op: 'insert', structure: this, label: `add node ${id}` })
    return id
  }

  addEdge(rawFrom: number | string, rawTo: number | string, weight?: number): void {
    const from = this.key(rawFrom)
    const to = this.key(rawTo)
    this.addNode(rawFrom)
    this.addNode(rawTo)

    const edge: GraphEdgeSnapshot = { from, to }
    if (weight !== undefined) edge.weight = weight
    this.edges.push(edge)

    const forward = this.adj.get(from)
    if (forward) forward.push(weight === undefined ? { to } : { to, weight })
    if (!this.directed) {
      const back = this.adj.get(to)
      if (back) back.push(weight === undefined ? { to: from } : { to: from, weight })
    }
    this.rec.record({ op: 'insert', structure: this, label: `add edge ${from}->${to}` })
  }

  /**
   * Neighbours of a node, marking each traversed edge as it is yielded.
   *
   * Lazily generated so the "considering this edge" highlight appears at the moment the loop
   * body runs, not all at once before it.
   */
  *neighbors(raw: number | string): IterableIterator<NodeId> {
    const from = this.key(raw)
    for (const { to } of this.adj.get(from) ?? []) {
      // Transient, not persistent. Written into the persistent store this left every edge the
      // search ever considered permanently `active`; it never showed only because the one graph
      // problem overwrites each edge with a verdict via `g.edge(...)` immediately afterwards.
      this.pendingEdges = [{ from, to, class: 'active' }]
      this.emit('visit', [{ id: to, class: 'active' }], `consider ${from} -> ${to}`)
      this.pendingEdges = undefined
      yield to
    }
  }

  /** Neighbours without recording — for guards and counting. */
  neighborsOf(raw: number | string): NodeId[] {
    return (this.adj.get(this.key(raw)) ?? []).map((e) => e.to)
  }

  weightOf(rawFrom: number | string, rawTo: number | string): number | undefined {
    const from = this.key(rawFrom)
    const to = this.key(rawTo)
    return (this.adj.get(from) ?? []).find((e) => e.to === to)?.weight
  }

  degree(raw: number | string): number {
    return (this.adj.get(this.key(raw)) ?? []).length
  }

  /** The canonical "I have processed this node" call. */
  visit(raw: number | string): void {
    const id = this.key(raw)
    this.marks.set(id, 'visited')
    this.emit('visit', [{ id, class: 'active' }], `visit ${id}`)
  }

  mark(raw: number | string, cls: MarkClass, note?: string): void {
    const id = this.key(raw)
    this.marks.set(id, cls, note)
    this.rec.record({ op: 'mark', structure: this, label: `mark ${id} as ${cls}` })
  }

  unmark(raw: number | string): void {
    this.marks.remove(this.key(raw))
    this.rec.record({ op: 'mark', structure: this, label: `unmark ${this.key(raw)}` })
  }

  /** Drop one class of mark from a node, leaving its others intact — see `VizTree.unmarkClass`. */
  unmarkClass(raw: number | string, cls: MarkClass): void {
    const id = this.key(raw)
    this.marks.removeClass(id, cls)
    this.rec.record({ op: 'mark', structure: this, label: `unmark ${cls} on ${id}` })
  }

  clearMarks(cls?: MarkClass): void {
    this.marks.clear(cls)
    this.rec.record({ op: 'mark', structure: this, label: 'clear marks' })
  }

  /**
   * Reset edge traversal state — the twin of `clearMarks` for edges.
   *
   * `edgeMarks` was a write-only map: `markEdge` put things in and nothing ever took them out.
   * That was survivable only while every graph problem decided each edge exactly once. The moment
   * a graph is traversed more than once — one walk per query, say — every edge the search has ever
   * considered stays lit for the rest of the trace, and the workaround is to overwrite them all
   * with some other state, which is itself a claim the algorithm never made.
   */
  clearEdges(state?: EdgeState): void {
    if (state === undefined) this.edgeMarks.clear()
    else for (const [k, v] of this.edgeMarks) if (v.class === state) this.edgeMarks.delete(k)
    this.rec.record({
      op: 'mark',
      structure: this,
      label: state ? `clear ${state} edges` : 'clear edge marks',
    })
  }

  /**
   * Neighbours with the weight of the edge you arrive along, lighting each edge as it is yielded.
   *
   * `neighbors` destructures `{ to }` from an adjacency entry that already holds `{ to, weight }`,
   * so every weighted traversal had to call `weightOf(at, next)` on the next line — which returns
   * `number | undefined` for an edge that provably exists, forcing a `?? 1` into the line that is
   * the algorithm.
   */
  *weightedNeighbors(raw: number | string): IterableIterator<{ to: NodeId; weight: number }> {
    const from = this.key(raw)
    for (const { to, weight } of this.adj.get(from) ?? []) {
      this.pendingEdges = [{ from, to, class: 'active' }]
      this.emit('visit', [{ id: to, class: 'active' }], `consider ${from} -> ${to}`)
      this.pendingEdges = undefined
      yield { to, weight: weight ?? 1 }
    }
  }

  /** Set an edge's traversal state — `tree`, `rejected`, `reversed`, … */
  edge(rawFrom: number | string, rawTo: number | string, state: EdgeState, note?: string): void {
    const from = this.key(rawFrom)
    const to = this.key(rawTo)
    this.markEdge(from, to, state, note)
    this.rec.record({ op: 'mark', structure: this, label: `edge ${from}->${to} is ${state}` })
  }

  /**
   * Resolve a decision about an edge onto the edge that was actually declared.
   *
   * An undirected edge is stored once, so a walk down it in the undeclared direction has to fold
   * onto the declared one — **key and endpoints together**. Normalising only the key was a silent
   * loss: the mark kept the caller's `from`/`to`, so on a directed graph `edge('a','b','tree')`
   * followed by `edge('b','a','rejected')` — two decisions, on what a directed graph considers two
   * different edges — left one mark, keyed `a->b` and *labelled* `b->a`. `GraphViz` matches marks
   * to drawn edges by endpoint, so it drew neither: two decisions in, nothing on screen.
   *
   * A decision about an edge that does not exist is a bug in the traversal, not a picture to draw,
   * so it throws — in the same spirit as `VizIntervals.reorder` and `VizDpTable.set`.
   */
  private markEdge(from: NodeId, to: NodeId, cls: EdgeState, note?: string): void {
    const edge =
      this.edges.find((e) => e.from === from && e.to === to) ??
      (this.directed ? undefined : this.edges.find((e) => e.from === to && e.to === from))
    if (!edge) {
      throw new RangeError(
        `${this.name} has no ${this.directed ? 'directed ' : ''}edge ${from} -> ${to}`,
      )
    }
    const mark: EdgeMark = { from: edge.from, to: edge.to, class: cls }
    if (note !== undefined) mark.note = note
    this.edgeMarks.set(`${edge.from}->${edge.to}`, mark)
  }

  private emit(op: 'visit' | 'read', marks: NodeMark[], label: string): void {
    this.pending = marks
    this.rec.record({ op, structure: this, label })
    this.pending = undefined
  }
}
