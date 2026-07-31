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

  /**
   * The nodes still hanging off the root, in declaration order.
   *
   * A tree that can be *restructured* can orphan a subtree, and every renderer already agrees an
   * orphan is not drawn — `layoutTree` positions only what it can reach and `TreeViz` skips
   * anything without a position. The snapshot did not agree: it listed every node ever created,
   * so marks and edge marks on a spliced-out subtree stayed in it for the rest of the run,
   * describing a tree nobody could see. `trace_assert` counted them, the MCP renderer printed
   * their edges, and this problem's own integration test had already surrendered — asserting
   * `>= 1` match marks with a comment explaining why the count could not be pinned. That is a
   * defect being documented rather than caught.
   *
   * A visualizer is a pure function of a snapshot, so the snapshot has to be the picture.
   *
   * **Known limit, and it is a real one.** Pruning equates "unreachable" with "gone", and for a
   * deletion those coincide. For a *rotation* they do not: the only way to rotate through this API
   * is detach-then-reattach, and for the frame in between, a whole subtree vanishes from the
   * picture and then comes back. Worse, the frame that re-attaches it is captioned with a write on
   * a node the picture does not contain, because that node's mark is filtered out too — which is
   * the same "caption asserts something the picture lacks" defect this pruning removed from the
   * other side. No problem rotates today, so this is latent; closing it properly means a third
   * state (`detached: true` on the snapshot, drawn dimmed and off to one side, excluded from
   * `trace_assert` by flag rather than by absence) rather than a fourth ordering trick.
   */
  private reachable(): Set<NodeId> {
    return this.rootNode ? this.subtreeOf(this.rootNode) : new Set<NodeId>()
  }

  /** Ids at or under `from`. Cycle-safe, so it can also be used to *detect* a cycle. */
  private subtreeOf(from: InternalNode): Set<NodeId> {
    const seen = new Set<NodeId>()
    const walk = (node: InternalNode | null): void => {
      if (!node || seen.has(node.id)) return
      seen.add(node.id)
      walk(node.left)
      walk(node.right)
    }
    walk(from)
    return seen
  }

  override snapshot(_transient?: readonly Mark[]): StructureSnapshot {
    const live = this.reachable()
    const nodes: TreeNodeSnapshot[] = [...this.nodes.values()]
      .filter((n) => live.has(n.id))
      .map((n) => ({
        id: n.id,
        value: n.value,
        left: n.left?.id ?? null,
        right: n.right?.id ?? null,
      }))
    return {
      kind: 'tree',
      nodes,
      root: this.rootNode?.id ?? null,
      marks: this.marks.list(this.pending).filter((m) => live.has(m.id)),
      edgeMarks: [
        ...this.edgeMarks.values(),
        ...(this.pendingEdges ?? []).map((e) => ({ ...e, transient: true })),
      ].filter((e) => live.has(e.from) && live.has(e.to)),
    }
  }

  get root(): NodeId | null {
    return this.rootNode?.id ?? null
  }

  /**
   * Replace the root — e.g. deleting it leaves a different node, or none, in charge.
   *
   * A getter that reads and a setter that writes and records, mirroring `VizList.head`, so a
   * solution writes `t.root = newRoot` and has it read as the assignment it is. Before this,
   * `root` could only be *read*: everything else on `VizTree` is a traversal step or a mark, and
   * nothing could change what a node points at, which made restructuring — as opposed to walking
   * — inexpressible. See `setLeft`/`setRight`/`setValue` for the rest of that gap.
   */
  set root(id: NodeId | null) {
    this.rootNode = id === null ? null : this.require(id)
    // The value, not the internal id — `unmark`'s comment states the rule for the whole class and
    // this was the one method breaking it: `root -> t2` names something no viewer has ever seen,
    // on a frame where the new root displays `1`.
    const shown = this.rootNode === null ? 'empty' : formatVal(this.rootNode.value)
    this.rec.record({ op: 'write', structure: this, label: `root -> ${shown}` })
  }

  /**
   * How many nodes the tree *has*, which is what the picture shows rather than what was created.
   *
   * This counted every node ever made, orphans included, so it disagreed with
   * `snapshot().nodes.length` and with `toLevelOrder()` the moment anything was spliced out — the
   * last accessor still describing the pre-mutation model.
   */
  get size(): number {
    return this.reachable().size
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

  /**
   * Rewire a child pointer — splice a node out, or graft a subtree back in.
   *
   * `left`/`right` are read-only traversal steps that record a *visit*; nothing before this
   * could change what a node points at. A BST delete does exactly that in its recursive case
   * (`node.left = deleteNode(node.left, key)`), and there was no way to record it. `setLeft`
   * mirrors `VizList.next`'s split between walking (getter, visit) and rewiring (setter,
   * write): this is the tree's write half.
   *
   * The new edge lights transiently, one frame, the same way `left`/`right` light the edge they
   * walk — a rewire is the frame that makes the edge, not an ongoing claim about it.
   */
  setLeft(id: NodeId, child: NodeId | null): void {
    this.rewire(id, 'left', child)
  }

  setRight(id: NodeId, child: NodeId | null): void {
    this.rewire(id, 'right', child)
  }

  private rewire(id: NodeId, side: 'left' | 'right', child: NodeId | null): void {
    const node = this.require(id)
    const childNode = child === null ? null : this.require(child)
    // A binary tree with a cycle is not a binary tree, and until there was a write half none could
    // exist — so nothing downstream defends against one. `layoutTree` recursed until the stack
    // gave out, which in the browser is a locked tab, and the MCP renderer threw. Refused here
    // rather than only patched there: a cycle is not a picture that failed to draw, it is a state
    // the structure should never have reached.
    if (childNode && this.subtreeOf(childNode).has(id)) {
      throw new RangeError(
        `${this.name}: attaching ${formatVal(childNode.value)} under ${formatVal(node.value)} ` +
          `would make a cycle — ${formatVal(node.value)} is already inside it`,
      )
    }
    // Any settled decision about the edge being replaced goes with it. A mark outlives the edge it
    // is about otherwise, and `TreeViz` draws only edges the structure actually has while the MCP
    // renderer listed every mark — so `trace_inspect` reported `t1->t2:tree` for an edge the
    // picture did not contain, which is precisely the renderer disagreement `edgeMarkFor` exists
    // to prevent. This is the first API in the tracer that can make an edge stop existing, so it
    // is the first that has to say so.
    // Only when the pointer actually *changes*. `node.left = deleteNode(node.left, key)` re-attaches
    // the same child on every ancestor of the deleted node, so an unconditional delete destroyed
    // the settled state of edges the write did not touch: a `tree` edge would render idle beside
    // its still-marked siblings, on a rewire that changed nothing.
    const replaced = side === 'left' ? node.left : node.right
    if (replaced && replaced.id !== child) this.edgeMarks.delete(`${id}->${replaced.id}`)
    if (side === 'left') node.left = childNode
    else node.right = childNode
    const label = `${formatVal(node.value)}.${side} -> ${childNode ? formatVal(childNode.value) : 'null'}`
    if (childNode) this.pendingEdges = [{ from: id, to: childNode.id, class: 'active' }]
    this.emit('write', [{ id, class: 'active' }], label)
    this.pendingEdges = undefined
  }

  /**
   * Overwrite a node's value in place, keeping its id and its children.
   *
   * The two-children BST delete never removes the node it found — it copies the in-order
   * successor's value up and deletes the successor instead, which is a *value* change on a node
   * that stays exactly where it is. `value`/`peek` had no write half for the same reason
   * `left`/`right` didn't: nothing had ever needed to mutate a tree before.
   */
  setValue(id: NodeId, value: Primitive): void {
    const node = this.require(id)
    const label = `write ${formatVal(node.value)} -> ${formatVal(value)}`
    node.value = value
    this.emit('write', [{ id, class: 'active' }], label)
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

  private emit(op: 'read' | 'write' | 'visit', marks: NodeMark[], label: string): void {
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
