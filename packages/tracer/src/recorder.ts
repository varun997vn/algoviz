import {
  BudgetExceededError,
  DEFAULT_VIZ_OPTIONS,
  type Cursor,
  type Frame,
  type Mark,
  type OpKind,
  type Primitive,
  type StructureId,
  type StructureKind,
  type StructureMeta,
  type StructureSnapshot,
  type Trace,
  type TraceTruncation,
  type VizOptions,
} from './types.js'

/**
 * Minimal shape the recorder needs from a cursor. Declared here rather than importing
 * `VizCursor` so the cursor module can depend on the recorder without a cycle.
 */
export interface CursorLike {
  readonly attachedTo: StructureId | undefined
  toSnapshot(): Cursor
}

/**
 * Anything the recorder can ask for a snapshot. Every tracked structure implements this.
 *
 * `transient` marks apply to a single frame only (the "you are looking at index 3 right now"
 * highlight implied by the op itself). Persistent marks — visited, result — are owned by the
 * structure and survive across frames until explicitly cleared.
 */
export interface TrackedStructure {
  readonly id: StructureId
  readonly name: string
  readonly kind: StructureKind
  snapshot(transient?: readonly Mark[]): StructureSnapshot
}

export interface RecordOptions {
  op: OpKind
  structure?: TrackedStructure
  transient?: readonly Mark[]
  label?: string
}

/**
 * Owns the frame log, the structure registry, budgets, and grouping.
 *
 * Structures call `record()` on every mutation; users call it indirectly through
 * `viz.step()` / `viz.group()`. The recorder is deliberately dumb about *what* a
 * structure is — it only asks for snapshots.
 */
export class Recorder {
  private readonly frames: Frame[] = []
  private readonly structures = new Map<StructureId, TrackedStructure>()
  private readonly metas: StructureMeta[] = []
  private readonly groupStack: string[] = []
  private readonly watchers: (() => Record<string, Primitive>)[] = []
  private readonly cursors: CursorLike[] = []
  private readonly opts: Required<VizOptions>
  private readonly startedAt: number

  private opCount = 0
  private quietDepth = 0
  private currentLine: number | undefined
  private truncated: TraceTruncation | undefined
  private idCounter = 0
  private finished = false

  constructor(options: VizOptions = {}) {
    this.opts = { ...DEFAULT_VIZ_OPTIONS, ...options }
    this.startedAt = Date.now()
  }

  nextId(prefix: string): StructureId {
    this.idCounter += 1
    return `${prefix}${this.idCounter}`
  }

  register(structure: TrackedStructure): void {
    if (this.structures.has(structure.id)) {
      throw new Error(`Structure id "${structure.id}" registered twice`)
    }
    this.structures.set(structure.id, structure)
    this.metas.push({
      id: structure.id,
      name: structure.name,
      kind: structure.kind,
      order: this.metas.length,
    })
    this.record({ op: 'init', structure, label: `create ${structure.name}` })
  }

  setLine(line: number): void {
    this.currentLine = line
  }

  registerCursor(cursor: CursorLike): void {
    this.cursors.push(cursor)
    // Re-snapshot whatever the caret attached to, so it is on screen from the frame that declares
    // it rather than from the next frame that happens to touch that structure. Cursors resolve at
    // snapshot time, so a caret declared here was previously invisible until something else moved
    // — which meant the opening frames of every array and string problem showed a structure with
    // no pointers on it while the watch panel beside it already reported their values.
    this.recordCursorMove(cursor, `declare ${cursor.toSnapshot().name}`)
  }

  /**
   * Cursors attached to a structure, resolved at snapshot time.
   *
   * Cursors live on the recorder rather than on a structure so that one cursor can index
   * whichever array or string it belongs to. An unattached cursor binds to the first
   * registered structure, which is what you want in the overwhelmingly common case of a
   * solution with a single input array.
   */
  cursorsFor(id: StructureId): Cursor[] {
    const out: Cursor[] = []
    for (const c of this.cursors) {
      if (this.resolveCursorTarget(c) === id) out.push(c.toSnapshot())
    }
    return out
  }

