import type { Recorder } from '../recorder.js'
import type {
  IntervalItem,
  Mark,
  MarkClass,
  StructureKind,
  StructureSnapshot,
} from '../types.js'
import { BaseStructure, IndexMarkStore, type StructureInit } from './base.js'

/**
 * A tracked string. Mutable in the visualization sense (build-up problems like String
 * Compression) while still exposing the read-only helpers a solution actually uses.
 */
export class VizString extends BaseStructure {
  readonly kind: StructureKind = 'string'
  private chars: string[]
  private readonly marks = new IndexMarkStore()

  constructor(rec: Recorder, value: string, init: StructureInit = {}) {
    super(rec, 'str', init.name, 'string')
    this.chars = [...value]
  }

  override snapshot(transient?: readonly Mark[]): StructureSnapshot {
    return {
      kind: 'string',
      value: this.chars.join(''),
      cursors: this.rec.cursorsFor(this.id),
      marks: this.marks.list(transient),
    }
  }

  /**
   * The marker that makes this a legal `viz.cursor` target — see `AttachTarget`.
   *
   * `viz.array`'s proxy exposes the same property. Between them they are the only two structures
   * whose snapshot resolves cursors through `Recorder.cursorsFor`, so `$id` is what separates
   * "a caret here will render" from "a caret here is silently discarded".
   */
  get $id(): string {
    return this.id
  }

  get length(): number {
    return this.chars.length
  }

  charAt(index: number): string {
    const ch = this.chars[index] ?? ''
    this.rec.record({
      op: 'read',
      structure: this,
      transient: [{ index, class: 'active' }],
      label: `charAt(${index}) = ${JSON.stringify(ch)}`,
    })
    return ch
  }

  peek(index: number): string {
    return this.chars[index] ?? ''
  }

  set(index: number, ch: string): void {
    this.chars[index] = ch
    this.rec.record({
      op: 'write',
      structure: this,
      transient: [{ index, class: 'active' }],
      label: `set(${index}) = ${JSON.stringify(ch)}`,
    })
  }

  append(text: string): void {
    const from = this.chars.length
    this.chars.push(...text)
    this.rec.record({
      op: 'push',
      structure: this,
      transient: [...text].map((_, i) => ({ index: from + i, class: 'active' as const })),
      label: `append ${JSON.stringify(text)}`,
    })
  }

  removeLast(count = 1): void {
    this.chars.splice(Math.max(0, this.chars.length - count), count)
    this.rec.record({ op: 'pop', structure: this, label: `remove last ${count}` })
  }

  /**
   * Replace the whole string in one frame.
   *
   * Not every string problem builds left to right. Decode String rewrites its accumulator wholesale
   * at every `]` — `before + inner.repeat(times)` — and without this the only way to say that was
   * `removeLast(s.length)` then `append(...)`: two ops and a clear-by-length idiom standing in for
   * one assignment, in the line that *is* the algorithm. The alternative its author took was to
   * demote the answer to a watch value, which costs it a panel.
   *
   * Currently used only by this file's tests: it was added for Decode String and that solution was
   * not changed to use it. Adopting it there — promoting `built` from a watch value to a real
   * `viz.string` panel — is a live follow-up, deferred only because that problem is mid-audit and
   * changing its animation would invalidate the verdict.
   */
  replace(text: string): void {
    this.chars = [...text]
    this.rec.record({
      op: 'write',
      structure: this,
      transient: this.chars.map((_, i) => ({ index: i, class: 'active' as const })),
      label: `replace -> ${JSON.stringify(text)}`,
    })
  }

