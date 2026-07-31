import type { VizTree } from '@algoviz/tracer'
import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 450 — Delete Node in a BST.
 *
 * The first `bst` problem, and the first whose answer is a *restructured tree* rather than a
 * value read out of an unchanged one. `VizTree` had nothing for that: `left`/`right` were
 * read-only traversal steps that record a *visit*, `value`/`peek` had no write half, and `root`
 * could only be read. Nothing on the class could say "this node's child is now that other node"
 * or "this node's value is now this other value" — restructuring, as opposed to walking, was not
 * expressible, which meant this problem could not be added in its previous form.
 *
 * `setLeft`/`setRight`/`setValue`, and a `root` setter, close that gap (see
 * `packages/tracer/src/structures/tree.ts`). They mirror `VizList.next`/`val`'s existing split
 * between a getter that reads and records a visit and a setter that writes and records a
 * rewire — the same split this problem needed and the tree never had. A rewire lights its new
 * edge transiently, one frame, exactly like `left`/`right` light the edge they walk; a value
 * write marks the node `active` for the one frame it changes. Nothing about *removal* had to be
 * added: `layoutTree` already positions only the nodes it can reach from `root`, so a node that
 * stops being pointed to — a deleted leaf, a one-child node replaced by its child, a successor
 * spliced out — simply stops being drawn. No explicit "delete" op was needed for that half.
 *
 * The three cases at the node found read straight off the picture:
 * - **leaf** — its parent's `setLeft`/`setRight` becomes `null`; the leaf vanishes.
 * - **one child** — the parent's pointer is rewired straight past it to that child; the found
 *   node vanishes the same way.
 * - **two children** — the found node keeps its id and gets a new value: its in-order
 *   successor's, always the leftmost node of its right subtree, walked down with the same
 *   `t.left` that narrates every other descent. The successor is then deleted from the right
 *   subtree by this same `remove` — always a leaf or a one-child node there, so the two-children
 *   branch never has to run twice for one call.
 *
 * Every descent narrates the comparison driving it ("greater, so go right" — the reason the
 * search is O(log n)), and the whole root→node walk is a `path` mark that unwinds with the
 * recursion, exactly like Count Good Nodes. The difference here is that the recursion also hands
 * a value back up, so each ancestor can rewire itself to whatever its child returned.
 */
export function reference(root: (number | null)[], key: number, viz: Viz): (number | null)[] {
  const t = viz.tree(root, { name: 'tree' })

  // Whether the key was ever actually found. Without it the closing narration said `deleted 0`
  // over a picture of an untouched tree containing no 0 — the last frame of the run asserting a
  // deletion that never happened, with nothing anywhere narrating the miss.
  let found = false

  const rewired = (id: string, side: 'left' | 'right', child: string | null): string =>
    rewireIfChanged(t, id, side, child)

  const remove = (id: string | null, target: number): string | null => {
    if (id === null) {
      // Falling off the bottom is the *answer* on a miss, so it gets a frame. It used to return
      // silently, leaving one `visit` op labelled `2.left -> none` as the only evidence.
      viz.step(`${target} is not here — there is no subtree left to search`)
      return null
    }
    return viz.group(`node ${t.peek(id)}`, () =>
      t.onPath(id, () => {
        const val = t.value(id) as number

        if (target < val) {
          viz.step(`${target} < ${val} — go left`)
          return rewired(id, 'left', remove(t.left(id), target))
        }
        if (target > val) {
          viz.step(`${target} > ${val} — go right`)
          return rewired(id, 'right', remove(t.right(id), target))
        }

        // Found it — one of three cases, decided by which children it has.
        found = true
        t.mark(id, 'match', `found ${val}`)
        const { left, right } = t.childrenOf(id)

        // Three branches, because there are three cases. A leaf used to fall into the one-child
        // branch and be narrated `has no left child — its right child takes its place`, on a node
        // with no right child either: the same sentence as the genuine one-child case, and false.
        if (left === null && right === null) {
          viz.step(`${val} is a leaf — nothing hangs off it, so it just goes`)
          return null
        }
        if (left === null) {
          viz.step(`${val} has no left child — its right child ${t.peek(right as string)} takes its place`)
          return right
        }
        if (right === null) {
          viz.step(`${val} has no right child — its left child ${t.peek(left)} takes its place`)
          return left
        }

        // Two children: the in-order successor is the leftmost node of the right subtree — it
        // is always there, and it is always the smallest value greater than this one. Borrow
        // its value, THEN delete it from the right subtree: the copy-up has to land before the
        // delete below, or the picture shows the subtree changing before the value that
        // explains why does.
        //
        // `t.right(id)` rather than the `right` already in hand, because this is a *walk* and the
        // recording twin is what lights the edge. Taken from `childrenOf` the search began with
        // its most important move — "into the right subtree" — having no frame at all, so the
        // highlight teleported two levels down.
        // Narrated *before* the step down, so the frame that moves the highlight into the right
        // subtree carries the sentence explaining why it moved. The other way round, that frame
        // inherits the caption of whatever was said last — which is about the search, not about
        // the successor hunt that has just started.
        viz.step(
          `${val} has two children, so nothing can simply take its place — the value that can is ` +
            `the smallest one bigger than it, which is as far left as the right subtree goes`,
        )
        let succ = t.right(id) as string
        while (t.childrenOf(succ).left !== null) {
          succ = t.left(succ) as string
          viz.step(`${t.peek(succ)} is smaller — keep going left`)
        }
        const succVal = t.value(succ) as number
        t.mark(succ, 'pinned', 'the successor, about to be moved up and spliced out')
        // The target stops being the node holding the value we searched for the moment it holds a
        // different one, so its `match` comes off before the copy rather than sitting alongside
        // the successor's — two nodes showing the same number with the same marks and nothing on
        // screen telling them apart.
        t.unmarkClass(id, 'match')
        viz.step(`successor of ${val} is ${succVal} — copy it up, then delete it from the right subtree`)
        t.setValue(id, succVal)
        return rewired(id, 'right', remove(right, succVal))
      }),
    )
  }

  const newRoot = remove(t.root, key)
  if (t.root !== newRoot) t.root = newRoot
  if (newRoot !== null) t.mark(newRoot, 'result', 'root after deletion')
  viz.step(
    newRoot === null
      ? 'the tree is empty'
      : found
        ? `deleted ${key} — ${t.peek(newRoot)} is the new root`
        : `${key} was never in the tree, so nothing changed — ${t.peek(newRoot)} is still the root`,
  )

  return serialize(t, newRoot)
}

