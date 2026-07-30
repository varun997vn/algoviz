import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 1466 — Reorder Routes to Make All Paths Lead to the City Zero.
 *
 * The graph reference, chosen over Keys and Rooms because it's the one that stresses *edge
 * state*: each edge is either already pointing the right way or has to be reversed, so the
 * animation has to say something about edges rather than just nodes. Edge semantics are the
 * part of the trace model most likely to be silently wrong, so it gets a real user on day one.
 *
 * Note that `viz.graph({ n, edges })` builds the adjacency list, so this version is *shorter*
 * than the plain solution, which has to hand-roll `adj` with direction bookkeeping.
 */
export function reference(n: number, connections: number[][], viz: Viz): number {
  // Traverse undirected so we can reach every city, but remember the original direction.
  const g = viz.graph({
    name: 'cities',
    n,
    directed: true,
    edges: connections.map(([a, b]) => [a as number, b as number] as const),
  })
  const seen = viz.set<number>([], { name: 'visited' })
  const original = new Set(connections.map(([a, b]) => `${a}->${b}`))

  // Undirected adjacency, built quietly — it's bookkeeping, not algorithm.
  const neighbours = new Map<number, number[]>()
  for (let i = 0; i < n; i += 1) neighbours.set(i, [])
  for (const [a, b] of connections) {
    neighbours.get(a as number)?.push(b as number)
    neighbours.get(b as number)?.push(a as number)
  }

  let reversals = 0
  viz.watch(() => ({ reversals, visited: seen.size }))

  // `parent` is threaded through so we skip the edge we arrived on. Marking it as `rejected`
  // would overwrite the `tree`/`reversed` state we just recorded for that same edge — the
  // return value would still be right while the picture silently lost the decision.
  const walk = (city: number, parent: number): void => {
    seen.add(city)
    g.visit(city)

    viz.group(`city ${city}`, () => {
      for (const next of neighbours.get(city) ?? []) {
        if (next === parent) continue
        if (seen.contains(next)) {
          g.edge(city, next, 'rejected', 'already visited')
          continue
        }
        // The road exists in one direction only. If it points away from 0, it must flip.
        if (original.has(`${city}->${next}`)) {
          reversals += 1
          g.edge(city, next, 'reversed', 'points away from 0 — reverse it')
          viz.step(`reverse ${city} -> ${next} (now ${reversals} reversals)`)
        } else {
          g.edge(next, city, 'tree', 'already leads toward 0')
          viz.step(`${next} -> ${city} already points the right way`)
        }
        walk(next, city)
      }
    })
  }

  walk(0, -1)
  return reversals
}

const starter = `// Every city must be able to reach 0. Walk outward from 0 treating roads as
// undirected; any road that points *away* from 0 has to be reversed.
export default function minReorder(n: number, connections: number[][], viz: Viz): number {
  const g = viz.graph({ name: 'cities', n, directed: true, edges: connections as [number, number][] })
  const seen = viz.set<number>([], { name: 'visited' })
  const original = new Set(connections.map(([a, b]) => \`\${a}->\${b}\`))

  const neighbours = new Map<number, number[]>()
  for (let i = 0; i < n; i += 1) neighbours.set(i, [])
  for (const [a, b] of connections) {
    neighbours.get(a)?.push(b)
    neighbours.get(b)?.push(a)
  }

  let reversals = 0
  viz.watch(() => ({ reversals }))

  // Thread the parent through so you skip the road you arrived on — marking it would
  // overwrite the decision you just recorded for that same road.
  const walk = (city: number, parent: number): void => {
    seen.add(city)
    g.visit(city)
    // TODO: for each unvisited neighbour that isn't the parent, decide whether the
    // original road points away from 0 (reverse it, g.edge(city, next, 'reversed'))
    // or toward it (g.edge(next, city, 'tree')), then recurse.
    viz.step(\`at \${city}\`)
  }

  walk(0, -1)
  return reversals
}
`

export const reorderRoutes: ProblemDefinition = {
  id: 'p1466',
  leetcode: 1466,
  slug: 'reorder-routes-to-make-all-paths-lead-to-the-city-zero',
  title: 'Reorder Routes to Make All Paths Lead to the City Zero',
  difficulty: 'medium',
  category: 'graphs-dfs',
  statement:
    'There are `n` cities numbered 0..n-1 and `n - 1` one-way roads forming a tree if you ignore ' +
    'direction. Return the minimum number of roads that must be reversed so every city can reach city 0.',
  structures: ['graph', 'set'],
  comparator: 'deep',
  entry: 'minReorder',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    {
      name: 'example',
      args: [6, [[0, 1], [1, 3], [2, 3], [4, 0], [4, 5]]],
      expected: 3,
      tags: ['example'],
    },
    { name: 'chain toward zero', args: [5, [[1, 0], [1, 2], [3, 2], [3, 4]]], expected: 2, tags: ['example'] },
    { name: 'single road already correct', args: [2, [[1, 0]]], expected: 0, tags: ['edge'] },
    { name: 'single road needs reversing', args: [2, [[0, 1]]], expected: 1, tags: ['edge'] },
    { name: 'star pointing outward', args: [4, [[0, 1], [0, 2], [0, 3]]], expected: 3, tags: ['edge'] },
    { name: 'star pointing inward', args: [4, [[1, 0], [2, 0], [3, 0]]], expected: 0, tags: ['edge'] },
  ],
  hints: [
    'Ignore direction while traversing, or you cannot reach every city from 0.',
    'Keep the original directed pairs in a set so you can tell which way each road pointed.',
    'Walking outward from 0, a road stored as `city -> next` points away from 0 and must be reversed.',
  ],
}
