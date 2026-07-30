import type { Recorder } from '../recorder.js'
import type {
  EdgeMark,
  EdgeState,
  Mark,
  MarkClass,
  NodeId,
  NodeMark,
  Primitive,
  StructureKind,
  StructureSnapshot,
  TreeNodeSnapshot,
} from '../types.js'
import { BaseStructure, NodeMarkStore, type StructureInit } from './base.js'

/** LeetCode's level-order array form (`[3,9,20,null,null,15,7]`) or a real node graph. */
export type TreeInput = readonly (number | string | null)[] | TreeInputNode | null

export interface TreeInputNode {
  val: number | string
  left?: TreeInputNode | null
  right?: TreeInputNode | null
}

interface InternalNode {
  id: NodeId
  value: Primitive
  left: InternalNode | null
  right: InternalNode | null
}

/**
 * A binary tree.
 *
 * Node access goes through methods (`t.left(n)`, `t.value(n)`) rather than property accessors
 * because a traversal needs to record *which edge* it walked, and an edge highlight is the
 * thing that makes a DFS legible. `t.visit(n)` is the one call a traversal must make; marks
 * for the live root→node path are managed by `enterPath`/`exitPath` so recursion unwinds
 * correctly — the bug class that makes tree animations subtly wrong.
 */
export class VizTree extends BaseStructure {
  readonly kind: StructureKind = 'tree'
  private readonly nodes = new Map<NodeId, InternalNode>()
  private readonly marks = new NodeMarkStore()
  private readonly edgeMarks = new Map<string, EdgeMark>()
  private rootNode: InternalNode | null = null
  private counter = 0
  private pending: NodeMark[] | undefined
  /** Edge highlights belonging to the current frame only — see `EdgeMark.transient`. */
  private pendingEdges: EdgeMark[] | undefined

  constructor(rec: Recorder, input: TreeInput, init: StructureInit = {}) {
    super(rec, 'tree', init.name, 'tree')
    this.rootNode = rec.quiet(() => this.build(input))
  }

  private build(input: TreeInput): InternalNode | null {
    if (input === null || input === undefined) return null
    if (Array.isArray(input)) return this.fromLevelOrder(input)
    return this.fromNodes(input as TreeInputNode)
  }

  private make(value: Primitive): InternalNode {
    this.counter += 1
    const node: InternalNode = { id: `t${this.counter}`, value, left: null, right: null }
    this.nodes.set(node.id, node)
    return node
  }

  private fromLevelOrder(values: readonly (number | string | null)[]): InternalNode | null {
    if (values.length === 0 || values[0] === null || values[0] === undefined) return null
    const root = this.make(values[0] as Primitive)
    const queue: InternalNode[] = [root]
    let i = 1
    while (queue.length > 0 && i < values.length) {
      const parent = queue.shift() as InternalNode
      const leftVal = values[i]
      i += 1
      if (leftVal !== null && leftVal !== undefined) {
        parent.left = this.make(leftVal)
        queue.push(parent.left)
      }
      if (i < values.length) {
        const rightVal = values[i]
        i += 1
        if (rightVal !== null && rightVal !== undefined) {
          parent.right = this.make(rightVal)
          queue.push(parent.right)
        }
      }
    }
    return root
  }

  private fromNodes(input: TreeInputNode): InternalNode {
    const node = this.make(input.val)
    if (input.left) node.left = this.fromNodes(input.left)
    if (input.right) node.right = this.fromNodes(input.right)
    return node
  }

  override snapshot(_transient?: readonly Mark[]): StructureSnapshot {
    const nodes: TreeNodeSnapshot[] = [...this.nodes.values()].map((n) => ({
      id: n.id,
      value: n.value,
      left: n.left?.id ?? null,
      right: n.right?.id ?? null,
    }))
    return {
      kind: 'tree',
      nodes,
      root: this.rootNode?.id ?? null,
      marks: this.marks.list(this.pending),
      edgeMarks: [
        ...this.edgeMarks.values(),
        ...(this.pendingEdges ?? []).map((e) => ({ ...e, transient: true })),
      ],
    }
  }

  get root(): NodeId | null {
    return this.rootNode?.id ?? null
  }

  get size(): number {
    return this.nodes.size
  }

  /** Value at a node. Records a read so the node lights up. */
  value(id: NodeId): Primitive {
    const node = this.require(id)
    this.emit('read', [{ id, class: 'active' }], `read ${formatVal(node.value)}`)
    return node.value
  }

  /** Value without recording — for building return values and guard conditions. */
  peek(id: NodeId): Primitive {
    return this.require(id).value
  }

  left(id: NodeId): NodeId | null {
    return this.step(id, 'left')
  }

  right(id: NodeId): NodeId | null {
    return this.step(id, 'right')
  }

