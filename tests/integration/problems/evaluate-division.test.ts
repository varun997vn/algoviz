import { beforeAll, describe, expect, it } from 'vitest'
import { executeRun, type CaseResult } from '@algoviz/runner'
import { TraceReader, type StructureSnapshot, type Trace } from '@algoviz/tracer'

/**
 * Evaluate Division — frame-sequence assertions.
 *
 * The return value proves nothing here, and unusually little. Every answer in this problem can be
 * produced by machinery that never walks anything: a weighted union-find collapses each component
 * to a single representative and divides two stored ratios, and a Floyd–Warshall table computes
 * all pairs up front and then answers each query with one lookup. Both are correct, both pass a
 * `deep`/`approx` comparison on every case in the file, and both animate a picture in which no
 * variable is ever reached *through* another one — which is the only thing this problem is
 * teaching.
 *
 * So the load-bearing assertion here is `path edges multiply to the answer`: for every query, the
 * edges the trace itself left marked `path` must form a chain from the numerator to the
 * denominator, and the product of *their* weights — read off the graph snapshot, not off the
 * return value — must equal the number the solution returned. A table lookup leaves no `path`
 * edges and fails it. `rejects an all-pairs table that returns identical answers` runs exactly
 * that solution and proves the assertion has teeth.
 *
 * The rest guards the two edge cases that make this problem more than a BFS: a query about an
 * unknown variable and a query about a variable divided by itself are both answerable without
 * touching the graph, and written naively they emit *no frames at all* — the query flashes past
 * still showing the previous one's picture. Every query must leave something behind.
 */

const PROBLEM = 'evaluate-division'

type GraphSnapshot = Extract<StructureSnapshot, { kind: 'graph' }>
type ArraySnapshot = Extract<StructureSnapshot, { kind: 'array' }>

const CASES = [
  'example — two equations, five queries',
  'example — multi-letter variables in two components',
  'example — a single equation answers four kinds of query',
  'edge — a variable divided by itself, known and unknown',
  'edge — two disconnected components, both endpoints known',
  'edge — a four-link chain, forwards and backwards',
  'edge — a consistent cycle offers two routes to the same answer',
  'edge — the answer is not exactly representable',
  'edge — a star, where every path is two edges through the hub',
]

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

/**
 * One entry per query, delimited by the outermost `viz.group` label.
 *
 * Split on *runs* rather than on the label itself, so two identical queries in one case would
 * still be two entries. A solution that never opens a query scope produces `[]` — which is why
 * every `it` below also asserts the count, or the whole file would pass vacuously on a lookup
 * table.
 */
interface QueryRun {
  label: string
  from: string
  to: string
  first: number
  last: number
}

function queryRuns(trace: Trace): QueryRun[] {
  const runs: QueryRun[] = []
  for (const frame of trace.frames) {
    const label = frame.groups[0]
    if (label === undefined) continue
    const current = runs[runs.length - 1]
    if (current && current.label === label && current.last === frame.index - 1) {
      current.last = frame.index
      continue
    }
    const [from, to] = label.split(' / ')
    runs.push({ label, from: from ?? '', to: to ?? '', first: frame.index, last: frame.index })
  }
  return runs
}

function framesIn(trace: Trace, run: QueryRun): Trace['frames'] {
  return trace.frames.slice(run.first, run.last + 1)
}

/** `visit a` -> `a`. Emitted by `g.visit`, once per node the walk settles on. */
function visitedNode(label: string | undefined): string | undefined {
  return /^visit (\S+)$/.exec(label ?? '')?.[1]
}

const EXPLORING = new Set(['active', 'tree', 'rejected', 'path'])

/**
 * Walk the `path`-marked edges of `graph` from `from`, and return the product of their weights.
 *
 * Throws rather than returning a wrong number when the marks do not form a single simple chain
 * ending at `to` — a fan of `path` edges, or a chain that stops short, is a picture that claims
 * something it cannot back up, and it must not quietly multiply out to the right answer.
 */
