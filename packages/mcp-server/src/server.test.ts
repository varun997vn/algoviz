import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { executeRun } from '@algoviz/runner'
import { findRepoRoot, loadRoadmap, roadmapPath, updateProblem } from '@algoviz/roadmap/node'
import { renderMarkdown } from '@algoviz/roadmap'
import { createServer } from './server.js'
import { checkAssertions } from './assertions.js'
import { renderFrame, renderSnapshot, renderSummary } from './render.js'
import { TraceReader } from '@algoviz/tracer'

/**
 * A throwaway copy of the real repo's roadmap, so `roadmap_update` tests exercise the actual
 * comment-preserving write path without mutating the checked-in file.
 */
function makeFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'algoviz-mcp-'))
  const real = findRepoRoot()
  mkdirSync(join(dir, 'roadmap'), { recursive: true })
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
  cpSync(roadmapPath(real), join(dir, 'roadmap', 'roadmap.yaml'))
  writeFileSync(join(dir, 'ROADMAP.md'), renderMarkdown(loadRoadmap(roadmapPath(real))))
  return dir
}

async function connect(repoRoot: string): Promise<Client> {
  const server = createServer({
    repoRoot,
    loadRoadmapFn: () => loadRoadmap(join(repoRoot, 'roadmap', 'roadmap.yaml')),
    updateProblemFn: updateProblem,
    // In-process rather than a worker thread: faster, and the isolation path has its own test.
    runFn: (request) => executeRun(request),
  })
  const client = new Client({ name: 'test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text?: string }[] }).content
  return content.map((c) => c.text ?? '').join('\n')
}

describe('algoviz MCP server', () => {
  let repoRoot: string
  let client: Client

  beforeEach(async () => {
    repoRoot = makeFixtureRepo()
    client = await connect(repoRoot)
  })

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true })
  })

  it('exposes exactly the expected tool set', async () => {
    // Pinned deliberately: the skills reference these names, so a silent rename would break
    // every skill at once with no other test noticing.
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'problem_get',
      'problem_list',
      'roadmap_list',
      'roadmap_next',
      'roadmap_update',
      'run_solution',
      'trace_assert',
      'trace_inspect',
    ])
  })

  it('gives every tool a description an agent can act on', async () => {
    const { tools } = await client.listTools()
    for (const tool of tools) {
      expect(tool.description, tool.name).toBeTruthy()
      expect((tool.description ?? '').length, tool.name).toBeGreaterThan(40)
    }
  })

  describe('roadmap_list', () => {
    it('lists all 75 by default within the limit', async () => {
      const out = textOf(await client.callTool({ name: 'roadmap_list', arguments: {} }))
      expect(out).toContain('75 match(es)')
    })

    it('filters by status', async () => {
      const out = textOf(
        await client.callTool({ name: 'roadmap_list', arguments: { status: 'done' } }),
      )
      expect(out).toContain('3 match(es)')
      expect(out).toContain('Container With Most Water')
    })

    it('filters by structure', async () => {
      const out = textOf(
        await client.callTool({ name: 'roadmap_list', arguments: { structure: 'trie' } }),
      )
      expect(out).toContain('2 match(es)')
    })
  })

  describe('roadmap_next', () => {
    it('returns the first todo problem with the context needed to start', async () => {
      const out = textOf(await client.callTool({ name: 'roadmap_next', arguments: { count: 1 } }))
      expect(out).toContain('Merge Strings Alternately')
      expect(out).toContain('structures:')
      expect(out).toContain('techniques:')
    })
  })

  describe('roadmap_update', () => {
    it('writes the change, keeps YAML comments, and regenerates ROADMAP.md', async () => {
      const inProgressCount = (source: string): number =>
        Number(/🟡 in-progress \| (\d+)/.exec(source)?.[1] ?? -1)
      const inProgressBefore = inProgressCount(readFileSync(join(repoRoot, 'ROADMAP.md'), 'utf8'))
      expect(inProgressBefore).toBeGreaterThanOrEqual(0)

      const out = textOf(
        await client.callTool({
          name: 'roadmap_update',
          arguments: { id: 'p1071', status: 'in-progress', branch: 'feature/x', notes: 'started' },
        }),
      )
      expect(out).toContain('in-progress')

      const yaml = readFileSync(join(repoRoot, 'roadmap', 'roadmap.yaml'), 'utf8')
      expect(yaml).toContain('status: in-progress')
      // The header comment tells the next person how the file works; losing it is how a
      // roadmap stops being maintained.
      expect(yaml).toContain('# roadmap/roadmap.yaml — SOURCE OF TRUTH')

      // Assert the delta, not an absolute count. The fixture is copied from the live roadmap, so
      // hard-coding "in-progress | 1" made this test fail the moment real work put other
      // problems in progress — a brittleness bug, not a regression in the tool.
      const md = readFileSync(join(repoRoot, 'ROADMAP.md'), 'utf8')
      expect(inProgressCount(md)).toBe(inProgressBefore + 1)
      expect(md).toContain('🟡 in-progress |')
    })

    it('reports an unknown id rather than silently doing nothing', async () => {
      // The SDK surfaces a handler throw as an error *result*, not a rejected promise, so the
      // agent still gets the message back through the protocol.
      const result = await client.callTool({
        name: 'roadmap_update',
        arguments: { id: 'p9999', status: 'done' },
      })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain('p9999')
    })
  })

  describe('problem_get', () => {
    it('returns the statement, entry name and test cases', async () => {
      const out = textOf(
        await client.callTool({
          name: 'problem_get',
          arguments: { idOrSlug: 'container-with-most-water', include: ['cases', 'hints'] },
        }),
      )
      expect(out).toContain('entry function: maxArea')
      expect(out).toContain('expected: 49')
      expect(out).toContain('hints:')
    })
  })

  describe('run_solution', () => {
    it('runs the reference and reports every case passing with a traceId', async () => {
      const out = textOf(
        await client.callTool({
          name: 'run_solution',
          arguments: { problem: 'container-with-most-water', useReference: true },
        }),
      )
      expect(out).toContain('6/6 cases passed')
      expect(out).toMatch(/traceId=t\d+/)
      // Naming the structures matters: "no structures" means nothing would animate.
      expect(out).toContain('height(array)')
    })

    it('reports a wrong answer with both values', async () => {
      const out = textOf(
        await client.callTool({
          name: 'run_solution',
          arguments: {
            problem: 'container-with-most-water',
            source:
              'export default function maxArea(h: number[], viz: Viz): number { viz.array(h); return 0 }',
            caseIndex: 0,
          },
        }),
      )
      expect(out).toContain('FAIL')
      expect(out).toContain('expected 49')
    })

    it('reports a compile failure as diagnostics', async () => {
      const out = textOf(
        await client.callTool({
          name: 'run_solution',
          arguments: { problem: 'container-with-most-water', source: 'function f( {' },
        }),
      )
      expect(out).toContain('Did not compile')
    })

    it('flags a solution that creates no structures at all', async () => {
      const out = textOf(
        await client.callTool({
          name: 'run_solution',
          arguments: {
            problem: 'container-with-most-water',
            source: 'export default function maxArea(h: number[], viz: Viz): number { return 49 }',
            caseIndex: 0,
          },
        }),
      )
      // Passes its test, animates nothing — exactly the failure this line exists to surface.
      expect(out).toContain('PASS')
      expect(out).toContain('nothing would animate')
    })
  })

  describe('trace_inspect', () => {
    async function firstTraceId(): Promise<string> {
      const out = textOf(
        await client.callTool({
          name: 'run_solution',
          arguments: { problem: 'container-with-most-water', useReference: true, caseIndex: 0 },
        }),
      )
      return /traceId=(t\d+)/.exec(out)?.[1] ?? ''
    }

    it('summarises a trace', async () => {
      const traceId = await firstTraceId()
      const out = textOf(
        await client.callTool({ name: 'trace_inspect', arguments: { traceId, select: 'summary' } }),
      )
      expect(out).toContain('structures: height (array')
      expect(out).toContain('returned: 49')
      expect(out).toContain('frames by op:')
    })

    it('renders a frame as a readable diagram with cursors and a legend', async () => {
      const traceId = await firstTraceId()
      const out = textOf(
        await client.callTool({ name: 'trace_inspect', arguments: { traceId, select: 'frame' } }),
      )
      expect(out).toMatch(/height: \[/)
      expect(out).toContain('left=')
      expect(out).toContain('legend:')
    })

    it('renders the op log', async () => {
      const traceId = await firstTraceId()
      const out = textOf(
        await client.callTool({
          name: 'trace_inspect',
          arguments: { traceId, select: 'ops', from: 0, to: 5 },
        }),
      )
      expect(out.split('\n').length).toBeLessThanOrEqual(7)
      expect(out).toContain('init')
    })

    it('renders a per-structure timeline', async () => {
      const traceId = await firstTraceId()
      const out = textOf(
        await client.callTool({
          name: 'trace_inspect',
          arguments: { traceId, select: 'timeline', from: 0, to: 4 },
        }),
      )
      expect(out).toMatch(/height: \[/)
    })

    it('caps output rather than blowing up the caller context', async () => {
      const traceId = await firstTraceId()
      const out = textOf(
        await client.callTool({
          name: 'trace_inspect',
          arguments: { traceId, select: 'ops', from: 0, to: 500, maxBytes: 200 },
        }),
      )
      expect(out).toContain('truncated')
      expect(out.length).toBeLessThan(400)
    })

    it('explains an unknown traceId instead of failing opaquely', async () => {
      const out = textOf(
        await client.callTool({ name: 'trace_inspect', arguments: { traceId: 'nope' } }),
      )
      expect(out).toContain('Unknown traceId')
    })
  })

  describe('trace_assert', () => {
    it('confirms the tree reference unwinds its path marks and finds four good nodes', async () => {
      const run = textOf(
        await client.callTool({
          name: 'run_solution',
          arguments: { problem: 'count-good-nodes-in-binary-tree', useReference: true, caseIndex: 0 },
        }),
      )
      const traceId = /traceId=(t\d+)/.exec(run)?.[1] ?? ''

      const out = textOf(
        await client.callTool({
          name: 'trace_assert',
          arguments: {
            traceId,
            assertions: [
              { kind: 'never-marked-at-end', structure: 'tree', class: 'path' },
              { kind: 'final-marks', structure: 'tree', class: 'result', count: 4 },
              { kind: 'final-equals', value: 4 },
              { kind: 'has-steps', min: 5 },
            ],
          },
        }),
      )
      expect(out).toBe('All 4 assertion(s) passed.')
    })

    it('reports a failing assertion with a reason', async () => {
      const run = textOf(
        await client.callTool({
          name: 'run_solution',
          arguments: { problem: 'container-with-most-water', useReference: true, caseIndex: 0 },
        }),
      )
      const traceId = /traceId=(t\d+)/.exec(run)?.[1] ?? ''
      const out = textOf(
        await client.callTool({
          name: 'trace_assert',
          arguments: { traceId, assertions: [{ kind: 'final-marks', structure: 'height', class: 'result', count: 99 }] },
        }),
      )
      expect(out).toContain('FAILED')
      expect(out).toContain('found 2')
    })

    it('catches a cursor that moves the wrong way', async () => {
      const run = textOf(
        await client.callTool({
          name: 'run_solution',
          arguments: { problem: 'container-with-most-water', useReference: true, caseIndex: 0 },
        }),
      )
      const traceId = /traceId=(t\d+)/.exec(run)?.[1] ?? ''
      const out = textOf(
        await client.callTool({
          name: 'trace_assert',
          arguments: {
            traceId,
            assertions: [{ kind: 'cursor-monotonic', structure: 'height', cursor: 'left', direction: 'down' }],
          },
        }),
      )
      expect(out).toContain('FAILED')
      expect(out).toContain('moved forwards')
    })
  })
})

