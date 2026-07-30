import type { StructureKind, Viz } from '@algoviz/tracer'

/**
 * How a returned value is judged against the expected one.
 *
 * Declared per problem, never inside a solution — a solution must not get to decide what
 * counts as correct. Comparators are named ids rather than functions so a problem definition
 * survives a JSON round-trip through the MCP server.
 */
export type ComparatorKind = 'deep' | 'unordered' | 'set-of-sets' | 'approx' | 'boolean'

export interface TestCase {
  name: string
  /** Arguments spread into the solution, before the trailing `viz` parameter. */
  args: unknown[]
  expected: unknown
  tags?: ('example' | 'edge' | 'large')[]
}

export interface ProblemDefinition {
  /** Matches the roadmap entry id, e.g. `p011`. */
  id: string
  leetcode: number
  slug: string
  title: string
  difficulty: 'easy' | 'medium' | 'hard'
  category: string
  /** One-paragraph statement, shown above the editor. */
  statement: string
  /** The structures a good visualization of this problem uses. */
  structures: StructureKind[]
  comparator: ComparatorKind
  /** Function name the sandbox looks for, and the name used in the starter code. */
  entry: string
  /** Code the editor is pre-filled with. */
  starter: string
  /** A known-good instrumented solution, used by tests and as the "reveal" answer. */
  reference: SolutionFn
  cases: TestCase[]
  /** Optional nudges, revealed one at a time in the UI. */
  hints?: string[]
}

/** The shape every instrumented solution has: real arguments, then `viz`. */
export type SolutionFn = (...args: never[]) => unknown

export function compare(kind: ComparatorKind, actual: unknown, expected: unknown): boolean {
  switch (kind) {
    case 'deep':
      return deepEqual(actual, expected)
    case 'boolean':
      return Boolean(actual) === Boolean(expected)
    case 'unordered':
      return unorderedEqual(actual, expected)
    case 'set-of-sets':
      return setOfSetsEqual(actual, expected)
    case 'approx':
      return approxEqual(actual, expected)
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).sort()
    const kb = Object.keys(b as object).sort()
    if (!deepEqual(ka, kb)) return false
    return ka.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  }
  return false
}

function sortKey(v: unknown): string {
  return JSON.stringify(v) ?? String(v)
}

function unorderedEqual(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  const sa = [...a].map(sortKey).sort()
  const sb = [...b].map(sortKey).sort()
  return deepEqual(sa, sb)
}

/** Outer order and inner order both irrelevant, e.g. "list of groups" answers. */
function setOfSetsEqual(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  const norm = (xs: unknown[]): string[] =>
    xs
      .map((inner) => (Array.isArray(inner) ? [...inner].map(sortKey).sort().join('|') : sortKey(inner)))
      .sort()
  return deepEqual(norm(a), norm(b))
}

function approxEqual(a: unknown, b: unknown, eps = 1e-5): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= eps
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.every((v, i) => approxEqual(v, b[i], eps))
  }
  return deepEqual(a, b)
}

/** Re-exported so problem modules get `Viz` without importing the tracer directly. */
export type { Viz }
