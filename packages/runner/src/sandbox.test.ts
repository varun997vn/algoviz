import { describe, expect, it } from 'vitest'
import {
  calibrateLineOffset,
  checkSource,
  compileSolution,
  mapStackPosition,
  PRELUDE,
  PRELUDE_LINE_OFFSET,
  SandboxError,
  stripExportDefault,
} from './sandbox.js'
import { sucraseTranspiler } from './transpile.js'

describe('PRELUDE', () => {
  it('is exactly one line, matching PRELUDE_LINE_OFFSET', () => {
    // The whole error-position story is arithmetic on this constant, so pin it.
    expect(PRELUDE.split('\n')).toHaveLength(PRELUDE_LINE_OFFSET)
  })
})

describe('sucraseTranspiler', () => {
  it('strips types while preserving line numbers exactly', () => {
    const source = ['const a: number = 1', 'type T = string', 'const b: T = "x"', 'export {}'].join('\n')
    const { code, diagnostics } = sucraseTranspiler.transform(source, 'x.ts')
    expect(diagnostics).toEqual([])
    // Line-for-line preservation is what makes error mapping a constant offset, not a sourcemap.
    expect(code.split('\n')).toHaveLength(source.split('\n').length)
  })

  it('handles generics, enums, optional chaining and satisfies', () => {
    const source = [
      'enum E { A, B }',
      'function id<T>(v: T): T { return v }',
      'const o = { a: 1 } satisfies Record<string, number>',
      'const x = o?.a ?? 0',
      'export default function f(): number { return id(E.A) + x }',
    ].join('\n')
    const { code, diagnostics } = sucraseTranspiler.transform(source, 'x.ts')
    expect(diagnostics).toEqual([])
    expect(code).toContain('function id(')
  })

  it('reports a syntax error with a position instead of throwing', () => {
    const { diagnostics } = sucraseTranspiler.transform('function f( {', 'x.ts')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.line).toBeGreaterThan(0)
  })
})

describe('checkSource', () => {
  it('rejects static imports with an actionable message and a line number', () => {
    const issues = checkSource("const a = 1\nimport x from 'y'")
    expect(issues[0]?.message).toContain('no module access')
    expect(issues[0]?.line).toBe(2)
  })

  it('rejects dynamic import', () => {
    expect(checkSource("const m = await import('x')")[0]?.message).toContain('Dynamic import')
  })

  it.each(['fetch', 'localStorage', 'process', 'require'])('rejects %s', (name) => {
    const issues = checkSource(`const v = ${name}('x')`)
    expect(issues.some((i) => i.message.includes(name))).toBe(true)
  })

  it('does not flag a forbidden name used as a property', () => {
    // `queue.process(...)` is a perfectly ordinary method call in a solution.
    expect(checkSource('worker.process(1)')).toEqual([])
  })

  it('ignores forbidden names inside comments', () => {
    expect(checkSource('// you cannot use fetch(...) here')).toEqual([])
  })

  it('passes an ordinary solution', () => {
    expect(
      checkSource('export default function f(nums: number[], viz: Viz) { return nums.length }'),
    ).toEqual([])
  })
})

describe('stripExportDefault', () => {
  it('rewrites a named default export in place', () => {
    expect(stripExportDefault('export default function foo() { return 1 }')).toBe(
      'function foo() { return 1 }',
    )
  })

  it('rewrites an anonymous default export', () => {
    expect(stripExportDefault('export default function () { return 1 }')).toContain(
      '__algovizDefault = function (',
    )
  })

  it('rewrites a named export declaration', () => {
    expect(stripExportDefault('export const x = 1')).toBe('const x = 1')
  })

  it('preserves the line count', () => {
    const src = 'const a = 1\nexport default function foo() {\n  return a\n}'
    expect(stripExportDefault(src).split('\n')).toHaveLength(src.split('\n').length)
  })
})

describe('compileSolution', () => {
  it('returns the default-exported function', () => {
    const { fn } = compileSolution('export default function add(a, b) { return a + b }', 'add')
    expect(fn(2, 3)).toBe(5)
  })

  it('falls back to a function matching the declared entry name', () => {
    const { fn } = compileSolution('function add(a, b) { return a + b }', 'add')
    expect(fn(1, 1)).toBe(2)
  })

  it('explains what to export when nothing is found', () => {
    expect(() => compileSolution('const x = 1', 'solve')).toThrow(/export default function solve/)
  })

  it('wraps a syntax error as a SandboxError', () => {
    expect(() => compileSolution('function ( {', 'solve')).toThrow(SandboxError)
  })
})

describe('line-offset calibration', () => {
  it('produces a non-negative, stable offset', () => {
    const first = calibrateLineOffset()
    expect(first).toBeGreaterThanOrEqual(0)
    expect(calibrateLineOffset()).toBe(first)
  })

  it('maps a thrown error back to the exact user line', () => {
    // Rather than trusting the arithmetic, throw from a known line and check the round trip.
    const source = [
      'export default function boom() {', // 1
      '  const a = 1', // 2
      '  const b = 2', // 3
      "  throw new Error('here')", // 4
      '}', // 5
    ].join('\n')
    const { code } = sucraseTranspiler.transform(source, 'x.ts')
    const { fn } = compileSolution(code, 'boom')
    try {
      fn()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(mapStackPosition((error as Error).stack).line).toBe(4)
    }
  })

  it('returns nothing useful for a stack it cannot parse', () => {
    expect(mapStackPosition(undefined)).toEqual({})
    expect(mapStackPosition('Error: nope\n    at somewhere.js:1:1')).toEqual({})
  })
})
