import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 199 — Binary Tree Right Side View.
 *
 * The first problem to walk a tree in *level order*, and the first to drive a tree and a queue
 * together. That pairing is the explanation: the queue holds exactly the frontier of one level,
 * the tree shows where that frontier sits, and the answer is the last node drained from each
 * wave.
 *
 * Three decisions carry the animation:
 *
 * 1. **A level is one loop iteration, not one dequeue.** `wave` snapshots `frontier.size` and the
 *    inner loop drains exactly that many nodes, so a child discovered *now* is not processed
 *    until the next wave. A DFS that carries a depth and keeps the first node seen at each depth
 *    returns the identical array while animating no levels at all — the integration test proves
 *    that, because the return value alone cannot tell the two apart.
 * 2. **`frontier` marks == queue contents, at every frame.** A node is marked `frontier` only
 *    after it has been pushed, and un-marked *before* it is shifted off, so the highlight can
 *    only ever trail the queue and never lead it. Marks layer rather than replace, so the mark
 *    has to come off explicitly: `visit` adds `visited` and would otherwise leave the whole
 *    visited region wearing `frontier` for the rest of the run.
 * 3. **"Rightmost" is a property of the level, not of the tree's shape.** The famous trap in this
 *    problem is that the answer is *not* "always go right" — a left subtree can run deeper than
 *    the right one, and then a left child is the node you see. The `deeper left subtree …` and
 *    `left spine …` cases pin that, and the picture makes it obvious because the `result` mark
 *    lands on a node with no right sibling anywhere above it.
 *
 * This solution reported two API gaps, and both were closed in the same commit that added it —
 * so what follows is what the tracer now does, not what this had to work around:
 *
 * - `t.left`/`t.right` used to light the edge they walked as `'active'` with **nothing ever
 *   turning it off**, because `EdgeMark` had no `transient` flag and `TraceReader` only stripped
 *   `snap.marks`. Both are fixed: the walk highlight is transient and lasts one frame by
 *   construction. `discover()` still calls `markEdge(parent, child, 'tree')`, but that is now a
 *   positive statement rather than a cleanup — a BFS accepts every child it finds, so the edge is
 *   part of the tree the traversal built, and it should persist after the walk highlight goes.
 * - `VizTree` had no per-node, per-class unmark, so dropping `frontier` at dequeue meant
 *   `unmark(id)` — every class at once — which was safe only by the accident that a queued node
 *   carries no other mark yet. `unmarkClass(id, cls)` exists now and is what this uses; the
 *   invariant in point 2 no longer depends on that accident holding.
 */