/**
 * Rewire a child pointer, but only when it actually changed.
 *
 * `node.left = remove(node.left, key)` re-attaches the same child on every ancestor of the target
 * — and on *every* node visited when the key is absent. Written unconditionally that emitted a
 * `write` frame per ancestor announcing a rewire that changed nothing, and on a miss the run ended
 * with three of them: a node lit `active`, a caption saying its pointer moved, and a tree in
 * exactly the shape it was already in. The one on the node the search fell off had no possible
 * referent at all — the pointer it "rewired" was already null.
 */
function rewireIfChanged(
  t: VizTree,
  id: string,
  side: 'left' | 'right',
  child: string | null,
): string {
  const current = side === 'left' ? t.childrenOf(id).left : t.childrenOf(id).right
  if (current === child) return id
  if (side === 'left') t.setLeft(id, child)
  else t.setRight(id, child)
  return id
}

/**
 * The tree read back out in the same level-order-with-nulls form the input arrived in.
 *
 * `t.toLevelOrder()` exists but drops missing children silently, which is fine for reading off
 * *values* and useless for proving *shape* — `[5, null, 3]` and `[5, 3, null]` both flatten to
 * `[5, 3]` that way, and a delete that rewired the wrong side would still pass. This inverts
 * `VizTree`'s own `fromLevelOrder` exactly, nulls and all, so the comparator is checking the
 * shape the animation produced, not just the multiset of values left in it.
 */
