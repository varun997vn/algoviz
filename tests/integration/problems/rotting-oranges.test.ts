import { beforeAll, describe, expect, it } from 'vitest'
import { executeRun, type CaseResult } from '@algoviz/runner'
import { TraceReader, type StructureSnapshot, type Trace } from '@algoviz/tracer'

/**
 * Rotting Oranges — frame-sequence assertions.
 *
 * The return value being right proves almost nothing here: the answer is a *count of minutes*,
 * and a BFS that processes one cell per iteration returns exactly the same number while showing
 * an animation with no notion of a minute at all. So the load-bearing assertion in this file is
 * that the number of `minute N` scopes in the trace equals the number the solution returned —
 * the picture and the answer have to agree about how long the rot took.
 *
 * The rest guards ordering: a cell must not be shown as done spreading before the frame that
 * dequeues it, and must not enter the queue before the frame that turns it rotten.
 */

const PROBLEM = 'rotting-oranges'

type MatrixSnapshot = Extract<StructureSnapshot, { kind: 'matrix' }>
type QueueSnapshot = Extract<StructureSnapshot, { kind: 'queue' }>

let byName: Map<string, CaseResult>

beforeAll(() => {
  const run = executeRun({ problem: PROBLEM, useReference: true, caseIndex: 'all' })
  expect(run.diagnostics).toEqual([])
  byName = new Map(run.results.map((r) => [r.name, r]))
})

function caseByName(name: string): CaseResult {
  const result = byName.get(name)
  if (!result) throw new Error(`no case named "${name}" — cases: ${[...byName.keys()].join(', ')}`)
  return result
}

function only<K extends StructureSnapshot['kind']>(
  reader: TraceReader,
  frame: number,
  kind: K,
): Extract<StructureSnapshot, { kind: K }> {
  const found = [...reader.at(frame).values()].filter(
    (s): s is Extract<StructureSnapshot, { kind: K }> => s.kind === kind,
  )
  expect(found, `frame ${frame} has ${found.length} ${kind} snapshots`).toHaveLength(1)
  return found[0]!
}

/** Like `only`, but tolerates a structure that has not been created yet. */
function maybe<K extends StructureSnapshot['kind']>(
  reader: TraceReader,
  frame: number,
  kind: K,
): Extract<StructureSnapshot, { kind: K }> | undefined {
  return [...reader.at(frame).values()].find(
    (s): s is Extract<StructureSnapshot, { kind: K }> => s.kind === kind,
  )
}

function finalMatrix(result: CaseResult): MatrixSnapshot {
  const reader = new TraceReader(result.trace)
  return only(reader, reader.frameCount - 1, 'matrix')
}

function finalQueue(result: CaseResult): QueueSnapshot {
  const reader = new TraceReader(result.trace)
  return only(reader, reader.frameCount - 1, 'queue')
}

/** Distinct `minute N` group labels, in the order they first appear. */
function minuteScopes(trace: Trace): string[] {
  const seen: string[] = []
  for (const frame of trace.frames) {
    for (const label of frame.groups) {
      if (/^minute \d+$/.test(label) && !seen.includes(label)) seen.push(label)
    }
  }
  return seen
}

/** `dequeue -> "(1,2)"` / `enqueue "(1,2)"` -> `1,2`. */
function coordInLabel(label: string | undefined): string | undefined {
  return /\((\d+),(\d+)\)/.exec(label ?? '')?.slice(1, 3).join(',')
}

function cells(matrix: MatrixSnapshot): { key: string; value: unknown }[] {
  return matrix.values.flatMap((row, r) => row.map((value, c) => ({ key: `${r},${c}`, value })))
}

const SOLVABLE = [
  'example — rot reaches the far corner',
  'example — no fresh oranges at all',
  'two sources close in from both ends',
  'farthest orange sets the clock',
  'single corridor, one minute per cell',
  'lone rotten orange',
  'entirely empty grid',
]

const IMPOSSIBLE = [
  'example — one orange the rot can never reach',
  'lone fresh orange, nothing rotten',
  'rot does not travel diagonally',
  'fresh orange walled off behind empty cells',
  'fresh oranges but no rot to start',
]

