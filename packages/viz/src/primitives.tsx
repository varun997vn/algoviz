import type { EdgeState, Mark, Mark2D, MarkClass, NodeMark, Primitive } from '@algoviz/tracer'
import type { ReactNode } from 'react'

export const CELL = 44
export const GAP = 6

/**
 * Resolve the winning mark class for an element.
 *
 * Marks *layer* rather than replace (see `IndexMarkStore`), so a cell can legitimately carry
 * both `result` and a transient `active`. Last one wins, which matches the order the tracer
 * emits them: persistent first, this frame's transient highlight last.
 */
export function winningClass(marks: readonly { class: MarkClass }[]): MarkClass | undefined {
  return marks.length === 0 ? undefined : marks[marks.length - 1]?.class
}

export function marksAt(marks: readonly Mark[], index: number): Mark[] {
  return marks.filter((m) => m.index === index)
}

export function marksAtCell(marks: readonly Mark2D[], row: number, col: number): Mark2D[] {
  return marks.filter((m) => m.row === row && m.col === col)
}

export function marksOnNode(marks: readonly NodeMark[], id: string): NodeMark[] {
  return marks.filter((m) => m.id === id)
}

/** Space-separated class list, e.g. `"result active"` — what UI tests assert against. */
export function markAttr(marks: readonly { class: MarkClass }[]): string | undefined {
  return marks.length === 0 ? undefined : marks.map((m) => m.class).join(' ')
}

export function fillFor(cls: MarkClass | undefined): string {
  return cls ? `var(--av-${cls})` : 'var(--av-cell-bg)'
}

export function edgeStroke(state: EdgeState | undefined): string {
  return state ? `var(--av-edge-${state})` : 'var(--av-edge)'
}

export function display(value: Primitive): string {
  if (value === null) return '∅'
  if (value === undefined) return '·'
  // An empty string fell through to `String('')` and drew a completely blank cell — visually
  // identical to one holding nothing at all. On Decode String it is the *most common* value on the
  // stack: the saved prefix at every top-level `[`.
  if (value === '') return 'ε'
  if (typeof value === 'boolean') return value ? 'T' : 'F'
  if (typeof value === 'number' && !Number.isFinite(value)) return value > 0 ? '∞' : '-∞'
  return String(value)
}

/** Shrink long values so a cell never overflows rather than clipping mid-glyph. */
function fontSizeFor(text: string): number {
  if (text.length <= 2) return 16
  if (text.length <= 4) return 13
  if (text.length <= 6) return 11
  return 9
}

export interface CellProps {
  x: number
  y: number
  value: Primitive
  marks: readonly { class: MarkClass }[]
  /** Index or coordinate label rendered under the cell. */
  indexLabel?: string
  nodeId?: string
  width?: number
  height?: number
  inWindow?: boolean
  title?: string
}

