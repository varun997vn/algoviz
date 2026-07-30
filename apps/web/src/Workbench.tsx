import type { ProblemDefinition } from '@algoviz/problems'
import { TraceReader } from '@algoviz/tracer'
import {
  GroupOutline,
  PlayerBar,
  Stage,
  WatchPanel,
  createManualClock,
  rafClock,
  usePlayer,
  usePlayerKeys,
  type Clock,
} from '@algoviz/viz'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CodeEditor } from './CodeEditor.js'
import { useRunner } from './worker/useRunner.js'

/**
 * In test mode the player's clock is driven by hand and animations are off, so UI tests can
 * `seek(n)` and assert immediately instead of racing a timer. Set by Playwright's init script.
 */
declare global {
  interface Window {
    __ALGOVIZ_TEST__?: boolean
    __algoviz?: {
      seek(frame: number): void
      advance(ms: number): void
      frameCount(): number
      /**
       * Replace the editor contents wholesale.
       *
       * UI tests that need specific source must not type it: CodeMirror auto-closes brackets,
       * so typing `... { return` yields `... { return }` and a deliberately-broken snippet
       * silently becomes valid. Setting state directly tests the run pipeline, which is the
       * actual subject, instead of the editor's input handling.
       */
      setSource(next: string): void
    }
  }
}

const isTestMode = (): boolean =>
  typeof window !== 'undefined' &&
  (window.__ALGOVIZ_TEST__ === true || new URLSearchParams(window.location.search).get('animate') === '0')

export function Workbench({
  problem,
  initialCase,
  storageKey,
}: {
  problem: ProblemDefinition
  initialCase: number
  storageKey: string
}): ReactNode {
  const [source, setSource] = useState(
    () => window.localStorage.getItem(storageKey) ?? problem.starter,
  )
  const [caseIndex, setCaseIndex] = useState(Math.min(initialCase, problem.cases.length - 1))
  const [revealed, setRevealed] = useState(0)
  const runner = useRunner()

  // Drafts survive a reload — losing a half-written solution to a refresh is unforgivable.
  useEffect(() => {
    window.localStorage.setItem(storageKey, source)
  }, [storageKey, source])

  const testMode = useMemo(isTestMode, [])
  const manualClock = useRef(createManualClock())
  const clock: Clock = testMode ? manualClock.current : rafClock

  const selected = runner.results.find((r) => r.caseIndex === caseIndex) ?? runner.results[0]
  const reader = useMemo(
    () => new TraceReader(selected?.trace ?? { frames: [], structures: [], opCount: 0 }),
    [selected],
  )
  const player = usePlayer({ reader, clock, baseFrameMs: testMode ? 1 : 220 })
  usePlayerKeys(player)

  // Land on the failing frame rather than making the user hunt for it.
  useEffect(() => {
    const failedAt = selected?.error?.frameIndex
    if (failedAt !== undefined && failedAt >= 0) player.setFrame(failedAt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  useEffect(() => {
    if (!testMode) return
    window.__algoviz = {
      seek: (frame) => player.setFrame(frame),
      advance: (ms) => manualClock.current.advance(ms),
      frameCount: () => reader.frameCount,
      setSource: (next) => setSource(next),
    }
  }, [testMode, player, reader])

  const currentFrame = reader.frame(player.frame)
  const structures = selected?.trace.structures ?? []

  const runMine = (): void => runner.run({ problem: problem.slug, source, caseIndex: 'all' })
  const runReference = (): void =>
    runner.run({ problem: problem.slug, useReference: true, caseIndex: 'all' })

  return (
    <main className={`av-workbench ${testMode ? '' : 'av-animate'}`} data-testid="workbench">
      <section className="av-left">
        <details className="av-statement" open>
          <summary>Problem</summary>
          <p>{problem.statement}</p>
          {problem.hints && problem.hints.length > 0 ? (
            <div className="av-hints">
              {problem.hints.slice(0, revealed).map((hint, i) => (
                <p key={i} className="av-hint">
                  {hint}
                </p>
              ))}
              {revealed < problem.hints.length ? (
                <button type="button" onClick={() => setRevealed(revealed + 1)} data-testid="reveal-hint">
                  Reveal hint {revealed + 1} of {problem.hints.length}
                </button>
              ) : null}
            </div>
          ) : null}
        </details>

        <div className="av-editor-wrap">
          <CodeEditor
            value={source}
            onChange={setSource}
            highlightLine={currentFrame?.line}
            errorLine={selected?.error?.line ?? runner.diagnostics[0]?.line}
          />
        </div>

        <div className="av-actions">
          <button type="button" className="av-run" onClick={runMine} data-testid="run">
            {runner.phase === 'running' ? 'Running…' : 'Run'}
          </button>
          <button type="button" onClick={runReference} data-testid="run-reference">
            Run reference
          </button>
          <button
            type="button"
            onClick={() => setSource(problem.starter)}
            data-testid="reset-code"
          >
            Reset
          </button>
        </div>

        {runner.diagnostics.length > 0 ? (
          <ul className="av-diagnostics" data-testid="diagnostics">
            {runner.diagnostics.map((d, i) => (
              <li key={i}>
                {d.line !== undefined ? <strong>line {d.line}: </strong> : null}
                {d.message}
              </li>
            ))}
          </ul>
        ) : null}

        {runner.failure ? (
          <p className="av-failure" data-testid="failure">
            {runner.failure}
          </p>
        ) : null}

        {runner.results.length > 0 ? (
          <ul className="av-cases" data-testid="case-bar">
            {runner.results.map((r) => (
              <li key={r.caseIndex}>
                <button
                  type="button"
                  onClick={() => setCaseIndex(r.caseIndex)}
                  data-testid={`case-item-${r.caseIndex}`}
                  data-passed={r.passed}
                  data-selected={r.caseIndex === (selected?.caseIndex ?? -1)}
                  className={r.passed ? 'av-case-pass' : 'av-case-fail'}
                >
                  {r.passed ? '✓' : '✗'} {r.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {selected && !selected.passed ? (
          <p className="av-mismatch" data-testid="mismatch">
            {selected.error
              ? selected.error.message
              : `Returned ${JSON.stringify(selected.returned)}, expected ${JSON.stringify(selected.expected)}`}
          </p>
        ) : null}
      </section>

      <section className="av-right">
        {selected ? (
          <>
            {selected.truncated ? (
              <p className="av-truncated-banner" data-testid="truncated">
                {selected.truncated.message} The animation below stops there.
              </p>
            ) : null}
            <Stage reader={reader} frame={player.frame} structures={structures} />
            <aside className="av-side">
              <WatchPanel watch={reader.watchAt(player.frame)} />
              <GroupOutline groups={currentFrame?.groups ?? []} />
            </aside>
            <PlayerBar
              player={player}
              currentFrame={currentFrame}
              stepFrames={reader.stepFrames()}
              caption={reader.captionAt(player.frame)}
            />
          </>
        ) : (
          <p className="av-empty" data-testid="nothing-run">
            Hit <strong>Run</strong> to execute your solution and step through it. Or{' '}
            <strong>Run reference</strong> to watch a known-good version first.
          </p>
        )}
      </section>
    </main>
  )
}
