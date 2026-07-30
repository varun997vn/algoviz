import { describe, expect, it } from 'vitest'
import { compare, deepEqual } from './types.js'
import { getProblem, listProblems, PROBLEMS, requireProblem } from './index.js'

describe('deepEqual', () => {
  it('compares primitives', () => {
    expect(deepEqual(1, 1)).toBe(true)
    expect(deepEqual(1, 2)).toBe(false)
    expect(deepEqual('a', 'a')).toBe(true)
    expect(deepEqual(true, false)).toBe(false)
    expect(deepEqual(null, null)).toBe(true)
    expect(deepEqual(null, 0)).toBe(false)
  })

  it('compares nested arrays element-wise and order-sensitively', () => {
    expect(deepEqual([1, [2, 3]], [1, [2, 3]])).toBe(true)
    expect(deepEqual([1, 2], [2, 1])).toBe(false)
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false)
    expect(deepEqual([], [])).toBe(true)
  })

  it('does not treat an array as equal to a non-array', () => {
    expect(deepEqual([1], 1)).toBe(false)
    expect(deepEqual([], {})).toBe(false)
  })

  it('compares objects by their keys and values', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false)
  })
})

describe('compare', () => {
  it('deep is order-sensitive', () => {
    expect(compare('deep', [1, 2, 3], [1, 2, 3])).toBe(true)
    expect(compare('deep', [3, 2, 1], [1, 2, 3])).toBe(false)
  })

  it('boolean coerces both sides', () => {
    expect(compare('boolean', true, true)).toBe(true)
    expect(compare('boolean', 1, true)).toBe(true)
    expect(compare('boolean', 0, false)).toBe(true)
    expect(compare('boolean', true, false)).toBe(false)
  })

  it('unordered agrees with deep on objects, whatever order their keys were written in', () => {
    // `sortKey` was raw JSON.stringify, so `unordered` was strictly *harsher* than `deep` here —
    // a false negative, which can only ever fail a correct solution and so was never going to be
    // caught by a passing test. It matters the first time a problem returns an unordered list of
    // objects, which is the shape `set-of-sets` exists for.
    const a = [{ a: 1, b: 2 }]
    const b = [{ b: 2, a: 1 }]
    expect(compare('deep', a, b)).toBe(true)
    expect(compare('unordered', a, b)).toBe(true)
    // Nested, and still not equal when the values genuinely differ.
    expect(compare('unordered', [{ x: { p: 1, q: 2 } }], [{ x: { q: 2, p: 1 } }])).toBe(true)
    expect(compare('unordered', [{ a: 1 }], [{ a: 2 }])).toBe(false)
  })

  it('unordered treats arrays as multisets', () => {
    expect(compare('unordered', [3, 1, 2], [1, 2, 3])).toBe(true)
    // A multiset, not a set: duplicates have to match in count.
    expect(compare('unordered', [1, 1, 2], [1, 2, 2])).toBe(false)
    expect(compare('unordered', [1, 2], [1, 2, 3])).toBe(false)
    expect(compare('unordered', 'not an array', [1])).toBe(false)
  })

  it('set-of-sets ignores order at both levels', () => {
    expect(
      compare(
        'set-of-sets',
        [
          [3, 1],
          [2],
        ],
        [[2], [1, 3]],
      ),
    ).toBe(true)
    expect(compare('set-of-sets', [[1]], [[2]])).toBe(false)
    expect(compare('set-of-sets', [[1]], [[1], [2]])).toBe(false)
  })

  it('approx tolerates floating-point drift', () => {
    expect(compare('approx', 0.1 + 0.2, 0.3)).toBe(true)
    expect(compare('approx', [1.000001, 2], [1, 2])).toBe(true)
    expect(compare('approx', 1.5, 2)).toBe(false)
  })

  it('approx falls back to deep equality for non-numeric values', () => {
    expect(compare('approx', 'a', 'a')).toBe(true)
    expect(compare('approx', [1, 2], [1, 2, 3])).toBe(false)
  })
})

describe('problem registry', () => {
  it('finds a problem by id, slug or LeetCode number', () => {
    expect(getProblem('p011')?.slug).toBe('container-with-most-water')
    expect(getProblem('container-with-most-water')?.leetcode).toBe(11)
    expect(getProblem('11')?.id).toBe('p011')
  })

  it('returns undefined for an unknown problem', () => {
    expect(getProblem('nope')).toBeUndefined()
  })

  it('lists known problems when requireProblem fails, so the error is actionable', () => {
    expect(() => requireProblem('nope')).toThrow(/container-with-most-water/)
  })

  it('has unique ids, slugs and LeetCode numbers', () => {
    expect(new Set(PROBLEMS.map((p) => p.id)).size).toBe(PROBLEMS.length)
    expect(new Set(PROBLEMS.map((p) => p.slug)).size).toBe(PROBLEMS.length)
    expect(new Set(PROBLEMS.map((p) => p.leetcode)).size).toBe(PROBLEMS.length)
  })

  it('gives every problem starter code that mentions the viz API', () => {
    // A starter that doesn't declare the structures leaves the user retyping boilerplate
    // instead of writing the algorithm they came for.
    for (const problem of listProblems()) {
      expect(problem.starter, problem.slug).toContain('viz.')
      expect(problem.starter, problem.slug).toContain(problem.entry)
    }
  })

  it('gives every problem at least six cases and three hints', () => {
    for (const problem of listProblems()) {
      expect(problem.cases.length, problem.slug).toBeGreaterThanOrEqual(6)
      expect(problem.hints?.length ?? 0, problem.slug).toBeGreaterThanOrEqual(3)
    }
  })

  it('returns a fresh array from listProblems so callers cannot mutate the registry', () => {
    const list = listProblems()
    list.length = 0
    expect(listProblems().length).toBe(PROBLEMS.length)
  })
})
