import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { findRepoRoot } from '@algoviz/roadmap/node'

/**
 * The MCP server over real stdio, launched exactly as `.mcp.json` launches it.
 *
 * The in-process tests cover behaviour; this one covers the thing they cannot — that the binary
 * actually starts, speaks the protocol, and can execute a solution in an isolated worker
 * thread. "MCP server silently broken" is a failure class nothing else in the suite would catch.
 */
describe('MCP server over stdio', () => {
  it('starts, lists its tools, and runs a solution end to end', async () => {
    const repoRoot = findRepoRoot()
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', 'packages/mcp-server/src/index.ts'],
      cwd: repoRoot,
    })
    const client = new Client({ name: 'stdio-smoke', version: '0.0.0' })

    try {
      await client.connect(transport)

      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name)).toContain('run_solution')
      expect(tools.map((t) => t.name)).toContain('trace_assert')

      // Goes through runIsolated (worker_threads), i.e. the path an agent actually hits.
      const result = await client.callTool({
        name: 'run_solution',
        arguments: { problem: 'container-with-most-water', useReference: true, caseIndex: 0 },
      })
      const body = (result.content as { text?: string }[]).map((c) => c.text ?? '').join('\n')
      expect(body).toContain('1/1 cases passed')
      expect(body).toMatch(/traceId=t\d+/)

      const traceId = /traceId=(t\d+)/.exec(body)?.[1] ?? ''
      const inspected = await client.callTool({
        name: 'trace_inspect',
        arguments: { traceId, select: 'summary' },
      })
      const summary = (inspected.content as { text?: string }[]).map((c) => c.text ?? '').join('\n')
      expect(summary).toContain('returned: 49')
    } finally {
      await client.close()
    }
  }, 90_000)
})
