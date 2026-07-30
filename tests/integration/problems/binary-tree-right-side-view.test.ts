import { beforeAll, describe, expect, it } from 'vitest'
import { executeRun, type CaseResult } from '@algoviz/runner'
import { TraceReader, type StructureSnapshot, type Trace } from '@algoviz/tracer'

/**
 * Binary Tree Right Side View — frame-sequence assertions.
 *
 * The return value proves almost nothing here. A DFS that carries a depth, walks right-first and
 * keeps the first node it meets at each depth returns the **identical array** while animating no
 * levels at all — no queue, no wave, no notion of "one node per level". The load-bearing
 * assertion in this file is therefore that the number of `level N` scopes equals the length of
 * the answer, and the last test in the first block proves that assertion is not a tautology by
 * running exactly that solution and watching it produce zero scopes with a green result.
 *
 * The rest pins the two things a viewer has to be able to read off the picture:
 *
 * - **The queue is exactly the frontier of one level.** Every node marked `frontier` on the tree
 *   is in the queue at every frame, and on narrated frames the two sets are equal.
 * - **"Rightmost" is a property of the level, not of the tree's shape.** In every level scope the
 *   node that gets the `result` mark is the *last* node dequeued in that scope — and on the trap
 *   cases that node is a left child.
 */

const PROBLEM = 'binary-tree-right-side-view'

type TreeSnapshot = Extract<StructureSnapshot, { kind: 'tree' }>
type QueueSnapshot = Extract<StructureSnapshot, { kind: 'queue' }>
type ArraySnapshot = Extract<StructureSnapshot, { kind: 'array' }>

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

/** Like `only`, but tolerates a structure that has not been declared yet. */
function maybe<K extends StructureSnapshot['kind']>(
  reader: TraceReader,
  frame: number,
  kind: K,
): Extract<StructureSnapshot, { kind: K }> | undefined {
  return [...reader.at(frame).values()].find(
    (s): s is Extract<StructureSnapshot, { kind: K }> => s.kind === kind,
  )
}

function finalTree(trace: Trace): TreeSnapshot {
  const reader = new TraceReader(trace)
  return only(reader, reader.frameCount - 1, 'tree')
}

function finalQueue(trace: Trace): QueueSnapshot {
  const reader = new TraceReader(trace)
  return only(reader, reader.frameCount - 1, 'queue')
}

function finalView(trace: Trace): ArraySnapshot {
  const reader = new TraceReader(trace)
  return only(reader, reader.frameCount - 1, 'array')
}

/**
 * Distinct `level N` scope numbers, in the order they first appear.
 *
 * Matched on the `level N` prefix rather than the whole label — the wave size is narration
 * ("level 2 — 3 node(s) to drain"), not identity, and anchoring the regex to end-of-string would
 * silently return `[]` and turn the load-bearing assertion below into a tautology.
 */
function levelScopes(trace: Trace): number[] {
  const seen: number[] = []
  for (const frame of trace.frames) {
    for (const label of frame.groups) {
      const n = /^level (\d+)\b/.exec(label)?.[1]
      if (n !== undefined && !seen.includes(Number(n))) seen.push(Number(n))
    }
  }
  return seen
}

/** The `level N` scope a frame sits in, or 0 for the seeding frames outside any scope. */
function levelOf(groups: readonly string[]): number {
  const label = groups.find((g) => /^level \d+\b/.test(g))
  return label ? Number(/^level (\d+)\b/.exec(label)?.[1] ?? 0) : 0
}

/** `enqueue "4@t4"` / `dequeue -> "1@t1"` -> `t4` / `t1`. */
function nodeInLabel(label: string | undefined): string | undefined {
  return /@(t\d+)/.exec(label ?? '')?.[1]
}

/** Node ids currently sitting in the queue, decoded from the `value@id` entries. */
function queuedNodes(queue: QueueSnapshot): string[] {
  return queue.values.map((v) => String(v).slice(String(v).indexOf('@') + 1))
}

