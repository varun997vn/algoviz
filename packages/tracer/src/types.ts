/**
 * The trace data model.
 *
 * A run of an instrumented solution produces a `Trace`: an ordered list of `Frame`s.
 * Each frame carries snapshots of the structures that changed since the previous frame.
 * Unchanged structures are *not* re-snapshotted — the player resolves a structure's state
 * at frame N by walking back to the most recent frame that contains it (see `resolveFrame`).
 *
 * Nothing in this module knows about colours, pixels, React, or the DOM. Marks are
 * *semantic* classes; all presentation lives in the web app. That separation is what lets
 * the same trace be asserted in a Node unit test and rendered in a browser.
 */

export type Primitive = string | number | boolean | null | undefined

export type StructureId = string
export type NodeId = string

/** Semantic highlight classes. The web app maps these to colours, never the tracer. */
export type MarkClass =
  | 'active' // the element currently being looked at
  | 'compare' // participating in a comparison
  | 'swap' // being swapped
  | 'visited' // already processed
  | 'frontier' // discovered but not yet processed (BFS/DFS queue contents)
  | 'path' // on the live recursion / DFS path — must unwind as the stack pops
  | 'result' // part of the answer
  | 'match' // equals the search target
  | 'excluded' // ruled out
  | 'pinned' // user/algorithm pinned for reference

/**
 * Edge states, kept separate from `MarkClass` because an edge's interesting states are about
 * traversal decisions ("did we take this edge?") rather than element roles.
 */
export type EdgeState =
  | 'active' // being considered right now
  | 'tree' // accepted into the traversal tree
  | 'rejected' // led to an already-visited node
  | 'path' // on the current path
  | 'reversed' // direction flipped by the algorithm
  | 'visited'

export type OpKind =
  | 'init' // structure created
  | 'read'
  | 'write'
  | 'push'
  | 'pop'
  | 'shift'
  | 'unshift'
  | 'enqueue'
  | 'dequeue'
  | 'compare'
  | 'swap'
  | 'visit'
  | 'insert'
  | 'delete'
  | 'mark'
  | 'cursor'
  | 'step' // explicit viz.step() narration
  | 'group' // viz.group() boundary
  | 'return'

export type StructureKind =
  | 'array'
  | 'matrix'
  | 'string'
  | 'list'
  | 'tree'
  | 'graph'
  | 'stack'
  | 'queue'
  | 'heap'
  | 'map'
  | 'set'
  | 'dp'
  | 'intervals'
  | 'trie'

export interface StructureMeta {
  id: StructureId
  name: string
  kind: StructureKind
  /** Declaration order; the UI uses this for default panel ordering. */
  order: number
}

/** A named index into a linear structure, e.g. the `left`/`right` of a two-pointer scan. */
export interface Cursor {
  name: string
  index: number
  class?: MarkClass
}

export interface Cursor2D {
  name: string
  row: number
  col: number
  class?: MarkClass
}

export interface Mark {
  index: number
  class: MarkClass
  note?: string
  /**
   * True for a highlight that belongs to the frame that produced it rather than to the
   * structure's ongoing state — "the cell being read right now". The reader strips these when
   * resolving a snapshot from an *earlier* frame, so a structure that stopped changing doesn't
   * keep looking like it's being touched.
   */
  transient?: boolean
}

export interface Mark2D {
  row: number
  col: number
  class: MarkClass
  note?: string
  transient?: boolean
}

export interface NodeMark {
  id: NodeId
  class: MarkClass
  note?: string
  transient?: boolean
}

export interface EdgeMark {
  from: NodeId
  to: NodeId
  class: EdgeState
  note?: string
}

export interface KeyMark {
  key: string
  class: MarkClass
  note?: string
  transient?: boolean
}

export interface ListNodeSnapshot {
  id: NodeId
  value: Primitive
  next: NodeId | null
  prev?: NodeId | null
}

export interface TreeNodeSnapshot {
  id: NodeId
  value: Primitive
  left: NodeId | null
  right: NodeId | null
}

export interface GraphNodeSnapshot {
  id: NodeId
  label: string
  value?: Primitive
}

export interface GraphEdgeSnapshot {
  from: NodeId
  to: NodeId
  weight?: number
}

export interface TrieNodeSnapshot {
  id: NodeId
  char: string
  terminal: boolean
  children: NodeId[]
}

