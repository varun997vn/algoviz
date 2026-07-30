import { describe, expect, it } from 'vitest'
import type { Frame, Trace } from '@algoviz/tracer'
import { renderGroups, renderSnapshot } from './render.js'

/**
 * The group tree is how an auditor navigates a trace, so a wrong frame range here does not just
 * misreport — it sends the next investigation to the wrong frames.
 */
function traceOf(groups: string[][]): Trace {
  const frames: Frame[] = groups.map((g, index) => ({ index, op: 'step', groups: g, snapshots: {} }))
  return { frames, structures: [], opCount: frames.length }
}

describe('renderSnapshot — graph edge marks', () => {
  // The same rule as `GraphViz`, implemented independently here. Two copies of one rule with no
  // test on either can drift apart silently — and the player disagreeing with the tool an audit
  // reads its evidence from is the worst way for that to surface.
  const nodes = [
    { id: 'a', label: 'a' },
    { id: 'b', label: 'b' },
  ]

  it('does not mirror a mark on a directed graph', () => {
    const out = renderSnapshot('g', {
      kind: 'graph',
      nodes,
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
      directed: true,
      marks: [],
      edgeMarks: [{ from: 'a', to: 'b', class: 'tree' }],
    })
    expect(out).toContain('a->b:tree')
    expect(out).not.toContain('b->a:tree')
  })

  it('still mirrors on an undirected graph, where there is one edge either way round', () => {
    const out = renderSnapshot('g', {
      kind: 'graph',
      nodes,
      edges: [{ from: 'a', to: 'b' }],
      directed: false,
      marks: [],
      edgeMarks: [{ from: 'b', to: 'a', class: 'reversed' }],
    })
    expect(out).toContain('a--b:reversed')
  })
})

describe('renderSnapshot — strings', () => {
  it('quotes a string once, not once per character', () => {
    // Each char went through the cell formatter, which JSON-quotes anything non-numeric, and the
    // join was then wrapped in quotes again: `word: ""a""d""` on every string problem.
    const out = renderSnapshot('word', {
      kind: 'string',
      value: 'ad',
      cursors: [],
      marks: [{ index: 1, class: 'result' }],
    })
    expect(out).toBe('word: "ad#"')
  })

  it('still quotes an array cell that could be read as two cells', () => {
    const out = renderSnapshot('nums', { kind: 'array', values: [1, 'a b'], cursors: [], marks: [] })
    expect(out).toBe('nums: [1 "a b"]')
  })
})

describe('renderGroups', () => {
  it('keeps two disjoint scopes with the same label apart', () => {
    // Keyed by label path, the second `search("app")` merely widened the first one's range, so it
    // was reported as spanning everything in between — on the trie problem that meant one scope
    // swallowing the three calls that ran between the two lookups.
    const out = renderGroups(
      traceOf([
        ['search("app")'],
        ['search("app")'],
        ['startsWith("app")'],
        ['insert("app")'],
        ['search("app")'],
        ['search("app")'],
      ]),
    )
    expect(out.split('\n')).toEqual([
      'search("app")  frames 0..1',
      'startsWith("app")  frames 2..2',
      'insert("app")  frames 3..3',
      'search("app")  frames 4..5',
    ])
  })

  it('nests and closes scopes at the right depth', () => {
    const out = renderGroups(
      traceOf([['minute 1'], ['minute 1', 'cell A'], ['minute 1'], ['minute 2'], ['minute 2', 'cell A']]),
    )
    expect(out.split('\n')).toEqual([
      'minute 1  frames 0..2',
      '  cell A  frames 1..1',
      'minute 2  frames 3..4',
      '  cell A  frames 4..4',
    ])
  })

  it('reports a trace with no scopes rather than an empty string', () => {
    expect(renderGroups(traceOf([[], []]))).toBe('No viz.group() scopes in this trace.')
  })
})
