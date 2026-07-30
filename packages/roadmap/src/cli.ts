#!/usr/bin/env tsx
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { renderMarkdown } from './generate.js'
import { findRepoRoot, loadRoadmap, roadmapMarkdownPath, roadmapPath } from './load.js'

/**
 * `generate` writes ROADMAP.md; `check` verifies it matches and exits non-zero if not.
 *
 * The check runs in CI *and* as a unit test, so a stale ROADMAP.md fails locally before it
 * ever reaches a pull request. Git hooks were considered and rejected — they get bypassed.
 */
function main(): void {
  const command = process.argv[2] ?? 'generate'
  const repoRoot = findRepoRoot()
  const yamlPath = roadmapPath(repoRoot)
  const mdPath = roadmapMarkdownPath(repoRoot)

  const roadmap = loadRoadmap(yamlPath)
  const rendered = renderMarkdown(roadmap)

  if (command === 'generate') {
    writeFileSync(mdPath, rendered)
    const done = roadmap.problems.filter((p) => p.status === 'done').length
    process.stdout.write(
      `Wrote ROADMAP.md — ${roadmap.problems.length} problems, ${done} done.\n`,
    )
    return
  }

  if (command === 'check') {
    const existing = existsSync(mdPath) ? readFileSync(mdPath, 'utf8') : ''
    if (existing === rendered) {
      process.stdout.write('ROADMAP.md is up to date.\n')
      return
    }
    process.stderr.write(
      'ROADMAP.md is stale — roadmap.yaml has changed since it was generated.\n' +
        'Run `pnpm roadmap:generate` and commit the result.\n',
    )
    process.exitCode = 1
    return
  }

  process.stderr.write(`Unknown command "${command}". Use "generate" or "check".\n`)
  process.exitCode = 2
}

main()
