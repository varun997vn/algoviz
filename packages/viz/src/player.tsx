import type { Frame, TraceReader } from '@algoviz/tracer'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

export interface Clock {
  /** Schedule `tick`; return a cancel function. Injected so tests can drive time by hand. */
  start(tick: (deltaMs: number) => void): () => void
}

/** Real-time clock backed by requestAnimationFrame, with a time accumulator (not setInterval). */
export const rafClock: Clock = {
  start(tick) {
    let last = performance.now()
    let handle = 0
    const loop = (now: number): void => {
      tick(now - last)
      last = now
      handle = requestAnimationFrame(loop)
    }
    handle = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(handle)
  },
}

/**
 * A clock the caller advances manually.
 *
 * This is how the UI tests stay deterministic: no `waitForTimeout`, no racing the animation —
 * a test calls `advance(n)` and asserts. Exposed on `window.__algoviz` in test mode.
 */
export function createManualClock(): Clock & { advance(ms: number): void } {
  let tickFn: ((deltaMs: number) => void) | undefined
  return {
    start(tick) {
      tickFn = tick
      return () => {
        tickFn = undefined
      }
    },
    advance(ms) {
      tickFn?.(ms)
    },
  }
}

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const

export interface PlayerState {
  frame: number
  playing: boolean
  speed: number
  frameCount: number
  setFrame(next: number): void
  step(delta: number): void
  toggle(): void
  setSpeed(next: number): void
  seekStep(direction: 1 | -1): void
  first(): void
  last(): void
}

export interface UsePlayerOptions {
  reader: TraceReader
  clock?: Clock
  /** Milliseconds per frame at 1×. */
  baseFrameMs?: number
}

export function usePlayer({ reader, clock = rafClock, baseFrameMs = 220 }: UsePlayerOptions): PlayerState {
  const frameCount = reader.frameCount
  const [frame, setFrameRaw] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const accumulated = useRef(0)

  const clamp = useCallback(
    (next: number) => Math.max(0, Math.min(frameCount - 1, next)),
    [frameCount],
  )
  const setFrame = useCallback((next: number) => setFrameRaw(clamp(next)), [clamp])

  // A new trace resets playback rather than leaving the scrubber parked past the end.
  useEffect(() => {
    setFrameRaw(0)
    setPlaying(false)
    accumulated.current = 0
  }, [reader])

  useEffect(() => {
    if (!playing) return
    const perFrame = baseFrameMs / speed
    const stop = clock.start((delta) => {
      accumulated.current += delta
      if (accumulated.current < perFrame) return
      const advance = Math.floor(accumulated.current / perFrame)
      accumulated.current -= advance * perFrame
      setFrameRaw((current) => {
        const next = current + advance
        if (next >= frameCount - 1) {
          setPlaying(false)
          return frameCount - 1
        }
        return next
      })
    })
    return stop
  }, [playing, speed, clock, baseFrameMs, frameCount])

  // Playing on into a hidden tab burns battery and desynchronises what the user comes back to.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onHidden = (): void => {
      if (document.hidden) setPlaying(false)
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => document.removeEventListener('visibilitychange', onHidden)
  }, [])

  const step = useCallback((delta: number) => setFrame(frame + delta), [frame, setFrame])

  const seekStep = useCallback(
    (direction: 1 | -1) => {
      const steps = reader.stepFrames()
      const target =
        direction === 1
          ? steps.find((s) => s > frame)
          : [...steps].reverse().find((s) => s < frame)
      if (target !== undefined) setFrame(target)
      else setFrame(direction === 1 ? frameCount - 1 : 0)
    },
    [reader, frame, setFrame, frameCount],
  )

  return {
    frame,
    playing,
    speed,
    frameCount,
    setFrame,
    step,
    toggle: () => setPlaying((p) => !p),
    setSpeed,
    seekStep,
    first: () => setFrame(0),
    last: () => setFrame(frameCount - 1),
  }
}

export interface PlayerBarProps {
  player: PlayerState
  currentFrame: Frame | undefined
  stepFrames: readonly number[]
}

export function PlayerBar({ player, currentFrame, stepFrames }: PlayerBarProps): ReactNode {
  const { frame, frameCount, playing, speed } = player

  return (
    <div className="av-player" data-testid="player">
      <div className="av-player-controls">
        <button type="button" onClick={player.first} aria-label="First frame" title="Home">
          ⏮
        </button>
        <button type="button" onClick={() => player.seekStep(-1)} aria-label="Previous step" title="[">
          ⏪
        </button>
        <button type="button" onClick={() => player.step(-1)} aria-label="Previous frame" title="←">
          ◀
        </button>
        <button
          type="button"
          onClick={player.toggle}
          aria-label={playing ? 'Pause' : 'Play'}
          data-testid="play-toggle"
          data-playing={playing}
          className="av-play"
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" onClick={() => player.step(1)} aria-label="Next frame" title="→">
          ▶
        </button>
        <button type="button" onClick={() => player.seekStep(1)} aria-label="Next step" title="]">
          ⏩
        </button>
        <button type="button" onClick={player.last} aria-label="Last frame" title="End">
          ⏭
        </button>
      </div>

      <label className="av-scrub">
        <span className="av-visually-hidden">Frame</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, frameCount - 1)}
          value={frame}
          onChange={(e) => player.setFrame(Number(e.target.value))}
          data-testid="scrubber"
          list="av-step-ticks"
        />
        <datalist id="av-step-ticks">
          {stepFrames.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>

      <span className="av-frame-count" data-testid="frame-counter">
        {frameCount === 0 ? '0 / 0' : `${frame + 1} / ${frameCount}`}
      </span>

      <label className="av-speed">
        <span className="av-visually-hidden">Speed</span>
        <select
          value={speed}
          onChange={(e) => player.setSpeed(Number(e.target.value))}
          data-testid="speed"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>

      <p className="av-commentary" data-testid="commentary">
        {currentFrame?.label ?? currentFrame?.op ?? '—'}
      </p>
    </div>
  )
}

/** Keyboard shortcuts, skipped while the user is typing in the editor. */
export function usePlayerKeys(player: PlayerState): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        return
      }
      switch (event.key) {
        case ' ':
          event.preventDefault()
          player.toggle()
          break
        case 'ArrowRight':
          player.step(event.shiftKey ? 10 : 1)
          break
        case 'ArrowLeft':
          player.step(event.shiftKey ? -10 : -1)
          break
        case 'Home':
          player.first()
          break
        case 'End':
          player.last()
          break
        case '[':
          player.seekStep(-1)
          break
        case ']':
          player.seekStep(1)
          break
        case ',':
          player.setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(player.speed as never) - 1)] ?? 1)
          break
        case '.':
          player.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(player.speed as never) + 1)] ?? 1)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [player])
}

/** Call-stack / loop-nesting outline built from `viz.group()` scopes. */
export function GroupOutline({ groups }: { groups: readonly string[] }): ReactNode {
  if (groups.length === 0) return null
  return (
    <ol className="av-groups" data-testid="group-outline">
      {groups.map((g, i) => (
        <li key={`${i}-${g}`} style={{ paddingLeft: `${i * 12}px` }}>
          {g}
        </li>
      ))}
    </ol>
  )
}

export function WatchPanel({ watch }: { watch: Record<string, unknown> | undefined }): ReactNode {
  const entries = Object.entries(watch ?? {})
  if (entries.length === 0) return null
  return (
    <dl className="av-watch" data-testid="watch-panel">
      {entries.map(([name, value]) => (
        <div key={name} data-watch-name={name}>
          <dt>{name}</dt>
          <dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
        </div>
      ))}
    </dl>
  )
}