function nonTransient(tree: TreeSnapshot, cls: string): string[] {
  return tree.marks.filter((m) => m.class === cls && !m.transient).map((m) => m.id)
}

/** For each node ever marked `result`, the frame index where that mark first appears. */
function firstResultFrame(trace: Trace): Map<string, number> {
  const reader = new TraceReader(trace)
  const out = new Map<string, number>()
  for (let i = 0; i < reader.frameCount; i += 1) {
    const tree = maybe(reader, i, 'tree')
    if (!tree) continue
    for (const id of nonTransient(tree, 'result')) if (!out.has(id)) out.set(id, i)
  }
  return out
}

/** Every case name, so the invariants run over the whole set rather than a chosen one. */
const ALL = [
  'example',
  'example — right spine only',
  'example — empty tree',
  'single node',
  'deeper left subtree wins the lower levels',
  'left spine only — every visible node is a left child',
  'right subtree stops early, left keeps going',
  'perfect tree',
  'duplicate values',
  'negative values',
  'long right spine',
]

/** The cases with at least one level to animate. */
const NONEMPTY = ALL.filter((n) => n !== 'example — empty tree')

describe('Binary Tree Right Side View — reference solution', () => {
  it('passes every one of its own cases', () => {
    const failures = [...byName.values()].filter((r) => !r.passed)
    expect(
      failures.map(
        (f) => `${f.name}: got ${JSON.stringify(f.returned)}, want ${JSON.stringify(f.expected)}`,
      ),
    ).toEqual([])
  })

  it('drives a tree, a queue and the answer array together', () => {
    for (const result of byName.values()) {
      const kinds = result.trace.structures.map((s) => s.kind)
      expect(kinds, result.name).toContain('tree')
      expect(kinds, result.name).toContain('queue')
      expect(kinds, result.name).toContain('array')
    }
  })

  it('covers the case the problem is famous for', () => {
    // The visible node at the bottom levels is a *left* child. "Always walk right" returns [1,3]
    // on this tree and is wrong from level 3 down.
    expect(caseByName('deeper left subtree wins the lower levels').returned).toEqual([1, 3, 4, 5])
    expect(caseByName('left spine only — every visible node is a left child').returned).toEqual([
      1, 2, 3, 4,
    ])
  })
})

describe('the picture and the answer agree about how many levels there are', () => {
  it.each(ALL)('%s — one level scope per visible node', (name) => {
    const result = caseByName(name)
    expect(levelScopes(result.trace)).toHaveLength((result.returned as number[]).length)
  })

  it.each(ALL)('%s — scopes are numbered 1..levels with no gaps', (name) => {
    const result = caseByName(name)
    const expected = Array.from({ length: (result.returned as number[]).length }, (_, i) => i + 1)
    expect(levelScopes(result.trace)).toEqual(expected)
  })

  it.each(NONEMPTY)('%s — one narrated step per level, plus a closing one', (name) => {
    const result = caseByName(name)
    const reader = new TraceReader(result.trace)
    expect(reader.stepFrames()).toHaveLength((result.returned as number[]).length + 1)
  })

  it('ends on a caption that states the answer rather than the raw return op', () => {
    for (const name of ALL) {
      const result = caseByName(name)
      const reader = new TraceReader(result.trace)
      expect(reader.captionAt(reader.frameCount - 1), name).toMatch(
        /level\(s\), \d+ node\(s\) visible|the tree is empty/,
      )
    }
  })

  it('is an assertion a depth-tracking DFS fails despite returning the right answer', () => {
    // Proof that the scope count is not a tautology. Right-first DFS keeping the first node it
    // meets at each depth is textbook, correct, and animates one undifferentiated walk in which
    // no level is ever visible. Same array, zero level scopes, and no queue at all.
    const source = `
export default function rightSideView(root: (number | null)[], viz: Viz): number[] {
  const t = viz.tree(root, { name: 'tree' })
  const view = viz.array<number>([], { name: 'view' })
  const walk = (node: string | null, depth: number): void => {
    if (node === null) return
    t.visit(node)
    if (depth === view.length) {
      view.push(t.peek(node) as number)
      t.mark(node, 'result', 'first seen at this depth')
    }
    const { left, right } = t.childrenOf(node)
    walk(right, depth + 1)
    walk(left, depth + 1)
  }
  walk(t.root, 0)
  return view.toArray()
}
`
    const run = executeRun({ problem: PROBLEM, source, caseIndex: 'all' })
    expect(run.diagnostics).toEqual([])
    // It is genuinely correct on every case — that is the whole point.
    expect(run.results.filter((r) => !r.passed).map((r) => r.name)).toEqual([])
    for (const result of run.results) {
      expect(levelScopes(result.trace), `${result.name} animated a level`).toEqual([])
      expect(
        result.trace.structures.map((s) => s.kind),
        `${result.name} drove a queue`,
      ).not.toContain('queue')
    }
  })
})

