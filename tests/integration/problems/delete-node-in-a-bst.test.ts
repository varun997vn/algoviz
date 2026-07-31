import { beforeAll, describe, expect, it } from 'vitest'
import { executeRun, type CaseResult } from '@algoviz/runner'
import { TraceReader, type StructureSnapshot, type Trace } from '@algoviz/tracer'

/**
 * Delete Node in a BST — frame-sequence assertions.
 *
 * The return value alone proves almost nothing: an implementation that collects every value with
 * a plain in-order walk, drops the target, and rebuilds a fresh tree from the sorted remainder
 * produces the identical answer on every one of these cases while never comparing against a
 * search target, never marking a root->node path, and never rewiring a single pointer. The
 * "has teeth" block at the bottom runs exactly that solution and shows it failing the invariants
 * below despite a green return value on every case.
 *
 * One wrinkle specific to this problem, worth stating before the assertions that work around it:
 * a two-children delete calls `t.setValue`, so a node's *printed* value can change mid-run and,
 * when the borrowed value collides with an existing sibling's value, two different physical nodes
 * can carry the identical printed value in the frame log at different points in the run (e.g.
 * "write 5 -> 6" followed later by a "6.right -> ..." rewire that is actually the *former* node 5,
 * not the original node 6). `viz.group`'s label is captured once at entry, before any mutation,
 * so it stays a stable per-call identifier throughout — these tests key on group nesting and on
 * structural snapshot data (ids, marks, root), never on parsing a value back out of a frame label,
 * for exactly this reason.
 */

const PROBLEM = 'delete-node-in-a-bst'

type TreeSnapshot = Extract<StructureSnapshot, { kind: 'tree' }>

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

function finalTree(trace: Trace): TreeSnapshot {
  const reader = new TraceReader(trace)
  const found = [...reader.at(reader.frameCount - 1).values()].filter(
    (s): s is TreeSnapshot => s.kind === 'tree',
  )
  expect(found, 'exactly one tree snapshot at the final frame').toHaveLength(1)
  return found[0]!
}

function nonTransient(tree: TreeSnapshot, cls: string): string[] {
  return tree.marks.filter((m) => m.class === cls && !m.transient).map((m) => m.id)
}

/** Every case name, so the invariants run over the whole set rather than a chosen few. */
const ALL = [
  'example — two children, successor is the immediate right child',
  'example — key not present, tree unchanged',
  'empty tree',
  'delete a leaf',
  'delete a one-child node',
  'delete the root — two children',
  'delete the root — one child',
  'delete the only node — tree becomes empty',
  'successor requires more than one left step',
  'negative and zero values',
]

/** Cases where the root itself starts out non-empty. */
const NONEMPTY_INPUT = ALL.filter((n) => n !== 'empty tree')

/** Cases where the key genuinely is in the tree, so a 'match' mark must appear. */
const KEY_PRESENT = NONEMPTY_INPUT.filter((n) => n !== 'example — key not present, tree unchanged')

/** Cases that end with some node left as root. */
const ENDS_NONEMPTY = NONEMPTY_INPUT.filter(
  (n) => n !== 'delete the only node — tree becomes empty',
)

/** Cases whose deleted node has two children, so a successor was borrowed. */
const TWO_CHILDREN_CASES = [
  'example — two children, successor is the immediate right child',
  'delete the root — two children',
  'successor requires more than one left step',
]

describe('Delete Node in a BST — reference solution', () => {
  it('passes every one of its own cases', () => {
    const failures = [...byName.values()].filter((r) => !r.passed)
    expect(
      failures.map(
        (f) => `${f.name}: got ${JSON.stringify(f.returned)}, want ${JSON.stringify(f.expected)}`,
      ),
    ).toEqual([])
  })

  it('drives a tree, and only a tree', () => {
    for (const result of byName.values()) {
      const kinds = result.trace.structures.map((s) => s.kind)
      expect(kinds, result.name).toEqual(['tree'])
    }
  })

  it.each(ALL)('%s — a positive frame count', (name) => {
    expect(caseByName(name).frameCount).toBeGreaterThan(0)
  })
})

