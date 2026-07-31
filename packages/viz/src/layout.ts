import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy'
import type { GraphEdgeSnapshot, NodeId, TreeNodeSnapshot, TrieNodeSnapshot } from '@algoviz/tracer'

export interface Point {
  x: number
  y: number
}

export interface LaidOut {
  positions: Map<NodeId, Point>
  width: number
  height: number
}

export const NODE_R = 19
const LEVEL_H = 74
const SIBLING_W = 56

interface TreeLike {
  id: NodeId
  children: NodeId[]
}

/**
 * Deterministic tidy-tree layout via d3-hierarchy.
 *
 * No simulation, no randomness: the same topology always produces the same coordinates. That
 * is a testability decision as much as an aesthetic one — a live force layout would make every
 * UI assertion and every screenshot flaky, and would animate chaotically while the viewer is
 * trying to follow an algorithm.
 */
function layoutHierarchy(roots: TreeLike[], byId: Map<NodeId, TreeLike>, pad = 30): LaidOut {
  const positions = new Map<NodeId, Point>()
  let offsetX = pad
  let maxHeight = 0

  for (const root of roots) {
    const h = hierarchy<TreeLike>(root, (d) =>
      d.children.map((c) => byId.get(c)).filter((c): c is TreeLike => c !== undefined),
    )
    const laid = tree<TreeLike>().nodeSize([SIBLING_W, LEVEL_H])(h)

    const nodes = laid.descendants() as HierarchyPointNode<TreeLike>[]
    const minX = Math.min(...nodes.map((n) => n.x))
    const maxX = Math.max(...nodes.map((n) => n.x))

    for (const n of nodes) {
      positions.set(n.data.id, { x: n.x - minX + offsetX, y: n.y + pad })
    }
    offsetX += maxX - minX + SIBLING_W
    maxHeight = Math.max(maxHeight, Math.max(...nodes.map((n) => n.y)) + pad * 2)
  }

  return { positions, width: offsetX + pad, height: Math.max(maxHeight, LEVEL_H) }
}

export function layoutTree(nodes: readonly TreeNodeSnapshot[], root: NodeId | null): LaidOut {
  if (nodes.length === 0 || root === null) return { positions: new Map(), width: 0, height: 0 }
  // Belt and braces against a cycle. `VizTree` refuses to build one, which is the real fix — but a
  // visualizer is a pure function of a snapshot and a snapshot can arrive from anywhere, and the
  // failure mode here is not a wrong picture: it is a recursion that never returns, which in the
  // browser is a locked tab. A node already claimed by an earlier parent is simply not claimed
  // twice, so the worst case becomes a subtree drawn once instead of an app that stops responding.
  const claimed = new Set<NodeId>([root])
  const childrenOf = (n: TreeNodeSnapshot): NodeId[] => {
    const kids: NodeId[] = []
    for (const c of [n.left, n.right]) {
      if (c === null || claimed.has(c)) continue
      claimed.add(c)
      kids.push(c)
    }
    return kids
  }
  const byId = new Map<NodeId, TreeLike>(nodes.map((n) => [n.id, { id: n.id, children: childrenOf(n) }]))
  const rootLike = byId.get(root)
  return rootLike ? layoutHierarchy([rootLike], byId) : { positions: new Map(), width: 0, height: 0 }
}

export function layoutTrie(nodes: readonly TrieNodeSnapshot[], root: NodeId): LaidOut {
  if (nodes.length === 0) return { positions: new Map(), width: 0, height: 0 }
  const byId = new Map<NodeId, TreeLike>(nodes.map((n) => [n.id, { id: n.id, children: [...n.children] }]))
  const rootLike = byId.get(root)
  return rootLike ? layoutHierarchy([rootLike], byId) : { positions: new Map(), width: 0, height: 0 }
}

/**
 * Graph layout, deterministic by construction.
 *
 * Strategy, in order: if the graph is a forest, lay it out as a tidy tree rooted at the
 * lowest-id node of each component (which for LeetCode graphs is almost always the meaningful
 * root, e.g. city 0). Otherwise fall back to a BFS-layered layout, and finally to a circle.
 * Every branch is a pure function of the topology, so positions never move during playback —
 * only colours and edge states change.
 */
