import type { Trace } from '@algoviz/tracer'
import type { Diagnostic } from './transpile.js'
import type { CaseResult, RunRequest } from './execute.js'

/**
 * Worker protocol, hand-rolled rather than via Comlink.
 *
 * Comlink models request/response RPC; we need per-case streaming (so the UI can start playing
 * before a long run finishes), cancellation when the user edits and re-runs, and structured
 * error payloads. All three fight an RPC proxy, and a plain tagged union is ~40 lines.
 */
export type HostMessage =
  | { type: 'run'; runId: string; request: RunRequest }
  | { type: 'cancel'; runId: string }

export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'diagnostics'; runId: string; diagnostics: Diagnostic[] }
  | { type: 'case'; runId: string; result: SerializedCaseResult }
  | { type: 'done'; runId: string; passed: boolean }
  | { type: 'failed'; runId: string; message: string }

/** A case result as it crosses the worker boundary — identical shape, just named for clarity. */
export type SerializedCaseResult = Omit<CaseResult, 'trace'> & { trace: Trace }
