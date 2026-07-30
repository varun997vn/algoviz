import {
  BudgetExceededError,
  Recorder,
  Viz,
  type Trace,
  type VizOptions,
} from '@algoviz/tracer'
import { compare, requireProblem, type ProblemDefinition, type TestCase } from '@algoviz/problems'
import { checkSource, compileSolution, mapStackPosition, SandboxError } from './sandbox.js'
import { sucraseTranspiler, type Diagnostic, type Transpiler } from './transpile.js'

export interface RunRequest {
  problem: string
  /** User source. Omit (or set `useReference`) to run the shipped reference solution. */
  source?: string
  useReference?: boolean
  /** Run one case by index, or all of them. */
  caseIndex?: number | 'all'
  budgets?: VizOptions
}

export interface RunError {
  name: string
  message: string
  line?: number
  column?: number
  /** Frame the run died on, so the player can seek straight to the failure. */
  frameIndex?: number
}

export interface CaseResult {
  caseIndex: number
  name: string
  passed: boolean
  returned: unknown
  expected: unknown
  trace: Trace
  frameCount: number
  opCount: number
  wallMs: number
  truncated?: Trace['truncated']
  error?: RunError
}

export interface RunResult {
  problem: string
  passed: boolean
  diagnostics: Diagnostic[]
  results: CaseResult[]
}

export interface ExecuteOptions {
  transpiler?: Transpiler
}

/**
 * Compile and run a solution against a problem's test cases, collecting a trace per case.
 *
 * Deliberately free of `postMessage` and `worker_threads`: this is the shared core behind the
 * browser worker, the Vitest integration tests, and the MCP server's `run_solution`. Keeping
 * it platform-free is what makes "an agent can verify its own work headlessly" true rather
 * than aspirational.
 */
export function executeRun(request: RunRequest, options: ExecuteOptions = {}): RunResult {
  const problem = requireProblem(request.problem)
  const transpiler = options.transpiler ?? sucraseTranspiler

  const solution = resolveSolution(problem, request, transpiler)
  if ('diagnostics' in solution) {
    return { problem: problem.slug, passed: false, diagnostics: solution.diagnostics, results: [] }
  }

  const cases = selectCases(problem, request.caseIndex)
  const results = cases.map(({ testCase, index }) =>
    runCase(problem, testCase, index, solution.fn, request.budgets),
  )

  return {
    problem: problem.slug,
    passed: results.length > 0 && results.every((r) => r.passed),
    diagnostics: [],
    results,
  }
}

function selectCases(
  problem: ProblemDefinition,
  caseIndex: number | 'all' | undefined,
): { testCase: TestCase; index: number }[] {
  if (caseIndex === undefined || caseIndex === 'all') {
    return problem.cases.map((testCase, index) => ({ testCase, index }))
  }
  const testCase = problem.cases[caseIndex]
  if (!testCase) {
    throw new RangeError(
      `Case ${caseIndex} does not exist — "${problem.slug}" has ${problem.cases.length} cases.`,
    )
  }
  return [{ testCase, index: caseIndex }]
}

type ResolvedSolution = { fn: (...args: unknown[]) => unknown } | { diagnostics: Diagnostic[] }

function resolveSolution(
  problem: ProblemDefinition,
  request: RunRequest,
  transpiler: Transpiler,
): ResolvedSolution {
  if (request.useReference || request.source === undefined) {
    return { fn: problem.reference as (...args: unknown[]) => unknown }
  }

  const sourceIssues = checkSource(request.source)
  if (sourceIssues.length > 0) return { diagnostics: sourceIssues }

  const { code, diagnostics } = transpiler.transform(request.source, `${problem.slug}.ts`)
  if (diagnostics.length > 0) return { diagnostics }

  try {
    return compileSolution(code, problem.entry)
  } catch (error) {
    if (error instanceof SandboxError) {
      return { diagnostics: error.diagnostics.length > 0 ? error.diagnostics : [{ message: error.message }] }
    }
    return { diagnostics: [{ message: error instanceof Error ? error.message : String(error) }] }
  }
}

function runCase(
  problem: ProblemDefinition,
  testCase: TestCase,
  index: number,
  fn: (...args: unknown[]) => unknown,
  budgets: VizOptions | undefined,
): CaseResult {
  const recorder = new Recorder(budgets ?? {})
  const viz = new Viz(recorder)
  const startedAt = Date.now()

  let returned: unknown
  let error: RunError | undefined
  let trace: Trace

  try {
    // Arguments are cloned so a mutating solution can't corrupt the case for the next run.
    returned = fn(...structuredClone(testCase.args), viz)
    recorder.recordAll('return', `return ${safeJson(returned)}`)
    trace = recorder.toTrace()
  } catch (thrown) {
    if (thrown instanceof BudgetExceededError) {
      trace = thrown.partial
      error = { name: thrown.name, message: thrown.message, frameIndex: trace.frames.length - 1 }
    } else {
      trace = recorder.toTrace()
      const position = mapStackPosition(thrown instanceof Error ? thrown.stack : undefined)
      error = {
        name: thrown instanceof Error ? thrown.name : 'Error',
        message: thrown instanceof Error ? thrown.message : String(thrown),
        frameIndex: trace.frames.length - 1,
        ...(position.line !== undefined ? { line: position.line } : {}),
        ...(position.column !== undefined ? { column: position.column } : {}),
      }
    }
  }

  const passed = error === undefined && compare(problem.comparator, returned, testCase.expected)
  trace.result = { returned, expected: testCase.expected, passed }

  return {
    caseIndex: index,
    name: testCase.name,
    passed,
    returned,
    expected: testCase.expected,
    trace,
    frameCount: trace.frames.length,
    opCount: trace.opCount,
    wallMs: Date.now() - startedAt,
    ...(trace.truncated ? { truncated: trace.truncated } : {}),
    ...(error ? { error } : {}),
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}
