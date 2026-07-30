import type { Recorder } from '../recorder.js'
import type { Mark, MarkClass, Primitive, StructureKind, StructureSnapshot } from '../types.js'
import { asIndex, BaseStructure, IndexMarkStore, type StructureInit } from './base.js'

export interface VizArrayApi<T extends Primitive> {
  readonly length: number
  readonly $id: string
  /** Read/write without emitting a frame — for bookkeeping the viewer shouldn't see. */
  at(index: number): T | undefined
  push(...values: T[]): number
  pop(): T | undefined
  shift(): T | undefined
  unshift(...values: T[]): number
  swap(i: number, j: number): void
  /**
   * One frame with both cells lit `compare`, returning their ordering the way a sort comparator
   * does: negative if `[i] < [j]`, zero if equal, positive if greater.
   *
   * It returns the ordering so the guard that *is* the algorithm can be written as a comparison
   * instead of as two separate reads. `while (t[stack.top()] < t[day])` emits two lone `read`
   * frames and never puts the two cells being compared on screen together — on a monotonic stack
   * that means the one real decision the algorithm makes is invisible *as* a decision, and the
   * `compare` mark class never appears at all. `t.compare(top, day) < 0` is one frame, both cells
   * lit, and still reads like the line it replaces.
   */
  compare(i: number, j: number, note?: string): number
  mark(index: number | readonly number[], cls: MarkClass, note?: string): void
  unmark(index: number | readonly number[]): void
  clearMarks(cls?: MarkClass): void
  /** Highlight an inclusive index range — the sliding-window idiom. */
  setWindow(lo: number, hi: number): void
  clearWindow(): void
  toArray(): T[]
  [Symbol.iterator](): IterableIterator<T>
}

export type VizArray<T extends Primitive = Primitive> = VizArrayApi<T> & { [index: number]: T }

export interface ArrayInit<T extends Primitive> extends StructureInit {
  /**
   * What a sized array starts as. `null` seeds it *blank* — see `blank` below.
   *
   * Only meaningful when the array is created from a size rather than from values.
   */
  fill?: T | null
}

/**
 * A tracked array.
 *
 * Wrapped in a `Proxy` so plain `a[i]` and `a[i] = v` record frames — the whole point is that
 * instrumented code still reads like the solution you'd write on a whiteboard.
 */
export class VizArrayStructure<T extends Primitive> extends BaseStructure {
  readonly kind: StructureKind = 'array'
  private readonly marks = new IndexMarkStore()
  private win: [number, number] | undefined
  /**
   * True when the array was seeded blank rather than with a value.
   *
   * `viz.array<number>(n)` zero-fills, so an output panel named `answer` asserts `0` for every
   * cell from frame 1 — and on Daily Temperatures 484 of 498 frames showed at least one zero that
   * was a lie, indistinguishable from the zeros that were the real answer. `viz.dpTable` already
   * takes `fill: null` for exactly this reason; an array seeded blank renders its untouched cells
   * as `∅` instead, and `toArray()` refuses to hand back a hole rather than silently coercing it
   * to a zero the algorithm never decided on.
   */
  private readonly blank: boolean

  constructor(
    rec: Recorder,
    private values: (T | null)[],
    init: ArrayInit<T> = {},
  ) {
    super(rec, 'arr', init.name, 'array')
    this.blank = init.fill === null
  }

  override snapshot(transient?: readonly Mark[]): StructureSnapshot {
    const snap: Extract<StructureSnapshot, { kind: 'array' }> = {
      kind: 'array',
      values: [...this.values],
      cursors: this.rec.cursorsFor(this.id),
      marks: this.marks.list(transient),
    }
    if (this.win) snap.window = [...this.win]
    return snap
  }

  get length(): number {
    return this.values.length
  }

  /** A blank cell reads as absent, not as whatever `null` would coerce to. */
  private out(value: T | null | undefined): T | undefined {
    if (value === null && this.blank) return undefined
    return value as T | undefined
  }

  read(index: number): T | undefined {
    const value = this.values[index]
    this.rec.record({
      op: 'read',
      structure: this,
      transient: [{ index, class: 'active' }],
      label: `read [${index}] = ${format(value)}`,
    })
    return this.out(value)
  }

  write(index: number, value: T): void {
    this.values[index] = value
    this.rec.record({
      op: 'write',
      structure: this,
      transient: [{ index, class: 'active' }],
      label: `write [${index}] = ${format(value)}`,
    })
  }

  peek(index: number): T | undefined {
    return this.out(this.values[index])
  }

  push(...values: T[]): number {
    const n = this.values.push(...values)
    this.rec.record({
      op: 'push',
      structure: this,
      transient: values.map((_, i) => ({ index: n - values.length + i, class: 'active' as const })),
      label: `push ${values.map(format).join(', ')}`,
    })
    return n
  }

  pop(): T | undefined {
    const last = this.values.length - 1
    const value = this.values.pop()
    this.marks.remove(last)
    this.rec.record({ op: 'pop', structure: this, label: `pop -> ${format(value)}` })
    return this.out(value)
  }

  shift(): T | undefined {
    const value = this.values.shift()
    this.marks.shiftFrom(0, -1)
    this.rec.record({ op: 'shift', structure: this, label: `shift -> ${format(value)}` })
    return this.out(value)
  }

