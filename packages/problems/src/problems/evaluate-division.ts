import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 399 — Evaluate Division.
 *
 * The first problem in the set to use a **weighted** graph, and the first to call
 * `VizGraph.neighbors()` at all — the method the class docstring cites as the reason
 * `viz.graph({ n, edges })` pulls its weight. It is also the first to pair a graph with a map.
 *
 * **What the animation has to explain** is that a division query is a *path*, and the answer is
 * the product of the edge weights along it. `a/b = 2` and `b/c = 3` gives `a/c = 6` because you
 * walk two edges and multiply. So the picture has three jobs, and each maps onto one thing on
 * screen:
 *
 *   - the **edges carry the arithmetic** — `a/b = 2` becomes `a ->(2) b` *and* `b ->(0.5) a`, so
 *     one step in either direction is one multiplication and `g.weightOf(u, v)` is the whole of
 *     it. Modelling only the declared direction would force the solution to keep its own set of
 *     "which way was this written" and flip the weight by hand, which is precisely the
 *     hand-rolled bookkeeping `viz.graph` exists to delete.
 *   - the **walk is visible**: `neighbors()` lights each edge as it is considered, an accepted
 *     edge becomes `tree`, an edge whose subtree failed becomes `rejected`, and the chain that
 *     reaches the target is promoted to `path` on the way out. A viewer can read the answer off
 *     the highlighted edges without the watch panel.
 *   - the **product accumulates**: `running` is the product from the query's numerator down to
 *     wherever the walk currently is, restored on every backtrack, so the number in the panel is
 *     always the product of the `tree` edges currently lit.
 *
 * **The two edge cases that trip solutions both had to be made to say something.** A query about
 * an unknown variable and a query about a variable divided by itself are each answerable without
 * touching the graph — `x/x` is not 1 unless `x` exists, and `a/e` is -1 even though `a` is fine.
 * Written naively both return before any structure is touched and emit *no frames at all*: the
 * query flashes past showing the previous query's picture. So the symbol table (`known`) is
 * consulted with `has()` for both endpoints of every query, which puts the hit or the miss on
 * screen, and `x/x` gets an explicit `result` mark and a step of its own — the empty path, whose
 * product is 1.
 *
 * ### Findings this problem turned up in `VizGraph` (nothing here works around a *wrong* answer,
 * ### only around a picture that could not be reset)
 *
 * 1. **`clearMarks()` cleared node marks and left edge marks untouched, and nothing else cleared
 *    them either.** `edgeMarks` was a `Map` that was only ever written. `neighbors()` sets an edge
 *    `active` as it yields it, so on a problem that traverses the same graph more than once every
 *    edge ever considered stayed lit for the rest of the trace. Reorder Routes never noticed
 *    because it decides each edge exactly once. Fixed: `g.clearEdges()` is now the twin of
 *    `clearMarks`, and the reset between queries below is those two lines. The workaround it
 *    replaced — demoting every edge to `visited` by hand — painted edges no query had touched.
 * 2. **There is no `unmarkClass(node, cls)` on `VizGraph`,** though `NodeMarkStore.removeClass`
 *    exists for it and both `VizTree` (`exitPath`) and `VizMatrix` (`unmarkClass`) use it.
 *    `g.unmark(id)` is class-blind, so a `path` mark cannot be unwound without destroying the
 *    `visited` mark underneath it. That is why this solution marks `visited` on the way down and
 *    promotes the winning chain to `path` on the way *out*, rather than carrying a live path mark.
 * 3. **`neighbors()` yields the node but not the weight** it just walked over, even though the
 *    adjacency entry it is iterating holds both — hence the `weightOf` call one line later.
 */
