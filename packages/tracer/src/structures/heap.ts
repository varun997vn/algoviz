import type { Recorder } from '../recorder.js'
import type { Mark, MarkClass, StructureKind, StructureSnapshot } from '../types.js'
import { BaseStructure, IndexMarkStore, type StructureInit } from './base.js'
import { format } from './array.js'

export interface HeapInit<T> extends StructureInit {
  /** Negative => a comes first. Defaults to a min-heap over numbers. */
  compare?: (a: T, b: T) => number
  comparatorLabel?: string
}

/**
 * A binary heap that records every sift comparison and swap.
 *
 * The values array *is* the heap's array representation, so the web app can render it two
 * ways from one snapshot — as a flat array and as the implied binary tree — which is exactly
 * the mental model people are missing when heaps feel like magic.
 */
export class VizHeap<T extends string | number> extends BaseStructure {
  readonly kind: StructureKind = 'heap'
  private readonly values: T[] = []
  private readonly marks = new IndexMarkStore()
  private readonly cmp: (a: T, b: T) => number
  readonly comparatorLabel: string

  constructor(rec: Recorder, initial: readonly T[] = [], init: HeapInit<T> = {}) {
    super(rec, 'hp', init.name, 'heap')
    this.cmp = init.compare ?? ((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    this.comparatorLabel = init.comparatorLabel ?? (init.compare ? 'custom' : 'min-heap')
    // Building the initial heap is setup, not algorithm — keep it out of the timeline.
    rec.quiet(() => {
      for (const v of initial) this.push(v)
    })
  }

  override snapshot(transient?: readonly Mark[]): StructureSnapshot {
    return {
      kind: 'heap',
      values: [...this.values],
      comparatorLabel: this.comparatorLabel,
      marks: this.marks.list(transient),
    }
  }

  get size(): number {
    return this.values.length
  }

  get isEmpty(): boolean {
    return this.values.length === 0
  }

  peek(): T | undefined {
    return this.values[0]
  }

  push(value: T): number {
    this.values.push(value)
    this.rec.record({
      op: 'push',
      structure: this,
      transient: [{ index: this.values.length - 1, class: 'active' }],
      label: `push ${format(value)}`,
    })
    this.siftUp(this.values.length - 1)
    return this.values.length
  }

  pop(): T | undefined {
    if (this.values.length === 0) {
      this.rec.record({ op: 'pop', structure: this, label: 'pop on empty heap' })
      return undefined
    }
    const top = this.values[0] as T
    const last = this.values.pop() as T
    // The departing root's mark goes with it; the leaf that is promoted brings its own. This used
    // to delete the *leaf's* mark and leave the *root's* in place, so the value arriving at the top
    // inherited a `result` belonging to the value that had just left — both halves backwards.
    this.marks.remove(0)
    this.marks.move(this.values.length, 0)
    if (this.values.length > 0) {
      this.values[0] = last
      this.rec.record({
        op: 'pop',
        structure: this,
        transient: [{ index: 0, class: 'active' }],
        label: `pop -> ${format(top)}, move ${format(last)} to root`,
      })
      this.siftDown(0)
    } else {
      this.rec.record({ op: 'pop', structure: this, label: `pop -> ${format(top)}` })
    }
    return top
  }

  private swap(i: number, j: number): void {
    const a = this.values[i] as T
    const b = this.values[j] as T
    this.values[i] = b
    this.values[j] = a
    this.marks.swap(i, j)
    this.rec.record({
      op: 'swap',
      structure: this,
      transient: [
        { index: i, class: 'swap' },
        { index: j, class: 'swap' },
      ],
      label: `swap [${i}] <-> [${j}]`,
    })
  }

  /**
   * Compare `value` against the root in one frame, returning the ordering a comparator would.
   *
   * The guard of every bounded-heap scan is "is this bigger than the smallest I am keeping?", and
   * with only a silent `peek()` that decision was the one thing in the algorithm never lit. Mirrors
   * `VizArrayApi.compare`, including the comparator-shaped return, so the line reads
   * `if (top.compareRoot(x) < 0)` instead of `if ((top.peek() as number) < x)` — one frame, and no
   * cast in the line that *is* the algorithm. Returns -1 on an empty heap, where nothing is bigger.
   */
  compareRoot(value: T, note?: string): number {
    const root = this.values[0]
    this.rec.record({
      op: 'compare',
      structure: this,
      transient: this.values.length > 0 ? [{ index: 0, class: 'compare' }] : [],
      label: note ?? `compare ${format(value)} with root ${format(root)}`,
    })
    if (root === undefined) return -1
    return this.cmp(root, value)
  }

  /** Symmetry with every other structure — a heap mark could previously never be retracted. */
  unmark(index: number): void {
    this.marks.remove(index)
    this.rec.record({ op: 'mark', structure: this, label: `unmark ${index}` })
  }

  clearMarks(cls?: MarkClass): void {
    this.marks.clear(cls)
    this.rec.record({ op: 'mark', structure: this, label: cls ? `clear ${cls} marks` : 'clear marks' })
  }

  private siftUp(start: number): void {
    let i = start
    while (i > 0) {
      const parent = (i - 1) >> 1
      this.rec.record({
        op: 'compare',
        structure: this,
        transient: [
          { index: i, class: 'compare' },
          { index: parent, class: 'compare' },
        ],
        label: `compare [${i}] with parent [${parent}]`,
      })
      if (this.cmp(this.values[i] as T, this.values[parent] as T) >= 0) break
      this.swap(i, parent)
      i = parent
    }
  }

  private siftDown(start: number): void {
    let i = start
    const n = this.values.length
    for (;;) {
      const left = 2 * i + 1
      const right = left + 1
      let best = i
      if (left < n) {
        this.rec.record({
          op: 'compare',
          structure: this,
          transient: [
            { index: best, class: 'compare' },
            { index: left, class: 'compare' },
          ],
          label: `compare [${best}] with left child [${left}]`,
        })
        if (this.cmp(this.values[left] as T, this.values[best] as T) < 0) best = left
      }
      if (right < n) {
        this.rec.record({
          op: 'compare',
          structure: this,
          transient: [
            { index: best, class: 'compare' },
            { index: right, class: 'compare' },
          ],
          label: `compare [${best}] with right child [${right}]`,
        })
        if (this.cmp(this.values[right] as T, this.values[best] as T) < 0) best = right
      }
      if (best === i) break
      this.swap(i, best)
      i = best
    }
  }

  mark(index: number, cls: MarkClass, note?: string): void {
    this.marks.set(index, cls, note)
    this.rec.record({ op: 'mark', structure: this, label: `mark ${index} as ${cls}` })
  }

  toArray(): T[] {
    return [...this.values]
  }
}
