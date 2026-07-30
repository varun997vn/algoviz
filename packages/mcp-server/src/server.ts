import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { listProblems, requireProblem } from '@algoviz/problems'
import type { executeRun} from '@algoviz/runner';
import { type RunResult } from '@algoviz/runner'
import { runIsolated } from '@algoviz/runner/node'
import type { Trace } from '@algoviz/tracer'
import { nextProblems, renderMarkdown, type Roadmap } from '@algoviz/roadmap'
import {
  findRepoRoot,
  loadRoadmap,
  roadmapMarkdownPath,
  roadmapPath,
  updateProblem,
} from '@algoviz/roadmap/node'
import { writeFileSync } from 'node:fs'
import { checkAssertions, renderReport, type Assertion } from './assertions.js'
import {
  cap,
  renderFrame,
  renderGroups,
  renderOps,
  renderSummary,
  renderTimeline,
} from './render.js'

export interface ServerDeps {
  repoRoot?: string
  /** Injected so tests can point at a fixture repo and avoid touching the real roadmap. */
  loadRoadmapFn?: () => Roadmap
  updateProblemFn?: typeof updateProblem
  /** Injected so tests can run in-process instead of spawning a worker thread. */
  runFn?: (request: Parameters<typeof executeRun>[0]) => Promise<RunResult> | RunResult
}

/** Traces persist for the session so `trace_inspect` can be called after `run_solution`. */
const traces = new Map<string, Trace>()
let traceCounter = 0

function storeTrace(trace: Trace): string {
  traceCounter += 1
  const id = `t${traceCounter}`
  traces.set(id, trace)
  // Bound memory: a long agent session could otherwise accumulate hundreds of traces.
  if (traces.size > 64) {
    const oldest = traces.keys().next().value
    if (oldest !== undefined) traces.delete(oldest)
  }
  return id
}

export function getStoredTrace(id: string): Trace | undefined {
  return traces.get(id)
}

const text = (body: string): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text: body }],
})

