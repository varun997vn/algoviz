import type { Recorder } from '../recorder.js'
import type { Mark, MarkClass, Primitive, StructureKind, StructureSnapshot } from '../types.js'
import { BaseStructure, IndexMarkStore, type StructureInit } from './base.js'
import { format } from './array.js'

/** LIFO. Rendered bottom-up so `push`/`pop` read the way they do on a whiteboard. */
export class VizStack<T extends Primitive> extends BaseStructure {
  readonly kind: StructureKind = 'stack'
  private readonly values: T[] = []
  private readonly marks = new IndexMarkStore()

  constructor(rec: Recorder, initial: readonly T[] = [], init: StructureInit = {}) {
    super(rec, 'stk', init.name, 'stack')
    this.values.push(...initial)
  }

  override snapshot(transient?: readonly Mark[]): StructureSnapshot {
    return { kind: 'stack', values: [...this.values], marks: this.marks.list(transient) }
  }

  get size(): number {
    return this.values.length
  }

  get isEmpty(): boolean {
    return this.values.length === 0
  }

  push(...values: T[]): number {
    const n = this.values.push(...values)
    this.rec.record({
      op: 'push',
      structure: this,
      transient: [{ index: n - 1, class: 'active' }],
      label: `push ${values.map(format).join(', ')}`,
    })
    return n
  }

  pop(): T | undefined {
    const value = this.values.pop()
    this.marks.remove(this.values.length)
    this.rec.record({ op: 'pop', structure: this, label: `pop -> ${format(value)}` })
    return value
  }

  /** Top of stack without recording a mutation — still emits a `read` so it's visible. */
  peek(): T | undefined {
    const value = this.values[this.values.length - 1]
    this.rec.record({
      op: 'read',
      structure: this,
      transient: this.values.length > 0 ? [{ index: this.values.length - 1, class: 'active' }] : [],
      label: `peek -> ${format(value)}`,
    })
    return value
  }

  /** Non-recording peek, for guard conditions you don't want cluttering the timeline. */
  top(): T | undefined {
    return this.values[this.values.length - 1]
  }

  /**
   * Like `top()`, but typed as present.
   *
   * A monotonic-stack guard reads `temps[stack.requireTop()] < today` after an `isEmpty` check.
   * With `top()` alone that line needs a cast, because non-null assertions are lint-banned outside
   * tests — a cast in the one line that expresses the algorithm is exactly what the style rule
   * exists to prevent. Throws rather than returning a sentinel, so a genuine logic error surfaces.
   */
  requireTop(): T {
    if (this.values.length === 0) {
      throw new RangeError(`${this.name} is empty — guard with isEmpty before calling requireTop()`)
    }
    return this.values[this.values.length - 1] as T
  }

  mark(index: number, cls: MarkClass, note?: string): void {
    this.marks.set(index, cls, note)
    this.rec.record({ op: 'mark', structure: this, label: `mark ${index} as ${cls}` })
  }

  /** Symmetry with VizArray — the next monotonic-stack problem will want it. */
  clearMarks(cls?: MarkClass): void {
    this.marks.clear(cls)
    this.rec.record({ op: 'mark', structure: this, label: cls ? `clear ${cls} marks` : 'clear marks' })
  }

  toArray(): T[] {
    return [...this.values]
  }

  *[Symbol.iterator](): IterableIterator<T> {
    yield* this.values
  }
}

/**
 * FIFO queue, optionally a deque.
 *
 * `shift()` records a `dequeue` op rather than a generic `pop`, which is what lets the BFS
 * visualization label the frontier correctly without the solution having to say so.
 */
export class VizQueue<T extends Primitive> extends BaseStructure {
  readonly kind: StructureKind = 'queue'
  private readonly values: T[] = []
  private readonly marks = new IndexMarkStore()

  constructor(
    rec: Recorder,
    initial: readonly T[] = [],
    init: StructureInit & { deque?: boolean } = {},
  ) {
    super(rec, 'que', init.name, init.deque ? 'deque' : 'queue')
    this.deque = init.deque ?? false
    this.values.push(...initial)
  }

  readonly deque: boolean

  override snapshot(transient?: readonly Mark[]): StructureSnapshot {
    return {
      kind: 'queue',
      values: [...this.values],
      deque: this.deque,
      marks: this.marks.list(transient),
    }
  }

  get size(): number {
    return this.values.length
  }

  get isEmpty(): boolean {
    return this.values.length === 0
  }

  push(...values: T[]): number {
    const n = this.values.push(...values)
    this.rec.record({
      op: 'enqueue',
      structure: this,
      transient: values.map((_, i) => ({ index: n - values.length + i, class: 'frontier' as const })),
      label: `enqueue ${values.map(format).join(', ')}`,
    })
    return n
  }

  shift(): T | undefined {
    const value = this.values.shift()
    this.marks.shiftFrom(0, -1)
    this.rec.record({ op: 'dequeue', structure: this, label: `dequeue -> ${format(value)}` })
    return value
  }

  /** Deque-only: push to the front. */
  unshift(...values: T[]): number {
    if (!this.deque) throw new Error(`${this.name} is a queue, not a deque — pass { deque: true }`)
    const n = this.values.unshift(...values)
    this.marks.shiftFrom(0, values.length)
    this.rec.record({
      op: 'enqueue',
      structure: this,
      transient: values.map((_, i) => ({ index: i, class: 'frontier' as const })),
      label: `push front ${values.map(format).join(', ')}`,
    })
    return n
  }

  /** Deque-only: pop from the back. */
  pop(): T | undefined {
    if (!this.deque) throw new Error(`${this.name} is a queue, not a deque — pass { deque: true }`)
    const value = this.values.pop()
    this.marks.remove(this.values.length)
    this.rec.record({ op: 'dequeue', structure: this, label: `pop back -> ${format(value)}` })
    return value
  }

  front(): T | undefined {
    return this.values[0]
  }

  back(): T | undefined {
    return this.values[this.values.length - 1]
  }

  mark(index: number, cls: MarkClass, note?: string): void {
    this.marks.set(index, cls, note)
    this.rec.record({ op: 'mark', structure: this, label: `mark ${index} as ${cls}` })
  }

  toArray(): T[] {
    return [...this.values]
  }

  *[Symbol.iterator](): IterableIterator<T> {
    yield* this.values
  }
}