describe('assertion engine', () => {
  const result = executeRun({
    problem: 'reorder-routes-to-make-all-paths-lead-to-the-city-zero',
    useReference: true,
    caseIndex: 0,
  })
  const trace = result.results[0]!.trace

  it('counts edge states', () => {
    expect(
      checkAssertions(trace, [
        { kind: 'edge-state-count', structure: 'cities', state: 'reversed', count: 3 },
      ]).passed,
    ).toBe(true)
  })

  it('verifies every graph node was visited', () => {
    expect(checkAssertions(trace, [{ kind: 'every-node-visited', structure: 'cities' }]).passed).toBe(
      true,
    )
  })

  it('reports a missing structure by name rather than crashing', () => {
    const report = checkAssertions(trace, [{ kind: 'every-node-visited', structure: 'nope' }])
    expect(report.passed).toBe(false)
    expect(report.failures[0]?.reason).toContain('no structure named')
  })

  it('enforces frame-count bounds in both directions', () => {
    expect(checkAssertions(trace, [{ kind: 'frame-count-lte', max: 1 }]).passed).toBe(false)
    expect(checkAssertions(trace, [{ kind: 'frame-count-gte', min: 100_000 }]).passed).toBe(false)
    expect(checkAssertions(trace, [{ kind: 'frame-count-gte', min: 1 }]).passed).toBe(true)
  })
})

