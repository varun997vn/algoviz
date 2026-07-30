import { describe, expect, it } from 'vitest'
import type { Frame, Trace } from '@algoviz/tracer'
import { renderGroups } from './render.js'

/**
 * The group tree is how an auditor navigates a trace, so a wrong frame range here does not just
 * misreport — it sends the next investigation to the wrong frames.
 */
function traceOf(groups: string[][]): Trace {
  const frames: Frame[] = groups.map((g, index) => ({ index, op: 'step', groups: g, snapshots: {} }))
  return { frames, structures: [], opCount: frames.length }
}

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