export function Cell({
  x,
  y,
  value,
  marks,
  indexLabel,
  nodeId,
  width = CELL,
  height = CELL,
  inWindow,
  title,
}: CellProps): ReactNode {
  const cls = winningClass(marks)
  const full = display(value)
  // `fontSizeFor` bottoms out at 9px and there is no truncation, so a long string ran straight out
  // of its 44px cell: a 20-character value measured ~94px wide, its left end clipped away by the
  // SVG viewport and its right end printed over the `← top` label. Nine glyphs is what fits at the
  // floor size. `data-value` keeps the full string, so DOM assertions are unaffected, and the
  // tooltip falls back to it whenever the visible text was cut.
  const text = full.length > 9 ? `${full.slice(0, 8)}…` : full
  const isDim = cls === 'visited' || cls === 'excluded'
  // A note and a truncation together used to be the one combination where the value was gone from
  // the picture entirely: the note won the tooltip, and the cell showed eight glyphs of it. That is
  // exactly Decode String's stack, whose cells all carry a note *and* hold arbitrary text — it got
  // away with it only by embedding a copy of the value in the note by hand. Both, when there are
  // both, and the value first because it is the thing the cell is failing to show.
  const clipped = text === full ? undefined : full
  const tip = clipped === undefined ? title : title === undefined ? clipped : `${clipped} — ${title}`

  return (
    <g data-node-id={nodeId} data-highlight={markAttr(marks)} data-value={full}>
      {tip !== undefined ? <title>{tip}</title> : null}
      {inWindow ? (
        <rect
          x={x - 3}
          y={y - 3}
          width={width + 6}
          height={height + 6}
          rx={8}
          fill="none"
          stroke="var(--av-accent)"
          strokeWidth={2}
          strokeDasharray="4 3"
          data-testid="window-outline"
        />
      ) : null}
      <rect x={x} y={y} width={width} height={height} rx={6} fill={fillFor(cls)} />
      <text
        x={x + width / 2}
        y={y + height / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSizeFor(text)}
        fontWeight={cls && !isDim ? 700 : 500}
        fill={cls && !isDim ? '#12141a' : 'var(--av-cell-text)'}
      >
        {text}
      </text>
      {/*
        A ruled-out cell gets a slash, so `excluded` is not distinguished from `visited` by fill
        alone. Both are dim greys and on the frame `excluded` exists for — the -1 answer of a grid
        search — they are usually the only two fills present, which made retuning the grey a game of
        moving one collision onto another. `tokens.css` says hue is never the only signal; this is
        the signal that makes that true here.
      */}
      {cls === 'excluded' ? (
        <line
          x1={x + 5}
          y1={y + 5}
          x2={x + width - 5}
          y2={y + height - 5}
          stroke="var(--av-text-dim)"
          strokeWidth={2}
          strokeLinecap="round"
          data-testid="excluded-slash"
        />
      ) : null}
      {indexLabel !== undefined ? (
        <text
          x={x + width / 2}
          y={y + height + 12}
          textAnchor="middle"
          fontSize={10}
          fill="var(--av-text-dim)"
        >
          {indexLabel}
        </text>
      ) : null}
    </g>
  )
}

export interface CaretProps {
  x: number
  y: number
  name: string
  lane: number
  cls?: MarkClass
}

/**
 * A labelled pointer caret.
 *
 * Cursors are laid out in lanes so two pointers at the same index (the moment a two-pointer
 * scan converges) stay readable instead of overprinting.
 */
export function Caret({ x, y, name, lane, cls }: CaretProps): ReactNode {
  const top = y + lane * 16
  return (
    <g data-testid={`cursor-${name}`} data-cursor-name={name}>
      <path
        d={`M ${x - 5} ${top + 8} L ${x + 5} ${top + 8} L ${x} ${top} Z`}
        fill={fillFor(cls ?? 'active')}
      />
      <text x={x} y={top + 20} textAnchor="middle" fontSize={10} fill="var(--av-text-dim)">
        {name}
      </text>
    </g>
  )
}

export interface PanelProps {
  name: string
  kind: string
  children: ReactNode
  note?: string
}

export function Panel({ name, kind, children, note }: PanelProps): ReactNode {
  return (
    <section className="av-panel" data-viz-kind={kind} data-viz-name={name}>
      <header className="av-panel-head">
        <span className="av-panel-name">{name}</span>
        <span className="av-panel-kind">{kind}</span>
        {note ? <span className="av-panel-note">{note}</span> : null}
      </header>
      <div className="av-panel-body">{children}</div>
    </section>
  )
}

/** Scrollable wrapper so a wide structure scrolls itself instead of the page. */
export function Scroll({ children }: { children: ReactNode }): ReactNode {
  return <div className="av-scroll">{children}</div>
}

export function EmptyState({ what }: { what: string }): ReactNode {
  return (
    <p className="av-empty" data-testid="empty-structure">
      {what} is empty
    </p>
  )
}
