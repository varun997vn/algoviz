import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { workspaceAliases } from './vite.shared.js'

/**
 * Three projects, matching the three test layers:
 *
 * - `unit`             — pure logic in Node. Tracer, runner internals, roadmap, problem validity.
 * - `integration-node` — compile and execute real solutions, assert the emitted frame sequence.
 * - `integration-dom`  — render visualizers against committed trace fixtures under jsdom.
 *
 * Playwright owns the UI/e2e layer separately (`pnpm test:ui`).
 */
export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    projects: [
      {
        resolve: { alias: workspaceAliases },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/*/src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
        },
      },
      {
        resolve: { alias: workspaceAliases },
        test: {
          name: 'integration-node',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 20_000,
        },
      },
      {
        plugins: [react()],
        resolve: { alias: workspaceAliases },
        test: {
          name: 'integration-dom',
          environment: 'jsdom',
          setupFiles: ['./tests/setup-dom.ts'],
          include: ['packages/viz/src/**/*.dom.test.tsx', 'tests/dom/**/*.test.tsx'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.dom.test.tsx',
        '**/index.ts',
        // Type-only module: no runtime code to cover.
        'packages/runner/src/protocol.ts',
        // Process entry points. These are covered by the stdio integration test and by
        // `pnpm roadmap:check`, but both run in a child process where v8 coverage cannot see
        // them, so counting them here would just be reporting a number we can't act on.
        'packages/mcp-server/src/index.ts',
        'packages/runner/src/run-cli.ts',
        'packages/roadmap/src/cli.ts',
        // Reference solutions are exercised end-to-end by the integration suite; measuring them
        // as library code would reward instrumenting for coverage rather than for clarity.
        'packages/problems/src/problems/**',
      ],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 75,
        statements: 80,
      },
    },
  },
})