describe('the queue and the tree stay in lockstep', () => {
  it.each(ALL)('%s — every node marked frontier is in the queue, at every frame', (name) => {
    const result = caseByName(name)
    const reader = new TraceReader(result.trace)
    let checked = 0
    for (let i = 0; i < reader.frameCount; i += 1) {
      // The queue is declared one frame after the tree, so it is legitimately absent at frame 0.
      const queue = maybe(reader, i, 'queue')
      if (!queue) continue
      const tree = only(reader, i, 'tree')
      const queued = queuedNodes(queue)
      expect(
        nonTransient(tree, 'frontier').filter((id) => !queued.includes(id)),
        `frame ${i}: marked frontier but not queued`,
      ).toEqual([])
      checked += 1
    }
    expect(checked).toBeGreaterThan(0)
  })

  it.each(NONEMPTY)('%s — on narrated frames the two agree exactly', (name) => {
    const result = caseByName(name)
    const reader = new TraceReader(result.trace)
    const narrated = new Set(reader.stepFrames())
    let checked = 0
    for (const i of [...narrated, reader.frameCount - 1]) {
      const queue = maybe(reader, i, 'queue')
      if (!queue) continue
      const tree = only(reader, i, 'tree')
      expect(nonTransient(tree, 'frontier').sort(), `frame ${i}: frontier vs queue`).toEqual(
        queuedNodes(queue).sort(),
      )
      checked += 1
    }
    expect(checked).toBeGreaterThan(0)
  })

  it.each(NONEMPTY)('%s — every node is enqueued once and dequeued once', (name) => {
    const result = caseByName(name)
    const enqueued: string[] = []
    const dequeued: string[] = []
    for (const frame of result.trace.frames) {
      const node = nodeInLabel(frame.label)
      if (!node) continue
      if (frame.op === 'enqueue') enqueued.push(node)
      if (frame.op === 'dequeue') dequeued.push(node)
    }
    const size = finalTree(result.trace).nodes.length
    expect(enqueued).toHaveLength(size)
    expect(new Set(enqueued).size).toBe(size)
    expect(dequeued.sort()).toEqual(enqueued.slice().sort())
    // BFS runs to exhaustion here — the queue really does drain.
    expect(finalQueue(result.trace).values).toEqual([])
  })

  it.each(NONEMPTY)('%s — no node is processed in the level it was discovered in', (name) => {
    // The level-by-level invariant. Break it and a child rides the same wave as its parent, which
    // is exactly the animation a per-node BFS produces.
    const result = caseByName(name)
    const discovered = new Map<string, number>()
    const drained = new Map<string, number>()
    for (const frame of result.trace.frames) {
      const node = nodeInLabel(frame.label)
      if (!node) continue
      if (frame.op === 'enqueue') discovered.set(node, levelOf(frame.groups))
      if (frame.op === 'dequeue') drained.set(node, levelOf(frame.groups))
    }
    for (const [node, level] of drained) {
      const at = discovered.get(node)
      expect(at, `${node} was dequeued but never enqueued`).toBeDefined()
      // The root is discovered outside any scope (level 0) and drained in level 1.
      expect(level, `${node} was discovered and drained in the same level`).toBe(at! + 1)
    }
  })

  it.each(NONEMPTY)('%s — a node is never marked visited before the frame that dequeues it', (name) => {
    const result = caseByName(name)
    const reader = new TraceReader(result.trace)
    const dequeuedAt = new Map<string, number>()
    for (const frame of result.trace.frames) {
      if (frame.op !== 'dequeue') continue
      dequeuedAt.set(nodeInLabel(frame.label)!, frame.index)
    }
    const visitedAt = new Map<string, number>()
    for (let i = 0; i < reader.frameCount; i += 1) {
      const tree = maybe(reader, i, 'tree')
      if (!tree) continue
      for (const id of nonTransient(tree, 'visited')) if (!visitedAt.has(id)) visitedAt.set(id, i)
    }
    for (const [id, frame] of visitedAt) {
      const dq = dequeuedAt.get(id)
      expect(dq, `${id} looked visited at frame ${frame} but was never dequeued`).toBeDefined()
      expect(frame, `${id} looked visited at ${frame}, before its dequeue at ${dq}`).toBeGreaterThan(
        dq!,
      )
    }
    expect(visitedAt.size).toBe(dequeuedAt.size)
  })
})

