import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { executeRun, type RunRequest, type RunResult } from './execute.js'

/** Run in-process. Fast, stack traces intact — the right choice for Vitest. */
export function runInProcess(request: RunRequest): RunResult {
  return executeRun(request)
}

export interface IsolatedOptions {
  /** Hard wall-clock ceiling. The child is killed if it overruns. */
  timeoutMs?: number
}

export class IsolatedRunError extends Error {}

/**
 * Run in a child process with a hard kill.
 *
 * Used by the MCP server. The tracer's own budgets stop any loop that touches a tracked
 * structure, which is nearly all of them — but `while (true) {}` with no viz calls never yields,
 * and a runaway solution must not be able to hang an agent's MCP connection.
 */
export async function runIsolated(
  request: RunRequest,
  options: IsolatedOptions = {},
): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? 20_000
  const cliPath = fileURLToPath(new URL('./run-cli.ts', import.meta.url))

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn('npx', ['tsx', cliPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      settled = true
      child.kill('SIGKILL')
      reject(
        new IsolatedRunError(
          `Solution exceeded ${timeoutMs}ms without completing — almost certainly an infinite ` +
            'loop that never touches a tracked structure. The sandbox was killed.',
        ),
      )
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0) {
        reject(new IsolatedRunError(`Solution runner exited with code ${String(code)}: ${stderr.trim()}`))
        return
      }
      try {
        resolve(JSON.parse(stdout) as RunResult)
      } catch {
        reject(new IsolatedRunError(`Solution runner produced unreadable output: ${stdout.slice(0, 400)}`))
      }
    })

    child.stdin.end(JSON.stringify(request))
  })
}
