import { Recorder } from './recorder.js'
import { VizArrayStructure, type VizArray } from './structures/array.js'
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
 * The instrumentation API a solution is written against.
 *
 * Design rule, enforced by review: **if an instrumented solution doesn't read like the plain
 * one, fix this API rather than contorting the solution.** Structure factories live on `viz`;
 * annotations live on the returned object (`a.mark(i, 'result')`, not `viz.mark(a, i, ...)`).
 */
export class Viz {
  constructor(private readonly rec: Recorder) {}

  // ---- structure factories -------------------------------------------------

  array<T extends Primitive>(values: readonly T[] | number, init: StructureInit = {}): VizArray<T> {
    const seed = typeof values === 'number' ? (new Array<T>(values).fill(0 as T) as T[]) : [...values]
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

  dp1d(size: number, fill: Primitive = 0, init: StructureInit = {}): VizDpTable {
    const s = VizDpTable.oneD(this.rec, size, fill, init)
    this.rec.register(s)
    return s
  }

  dp2d(
    rows: number,
    cols: number,
    fill: Primitive = 0,
    init: StructureInit & { axisLabels?: [string, string] } = {},
  ): VizDpTable {
    const s = VizDpTable.twoD(this.rec, rows, cols, fill, init)
    this.rec.register(s)
    return s
  }

  intervals(
    items: readonly (readonly [number, number])[],
    init: StructureInit = {},
  ): VizIntervals {
    const s = new VizIntervals(this.rec, items, init)
    this.rec.register(s)
    return s
  }

  trie(words: readonly string[] = [], init: StructureInit = {}): VizTrie {
    const s = new VizTrie(this.rec, words, init)
    this.rec.register(s)
    return s
  }

  // ---- cursors, narration, escape hatches ----------------------------------

  /** A named index. Attach to an array/string so it renders as a labelled caret. */
  cursor(name: string, start = 0, attachTo?: { $id?: string } | string, cls: MarkClass = 'active'): VizCursor {
    const id = typeof attachTo === 'string' ? attachTo : attachTo?.$id
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
