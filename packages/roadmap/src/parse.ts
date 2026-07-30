import { parseDocument } from 'yaml'
import { roadmapSchema, validateRoadmap, type Roadmap } from './schema.js'

/**
 * Pure YAML -> Roadmap parsing and validation.
 *
 * Kept separate from `load.ts` so the browser can parse a roadmap bundled with `?raw` without
 * dragging node:fs into the client bundle. The app's problem picker relies on this.
 */
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

