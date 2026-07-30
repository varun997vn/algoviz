import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 1448 — Count Good Nodes in Binary Tree.
 *
 * Chosen over Maximum Depth as the tree reference because it exercises *path state that
 * unwinds*: the root→node chain must be highlighted on the way down and un-highlighted as
 * recursion returns. Getting that wrong leaves a tree covered in stale highlights, and it's
 * the bug class tree animations fail at — so `viz.tree`'s `onPath` helper is scope-safe.
 */
export function reference(root: (number | null)[], viz: Viz): number {
  const t = viz.tree(root, { name: 'tree' })
  let good = 0
  let maxSoFar = Number.NEGATIVE_INFINITY
  viz.watch(() => ({ good, maxSoFar: maxSoFar === Number.NEGATIVE_INFINITY ? '-inf' : maxSoFar }))

  const walk = (node: string | null, best: number): void => {
    if (node === null) return
    const value = t.value(node) as number

    t.onPath(node, () => {
      maxSoFar = best
      if (value >= best) {
        good += 1
        t.mark(node, 'result', `good: ${value} >= ${best === Number.NEGATIVE_INFINITY ? '-inf' : best}`)
        viz.step(`${value} is good (best so far ${best === Number.NEGATIVE_INFINITY ? '-inf' : best})`)
      } else {
        t.mark(node, 'excluded', `${value} < ${best}`)
        viz.step(`${value} is blocked by ${best}`)
      }

      const nextBest = Math.max(best, value)
      const { left, right } = t.childrenOf(node)
      viz.group(`node ${value}`, () => {
        if (left !== null) {
          t.markEdge(node, left, 'tree')
          walk(left, nextBest)
        }
        if (right !== null) {
          t.markEdge(node, right, 'tree')
          walk(right, nextBest)
        }
      })
    })
  }

  walk(t.root, Number.NEGATIVE_INFINITY)
  return good
}

const starter = `// A node is "good" if no node on the path from the root to it has a greater value.
// Carry the maximum seen so far down the recursion.
export default function goodNodes(root: (number | null)[], viz: Viz): number {
  const t = viz.tree(root, { name: 'tree' })
  let good = 0
  viz.watch(() => ({ good }))

  const walk = (node: string | null, best: number): void => {
    if (node === null) return
    const value = t.value(node) as number

    // t.onPath keeps the root->node highlight correct as recursion unwinds.
    t.onPath(node, () => {
      // TODO: count this node if value >= best, then recurse into both children
      // with the updated best.
      const { left, right } = t.childrenOf(node)
      viz.step(\`at \${value}\`)
    })
  }

  walk(t.root, -Infinity)
  return good
}
`

export const countGoodNodes: ProblemDefinition = {
  id: 'p1448',
  leetcode: 1448,
  slug: 'count-good-nodes-in-binary-tree',
  title: 'Count Good Nodes in Binary Tree',
  difficulty: 'medium',
  category: 'binary-tree-dfs',
  statement:
    'A node X in a binary tree is *good* if no node on the path from the root to X has a value ' +
    'greater than X. Given a binary tree in level-order array form, return the number of good nodes. ' +
    'The root is always good.',
  structures: ['tree'],
  comparator: 'deep',
  entry: 'goodNodes',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    { name: 'example', args: [[3, 1, 4, 3, null, 1, 5]], expected: 4, tags: ['example'] },
    { name: 'left-heavy', args: [[3, 3, null, 4, 2]], expected: 3, tags: ['example'] },
    { name: 'single node', args: [[1]], expected: 1, tags: ['edge'] },
    { name: 'strictly decreasing path', args: [[5, 4, null, 3, null, 2]], expected: 1, tags: ['edge'] },
    { name: 'strictly increasing path', args: [[1, 2, null, 3, null, 4]], expected: 4, tags: ['edge'] },
    { name: 'duplicates count as good', args: [[2, 2, 2]], expected: 3, tags: ['edge'] },
  ],
  hints: [
    'Pass the maximum value seen on the path down through the recursion.',
    'A node is good when its value is >= that running maximum.',
    'Use `>=`, not `>` — a node equal to the running maximum is still good.',
  ],
}