describe('Rotting Oranges — reference solution', () => {
  it('passes every one of its own cases', () => {
    const failures = [...byName.values()].filter((r) => !r.passed)
    expect(
      failures.map((f) => `${f.name}: got ${JSON.stringify(f.returned)}, want ${JSON.stringify(f.expected)}`),
    ).toEqual([])
  })

  it('drives both a matrix and a queue', () => {
    for (const result of byName.values()) {
      const kinds = result.trace.structures.map((s) => s.kind)
      expect(kinds, result.name).toContain('matrix')
      expect(kinds, result.name).toContain('queue')
    }
  })
})

describe('the picture and the answer agree about how long it took', () => {
  // This is the assertion the whole problem exists for. A per-cell BFS returns the same minute
  // count but produces one scope per cell (or none at all), so this fails loudly if the
  // level-by-level structure is ever lost.
  it.each(SOLVABLE)('%s — one minute scope per elapsed minute', (name) => {
    const result = caseByName(name)
    expect(minuteScopes(result.trace)).toHaveLength(result.returned as number)
  })

  it.each(SOLVABLE)('%s — scopes are numbered 1..minutes with no gaps', (name) => {
    const result = caseByName(name)
    const expected = Array.from({ length: result.returned as number }, (_, i) => `minute ${i + 1}`)
    expect(minuteScopes(result.trace)).toEqual(expected)
  })

  it('narrates the seed, every minute, and why it stopped', () => {
    const result = caseByName('example — rot reaches the far corner')
    const reader = new TraceReader(result.trace)
    // One `viz.step` for the seed, one per minute, one closing.
    expect(reader.stepFrames()).toHaveLength(2 + (result.returned as number))
  })

  it('explains the leftover queue instead of leaving it looking like an early exit', () => {
    // The success path exits on `fresh === 0`, so the last wave is still queued. Without a closing
    // step the final caption was the raw op label `return 4` and the only hint that the run was
    // complete was `fresh=0` in the watch panel.
    for (const name of SOLVABLE) {
      const result = caseByName(name)
      const reader = new TraceReader(result.trace)
      const steps = reader.stepFrames()
      const last = reader.trace.frames[steps[steps.length - 1]!]!.label ?? ''
      expect(last, name).toMatch(/nothing to spread to|nothing left to rot/)
    }
  })

  it('says so when a minute rots nothing, which is why the answer will be -1', () => {
    // A stalled minute drains cells and changes not one orange. Rendered like any other minute it
    // gives no clue that the rot has stopped; it is the whole reason the run ends in -1.
    const result = caseByName('example — one orange the rot can never reach')
    const labels = new TraceReader(result.trace)
      .stepFrames()
      .map((i) => result.trace.frames[i]!.label ?? '')
    expect(labels.filter((l) => /nothing rotted/.test(l)).length).toBeGreaterThan(0)
  })

  it('reports minute and fresh counts in the watch panel, ending consistent with the answer', () => {
    const result = caseByName('example — rot reaches the far corner')
    const reader = new TraceReader(result.trace)
    const watch = reader.watchAt(reader.frameCount - 1)
    expect(watch?.minute).toBe(4)
    expect(watch?.fresh).toBe(0)
  })

  it('is an assertion a per-cell BFS fails despite returning the right answer', () => {
    // Proof that the scope count is not a tautology. This solution carries the minute along with
    // each coordinate and takes the maximum — textbook, correct, and it animates a single
    // undifferentiated drain in which no minute is ever visible. Same 4, zero minute scopes.
    const source = `
export default function orangesRotting(grid: number[][], viz: Viz): number {
  const g = viz.matrix(grid, { name: 'grid' })
  const q = viz.queue<string>([], { name: 'frontier' })
  let fresh = 0
  for (let r = 0; r < g.rows; r += 1) {
    for (let c = 0; c < g.cols; c += 1) {
      if (g.peek(r, c) === 2) q.push(\`\${r},\${c},0\`)
      else if (g.peek(r, c) === 1) fresh += 1
    }
  }
  let best = 0
  while (!q.isEmpty) {
    const [r, c, d] = (q.shift() as string).split(',').map(Number)
    if (d > best) best = d
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr
      const nc = c + dc
      if (!g.inBounds(nr, nc) || g.peek(nr, nc) !== 1) continue
      g.set(nr, nc, 2)
      q.push(\`\${nr},\${nc},\${d + 1}\`)
      fresh -= 1
    }
  }
  return fresh > 0 ? -1 : best
}
`
    const run = executeRun({ problem: PROBLEM, source, caseIndex: 0 })
    expect(run.diagnostics).toEqual([])
    expect(run.results[0]?.returned).toBe(4)
    expect(run.results[0]?.passed).toBe(true)
    expect(minuteScopes(run.results[0]!.trace)).toEqual([])
  })

  it('counts BFS levels, not productive minutes, on an impossible grid', () => {
    // The rot still spreads for a while before it stalls; the answer is -1 because a fresh
    // orange survives, not because no minute elapsed.
    const result = caseByName('example — one orange the rot can never reach')
    expect(result.returned).toBe(-1)
    expect(minuteScopes(result.trace).length).toBeGreaterThan(0)
    expect(new TraceReader(result.trace).watchAt(result.frameCount - 1)?.fresh).toBe(1)
  })
})

