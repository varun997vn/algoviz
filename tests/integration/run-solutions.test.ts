import { describe, expect, it } from 'vitest'
import { executeRun } from '@algoviz/runner'
import { listProblems, requireProblem } from '@algoviz/problems'
import { TraceReader, type StructureSnapshot } from '@algoviz/tracer'
import { findRepoRoot, loadRoadmap, roadmapPath } from '@algoviz/roadmap/node'

function snapshotsOfKind<K extends StructureSnapshot['kind']>(
  reader: TraceReader,
  frame: number,
  kind: K,
): Extract<StructureSnapshot, { kind: K }>[] {
  return [...reader.at(frame).values()].filter(
    (s): s is Extract<StructureSnapshot, { kind: K }> => s.kind === kind,
  )
}

describe('every reference solution passes every one of its own cases', () => {
  for (const problem of listProblems()) {
    it(`${problem.leetcode} — ${problem.title}`, () => {
      const result = executeRun({ problem: problem.slug, useReference: true })
      const failures = result.results.filter((r) => !r.passed)
      expect(
        failures.map((f) => `${f.name}: got ${JSON.stringify(f.returned)}, want ${JSON.stringify(f.expected)}`),
      ).toEqual([])
      expect(result.passed).toBe(true)
      // A solution that emits no frames would pass its tests and animate nothing.
      for (const r of result.results) expect(r.frameCount).toBeGreaterThan(0)
    })
  }

  it('opens every problem on a case its untouched starter does not already pass', () => {
    // The workbench opens on case 0, so if the shipped starter happens to answer it correctly the
    // learner's first impression is a green tick for code they have not written. Twelve of the
    // thirteen problems already had this property; the one that did not was a boolean problem whose
    // stub returned `true` and whose first example expected `true`. Asserting it makes the
    // convention real rather than incidental — it is a property of the product, not of a test.
    const cheats: string[] = []
    for (const problem of listProblems()) {
      const run = executeRun({ problem: problem.slug, source: problem.starter, caseIndex: 0 })
      if (run.diagnostics.length > 0) continue // a starter that does not compile cannot cheat
      if (run.results[0]?.passed === true) cheats.push(`${problem.slug} (${problem.cases[0]?.name})`)
    }
    expect(cheats).toEqual([])
  })

  it('covers each problem with at least one example and one edge case', () => {
    for (const problem of listProblems()) {
      const tags = problem.cases.flatMap((c) => c.tags ?? [])
      expect(tags, `${problem.slug} has no example case`).toContain('example')
      expect(tags, `${problem.slug} has no edge case`).toContain('edge')
    }
  })

  it('agrees with the roadmap about which structures each problem uses', () => {
    // The missing link. The test below checks the *definition* against the *trace*, and its
    // comment has always claimed that stops the roadmap's coverage matrix lying — but the roadmap
    // is a third list, and `packages/roadmap` deliberately never imports `@algoviz/problems`, so
    // nothing compared it to either. p017 declared `tree` while its solution builds a `trie`;
    // `viz.tree` is binary and has no node-insertion API, so it could not possibly have been used.
    //
    // This matters beyond one wrong line: the coverage matrix is what problem selection is driven
    // from — "which structures has nothing exercised yet" — so an unchecked entry does not just
    // mis-report, it points the next batch at the wrong thing.
    const roadmap = loadRoadmap(roadmapPath(findRepoRoot(process.cwd())))
    const byId = new Map(roadmap.problems.map((p) => [p.slug, p]))
    const drift: string[] = []
    for (const problem of listProblems()) {
      const entry = byId.get(problem.slug)
      if (!entry) {
        drift.push(`${problem.slug} has a definition but no roadmap entry`)
        continue
      }
      // `cursor` is roadmap-only vocabulary on purpose — the schema calls it "an annotation rather
      // than a structure but worth tracking for coverage", and `StructureKind` has no such kind. So
      // it is excluded here rather than being forced into definitions where it would not typecheck.
      const planned = entry.structures.filter((k) => k !== 'cursor')
      const declared = [...problem.structures].sort().join(', ')
      const plannedKinds = [...planned].sort().join(', ')
      if (declared !== plannedKinds) {
        drift.push(`${problem.slug}: roadmap [${plannedKinds}] vs definition [${declared}]`)
      }
    }
    expect(drift).toEqual([])
  })

  it('declares exactly the structure kinds its reference solution actually emits', () => {
    // Together with the roadmap check above, this makes the chain roadmap -> definition -> trace
    // airtight: what was planned, what is claimed, and what actually happens all have to agree.
    for (const problem of listProblems()) {
      const result = executeRun({ problem: problem.slug, useReference: true, caseIndex: 0 })
      const emitted = new Set(result.results[0]?.trace.structures.map((s) => s.kind))
      for (const declared of problem.structures) {
        expect(emitted, `${problem.slug} declares "${declared}" but never creates one`).toContain(
          declared,
        )
      }
    }
  })
})