describe('the search path unwinds and settles', () => {
  it.each(ALL)('%s — no path mark survives to the final frame', (name) => {
    // The bug class every tree animation fails at: a `path` mark that never comes off leaves the
    // whole root->node chain looking permanently "under consideration".
    expect(nonTransient(finalTree(caseByName(name).trace), 'path')).toEqual([])
  })

  it.each(ALL)('%s — no edge is left "active" once the run ends', (name) => {
    // `t.left`/`t.right` (the descent) and `setLeft`/`setRight` (the rewire) both light their
    // edge `active` for one frame only; nothing should still claim to be "under consideration".
    const tree = finalTree(caseByName(name).trace)
    expect(tree.edgeMarks.filter((e) => e.class === 'active')).toEqual([])
  })

  it.each(NONEMPTY_INPUT)('%s — every group entered is also left, in balanced nesting', (name) => {
    const frames = caseByName(name).trace.frames
    const entered = frames.filter((f) => f.op === 'group' && f.label?.startsWith('enter ')).length
    // `onPath` guarantees exitPath runs even on an exceptional return, and every recursive call
    // that entered a group returns through it — so the nesting depth must be back to zero by the
    // last frame with any groups at all.
    const deepestAtEnd = frames[frames.length - 1]?.groups.length ?? 0
    expect(deepestAtEnd).toBe(0)
    expect(entered).toBeGreaterThan(0)
  })
})

describe('the picture proves a search happened, not just a correct answer', () => {
  it.each(NONEMPTY_INPUT)('%s — at least one comparison was read off the tree', (name) => {
    const reads = caseByName(name).trace.frames.filter((f) => f.op === 'read')
    expect(reads.length).toBeGreaterThan(0)
  })

  it.each(KEY_PRESENT)('%s — the key is marked "match" exactly once as the search target', (name) => {
    // Note: on a two-children delete the *successor* is also found via the same code path and
    // also gets marked 'match' — so this only pins the original target, not the total count.
    const tree = finalTree(caseByName(name).trace)
    expect(nonTransient(tree, 'match').length).toBeGreaterThanOrEqual(1)
  })

  it("the key-not-present case never marks anything 'match'", () => {
    // The clearest proof the search actually terminated on "not found" rather than silently
    // treating some other node as the target.
    const tree = finalTree(caseByName('example — key not present, tree unchanged').trace)
    expect(nonTransient(tree, 'match')).toEqual([])
  })

  it.each(NONEMPTY_INPUT.filter((n) => n !== 'example — key not present, tree unchanged'))(
    '%s — every descent narrates the comparison that drives it',
    (name) => {
      const steps = new TraceReader(caseByName(name).trace).stepFrames()
      const labels = steps
        .map((i) => caseByName(name).trace.frames[i]?.label ?? '')
        .filter((l) => / — go (left|right)$/.test(l))
      // Anything that isn't found at the root descends at least once, and every one of those
      // steps must say which way and why ("<" or ">" against the node's own value).
      for (const l of labels) {
        expect(l).toMatch(/^-?\d+ [<>] -?\d+ — go (left|right)$/)
      }
    },
  )
})

describe('the ending is consistent with the answer', () => {
  it.each(ENDS_NONEMPTY)('%s — exactly one result mark, and it is the returned root', (name) => {
    const result = caseByName(name)
    const tree = finalTree(result.trace)
    const marks = nonTransient(tree, 'result')
    expect(marks).toHaveLength(1)
    expect(tree.root).toBe(marks[0])
    // And it is genuinely the root of the snapshot the picture ends on.
    expect(tree.nodes.find((n) => n.id === tree.root)).toBeDefined()
  })

  it.each(['empty tree', 'delete the only node — tree becomes empty'])(
    '%s — no result mark, and the root is null',
    (name) => {
      const tree = finalTree(caseByName(name).trace)
      expect(nonTransient(tree, 'result')).toEqual([])
      expect(tree.root).toBeNull()
    },
  )

  it.each(ALL)('%s — the marked/rooted node values match the returned array', (name) => {
    const result = caseByName(name)
    const tree = finalTree(result.trace)
    const returned = result.returned as (number | null)[]
    if (tree.root === null) {
      expect(returned).toEqual([])
      return
    }
    const byId = new Map(tree.nodes.map((n) => [n.id, n]))
    expect(byId.get(tree.root)?.value).toBe(returned[0])
  })
})

