import { describe, expect, it } from 'vitest'
import { executeRun } from '@algoviz/runner'
import { trace } from '@algoviz/tracer'
import { checkAssertions, renderReport } from './assertions.js'

/**
 * Regression tests for cursor assertions passing vacuously.
 *
 * Two agents independently hit the same root cause from different angles: `cursor-in-range`
 * and `cursor-monotonic` skipped any frame where the named cursor had no numeric `index`, so
 * they reported success for a cursor that was attached to the wrong structure (or to nothing)
 * and for every 2-D cursor, which carries row/col rather than index.
 *
 * That is the worst class of bug in this repo: the tool built to catch misleading animations was
 * itself manufacturing confidence. Each test below asserts the check now *fails* where it used
 * to pass — a test that only confirmed the happy path would not have caught the original bug
 * and would not catch its return.
 */

const twoPointer = executeRun({
  problem: 'container-with-most-water',
  useReference: true,
  caseIndex: 0,
}).results[0]!.trace

describe('cursor-in-range', () => {
  it('still passes for a cursor that genuinely stays in range', () => {
    const report = checkAssertions(twoPointer, [
      { kind: 'cursor-in-range', structure: 'height', cursor: 'left', min: 0, max: 8 },
    ])
    expect(report.passed).toBe(true)
  })

  it('still fails for a cursor that leaves the range', () => {
    const report = checkAssertions(twoPointer, [
      { kind: 'cursor-in-range', structure: 'height', cursor: 'left', min: 0, max: 0 },
    ])
    expect(report.passed).toBe(false)
    expect(report.failures[0]?.reason).toContain('outside 0..0')
  })

  it('FAILS for a cursor that does not exist, rather than passing vacuously', () => {
    const report = checkAssertions(twoPointer, [
      { kind: 'cursor-in-range', structure: 'height', cursor: 'nonexistent', min: 0, max: 8 },
    ])
    expect(report.passed).toBe(false)
    expect(report.failures[0]?.reason).toContain('never appears')
  })

  it('FAILS for a cursor attached to a different structure than the one named', () => {
    // The silent-attachment failure: a caret that renders on the wrong panel looks like a
    // missing caret, and the old check called that a pass.
    const { trace: t } = trace((viz) => {
      const a = viz.array([1, 2, 3], { name: 'a' })
      const b = viz.array([4, 5, 6], { name: 'b' })
      const i = viz.cursor('i', 0, a)
      i.inc()
      return b.toArray()
    })
    const report = checkAssertions(t, [
      { kind: 'cursor-in-range', structure: 'b', cursor: 'i', min: 0, max: 2 },
    ])
    expect(report.passed).toBe(false)
    expect(report.failures[0]?.reason).toContain('never appears on "b"')
  })

  it('FAILS on a 2-D cursor and says which assertion to use instead', () => {
    const { trace: t } = trace((viz) => {
      const g = viz.matrix([
        [1, 2],
        [3, 4],
      ], { name: 'grid' })
      g.cursor('p', 1, 1)
      return 0
    })
    const report = checkAssertions(t, [
      // Deliberately absurd bounds: under the old code this passed on a 2x2 grid.
      { kind: 'cursor-in-range', structure: 'grid', cursor: 'p', min: 99, max: 100 },
    ])
    expect(report.passed).toBe(false)
    expect(report.failures[0]?.reason).toContain('cursor-cell-in-range')
  })
})

describe('cursor-cell-in-range', () => {
  const gridTrace = trace((viz) => {
    const g = viz.matrix([
      [1, 2, 3],
      [4, 5, 6],
    ], { name: 'grid' })
    g.cursor('p', 0, 0)
    g.cursor('p', 1, 2)
    return 0
  }).trace

  it('passes when the cursor stays inside the grid', () => {
    expect(
      checkAssertions(gridTrace, [
        { kind: 'cursor-cell-in-range', structure: 'grid', cursor: 'p', minRow: 0, maxRow: 1, minCol: 0, maxCol: 2 },
      ]).passed,
    ).toBe(true)
  })

  it('fails with the offending cell when the cursor leaves the range', () => {
    const report = checkAssertions(gridTrace, [
      { kind: 'cursor-cell-in-range', structure: 'grid', cursor: 'p', minRow: 0, maxRow: 0, minCol: 0, maxCol: 2 },
    ])
    expect(report.passed).toBe(false)
    expect(report.failures[0]?.reason).toContain('(1,2)')
  })

  it('fails for a cursor that does not exist', () => {
    const report = checkAssertions(gridTrace, [
      { kind: 'cursor-cell-in-range', structure: 'grid', cursor: 'nope', minRow: 0, maxRow: 1, minCol: 0, maxCol: 2 },
    ])
    expect(report.passed).toBe(false)
    expect(report.failures[0]?.reason).toContain('never appears')
  })

  it('fails when pointed at a 1-D cursor', () => {
    const report = checkAssertions(twoPointer, [
      { kind: 'cursor-cell-in-range', structure: 'height', cursor: 'left', minRow: 0, maxRow: 0, minCol: 0, maxCol: 8 },
    ])
    expect(report.passed).toBe(false)
    expect(report.failures[0]?.reason).toContain('not a 2-D cursor')
  })
})

describe('cursor-monotonic', () => {
  it('still catches a cursor moving the wrong way', () => {
    const report = checkAssertions(twoPointer, [
      { kind: 'cursor-monotonic', structure: 'height', cursor: 'left', direction: 'down' },
    ])
    expect(report.passed).toBe(false)
    expect(report.failures[0]?.reason).toContain('moved forwards')
  })

  it('FAILS for a cursor that does not exist, rather than passing vacuously', () => {
    const report = checkAssertions(twoPointer, [
      { kind: 'cursor-monotonic', structure: 'height', cursor: 'ghost', direction: 'up' },
    ])
    expect(report.passed).toBe(false)
    expect(report.failures[0]?.reason).toContain('never appears')
  })

  it('FAILS on a 2-D cursor instead of reporting success', () => {
    const { trace: t } = trace((viz) => {
      const g = viz.matrix([[1, 2]], { name: 'grid' })
      g.cursor('p', 0, 1)
      return 0
    })
    const report = checkAssertions(t, [
      { kind: 'cursor-monotonic', structure: 'grid', cursor: 'p', direction: 'up' },
    ])
    expect(report.passed).toBe(false)
    expect(report.failures[0]?.reason).toContain('no linear index')
  })
})

describe('renderReport', () => {
  it('names the failing assertion kind and the reason', () => {
    const report = checkAssertions(twoPointer, [
      { kind: 'cursor-in-range', structure: 'height', cursor: 'ghost', min: 0, max: 1 },
    ])
    const rendered = renderReport(report)
    expect(rendered).toContain('FAILED')
    expect(rendered).toContain('cursor-in-range')
  })
})