  private resolveCursorTarget(cursor: CursorLike): StructureId | undefined {
    return cursor.attachedTo ?? this.metas[0]?.id
  }

  /**
   * Record a cursor move. Re-snapshots the structure the cursor points into — otherwise the
   * caret would visibly lag, because the array itself didn't change.
   */
  recordCursorMove(cursor: CursorLike, label: string): void {
    const targetId = this.resolveCursorTarget(cursor)
    const structure = targetId ? this.structures.get(targetId) : undefined
    this.record({ op: 'cursor', label, ...(structure ? { structure } : {}) })
  }

  addWatcher(fn: () => Record<string, Primitive>): void {
    this.watchers.push(fn)
  }

  /** Suppress frame emission for setup/parsing code. Ops still count against the budget. */
  quiet<T>(fn: () => T): T {
    this.quietDepth += 1
    try {
      return fn()
    } finally {
      this.quietDepth -= 1
    }
  }

  group<T>(label: string, fn: () => T): T {
    this.groupStack.push(label)
    this.record({ op: 'group', label: `enter ${label}` })
    try {
      return fn()
    } finally {
      this.groupStack.pop()
    }
  }

  step(label: string): void {
    this.record({ op: 'step', label })
  }

  record({ op, structure, transient, label }: RecordOptions): void {
    if (this.finished) return

    this.opCount += 1
    this.checkBudget()

    if (this.quietDepth > 0) return
    if (this.frames.length >= this.opts.maxFrames) {
      this.fail('maxFrames')
    }

    const snapshots: Record<StructureId, StructureSnapshot> = {}
    if (structure) {
      snapshots[structure.id] = structure.snapshot(transient)
    }

    const frame: Frame = {
      index: this.frames.length,
      op,
      groups: [...this.groupStack],
      snapshots,
    }
    if (structure) frame.structureId = structure.id
    if (label !== undefined) frame.label = label
    if (this.currentLine !== undefined) frame.line = this.currentLine

    const watch = this.sampleWatchers()
    if (watch) frame.watch = watch

    this.frames.push(frame)
  }

  /**
   * Emit a frame carrying snapshots of *every* structure. Used for the terminal frame so a
   * player parked at the end shows fully-resolved state without walking backwards.
   */
  recordAll(op: OpKind, label?: string): void {
    if (this.finished) return
    const snapshots: Record<StructureId, StructureSnapshot> = {}
    for (const s of this.structures.values()) {
      snapshots[s.id] = s.snapshot()
    }
    const frame: Frame = {
      index: this.frames.length,
      op,
      groups: [...this.groupStack],
      snapshots,
    }
    if (label !== undefined) frame.label = label
    if (this.currentLine !== undefined) frame.line = this.currentLine
    const watch = this.sampleWatchers()
    if (watch) frame.watch = watch
    this.frames.push(frame)
  }

  private sampleWatchers(): Record<string, Primitive> | undefined {
    if (this.watchers.length === 0) return undefined
    const out: Record<string, Primitive> = {}
    for (const fn of this.watchers) {
      try {
        Object.assign(out, fn())
      } catch {
        // A watcher touching an out-of-scope variable must never break the run.
      }
    }
    return Object.keys(out).length > 0 ? out : undefined
  }

  private checkBudget(): void {
    if (this.opCount > this.opts.maxOps) this.fail('maxOps')
    // Checking the clock on every op is measurably slow; every 512 ops is plenty.
    if ((this.opCount & 511) === 0 && Date.now() - this.startedAt > this.opts.timeBudgetMs) {
      this.fail('timeout')
    }
  }

  private fail(reason: TraceTruncation['reason']): never {
    this.truncated = {
      reason,
      atFrame: this.frames.length,
      message: `Budget exhausted (${reason}) after ${this.frames.length} frames and ${this.opCount} operations.`,
    }
    this.finished = true
    throw new BudgetExceededError(reason, this.toTrace())
  }

  toTrace(): Trace {
    const trace: Trace = {
      frames: this.frames,
      structures: this.metas,
      opCount: this.opCount,
    }
    if (this.truncated) trace.truncated = this.truncated
    return trace
  }
}