function productAlongMarkedPath(graph: GraphSnapshot, from: string, to: string): number {
  const weight = new Map(graph.edges.map((e) => [`${e.from}->${e.to}`, e.weight]))
  const next = new Map<string, string>()
  for (const mark of graph.edgeMarks) {
    if (mark.class !== 'path') continue
    if (next.has(mark.from)) throw new Error(`${mark.from} has two outgoing path edges`)
    next.set(mark.from, mark.to)
  }

  let at = from
  let product = 1
  const walked = new Set<string>()
  while (at !== to) {
    const step = next.get(at)
    if (step === undefined) throw new Error(`path marks stop at ${at}, never reaching ${to}`)
    if (walked.has(at)) throw new Error(`path marks loop back through ${at}`)
    walked.add(at)
    const w = weight.get(`${at}->${step}`)
    if (w === undefined) throw new Error(`edge ${at}->${step} is marked path but carries no weight`)
    product *= w
    at = step
  }
  if (walked.size !== next.size) {
    throw new Error(`${next.size - walked.size} path edge(s) hang off the chain from ${from} to ${to}`)
  }
  return product
}

/**
 * **The assertion this problem exists for**, as a predicate so the reference and the impostors
 * below are judged by the identical code.
 *
 * For every query: the edges the trace left marked `path` form a chain from the numerator to the
 * denominator, and *their* weights multiply to the number the solution returned. Nothing here
 * looks at the answer except to compare it — the product is read out of the picture.
 */
function pathComplaints(trace: Trace, answers: readonly number[]): string[] {
  const complaints: string[] = []
  const reader = new TraceReader(trace)
  const runs = queryRuns(trace)
  if (runs.length !== answers.length) {
    return [`${runs.length} query scope(s) for ${answers.length} queries`]
  }
  runs.forEach((run, q) => {
    const answer = answers[q]!
    const graph = only(reader, run.last, 'graph')
    const marked = graph.edgeMarks.filter((m) => m.class === 'path')
    if (answer < 0) {
      if (marked.length > 0) complaints.push(`${run.label}: -1 but a path is highlighted`)
      return
    }
    try {
      const product = productAlongMarkedPath(graph, run.from, run.to)
      if (Math.abs(product - answer) > 1e-9) {
        complaints.push(`${run.label}: returned ${answer}, the highlighted path multiplies to ${product}`)
      }
    } catch (err) {
      complaints.push(`${run.label}: ${(err as Error).message}`)
    }
    // `x / x` is the one answer that is legitimately a zero-edge path, and it is the only one.
    if (run.from !== run.to && marked.length === 0) {
      complaints.push(`${run.label}: answered ${answer} with no edge walked`)
    }
  })
  return complaints
}

/** The body of `every query opens on a graph with nothing left over`, as a predicate. */
function leakComplaints(trace: Trace): string[] {
  const complaints: string[] = []
  const reader = new TraceReader(trace)
  for (const run of queryRuns(trace).slice(1)) {
    const graph = only(reader, run.first, 'graph')
    if (graph.marks.length > 0) {
      complaints.push(`${run.label} opens with node marks from the query before`)
    }
    const lit = graph.edgeMarks.filter((m) => EXPLORING.has(m.class))
    if (lit.length > 0) {
      complaints.push(`${run.label} opens with ${lit.length} edge(s) still lit from the query before`)
    }
  }
  return complaints
}

