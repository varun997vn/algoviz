import type { Cursor, StructureSnapshot } from '@algoviz/tracer'
import type { ReactNode } from 'react'
import {
  CELL,
  Caret,
  Cell,
  EmptyState,
  GAP,
  Scroll,
  display,
  marksAt,
  marksAtCell,
} from '../primitives.js'

type Of<K extends StructureSnapshot['kind']> = Extract<StructureSnapshot, { kind: K }>

/**
 * The note attached to a mark, if any.
 *
 * `mark(index, class, note)` has always stored a note that no component rendered — which is
 * exactly the affordance a stack of indices needs to say what its numbers mean.
 */
function noteFor(marks: readonly { index: number; note?: string }[], index: number): string | undefined {
  return marks.filter((m) => m.index === index).find((m) => m.note !== undefined)?.note
}

function noteAt(
  marks: readonly { row: number; col: number; note?: string }[],
  row: number,
  col: number,
): string | undefined {
  return marks.filter((m) => m.row === row && m.col === col).find((m) => m.note !== undefined)?.note
}

/**
 * The `title` prop for a cell, present only when a mark at that index carries a note.
 *
 * `mark(index, class, note)` has stored notes since the tracer was written and only `ArrayViz` and
 * `GridViz` ever rendered them, so every note a stack, queue, heap, set, map or intervals solution
 * attached was dead text — including ones written specifically to explain why a cell was excluded.
 * Spread rather than passed, so `title` stays absent under `exactOptionalPropertyTypes`.
 */
function titleOf(
  marks: readonly { index: number; note?: string }[],
  index: number,
): { title?: string } {
  const note = noteFor(marks, index)
  return note === undefined ? {} : { title: note }
}

/**
 * Assign each cursor a vertical lane so two pointers at the same index stay legible.
 *
 * A two-pointer scan spends its most interesting moment with `left` and `right` adjacent or
 * equal; overprinting the labels exactly then would hide the payoff.
 */
function laneFor(cursors: readonly Cursor[]): Map<string, number> {
  const lanes = new Map<string, number>()
  const usedByIndex = new Map<number, number>()
  for (const c of cursors) {
    const used = usedByIndex.get(c.index) ?? 0
    lanes.set(c.name, used)
    usedByIndex.set(c.index, used + 1)
  }
  return lanes
}

const MAX_RENDERED = 240

/**
 * The window outline is drawn 3px outside the cell box with a 2px stroke, so it needs 4px of room.
 *
 * An outermost `<svg>` clips, and this one starts at (0,0) with no `viewBox` — so the band's top
 * edge was drawn at y=-4 and never appeared at all, and its left edge vanished too whenever the
 * window started at index 0, which is the first frame of every sliding-window animation. It
 * rendered as a three-sided bracket rather than a box. jsdom has no layout, so the DOM test that
 * counts outline rects passed throughout.
 */
const WINDOW_PAD = 4

function visibleRange(
  length: number,
  cursors: readonly Cursor[],
  window?: readonly [number, number],
): [number, number] {
  if (length <= MAX_RENDERED) return [0, length]
  // Keep the cursors *and the window* on screen; a huge array is only interesting near them. A
  // sliding-window solution uses the band instead of carets — that is what the band is for — so
  // anchoring on cursors alone pinned the viewport to indices 0..239 forever, and past index 200
  // the band slid off the rendered region and the panel stopped changing for the rest of the run.
  const anchors = [...cursors.map((c) => c.index), ...(window ?? [])]
  const focus =
    anchors.length > 0 ? Math.round(anchors.reduce((sum, i) => sum + i, 0) / anchors.length) : 0
  const start = Math.max(0, Math.min(length - MAX_RENDERED, focus - Math.floor(MAX_RENDERED / 2)))
  return [start, start + MAX_RENDERED]
}