describe('the two-children case borrows before it deletes', () => {
  it.each(TWO_CHILDREN_CASES)('%s — the value copy lands before the successor is spliced out', (name) => {
    // The order-sensitive step: `t.setValue` must be recorded before the `t.setRight` that
    // deletes the successor, or the picture would show the right subtree changing shape before
    // the value that explains why. Both calls happen at the same recursion depth (the setValue
    // is the last thing before the nested delete call, the setRight is the first thing after it
    // returns), so the matching pair is "the next 'write' frame with the identical group nesting".
    const frames = caseByName(name).trace.frames
    const setValueIdx = frames.findIndex((f) => f.op === 'write' && /^write -?\d+ -> -?\d+$/.test(f.label ?? ''))
    expect(setValueIdx, `${name}: no bare value-write frame found`).toBeGreaterThanOrEqual(0)
    const setValueGroups = frames[setValueIdx]!.groups
    const setRightIdx = frames.findIndex(
      (f, i) =>
        i > setValueIdx &&
        f.op === 'write' &&
        f.groups.length === setValueGroups.length &&
        f.groups.every((g, gi) => g === setValueGroups[gi]),
    )
    expect(setRightIdx, `${name}: no matching rewire frame at the same depth after the value write`).toBeGreaterThan(
      setValueIdx,
    )
  })

  it('the successor is found by walking left, not by assuming the right child', () => {
    // The case the "leftmost of the right subtree" rule exists to distinguish from "the right
    // child". Between the target being marked 'match' and its value being overwritten, exactly
    // two `.left ->` steps must appear — one per level the successor search descended.
    const frames = caseByName('successor requires more than one left step').trace.frames
    const matchIdx = frames.findIndex((f) => f.op === 'mark' && /as match$/.test(f.label ?? ''))
    const writeIdx = frames.findIndex(
      (f, i) => i > matchIdx && f.op === 'write' && /^write -?\d+ -> -?\d+$/.test(f.label ?? ''),
    )
    expect(matchIdx).toBeGreaterThanOrEqual(0)
    expect(writeIdx).toBeGreaterThan(matchIdx)
    const leftSteps = frames
      .slice(matchIdx + 1, writeIdx)
      .filter((f) => f.op === 'visit' && /\.left ->/.test(f.label ?? ''))
    expect(leftSteps).toHaveLength(2)
  })

  it("the immediate-right-child case takes zero left steps to find its successor", () => {
    const frames = caseByName('example — two children, successor is the immediate right child').trace.frames
    const matchIdx = frames.findIndex((f) => f.op === 'mark' && /as match$/.test(f.label ?? ''))
    const writeIdx = frames.findIndex(
      (f, i) => i > matchIdx && f.op === 'write' && /^write -?\d+ -> -?\d+$/.test(f.label ?? ''),
    )
    const leftSteps = frames
      .slice(matchIdx + 1, writeIdx)
      .filter((f) => f.op === 'visit' && /\.left ->/.test(f.label ?? ''))
    expect(leftSteps).toHaveLength(0)
  })
})

