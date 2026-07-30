import { parentPort, workerData } from 'node:worker_threads'
import { executeRun, type RunRequest } from './execute.js'

// Entry for `runIsolated`. Kept trivial so the interesting code stays in `execute.ts`.
const request = workerData as RunRequest
parentPort?.postMessage(executeRun(request))
