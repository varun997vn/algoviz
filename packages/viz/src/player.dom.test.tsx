import { describe, expect, it, vi } from 'vitest'
import { act, render, renderHook, screen } from '@testing-library/react'
import { TraceReader, trace } from '@algoviz/tracer'
import {
  GroupOutline,
  PlayerBar,
  SPEEDS,
  WatchPanel,
  createManualClock,
  usePlayer,
  usePlayerKeys,
} from './player.js'

function makeReader(): TraceReader {
  const { trace: t } = trace((viz) => {
    const a = viz.array([1, 2, 3, 4, 5])
    for (let i = 0; i < 5; i += 1) {
      viz.step(`step ${i}`)
      a[i] = i * 2
    }
    return a.toArray()
  })
  return new TraceReader(t)
}

describe('usePlayer', () => {
  it('starts at frame 0 and reports the frame count', () => {
    const reader = makeReader()
    const { result } = renderHook(() => usePlayer({ reader, clock: createManualClock() }))
    expect(result.current.frame).toBe(0)
    expect(result.current.frameCount).toBe(reader.frameCount)
    expect(result.current.playing).toBe(false)
  })

  it('clamps stepping at both ends instead of running off the trace', () => {
    const reader = makeReader()
    const { result } = renderHook(() => usePlayer({ reader, clock: createManualClock() }))

    act(() => result.current.step(-5))
    expect(result.current.frame).toBe(0)

    act(() => result.current.step(10_000))
    expect(result.current.frame).toBe(reader.frameCount - 1)
  })

  it('jumps to the last and first frames', () => {
    const reader = makeReader()
    const { result } = renderHook(() => usePlayer({ reader, clock: createManualClock() }))
    act(() => result.current.last())
    expect(result.current.frame).toBe(reader.frameCount - 1)
    act(() => result.current.first())
    expect(result.current.frame).toBe(0)
  })

  it('seeks between viz.step boundaries', () => {
    const reader = makeReader()
    const steps = reader.stepFrames()
    expect(steps.length).toBeGreaterThan(1)

    const { result } = renderHook(() => usePlayer({ reader, clock: createManualClock() }))
    act(() => result.current.seekStep(1))
    expect(result.current.frame).toBe(steps[0])
    act(() => result.current.seekStep(1))
    expect(result.current.frame).toBe(steps[1])
    act(() => result.current.seekStep(-1))
    expect(result.current.frame).toBe(steps[0])
  })

  it('lands on the last frame when seeking forward past the final step', () => {
    const reader = makeReader()
    const { result } = renderHook(() => usePlayer({ reader, clock: createManualClock() }))
    act(() => result.current.last())
    act(() => result.current.seekStep(1))
    expect(result.current.frame).toBe(reader.frameCount - 1)
  })

  it('advances only once the accumulated time covers a frame', () => {
    // The accumulator is why playback speed is smooth and independent of frame rate.
    const reader = makeReader()
    const clock = createManualClock()
    const { result } = renderHook(() => usePlayer({ reader, clock, baseFrameMs: 100 }))

    act(() => result.current.toggle())
    expect(result.current.playing).toBe(true)

    act(() => clock.advance(40))
    expect(result.current.frame).toBe(0) // not yet a full frame's worth

    act(() => clock.advance(70)) // 110ms total -> one frame
    expect(result.current.frame).toBe(1)
  })

  it('advances proportionally faster at higher speed', () => {
    const reader = makeReader()
    const clock = createManualClock()
    const { result } = renderHook(() => usePlayer({ reader, clock, baseFrameMs: 100 }))

    act(() => result.current.setSpeed(4))
    act(() => result.current.toggle())
    act(() => clock.advance(100)) // 100ms at 4x = 4 frames
    expect(result.current.frame).toBe(4)
  })

  it('stops playing when it reaches the end', () => {
    const reader = makeReader()
    const clock = createManualClock()
    const { result } = renderHook(() => usePlayer({ reader, clock, baseFrameMs: 10 }))

    act(() => result.current.toggle())
    act(() => clock.advance(10_000))
    expect(result.current.frame).toBe(reader.frameCount - 1)
    expect(result.current.playing).toBe(false)
  })

  it('pauses when the tab is hidden', () => {
    // Playing on into a hidden tab burns battery and desynchronises what the user returns to.
    const reader = makeReader()
    const { result } = renderHook(() => usePlayer({ reader, clock: createManualClock() }))
    act(() => result.current.toggle())
    expect(result.current.playing).toBe(true)

    const spy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.playing).toBe(false)
    spy.mockRestore()
  })

  it('resets to the start when given a new trace', () => {
    const first = makeReader()
    const { result, rerender } = renderHook(
      ({ reader }) => usePlayer({ reader, clock: createManualClock() }),
      { initialProps: { reader: first } },
    )
    act(() => result.current.last())
    expect(result.current.frame).toBeGreaterThan(0)

    rerender({ reader: makeReader() })
    expect(result.current.frame).toBe(0)
    expect(result.current.playing).toBe(false)
  })
})