export function ArrayViz({ snapshot }: { snapshot: Of<'array'> }): ReactNode {
  const { values, cursors, marks, window: win } = snapshot
  if (values.length === 0) return <EmptyState what="array" />

  const [from, to] = visibleRange(values.length, cursors, win)
  const lanes = laneFor(cursors)
  // One extra slot so a caret parked one past the last element has somewhere to be drawn.
  const restingCaret = cursors.some((c) => c.index === to)
  // `WINDOW_PAD` on each axis so the window outline, which is drawn outside the cell box, is inside
  // the viewport rather than clipped away by it.
  const width = WINDOW_PAD * 2 + (to - from + (restingCaret ? 1 : 0)) * (CELL + GAP)
  const cursorLanes = Math.max(1, new Set(cursors.map((c) => c.index)).size > 0 ? Math.max(...[...lanes.values()]) + 1 : 1)
  const height = WINDOW_PAD + CELL + 22 + cursorLanes * 16 + 8

  return (
    <Scroll>
      {from > 0 || to < values.length ? (
        <p className="av-truncated" data-testid="array-windowed">
          showing indices {from}–{to - 1} of {values.length}
        </p>
      ) : null}
      <svg width={Math.max(width, 40)} height={height} role="img" aria-label="array">
        {/* Every internal coordinate stays as it was; the whole drawing just moves inside the pad,
            so layout determinism and the existing data-* assertions are untouched. */}
        <g transform={`translate(${WINDOW_PAD}, ${WINDOW_PAD})`}>
        {values.slice(from, to).map((value, i) => {
          const index = from + i
          return (
            <Cell
              key={index}
              x={i * (CELL + GAP)}
              y={0}
              value={value}
              marks={marksAt(marks, index)}
              indexLabel={String(index)}
              nodeId={String(index)}
              inWindow={win ? index >= win[0] && index <= win[1] : false}
            />
          )
        })}
        {/*
          `<= to` rather than `< to`: a caret resting one past the last element is the normal
          terminal state of any `while (i < n)` loop, so filtering it out blanked the pointers on
          the final frame of every array and string problem. It renders in the slot just beyond
          the last cell, which reads as "past the end" rather than as a phantom cell.
        */}
        {cursors
          .filter((c) => c.index >= from && c.index <= to)
          .map((c) => (
            <Caret
              key={c.name}
              x={(c.index - from) * (CELL + GAP) + CELL / 2}
              y={CELL + 18}
              name={c.name}
              lane={lanes.get(c.name) ?? 0}
              {...(c.class ? { cls: c.class } : {})}
            />
          ))}
        </g>
      </svg>
    </Scroll>
  )
}

export function StringViz({ snapshot }: { snapshot: Of<'string'> }): ReactNode {
  const chars = [...snapshot.value]
  return (
    <ArrayViz
      snapshot={{
        kind: 'array',
        values: chars,
        cursors: snapshot.cursors,
        marks: snapshot.marks,
      }}
    />
  )
}

