import type { Recorder } from '../recorder.js'
import type {
  Cursor2D,
  Mark,
  Mark2D,
  MarkClass,
  Primitive,
  StructureKind,
  StructureSnapshot,
} from '../types.js'
import { BaseStructure, Mark2DStore, type StructureInit } from './base.js'
import { format } from './array.js'

/** 2D grid — the substrate for maze/island/matrix problems. */
export class VizMatrix<T extends Primitive> extends BaseStructure {
  readonly kind: StructureKind = 'matrix'
  private readonly marks = new Mark2DStore()
  private readonly cursors = new Map<string, Cursor2D>()

  constructor(
    rec: Recorder,
    private readonly values: T[][],
    init: StructureInit = {},
  ) {
    super(rec, 'mtx', init.name, 'grid')
  }

  override snapshot(_transient?: readonly Mark[]): StructureSnapshot {
    return {
      kind: 'matrix',
      values: this.values.map((row) => [...row]),
      cursors: [...this.cursors.values()],
      marks: this.marks.list(this.pending),
    }
  }

  private pending: Mark2D[] | undefined

  get rows(): number {
    return this.values.length
  }

  get cols(): number {
    return this.values[0]?.length ?? 0
  }

  inBounds(row: number, col: number): boolean {
    return row >= 0 && row < this.rows && col >= 0 && col < this.cols
  }

  get(row: number, col: number): T | undefined {
    const value = this.values[row]?.[col]
    this.pending = [{ row, col, class: 'active' }]
    this.rec.record({
      op: 'read',
      structure: this,
      label: `read (${row},${col}) = ${format(value)}`,
    })
    this.pending = undefined
    return value
  }

  /** Non-recording read, for bounds checks and neighbour probing. */
  peek(row: number, col: number): T | undefined {
    return this.values[row]?.[col]
  }

  set(row: number, col: number, value: T): void {
    const target = this.values[row]
    if (!target) throw new RangeError(`row ${row} out of bounds`)
    target[col] = value
    this.pending = [{ row, col, class: 'active' }]
    this.rec.record({
      op: 'write',
      structure: this,
      label: `write (${row},${col}) = ${format(value)}`,
    })
    this.pending = undefined
  }

  cursor(name: string, row: number, col: number, cls: MarkClass = 'active'): void {
    this.cursors.set(name, { name, row, col, class: cls })
    this.rec.record({ op: 'cursor', structure: this, label: `${name} -> (${row},${col})` })
  }

  mark(row: number, col: number, cls: MarkClass, note?: string): void {
    this.marks.set(row, col, cls, note)
    this.rec.record({ op: 'mark', structure: this, label: `mark (${row},${col}) as ${cls}` })
  }

  /** Remove every mark from a cell. */
  unmark(row: number, col: number): void {
    this.marks.remove(row, col)
    this.rec.record({ op: 'mark', structure: this, label: `unmark (${row},${col})` })
  }

  /**
   * Remove one class from a cell, leaving its others intact.
   *
   * The counterpart of marks layering: a grid BFS that puts a cell `on the path` and later takes
   * it off must not also erase the conclusion that it was `visited`.
   */
  unmarkClass(row: number, col: number, cls: MarkClass): void {
    this.marks.removeClass(row, col, cls)
    this.rec.record({ op: 'mark', structure: this, label: `unmark ${cls} at (${row},${col})` })
  }

  clearMarks(cls?: MarkClass): void {
    this.marks.clear(cls)
    this.rec.record({ op: 'mark', structure: this, label: 'clear marks' })
  }

  toArray(): T[][] {
    return this.values.map((row) => [...row])
  }
}

/**
 * A dynamic-programming table.
 *
 * Structurally similar to a matrix but semantically different: it starts empty, gets filled in
 * a specific order, and the interesting thing to see is *which cells the current cell depends
 * on*. `dependsOn()` marks those without the solution having to manage marks by hand.
 */
/**
 * Generic in the cell type on purpose.
 *
 * A non-generic `get(): Primitive` forced `dp.set(i, (dp.get(i-1) as number) + (dp.get(i-2) as
 * number) + ...)` — three casts in the single line that *is* the recurrence, which is exactly the
 * "instrumented code reads like homework" failure this project exists to avoid. `VizMatrix<T>` was
 * already generic; dp was the outlier, and nine dp problems are queued behind it.
 */
export class VizDpTable<T extends Primitive = Primitive> extends BaseStructure {
  readonly kind: StructureKind = 'dp'
  private readonly marks = new Mark2DStore()
  private pending: Mark2D[] | undefined

  private constructor(
    rec: Recorder,
    private readonly values: (T | null)[] | (T | null)[][],
    readonly dims: 1 | 2,
    name: string | undefined,
    private readonly axisLabels: [string, string] | undefined,
  ) {
    super(rec, 'dp', name, 'dp')
  }

  static oneD<T extends Primitive>(
    rec: Recorder,
    size: number,
    fill: T | null = null,
    init: StructureInit = {},
  ): VizDpTable<T> {
    return new VizDpTable<T>(rec, new Array<T | null>(size).fill(fill), 1, init.name, undefined)
  }

  static twoD<T extends Primitive>(
    rec: Recorder,
    rows: number,
    cols: number,
    fill: T | null = null,
    init: StructureInit & { axisLabels?: [string, string] } = {},
  ): VizDpTable<T> {
    const grid = Array.from({ length: rows }, () => new Array<T | null>(cols).fill(fill))
    return new VizDpTable<T>(rec, grid, 2, init.name, init.axisLabels)
  }