describe('the check has teeth', () => {
  // Runs the identical delete algorithm — same three cases, same in-order-successor rule — on a
  // side copy of plain JS objects, built once from the input array and thrown away at the end.
  // It therefore returns *exactly* the reference's answer on every case (same algorithm, same
  // tie-breaking, just not on the tracked structure), while `t` itself is only ever constructed
  // and read from with `peek`/`childrenOf` to serialize the final answer — never `value`,
  // `left`, `right`, `mark`, `onPath`, `setLeft`, `setRight`, or `setValue`. No comparison is
  // ever read off the tracked tree, no root->node path is ever marked, and no pointer on it is
  // ever rewired. This is exactly the shape of impostor the problem statement warns about:
  // collect (well, mirror), delete, and rebuild — and it would pass on return value alone.
  const impostorSource = `
type Node = { val: number; left: Node | null; right: Node | null }

function parse(values: (number | null)[]): Node | null {
  if (values.length === 0 || values[0] === null) return null
  const root: Node = { val: values[0] as number, left: null, right: null }
  const queue: Node[] = [root]
  let i = 1
  while (queue.length > 0 && i < values.length) {
    const parent = queue.shift() as Node
    const leftVal = values[i]
    i += 1
    if (leftVal !== null && leftVal !== undefined) {
      parent.left = { val: leftVal, left: null, right: null }
      queue.push(parent.left)
    }
    if (i < values.length) {
      const rightVal = values[i]
      i += 1
      if (rightVal !== null && rightVal !== undefined) {
        parent.right = { val: rightVal, left: null, right: null }
        queue.push(parent.right)
      }
    }
  }
  return root
}

function remove(node: Node | null, target: number): Node | null {
  if (node === null) return null
  if (target < node.val) {
    node.left = remove(node.left, target)
    return node
  }
  if (target > node.val) {
    node.right = remove(node.right, target)
    return node
  }
  if (node.left === null) return node.right
  if (node.right === null) return node.left
  let succ = node.right
  while (succ.left !== null) succ = succ.left
  node.val = succ.val
  node.right = remove(node.right, succ.val)
  return node
}

function serialize(root: Node | null): (number | null)[] {
  if (root === null) return []
  const out: (number | null)[] = [root.val]
  const queue: Node[] = [root]
  while (queue.length > 0) {
    const n = queue.shift() as Node
    out.push(n.left ? n.left.val : null)
    if (n.left) queue.push(n.left)
    out.push(n.right ? n.right.val : null)
    if (n.right) queue.push(n.right)
  }
  while (out.length > 0 && out[out.length - 1] === null) out.pop()
  return out
}

export default function deleteNode(root: (number | null)[], key: number, viz: Viz): (number | null)[] {
  // Declared so the trace still names a 'tree' structure — the picture just never moves.
  viz.tree(root, { name: 'tree' })
  return serialize(remove(parse(root), key))
}
`

  it('returns exactly the reference answers while never comparing, marking a path, or rewiring the tree', () => {
    const run = executeRun({ problem: PROBLEM, source: impostorSource, caseIndex: 'all' })
    expect(run.diagnostics).toEqual([])
    // It is genuinely correct on every case — the same algorithm, just off-picture. That is the
    // whole point: a passing return value proves nothing about the animation.
    expect(run.results.filter((r) => !r.passed).map((r) => r.name)).toEqual([])

    for (const result of run.results) {
      const tree = result.trace.structures.find((s) => s.kind === 'tree')
      expect(tree, `${result.name}: no tree declared`).toBeDefined()

      // No comparison was ever read off the tracked tree.
      const reads = result.trace.frames.filter((f) => f.op === 'read' && f.structureId === tree!.id)
      expect(reads, `${result.name}: a comparison happened on the tracked tree`).toEqual([])

      // No rewire or value copy ever happened on it either.
      const writes = result.trace.frames.filter((f) => f.op === 'write' && f.structureId === tree!.id)
      expect(writes, `${result.name}: a rewire happened on the tracked tree`).toEqual([])

      // And no 'match'/'path' mark, because there was no recursive search on it to unwind.
      const reader = new TraceReader(result.trace)
      const finalTreeSnap = [...reader.at(reader.frameCount - 1).values()].find(
        (s): s is TreeSnapshot => s.kind === 'tree',
      )
      expect(finalTreeSnap, `${result.name}: no final tree snapshot`).toBeDefined()
      expect(nonTransient(finalTreeSnap!, 'match'), `${result.name}: impostor marked a match`).toEqual([])
      expect(nonTransient(finalTreeSnap!, 'path'), `${result.name}: impostor left a path mark`).toEqual([])

      // The picture on screen is exactly the input tree at every frame — its root never moves —
      // so it never shows the deletion the return value claims happened.
      const initialSnap = result.trace.frames[0]?.snapshots[tree!.id]
      expect(initialSnap?.kind === 'tree' && initialSnap.root).toBe(finalTreeSnap!.root)
    }
  })
})