describe('Container With Most Water trace semantics', () => {
  const result = executeRun({ problem: 'container-with-most-water', useReference: true, caseIndex: 0 })
  const caseResult = result.results[0]!
  const reader = new TraceReader(caseResult.trace)

  it('returns the known answer for the canonical example', () => {
    expect(caseResult.returned).toBe(49)
    expect(caseResult.passed).toBe(true)
  })

  it('never lets left cross right', () => {
    // The core loop invariant. If the animation ever showed left past right, the trace would
    // be lying about the algorithm even though the return value is correct.
    for (let i = 0; i < reader.frameCount; i += 1) {
      for (const arr of snapshotsOfKind(reader, i, 'array')) {
        const left = arr.cursors.find((c) => c.name === 'left')
        const right = arr.cursors.find((c) => c.name === 'right')
        if (left && right) expect(left.index, `frame ${i}`).toBeLessThanOrEqual(right.index)
      }
    }
  })

  it('moves cursors monotonically — left only right, right only left', () => {
    let prevLeft = -Infinity
    let prevRight = Infinity
    for (let i = 0; i < reader.frameCount; i += 1) {
      for (const arr of snapshotsOfKind(reader, i, 'array')) {
        const left = arr.cursors.find((c) => c.name === 'left')?.index
        const right = arr.cursors.find((c) => c.name === 'right')?.index
        if (left !== undefined) {
          expect(left, `left went backwards at frame ${i}`).toBeGreaterThanOrEqual(prevLeft)
          prevLeft = left
        }
        if (right !== undefined) {
          expect(right, `right went forwards at frame ${i}`).toBeLessThanOrEqual(prevRight)
          prevRight = right
        }
      }
    }
  })

  it('ends with the best pair marked as the result', () => {
    const final = snapshotsOfKind(reader, reader.frameCount - 1, 'array')[0]!
    const resultMarks = final.marks.filter((m) => m.class === 'result')
    expect(resultMarks).toHaveLength(2)
    // height = [1,8,6,2,5,4,8,3,7]; the 49 container spans indices 1 and 8.
    expect(resultMarks.map((m) => m.index).sort((a, b) => a - b)).toEqual([1, 8])
  })

  it('narrates every iteration and keeps the frame count proportional to n', () => {
    const steps = reader.stepFrames()
    expect(steps.length).toBeGreaterThan(0)
    // Two-pointer is O(n); allow generous constant factors but catch accidental O(n^2).
    expect(caseResult.frameCount).toBeLessThan(200)
  })

  it('reports the final answer in the watch panel', () => {
    expect(reader.watchAt(reader.frameCount - 1)?.best).toBe(49)
  })
})

describe('Count Good Nodes trace semantics', () => {
  const result = executeRun({ problem: 'count-good-nodes-in-binary-tree', useReference: true, caseIndex: 0 })
  const caseResult = result.results[0]!
  const reader = new TraceReader(caseResult.trace)

  it('returns 4 for the canonical example', () => {
    expect(caseResult.returned).toBe(4)
  })

  it('unwinds the path highlight — no node is left on the path at the end', () => {
    // The bug class tree animations fail at: `path` marks that accumulate and never clear,
    // leaving the whole tree lit up. This asserts recursion actually unwound.
    const final = snapshotsOfKind(reader, reader.frameCount - 1, 'tree')[0]!
    expect(final.marks.filter((m) => m.class === 'path')).toEqual([])
  })

  it('marks exactly four nodes as the result', () => {
    const final = snapshotsOfKind(reader, reader.frameCount - 1, 'tree')[0]!
    expect(final.marks.filter((m) => m.class === 'result')).toHaveLength(4)
  })

  it('never marks a node both good and excluded', () => {
    for (let i = 0; i < reader.frameCount; i += 1) {
      for (const tree of snapshotsOfKind(reader, i, 'tree')) {
        const good = new Set(tree.marks.filter((m) => m.class === 'result').map((m) => m.id))
        for (const m of tree.marks) {
          if (m.class === 'excluded') expect(good.has(m.id), `frame ${i}, node ${m.id}`).toBe(false)
        }
      }
    }
  })

  it('records recursion depth via group nesting', () => {
    const maxDepth = Math.max(...caseResult.trace.frames.map((f) => f.groups.length))
    expect(maxDepth).toBeGreaterThan(1)
  })
})