describe('Evaluate Division — reference solution', () => {
  it('passes every one of its own cases', () => {
    const failures = [...byName.values()].filter((r) => !r.passed)
    expect(
      failures.map((f) => `${f.name}: got ${JSON.stringify(f.returned)}, want ${JSON.stringify(f.expected)}`),
    ).toEqual([])
  })

  it('drives a graph, a map and an array', () => {
    for (const result of byName.values()) {
      const kinds = result.trace.structures.map((s) => s.kind)
      expect(kinds, result.name).toContain('graph')
      expect(kinds, result.name).toContain('map')
      expect(kinds, result.name).toContain('array')
    }
  })

  it.each(CASES)('%s — the graph is weighted and carries both directions of every equation', (name) => {
    const result = caseByName(name)
    const reader = new TraceReader(result.trace)
    const graph = only(reader, reader.frameCount - 1, 'graph')

    expect(graph.weighted, name).toBe(true)
    expect(graph.directed, name).toBe(true)
    // Every edge has a weight, and every edge has an opposite whose weight is its reciprocal.
    // That is the whole model: one step in either direction is one multiplication.
    const byPair = new Map(graph.edges.map((e) => [`${e.from}->${e.to}`, e.weight]))
    expect(graph.edges.filter((e) => e.weight === undefined), name).toEqual([])
    for (const e of graph.edges) {
      const back = byPair.get(`${e.to}->${e.from}`)
      expect(back, `${name}: ${e.to}->${e.from} is missing`).toBeDefined()
      expect(e.weight! * back!, `${name}: ${e.from}/${e.to} and its reciprocal`).toBeCloseTo(1, 10)
    }
  })
})

describe('every query leaves something on screen', () => {
  it.each(CASES)('%s — one query scope per query, in order', (name) => {
    const result = caseByName(name)
    const runs = queryRuns(result.trace)
    const answers = result.returned as number[]
    expect(runs, name).toHaveLength(answers.length)
  })

  it.each(CASES)('%s — every query narrates at least one step of its own', (name) => {
    // The failure mode this exists for: `x / x` and `a / e` are answerable without touching the
    // graph, so a solution that returns early emits nothing and the query is invisible in the
    // player — it looks like the previous query's picture lingering.
    const result = caseByName(name)
    for (const run of queryRuns(result.trace)) {
      const steps = framesIn(result.trace, run).filter((f) => f.op === 'step')
      expect(steps.length, `${name}: query ${run.label} narrates nothing`).toBeGreaterThan(0)
    }
  })

  it('shows the failed symbol-table lookup that makes an unknown variable -1', () => {
    const result = caseByName('example — two equations, five queries')
    for (const label of ['a / e', 'x / x']) {
      const run = queryRuns(result.trace).find((r) => r.label === label)!
      const frames = framesIn(result.trace, run)
      expect(frames.some((f) => /^has "\w+" -> false$/.test(f.label ?? '')), label).toBe(true)
      expect(
        frames.some((f) => f.op === 'step' && /never appears in an equation/.test(f.label ?? '')),
        label,
      ).toBe(true)
    }
  })

  it('marks the node and says why when a variable is divided by itself', () => {
    // `a / a` is 1 and `c / c` is -1, and the difference is only whether the variable exists.
    // Both must be visible; neither walks an edge, so the marks are all there is.
    const result = caseByName('edge — a variable divided by itself, known and unknown')
    const reader = new TraceReader(result.trace)
    const runs = queryRuns(result.trace)
    expect(result.returned).toEqual([1, 1, -1])

    for (const label of ['a / a', 'b / b']) {
      const run = runs.find((r) => r.label === label)!
      const graph = only(reader, run.last, 'graph')
      const self = run.from
      expect(
        graph.marks.filter((m) => m.id === self && m.class === 'result'),
        `${label}: the variable itself is not marked as the answer`,
      ).toHaveLength(1)
      expect(graph.edgeMarks.filter((m) => EXPLORING.has(m.class)), `${label}: walked an edge`).toEqual([])
    }

    const unknown = runs.find((r) => r.label === 'c / c')!
    expect(only(reader, unknown.last, 'graph').marks, 'c / c marked something').toEqual([])
    expect(
      framesIn(result.trace, unknown).some((f) => /^has "c" -> false$/.test(f.label ?? '')),
    ).toBe(true)
  })

  it('has a frame showing exactly where a connected-looking query gave up', () => {
    // `a / d` fails after a real walk: `a` and `d` both exist, the walk reaches `b`, and `b` has
    // nothing left to try. That frame is the answer to "why -1", and it is the only place a
    // viewer can see it.
    const result = caseByName('edge — two disconnected components, both endpoints known')
    const run = queryRuns(result.trace).find((r) => r.label === 'a / d')!
    const frames = framesIn(result.trace, run)
    const gaveUp = frames.filter((f) => f.op === 'step' && /back up/.test(f.label ?? ''))
    expect(gaveUp.map((f) => f.label)).toEqual([
      'b: every edge from here leads somewhere already explored — back up',
      'a: every edge from here leads somewhere already explored — back up',
    ])
    // And every edge it tried is shown as tried, not left looking untouched.
    const reader = new TraceReader(result.trace)
    const graph = only(reader, run.last, 'graph')
    expect(graph.edgeMarks.filter((m) => m.class === 'rejected').length).toBeGreaterThan(0)
    expect(graph.edgeMarks.filter((m) => m.class === 'path')).toEqual([])
  })
})

