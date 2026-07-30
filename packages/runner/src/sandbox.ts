import type { Diagnostic } from './transpile.js'

/**
 * The prelude prepended to every compiled solution.
 *
 * It is *exactly one line*, and `PRELUDE_LINE_OFFSET` records that. Because sucrase preserves
 * line numbers, a runtime error at compiled line N maps to user line N - 1. A unit test throws
 * from a known line and asserts the arithmetic, so this constant cannot drift silently.
 */
export const PRELUDE = '"use strict";'
export const PRELUDE_LINE_OFFSET = 1

export interface SolutionModule {
  fn: (...args: unknown[]) => unknown
}

export class SandboxError extends Error {
  constructor(
    message: string,
    readonly diagnostics: Diagnostic[] = [],
  ) {
    super(message)
    this.name = 'SandboxError'
  }
}

/** Globals a solution has no business touching. Blocked by name at compile time. */
const FORBIDDEN = [
  'fetch',
  'XMLHttpRequest',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'importScripts',
  'WebSocket',
  'Worker',
  'eval',
  'process',
  'globalThis',
  'require',
]

/**
 * Reject module syntax and host access before we ever build the function.
 *
 * The point is a helpful message rather than airtight isolation — the real isolation is the
 * worker (browser) or `worker_threads` (Node) plus a hard kill timer.
 */
export function checkSource(source: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const lines = source.split('\n')

  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, '')
    if (/^\s*import\s+[^(]/.test(line) || /^\s*export\s+\*/.test(line)) {
      diagnostics.push({
        message:
          'Solutions run in a sandbox with no module access — everything you need is on `viz`.',
        line: i + 1,
      })
    }
    if (/\bimport\s*\(/.test(line)) {
      diagnostics.push({ message: 'Dynamic import is not available in the sandbox.', line: i + 1 })
    }
    for (const name of FORBIDDEN) {
      // Word-boundary match, skipping property access like `foo.process`.
      const re = new RegExp(`(^|[^.\\w$])${name}\\s*[(.\\[]`)
      if (re.test(line)) {
        diagnostics.push({
          message: `\`${name}\` is not available inside a solution sandbox.`,
          line: i + 1,
        })
      }
    }
  })

  return diagnostics
}

/**
 * Rewrite `export default function foo(...)` into a local binding.
 *
 * Done as a line-local textual edit rather than an AST pass specifically to preserve line
 * numbers — the property the whole error-mapping story depends on.
 */
export function stripExportDefault(code: string): string {
  return code
    .replace(/^\s*export\s+default\s+function\s+([A-Za-z_$][\w$]*)/m, 'function $1')
    .replace(/^\s*export\s+default\s+function\s*\(/m, 'const __algovizDefault = function (')
    .replace(/^\s*export\s+default\s+/m, 'const __algovizDefault = ')
    .replace(/^\s*export\s+(const|let|function|class)\s+/gm, '$1 ')
}

/**
 * Build a callable from transpiled JS.
 *
 * Uses `new Function` rather than `eval` or a `blob:` URL so no CSP relaxation is needed
 * beyond what the worker itself requires.
 */
export function compileSolution(js: string, entryName: string): SolutionModule {
  const body = [
    PRELUDE,
    stripExportDefault(js),
    `\n;return (typeof __algovizDefault !== "undefined" && __algovizDefault) ||`,
    `  (typeof ${entryName} === "function" ? ${entryName} : undefined);`,
  ].join('\n')

  let factory: () => unknown
  try {
     
    factory = new Function(body) as () => unknown
  } catch (error) {
    throw new SandboxError(
      error instanceof Error ? error.message : String(error),
      [{ message: error instanceof Error ? error.message : String(error) }],
    )
  }

  const fn = factory()
  if (typeof fn !== 'function') {
    throw new SandboxError(
      `Could not find your solution. Export it as \`export default function ${entryName}(...)\`.`,
    )
  }
  return { fn: fn as (...args: unknown[]) => unknown }
}

export interface MappedPosition {
  line?: number
  column?: number
}

let calibratedOffset: number | undefined

/**
 * Work out, at runtime, how many lines a `new Function` wrapper inserts before our body.
 *
 * Engines wrap the body in `function anonymous(...) {` — V8 currently adds two lines, but that
 * is an implementation detail nobody promises. Rather than hard-code the arithmetic and let it
 * rot, compile a probe that throws from a known body line and measure the difference. Computed
 * once, then cached.
 */
export function calibrateLineOffset(): number {
  if (calibratedOffset !== undefined) return calibratedOffset

  const probeBodyLine = 2 // the `throw` sits on the second line of the body below
  const body = 'const marker = 1;\nthrow new Error("algoviz-probe");'
  try {
     
    new Function(body)()
    calibratedOffset = 0
  } catch (error) {
    const match = /<anonymous>:(\d+):/.exec(error instanceof Error ? (error.stack ?? '') : '')
    calibratedOffset = match ? Number(match[1]) - probeBodyLine : 0
  }
  return calibratedOffset
}

/**
 * Map a stack frame from a compiled solution back to a line in the user's source.
 *
 * Sucrase preserves line numbers exactly, so this is pure arithmetic: subtract the engine's
 * wrapper lines (measured, not assumed) and the one-line prelude.
 */
export function mapStackPosition(stack: string | undefined): MappedPosition {
  if (!stack) return {}
  // V8 renders `new Function` frames as `<anonymous>:LINE:COL`.
  const match = /<anonymous>:(\d+):(\d+)/.exec(stack)
  if (!match) return {}
  const line = Number(match[1]) - calibrateLineOffset() - PRELUDE_LINE_OFFSET
  return { line: line > 0 ? line : undefined, column: Number(match[2]) }
}