export function reference(
  equations: string[][],
  values: number[],
  queries: string[][],
  viz: Viz,
): number[] {
  // `a / b = v` is two directed edges: a -> b multiplies by v, b -> a divides by it. Spelling the
  // reciprocal out is what makes `g.weightOf(u, v)` the entire arithmetic of a step.
  const wired = equations.flatMap(([a, b], i) => [
    [a, b, values[i]] as const,
    [b, a, 1 / values[i]] as const,
  ])
  const g = viz.graph({ name: 'variables', directed: true, weighted: true, edges: wired })

  // The symbol table. Its value is how many equations mention the variable, which is exactly the
  // node's out-degree — and consulting it with `has()` is what makes an unknown variable visible
  // rather than a query that returns -1 having touched nothing.
  const known = viz.map<string, number>([], { name: 'known' })
  viz.quiet(() => {
    for (const v of g.nodes) known.set(v, g.degree(v))
  })

  const answers = viz.array<number>(queries.length, { name: 'answers', fill: null })

  let query = ''
  let running = 1
  viz.watch(() => ({ query, product: running }))

  // Products of a chain of divisions are rarely round; five places is what LeetCode itself judges.
  const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(5).replace(/0+$/, ''))

  // Bookkeeping, not the picture: `g.visit` already shows what has been explored, but `VizGraph`
  // has no non-recording "is this node marked" twin, so the guard needs its own set.
  let seen = new Set<string>()

  /** Walk from `at` toward `target`, carrying the product of the weights already crossed. */
  const walk = (at: string, target: string, product: number): number => {
    running = product
    if (at === target) {
      g.mark(at, 'result', `reached ${target}`)
      viz.step(`reached ${target} — the walk multiplied out to ${fmt(product)}`)
      return product
    }

    seen.add(at)
    g.visit(at)

    return viz.group(`${at} (running ${fmt(product)})`, () => {
      // `weightedNeighbors` yields the weight of the edge it just lit, which `neighbors` does not
      // even though the adjacency entry it iterates holds both. With `neighbors` this needed
      // `g.weightOf(at, next) ?? 1` on the following line — a fallback for an edge that provably
      // exists, in the line that is the whole arithmetic of a step.
      for (const { to: next, weight: w } of g.weightedNeighbors(at)) {
        if (seen.has(next)) {
          g.edge(at, next, 'rejected', 'already explored in this query')
          continue
        }
        g.edge(at, next, 'tree', `x ${fmt(w)}`)

        const found = walk(next, target, product * w)
        if (found > 0) {
          // Every value is strictly positive, so a real product is never <= 0 and -1 is a safe
          // sentinel. Promote the edge we came in on: the `path` chain left on screen is the
          // derivation, readable end to end.
          g.edge(at, next, 'path', `${at} / ${next} = ${fmt(w)}`)
          return found
        }
        // Undo the running product *before* the frame that gives up on the edge, so the panel
        // never shows a product from a branch the picture has already abandoned.
        running = product
        g.edge(at, next, 'rejected', 'dead end')
      }
      viz.step(`${at}: every edge from here leads somewhere already explored — back up`)
      return -1
    })
  }

  queries.forEach(([from, to], q) => {
    query = `${from} / ${to}`
    running = 1
    seen = new Set<string>()

    if (q > 0) {
      // Start from a clean picture, *before* opening the query's scope — otherwise the frame that
      // enters the group is the last one still showing the previous query's highlights.
      g.clearEdges()
      g.clearMarks()
    }

    viz.group(query, () => {
      // Both endpoints, always — a query that returns -1 because nobody ever wrote an equation
      // about `e` should show the lookup that failed, not an untouched panel.
      const haveFrom = known.has(from)
      const haveTo = known.has(to)
      if (!haveFrom || !haveTo) {
        answers[q] = -1
        answers.mark(q, 'excluded')
        viz.step(`${query}: ${haveFrom ? to : from} never appears in an equation`)
        return
      }

      if (from === to) {
        // The empty path. Its product is 1 — but only because the variable exists, which is why
        // this test comes second.
        g.mark(from, 'result', `${from} / ${from} = 1`)
        answers[q] = 1
        answers.mark(q, 'result')
        viz.step(`${query}: the same variable — zero edges to walk, so the product is 1`)
        return
      }

      g.mark(to, 'pinned', 'target')
      const found = walk(from, to, 1)

      answers[q] = found
      answers.mark(q, found > 0 ? 'result' : 'excluded')
      viz.step(
        found > 0
          ? `${query} = ${fmt(found)} — the product of the highlighted edges`
          : `${query}: no chain of equations connects ${from} to ${to}`,
      )
    })
  })

  return answers.toArray()
}