describe('text renderers', () => {
  const result = executeRun({ problem: 'container-with-most-water', useReference: true, caseIndex: 0 })
  const trace = result.results[0]!.trace

  it('renders an array with mark glyphs and cursors', () => {
    const reader = new TraceReader(trace)
    const snapshot = reader.structureAt('arr1', trace.frames.length - 1)!
    const rendered = renderSnapshot('height', snapshot)
    expect(rendered).toMatch(/^height: \[/)
    expect(rendered).toContain('#') // result marks
    expect(rendered).toContain('left=')
  })

  it('renders a graph with node marks and edge states', () => {
    const graphRun = executeRun({
      problem: 'reorder-routes-to-make-all-paths-lead-to-the-city-zero',
      useReference: true,
      caseIndex: 0,
    })
    const graphTrace = graphRun.results[0]!.trace
    const reader = new TraceReader(graphTrace)
    const snapshot = [...reader.at(graphTrace.frames.length - 1).values()].find(
      (s) => s.kind === 'graph',
    )!
    const rendered = renderSnapshot('cities', snapshot)
    expect(rendered).toContain('nodes')
    expect(rendered).toContain(':reversed')
  })

  it('renders a tree as an indented outline', () => {
    const treeRun = executeRun({
      problem: 'count-good-nodes-in-binary-tree',
      useReference: true,
      caseIndex: 0,
    })
    const rendered = renderFrame(treeRun.results[0]!.trace, treeRun.results[0]!.frameCount - 1)
    expect(rendered).toContain('tree (tree):')
    expect(rendered).toMatch(/L \d/)
  })

  it('says something useful for a frame that does not exist', () => {
    expect(renderFrame(trace, 99_999)).toContain('does not exist')
  })

  it('flags truncation in the summary', () => {
    const truncated = executeRun({
      problem: 'container-with-most-water',
      source:
        'export default function maxArea(h: number[], viz: Viz): number { const a = viz.array(h); for(;;) a.mark(0, "active"); }',
      caseIndex: 0,
      budgets: { maxFrames: 30 },
    })
    expect(renderSummary(truncated.results[0]!.trace)).toContain('TRUNCATED')
  })
})
