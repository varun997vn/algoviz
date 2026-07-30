import type { Recorder } from '../recorder.js'
import type {
  ListNodeSnapshot,
  Mark,
  MarkClass,
  NodeId,
  Primitive,
  StructureKind,
  StructureSnapshot,
} from '../types.js'
import { BaseStructure, NodeMarkStore, type StructureInit } from './base.js'
import { format } from './array.js'

/**
 * A node the user manipulates directly, exactly like a LeetCode `ListNode`.
 *
 * `next` is a real accessor: reading it records a `visit` (so a traversal animates without
 * any extra calls) and assigning it records a rewire (so reversal animates too).
 */
export class VizListNode<T extends Primitive> {
  #next: VizListNode<T> | null = null
  #prev: VizListNode<T> | null = null

  constructor(
    readonly id: NodeId,
    private readonly owner: VizList<T>,
    private _value: T,
  ) {}

  get val(): T {
    this.owner.noteRead(this)
    return this._value
  }

  set val(v: T) {
    this._value = v
    this.owner.noteWrite(this)
  }

  /** Value without recording — for internal snapshotting. */
  get rawValue(): T {
    return this._value
  }

  get next(): VizListNode<T> | null {
    this.owner.noteVisit(this)
    return this.#next
  }

  set next(node: VizListNode<T> | null) {
    this.#next = node
    if (this.owner.doubly && node) node.#prev = this
    this.owner.noteRewire(this, node)
  }

  get prev(): VizListNode<T> | null {
    return this.#prev
  }

  set prev(node: VizListNode<T> | null) {
    this.#prev = node
  }

  get rawNext(): VizListNode<T> | null {
    return this.#next
  }
}

/**
 * A linked list.
 *
 * Snapshotting walks from `head` with a seen-set, so a list the user accidentally made cyclic
 * renders as a cycle instead of hanging the visualizer — which is the single most common way
 * a linked-list solution goes wrong.
 */
export class VizList<T extends Primitive> extends BaseStructure {
  readonly kind: StructureKind = 'list'
  readonly doubly: boolean
  private readonly nodes: VizListNode<T>[] = []
  private readonly marks = new NodeMarkStore()
  private readonly cursors = new Map<string, VizListNode<T> | null>()
  private headNode: VizListNode<T> | null = null
  private counter = 0
  private pendingMarks: { id: NodeId; class: MarkClass }[] | undefined

  constructor(
    rec: Recorder,
    values: readonly T[] = [],
    init: StructureInit & { doubly?: boolean } = {},
  ) {
    super(rec, 'lst', init.name, 'list')
    this.doubly = init.doubly ?? false
    rec.quiet(() => {
      let prev: VizListNode<T> | null = null
      for (const v of values) {
        const node = this.createNode(v)
        if (prev) prev.next = node
        else this.headNode = node
        prev = node
      }
    })
  }

  createNode(value: T): VizListNode<T> {
    this.counter += 1
    const node = new VizListNode<T>(`n${this.counter}`, this, value)
    this.nodes.push(node)
    return node
  }

  get head(): VizListNode<T> | null {
    return this.headNode
  }

  set head(node: VizListNode<T> | null) {
    this.headNode = node
    this.rec.record({ op: 'write', structure: this, label: `head -> ${node ? node.id : 'null'}` })
  }

  override snapshot(_transient?: readonly Mark[]): StructureSnapshot {
    const reachable: ListNodeSnapshot[] = []
    const seen = new Set<NodeId>()
    let cur = this.headNode
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      const snap: ListNodeSnapshot = {
        id: cur.id,
        value: cur.rawValue,
        next: cur.rawNext?.id ?? null,
      }
      if (this.doubly) snap.prev = cur.prev?.id ?? null
      reachable.push(snap)
      cur = cur.rawNext
    }
    // Detached nodes (mid-reversal, or a node the user spliced out) still matter visually.
    for (const node of this.nodes) {
      if (seen.has(node.id)) continue
      const snap: ListNodeSnapshot = {
        id: node.id,
        value: node.rawValue,
        next: node.rawNext?.id ?? null,
      }
      if (this.doubly) snap.prev = node.prev?.id ?? null
      reachable.push(snap)
    }
    return {
      kind: 'list',
      nodes: reachable,
      head: this.headNode?.id ?? null,
      doubly: this.doubly,
      cursors: [...this.cursors.entries()].map(([name, node]) => ({
        name,
        id: node?.id ?? null,
        class: 'active' as MarkClass,
      })),
      marks: this.marks.list(this.pendingMarks),
    }
  }

  cursor(name: string, node: VizListNode<T> | null): void {
    this.cursors.set(name, node)
    this.rec.record({ op: 'cursor', structure: this, label: `${name} -> ${node ? node.id : 'null'}` })
  }

  noteRead(node: VizListNode<T>): void {
    this.emit('read', node, 'active', `read ${node.id}.val = ${format(node.rawValue)}`)
  }

  noteWrite(node: VizListNode<T>): void {
    this.emit('write', node, 'active', `write ${node.id}.val = ${format(node.rawValue)}`)
  }

  noteVisit(node: VizListNode<T>): void {
    this.emit('visit', node, 'active', `follow ${node.id}.next`)
  }

  noteRewire(node: VizListNode<T>, target: VizListNode<T> | null): void {
    this.emit('write', node, 'active', `${node.id}.next -> ${target ? target.id : 'null'}`)
  }

  private emit(op: 'read' | 'write' | 'visit', node: VizListNode<T>, cls: MarkClass, label: string): void {
    this.pendingMarks = [{ id: node.id, class: cls }]
    this.rec.record({ op, structure: this, label })
    this.pendingMarks = undefined
  }

  mark(node: VizListNode<T>, cls: MarkClass, note?: string): void {
    this.marks.set(node.id, cls, note)
    this.rec.record({ op: 'mark', structure: this, label: `mark ${node.id} as ${cls}` })
  }

  /** Values in list order, following `next` without recording. Cycle-safe. */
  toArray(): T[] {
    const out: T[] = []
    const seen = new Set<NodeId>()
    let cur = this.headNode
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      out.push(cur.rawValue)
      cur = cur.rawNext
    }
    return out
  }
}