  /**
   * One step down, lighting the edge for exactly the frame that walks it.
   *
   * The edge highlight is transient. It used to go through `markEdge` into the persistent store,
   * so a traversal left every edge it had ever walked permanently `active` — on a full tree BFS
   * that is the whole tree, all of it claiming to be under consideration on the final frame.
   *
   * The `active` node mark goes on the **child**, not the parent, matching `VizGraph.neighbors`:
   * the interesting node is the one just arrived at. And the label names what was found, so a step
   * onto a missing child stops being a frame in which nothing observably happens.
   */
  private step(id: NodeId, side: 'left' | 'right'): NodeId | null {
    const child = side === 'left' ? this.require(id).left : this.require(id).right
    const label = `${formatVal(this.peek(id))}.${side} -> ${child ? formatVal(child.value) : 'none'}`
    if (child) this.pendingEdges = [{ from: id, to: child.id, class: 'active' }]
    this.emit('visit', child ? [{ id: child.id, class: 'active' }] : [], label)
    this.pendingEdges = undefined
    return child?.id ?? null
  }

  /** Children without recording — handy for iterative traversals that manage their own frames. */
  childrenOf(id: NodeId): { left: NodeId | null; right: NodeId | null } {
    const node = this.require(id)
    return { left: node.left?.id ?? null, right: node.right?.id ?? null }
  }

  /** Mark a node processed. The canonical "I have handled this node" call. */
  visit(id: NodeId): void {
    this.marks.set(id, 'visited')
    this.emit('visit', [{ id, class: 'active' }], `visit ${formatVal(this.peek(id))}`)
  }

  /**
   * Push a node onto the live root→node path. Pair with `exitPath` (or use `onPath`) so the
   * highlight unwinds as recursion returns.
   */
  enterPath(id: NodeId): void {
    this.marks.set(id, 'path')
    this.rec.record({ op: 'mark', structure: this, label: `enter ${formatVal(this.peek(id))}` })
  }

  exitPath(id: NodeId): void {
    // Only the path mark comes off — a `result` or `visited` mark set while we were down here
    // is a conclusion about the node and must survive the unwind.
    this.marks.removeClass(id, 'path')
    this.rec.record({ op: 'mark', structure: this, label: `leave ${formatVal(this.peek(id))}` })
  }

  /** Scope-safe path marking — the highlight is removed even if `body` throws. */
  onPath<T>(id: NodeId, body: () => T): T {
    this.enterPath(id)
    try {
      return body()
    } finally {
      this.exitPath(id)
    }
  }

  mark(id: NodeId, cls: MarkClass, note?: string): void {
    this.marks.set(id, cls, note)
    this.rec.record({ op: 'mark', structure: this, label: `mark ${formatVal(this.peek(id))} as ${cls}` })
  }

  unmark(id: NodeId): void {
    this.marks.remove(id)
    // The *value*, not the internal node id — every other method formats the value, and a caption
    // reading `unmark t4` names something no viewer has ever seen.
    this.rec.record({ op: 'mark', structure: this, label: `unmark ${formatVal(this.peek(id))}` })
  }

  /**
   * Drop one class of mark from a node, leaving its others intact.
   *
   * `VizMatrix.unmarkClass` exists for exactly this and `NodeMarkStore.removeClass` has always
   * backed it; the tree only exposed `unmark` (every class on one node) and `clearMarks` (one class
   * on every node). Retiring a `frontier` mark therefore meant `unmark`, which is safe only while
   * the node happens to carry nothing else — the clobbering this store is keyed by `(id, class)` to
   * prevent.
   */
  unmarkClass(id: NodeId, cls: MarkClass): void {
    this.marks.removeClass(id, cls)
    this.rec.record({
      op: 'mark',
      structure: this,
      label: `unmark ${cls} on ${formatVal(this.peek(id))}`,
    })
  }

  clearMarks(cls?: MarkClass): void {
    this.marks.clear(cls)
    this.rec.record({ op: 'mark', structure: this, label: 'clear marks' })
  }

  markEdge(from: NodeId, to: NodeId, cls: EdgeState, note?: string): void {
    const mark: EdgeMark = { from, to, class: cls }
    if (note !== undefined) mark.note = note
    this.edgeMarks.set(`${from}->${to}`, mark)
  }

  /** Values in level order, for building return values. Records nothing. */
  toLevelOrder(): Primitive[] {
    if (!this.rootNode) return []
    const out: Primitive[] = []
    const queue: InternalNode[] = [this.rootNode]
    while (queue.length > 0) {
      const node = queue.shift() as InternalNode
      out.push(node.value)
      if (node.left) queue.push(node.left)
      if (node.right) queue.push(node.right)
    }
    return out
  }

  private emit(op: 'read' | 'visit', marks: NodeMark[], label: string): void {
    this.pending = marks
    this.rec.record({ op, structure: this, label })
    this.pending = undefined
  }

  private require(id: NodeId): InternalNode {
    const node = this.nodes.get(id)
    if (!node) throw new Error(`Unknown tree node "${id}"`)
    return node
  }
}

function formatVal(value: Primitive): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}