export function StackViz({ snapshot }: { snapshot: Of<'stack'> }): ReactNode {
  const { values, marks } = snapshot
  if (values.length === 0) return <EmptyState what="stack" />
  const height = values.length * (CELL + GAP) + 20

  return (
    <Scroll>
      <svg width={CELL + 70} height={height} role="img" aria-label="stack">
        {/* Rendered top-down so `push` visibly adds at the top, as on a whiteboard. */}
        {[...values].reverse().map((value, i) => {
          const index = values.length - 1 - i
          return (
            <g key={index}>
              <Cell
                x={0}
                y={i * (CELL + GAP)}
                value={value}
                marks={marksAt(marks, index)}
                nodeId={String(index)}
                {...titleOf(marks, index)}
              />
              {index === values.length - 1 ? (
                <text
                  x={CELL + 8}
                  y={i * (CELL + GAP) + CELL / 2}
                  dominantBaseline="central"
                  fontSize={11}
                  fill="var(--av-accent)"
                  data-testid="stack-top"
                >
                  ← top
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
    </Scroll>
  )
}

export function QueueViz({ snapshot }: { snapshot: Of<'queue'> }): ReactNode {
  const { values, marks, deque } = snapshot
  if (values.length === 0) return <EmptyState what={deque ? 'deque' : 'queue'} />
  const width = values.length * (CELL + GAP)

  return (
    <Scroll>
      <svg width={Math.max(width, 40)} height={CELL + 26} role="img" aria-label={deque ? 'deque' : 'queue'}>
        {values.map((value, index) => (
          <Cell
            key={index}
            x={index * (CELL + GAP)}
            y={0}
            value={value}
            marks={marksAt(marks, index)}
            nodeId={String(index)}
            {...titleOf(marks, index)}
          />
        ))}
        <text x={CELL / 2} y={CELL + 16} textAnchor="middle" fontSize={10} fill="var(--av-accent)" data-testid="queue-front">
          front
        </text>
        {values.length > 1 ? (
          <text
            x={(values.length - 1) * (CELL + GAP) + CELL / 2}
            y={CELL + 16}
            textAnchor="middle"
            fontSize={10}
            fill="var(--av-text-dim)"
            data-testid="queue-back"
          >
            back
          </text>
        ) : null}
      </svg>
    </Scroll>
  )
}

/**
 * A heap, shown as its array *and* the tree that array implies.
 *
 * Pairing the two views is the whole point: a heap only stops feeling like magic once you can
 * see that `values[2*i+1]` is literally the left child.
 */
export function HeapViz({ snapshot }: { snapshot: Of<'heap'> }): ReactNode {
  const { values, marks, comparatorLabel } = snapshot
  if (values.length === 0) return <EmptyState what="heap" />

  const depth = Math.floor(Math.log2(values.length)) + 1
  const treeWidth = Math.max(2 ** (depth - 1) * (CELL + GAP), CELL)
  const treeHeight = depth * (CELL + 28)

  const position = (index: number): { x: number; y: number } => {
    const level = Math.floor(Math.log2(index + 1))
    const levelStart = 2 ** level - 1
    const slots = 2 ** level
    const slot = index - levelStart
    const bandWidth = treeWidth / slots
    return { x: bandWidth * (slot + 0.5) - CELL / 2, y: level * (CELL + 28) }
  }

  return (
    <Scroll>
      <p className="av-truncated">{comparatorLabel}</p>
      <svg width={Math.max(values.length * (CELL + GAP), 40)} height={CELL + 22} role="img" aria-label="heap as array">
        {values.map((value, index) => (
          <Cell
            key={index}
            x={index * (CELL + GAP)}
            y={0}
            value={value}
            marks={marksAt(marks, index)}
            indexLabel={String(index)}
            nodeId={String(index)}
            {...titleOf(marks, index)}
          />
        ))}
      </svg>
      <svg width={treeWidth} height={treeHeight} role="img" aria-label="heap as tree">
        {values.map((_, index) => {
          const parent = (index - 1) >> 1
          if (index === 0) return null
          const a = position(parent)
          const b = position(index)
          return (
            <line
              key={`e${index}`}
              x1={a.x + CELL / 2}
              y1={a.y + CELL}
              x2={b.x + CELL / 2}
              y2={b.y}
              stroke="var(--av-edge)"
              strokeWidth={1.5}
            />
          )
        })}
        {values.map((value, index) => {
          const { x, y } = position(index)
          return (
            <Cell
              key={index}
              x={x}
              y={y}
              value={value}
              marks={marksAt(marks, index)}
              nodeId={`tree-${index}`}
              {...titleOf(marks, index)}
            />
          )
        })}
      </svg>
    </Scroll>
  )
}

export function SetViz({ snapshot }: { snapshot: Of<'set'> }): ReactNode {
  const { values, marks } = snapshot
  if (values.length === 0) return <EmptyState what="set" />
  const width = values.length * (CELL + GAP)

  return (
    <Scroll>
      <svg width={Math.max(width, 40)} height={CELL + 8} role="img" aria-label="set">
        {values.map((value, index) => (
          <Cell
            key={index}
            x={index * (CELL + GAP)}
            y={0}
            value={value}
            marks={marksAt(marks, index)}
            nodeId={String(index)}
            {...titleOf(marks, index)}
          />
        ))}
      </svg>
    </Scroll>
  )
}

export function MapViz({ snapshot }: { snapshot: Of<'map'> }): ReactNode {
  const { entries, marks } = snapshot
  if (entries.length === 0) return <EmptyState what="map" />

  return (
    <Scroll>
      <table className="av-map" data-testid="map-table">
        <thead>
          <tr>
            <th>key</th>
            <th>value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const entryMarks = marks.filter((m) => m.key === entry.key)
            const cls = entryMarks[entryMarks.length - 1]?.class
            // `Cell` exempts the two dim classes from the near-black text it uses on bright fills;
            // this table did not, and it does not go through `Cell`. Measured against the dark
            // theme that put `#12141a` on `excluded` at 1.94:1 and on `visited` at 3.05:1, versus
            // 7.74:1 and 4.92:1 for the same classes inside `Cell` — so on a problem whose answer
            // *is* the excluded rows, those rows were the least legible in the table. The
            // line-through is the same second signal the grid's excluded cells get, for the same
            // reason: `excluded` and `visited` are 1.57:1 apart, so fill cannot carry it alone.
            const isDim = cls === 'visited' || cls === 'excluded'
            // Map marks are keyed, not indexed, so `titleOf` does not apply — but the note is just
            // as dead without this. A row's tooltip is the only place a map entry can explain why
            // it is marked.
            const note = entryMarks.find((m) => m.note !== undefined)?.note
            return (
              <tr
                key={entry.key}
                data-node-id={entry.key}
                {...(note !== undefined ? { title: note } : {})}
                data-highlight={entryMarks.length > 0 ? entryMarks.map((m) => m.class).join(' ') : undefined}
                style={
                  cls
                    ? {
                        background: `var(--av-${cls})`,
                        color: isDim ? 'var(--av-text)' : '#12141a',
                        ...(cls === 'excluded' ? { textDecoration: 'line-through' } : {}),
                      }
                    : undefined
                }
              >
                <td>{entry.key}</td>
                <td>{typeof entry.value === 'object' ? JSON.stringify(entry.value) : display(entry.value as never)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Scroll>
  )
}

function GridViz({
  values,
  marks,
  cursors,
  label,
  rowLabels,
  colIndexLabels,
  axisLabels,
}: {
  values: readonly (readonly unknown[])[]
  marks: readonly { row: number; col: number; class: never }[]
  cursors?: readonly { name: string; row: number; col: number }[]
  label: string
  rowLabels?: boolean
  /**
   * Label each column, in a header row *above* the grid.
   *
   * It used to be drawn under the bottom row, which is fine for a one-row 1-D table and wrong for
   * a tall one: the column numbers sat hundreds of pixels below row 1, labelling columns at the
   * end of their axis while rows were labelled at the start of theirs.
   */
  colIndexLabels?: boolean
  /**
   * What the axes mean: `[rowsString, colsString]`, one character per cell.
   *
   * `viz.dp2d` has accepted `axisLabels` since it was written and **nothing ever read it** — the
   * snapshot carried both strings and neither the SVG nor the MCP renderer mentioned them. On a
   * Longest Common Subsequence table that left a separate `viz.string` panel and two carets as the
   * only thing telling a viewer what row 3 stands for.
   */
  axisLabels?: readonly [string, string]
}): ReactNode {
  const rows = values.length
  const cols = values[0]?.length ?? 0
  if (rows === 0 || cols === 0) return <EmptyState what={label} />

  const gutter = rowLabels === true || axisLabels !== undefined
  const header = colIndexLabels === true || axisLabels !== undefined
  const offsetX = gutter ? 26 : 0
  const headerH = header ? 16 : 0
  const width = cols * (CELL + GAP) + offsetX
  const height = headerH + rows * (CELL + GAP) + 16
  // Row 0 and column 0 of a dp table are the empty-prefix base cases, so character k of an axis
  // string labels row/column k+1. Undefined for the base row and column, which then fall through
  // to the numeric label below — the base cases keep their index, which is what they stand for.
  const axisChar = (axis: 0 | 1, i: number): string | undefined => axisLabels?.[axis]?.[i - 1]

  return (
    <Scroll>
      <svg width={width} height={height} role="img" aria-label={label}>
        {values.map((row, r) =>
          row.map((value, c) => (
            <Cell
              key={`${r}-${c}`}
              x={offsetX + c * (CELL + GAP)}
              y={headerH + r * (CELL + GAP)}
              value={value as never}
              marks={marksAtCell(marks as never, r, c)}
              nodeId={`${r},${c}`}
              title={noteAt(marks as never, r, c) ?? `(${r}, ${c})`}
            />
          )),
        )}
        {header
          ? (values[0] ?? []).map((_, c) => (
              <text
                key={`cl${c}`}
                x={offsetX + c * (CELL + GAP) + CELL / 2}
                y={headerH - 5}
                textAnchor="middle"
                fontSize={10}
                fill="var(--av-text-dim)"
                data-testid={`grid-col-label-${c}`}
              >
                {axisChar(1, c) ?? (colIndexLabels === true ? String(c) : '')}
              </text>
            ))
          : null}
        {gutter
          ? values.map((_, r) => (
              <text
                key={`rl${r}`}
                x={offsetX - 8}
                y={headerH + r * (CELL + GAP) + CELL / 2}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={10}
                fill="var(--av-text-dim)"
                data-testid={`grid-row-label-${r}`}
              >
                {axisChar(0, r) ?? (rowLabels === true ? String(r) : '')}
              </text>
            ))
          : null}
        {(cursors ?? []).map((c) => (
          <rect
            key={c.name}
            x={offsetX + c.col * (CELL + GAP) - 2}
            y={headerH + c.row * (CELL + GAP) - 2}
            width={CELL + 4}
            height={CELL + 4}
            rx={7}
            fill="none"
            stroke="var(--av-accent)"
            strokeWidth={2}
            data-testid={`cursor-${c.name}`}
          />
        ))}
      </svg>
    </Scroll>
  )
}

export function MatrixViz({ snapshot }: { snapshot: Of<'matrix'> }): ReactNode {
  return (
    <GridViz
      values={snapshot.values}
      marks={snapshot.marks as never}
      cursors={snapshot.cursors}
      label="grid"
      rowLabels
    />
  )
}

export function DpViz({ snapshot }: { snapshot: Of<'dp'> }): ReactNode {
  const values = snapshot.dims === 1 ? [snapshot.values as unknown[]] : (snapshot.values as unknown[][])
  return (
    <GridViz
      values={values}
      marks={snapshot.marks as never}
      label="dp table"
      rowLabels={snapshot.dims === 2}
      colIndexLabels
      {...(snapshot.axisLabels ? { axisLabels: snapshot.axisLabels } : {})}
    />
  )
}

/** Interval list on a shared numeric axis, greedily packed into lanes. */
export function IntervalsViz({ snapshot }: { snapshot: Of<'intervals'> }): ReactNode {
  const { items, marks } = snapshot
  if (items.length === 0) return <EmptyState what="interval list" />

  const min = Math.min(...items.map((i) => i.start))
  const max = Math.max(...items.map((i) => i.end))
  const span = Math.max(1, max - min)
  const width = 560
  const laneHeight = 26
  const scale = (v: number): number => ((v - min) / span) * (width - 20) + 10

  // Greedy lane packing: first lane whose last interval ends before this one starts.
  const laneEnds: number[] = []
  const lanes = items.map((item) => {
    const lane = laneEnds.findIndex((end) => end <= item.start)
    const chosen = lane === -1 ? laneEnds.length : lane
    laneEnds[chosen] = item.end
    return chosen
  })
  const height = (Math.max(...lanes) + 1) * laneHeight + 26

  return (
    <Scroll>
      <svg width={width} height={height} role="img" aria-label="intervals">
        {items.map((item, index) => {
          const itemMarks = marks.filter((m) => m.index === index)
          const cls = itemMarks[itemMarks.length - 1]?.class
          const x = scale(item.start)
          const w = Math.max(4, scale(item.end) - x)
          return (
            <g
              key={item.id}
              data-node-id={item.id}
              data-highlight={itemMarks.length > 0 ? itemMarks.map((m) => m.class).join(' ') : undefined}
            >
              {noteFor(marks, index) !== undefined ? <title>{noteFor(marks, index)}</title> : null}
              <rect
                x={x}
                y={(lanes[index] ?? 0) * laneHeight}
                width={w}
                height={laneHeight - 6}
                rx={4}
                fill={cls ? `var(--av-${cls})` : 'var(--av-cell-bg)'}
              />
              <text
                x={x + w / 2}
                y={(lanes[index] ?? 0) * laneHeight + (laneHeight - 6) / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={10}
                fill={cls ? '#12141a' : 'var(--av-cell-text)'}
              >
                {item.start}–{item.end}
              </text>
            </g>
          )
        })}
        <line
          x1={10}
          y1={height - 16}
          x2={width - 10}
          y2={height - 16}
          stroke="var(--av-border)"
        />
        <text x={10} y={height - 4} fontSize={10} fill="var(--av-text-dim)">
          {min}
        </text>
        <text x={width - 10} y={height - 4} textAnchor="end" fontSize={10} fill="var(--av-text-dim)">
          {max}
        </text>
      </svg>
    </Scroll>
  )
}
