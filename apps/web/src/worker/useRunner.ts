import type { Diagnostic, HostMessage, RunRequest, SerializedCaseResult, WorkerMessage } from '@algoviz/runner'
import { useCallback, useEffect, useRef, useState } from 'react'

export type RunPhase = 'idle' | 'running' | 'done' | 'error'

export interface RunnerState {
  phase: RunPhase
  results: SerializedCaseResult[]
  diagnostics: Diagnostic[]
  passed: boolean | undefined
  failure: string | undefined
  run(request: RunRequest): void
  cancel(): void
}

/**
 * Wall-clock ceiling enforced from the host thread.
 *
 * The tracer's own op and time budgets catch any loop that touches a tracked structure, which
 * is nearly all of them. They cannot catch `while (true) {}` with no viz calls at all — nothing
 * inside the worker gets a chance to run. Terminating the worker is the only reliable stop, so
 * the host arms this timer for every run and replaces the worker if it fires.
 */
const HARD_KILL_MS = 6_000

let runCounter = 0

export function useRunner(): RunnerState {
  const workerRef = useRef<Worker | null>(null)
  const activeRun = useRef<string | null>(null)
  const killTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [phase, setPhase] = useState<RunPhase>('idle')
  const [results, setResults] = useState<SerializedCaseResult[]>([])
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [passed, setPassed] = useState<boolean | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const clearKillTimer = useCallback(() => {
    if (killTimer.current !== null) {
      clearTimeout(killTimer.current)
      killTimer.current = null
    }
  }, [])

  const spawn = useCallback((): Worker => {
    const worker = new Worker(new URL('./solution.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data
      if ('runId' in message && message.runId !== activeRun.current) return

      switch (message.type) {
        case 'ready':
          break
        case 'diagnostics':
          setDiagnostics(message.diagnostics)
          setPhase('error')
          clearKillTimer()
          break
        case 'case':
          setResults((current) => [...current, message.result])
          break
        case 'done':
          setPassed(message.passed)
          setPhase('done')
          clearKillTimer()
          break
        case 'failed':
          setFailure(message.message)
          setPhase('error')
          clearKillTimer()
          break
      }
    }
    worker.onerror = (event) => {
      setFailure(event.message || 'The solution worker crashed.')
      setPhase('error')
      clearKillTimer()
    }
    workerRef.current = worker
    return worker
  }, [clearKillTimer])

  useEffect(() => {
    const worker = spawn()
    return () => {
      clearKillTimer()
      worker.terminate()
      workerRef.current = null
    }
  }, [spawn, clearKillTimer])

  const run = useCallback(
    (request: RunRequest) => {
      const worker = workerRef.current ?? spawn()
      // A re-run supersedes whatever is in flight; the old run's results are dropped.
      if (activeRun.current !== null) {
        worker.postMessage({ type: 'cancel', runId: activeRun.current } satisfies HostMessage)
      }

      runCounter += 1
      const runId = `run-${runCounter}`
      activeRun.current = runId

      setResults([])
      setDiagnostics([])
      setPassed(undefined)
      setFailure(undefined)
      setPhase('running')

      clearKillTimer()
      killTimer.current = setTimeout(() => {
        workerRef.current?.terminate()
        workerRef.current = null
        activeRun.current = null
        setFailure(
          `Your code ran for ${HARD_KILL_MS / 1000}s without completing — that usually means an ` +
            'infinite loop that never touches a tracked structure. The sandbox was stopped.',
        )
        setPhase('error')
        spawn()
      }, HARD_KILL_MS)

      worker.postMessage({ type: 'run', runId, request } satisfies HostMessage)
    },
    [spawn, clearKillTimer],
  )

  const cancel = useCallback(() => {
    if (activeRun.current !== null) {
      workerRef.current?.postMessage({ type: 'cancel', runId: activeRun.current } satisfies HostMessage)
      activeRun.current = null
    }
    clearKillTimer()
    setPhase('idle')
  }, [clearKillTimer])

  return { phase, results, diagnostics, passed, failure, run, cancel }
}