const starter = `// a / b = 2 is an edge a -> b weighted 2, and an edge b -> a weighted 1/2. A query
// c / d is then a path from c to d, and the answer is the product of the weights along it.
// Anything unreachable — or never mentioned in an equation at all — is -1.
export default function calcEquation(
  equations: string[][],
  values: number[],
  queries: string[][],
  viz: Viz,
): number[] {
  const wired = equations.flatMap(([a, b], i) => [
    [a, b, values[i]] as const,
    [b, a, 1 / values[i]] as const,
  ])
  const g = viz.graph({ name: 'variables', directed: true, weighted: true, edges: wired })

  const known = viz.map<string, number>([], { name: 'known' })
  viz.quiet(() => {
    for (const v of g.nodes) known.set(v, g.degree(v))
  })

  const answers = viz.array<number>(queries.length, { name: 'answers', fill: null })

  let query = ''
  let running = 1
  viz.watch(() => ({ query, product: running }))
  const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(5).replace(/0+$/, ''))

  let seen = new Set<string>()

  const walk = (at: string, target: string, product: number): number => {
    running = product
    if (at === target) {
      g.mark(at, 'result', \`reached \${target}\`)
      viz.step(\`reached \${target} — the walk multiplied out to \${fmt(product)}\`)
      return product
    }
    seen.add(at)
    g.visit(at)

    return viz.group(\`\${at} (running \${fmt(product)})\`, () => {
      // TODO: for each neighbour of \`at\` — use g.neighbors(at), which lights the edge as it
      // yields it — skip the ones already in \`seen\` (mark that edge 'rejected'), otherwise take
      // the edge: w = g.weightOf(at, next), mark it 'tree', and recurse with product * w.
      // If the recursion comes back positive, promote the edge to 'path' and return the answer.
      // If it comes back -1, restore \`running\` to \`product\` *first* and only then mark the
      // edge 'rejected' — those are two frames, and in the other order the frame that gives up
      // on the edge still shows the product from the branch it just abandoned.
      viz.step(\`\${at}: every edge from here leads somewhere already explored — back up\`)
      return -1
    })
  }

  queries.forEach(([from, to], q) => {
    query = \`\${from} / \${to}\`
    running = 1
    seen = new Set<string>()

    if (q > 0) {
      // Reset the picture *before* opening the query's scope, or the frame that enters it is one
      // more frame of the previous query's highlights.
      g.clearEdges()
      g.clearMarks()
    }

    viz.group(query, () => {
      // Look both endpoints up, always, so a -1 caused by an unknown variable is on screen.
      const haveFrom = known.has(from)
      const haveTo = known.has(to)
      // TODO: if either endpoint is missing the answer is -1. If they are the same *known*
      // variable the answer is 1 with no edge walked — g.mark it 'result' and step, or the
      // query emits no frames at all and flashes past showing the previous query's picture.
      // Otherwise g.mark(to, 'pinned') and walk from \`from\`.
      // Whichever branch you take: write answers[q], then answers.mark(q, ...) with 'result' or
      // 'excluded', then viz.step — the answer before the mark that announces it.
      answers[q] = -1
      answers.mark(q, 'excluded')
      viz.step(\`\${query}: TODO\`)
    })
  })

  return answers.toArray()
}
`