describe('the queue and the grid stay in lockstep', () => {
  it.each([...SOLVABLE, ...IMPOSSIBLE])(
    '%s — every queued coordinate names an already-rotten cell, at every frame',
    (name) => {
      const result = caseByName(name)
      const reader = new TraceReader(result.trace)
      let checked = 0
      for (let i = 0; i < reader.frameCount; i += 1) {
        // The queue is created one frame after the grid, so it is legitimately absent at frame 0.
        const queue = maybe(reader, i, 'queue')
        if (!queue) continue
        const matrix = only(reader, i, 'matrix')
        for (const key of queue.values) {
          const [r, c] = String(key).slice(1, -1).split(',').map(Number)
          expect(matrix.values[r!]?.[c!], `frame ${i}: queued ${String(key)} is not rotten`).toBe(2)
          checked += 1
        }
      }
      // Guard against the loop vacuously passing on a trace where the queue is always empty.
      if ((result.returned as number) > 0) expect(checked).toBeGreaterThan(0)
    },
  )

  it('has the grid cursor on the cell already, on the frame that dequeues it', () => {
    // The cursor is the only thing tying the queue's front cell to a position in the grid, and the
    // dequeue frame is the instant that explains BFS. Set after the shift, the cursor arrived one
    // frame late *every time*, so on that frame the coordinate existed only in the caption. This
    // resolves the matrix the way the player does, so it asserts what a viewer actually sees.
    const result = caseByName('farthest orange sets the clock')
    const reader = new TraceReader(result.trace)
    let checked = 0
    for (const frame of result.trace.frames) {
      if (frame.op !== 'dequeue') continue
      const coord = coordInLabel(frame.label)
      const cursor = only(reader, frame.index, 'matrix').cursors.find((c) => c.name === 'rotting')
      expect(cursor, `frame ${frame.index} has no "rotting" cursor`).toBeDefined()
      expect(`${cursor!.row},${cursor!.col}`, `frame ${frame.index} dequeues ${coord}`).toBe(coord)
      checked += 1
    }
    expect(checked).toBeGreaterThan(5)
  })

  it.each([...SOLVABLE, ...IMPOSSIBLE])(
    '%s — the frontier marks are exactly the queued cells, at every frame',
    (name) => {
      // The invariant that names what `frontier` means. Marks layer rather than replace, so adding
      // `visited` on dequeue without removing `frontier` left every cell ever queued wearing it:
      // the wavefront grew monotonically into the entire rotten region, stating the opposite of
      // what the two classes exist to distinguish, and 6 of 12 cases ended with a `frontier` count
      // several times the queue length. On screen it looked right only because the renderer takes
      // the last mark on a cell and `visited` happened to be added second.
      const result = caseByName(name)
      const reader = new TraceReader(result.trace)
      const narrated = new Set(reader.stepFrames())
      let checked = 0
      for (let i = 0; i < reader.frameCount; i += 1) {
        const queue = maybe(reader, i, 'queue')
        if (!queue) continue
        const matrix = only(reader, i, 'matrix')
        const queued = [...queue.values].map((v) => String(v).slice(1, -1)).sort()
        const wavefront = matrix.marks
          .filter((m) => m.class === 'frontier' && !m.transient)
          .map((m) => `${m.row},${m.col}`)
          .sort()
        // Never a `frontier` cell that is not in the queue — a phantom wavefront cell is the
        // defect. The ops are ordered so the mark can only ever *trail* the queue, never lead it.
        expect(
          wavefront.filter((c) => !queued.includes(c)),
          `frame ${i}: marked frontier but not queued`,
        ).toEqual([])
        // And on the frames a viewer actually stops at, the two agree exactly.
        if (narrated.has(i) || i === reader.frameCount - 1) {
          expect(wavefront, `frame ${i}: frontier marks vs queue contents`).toEqual(queued)
        }
        checked += 1
      }
      expect(checked).toBeGreaterThan(0)
    },
  )

  it('dequeues every cell it enqueues, at most once each', () => {
    const result = caseByName('farthest orange sets the clock')
    const enqueued: string[] = []
    const dequeued: string[] = []
    for (const frame of result.trace.frames) {
      const coord = coordInLabel(frame.label)
      if (!coord) continue
      if (frame.op === 'enqueue') enqueued.push(coord)
      if (frame.op === 'dequeue') dequeued.push(coord)
    }
    // 16 cells, all of them rot; no cell is ever queued twice.
    expect(enqueued).toHaveLength(16)
    expect(new Set(enqueued).size).toBe(16)
    expect(new Set(dequeued).size).toBe(dequeued.length)
    // Everything dequeued was enqueued first, and only the final wave is left over.
    expect(dequeued.every((d) => enqueued.includes(d))).toBe(true)
    expect(enqueued.length - dequeued.length).toBe(finalQueue(result).values.length)
  })

  it('empties the queue when the rot has nowhere left to go', () => {
    // On an impossible grid BFS runs to exhaustion, so the frontier really does drain.
    for (const name of IMPOSSIBLE) {
      const result = caseByName(name)
      expect(finalQueue(result).values, name).toEqual([])
    }
  })

  it('stops with the last wave still queued when the last orange rots', () => {
    // The loop exits on `fresh === 0`, so the leftover queue is exactly the oranges that rotted
    // in the final minute — an honest picture of "we stopped because there was nothing left",
    // not "we ran out of frontier".
    const result = caseByName('example — rot reaches the far corner')
    const leftover = finalQueue(result).values
    expect(leftover).toEqual(['(2,2)'])
    const matrix = finalMatrix(result)
    expect(matrix.values[2]![2]).toBe(2)
  })
})

