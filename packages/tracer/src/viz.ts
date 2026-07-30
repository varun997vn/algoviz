import { Recorder } from './recorder.js'
import { VizArrayStructure, type ArrayInit, type VizArray } from './structures/array.js'
import { VizCursor } from './structures/cursor.js'
import { VizDpTable, VizMatrix } from './structures/grid.js'
import { VizHeap, type HeapInit } from './structures/heap.js'
import { VizList } from './structures/list.js'
import { VizMap, VizSet } from './structures/map-set.js'
import { VizQueue, VizStack } from './structures/stack-queue.js'
import { VizIntervals, VizString } from './structures/text.js'
import { VizGraph, type GraphInit } from './structures/graph.js'
import { VizTree, type TreeInput } from './structures/tree.js'
import { VizTrie } from './structures/trie.js'
import type { MarkClass, Primitive, Trace, VizOptions } from './types.js'
import type { StructureInit } from './structures/base.js'

/**
 * What `viz.cursor` will attach to: a structure that actually renders a free-standing caret, or a
 * raw structure id.
 *
 * **`$id` is the marker, and that is the whole point.** A `viz.cursor` is resolved at snapshot time
 * through `Recorder.cursorsFor(id)`, and exactly two structures call it — `VizArrayStructure` and
 * `VizString`. Both expose `$id`; nothing else does. Every other structure inherits `id` from
 * `BaseStructure`, so an `AttachTarget` that accepted `{ id: string }` accepted all thirteen kinds
 * — and for eleven of them `viz.cursor` compiled, registered a cursor, and rendered nothing, for
 * ever, with no error anywhere.
 *
 * That included two structures whose snapshots *do* carry a `cursors` field: `VizMatrix` and
 * `VizList` populate theirs from their own `cursor()` / `setCursors()` methods, not from
 * `cursorsFor`, so a `viz.cursor` pointed at them was silently dropped just the same. Those methods
 * are the right API for them, and the compile error now says so instead of leaving it to be
 * discovered by an audit.
 */
export type AttachTarget = { $id: string } | string

/**
 * The instrumentation API a solution is written against.
 *
 * Design rule, enforced by review: **if an instrumented solution doesn't read like the plain
 * one, fix this API rather than contorting the solution.** Structure factories live on `viz`;
 * annotations live on the returned object (`a.mark(i, 'result')`, not `viz.mark(a, i, ...)`).
 */
export class Viz {
  constructor(private readonly rec: Recorder) {}

  // ---- structure factories -------------------------------------------------

  /**
   * A tracked array, from values or from a size.
   *
   * A sized array zero-fills by default. Pass `{ fill: null }` when the array is an *output* the
   * solution builds: an untouched cell then renders blank rather than as a `0` indistinguishable
   * from a decided one, and `toArray()` throws instead of inventing a default. See `ArrayInit`.
   */
  array<T extends Primitive>(
    values: readonly T[] | number,
    init: ArrayInit<T> = {},
  ): VizArray<T> {
    const fill = init.fill === undefined ? (0 as T) : init.fill
    const seed: (T | null)[] =
      typeof values === 'number' ? new Array<T | null>(values).fill(fill) : [...values]
    const s = new VizArrayStructure<T>(this.rec, seed, init)
    this.rec.register(s)
    return s.proxy()
  }

  matrix<T extends Primitive>(values: readonly (readonly T[])[], init: StructureInit = {}): VizMatrix<T> {
    const s = new VizMatrix<T>(
      this.rec,
      values.map((r) => [...r]),
      init,
    )
    this.rec.register(s)
    return s
  }

  string(value: string, init: StructureInit = {}): VizString {
    const s = new VizString(this.rec, value, init)
    this.rec.register(s)
    return s
  }

  stack<T extends Primitive>(initial: readonly T[] = [], init: StructureInit = {}): VizStack<T> {
    const s = new VizStack<T>(this.rec, initial, init)
    this.rec.register(s)
    return s
  }

  queue<T extends Primitive>(initial: readonly T[] = [], init: StructureInit = {}): VizQueue<T> {
    const s = new VizQueue<T>(this.rec, initial, init)
    this.rec.register(s)
    return s
  }

  deque<T extends Primitive>(initial: readonly T[] = [], init: StructureInit = {}): VizQueue<T> {
    const s = new VizQueue<T>(this.rec, initial, { ...init, deque: true })
    this.rec.register(s)
    return s
  }

  set<T extends Primitive>(initial: Iterable<T> = [], init: StructureInit = {}): VizSet<T> {
    const s = new VizSet<T>(this.rec, initial, init)
    this.rec.register(s)
    return s
  }

  map<K extends Primitive, V>(
    initial: Iterable<readonly [K, V]> = [],
    init: StructureInit = {},
  ): VizMap<K, V> {
    const s = new VizMap<K, V>(this.rec, initial, init)
    this.rec.register(s)
    return s
  }