  swap(i: number, j: number): void {
    const a = this.chars[i] as string
    this.chars[i] = this.chars[j] as string
    this.chars[j] = a
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

  mark(index: number | readonly number[], cls: MarkClass, note?: string): void {
    const indices = typeof index === 'number' ? [index] : index
    for (const i of indices) this.marks.set(i, cls, note)
    this.rec.record({ op: 'mark', structure: this, label: `mark ${indices.join(', ')} as ${cls}` })
  }

  clearMarks(cls?: MarkClass): void {
    this.marks.clear(cls)
    this.rec.record({ op: 'mark', structure: this, label: 'clear marks' })
  }

  override toString(): string {
    return this.chars.join('')
  }
}

/** Interval list — rendered as a numeric timeline with lane packing. */
export class VizIntervals extends BaseStructure {
  readonly kind: StructureKind = 'intervals'
  private items: IntervalItem[]
  private readonly marks = new IndexMarkStore()

  constructor(
    rec: Recorder,
    initial: readonly (readonly [number, number])[] = [],
    init: StructureInit = {},
  ) {
    super(rec, 'ivl', init.name, 'intervals')
    this.items = initial.map(([start, end], i) => ({ id: `i${i}`, start, end }))
  }

  override snapshot(transient?: readonly Mark[]): StructureSnapshot {
    return { kind: 'intervals', items: this.items.map((i) => ({ ...i })), marks: this.marks.list(transient) }
  }

  get length(): number {
    return this.items.length
  }

  at(index: number): IntervalItem | undefined {
    return this.items[index]
  }

  read(index: number): IntervalItem | undefined {
    const item = this.items[index]
    this.rec.record({
      op: 'read',
      structure: this,
      transient: [{ index, class: 'active' }],
      label: item ? `read [${item.start}, ${item.end}]` : `read [${index}] (out of range)`,
    })
    return item
  }

  /**
   * Like `read`, but typed as present.
   *
   * `read` returns `IntervalItem | undefined`, so the one line that should read like the plain
   * solution needed a non-null assertion — and those are lint-banned outside tests precisely
   * because the line expressing the algorithm is the wrong place for one. Throws rather than
   * returning a sentinel, mirroring `VizStack.requireTop()`.
   */
  require(index: number): IntervalItem {
    const item = this.read(index)
    if (!item) {
      throw new RangeError(`${this.name} has no interval at index ${index}`)
    }
    return item
  }

  /**
   * Reorder to match a sort the solution performed — keeps the picture honest.
   *
   * **Clears every mark**, because a mark is keyed by position and a reorder invalidates all of
   * them at once; re-mark after sorting.
   *
   * Throws on anything that is not a permutation of the current indices. It used to `map` then
   * `filter(x => x !== undefined)`, so a duplicate or out-of-range index silently *shrank* the
   * timeline: `reorder([0, 0, 9])` on three items produced two items sharing `id: "i0"` — bars
   * missing from the picture, duplicate React keys, and no error anywhere.
   */
  reorder(order: readonly number[], label = 'sort'): void {
    const n = this.items.length
    const valid =
      order.length === n &&
      new Set(order).size === n &&
      order.every((i) => Number.isInteger(i) && i >= 0 && i < n)
    if (!valid) {
      throw new RangeError(
        `${this.name}.reorder() needs a permutation of 0..${n - 1}, got [${order.join(', ')}]`,
      )
    }
    this.items = order.map((i) => this.items[i] as IntervalItem)
    this.marks.clear()
    this.rec.record({ op: 'write', structure: this, label })
  }

  compare(a: number, b: number, note?: string): void {
    this.rec.record({
      op: 'compare',
      structure: this,
      transient: [
        { index: a, class: 'compare' },
        { index: b, class: 'compare' },
      ],
      label: note ?? `compare intervals ${a} and ${b}`,
    })
  }

  mark(index: number | readonly number[], cls: MarkClass, note?: string): void {
    const indices = typeof index === 'number' ? [index] : index
    for (const i of indices) this.marks.set(i, cls, note)
    this.rec.record({ op: 'mark', structure: this, label: `mark ${indices.join(', ')} as ${cls}` })
  }

  toArray(): IntervalItem[] {
    return this.items.map((i) => ({ ...i }))
  }
}
