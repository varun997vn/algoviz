import type { Recorder, TrackedStructure } from '../recorder.js'
import type {
  KeyMark,
  Mark,
  Mark2D,
  MarkClass,
  NodeId,
  NodeMark,
  StructureId,
  StructureKind,
} from '../types.js'

export interface StructureInit {
  name?: string
}

/** Common plumbing: identity, registration, and a persistent mark set. */
export abstract class BaseStructure implements TrackedStructure {
  readonly id: StructureId
  readonly name: string
  abstract readonly kind: StructureKind

  protected constructor(
    protected readonly rec: Recorder,
    idPrefix: string,
    name: string | undefined,
    fallbackName: string,
  ) {
    this.id = rec.nextId(idPrefix)
    this.name = name ?? fallbackName
  }

  abstract snapshot(transient?: readonly Mark[]): ReturnType<TrackedStructure['snapshot']>
}

/**
 * Persistent marks keyed by index. Marks survive across frames until cleared — that is what
 * makes `visited` and `result` render as accumulating state rather than a one-frame flash.
 */
export class IndexMarkStore {
  private readonly marks = new Map<number, Mark>()

  set(index: number, cls: MarkClass, note?: string): void {
    const mark: Mark = { index, class: cls }
    if (note !== undefined) mark.note = note
    this.marks.set(index, mark)
  }

  remove(index: number): void {
    this.marks.delete(index)
  }

  clear(cls?: MarkClass): void {
    if (!cls) {
      this.marks.clear()
      return
    }
    for (const [k, v] of this.marks) if (v.class === cls) this.marks.delete(k)
  }

  /**
   * Persistent marks first, then this frame's transient ones.
   *
   * Transient marks are *appended* rather than replacing a persistent mark at the same index:
   * the renderer resolves conflicts last-wins, and stripping the transient layer must leave
   * the persistent mark intact. Overwriting would silently lose `result`/`visited` state.
   */
  list(transient?: readonly Mark[]): Mark[] {
    const persistent = [...this.marks.values()]
    if (!transient || transient.length === 0) return persistent
    return [...persistent, ...transient.map((t) => ({ ...t, transient: true }))]
  }

  /** Shift marks to follow their elements after a splice-style mutation. */
  shiftFrom(index: number, delta: number): void {
    const entries = [...this.marks.entries()].sort((a, b) => (delta > 0 ? b[0] - a[0] : a[0] - b[0]))
    this.marks.clear()
    for (const [k, v] of entries) {
      const nk = k >= index ? k + delta : k
      if (nk >= 0) this.marks.set(nk, { ...v, index: nk })
    }
  }
}

export class Mark2DStore {
  private readonly marks = new Map<string, Mark2D>()

  private static key(row: number, col: number): string {
    return `${row}:${col}`
  }

  set(row: number, col: number, cls: MarkClass, note?: string): void {
    const mark: Mark2D = { row, col, class: cls }
    if (note !== undefined) mark.note = note
    this.marks.set(Mark2DStore.key(row, col), mark)
  }

  remove(row: number, col: number): void {
    this.marks.delete(Mark2DStore.key(row, col))
  }

  clear(cls?: MarkClass): void {
    if (!cls) {
      this.marks.clear()
      return
    }
    for (const [k, v] of this.marks) if (v.class === cls) this.marks.delete(k)
  }

  /** Persistent first, transient appended — see `IndexMarkStore.list`. */
  list(transient?: readonly Mark2D[]): Mark2D[] {
    const persistent = [...this.marks.values()]
    if (!transient || transient.length === 0) return persistent
    return [...persistent, ...transient.map((t) => ({ ...t, transient: true }))]
  }
}

export class NodeMarkStore {
  private readonly marks = new Map<NodeId, NodeMark>()

  set(id: NodeId, cls: MarkClass, note?: string): void {
    const mark: NodeMark = { id, class: cls }
    if (note !== undefined) mark.note = note
    this.marks.set(id, mark)
  }

  remove(id: NodeId): void {
    this.marks.delete(id)
  }

  clear(cls?: MarkClass): void {
    if (!cls) {
      this.marks.clear()
      return
    }
    for (const [k, v] of this.marks) if (v.class === cls) this.marks.delete(k)
  }

  /** Persistent first, transient appended — see `IndexMarkStore.list`. */
  list(transient?: readonly NodeMark[]): NodeMark[] {
    const persistent = [...this.marks.values()]
    if (!transient || transient.length === 0) return persistent
    return [...persistent, ...transient.map((t) => ({ ...t, transient: true }))]
  }
}

export class KeyMarkStore {
  private readonly marks = new Map<string, KeyMark>()

  set(key: string, cls: MarkClass, note?: string): void {
    const mark: KeyMark = { key, class: cls }
    if (note !== undefined) mark.note = note
    this.marks.set(key, mark)
  }

  remove(key: string): void {
    this.marks.delete(key)
  }

  clear(cls?: MarkClass): void {
    if (!cls) {
      this.marks.clear()
      return
    }
    for (const [k, v] of this.marks) if (v.class === cls) this.marks.delete(k)
  }

  /** Persistent first, transient appended — see `IndexMarkStore.list`. */
  list(transient?: readonly KeyMark[]): KeyMark[] {
    const persistent = [...this.marks.values()]
    if (!transient || transient.length === 0) return persistent
    return [...persistent, ...transient.map((t) => ({ ...t, transient: true }))]
  }
}

/** Stable string key for Map/Set entries whose keys may be numbers, strings, or booleans. */
export function keyOf(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value) ?? String(value)
}

/** Numeric-index detector for Proxy traps — `"3"` yes, `"length"`/`"-1"`/`"1.5"` no. */
export function asIndex(prop: string | symbol): number | undefined {
  if (typeof prop !== 'string') return undefined
  if (prop.length === 0) return undefined
  const n = Number(prop)
  if (!Number.isInteger(n) || n < 0) return undefined
  return n
}
