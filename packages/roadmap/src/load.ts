import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { parseDocument, type Document } from 'yaml'
import { roadmapSchema, validateRoadmap, type Roadmap, type RoadmapProblem } from './schema.js'

/** Walk up from this module until we find the workspace root, so cwd can't break resolution. */
export function findRepoRoot(from = dirname(fileURLToPath(import.meta.url))): string {
  let dir = resolve(from)
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error('Could not locate the workspace root (no pnpm-workspace.yaml found)')
    dir = parent
  }
}

export function roadmapPath(repoRoot = findRepoRoot()): string {
  return join(repoRoot, 'roadmap', 'roadmap.yaml')
}

export function roadmapMarkdownPath(repoRoot = findRepoRoot()): string {
  return join(repoRoot, 'ROADMAP.md')
}

export class RoadmapError extends Error {}

export function parseRoadmap(source: string): Roadmap {
  const parsed = roadmapSchema.safeParse(parseDocument(source).toJS())
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new RoadmapError(`roadmap.yaml failed schema validation:\n${detail}`)
  }
  const issues = validateRoadmap(parsed.data)
  if (issues.length > 0) {
    throw new RoadmapError(
      `roadmap.yaml has integrity problems:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`,
    )
  }
  return parsed.data
}

export function loadRoadmap(path = roadmapPath()): Roadmap {
  return parseRoadmap(readFileSync(path, 'utf8'))
}

/**
 * Apply a patch to one problem, editing the YAML document in place so comments and formatting
 * survive. A naive load-and-dump would strip the header comment that tells the next person
 * how the file works, which is exactly the kind of erosion that makes a roadmap stop being
 * maintained.
 */
export function updateProblem(
  path: string,
  id: string,
  patch: Partial<Pick<RoadmapProblem, 'status' | 'branch' | 'pr' | 'notes' | 'structures'>>,
): RoadmapProblem {
  const source = readFileSync(path, 'utf8')
  const doc: Document = parseDocument(source)
  const problems = doc.get('problems') as { items: unknown[] } | undefined
  if (!problems || !Array.isArray(problems.items)) {
    throw new RoadmapError('roadmap.yaml has no problems list')
  }

  const index = problems.items.findIndex((item) => {
    const node = item as { get?: (k: string) => unknown }
    return typeof node.get === 'function' && node.get('id') === id
  })
  if (index === -1) throw new RoadmapError(`No roadmap problem with id "${id}"`)

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    doc.setIn(['problems', index, key], value)
  }

  const updated = doc.toString()
  parseRoadmap(updated) // fail before writing rather than after
  writeFileSync(path, updated)

  const reloaded = parseRoadmap(updated)
  const problem = reloaded.problems.find((p) => p.id === id)
  if (!problem) throw new RoadmapError(`Problem "${id}" vanished after update`)
  return problem
}
