import { listProblems, type ProblemDefinition } from '@algoviz/problems'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Workbench } from './Workbench.js'
import { ProblemPicker } from './ProblemPicker.js'

const STORAGE_PREFIX = 'algoviz:draft:'

/** Read `?problem=slug&case=0` so any state worth reporting a bug about is a link. */
function readUrl(): { slug: string | null; caseIndex: number } {
  const params = new URLSearchParams(window.location.search)
  return {
    slug: params.get('problem'),
    caseIndex: Number(params.get('case') ?? 0) || 0,
  }
}

export function App(): ReactNode {
  const problems = useMemo(() => listProblems(), [])
  const initial = useMemo(readUrl, [])
  const [slug, setSlug] = useState<string | null>(initial.slug)

  const problem = problems.find((p) => p.slug === slug)

  const select = useCallback((next: ProblemDefinition | null) => {
    setSlug(next?.slug ?? null)
    const url = new URL(window.location.href)
    if (next) url.searchParams.set('problem', next.slug)
    else url.searchParams.delete('problem')
    window.history.replaceState(null, '', url)
  }, [])

  // Back/forward should move between the picker and a problem, not strand the user.
  useEffect(() => {
    const onPop = (): void => setSlug(readUrl().slug)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  return (
    <div className="av-app">
      <header className="av-app-head">
        <button type="button" className="av-brand" onClick={() => select(null)}>
          AlgoViz
        </button>
        <p className="av-tagline">Write the algorithm. Watch it run.</p>
        {problem ? (
          <span className="av-current" data-testid="current-problem">
            {problem.leetcode}. {problem.title}
          </span>
        ) : null}
      </header>

      {problem ? (
        <Workbench
          key={problem.slug}
          problem={problem}
          initialCase={initial.caseIndex}
          storageKey={`${STORAGE_PREFIX}${problem.slug}`}
        />
      ) : (
        <ProblemPicker problems={problems} onSelect={select} />
      )}
    </div>
  )
}