describe('the highlighted edges multiply out to the answer', () => {
  // The assertion the problem exists for, and the one a lookup table cannot satisfy.
  it.each(CASES)('%s', (name) => {
    const result = caseByName(name)
    expect(pathComplaints(result.trace, result.returned as number[]), name).toEqual([])
  })

  it('is not a vacuous check — most queries in the set really do walk an edge', () => {
    // The per-case assertions above are all conditional on there being something to walk, so this
    // counts how much of the case set actually exercises them. A table solution scores 0.
    let walked = 0
    let visited = 0
    for (const name of CASES) {
      const result = caseByName(name)
      const reader = new TraceReader(result.trace)
      const answers = result.returned as number[]
      queryRuns(result.trace).forEach((run, q) => {
        if (answers[q]! < 0 || run.from === run.to) return
        walked += only(reader, run.last, 'graph').edgeMarks.filter((m) => m.class === 'path').length
        visited += framesIn(result.trace, run).filter((f) => visitedNode(f.label) !== undefined).length
      })
    }
    expect(walked).toBeGreaterThan(25)
    expect(visited).toBeGreaterThan(25)
  })

  it('reads the same product out of the watch panel on the frame that arrives', () => {
    const result = caseByName('edge — a four-link chain, forwards and backwards')
    const reader = new TraceReader(result.trace)
    const answers = result.returned as number[]
    queryRuns(result.trace).forEach((run, q) => {
      const arrival = framesIn(result.trace, run).find(
        (f) => f.op === 'step' && /^reached /.test(f.label ?? ''),
      )
      if (answers[q]! < 0) {
        expect(arrival, `${run.label} is -1 but claims to have arrived`).toBeUndefined()
        return
      }
      expect(arrival, `${run.label} never announces arriving`).toBeDefined()
      expect(reader.watchAt(arrival!.index)?.product as number).toBeCloseTo(answers[q]!, 10)
    })
  })
})

describe('one query does not leak into the next', () => {
  it.each(CASES)('%s — no node visited twice inside a query', (name) => {
    const result = caseByName(name)
    for (const run of queryRuns(result.trace)) {
      const visits = framesIn(result.trace, run)
        .map((f) => visitedNode(f.label))
        .filter((v): v is string => v !== undefined)
      expect(new Set(visits).size, `${name}: ${run.label} revisits a node`).toBe(visits.length)
    }
  })

  it.each(CASES)('%s — every query opens on a graph with nothing left over', (name) => {
    // The one `VizGraph` genuinely could not do: `clearMarks` resets node marks and leaves edge
    // marks behind for ever, so this is checking the hand-rolled demotion in the reference as
    // much as the tracer. Without it, query 2 of every case opens with query 1's answer still lit.
    const result = caseByName(name)
    expect(queryRuns(result.trace).length).toBeGreaterThan(1)
    expect(leakComplaints(result.trace), name).toEqual([])
  })

  it.each(CASES)('%s — the answers panel ends up equal to the returned array', (name) => {
    const result = caseByName(name)
    const reader = new TraceReader(result.trace)
    const answers: ArraySnapshot = only(reader, reader.frameCount - 1, 'array')
    const returned = result.returned as number[]
    expect(answers.values).toHaveLength(returned.length)
    answers.values.forEach((v, i) => {
      expect(v as number, `${name}: answers[${i}]`).toBeCloseTo(returned[i]!, 10)
    })
    // And each cell says which kind of answer it is, so the panel is readable on its own.
    const marks = new Map(answers.marks.map((m) => [m.index, m.class]))
    returned.forEach((v, i) => {
      expect(marks.get(i), `${name}: answers[${i}] = ${v} is unmarked`).toBe(v < 0 ? 'excluded' : 'result')
    })
  })
})