  heap<T extends string | number>(initial: readonly T[] = [], init: HeapInit<T> = {}): VizHeap<T> {
    const s = new VizHeap<T>(this.rec, initial, init)
    this.rec.register(s)
    return s
  }

  list<T extends Primitive>(
    values: readonly T[] = [],
    init: StructureInit & { doubly?: boolean } = {},
  ): VizList<T> {
    const s = new VizList<T>(this.rec, values, init)
    this.rec.register(s)
    return s
  }

  tree(input: TreeInput, init: StructureInit = {}): VizTree {
    const s = new VizTree(this.rec, input, init)
    this.rec.register(s)
    return s
  }

  graph(init: GraphInit = {}): VizGraph {
    const s = new VizGraph(this.rec, init)
    this.rec.register(s)
    return s
  }

  dp1d<T extends Primitive = number>(
    size: number,
    fill: T | null = null,
    init: StructureInit = {},
  ): VizDpTable<T> {
    const s = VizDpTable.oneD<T>(this.rec, size, fill, init)
    this.rec.register(s)
    return s
  }

  dp2d<T extends Primitive = number>(
    rows: number,
    cols: number,
    fill: T | null = null,
    init: StructureInit & { axisLabels?: [string, string] } = {},
  ): VizDpTable<T> {
    const s = VizDpTable.twoD<T>(this.rec, rows, cols, fill, init)
    this.rec.register(s)
    return s
  }

  /**
   * A timeline of intervals.
   *
   * Takes `readonly number[][]` rather than a tuple type on purpose: every intervals problem on
   * LeetCode hands you `number[][]`, which is not assignable to `[number, number][]`, so the tuple
   * signature forced `.map((p) => [p[0], p[1]] as const)` — pure ceremony in the line that should
   * read like the plain solution.
   */
  intervals(
    items: readonly (readonly number[])[],
    init: StructureInit = {},
  ): VizIntervals {
    const pairs = items.map((p) => [p[0] ?? 0, p[1] ?? 0] as const)
    const s = new VizIntervals(this.rec, pairs, init)
    this.rec.register(s)
    return s
  }

  trie(words: readonly string[] = [], init: StructureInit = {}): VizTrie {
    const s = new VizTrie(this.rec, words, init)
    this.rec.register(s)
    return s
  }

  // ---- cursors, narration, escape hatches ----------------------------------

  /**
   * A named index. Attach to an array or string so it renders as a labelled caret.
   *
   * `attachTo` takes an array or a string, a raw structure id, or nothing (in which case the
   * cursor binds to the first structure declared — right for the common single-array solution).
   * Anything else is a compile error; see `AttachTarget` for why, and for which method to use
   * instead on a matrix or a list.
   */
  cursor(
    name: string,
    start = 0,
    attachTo?: AttachTarget,
    cls: MarkClass = 'active',
  ): VizCursor {
    const id =
      attachTo === undefined ? undefined : typeof attachTo === 'string' ? attachTo : attachTo.$id
    const c = new VizCursor(this.rec, name, start, id, cls)
    this.rec.registerCursor(c)
    return c
  }

  /** Emit a narrated frame. The label is carried forward as the player's current caption. */
  step(label: string): void {
    this.rec.step(label)
  }

  /** Scope a block. Nested groups render as a call-stack / loop-nesting outline. */
  group<T>(label: string, body: () => T): T {
    return this.rec.group(label, body)
  }

  /**
   * Register a sampler for the variable-watch panel. Called on every subsequent frame, so
   * plain locals show up without a `watch()` call on every line.
   */
  watch(sampler: () => Record<string, Primitive>): void {
    this.rec.addWatcher(sampler)
  }

  /** Run setup/parsing code without emitting frames. Ops still count against the budget. */
  quiet<T>(body: () => T): T {
    return this.rec.quiet(body)
  }

  /** Record the current source line. Injected automatically by the runner's transform. */
  line(n: number): void {
    this.rec.setLine(n)
  }
}

export interface RunTraceResult<T> {
  value: T
  trace: Trace
}

/**
 * Run an instrumented solution and collect its trace.
 *
 * The final frame snapshots *every* structure so a player parked at the end shows fully
 * resolved state, and so `trace_inspect`-style tooling can read the answer without walking.
 */
export function trace<T>(fn: (viz: Viz) => T, options: VizOptions = {}): RunTraceResult<T> {
  const rec = new Recorder(options)
  const viz = new Viz(rec)
  const value = fn(viz)
  rec.recordAll('return', `return ${JSON.stringify(value) ?? 'undefined'}`)
  const built = rec.toTrace()
  built.result = { returned: value }
  return { value, trace: built }
}
