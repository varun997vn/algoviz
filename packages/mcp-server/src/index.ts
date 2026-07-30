#!/usr/bin/env tsx
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.js'

/**
 * stdio entry for the algoviz MCP server.
 *
 * Registered in `.mcp.json` as `pnpm -s mcp`, which runs this through tsx — no build step to
 * forget. The server resolves the repo root by walking up for pnpm-workspace.yaml rather than
 * trusting cwd.
 */
async function main(): Promise<void> {
  const server = createServer()
  await server.connect(new StdioServerTransport())
}

main().catch((error: unknown) => {
  process.stderr.write(`algoviz MCP server failed to start: ${String(error)}\n`)
  process.exit(1)
})