describe('exactly one node per level is the answer, and it is the last one drained', () => {
  it.each(ALL)('%s — as many result marks as the answer is long', (name) => {
    const result = caseByName(name)
    const marks = nonTransient(finalTree(result.trace), 'result')
    expect(new Set(marks).size).toBe((result.returned as number[]).length)
  })

  it.each(NONEMPTY)('%s — one result mark per level scope, and no two in the same scope', (name) => {
    const result = caseByName(name)
    const perLevel = new Map<number, string[]>()
    for (const [id, frame] of firstResultFrame(result.trace)) {
      const level = levelOf(result.trace.frames[frame]!.groups)
      expect(level, `${id} was marked result outside any level scope`).toBeGreaterThan(0)
      perLevel.set(level, [...(perLevel.get(level) ?? []), id])
    }
    const levels = levelScopes(result.trace)
    expect([...perLevel.keys()].sort((a, b) => a - b)).toEqual(levels)
    for (const [level, ids] of perLevel) {
      expect(ids, `level ${level} marked ${ids.length} nodes as the answer`).toHaveLength(1)
    }
  })

  it.each(NONEMPTY)('%s — the marked node is the last one dequeued in its level', (name) => {
    // This is what "rightmost" *means* in a level-order walk, and it is the only reading of the
    // animation that survives the trap cases. Nothing about a node's position in the tree is
    // consulted; only its position in the wave.
    const result = caseByName(name)
    const lastDequeue = new Map<number, string>()
    for (const frame of result.trace.frames) {
      if (frame.op !== 'dequeue') continue
      lastDequeue.set(levelOf(frame.groups), nodeInLabel(frame.label)!)
    }
    for (const [id, frame] of firstResultFrame(result.trace)) {
      const level = levelOf(result.trace.frames[frame]!.groups)
      expect(lastDequeue.get(level), `level ${level}'s answer is not its last dequeue`).toBe(id)
    }
  })

  it.each(ALL)('%s — the marked nodes spell the returned array, top down', (name) => {
    const result = caseByName(name)
    const tree = finalTree(result.trace)
    const valueOf = new Map(tree.nodes.map((n) => [n.id, n.value]))
    const ordered = [...firstResultFrame(result.trace).entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => valueOf.get(id))
    expect(ordered).toEqual(result.returned)
    // And the answer array on screen says the same thing.
    expect(finalView(result.trace).values).toEqual(result.returned)
  })

  it('marks a left child as the answer when the left subtree runs deeper', () => {
    // The trap, asserted on the picture rather than on the return value. On [1,2,3,4,null,...,5]
    // the visible nodes at levels 3 and 4 are both left children, so a solution that walked right
    // would have marked nothing at all down there.
    const result = caseByName('deeper left subtree wins the lower levels')
    const tree = finalTree(result.trace)
    const leftChildren = new Set(tree.nodes.map((n) => n.left).filter((id): id is string => !!id))
    const marked = [...firstResultFrame(result.trace).entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id)
    expect(marked).toHaveLength(4)
    expect(marked.filter((id) => leftChildren.has(id)).length).toBeGreaterThanOrEqual(2)
  })

  it('marks every node on a left spine, where no node has a right child at all', () => {
    const result = caseByName('left spine only — every visible node is a left child')
    const tree = finalTree(result.trace)
    expect(tree.nodes.every((n) => n.right === null)).toBe(true)
    expect(nonTransient(tree, 'result')).toHaveLength(4)
  })
})

