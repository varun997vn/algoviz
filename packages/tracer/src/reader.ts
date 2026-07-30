import type { Frame, StructureId, StructureSnapshot, Trace } from './types.js'

/**
 * Random access into a trace.
 *
 * Frames only carry structures that *changed*, so "what did the world look like at frame N?"
 * means, for each structure, finding the most recent frame ≤ N that snapshotted it. A
 * per-structure sorted index of change-frames turns that into a binary search — O(log n) per
 * structure, no keyframe duplication, and the returned snapshot objects are the *same
 * references* the trace already holds.
 *
 * That last property is load-bearing for the UI: `React.memo` on a visualizer keyed by
 * snapshot identity means scrubbing re-renders only the structures that actually moved.
 */
export class TraceReader {
  private readonly changeIndex = new Map<StructureId, number[]>()
  private readonly cache = new Map<number, ReadonlyMap<StructureId, StructureSnapshot>>()
  private readonly strippedCache = new Map<StructureSnapshot, StructureSnapshot>()

  constructor(readonly trace: Trace) {
    for (const frame of trace.frames) {
      for (const id of Object.keys(frame.snapshots)) {
        let list = this.changeIndex.get(id)
        if (!list) {
          list = []
          this.changeIndex.set(id, list)
        }
        list.push(frame.index)
      }
    }
  }

  get frameCount(): number {
    return this.trace.frames.length
  }

  frame(index: number): Frame | undefined {
    return this.trace.frames[index]
  }

  /** Fully-resolved world state at `index`. Cached. */
  at(index: number): ReadonlyMap<StructureId, StructureSnapshot> {
    const cached = this.cache.get(index)
    if (cached) return cached

    const out = new Map<StructureId, StructureSnapshot>()
    for (const id of this.changeIndex.keys()) {
      const snap = this.structureAt(id, index)
      if (snap) out.set(id, snap)
    }

    // Bound the cache so scrubbing a 20k-frame trace can't grow without limit.
    if (this.cache.size > 512) this.cache.clear()
    this.cache.set(index, out)
    return out
  }

  /** Snapshot of one structure at `index`, or undefined if it didn't exist yet. */
  structureAt(id: StructureId, index: number): StructureSnapshot | undefined {
    const changes = this.changeIndex.get(id)
    if (!changes) return undefined
    const frameIdx = lastAtMost(changes, index)
    if (frameIdx === undefined) return undefined
    const snap = this.trace.frames[frameIdx]?.snapshots[id]
    if (!snap) return undefined
    // Viewing the frame that produced this snapshot: show it exactly as recorded.
    if (frameIdx === index) return snap
    return this.withoutTransient(snap)
  }

  /**
   * Drop frame-scoped highlights from a carried-forward snapshot.
   *
   * Memoised on the original snapshot object so repeated resolution returns the *same*
   * stripped instance — visualizers rely on snapshot identity for `React.memo` to work.
   */
  private withoutTransient(snap: StructureSnapshot): StructureSnapshot {
    const memo = this.strippedCache.get(snap)
    if (memo) return memo

    if (!('marks' in snap) || !Array.isArray(snap.marks)) return snap
    const kept = (snap.marks as { transient?: boolean }[]).filter((m) => m.transient !== true)
    if (kept.length === snap.marks.length) {
      this.strippedCache.set(snap, snap)
      return snap
    }
    const stripped = { ...snap, marks: kept } as StructureSnapshot
    this.strippedCache.set(snap, stripped)
    return stripped
  }

  /** Frame indices carrying an explicit `viz.step()` — the player's "next milestone" targets. */
  stepFrames(): number[] {
    return this.trace.frames.filter((f) => f.op === 'step').map((f) => f.index)
  }

  /** Watch values resolved at `index` (they persist forward like snapshots do). */
  watchAt(index: number): Record<string, import('./types.js').Primitive> | undefined {
    for (let i = Math.min(index, this.trace.frames.length - 1); i >= 0; i -= 1) {
      const w = this.trace.frames[i]?.watch
      if (w) return w
    }
    return undefined
  }
}

/** Largest element of a sorted array that is <= target. */
export function lastAtMost(sorted: readonly number[], target: number): number | undefined {
  let lo = 0
  let hi = sorted.length - 1
  let best: number | undefined
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const value = sorted[mid] as number
    if (value <= target) {
      best = value
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

/** Convenience for tests and the MCP server: resolve without building a reader. */
export function resolveFrame(
  trace: Trace,
  index: number,
): ReadonlyMap<StructureId, StructureSnapshot> {
  return new TraceReader(trace).at(index)
}