describe('nothing is shown as rotten before the frame that rots it', () => {
  it.each([...SOLVABLE, ...IMPOSSIBLE])('%s — enqueued only after the write that rots it', (name) => {
    const result = caseByName(name)
    const reader = new TraceReader(result.trace)

    const firstRotten = new Map<string, number>()
    for (let i = 0; i < reader.frameCount; i += 1) {
      for (const { key, value } of cells(only(reader, i, 'matrix'))) {
        if (value === 2 && !firstRotten.has(key)) firstRotten.set(key, i)
      }
    }

    for (const frame of result.trace.frames) {
      if (frame.op !== 'enqueue') continue
      const coord = coordInLabel(frame.label)!
      const rottenAt = firstRotten.get(coord)
      expect(rottenAt, `${coord} was enqueued but never shown rotten`).toBeDefined()
      expect(rottenAt!, `${coord} entered the queue at frame ${frame.index} before it was rotten`)
        .toBeLessThanOrEqual(frame.index)
    }
  })

  it.each([...SOLVABLE, ...IMPOSSIBLE])('%s — marked spent only after it is dequeued', (name) => {
    const result = caseByName(name)
    const reader = new TraceReader(result.trace)

    // `visited` means "rotten and finished spreading". A cell may not wear it before the frame
    // that pulls it off the queue — that ordering is the difference between an animation of BFS
    // and a pre-baked final state played back.
    const dequeuedAt = new Map<string, number>()
    for (const frame of result.trace.frames) {
      if (frame.op !== 'dequeue') continue
      dequeuedAt.set(coordInLabel(frame.label)!, frame.index)
    }

    const spentAt = new Map<string, number>()
    for (let i = 0; i < reader.frameCount; i += 1) {
      for (const mark of only(reader, i, 'matrix').marks) {
        const key = `${mark.row},${mark.col}`
        if (mark.class === 'visited' && !spentAt.has(key)) spentAt.set(key, i)
      }
    }

    for (const [key, frame] of spentAt) {
      const dq = dequeuedAt.get(key)
      expect(dq, `${key} was marked spent at frame ${frame} but never dequeued`).toBeDefined()
      expect(frame, `${key} looked spent at frame ${frame}, before its dequeue at ${dq}`)
        .toBeGreaterThan(dq!)
    }
    // And every dequeued cell does end up marked spent — no cell is quietly dropped.
    for (const key of dequeuedAt.keys()) expect(spentAt.has(key), `${key} never marked`).toBe(true)
  })

  it('never marks a cell rotten in the same minute it caused another cell to rot', () => {
    // The level-by-level invariant, restated on the grid: a cell written in minute N is only
    // dequeued in minute N+1 or later. Break this and the rot travels faster than a minute.
    const result = caseByName('farthest orange sets the clock')
    const minuteOf = (groups: string[]): number => {
      const label = groups.find((g) => /^minute \d+$/.test(g))
      return label ? Number(label.slice('minute '.length)) : 0
    }

    const rottedIn = new Map<string, number>()
    for (const frame of result.trace.frames) {
      if (frame.op !== 'write') continue
      const key = /write \((\d+),(\d+)\)/.exec(frame.label ?? '')?.slice(1, 3).join(',')
      if (key) rottedIn.set(key, minuteOf(frame.groups))
    }
    expect(rottedIn.size).toBe(15)

    for (const frame of result.trace.frames) {
      if (frame.op !== 'dequeue') continue
      const key = coordInLabel(frame.label)!
      const rotted = rottedIn.get(key)
      if (rotted === undefined) continue // a seed source, rotten from minute 0
      expect(minuteOf(frame.groups), `${key} rotted and spread in the same minute`).toBeGreaterThan(
        rotted,
      )
    }
  })
})

