export {
  executeRun,
  type CaseResult,
  type ExecuteOptions,
  type RunError,
  type RunRequest,
  type RunResult,
} from './execute.js'
export {
  sucraseTranspiler,
  type Diagnostic,
  type TranspileResult,
  type Transpiler,
} from './transpile.js'
export {
  PRELUDE,
  PRELUDE_LINE_OFFSET,
  SandboxError,
  checkSource,
  compileSolution,
  mapStackPosition,
  stripExportDefault,
  type MappedPosition,
  type SolutionModule,
} from './sandbox.js'
export * from './protocol.js'

// `./node` is deliberately NOT re-exported here: it imports node:worker_threads, which would
// drag Node built-ins into the browser bundle. Import it as `@algoviz/runner/node`.