describe('Reorder Routes trace semantics', () => {
  const result = executeRun({ problem: 'reorder-routes-to-make-all-paths-lead-to-the-city-zero', useReference: true, caseIndex: 0 })
  const caseResult = result.results[0]!
  const reader = new TraceReader(caseResult.trace)

  it('returns 3 for the canonical example', () => {
    expect(caseResult.returned).toBe(3)
  })

  it('visits every city exactly once', () => {
    const visits = caseResult.trace.frames.filter((f) => f.label?.startsWith('visit '))
    const cities = visits.map((f) => f.label?.slice('visit '.length))
    expect(new Set(cities).size).toBe(cities.length)
    expect(new Set(cities).size).toBe(6)
  })

  it('marks exactly three edges as reversed, matching the answer', () => {
    // The number of `reversed` edges in the animation must equal the number returned, or the
    // picture and the answer disagree.
    const final = snapshotsOfKind(reader, reader.frameCount - 1, 'graph')[0]!
    expect(final.edgeMarks.filter((e) => e.class === 'reversed')).toHaveLength(3)
  })

  it('ends with every city visited', () => {
    const final = snapshotsOfKind(reader, reader.frameCount - 1, 'graph')[0]!
    const visited = final.marks.filter((m) => m.class === 'visited' || m.class === 'result')
    expect(new Set(visited.map((m) => m.id)).size).toBe(6)
  })

  it('keeps the visited set and the graph in agreement', () => {
    const final = reader.at(reader.frameCount - 1)
    const set = [...final.values()].find((s) => s.kind === 'set')
    expect(set?.kind === 'set' && set.values.length).toBe(6)
  })
})

describe('user-supplied source', () => {
  it('compiles and runs TypeScript from a string', () => {
    const source = `
export default function maxArea(height: number[], viz: Viz): number {
  const h = viz.array(height, { name: 'height' })
  let best = 0
  for (let i = 0; i < h.length; i += 1) {
    for (let j = i + 1; j < h.length; j += 1) {
      const area = (j - i) * Math.min(h[i] as number, h[j] as number)
      if (area > best) best = area
    }
  }
  return best
}
`
    const result = executeRun({ problem: 'container-with-most-water', source, caseIndex: 0 })
    expect(result.diagnostics).toEqual([])
    expect(result.results[0]?.passed).toBe(true)
    expect(result.results[0]?.returned).toBe(49)
  })

  it('surfaces a syntax error as a diagnostic instead of throwing', () => {
    const result = executeRun({
      problem: 'container-with-most-water',
      source: 'export default function maxArea(h: number[], viz: Viz): number { return',
    })
    expect(result.passed).toBe(false)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.results).toEqual([])
  })

  it('refuses module imports with an actionable message', () => {
    const result = executeRun({
      problem: 'container-with-most-water',
      source: "import fs from 'node:fs'\nexport default function maxArea() { return 0 }",
    })
    expect(result.diagnostics[0]?.message).toContain('no module access')
    expect(result.diagnostics[0]?.line).toBe(1)
  })

  it('refuses host access such as fetch', () => {
    const result = executeRun({
      problem: 'container-with-most-water',
      source: 'export default function maxArea() { fetch("http://example.com"); return 0 }',
    })
    expect(result.diagnostics.some((d) => d.message.includes('fetch'))).toBe(true)
  })

  it('reports a runtime error at the right source line', () => {
    const source = [
      'export default function maxArea(height: number[], viz: Viz): number {', // 1
      "  const h = viz.array(height, { name: 'height' })", // 2
      "  throw new Error('boom')", // 3
      '}', // 4
    ].join('\n')
    const result = executeRun({ problem: 'container-with-most-water', source, caseIndex: 0 })
    const error = result.results[0]?.error
    expect(error?.message).toBe('boom')
    expect(error?.line).toBe(3)
  })

  it('stops an infinite loop and still reports where it ran away', () => {
    const source = [
      'export default function maxArea(height: number[], viz: Viz): number {',
      "  const h = viz.array(height, { name: 'height' })",
      '  for (;;) { h.mark(0, "active") }',
      '}',
    ].join('\n')
    const result = executeRun(
      { problem: 'container-with-most-water', source, caseIndex: 0, budgets: { maxFrames: 200 } },
    )
    const caseResult = result.results[0]!
    expect(caseResult.passed).toBe(false)
    expect(caseResult.error?.message).toContain('infinite loop')
    expect(caseResult.truncated?.reason).toBe('maxFrames')
    // The partial trace is the whole point — the user needs to see the runaway loop.
    expect(caseResult.frameCount).toBeGreaterThan(0)
  })

  it('does not let a mutating solution corrupt the next case', () => {
    const problem = requireProblem('container-with-most-water')
    const before = JSON.stringify(problem.cases[0]?.args)
    executeRun({
      problem: 'container-with-most-water',
      source: [
        'export default function maxArea(height: number[], viz: Viz): number {',
        '  height.length = 0',
        '  return 0',
        '}',
      ].join('\n'),
      caseIndex: 0,
    })
    expect(JSON.stringify(problem.cases[0]?.args)).toBe(before)
  })

  it('reports a wrong answer as a failure with both values', () => {
    const result = executeRun({
      problem: 'container-with-most-water',
      source: 'export default function maxArea(height: number[], viz: Viz): number { viz.array(height); return 0 }',
      caseIndex: 0,
    })
    expect(result.results[0]?.passed).toBe(false)
    expect(result.results[0]?.returned).toBe(0)
    expect(result.results[0]?.expected).toBe(49)
  })
})