export function reference(root: (number | null)[], viz: Viz): number[] {
  const t = viz.tree(root, { name: 'tree' })
  // The queue takes primitives, and a tree node is identified by an opaque id (`t4`) while the
  // tree draws its *value*. Queueing the bare id leaves the queue panel reading `[t4 t5]` beside
  // circles labelled `4` and `5`, with nothing connecting the two — the same problem Rotting
  // Oranges had with coordinates, and the same fix: encode it so the cell still reads as the
  // thing a viewer can see. Value first, node id after it.
  const frontier = viz.queue<string>([], { name: 'frontier' })
  const view = viz.array<number>([], { name: 'view' })

  const entry = (id: string): string => `${t.peek(id) as number}@${id}`
  const nodeOf = (e: string): string => e.slice(e.indexOf('@') + 1)

  let level = 0
  viz.watch(() => ({ level, seen: view.length, frontier: frontier.size }))

  /**
   * Queue a child and light the edge we came down.
   *
   * Pushed first and marked second, so the `frontier` highlight trails the queue instead of
   * leading it — there is one frame per op, and a node shown on the frontier before it is in the
   * queue is a picture of something that did not happen.
   *
   * `t.left`/`t.right` light the edge they walked transiently, so it goes out on its own after one
   * frame. `markEdge` states the lasting fact instead: this edge is part of the tree the BFS
   * built. It records no frame of its own, so it rides on the next frame to snapshot the tree —
   * the `mark` below.
   */
  const discover = (parent: string, child: string | null): void => {
    if (child === null) return
    frontier.push(entry(child))
    t.markEdge(parent, child, 'tree')
    t.mark(child, 'frontier', `queued for level ${level + 1}`)
  }

  if (t.root !== null) {
    frontier.push(entry(t.root))
    t.mark(t.root, 'frontier', 'level 1 is just the root')
  }

  while (!frontier.isEmpty) {
    level += 1
    // Snapshot the size *before* draining. These are exactly the nodes at this depth, and they
    // are the only ones this iteration is allowed to touch.
    const wave = frontier.size

    viz.group(`level ${level} — ${wave} node(s) to drain`, () => {
      for (let i = 0; i < wave; i += 1) {
        // `front()` reads without recording, so the frame that dequeues already knows which node
        // it is and the un-marking below can happen before the shift.
        const node = nodeOf(frontier.front() as string)
        // Only the `frontier` class comes off. `unmark(node)` would drop every class on the node,
        // which happens to be equivalent here and would stop being so the moment a node carried a
        // mark before it was dequeued.
        t.unmarkClass(node, 'frontier')
        frontier.shift()
        t.visit(node)

        // The last node drained from this wave is the one you can see from the right. Nothing
        // about the tree's shape decides it — only its position in the level.
        if (i === wave - 1) {
          // Answer written first, mark second: the mark announces a value that is already there.
          view.push(t.peek(node) as number)
          t.mark(node, 'result', `rightmost on level ${level}`)
        }

        discover(node, t.left(node))
        discover(node, t.right(node))
      }
      viz.step(
        `level ${level}: ${wave} node(s), you see ${view.at(level - 1) ?? '—'}` +
          (frontier.isEmpty ? ' — nothing below it' : `; ${frontier.size} node(s) on level ${level + 1}`),
      )
    })
  }

  viz.step(
    level === 0
      ? 'the tree is empty — nothing to see'
      : `${level} level(s), ${level} node(s) visible: ${JSON.stringify(view.toArray())}`,
  )
  return view.toArray()
}

const starter = `// Standing on the right of the tree you see exactly one node per level: the last one
// dequeued in each wave. Walk the tree level by level — snapshot the queue size, then
// drain exactly that many nodes, so a child discovered now waits for the next level.
export default function rightSideView(root: (number | null)[], viz: Viz): number[] {
  const t = viz.tree(root, { name: 'tree' })
  // The queue holds primitives, so a node goes in as "value@id" — the value is what the tree
  // draws, the id is what \`t.left\`/\`t.right\`/\`t.visit\` need back.
  const frontier = viz.queue<string>([], { name: 'frontier' })
  const view = viz.array<number>([], { name: 'view' })

  const entry = (id: string) => \`\${t.peek(id) as number}@\${id}\`
  const nodeOf = (e: string) => e.slice(e.indexOf('@') + 1)

  let level = 0
  viz.watch(() => ({ level, seen: view.length, frontier: frontier.size }))

  const discover = (parent: string, child: string | null): void => {
    if (child === null) return
    // TODO: three calls, in this order, and the order is the point:
    //   1. push \`entry(child)\` onto \`frontier\`
    //   2. record the edge with \`t.markEdge(parent, child, 'tree')\` — \`t.left\`/\`t.right\` light
    //      it transiently for the one frame that walked it; this says it is part of the tree the
    //      BFS built, which lasts. \`markEdge\` emits no frame of its own, so it has to come
    //      before a call that does.
    //   3. mark the child 'frontier'
    // Each of 1 and 3 is its own frame, so marking first shows a node on the frontier before it
    // is in the queue. The mark may trail the queue; it must never lead it.
  }

  if (t.root !== null) {
    frontier.push(entry(t.root))
    t.mark(t.root, 'frontier', 'level 1 is just the root')
  }

  while (!frontier.isEmpty) {
    level += 1
    // Read the size BEFORE draining: these are exactly the nodes on this level.
    const wave = frontier.size
    viz.group(\`level \${level} — \${wave} node(s) to drain\`, () => {
      for (let i = 0; i < wave; i += 1) {
        // \`front()\` reads without recording, so the node is known before the shift.
        const node = nodeOf(frontier.front() as string)
        // 'frontier' means "queued, not yet processed", so it has to come off here. Marks layer
        // rather than replace, so \`t.visit\` alone would leave it on forever — and \`unmarkClass\`
        // rather than \`unmark\` so only that one claim is retracted.
        t.unmarkClass(node, 'frontier')
        frontier.shift()
        t.visit(node)

        // TODO: if this is the last node of the wave (i === wave - 1) it is the one you see from
        // the right — push its value onto \`view\` first, then mark it 'result'.

        discover(node, t.left(node))
        discover(node, t.right(node))
      }
      viz.step(\`level \${level}: \${wave} node(s) drained\`)
    })
  }

  return view.toArray()
}
`