/**
 * Everything above `pathComplaints` is shared scaffolding; this is the part that shows it is not
 * describing a tautology.
 *
 * Two correct solutions that answer every case with the same numbers as the reference, and one
 * copy of the reference with the between-query reset removed. All three are green under the
 * comparator; all three are rejected by the assertions that describe the picture.
 */
const IMPOSTOR_HEAD = `
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
`

/**
 * Floyd–Warshall: correct, idiomatic, and it answers every query with one lookup into a table it
 * built before the first query ran. It declares the same three structures, so
 * `drives a graph, a map and an array` passes, and it returns the same numbers, so the comparator
 * passes. It never opens a query scope and never walks an edge.
 */
const ALL_PAIRS = `${IMPOSTOR_HEAD}
  const vars = g.nodes
  const ratio = new Map<string, number>()
  for (const v of vars) ratio.set(v + '|' + v, 1)
  for (const [u, v, w] of wired) ratio.set(u + '|' + v, w)
  for (const k of vars) {
    for (const i of vars) {
      for (const j of vars) {
        const a = ratio.get(i + '|' + k)
        const b = ratio.get(k + '|' + j)
        if (a !== undefined && b !== undefined) ratio.set(i + '|' + j, a * b)
      }
    }
  }

  queries.forEach(([from, to], q) => {
    const found = ratio.get(from + '|' + to)
    const answer = found === undefined ? -1 : found
    answers[q] = answer
    answers.mark(q, answer < 0 ? 'excluded' : 'result')
    viz.step(from + ' / ' + to + ' = ' + answer)
  })

  return answers.toArray()
}
`

/**
 * Weighted union-find — the *harder* impostor, and the reason the path assertion exists rather
 * than a scope count. It collapses each component to a representative up front and divides two
 * stored ratios per query, but it does open a `viz.group` per query and narrate a step inside it,
 * so a solution judged on "one scope per query" would pass it. Nothing is ever reached *through*
 * anything: no node is visited, no edge is lit.
 */
const UNION_FIND = `${IMPOSTOR_HEAD}
  const parent = new Map<string, string>()
  const ratio = new Map<string, number>()
  for (const v of g.nodes) { parent.set(v, v); ratio.set(v, 1) }
  const find = (x: string): [string, number] => {
    let at = x
    let acc = 1
    while (parent.get(at) !== at) { acc *= ratio.get(at) ?? 1; at = parent.get(at) ?? at }
    return [at, acc]
  }
  for (const [u, v, w] of wired) {
    const [ru, au] = find(u)
    const [rv, av] = find(v)
    if (ru !== rv) { parent.set(ru, rv); ratio.set(ru, (w * av) / au) }
  }

  queries.forEach(([from, to], q) => {
    viz.group(from + ' / ' + to, () => {
      let answer = -1
      if (parent.has(from) && parent.has(to)) {
        const [rf, af] = find(from)
        const [rt, att] = find(to)
        if (rf === rt) answer = af / att
      }
      answers[q] = answer
      answers.mark(q, answer < 0 ? 'excluded' : 'result')
      viz.step(from + ' / ' + to + ' = ' + answer)
    })
  })

  return answers.toArray()
}
`