describe('PlayerBar', () => {
  function setup() {
    const reader = makeReader()
    const hook = renderHook(() => usePlayer({ reader, clock: createManualClock() }))
    const view = render(
      <PlayerBar
        player={hook.result.current}
        currentFrame={reader.frame(hook.result.current.frame)}
        stepFrames={reader.stepFrames()}
      />,
    )
    return { reader, hook, view }
  }

  it('renders a 1-based frame counter', () => {
    setup()
    expect(screen.getByTestId('frame-counter')).toHaveTextContent(/^1 \/ \d+$/)
  })

  it('offers every playback speed', () => {
    setup()
    const select = screen.getByTestId('speed') as HTMLSelectElement
    expect([...select.options].map((o) => Number(o.value))).toEqual([...SPEEDS])
  })

  it('shows the current frame label as commentary', () => {
    const reader = makeReader()
    const stepFrame = reader.stepFrames()[0]!
    render(
      <PlayerBar
        player={{
          frame: stepFrame,
          playing: false,
          speed: 1,
          frameCount: reader.frameCount,
          setFrame: () => {},
          step: () => {},
          toggle: () => {},
          setSpeed: () => {},
          seekStep: () => {},
          first: () => {},
          last: () => {},
        }}
        currentFrame={reader.frame(stepFrame)}
        stepFrames={reader.stepFrames()}
      />,
    )
    expect(screen.getByTestId('commentary')).toHaveTextContent('step 0')
  })

  it('shows 0 / 0 for an empty trace rather than NaN', () => {
    const empty = new TraceReader({ frames: [], structures: [], opCount: 0 })
    const hook = renderHook(() => usePlayer({ reader: empty, clock: createManualClock() }))
    render(
      <PlayerBar player={hook.result.current} currentFrame={undefined} stepFrames={[]} />,
    )
    expect(screen.getByTestId('frame-counter')).toHaveTextContent('0 / 0')
    expect(screen.getByTestId('commentary')).toHaveTextContent('—')
  })
})

describe('usePlayerKeys', () => {
  // The reader and clock are created once, outside the component: a fresh reader identity on
  // every render would retrigger the "new trace resets playback" effect and pin the frame at 0.
  const sharedReader = makeReader()
  const sharedClock = createManualClock()

  function Harness({ onFrame }: { onFrame: (n: number) => void }) {
    const player = usePlayer({ reader: sharedReader, clock: sharedClock })
    usePlayerKeys(player)
    onFrame(player.frame)
    return <input data-testid="typing-target" />
  }

  it('steps with the arrow keys', () => {
    let frame = -1
    render(<Harness onFrame={(n) => (frame = n)} />)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    })
    expect(frame).toBe(1)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    })
    expect(frame).toBe(0)
  })

  it('jumps ten frames with shift', () => {
    let frame = -1
    render(<Harness onFrame={(n) => (frame = n)} />)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }))
    })
    expect(frame).toBe(10)
  })

  it('goes to the end with End and back with Home', () => {
    let frame = -1
    render(<Harness onFrame={(n) => (frame = n)} />)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }))
    })
    expect(frame).toBeGreaterThan(0)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }))
    })
    expect(frame).toBe(0)
  })

  it('ignores keys while the user is typing', () => {
    // Otherwise every space typed in the editor would toggle playback.
    let frame = -1
    render(<Harness onFrame={(n) => (frame = n)} />)
    const input = screen.getByTestId('typing-target')
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(frame).toBe(0)
  })

  it('seeks between steps with the bracket keys', () => {
    let frame = -1
    render(<Harness onFrame={(n) => (frame = n)} />)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ']' }))
    })
    expect(frame).toBeGreaterThan(0)
    const after = frame
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '[' }))
    })
    expect(frame).toBeLessThan(after)
  })

  it('changes speed with comma and period', () => {
    let speed = -1
    function SpeedHarness() {
      const player = usePlayer({ reader: sharedReader, clock: sharedClock })
      usePlayerKeys(player)
      speed = player.speed
      return null
    }
    render(<SpeedHarness />)
    expect(speed).toBe(1)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '.' }))
    })
    expect(speed).toBe(2)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ',' }))
    })
    expect(speed).toBe(1)
  })
})

describe('WatchPanel and GroupOutline', () => {
  it('renders each watched variable', () => {
    render(<WatchPanel watch={{ best: 49, left: 1 }} />)
    expect(screen.getByTestId('watch-panel')).toBeInTheDocument()
    expect(screen.getByText('49')).toBeInTheDocument()
  })

  it('renders nothing when there is nothing to watch', () => {
    const { container } = render(<WatchPanel watch={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('indents nested group scopes to show recursion depth', () => {
    render(<GroupOutline groups={['outer', 'inner']} />)
    const items = screen.getByTestId('group-outline').querySelectorAll('li')
    expect(items).toHaveLength(2)
    expect((items[1] as HTMLElement).style.paddingLeft).not.toBe(
      (items[0] as HTMLElement).style.paddingLeft,
    )
  })

  it('renders nothing outside any group', () => {
    const { container } = render(<GroupOutline groups={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