export const binaryTreeRightSideView: ProblemDefinition = {
  id: 'p199',
  leetcode: 199,
  slug: 'binary-tree-right-side-view',
  title: 'Binary Tree Right Side View',
  difficulty: 'medium',
  category: 'binary-tree-bfs',
  statement:
    'Given a binary tree in level-order array form, imagine standing on its right side. Return ' +
    'the values of the nodes you can see, ordered from the top down — one per level. Beware the ' +
    'obvious wrong answer: it is not "always walk right", because a left subtree can run deeper ' +
    'than the right one, and then a left child is the node you see.',
  structures: ['tree', 'queue', 'array'],
  comparator: 'deep',
  entry: 'rightSideView',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    { name: 'example', args: [[1, 2, 3, null, 5, null, 4]], expected: [1, 3, 4], tags: ['example'] },
    { name: 'example — right spine only', args: [[1, null, 3]], expected: [1, 3], tags: ['example'] },
    { name: 'example — empty tree', args: [[]], expected: [], tags: ['example', 'edge'] },
    { name: 'single node', args: [[1]], expected: [1], tags: ['edge'] },
    {
      // The trap. Level 3's visible node is 4 — a *left* child — because 3 has no children at all
      // and the left subtree runs two levels deeper than the right one.
      name: 'deeper left subtree wins the lower levels',
      args: [[1, 2, 3, 4, null, null, null, 5]],
      expected: [1, 3, 4, 5],
      tags: ['edge'],
    },
    {
      name: 'left spine only — every visible node is a left child',
      args: [[1, 2, null, 3, null, 4]],
      expected: [1, 2, 3, 4],
      tags: ['edge'],
    },
    {
      name: 'right subtree stops early, left keeps going',
      args: [[1, 2, 3, 4, 5, null, null, 6]],
      expected: [1, 3, 5, 6],
      tags: ['edge'],
    },
    { name: 'perfect tree', args: [[1, 2, 3, 4, 5, 6, 7]], expected: [1, 3, 7], tags: ['edge'] },
    { name: 'duplicate values', args: [[2, 2, 2]], expected: [2, 2], tags: ['edge'] },
    { name: 'negative values', args: [[-1, -2, -3, -4]], expected: [-1, -3, -4], tags: ['edge'] },
    {
      name: 'long right spine',
      args: [[1, null, 2, null, 3, null, 4, null, 5]],
      expected: [1, 2, 3, 4, 5],
      tags: ['edge'],
    },
  ],
  hints: [
    'From the right you see exactly one node per level, so the answer is as long as the tree is deep.',
    'Walk the tree with a queue, one level per loop iteration: read the queue size first, then dequeue exactly that many nodes. Everything you enqueue inside the iteration belongs to the next level.',
    'Within a level, the node you can see is the last one you dequeue — index `wave - 1`. Do not reach for the right child: if the right subtree ends early, a left child is what you see.',
  ],
}