function serialize(t: VizTree, rootId: string | null): (number | null)[] {
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

const starter = `// A BST delete is a search, then one of three cases at the node found: a leaf just
// goes, a one-child node is replaced by that child, and a two-child node borrows its
// in-order successor's value and deletes the successor instead.
export default function deleteNode(root: (number | null)[], key: number, viz: Viz): (number | null)[] {
  const t = viz.tree(root, { name: 'tree' })

  // Whether the key was ever actually found — the closing narration needs it, or a run that
  // deleted nothing still ends by announcing a deletion.
  let found = false

  // Rewire only when the pointer actually moves. remove() re-attaches the SAME child on every
  // ancestor of the target, and on every node visited when the key is absent, so calling
  // setLeft/setRight unconditionally emits a write frame per ancestor announcing a rewire that
  // changed nothing — and on a miss, one of them "rewires" a pointer that was already null.
  const rewired = (id: string, side: 'left' | 'right', child: string | null): string => {
    const current = side === 'left' ? t.childrenOf(id).left : t.childrenOf(id).right
    if (current === child) return id
    if (side === 'left') t.setLeft(id, child)
    else t.setRight(id, child)
    return id
  }

  const remove = (id: string | null, target: number): string | null => {
    if (id === null) {
      // TODO: falling off the bottom IS the answer on a miss, so narrate it. Returning silently
      // leaves one bare \`visit\` op as the only evidence the search ever ended.
      return null
    }
    return viz.group(\`node \${t.peek(id)}\`, () =>
      // t.onPath keeps the root->node highlight correct as recursion unwinds.
      t.onPath(id, () => {
        const val = t.value(id) as number

        // TODO: compare target against val, in this order — this is the whole search:
        //   1. target < val: viz.step narrating "go left", then
        //      return rewired(id, 'left', remove(t.left(id), target))
        //      — this node's identity never changes on the way down, only its child.
        //   2. target > val: the mirror image, with t.right.
        //   3. target === val: this IS the node to delete. Fall through to the next TODO.

        // TODO: target === val. Set found = true, mark it — t.mark(id, 'match', ...) — then
        // destructure { left, right } from t.childrenOf(id) and handle THREE cases, not two:
        //   - no children at all: it is a leaf, nothing takes its place — return null.
        //   - left is null: its right child takes its place — return right.
        //   - right is null: its left child takes its place — return left.
        //     (Folding the leaf into either of the middle two narrates it with that case's
        //     sentence, on a node with no such child. Two branches cannot say three things.)
        //   - otherwise it has two children. The in-order successor is the leftmost node of the
        //     right subtree. Start with t.right(id), NOT the \`right\` you already have from
        //     childrenOf: this is a walk, and only the recording twin lights the edge — taken
        //     silently, the search's first and most important move has no frame at all and the
        //     highlight teleports two levels. Then walk down with t.left while
        //     t.childrenOf(...).left is not null, narrating each step.
        //
        //     Read the successor's value and mark the successor 'pinned'. Take 'match' off the
        //     target with t.unmarkClass(id, 'match') BEFORE copying: the moment it holds a
        //     different value it is no longer the node you searched for, and leaving the mark on
        //     puts two nodes on screen showing the same number with the same marks.
        //
        //     THEN t.setValue(id, thatValue) — the copy-up has to land before the delete below,
        //     or the picture shows the subtree changing before the value that explains why does —
        //     THEN return rewired(id, 'right', remove(right, thatValue)).

        return id
      }),
    )
  }

  const newRoot = remove(t.root, key)
  // TODO: set t.root = newRoot only if it actually changed, mark it 'result' if it exists, and
  // narrate — saying that the key was deleted if \`found\`, and that it was never there if not.
  // A closing frame that says "deleted N" over an untouched tree is the last thing a viewer sees.

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

export const deleteNodeInABst: ProblemDefinition = {
  id: 'p450',
  leetcode: 450,
  slug: 'delete-node-in-a-bst',
  title: 'Delete Node in a BST',
  difficulty: 'medium',
  category: 'bst',
  statement:
    'Given the root of a binary search tree — every value in it distinct — and a key, delete the ' +
    'node with that value and return the shape of the tree afterward. A leaf simply goes; a node ' +
    'with one child is replaced by that child; a node with two children borrows the value of its ' +
    "in-order successor (the smallest value greater than it) and deletes the successor instead. " +
    'If the key is not present, the tree is unchanged.',
  structures: ['tree'],
  comparator: 'deep',
  entry: 'deleteNode',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    {
      name: 'example — two children, successor is the immediate right child',
      args: [[5, 3, 6, 2, 4, null, 7], 3],
      expected: [5, 4, 6, 2, null, null, 7],
      tags: ['example'],
    },
    {
      name: 'example — key not present, tree unchanged',
      args: [[5, 3, 6, 2, 4, null, 7], 0],
      expected: [5, 3, 6, 2, 4, null, 7],
      tags: ['example'],
    },
    { name: 'empty tree', args: [[], 0], expected: [], tags: ['example', 'edge'] },
    {
      name: 'delete a leaf',
      args: [[5, 3, 6, 2, 4, null, 7], 2],
      expected: [5, 3, 6, null, 4, null, 7],
      tags: ['edge'],
    },
    {
      name: 'delete a one-child node',
      args: [[5, 3, 6, 2, 4, null, 7], 6],
      expected: [5, 3, 7, 2, 4],
      tags: ['edge'],
    },
    {
      name: 'delete the root — two children',
      args: [[5, 3, 6, 2, 4, null, 7], 5],
      expected: [6, 3, 7, 2, 4],
      tags: ['edge'],
    },
    {
      name: 'delete the root — one child',
      args: [[2, 1], 2],
      expected: [1],
      tags: ['edge'],
    },
    {
      name: 'delete the only node — tree becomes empty',
      args: [[1], 1],
      expected: [],
      tags: ['edge'],
    },
    {
      // The successor is not the immediate right child here — finding it takes two left steps,
      // which is the case that proves "leftmost of the right subtree" rather than "the right
      // child" is the rule.
      name: 'successor requires more than one left step',
      args: [[5, 2, 9, null, null, 7, null, 6], 5],
      expected: [6, 2, 9, null, null, 7],
      tags: ['edge'],
    },
    {
      name: 'negative and zero values',
      args: [[0, -3, 4], -3],
      expected: [0, null, 4],
      tags: ['edge'],
    },
  ],
  hints: [
    "A BST's shape already answers 'which way to the key': compare against the current node and go left or right, the same rule that makes it a BST.",
    'When the search reaches the key, its children decide the case — no children (or exactly one) means some other node simply takes its place. Two children is the only case that needs more thought.',
    "For two children, the in-order successor — the node to borrow from — is always the leftmost node of the right subtree. Copy its value up, then delete the successor from the right subtree, which is always a leaf or a one-child node there.",
  ],
}
