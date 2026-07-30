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
      edgeMarks: [...this.edgeMarks.values()],
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
    const child = this.require(id).left
    if (child) this.markEdge(id, child.id, 'active')
    this.emit('visit', [{ id, class: 'active' }], `${formatVal(this.peek(id))}.left`)
    return child?.id ?? null
  }

  right(id: NodeId): NodeId | null {
    const child = this.require(id).right
    if (child) this.markEdge(id, child.id, 'active')
    this.emit('visit', [{ id, class: 'active' }], `${formatVal(this.peek(id))}.right`)
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
    this.marks.remove(id)
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
    this.rec.record({ op: 'mark', structure: this, label: `unmark ${id}` })
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
