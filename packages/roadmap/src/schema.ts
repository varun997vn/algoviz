import { z } from 'zod'

/**
 * The roadmap's structure vocabulary is the tracer's structure kinds plus `cursor`, which is
 * an annotation rather than a structure but is worth tracking for coverage. Keeping this list
 * tied to the tracer means a roadmap entry cannot claim a structure the platform can't render.
 */
export const STRUCTURE_KINDS = [
  'array',
  'matrix',
  'string',
  'list',
  'tree',
  'graph',
  'stack',
  'queue',
  'heap',
  'map',
  'set',
  'dp',
  'intervals',
  'trie',
  'cursor',
] as const

export const STATUSES = ['todo', 'in-progress', 'review', 'blocked', 'done'] as const
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const

export const categorySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  order: z.number().int().positive(),
})

export const problemSchema = z.object({
  id: z.string().regex(/^p\d{3,4}$/, 'id must look like p011 or p1448'),
  leetcode: z.number().int().positive(),
  title: z.string().min(1),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be kebab-case'),
  difficulty: z.enum(DIFFICULTIES),
  category: z.string().min(1),
  order: z.number().int().positive(),
  structures: z.array(z.enum(STRUCTURE_KINDS)).min(1),
  techniques: z.array(z.string()).default([]),
  status: z.enum(STATUSES),
  branch: z.string().nullable().default(null),
  pr: z.union([z.number().int().positive(), z.string()]).nullable().default(null),
  notes: z.string().nullable().default(null),
  dependsOn: z.array(z.string()).default([]),
})

export const roadmapSchema = z.object({
  version: z.literal(1),
  set: z.string().min(1),
  categories: z.array(categorySchema).min(1),
  problems: z.array(problemSchema).min(1),
})

export type Category = z.infer<typeof categorySchema>
export type RoadmapProblem = z.infer<typeof problemSchema>
export type Roadmap = z.infer<typeof roadmapSchema>
export type Status = (typeof STATUSES)[number]
export type Difficulty = (typeof DIFFICULTIES)[number]
export type StructureTag = (typeof STRUCTURE_KINDS)[number]

export interface ValidationIssue {
  path: string
  message: string
}

/**
 * Cross-entry checks the zod schema can't express.
 *
 * These are the ones that actually rot: duplicate ids after a copy-paste, a category typo, a
 * dependency cycle, or a problem marked done with no PR to point at.
 */
export function validateRoadmap(roadmap: Roadmap): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const categoryIds = new Set(roadmap.categories.map((c) => c.id))

  const seen = { id: new Set<string>(), slug: new Set<string>(), leetcode: new Set<number>(), order: new Set<number>() }
  for (const p of roadmap.problems) {
    for (const [field, set, value] of [
      ['id', seen.id, p.id],
      ['slug', seen.slug, p.slug],
      ['leetcode', seen.leetcode, p.leetcode],
      ['order', seen.order, p.order],
    ] as const) {
      if ((set as Set<unknown>).has(value)) {
        issues.push({ path: p.id, message: `duplicate ${field}: ${String(value)}` })
      }
      ;(set as Set<unknown>).add(value)
    }

    if (!categoryIds.has(p.category)) {
      issues.push({ path: p.id, message: `unknown category "${p.category}"` })
    }
    if (p.status === 'done' && p.pr === null && p.branch === null) {
      issues.push({ path: p.id, message: 'status is done but neither pr nor branch is recorded' })
    }
    for (const dep of p.dependsOn) {
      if (!roadmap.problems.some((q) => q.id === dep)) {
        issues.push({ path: p.id, message: `dependsOn references unknown problem "${dep}"` })
      }
    }
  }

  for (const cycle of findCycles(roadmap.problems)) {
    issues.push({ path: cycle.join(' -> '), message: 'dependency cycle' })
  }

  return issues
}

function findCycles(problems: readonly RoadmapProblem[]): string[][] {
  const byId = new Map(problems.map((p) => [p.id, p]))
  const state = new Map<string, 'visiting' | 'done'>()
  const cycles: string[][] = []

  const walk = (id: string, path: string[]): void => {
    const current = state.get(id)
    if (current === 'done') return
    if (current === 'visiting') {
      const start = path.indexOf(id)
      cycles.push([...path.slice(start), id])
      return
    }
    state.set(id, 'visiting')
    for (const dep of byId.get(id)?.dependsOn ?? []) walk(dep, [...path, id])
    state.set(id, 'done')
  }

  for (const p of problems) walk(p.id, [])
  return cycles
}

/**
 * The next actionable problems: not done, not blocked, with every dependency already done.
 * One implementation, used by the MCP `roadmap_next` tool *and* the generated ROADMAP.md, so
 * the doc and the agent can never disagree about what's next.
 */
export function nextProblems(roadmap: Roadmap, count = 1): RoadmapProblem[] {
  const doneIds = new Set(roadmap.problems.filter((p) => p.status === 'done').map((p) => p.id))
  return roadmap.problems
    .filter((p) => p.status !== 'done' && p.status !== 'blocked')
    .filter((p) => p.dependsOn.every((d) => doneIds.has(d)))
    .sort((a, b) => a.order - b.order)
    .slice(0, count)
}