describe('a solution that never walks the graph is rejected', () => {
  it.each([
    ['an all-pairs table', ALL_PAIRS],
    ['a weighted union-find', UNION_FIND],
  ])('%s returns identical answers and still fails', (label, source) => {
    const run = executeRun({ problem: PROBLEM, source, caseIndex: 'all' })
    expect(run.diagnostics, label).toEqual([])
    // Genuinely correct: same answers as the reference, every case green under the comparator.
    expect(run.results.filter((r) => !r.passed).map((r) => r.name), label).toEqual([])
    for (const impostor of run.results) {
      expect(impostor.returned, `${label}: ${impostor.name}`).toEqual(caseByName(impostor.name).returned)
    }

    // Rejected on every case that has a query with an edge to walk. The exception is
    // `a variable divided by itself`, where the reference walks nothing either — which is exactly
    // why it is not the only edge case in the file.
    const walkable = CASES.filter((name) => {
      const reference = caseByName(name)
      const answers = reference.returned as number[]
      return queryRuns(reference.trace).some((run2, q) => answers[q]! > 0 && run2.from !== run2.to)
    })
    expect(walkable, 'nearly every case must have something to walk').toHaveLength(CASES.length - 1)

    const rejected = run.results
      .filter((r) => pathComplaints(r.trace, r.returned as number[]).length > 0)
      .map((r) => r.name)
    expect(rejected, label).toEqual(expect.arrayContaining(walkable))
  })

  it('rejects a correct walk that never resets the picture between queries', () => {
    // The other half, and the one that keeps the reference's hand-rolled edge demotion honest.
    // This solution walks the graph exactly as the reference does — it would pass every path
    // assertion — but it omits the reset, so query 2 opens with query 1's answer still lit and
    // by the last query the picture is the union of every query in the case. Answers identical,
    // every case green.
    const run = executeRun({ problem: PROBLEM, source: WALK_WITHOUT_RESET, caseIndex: 'all' })
    expect(run.diagnostics).toEqual([])
    expect(run.results.filter((r) => !r.passed).map((r) => r.name)).toEqual([])
    for (const impostor of run.results) {
      expect(impostor.returned, impostor.name).toEqual(caseByName(impostor.name).returned)
    }
    const leaking = run.results.filter((r) => leakComplaints(r.trace).length > 0).map((r) => r.name)
    expect(leaking).toEqual(run.results.map((r) => r.name))
  })
})

/** The reference's walk, minus the two lines that reset the picture between queries. */
const WALK_WITHOUT_RESET = `${IMPOSTOR_HEAD}
  let seen = new Set<string>()

  const walk = (at: string, target: string, product: number): number => {
    if (at === target) {
      g.mark(at, 'result', 'reached ' + target)
      viz.step('reached ' + target)
      return product
    }
    seen.add(at)
    g.visit(at)
    return viz.group(at, () => {
      for (const next of g.neighbors(at)) {
        if (seen.has(next)) { g.edge(at, next, 'rejected', 'already explored'); continue }
        const w = g.weightOf(at, next) ?? 1
        g.edge(at, next, 'tree', 'x ' + w)
        const found = walk(next, target, product * w)
        if (found > 0) { g.edge(at, next, 'path', 'on the path'); return found }
        g.edge(at, next, 'rejected', 'dead end')
      }
      viz.step(at + ': back up')
      return -1
    })
  }

  queries.forEach(([from, to], q) => {
    seen = new Set<string>()
    viz.group(from + ' / ' + to, () => {
      const haveFrom = known.has(from)
      const haveTo = known.has(to)
      if (!haveFrom || !haveTo) {
        answers[q] = -1
        answers.mark(q, 'excluded')
        viz.step('unknown variable')
        return
      }
      if (from === to) {
        g.mark(from, 'result', 'same variable')
        answers[q] = 1
        answers.mark(q, 'result')
        viz.step('same variable')
        return
      }
      g.mark(to, 'pinned', 'target')
      const found = walk(from, to, 1)
      answers[q] = found
      answers.mark(q, found > 0 ? 'result' : 'excluded')
      viz.step('done')
    })
  })

  return answers.toArray()
}
`