export interface IntervalItem {
  id: string
  start: number
  end: number
  label?: string
}

export type StructureSnapshot =
  | {
      kind: 'array'
      values: Primitive[]
      cursors: Cursor[]
      marks: Mark[]
      /** Inclusive index range for sliding-window problems. */
      window?: [number, number]
    }
  | { kind: 'matrix'; values: Primitive[][]; cursors: Cursor2D[]; marks: Mark2D[] }
  | { kind: 'string'; value: string; cursors: Cursor[]; marks: Mark[] }
  | {
      kind: 'list'
      nodes: ListNodeSnapshot[]
      head: NodeId | null
      doubly: boolean
      cursors: { name: string; id: NodeId | null; class?: MarkClass }[]
      marks: NodeMark[]
    }
  | {
      kind: 'tree'
      nodes: TreeNodeSnapshot[]
      root: NodeId | null
      marks: NodeMark[]
      edgeMarks: EdgeMark[]
    }
  | {
      kind: 'graph'
      nodes: GraphNodeSnapshot[]
      edges: GraphEdgeSnapshot[]
      directed: boolean
      weighted: boolean
      marks: NodeMark[]
      edgeMarks: EdgeMark[]
    }
  | { kind: 'stack'; values: Primitive[]; marks: Mark[] }
  | { kind: 'queue'; values: Primitive[]; deque: boolean; marks: Mark[] }
  | { kind: 'heap'; values: Primitive[]; comparatorLabel: string; marks: Mark[] }
  | { kind: 'map'; entries: { key: string; value: unknown }[]; marks: KeyMark[] }
  | { kind: 'set'; values: Primitive[]; marks: Mark[] }
  | {
      kind: 'dp'
      values: Primitive[] | Primitive[][]
      dims: 1 | 2
      axisLabels?: [string, string]
      marks: Mark2D[]
    }
  | { kind: 'intervals'; items: IntervalItem[]; marks: Mark[] }
  | { kind: 'trie'; nodes: TrieNodeSnapshot[]; root: NodeId; marks: NodeMark[] }

export interface Frame {
  index: number
  op: OpKind
  /** Which structure the op happened on, when applicable. */
  structureId?: StructureId
  /** Human-readable narration, e.g. from `viz.step('expand window')`. */
  label?: string
  /** Enclosing `viz.group()` labels, outermost first — drives the call-stack outline. */
  groups: string[]
  /** 1-based source line in the user's solution, injected by the runner's transform. */
  line?: number
  /** Only structures whose state changed at this frame. */
  snapshots: Record<StructureId, StructureSnapshot>
  /** Sampled watch variables, e.g. `{ best: 49 }`. */
  watch?: Record<string, Primitive>
}

export interface TraceTruncation {
  reason: 'maxFrames' | 'maxOps' | 'timeout'
  atFrame: number
  message: string
}

export interface TraceResult {
  returned: unknown
  expected?: unknown
  passed?: boolean
}

export interface Trace {
  frames: Frame[]
  structures: StructureMeta[]
  truncated?: TraceTruncation
  result?: TraceResult
  /** Total recorded ops, including any dropped after truncation. */
  opCount: number
}

export interface VizOptions {
  /** Hard cap on emitted frames. Exceeding it truncates the trace rather than hanging. */
  maxFrames?: number
  /** Hard cap on recorded operations. */
  maxOps?: number
  /** Wall-clock budget in milliseconds. */
  timeBudgetMs?: number
}

export const DEFAULT_VIZ_OPTIONS: Required<VizOptions> = {
  maxFrames: 20_000,
  maxOps: 200_000,
  timeBudgetMs: 5_000,
}

/**
 * Thrown when a solution blows its op/frame/time budget — almost always an infinite loop.
 * Carries the partial trace so the user still sees *where* it ran away.
 */
export class BudgetExceededError extends Error {
  constructor(
    readonly reason: TraceTruncation['reason'],
    readonly partial: Trace,
  ) {
    super(
      reason === 'timeout'
        ? `Solution exceeded its time budget after ${partial.frames.length} frames — likely an infinite loop.`
        : `Solution exceeded its ${reason === 'maxFrames' ? 'frame' : 'operation'} budget after ${partial.frames.length} frames — likely an infinite loop.`,
    )
    this.name = 'BudgetExceededError'
  }
}