describe('the walked edges settle instead of staying lit', () => {
  it.each(NONEMPTY)('%s — no edge is still "active" once the run ends', (name) => {
    // `t.left`/`t.right` mark the edge they walked `'active'` — "being considered right now" — and
    // `EdgeMark` has no transient flag, so nothing in the tracer ever takes it off. Left alone,
    // every edge in the tree ends the run lit as though the algorithm were still on it. The
    // solution settles each edge to `'tree'` on the frame after it walks it; this holds it to that.
    const tree = finalTree(caseByName(name).trace)
    expect(tree.edgeMarks.filter((e) => e.class === 'active')).toEqual([])
    // Every real edge of the tree is part of the BFS tree, so all of them are accounted for.
    const edges = tree.nodes.flatMap((n) => [n.left, n.right].filter(Boolean))
    expect(tree.edgeMarks.filter((e) => e.class === 'tree')).toHaveLength(edges.length)
  })

  it('lights an edge for exactly the frame that walks it', () => {
    const result = caseByName('example')
    const reader = new TraceReader(result.trace)
    const activeFrames = new Map<string, number[]>()
    for (let i = 0; i < reader.frameCount; i += 1) {
      const tree = maybe(reader, i, 'tree')
      if (!tree) continue
      for (const e of tree.edgeMarks) {
        if (e.class !== 'active') continue
        const key = `${e.from}->${e.to}`
        activeFrames.set(key, [...(activeFrames.get(key) ?? []), i])
      }
    }
    expect(activeFrames.size).toBeGreaterThan(0)
    for (const [key, frames] of activeFrames) {
      // One `visit` frame from `t.left`/`t.right`, plus the `enqueue` frame that carries no tree
      // snapshot and therefore resolves forward to it. Anything longer is a stale highlight.
      expect(frames.length, `${key} stayed active for ${frames.length} frames`).toBeLessThanOrEqual(2)
    }
  })
})

