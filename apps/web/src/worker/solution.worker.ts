import { executeRun, type HostMessage, type WorkerMessage } from '@algoviz/runner'

/**
 * The solution sandbox worker.
 *
 * The *entry* lives in the app while all the logic lives in `@algoviz/runner`. That split is
 * deliberate: Vite's worker handling is well-trodden for an entry inside the app referenced via
 * `new URL(..., import.meta.url)`, and noticeably less so for a `?worker` import that crosses a
 * pnpm workspace package boundary. Keeping the entry local avoids that class of bundling bug
 * entirely while still sharing one execution core with Node and the MCP server.
 */

const post = (message: WorkerMessage): void => {
  self.postMessage(message)
}

/** Runs cancelled by a newer run; results from these are dropped rather than posted. */
const cancelled = new Set<string>()

self.onmessage = (event: MessageEvent<HostMessage>): void => {
  const message = event.data

  if (message.type === 'cancel') {
    cancelled.add(message.runId)
    return
  }

  if (message.type !== 'run') return
  const { runId, request } = message

  try {
    const result = executeRun(request)

    if (result.diagnostics.length > 0) {
      post({ type: 'diagnostics', runId, diagnostics: result.diagnostics })
    }

    // Stream per case so the UI can show the first result — and start playing — before a run
    // with six cases has finished all of them.
    for (const caseResult of result.results) {
      if (cancelled.has(runId)) return
      post({ type: 'case', runId, result: caseResult })
    }

    if (cancelled.has(runId)) return
    post({ type: 'done', runId, passed: result.passed })
  } catch (error) {
    post({
      type: 'failed',
      runId,
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    cancelled.delete(runId)
  }
}

post({ type: 'ready' })