describe('the starter teaches the animation, not just the answer', () => {
  /**
   * The starter filled in exactly as its TODOs instruct, run through the same assertions as the
   * reference. Five problems in this repo have shipped with a fix in the reference and the defect
   * left in the starter — including the ordering rule Rotting Oranges' own starter contradicted —
   * so the starter is asserted rather than trusted.
   */
  const source = `
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
      g.mark(at, 'result', 'reached ' + target)
      viz.step('reached ' + target + ' — the walk multiplied out to ' + fmt(product))
      return product
    }
    seen.add(at)
    g.visit(at)

    return viz.group(at + ' (running ' + fmt(product) + ')', () => {
      for (const next of g.neighbors(at)) {
        if (seen.has(next)) {
          g.edge(at, next, 'rejected', 'already explored in this query')
          continue
        }
        const w = g.weightOf(at, next) ?? 1
        g.edge(at, next, 'tree', 'x ' + fmt(w))
        const found = walk(next, target, product * w)
        if (found > 0) {
          g.edge(at, next, 'path', at + ' / ' + next + ' = ' + fmt(w))
          return found
        }
        running = product
        g.edge(at, next, 'rejected', 'dead end')
      }
      viz.step(at + ': every edge from here leads somewhere already explored — back up')
      return -1
    })
  }

  queries.forEach(([from, to], q) => {
    query = from + ' / ' + to
    running = 1
    seen = new Set<string>()

    if (q > 0) {
      viz.quiet(() => {
        for (const [u, v] of wired) g.edge(u, v, 'visited')
      })
      g.clearMarks()
    }

    viz.group(query, () => {
      const haveFrom = known.has(from)
      const haveTo = known.has(to)
      if (!haveFrom || !haveTo) {
        answers[q] = -1
        answers.mark(q, 'excluded')
        viz.step(query + ': ' + (haveFrom ? to : from) + ' never appears in an equation')
        return
      }
      if (from === to) {
        g.mark(from, 'result', from + ' / ' + from + ' = 1')
        answers[q] = 1
        answers.mark(q, 'result')
        viz.step(query + ': the same variable — zero edges to walk, so the product is 1')
        return
      }
      g.mark(to, 'pinned', 'target')
      const found = walk(from, to, 1)
      answers[q] = found
      answers.mark(q, found > 0 ? 'result' : 'excluded')
      viz.step(
        found > 0
          ? query + ' = ' + fmt(found) + ' — the product of the highlighted edges'
          : query + ': no chain of equations connects ' + from + ' to ' + to,
      )
    })
  })

  return answers.toArray()
}
`

  it('answers every case and animates a real walk when filled in as instructed', () => {
    const run = executeRun({ problem: PROBLEM, source, caseIndex: 'all' })
    expect(run.diagnostics).toEqual([])
    expect(run.results.filter((r) => !r.passed).map((r) => r.name)).toEqual([])

    const complaints: string[] = []
    for (const result of run.results) {
      const reader = new TraceReader(result.trace)
      const runs = queryRuns(result.trace)
      const answers = result.returned as number[]
      if (runs.length !== answers.length) {
        complaints.push(`${result.name}: ${runs.length} query scopes for ${answers.length} queries`)
        continue
      }
      runs.forEach((qr, q) => {
        const answer = answers[q]!
        const graph = only(reader, qr.last, 'graph')
        // Same three claims as the reference: the path multiplies out, nothing leaks in from the
        // query before, and no node is walked twice.
        if (answer > 0) {
          try {
            const product = productAlongMarkedPath(graph, qr.from, qr.to)
            if (Math.abs(product - answer) > 1e-9) {
              complaints.push(`${result.name}/${qr.label}: path is ${product}, answer is ${answer}`)
            }
          } catch (err) {
            complaints.push(`${result.name}/${qr.label}: ${(err as Error).message}`)
          }
        } else if (graph.edgeMarks.some((m) => m.class === 'path')) {
          complaints.push(`${result.name}/${qr.label}: -1 but a path is highlighted`)
        }
        if (q > 0) {
          const opening = only(reader, qr.first, 'graph')
          if (opening.marks.length > 0 || opening.edgeMarks.some((m) => EXPLORING.has(m.class))) {
            complaints.push(`${result.name}/${qr.label}: opens with the previous query still lit`)
          }
        }
        const visits = framesIn(result.trace, qr)
          .map((f) => visitedNode(f.label))
          .filter((v): v is string => v !== undefined)
        if (new Set(visits).size !== visits.length) {
          complaints.push(`${result.name}/${qr.label}: revisits a node`)
        }
      })
    }
    expect(complaints).toEqual([])
  })
})
