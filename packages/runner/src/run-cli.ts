#!/usr/bin/env tsx
import { executeRun, type RunRequest } from './execute.js'

/**
 * Isolation entry: reads a RunRequest as JSON on stdin, writes a RunResult as JSON on stdout.
 *
 * A separate process rather than a worker thread. Worker threads need the TypeScript loader
 * re-registered per thread, which is fragile across tsx/vitest/node contexts; a child process
 * running under tsx as its *main* entry has none of that ambiguity, and it is trivially and
 * reliably killable — which is the entire point of isolating in the first place.
 */
async function main(): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RunRequest
  process.stdout.write(JSON.stringify(executeRun(request)))
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