  unshift(...values: T[]): number {
    const n = this.values.unshift(...values)
    this.marks.shiftFrom(0, values.length)
    this.rec.record({
      op: 'unshift',
      structure: this,
      transient: values.map((_, i) => ({ index: i, class: 'active' as const })),
      label: `unshift ${values.map(format).join(', ')}`,
    })
    return n
  }

  swap(i: number, j: number): void {
    const a = this.values[i] as T | null
    const b = this.values[j] as T | null
    this.values[i] = b
    this.values[j] = a
    // Marks follow their values, same as in `VizHeap.swap`. Latent here until the first in-place
    // sorting problem — but it is the same omission, and fixing one sibling of a bug class while
    // leaving the other is exactly how `Mark2DStore` survived after `NodeMarkStore` was fixed.
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

  /** See `VizArrayApi.compare` — one frame, both cells lit, comparator-shaped return value. */
  compare(i: number, j: number, note?: string): number {
    const a = this.values[i]
    const b = this.values[j]
    this.rec.record({
      op: 'compare',
      structure: this,
      transient: [
        { index: i, class: 'compare' },
        { index: j, class: 'compare' },
      ],
      // The values, not just the indices: a label of pure mechanics ("compare [2] vs [3]") makes
      // the caption useless exactly on the frame a viewer has stopped to read it.
      label: note ?? `compare [${i}] = ${format(a)} vs [${j}] = ${format(b)}`,
    })
    if (a === b) return 0
    return (a as never) < (b as never) ? -1 : 1
  }

  mark(index: number | readonly number[], cls: MarkClass, note?: string): void {
    const indices = typeof index === 'number' ? [index] : index
    for (const i of indices) this.marks.set(i, cls, note)
    this.rec.record({ op: 'mark', structure: this, label: `mark ${indices.join(', ')} as ${cls}` })
  }

  unmark(index: number | readonly number[]): void {
    const indices = typeof index === 'number' ? [index] : index
    for (const i of indices) this.marks.remove(i)
    this.rec.record({ op: 'mark', structure: this, label: `unmark ${indices.join(', ')}` })
  }

  clearMarks(cls?: MarkClass): void {
    this.marks.clear(cls)
    this.rec.record({ op: 'mark', structure: this, label: cls ? `clear ${cls} marks` : 'clear marks' })
  }

  setWindow(lo: number, hi: number): void {
    this.win = [lo, hi]
    this.rec.record({ op: 'mark', structure: this, label: `window [${lo}..${hi}]` })
  }

  clearWindow(): void {
    this.win = undefined
    this.rec.record({ op: 'mark', structure: this, label: 'clear window' })
  }

  /**
   * Values in order.
   *
   * Throws on a blank-seeded array with a cell nobody ever wrote, mirroring `VizDpTable.get()`.
   * A sentinel would put the caller back where `fill: 0` left them — returning a number the
   * algorithm never decided on — and the whole point of seeding blank is that the difference
   * between "not computed" and "computed to be zero" stops being invisible.
   */
  toArray(): T[] {
    if (this.blank) {
      const missing = this.values.flatMap((v, i) => (v === null ? [i] : []))
      if (missing.length > 0) {
        throw new RangeError(
          `${this.name}[${missing.join('], [')}] was never written — a blank array has no default, so write the value the algorithm settles on`,
        )
      }
    }
    return [...this.values] as T[]
  }

  /**
   * Build the user-facing proxy. Numeric access routes through read/write.
   *
   * The proxy's traps close over the structure, so it is captured once here as `structure`
   * rather than relying on `this` inside the handler (where `this` is the trap's own receiver).
   */
  proxy(): VizArray<T> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const target: VizArrayStructure<T> = this
    const api: Record<string, unknown> = {
      at: (i: number) => target.peek(i),
      push: (...v: T[]) => target.push(...v),
      pop: () => target.pop(),
      shift: () => target.shift(),
      unshift: (...v: T[]) => target.unshift(...v),
      swap: (i: number, j: number) => target.swap(i, j),
      compare: (i: number, j: number, note?: string) => target.compare(i, j, note),
      mark: (i: number | readonly number[], c: MarkClass, n?: string) => target.mark(i, c, n),
      unmark: (i: number | readonly number[]) => target.unmark(i),
      clearMarks: (c?: MarkClass) => target.clearMarks(c),
      setWindow: (lo: number, hi: number) => target.setWindow(lo, hi),
      clearWindow: () => target.clearWindow(),
      toArray: () => target.toArray(),
    }

    return new Proxy(api, {
      get(_t, prop) {
        if (prop === 'length') return target.length
        if (prop === '$id') return target.id
        if (prop === Symbol.iterator) {
          return function* (): IterableIterator<T> {
            for (let i = 0; i < target.length; i += 1) yield target.read(i) as T
          }
        }
        const idx = asIndex(prop)
        if (idx !== undefined) return target.read(idx)
        return api[prop as string]
      },
      set(_t, prop, value) {
        const idx = asIndex(prop)
        if (idx === undefined) return false
        target.write(idx, value as T)
        return true
      },
      has(_t, prop) {
        const idx = asIndex(prop)
        if (idx !== undefined) return idx < target.length
        return prop in api || prop === 'length' || prop === '$id'
      },
    }) as unknown as VizArray<T>
  }
}

export function format(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  return String(value)
}