describe('the final grid explains the answer', () => {
  it.each(SOLVABLE)('%s — no fresh orange survives', (name) => {
    const matrix = finalMatrix(caseByName(name))
    expect(cells(matrix).filter((c) => c.value === 1)).toEqual([])
  })

  it.each(SOLVABLE)('%s — every rotten cell is marked frontier or visited', (name) => {
    const matrix = finalMatrix(caseByName(name))
    const marked = new Map(matrix.marks.map((m) => [`${m.row},${m.col}`, m.class]))
    for (const { key, value } of cells(matrix)) {
      if (value !== 2) continue
      expect(['frontier', 'visited'], `${name}: cell ${key} is rotten but unmarked`).toContain(
        marked.get(key),
      )
    }
  })

  it.each(IMPOSSIBLE)('%s — the surviving oranges are called out as unreachable', (name) => {
    const matrix = finalMatrix(caseByName(name))
    const survivors = cells(matrix).filter((c) => c.value === 1)
    expect(survivors.length).toBeGreaterThan(0)
    const excluded = new Set(
      matrix.marks.filter((m) => m.class === 'excluded').map((m) => `${m.row},${m.col}`),
    )
    expect(survivors.map((s) => s.key).filter((k) => !excluded.has(k))).toEqual([])
  })

  it('rots every orange the wave can reach on the walled-off grid', () => {
    const matrix = finalMatrix(caseByName('fresh orange walled off behind empty cells'))
    // [[2,1,0],[0,0,0],[0,0,1]] — (0,1) is reachable and rots, (2,2) is sealed off.
    expect(matrix.values).toEqual([
      [2, 2, 0],
      [0, 0, 0],
      [0, 0, 1],
    ])
  })
})

describe('frame count stays linear in the number of cells', () => {
  it.each([...SOLVABLE, ...IMPOSSIBLE])('%s', (name) => {
    const result = caseByName(name)
    const matrix = finalMatrix(result)
    const cellCount = matrix.values.length * (matrix.values[0]?.length ?? 0)
    // Each cell costs a bounded number of frames (dequeue, cursor, mark, write, enqueue) plus a
    // couple per minute. Quadratic behaviour — re-scanning the grid every minute, say — blows
    // straight through this on the 16-cell case.
    expect(result.frameCount, `${name}: ${result.frameCount} frames for ${cellCount} cells`)
      .toBeLessThanOrEqual(12 * cellCount + 20)
    expect(result.frameCount).toBeGreaterThan(0)
  })
})