export const evaluateDivision: ProblemDefinition = {
  id: 'p399',
  leetcode: 399,
  slug: 'evaluate-division',
  title: 'Evaluate Division',
  difficulty: 'medium',
  category: 'graphs-dfs',
  statement:
    'You are given equations of the form `A / B = k` as a list of variable pairs and a list of ' +
    'values, plus a list of queries `C / D`. Return the answer to each query, or `-1.0` when it ' +
    'cannot be determined — either because no chain of equations connects the two variables, or ' +
    'because one of them never appears in an equation at all.',
  structures: ['graph', 'map', 'array'],
  // `approx`, not `deep`. Every answer is a product of divisions, so `b / a` for `a / b = 3` is
  // 0.3333333333333333 and no decimal literal in the case list below is exactly equal to it.
  // `deep` would fail the reference on a case whose answer is right to fifteen places, and the
  // real judge accepts 1e-5. `approx` recurses into the array, which is what makes it usable here
  // where the returned value is `number[]` rather than a single number.
  comparator: 'approx',
  entry: 'calcEquation',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    {
      // The canonical example, and it is the canonical example because it carries both traps:
      // `a / e` names a variable no equation mentions, and `a / a` is 1 while `x / x` is -1.
      name: 'example — two equations, five queries',
      args: [
        [['a', 'b'], ['b', 'c']],
        [2, 3],
        [['a', 'c'], ['b', 'a'], ['a', 'e'], ['a', 'a'], ['x', 'x']],
      ],
      expected: [6, 0.5, -1, 1, -1],
      tags: ['example'],
    },
    {
      // Two components that never meet: `bc`/`cd` is its own island, so `a / cd` is -1 for a
      // reason the walk has to discover rather than look up.
      name: 'example — multi-letter variables in two components',
      args: [
        [['a', 'b'], ['b', 'c'], ['bc', 'cd']],
        [1.5, 2.5, 5],
        [['a', 'c'], ['c', 'b'], ['bc', 'cd'], ['cd', 'bc']],
      ],
      expected: [3.75, 0.4, 5, 0.2],
      tags: ['example'],
    },
    {
      // The smallest legal input: one equation. Every kind of answer appears once.
      name: 'example — a single equation answers four kinds of query',
      args: [
        [['a', 'b']],
        [0.5],
        [['a', 'b'], ['b', 'a'], ['a', 'c'], ['x', 'y']],
      ],
      expected: [0.5, 2, -1, -1],
      tags: ['example'],
    },
    {
      // `x / x` is the case that separates "the empty path has product 1" from "1 is always the
      // answer to a self-division": `c / c` is -1 because no equation ever mentions `c`.
      name: 'edge — a variable divided by itself, known and unknown',
      args: [
        [['a', 'b']],
        [3],
        [['a', 'a'], ['b', 'b'], ['c', 'c']],
      ],
      expected: [1, 1, -1],
      tags: ['edge'],
    },
    {
      // Both variables exist and both are unreachable from each other. This is the only case
      // where -1 comes out of a *walk* that ran out of edges rather than out of a failed lookup.
      name: 'edge — two disconnected components, both endpoints known',
      args: [
        [['a', 'b'], ['c', 'd']],
        [2, 3],
        [['a', 'd'], ['d', 'a'], ['a', 'b'], ['c', 'd']],
      ],
      expected: [-1, -1, 2, 3],
      tags: ['edge'],
    },
    {
      // Four edges deep in each direction — the case where the answer is visibly a *product* and
      // not a lookup, and where the reciprocal direction is 1/16 rather than a tidy integer.
      name: 'edge — a four-link chain, forwards and backwards',
      args: [
        [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e']],
        [2, 2, 2, 2],
        [['a', 'e'], ['e', 'a'], ['c', 'a'], ['b', 'd']],
      ],
      expected: [16, 0.0625, 0.25, 4],
      tags: ['edge'],
    },
    {
      // A cycle. A walk with no `seen` guard never terminates here, and a walk that takes the
      // first edge it sees must still get the right answer whichever way round it goes.
      name: 'edge — a consistent cycle offers two routes to the same answer',
      args: [
        [['a', 'b'], ['b', 'c'], ['a', 'c']],
        [2, 3, 6],
        [['c', 'a'], ['a', 'c'], ['c', 'b']],
      ],
      expected: [0.16667, 6, 0.33333],
      tags: ['edge'],
    },
    {
      // 1/3 is not representable, and 0.33333 is not equal to it. This case is the proof that the
      // comparator is `approx`: under `deep` it fails while being right to fifteen places.
      name: 'edge — the answer is not exactly representable',
      args: [
        [['a', 'b']],
        [3],
        [['b', 'a'], ['a', 'b']],
      ],
      expected: [0.33333, 3],
      tags: ['edge'],
    },
    {
      // A star: `hub` touches everything, so the walk from one spoke to another is always two
      // edges and the hub is the only node with a choice to make.
      name: 'edge — a star, where every path is two edges through the hub',
      args: [
        [['x', 'hub'], ['y', 'hub'], ['z', 'hub']],
        [4, 2, 8],
        [['x', 'y'], ['z', 'x'], ['y', 'z'], ['hub', 'hub']],
      ],
      expected: [2, 2, 0.25, 1],
      tags: ['edge'],
    },
  ],
  hints: [
    'An equation `a / b = 2` says two things at once: a step from a to b multiplies by 2, and a ' +
      'step from b to a multiplies by 1/2. Both belong in the graph.',
    'A query is then a path. Walk from the numerator, multiplying the running product by each ' +
      'edge weight you cross, and the answer is whatever that product is when you arrive.',
    'Two queries never reach the walk at all: one whose variables are not both in the graph is ' +
      '-1, and `x / x` for a variable that *is* in the graph is 1 without crossing any edge. ' +
      'Check the first before the second, or `x / x` answers 1 for a variable nobody defined.',
  ],
}