export function layoutGraph(nodeIds: readonly NodeId[], edges: readonly GraphEdgeSnapshot[]): LaidOut {
  if (nodeIds.length === 0) return { positions: new Map(), width: 0, height: 0 }

  const adjacency = new Map<NodeId, Set<NodeId>>()
  for (const id of nodeIds) adjacency.set(id, new Set())
  for (const e of edges) {
    adjacency.get(e.from)?.add(e.to)
    adjacency.get(e.to)?.add(e.from)
  }

  const components = findComponents(nodeIds, adjacency)
  const isForest = edges.length === nodeIds.length - components.length

  if (isForest) {
    // Build parent→children from a BFS out of each component's lowest-id node.
    const children = new Map<NodeId, NodeId[]>(nodeIds.map((id) => [id, []]))
    const roots: NodeId[] = []
    const seen = new Set<NodeId>()
    for (const component of components) {
      const root = [...component].sort(compareIds)[0] as NodeId
      roots.push(root)
      const queue: NodeId[] = [root]
      seen.add(root)
      while (queue.length > 0) {
        const current = queue.shift() as NodeId
        for (const next of [...(adjacency.get(current) ?? [])].sort(compareIds)) {
          if (seen.has(next)) continue
          seen.add(next)
          children.get(current)?.push(next)
          queue.push(next)
        }
      }
    }
    const byId = new Map<NodeId, TreeLike>(
      nodeIds.map((id) => [id, { id, children: children.get(id) ?? [] }]),
    )
    return layoutHierarchy(
      roots.map((r) => byId.get(r)).filter((r): r is TreeLike => r !== undefined),
      byId,
    )
  }

  return layoutLayered(nodeIds, adjacency, components)
}

function compareIds(a: NodeId, b: NodeId): number {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
  return a.localeCompare(b)
}

function findComponents(nodeIds: readonly NodeId[], adjacency: Map<NodeId, Set<NodeId>>): NodeId[][] {
  const seen = new Set<NodeId>()
  const components: NodeId[][] = []
  for (const id of [...nodeIds].sort(compareIds)) {
    if (seen.has(id)) continue
    const component: NodeId[] = []
    const stack = [id]
    seen.add(id)
    while (stack.length > 0) {
      const current = stack.pop() as NodeId
      component.push(current)
      for (const next of adjacency.get(current) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        stack.push(next)
      }
    }
    components.push(component)
  }
  return components
}

/** BFS levels from each component's lowest-id node, spread evenly across each row. */
function layoutLayered(
  nodeIds: readonly NodeId[],
  adjacency: Map<NodeId, Set<NodeId>>,
  components: NodeId[][],
): LaidOut {
  const positions = new Map<NodeId, Point>()
  const pad = 34
  let yBase = pad
  let maxWidth = 0

  for (const component of components) {
    const root = [...component].sort(compareIds)[0] as NodeId
    const level = new Map<NodeId, number>([[root, 0]])
    const queue: NodeId[] = [root]
    while (queue.length > 0) {
      const current = queue.shift() as NodeId
      for (const next of [...(adjacency.get(current) ?? [])].sort(compareIds)) {
        if (level.has(next)) continue
        level.set(next, (level.get(current) ?? 0) + 1)
        queue.push(next)
      }
    }

    const rows = new Map<number, NodeId[]>()
    for (const id of [...component].sort(compareIds)) {
      const depth = level.get(id) ?? 0
      const row = rows.get(depth) ?? []
      row.push(id)
      rows.set(depth, row)
    }

    for (const [depth, row] of [...rows].sort((a, b) => a[0] - b[0])) {
      row.forEach((id, i) => {
        positions.set(id, { x: pad + i * SIBLING_W + (depth % 2) * (SIBLING_W / 3), y: yBase + depth * LEVEL_H })
      })
      maxWidth = Math.max(maxWidth, pad * 2 + row.length * SIBLING_W)
    }
    yBase += (rows.size + 0.5) * LEVEL_H
  }

  return { positions, width: Math.max(maxWidth, 200), height: yBase }
}