describe('the starter teaches the ordering, not just the reference', () => {
  // Five problems have shipped with a fix in the reference and the defect left in the starter, so
  // the starter is asserted rather than trusted. This is the starter with its own TODOs filled in
  // exactly as they instruct — nothing more.
  const source = `
export default function rightSideView(root: (number | null)[], viz: Viz): number[] {
  const t = viz.tree(root, { name: 'tree' })
  const frontier = viz.queue<string>([], { name: 'frontier' })
  const view = viz.array<number>([], { name: 'view' })

  const entry = (id: string) => \`\${t.peek(id) as number}@\${id}\`
  const nodeOf = (e: string) => e.slice(e.indexOf('@') + 1)

  let level = 0
  viz.watch(() => ({ level, seen: view.length, frontier: frontier.size }))

  const discover = (parent: string, child: string | null): void => {
    if (child === null) return
    frontier.push(entry(child))
    t.markEdge(parent, child, 'tree')
    t.mark(child, 'frontier', \`queued for level \${level + 1}\`)
  }

  if (t.root !== null) {
    frontier.push(entry(t.root))
    t.mark(t.root, 'frontier', 'level 1 is just the root')
  }

  while (!frontier.isEmpty) {
    level += 1
    const wave = frontier.size
    viz.group(\`level \${level} — \${wave} node(s) to drain\`, () => {
      for (let i = 0; i < wave; i += 1) {
        const node = nodeOf(frontier.front() as string)
        t.unmark(node)
        frontier.shift()
        t.visit(node)

        if (i === wave - 1) {
          view.push(t.peek(node) as number)
          t.mark(node, 'result', \`rightmost on level \${level}\`)
        }

        discover(node, t.left(node))
        discover(node, t.right(node))
      }
      viz.step(\`level \${level}: \${wave} node(s) drained\`)
    })
  }

  return view.toArray()
}
`

  it('holds every invariant the reference does when filled in as instructed', () => {
    const run = executeRun({ problem: PROBLEM, source, caseIndex: 'all' })
    expect(run.diagnostics).toEqual([])
    expect(run.results.filter((r) => !r.passed).map((r) => r.name)).toEqual([])

    const problems: string[] = []
    for (const result of run.results) {
      const reader = new TraceReader(result.trace)
      const answer = result.returned as number[]

      // One level scope per visible node, numbered without gaps.
      const scopes = levelScopes(result.trace)
      if (scopes.length !== answer.length) problems.push(`${result.name}: ${scopes.length} scopes`)
      scopes.forEach((n, i) => {
        if (n !== i + 1) problems.push(`${result.name}: scope ${n} at position ${i}`)
      })

      for (let i = 0; i < reader.frameCount; i += 1) {
        const queue = maybe(reader, i, 'queue')
        if (!queue) continue
        const tree = only(reader, i, 'tree')
        const queued = queuedNodes(queue)
        // No phantom frontier node, on any frame.
        for (const id of nonTransient(tree, 'frontier')) {
          if (!queued.includes(id)) problems.push(`${result.name} frame ${i}: ${id} not queued`)
        }
      }

      // Exactly one answer node per level, and it is that level's last dequeue.
      const lastDequeue = new Map<number, string>()
      for (const frame of result.trace.frames) {
        if (frame.op !== 'dequeue') continue
        lastDequeue.set(levelOf(frame.groups), nodeInLabel(frame.label)!)
      }
      const perLevel = new Map<number, number>()
      for (const [id, frame] of firstResultFrame(result.trace)) {
        const level = levelOf(result.trace.frames[frame]!.groups)
        perLevel.set(level, (perLevel.get(level) ?? 0) + 1)
        if (lastDequeue.get(level) !== id) {
          problems.push(`${result.name}: level ${level} answer ${id} is not its last dequeue`)
        }
      }
      for (const [level, count] of perLevel) {
        if (count !== 1) problems.push(`${result.name}: level ${level} marked ${count} nodes`)
      }
      if (perLevel.size !== answer.length) {
        problems.push(`${result.name}: ${perLevel.size} marked levels for ${answer.length} values`)
      }

      // And no edge left lit as "being considered right now".
      const stale = finalTree(result.trace).edgeMarks.filter((e) => e.class === 'active')
      if (stale.length > 0) problems.push(`${result.name}: ${stale.length} stale active edges`)
    }
    expect(problems).toEqual([])
  })
})

describe('frame count stays linear in the size of the tree', () => {
  it.each(ALL)('%s', (name) => {
    const result = caseByName(name)
    const size = finalTree(result.trace).nodes.length
    // Each node costs a bounded number of frames: unmark, dequeue, visit, two child probes, and
    // at most one push + one mark for the answer, plus two per child enqueued and a couple per
    // level. Anything quadratic — re-scanning the queue per level, say — blows through this.
    expect(result.frameCount, `${name}: ${result.frameCount} frames for ${size} nodes`)
      .toBeLessThanOrEqual(14 * size + 12)
    expect(result.frameCount).toBeGreaterThan(0)
  })
})
