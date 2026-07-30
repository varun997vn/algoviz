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
export class VizDpTable extends BaseStructure {
  readonly kind: StructureKind = 'dp'
  private readonly marks = new Mark2DStore()
  private pending: Mark2D[] | undefined

  private constructor(
    rec: Recorder,
    private readonly values: Primitive[] | Primitive[][],
    readonly dims: 1 | 2,
    name: string | undefined,
    private readonly axisLabels: [string, string] | undefined,
  ) {
    super(rec, 'dp', name, 'dp')
  }

  static oneD(rec: Recorder, size: number, fill: Primitive, init: StructureInit = {}): VizDpTable {
    return new VizDpTable(rec, new Array<Primitive>(size).fill(fill), 1, init.name, undefined)
  }

  static twoD(
    rec: Recorder,
    rows: number,
    cols: number,
    fill: Primitive,
    init: StructureInit & { axisLabels?: [string, string] } = {},
  ): VizDpTable {
    const grid = Array.from({ length: rows }, () => new Array<Primitive>(cols).fill(fill))
    return new VizDpTable(rec, grid, 2, init.name, init.axisLabels)
  }

  override snapshot(_transient?: readonly Mark[]): StructureSnapshot {
    const snap: Extract<StructureSnapshot, { kind: 'dp' }> = {
      kind: 'dp',
      values:
        this.dims === 1
          ? [...(this.values as Primitive[])]
          : (this.values as Primitive[][]).map((r) => [...r]),
      dims: this.dims,
      marks: this.marks.list(this.pending),
    }
    if (this.axisLabels) snap.axisLabels = this.axisLabels
    return snap
  }

  get(i: number, j = 0): Primitive {
    const value =
      this.dims === 1 ? (this.values as Primitive[])[i] : (this.values as Primitive[][])[i]?.[j]
    this.pending = [{ row: this.dims === 1 ? 0 : i, col: this.dims === 1 ? i : j, class: 'active' }]
    this.rec.record({ op: 'read', structure: this, label: `read dp${this.coord(i, j)}` })
    this.pending = undefined
    return value
  }

  peek(i: number, j = 0): Primitive {
    return this.dims === 1 ? (this.values as Primitive[])[i] : (this.values as Primitive[][])[i]?.[j]
  }

  set(i: number, value: Primitive): void
  set(i: number, j: number, value: Primitive): void
  set(i: number, second: number | Primitive, third?: Primitive): void {
    if (this.dims === 1) {
      ;(this.values as Primitive[])[i] = second as Primitive
      this.pending = [{ row: 0, col: i, class: 'active' }]
      this.rec.record({
        op: 'write',
        structure: this,
        label: `dp[${i}] = ${format(second as Primitive)}`,
      })
    } else {
      const j = second as number
      const row = (this.values as Primitive[][])[i]
      if (!row) throw new RangeError(`dp row ${i} out of bounds`)
      row[j] = third as Primitive
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

  toArray(): Primitive[] | Primitive[][] {
    return this.dims === 1
      ? [...(this.values as Primitive[])]
      : (this.values as Primitive[][]).map((r) => [...r])
  }
}
