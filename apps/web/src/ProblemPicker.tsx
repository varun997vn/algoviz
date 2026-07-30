import type { ProblemDefinition } from '@algoviz/problems'
import roadmapData from '../../../roadmap/roadmap.yaml?raw'
import { parseRoadmap, type RoadmapProblem } from '@algoviz/roadmap'
import { useMemo, useState, type ReactNode } from 'react'

/**
 * The problem list, driven by the roadmap rather than by whatever happens to be implemented.
 *
 * Showing all 75 from the start — with the un-built ones clearly marked — is the point: the
 * roadmap is the plan, and the app is its progress bar.
 */
export function ProblemPicker({
  problems,
  onSelect,
}: {
  problems: readonly ProblemDefinition[]
  onSelect(problem: ProblemDefinition | null): void
}): ReactNode {
  const roadmap = useMemo(() => parseRoadmap(roadmapData), [])
  const [query, setQuery] = useState('')
  const [onlyReady, setOnlyReady] = useState(false)

  const bySlug = useMemo(() => new Map(problems.map((p) => [p.slug, p])), [problems])
  const categories = useMemo(
    () => [...roadmap.categories].sort((a, b) => a.order - b.order),
    [roadmap],
  )

  const matches = (entry: RoadmapProblem): boolean => {
    const ready = bySlug.has(entry.slug)
    if (onlyReady && !ready) return false
    if (query.trim() === '') return true
    const needle = query.toLowerCase()
    return (
      entry.title.toLowerCase().includes(needle) ||
      String(entry.leetcode).includes(needle) ||
      entry.structures.some((s) => s.includes(needle)) ||
      entry.techniques.some((t) => t.includes(needle))
    )
  }

  const readyCount = roadmap.problems.filter((p) => bySlug.has(p.slug)).length

  return (
    <main className="av-picker">
      <section className="av-picker-intro">
        <h1>LeetCode 75, visualized</h1>
        <p data-testid="picker-intro" data-ready-count={readyCount}>
          Pick a problem, write your solution against the <code>viz</code> API, and step through
          your own algorithm frame by frame. {readyCount} of {roadmap.problems.length} are
          playable so far — the rest are on the roadmap.
        </p>
        <div className="av-picker-controls">
          <label>
            <span className="av-visually-hidden">Search problems</span>
            <input
              type="search"
              placeholder="Search by title, number, structure or technique…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="problem-search"
            />
          </label>
          <label className="av-checkbox">
            <input
              type="checkbox"
              checked={onlyReady}
              onChange={(e) => setOnlyReady(e.target.checked)}
              data-testid="only-playable"
            />
            Playable only
          </label>
        </div>
      </section>

      {categories.map((category) => {
        const entries = roadmap.problems
          .filter((p) => p.category === category.id && matches(p))
          .sort((a, b) => a.order - b.order)
        if (entries.length === 0) return null

        return (
          <section key={category.id} className="av-category" data-testid={`category-${category.id}`}>
            <h2>{category.title}</h2>
            <ul className="av-problem-list">
              {entries.map((entry) => {
                const problem = bySlug.get(entry.slug)
                return (
                  <li key={entry.id} data-testid={`problem-item-${entry.leetcode}`} data-ready={problem !== undefined}>
                    <button
                      type="button"
                      disabled={problem === undefined}
                      onClick={() => problem && onSelect(problem)}
                      title={problem ? `Open ${entry.title}` : 'Not built yet — see ROADMAP.md'}
                    >
                      <span className="av-num">{entry.leetcode}</span>
                      <span className="av-title">{entry.title}</span>
                      <span className={`av-diff av-diff-${entry.difficulty}`}>{entry.difficulty}</span>
                      <span className="av-structs">{entry.structures.join(' · ')}</span>
                      <span className="av-state">{problem ? 'play' : 'todo'}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </main>
  )
}
