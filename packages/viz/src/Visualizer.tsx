import type { StructureKind, StructureMeta, StructureSnapshot, TraceReader } from '@algoviz/tracer'
import { memo, type ComponentType, type ReactNode } from 'react'
import { Panel } from './primitives.js'
import {
  ArrayViz,
  DpViz,
  HeapViz,
  IntervalsViz,
  MapViz,
  MatrixViz,
  QueueViz,
  SetViz,
  StackViz,
  StringViz,
} from './structures/linear.js'
import { GraphViz, ListViz, TreeViz, TrieViz } from './structures/graphs.js'

export interface VizProps<S extends StructureSnapshot> {
  snapshot: S
}

/**
 * The structure-kind → component map.
 *
 * The mapped type makes this **total**: adding a kind to `StructureKind` without adding a
 * component here is a compile error. That's the mechanism behind the promise that any data
 * structure you use gets visualized — it can't silently fall through to a blank panel.
 */
export const VISUALIZERS: {
  [K in StructureKind]: ComponentType<VizProps<Extract<StructureSnapshot, { kind: K }>>>
} = {
  array: ArrayViz,
  string: StringViz,
  matrix: MatrixViz,
  dp: DpViz,
  stack: StackViz,
  queue: QueueViz,
  heap: HeapViz,
  set: SetViz,
  map: MapViz,
  intervals: IntervalsViz,
  tree: TreeViz,
  graph: GraphViz,
  trie: TrieViz,
  list: ListViz,
}

/**
 * One structure, rendered.
 *
 * Memoised on snapshot identity. The reader returns the *same* snapshot object for a structure
 * that didn't change, so scrubbing only re-renders what actually moved.
 */
export const Visualizer = memo(function Visualizer({
  snapshot,
}: VizProps<StructureSnapshot>): ReactNode {
  const Component = VISUALIZERS[snapshot.kind] as ComponentType<VizProps<StructureSnapshot>>
  return <Component snapshot={snapshot} />
})

/**
 * A stable structural digest of what's on screen.
 *
 * UI tests assert on this instead of pixels: it changes exactly when the meaningful visual
 * state changes (values, highlights, cursors, edge states) and never because a font rendered
 * a pixel differently. That single decision is what keeps the e2e layer from being flaky.
 */
export function stageDigest(world: ReadonlyMap<string, StructureSnapshot>): string {
  const parts: string[] = []
  for (const id of [...world.keys()].sort()) {
    const snap = world.get(id)
    if (!snap) continue
    parts.push(`${id}:${snap.kind}:${digestOne(snap)}`)
  }
  return parts.join('|')
}

function digestOne(snap: StructureSnapshot): string {
  const marks =
    'marks' in snap
      ? (snap.marks as { class: string }[])
          .map((m) => {
            const record = m as unknown as Record<string, unknown>
            const where = record['index'] ?? record['id'] ?? record['key'] ?? `${String(record['row'])},${String(record['col'])}`
            return `${String(where)}=${m.class}`
          })
          .sort()
          .join(',')
      : ''

  switch (snap.kind) {
    case 'array':
    case 'string': {
      const values = snap.kind === 'array' ? snap.values.join(',') : snap.value
      const cursors = snap.cursors.map((c) => `${c.name}@${c.index}`).join(',')
      const win = snap.kind === 'array' && snap.window ? `w${snap.window[0]}-${snap.window[1]}` : ''
      return `${values};${cursors};${marks};${win}`
    }
    case 'stack':
    case 'set':
      return `${snap.values.join(',')};${marks}`
    case 'queue':
      return `${snap.values.join(',')};${marks};${snap.deque ? 'deque' : 'fifo'}`
    case 'heap':
      return `${snap.values.join(',')};${marks}`
    case 'map':
      return `${snap.entries.map((e) => `${e.key}=${JSON.stringify(e.value)}`).join(',')};${marks}`
    case 'matrix':
      return `${snap.values.map((r) => r.join(',')).join(';')};${snap.cursors.map((c) => `${c.name}@${c.row},${c.col}`).join(',')};${marks}`
    case 'dp':
      return `${JSON.stringify(snap.values)};${marks}`
    case 'intervals':
      return `${snap.items.map((i) => `${i.start}-${i.end}`).join(',')};${marks}`
    case 'tree':
      return `${snap.nodes.map((n) => `${n.id}:${String(n.value)}>${n.left ?? '_'},${n.right ?? '_'}`).join(',')};${marks};${snap.edgeMarks.map((e) => `${e.from}>${e.to}=${e.class}`).sort().join(',')}`
    case 'graph':
      return `${snap.nodes.map((n) => n.id).join(',')};${snap.edges.map((e) => `${e.from}>${e.to}`).join(',')};${marks};${snap.edgeMarks.map((e) => `${e.from}>${e.to}=${e.class}`).sort().join(',')}`
    case 'trie':
      return `${snap.nodes.map((n) => `${n.id}:${n.char}${n.terminal ? '!' : ''}`).join(',')};${marks}`
    case 'list':
      return `${snap.nodes.map((n) => `${n.id}:${String(n.value)}>${n.next ?? '_'}`).join(',')};head=${snap.head ?? '_'};${snap.cursors.map((c) => `${c.name}@${c.id ?? '_'}`).join(',')};${marks}`
  }
}

export interface StageProps {
  reader: TraceReader
  frame: number
  structures: readonly StructureMeta[]
}

/** The whole world at one frame, ordered by declaration. */
export function Stage({ reader, frame, structures }: StageProps): ReactNode {
  const world = reader.at(frame)
  const ordered = [...structures].sort((a, b) => a.order - b.order)

  return (
    <div className="av-stage" data-testid="stage" data-frame={frame} data-digest={stageDigest(world)}>
      {ordered.map((meta) => {
        const snapshot = world.get(meta.id)
        if (!snapshot) return null
        return (
          <Panel key={meta.id} name={meta.name} kind={meta.kind}>
            <Visualizer snapshot={snapshot} />
          </Panel>
        )
      })}
      {ordered.length === 0 ? (
        <p className="av-empty" data-testid="stage-empty">
          No structures yet — call <code>viz.array(...)</code> or another factory to see something here.
        </p>
      ) : null}
    </div>
  )
}