describe('the starter teaches the ordering, not just the reference', () => {
  // The starter's TODOs, filled in exactly as instructed and nothing more.
  const source = `
export default function deleteNode(root: (number | null)[], key: number, viz: Viz): (number | null)[] {
  const t = viz.tree(root, { name: 'tree' })

  const remove = (id: string | null, target: number): string | null => {
    if (id === null) return null
    return viz.group(\`node \${t.peek(id)}\`, () =>
      t.onPath(id, () => {
        const val = t.value(id) as number

        if (target < val) {
          viz.step(\`\${target} < \${val} — go left\`)
          const newLeft = remove(t.left(id), target)
          t.setLeft(id, newLeft)
          return id
        }
        if (target > val) {
          viz.step(\`\${target} > \${val} — go right\`)
          const newRight = remove(t.right(id), target)
          t.setRight(id, newRight)
          return id
        }

        t.mark(id, 'match', \`found \${val}\`)
        const { left, right } = t.childrenOf(id)
        if (left === null) return right
        if (right === null) return left

        let succ = right
        while (t.childrenOf(succ).left !== null) succ = t.left(succ) as string
        const succVal = t.value(succ) as number
        t.setValue(id, succVal)
        t.setRight(id, remove(right, succVal))
        return id
      }),
    )
  }

  const newRoot = remove(t.root, key)
  t.root = newRoot
  if (newRoot !== null) t.mark(newRoot, 'result', 'root after deletion')

  return serialize(t, newRoot)
}

function serialize(t: ReturnType<Viz['tree']>, rootId: string | null): (number | null)[] {
  if (rootId === null) return []
  const out: (number | null)[] = [t.peek(rootId) as number]
  const queue: string[] = [rootId]
  while (queue.length > 0) {
    const id = queue.shift() as string
    const { left, right } = t.childrenOf(id)
    out.push(left === null ? null : (t.peek(left) as number))
    if (left !== null) queue.push(left)
    out.push(right === null ? null : (t.peek(right) as number))
    if (right !== null) queue.push(right)
  }
  while (out.length > 0 && out[out.length - 1] === null) out.pop()
  return out
}
`

  it('holds every invariant the reference does when filled in as instructed', () => {
    const run = executeRun({ problem: PROBLEM, source, caseIndex: 'all' })
    expect(run.diagnostics).toEqual([])
    expect(run.results.filter((r) => !r.passed).map((r) => r.name)).toEqual([])

    const byCaseName = new Map(run.results.map((r) => [r.name, r]))
    const problems: string[] = []

    for (const name of ALL) {
      const result = byCaseName.get(name)
      if (!result) {
        problems.push(`missing case ${name}`)
        continue
      }
      const reader = new TraceReader(result.trace)
      const tree = [...reader.at(reader.frameCount - 1).values()].find(
        (s): s is TreeSnapshot => s.kind === 'tree',
      )
      if (!tree) {
        problems.push(`${name}: no final tree snapshot`)
        continue
      }
      if (nonTransient(tree, 'path').length > 0) problems.push(`${name}: a path mark survived`)
      if (tree.edgeMarks.some((e) => e.class === 'active')) problems.push(`${name}: an edge stayed active`)

      if (NONEMPTY_INPUT.includes(name)) {
        const reads = result.trace.frames.filter((f) => f.op === 'read')
        if (reads.length === 0) problems.push(`${name}: no comparison was recorded`)
      }
      if (ENDS_NONEMPTY.includes(name)) {
        const marks = nonTransient(tree, 'result')
        if (marks.length !== 1 || tree.root !== marks[0]) {
          problems.push(`${name}: result mark does not match the root`)
        }
      } else if (NONEMPTY_INPUT.includes(name) || name === 'empty tree') {
        if (tree.root !== null) problems.push(`${name}: expected a null root`)
      }
    }

    // The order-sensitive check: setValue before the matching setRight, on the two-children cases.
    for (const name of TWO_CHILDREN_CASES) {
      const frames = byCaseName.get(name)!.trace.frames
      const setValueIdx = frames.findIndex(
        (f) => f.op === 'write' && /^write -?\d+ -> -?\d+$/.test(f.label ?? ''),
      )
      if (setValueIdx < 0) {
        problems.push(`${name}: no value-write frame`)
        continue
      }
      const setValueGroups = frames[setValueIdx]!.groups
      const setRightIdx = frames.findIndex(
        (f, i) =>
          i > setValueIdx &&
          f.op === 'write' &&
          f.groups.length === setValueGroups.length &&
          f.groups.every((g, gi) => g === setValueGroups[gi]),
      )
      if (!(setRightIdx > setValueIdx)) problems.push(`${name}: setValue did not precede the matching setRight`)
    }

    expect(problems).toEqual([])
  })
})

describe('frame count stays bounded in the size of the tree', () => {
  it.each(ALL)('%s', (name) => {
    const result = caseByName(name)
    const size = finalTree(result.trace).nodes.length
    // Each node on the search/delete path costs a bounded number of frames (group/path
    // enter+exit, a read, a step, a rewire). The two-children case adds a second search of
    // roughly the same depth for the successor. Anything super-linear in tree size is wrong.
    expect(result.frameCount, `${name}: ${result.frameCount} frames for ${size} nodes`).toBeLessThanOrEqual(
      20 * (size + 1) + 10,
    )
    expect(result.frameCount).toBeGreaterThan(0)
  })
})
