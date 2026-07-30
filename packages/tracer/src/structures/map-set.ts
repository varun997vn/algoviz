import type { Recorder } from '../recorder.js'
import type {
  KeyMark,
  Mark,
  MarkClass,
  Primitive,
  StructureKind,
  StructureSnapshot,
} from '../types.js'
import { BaseStructure, IndexMarkStore, KeyMarkStore, keyOf, type StructureInit } from './base.js'
import { format } from './array.js'

/** Hash map. Rendered as a logical key/value table — buckets are an implementation detail. */
export class VizMap<K extends Primitive, V> extends BaseStructure {
  readonly kind: StructureKind = 'map'
  private readonly entries = new Map<string, { key: K; value: V }>()
  private readonly marks = new KeyMarkStore()

  constructor(rec: Recorder, initial: Iterable<readonly [K, V]> = [], init: StructureInit = {}) {
    super(rec, 'map', init.name, 'map')
    rec.quiet(() => {
      for (const [k, v] of initial) this.set(k, v)
    })
  }

  override snapshot(_transient?: readonly Mark[]): StructureSnapshot {
    return {
      kind: 'map',
      entries: [...this.entries.values()].map((e) => ({ key: keyOf(e.key), value: e.value })),
      marks: this.marks.list(this.pendingKeyMarks),
    }
  }

  private pendingKeyMarks: KeyMark[] | undefined

  private withKeyMark<T>(key: K, cls: MarkClass, fn: () => T): T {
    this.pendingKeyMarks = [{ key: keyOf(key), class: cls }]
    try {
      return fn()
    } finally {
      this.pendingKeyMarks = undefined
    }
  }

  get size(): number {
    return this.entries.size
  }

  set(key: K, value: V): this {
    const k = keyOf(key)
    const existed = this.entries.has(k)
    this.entries.set(k, { key, value })
    this.withKeyMark(key, 'active', () => {
      this.rec.record({
        op: existed ? 'write' : 'insert',
        structure: this,
        label: `${existed ? 'update' : 'insert'} ${format(key)} -> ${format(value as Primitive)}`,
      })
    })
    return this
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(keyOf(key))
    this.withKeyMark(key, 'active', () => {
      this.rec.record({
        op: 'read',
        structure: this,
        label: `get ${format(key)} -> ${entry ? format(entry.value as Primitive) : 'miss'}`,
      })
    })
    return entry?.value
  }

  has(key: K): boolean {
    const found = this.entries.has(keyOf(key))
    this.withKeyMark(key, found ? 'active' : 'excluded', () => {
      this.rec.record({
        op: 'read',
        structure: this,
        label: `has ${format(key)} -> ${found}`,
      })
    })
    return found
  }

  delete(key: K): boolean {
    const removed = this.entries.delete(keyOf(key))
    this.marks.remove(keyOf(key))
    this.rec.record({ op: 'delete', structure: this, label: `delete ${format(key)} -> ${removed}` })
    return removed
  }

  /** Non-recording lookup, for guards you don't want in the timeline. */
  peek(key: K): V | undefined {
    return this.entries.get(keyOf(key))?.value
  }

  mark(key: K, cls: MarkClass, note?: string): void {
    this.marks.set(keyOf(key), cls, note)
    this.rec.record({ op: 'mark', structure: this, label: `mark ${format(key)} as ${cls}` })
  }

  keys(): K[] {
    return [...this.entries.values()].map((e) => e.key)
  }

  values(): V[] {
    return [...this.entries.values()].map((e) => e.value)
  }

  toEntries(): [K, V][] {
    return [...this.entries.values()].map((e) => [e.key, e.value])
  }

  *[Symbol.iterator](): IterableIterator<[K, V]> {
    yield* this.toEntries()
  }
}

/** Hash set. The workhorse for `visited` in graph traversals. */
export class VizSet<T extends Primitive> extends BaseStructure {
  readonly kind: StructureKind = 'set'
  private readonly items = new Map<string, T>()
  private readonly marks = new IndexMarkStore()

  constructor(rec: Recorder, initial: Iterable<T> = [], init: StructureInit = {}) {
    super(rec, 'set', init.name, 'set')
    rec.quiet(() => {
      for (const v of initial) this.add(v)
    })
  }

  override snapshot(transient?: readonly Mark[]): StructureSnapshot {
    return { kind: 'set', values: [...this.items.values()], marks: this.marks.list(transient) }
  }

  get size(): number {
    return this.items.size
  }

  add(value: T): this {
    const k = keyOf(value)
    const existed = this.items.has(k)
    this.items.set(k, value)
    const index = [...this.items.keys()].indexOf(k)
    this.rec.record({
      op: existed ? 'read' : 'insert',
      structure: this,
      // `active`, not `visited`. `visited` is the dim "already processed" class, so an insertion —
      // the operation this panel exists to show — rendered fainter than a lookup did.
      transient: [{ index, class: 'active' }],
      label: existed ? `add ${format(value)} (already present)` : `add ${format(value)}`,
    })
    return this
  }

  has(value: T): boolean {
    const k = keyOf(value)
    const found = this.items.has(k)
    const index = [...this.items.keys()].indexOf(k)
    this.rec.record({
      op: 'read',
      structure: this,
      transient: found ? [{ index, class: 'active' }] : [],
      label: `has ${format(value)} -> ${found}`,
    })
    return found
  }

  /** Non-recording membership check. */
  contains(value: T): boolean {
    return this.items.has(keyOf(value))
  }

  delete(value: T): boolean {
    const k = keyOf(value)
    const index = [...this.items.keys()].indexOf(k)
    const removed = this.items.delete(k)
    // A set's marks are keyed by position, and deleting shifts every later element down one — so
    // without this every persistent mark past the removed element detached from its value and, once
    // past the end, was dropped by the renderer entirely. `VizArrayStructure.shift()` has always
    // called `shiftFrom` for exactly this; `delete` called neither it nor `remove`.
    if (index >= 0) {
      this.marks.remove(index)
      this.marks.shiftFrom(index + 1, -1)
    }
    this.rec.record({ op: 'delete', structure: this, label: `delete ${format(value)} -> ${removed}` })
    return removed
  }

  mark(value: T, cls: MarkClass, note?: string): void {
    const index = [...this.items.keys()].indexOf(keyOf(value))
    if (index >= 0) this.marks.set(index, cls, note)
    // Say so when nothing was marked. Recording a bare `mark x as excluded` for a value the set
    // does not hold put a claim in the op log that the picture never backed up.
    this.rec.record({
      op: 'mark',
      structure: this,
      label:
        index >= 0
          ? `mark ${format(value)} as ${cls}`
          : `mark ${format(value)} as ${cls} (not in the set)`,
    })
  }

  toArray(): T[] {
    return [...this.items.values()]
  }

  *[Symbol.iterator](): IterableIterator<T> {
    yield* this.items.values()
  }
}