export function createServer(deps: ServerDeps = {}): McpServer {
  const repoRoot = deps.repoRoot ?? findRepoRoot()
  const load = deps.loadRoadmapFn ?? ((): Roadmap => loadRoadmap(roadmapPath(repoRoot)))
  const update = deps.updateProblemFn ?? updateProblem
  const run = deps.runFn ?? ((request) => runIsolated(request, { timeoutMs: 15_000 }))

  const server = new McpServer({ name: 'algoviz', version: '0.1.0' })

  const regenerateMarkdown = (): void => {
    writeFileSync(roadmapMarkdownPath(repoRoot), renderMarkdown(load()))
  }

  server.registerTool(
    'roadmap_list',
    {
      title: 'List roadmap problems',
      description:
        'List LeetCode 75 roadmap entries, optionally filtered by status, category, difficulty or structure.',
      inputSchema: {
        status: z.enum(['todo', 'in-progress', 'review', 'blocked', 'done']).optional(),
        category: z.string().optional(),
        difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
        structure: z.string().optional(),
        limit: z.number().int().positive().max(100).default(30),
      },
    },
    async ({ status, category, difficulty, structure, limit }) => {
      const roadmap = load()
      const matches = roadmap.problems
        .filter((p) => (status ? p.status === status : true))
        .filter((p) => (category ? p.category === category : true))
        .filter((p) => (difficulty ? p.difficulty === difficulty : true))
        .filter((p) => (structure ? p.structures.includes(structure as never) : true))
        .sort((a, b) => a.order - b.order)

      const shown = matches.slice(0, limit)
      const lines = shown.map(
        (p) =>
          `${p.id}  ${String(p.leetcode).padStart(4)}  ${p.status.padEnd(11)} ${p.difficulty.padEnd(6)} ` +
          `${p.title}  [${p.structures.join(' ')}]`,
      )
      return text(
        `${matches.length} match(es)${matches.length > shown.length ? `, showing ${shown.length}` : ''}\n` +
          lines.join('\n'),
      )
    },
  )

  server.registerTool(
    'roadmap_next',
    {
      title: 'Next actionable problems',
      description:
        'The next roadmap problems to work on: not done, not blocked, and with every dependency already done.',
      inputSchema: { count: z.number().int().positive().max(10).default(1) },
    },
    async ({ count }) => {
      const picks = nextProblems(load(), count)
      if (picks.length === 0) return text('Nothing actionable — every problem is done or blocked.')
      return text(
        picks
          .map(
            (p) =>
              `${p.id}  LeetCode ${p.leetcode}: ${p.title}\n` +
              `  difficulty: ${p.difficulty}  category: ${p.category}\n` +
              `  structures: ${p.structures.join(', ')}\n` +
              `  techniques: ${p.techniques.join(', ') || '—'}`,
          )
          .join('\n\n'),
      )
    },
  )

  server.registerTool(
    'roadmap_update',
    {
      title: 'Update a roadmap entry',
      description:
        'Set status, branch, PR or notes on a roadmap problem and regenerate ROADMAP.md. Preserves YAML comments.',
      inputSchema: {
        id: z.string(),
        status: z.enum(['todo', 'in-progress', 'review', 'blocked', 'done']).optional(),
        branch: z.string().nullable().optional(),
        pr: z.union([z.number().int().positive(), z.string()]).nullable().optional(),
        notes: z.string().nullable().optional(),
      },
    },
    async ({ id, status, branch, pr, notes }) => {
      const patch = {
        ...(status !== undefined ? { status } : {}),
        ...(branch !== undefined ? { branch } : {}),
        ...(pr !== undefined ? { pr } : {}),
        ...(notes !== undefined ? { notes } : {}),
      }
      const updated = update(roadmapPath(repoRoot), id, patch)
      regenerateMarkdown()
      return text(
        `Updated ${updated.id} (${updated.title})\n` +
          `  status: ${updated.status}  branch: ${updated.branch ?? '—'}  pr: ${String(updated.pr ?? '—')}\n` +
          'ROADMAP.md regenerated.',
      )
    },
  )

  server.registerTool(
    'problem_get',
    {
      title: 'Get a problem definition',
      description:
        'Fetch a problem: statement, expected structures, entry name, test cases, starter code and optionally the reference solution.',
      inputSchema: {
        idOrSlug: z.string(),
        include: z.array(z.enum(['cases', 'starter', 'hints'])).default(['cases']),
      },
    },
    async ({ idOrSlug, include }) => {
      const problem = requireProblem(idOrSlug)
      const parts = [
        `${problem.id}  LeetCode ${problem.leetcode}: ${problem.title}`,
        `difficulty: ${problem.difficulty}  category: ${problem.category}`,
        `entry function: ${problem.entry}  comparator: ${problem.comparator}`,
        `structures: ${problem.structures.join(', ')}`,
        '',
        problem.statement,
      ]
      if (include.includes('cases')) {
        parts.push(
          '',
          'test cases:',
          ...problem.cases.map(
            (c, i) =>
              `  [${i}] ${c.name}${c.tags ? ` (${c.tags.join(', ')})` : ''}\n` +
              `      args: ${JSON.stringify(c.args)}\n      expected: ${JSON.stringify(c.expected)}`,
          ),
        )
      }
      if (include.includes('hints') && problem.hints) {
        parts.push('', 'hints:', ...problem.hints.map((h, i) => `  ${i + 1}. ${h}`))
      }
      if (include.includes('starter')) parts.push('', 'starter code:', problem.starter)
      return text(cap(parts.join('\n'), 12_000))
    },
  )

  server.registerTool(
    'problem_list',
    {
      title: 'List implemented problems',
      description: 'List the problems that actually have a definition and reference solution in the repo.',
      inputSchema: {},
    },
    async () =>
      text(
        listProblems()
          .map((p) => `${p.id}  ${p.leetcode}  ${p.slug}  [${p.structures.join(' ')}]  ${p.cases.length} cases`)
          .join('\n'),
      ),
  )

  server.registerTool(
    'run_solution',
    {
      title: 'Run a solution headlessly',
      description:
        'Compile and execute a solution against a problem test cases, returning pass/fail plus a trace summary. ' +
        'Returns trace IDs for trace_inspect — never the frames themselves. Runs in an isolated worker with a hard kill.',
      inputSchema: {
        problem: z.string(),
        source: z.string().optional(),
        useReference: z.boolean().default(false),
        caseIndex: z.union([z.number().int().nonnegative(), z.literal('all')]).default('all'),
      },
    },
    async ({ problem, source, useReference, caseIndex }) => {
      const result = await run({
        problem,
        ...(source !== undefined ? { source } : {}),
        useReference,
        caseIndex,
      })

      if (result.diagnostics.length > 0) {
        return text(
          'Did not compile:\n' +
            result.diagnostics
              .map((d) => `  ${d.line !== undefined ? `line ${d.line}: ` : ''}${d.message}`)
              .join('\n'),
        )
      }

      const lines = [
        `${result.problem}: ${result.results.filter((r) => r.passed).length}/${result.results.length} cases passed`,
        '',
      ]
      for (const caseResult of result.results) {
        const traceId = storeTrace(caseResult.trace)
        lines.push(
          `[${caseResult.caseIndex}] ${caseResult.passed ? 'PASS' : 'FAIL'}  ${caseResult.name}`,
          `      returned ${JSON.stringify(caseResult.returned)}` +
            (caseResult.passed ? '' : `, expected ${JSON.stringify(caseResult.expected)}`),
          `      traceId=${traceId}  frames=${caseResult.frameCount}  ops=${caseResult.opCount}  ${caseResult.wallMs}ms`,
          `      structures: ${caseResult.trace.structures.map((s) => `${s.name}(${s.kind})`).join(', ') || 'none — nothing would animate'}`,
        )
        if (caseResult.error) {
          lines.push(
            `      error: ${caseResult.error.message}` +
              (caseResult.error.line !== undefined ? ` at line ${caseResult.error.line}` : ''),
          )
        }
        if (caseResult.truncated) lines.push(`      TRUNCATED: ${caseResult.truncated.reason}`)
      }
      lines.push('', 'Use trace_inspect with a traceId to see what the animation actually shows.')
      return text(lines.join('\n'))
    },
  )

  server.registerTool(
    'trace_inspect',
    {
      title: 'Inspect a recorded trace',
      description:
        'Read a stored trace as a compact text diagram: a summary, one frame, an op log, a per-structure timeline, or the viz.group tree.',
      inputSchema: {
        traceId: z.string(),
        select: z.enum(['summary', 'frame', 'ops', 'timeline', 'groups']).default('summary'),
        at: z.number().int().nonnegative().optional(),
        from: z.number().int().nonnegative().optional(),
        to: z.number().int().nonnegative().optional(),
        structureId: z.string().optional(),
        maxBytes: z.number().int().positive().max(60_000).default(8_000),
      },
    },
    async ({ traceId, select, at, from, to, structureId, maxBytes }) => {
      const trace = traces.get(traceId)
      if (!trace) {
        return text(
          `Unknown traceId "${traceId}". Known: ${[...traces.keys()].join(', ') || '(none — run_solution first)'}`,
        )
      }

      const lo = from ?? 0
      const hi = to ?? Math.min(trace.frames.length - 1, lo + 40)

      switch (select) {
        case 'summary':
          return text(cap(renderSummary(trace), maxBytes))
        case 'frame':
          return text(cap(renderFrame(trace, at ?? trace.frames.length - 1), maxBytes))
        case 'ops':
          return text(cap(renderOps(trace, lo, hi), maxBytes))
        case 'groups':
          return text(cap(renderGroups(trace), maxBytes))
        case 'timeline': {
          const id = structureId ?? trace.structures[0]?.id
          if (!id) return text('This trace has no structures.')
          return text(cap(renderTimeline(trace, id, lo, hi), maxBytes))
        }
      }
    },
  )

  server.registerTool(
    'trace_assert',
    {
      title: 'Assert trace semantics',
      description:
        'Check mechanical properties of a trace: leftover path marks, cursor ranges and monotonicity, ' +
        'final mark counts, edge states, frame-count bounds, narration density. This is how you verify the ' +
        'animation is faithful rather than merely that the return value is correct.',
      inputSchema: {
        traceId: z.string(),
        assertions: z
          .array(
            z.discriminatedUnion('kind', [
              z.object({ kind: z.literal('final-marks'), structure: z.string(), class: z.string(), count: z.number().int() }),
              z.object({ kind: z.literal('never-marked-at-end'), structure: z.string(), class: z.string() }),
              z.object({ kind: z.literal('cursor-in-range'), structure: z.string(), cursor: z.string(), min: z.number().int(), max: z.number().int() }),
              z.object({ kind: z.literal('cursor-monotonic'), structure: z.string(), cursor: z.string(), direction: z.enum(['up', 'down']) }),
              z.object({ kind: z.literal('frame-count-lte'), max: z.number().int() }),
              z.object({ kind: z.literal('frame-count-gte'), min: z.number().int() }),
              z.object({ kind: z.literal('has-steps'), min: z.number().int() }),
              z.object({ kind: z.literal('final-equals'), value: z.unknown() }),
              z.object({ kind: z.literal('edge-state-count'), structure: z.string(), state: z.string(), count: z.number().int() }),
              z.object({ kind: z.literal('every-node-visited'), structure: z.string() }),
            ]),
          )
          .min(1),
      },
    },
    async ({ traceId, assertions }) => {
      const trace = traces.get(traceId)
      if (!trace) return text(`Unknown traceId "${traceId}". Run run_solution first.`)
      return text(renderReport(checkAssertions(trace, assertions as unknown as Assertion[])))
    },
  )

  return server
}