  override snapshot(_transient?: readonly Mark[]): StructureSnapshot {
    const snap: Extract<StructureSnapshot, { kind: 'dp' }> = {
      kind: 'dp',
      values:
        this.dims === 1
          ? [...(this.values as (T | null)[])]
          : (this.values as (T | null)[][]).map((r) => [...r]),
      dims: this.dims,
      marks: this.marks.list(this.pending),
    }
    if (this.axisLabels) snap.axisLabels = this.axisLabels
    return snap
  }

  /**
   * Read a computed cell.
   *
   * Throws if the cell has not been written. That is deliberate, and it is what lets `get()` be
   * typed `T` rather than `T | null` — so the line that expresses a recurrence needs no casts,
   * while the table can still be `null`-filled so an *uncomputed* cell renders blank instead of as
   * a plausible `0`. Reading an unwritten dp cell is always a bug in the recurrence order; the
   * alternative was three `as number` casts in the one line that is the algorithm.
   */
  get(i: number, j = 0): T {
    const raw = this.rawAt(i, j)
    this.pending = [{ row: this.dims === 1 ? 0 : i, col: this.dims === 1 ? i : j, class: 'active' }]
    this.rec.record({ op: 'read', structure: this, label: `read dp${this.coord(i, j)}` })
    this.pending = undefined
    if (raw === null || raw === undefined) {
      throw new RangeError(
        `dp${this.coord(i, j)} has not been computed yet — check the order the table is filled in`,
      )
    }
    return raw
  }

  /** Silent read that tolerates an unwritten cell. */
  peek(i: number, j = 0): T | null {
    return this.rawAt(i, j) ?? null
  }

  private rawAt(i: number, j: number): T | null | undefined {
    return this.dims === 1
      ? (this.values as (T | null)[])[i]
      : (this.values as (T | null)[][])[i]?.[j]
  }

  set(i: number, value: T): void
  set(i: number, j: number, value: T): void
  set(i: number, second: number | T, third?: T): void {
    if (this.dims === 1) {
      ;(this.values as (T | null)[])[i] = second as T
      this.pending = [{ row: 0, col: i, class: 'active' }]
      this.rec.record({
        op: 'write',
        structure: this,
        label: `dp[${i}] = ${format(second as Primitive)}`,
      })
    } else {
      const j = second as number
      const row = (this.values as (T | null)[][])[i]
      if (!row) throw new RangeError(`dp row ${i} out of bounds`)
      // The column was unchecked, and the 1-D overload sits on the class regardless of `dims` — so
      // `dp.set(1, 7)` on a 2-D table typechecked and wrote `undefined` with no error anywhere,
      // while `dp.set(1, 7, v)` extended one row past the others into a *ragged* grid that no
      // consumer handles: `GridViz` takes its column count from row 0 and silently drops the rest.
      if (third === undefined) {
        throw new TypeError(`${this.name} is 2-D — use set(row, col, value)`)
      }
      if (j < 0 || j >= row.length) {
        throw new RangeError(`dp column ${j} out of bounds (0..${row.length - 1})`)
      }
      row[j] = third as T
      this.pending = [{ row: i, col: j, class: 'active' }]
      this.rec.record({
        op: 'write',
        structure: this,
        label: `dp[${i}][${j}] = ${format(third as Primitive)}`,
      })
    }
    this.pending = undefined
  }

  /**
   * Mark the cells the value just written was derived from — the recurrence, made visible.
   *
   * Emitted through the *transient* channel, so the highlight lasts exactly one frame by
   * construction. Writing it into the persistent store and deleting it afterwards was wrong twice
   * over: the delete was class-blind and destroyed any `visited`/`result` state on those cells,
   * and the mark survived on every carried-forward frame until the table was next touched — so a
   * solution that narrated between iterations showed stale dependency arrows against captions
   * that had already moved on. It also made `never-marked-at-end compare` unable to fail, because
   * the terminal frame is re-snapshotted after the delete.
   *
   * Accepts plain indices for a 1-D table; `[row, col]` pairs for a 2-D one.
   */
  dependsOn(cells: readonly number[] | readonly [number, number][], note?: string): void {
    const pairs: [number, number][] = cells.map((cell) =>
      typeof cell === 'number' ? [0, cell] : [cell[0], cell[1]],
    )
    this.pending = pairs.map(([row, col]) => ({
      row,
      col,
      class: 'compare' as const,
      ...(note !== undefined ? { note } : {}),
    }))
    this.rec.record({ op: 'compare', structure: this, label: note ?? 'recurrence inputs' })
    this.pending = undefined
  }

  mark(row: number, col: number, cls: MarkClass, note?: string): void {
    this.marks.set(row, col, cls, note)
    this.rec.record({ op: 'mark', structure: this, label: `mark (${row},${col}) as ${cls}` })
  }

  private coord(i: number, j: number): string {
    return this.dims === 1 ? `[${i}]` : `[${i}][${j}]`
  }

  toArray(): (T | null)[] | (T | null)[][] {
    return this.dims === 1
      ? [...(this.values as (T | null)[])]
      : (this.values as (T | null)[][]).map((r) => [...r])
  }
}
