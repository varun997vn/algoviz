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
  compare(i: number, j: number, note?: string): void
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

  constructor(
    rec: Recorder,
    private values: T[],
    init: StructureInit = {},
  ) {
    super(rec, 'arr', init.name, 'array')
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

  read(index: number): T | undefined {
    const value = this.values[index]
    this.rec.record({
      op: 'read',
      structure: this,
      transient: [{ index, class: 'active' }],
      label: `read [${index}] = ${format(value)}`,
    })
    return value
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
    return this.values[index]
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
    return value
  }

  shift(): T | undefined {
    const value = this.values.shift()
    this.marks.shiftFrom(0, -1)
    this.rec.record({ op: 'shift', structure: this, label: `shift -> ${format(value)}` })
    return value
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
    const a = this.values[i] as T
    const b = this.values[j] as T
    this.values[i] = b
    this.values[j] = a
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

  compare(i: number, j: number, note?: string): void {
    this.rec.record({
      op: 'compare',
      structure: this,
      transient: [
        { index: i, class: 'compare' },
        { index: j, class: 'compare' },
      ],
      label: note ?? `compare [${i}] vs [${j}]`,
    })
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

  toArray(): T[] {
    return [...this.values]
  }

  /** Build the user-facing proxy. Numeric access routes through read/write. */
  proxy(): VizArray<T> {
    const target = this
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
