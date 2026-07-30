import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { executeRun, type RunRequest, type RunResult } from './execute.js'

/**
 * Run in-process. Fast, and stack traces stay intact — the right choice for Vitest.
 */
export function runInProcess(request: RunRequest): RunResult {
  return executeRun(request)
}

export interface IsolatedOptions {
  /** Hard wall-clock ceiling. The thread is terminated if it overruns. */
  timeoutMs?: number
  maxOldGenerationSizeMb?: number
}

/**
 * Run in a `worker_threads` thread with a hard kill.
 *
 * Used by the MCP server: the tracer's budgets cannot stop `while (true) {}` with no tracked
 * operations, and a runaway solution must never be able to hang the agent's MCP connection.
 */
export async function runIsolated(
  request: RunRequest,
  options: IsolatedOptions = {},
): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? 15_000
  const workerPath = fileURLToPath(new URL('./node-worker.ts', import.meta.url))

  return new Promise<RunResult>((resolve, reject) => {
    const worker = new Worker(workerPath, {
      workerData: request,
      resourceLimits: { maxOldGenerationSizeMb: options.maxOldGenerationSizeMb ?? 512 },
      execArgv: ['--import', 'tsx'],
    })

    const timer = setTimeout(() => {
      void worker.terminate()
      reject(
        new Error(
          `Solution exceeded ${timeoutMs}ms of wall clock without completing — almost certainly ` +
            'an infinite loop that never touches a tracked structure.',
        ),
      )
    }, timeoutMs)

    worker.once('message', (result: RunResult) => {
      clearTimeout(timer)
      void worker.terminate()
      resolve(result)
    })
    worker.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    worker.once('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`Solution worker exited with code ${code}`))
    })
  })
}
