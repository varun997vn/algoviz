import type { EdgeMark, MarkClass, NodeId, StructureSnapshot } from '@algoviz/tracer'
import type { ReactNode } from 'react'
import { CELL, Cell, EmptyState, Scroll, display, edgeStroke, marksOnNode, markAttr, winningClass } from '../primitives.js'
import { layoutGraph, layoutTree, layoutTrie, NODE_R, type LaidOut, type Point } from '../layout.js'

type Of<K extends StructureSnapshot['kind']> = Extract<StructureSnapshot, { kind: K }>

function nodeFill(cls: MarkClass | undefined): string {
  return cls ? `var(--av-${cls})` : 'var(--av-cell-bg)'
}

function textFill(cls: MarkClass | undefined): string {
  return cls && cls !== 'visited' && cls !== 'excluded' ? '#12141a' : 'var(--av-cell-text)'
}

interface EdgeProps {
  from: Point
  to: Point
  state?: EdgeMark['class']
  directed: boolean
  weight?: number
  note?: string
  testId: string
}

function Edge({ from, to, state, directed, weight, note, testId }: EdgeProps): ReactNode {
  // Shorten to the circle boundary so an arrowhead lands on the rim, not the centre.
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const x1 = from.x + ux * NODE_R
  const y1 = from.y + uy * NODE_R
  const x2 = to.x - ux * NODE_R
  const y2 = to.y - uy * NODE_R
  const emphasised = state !== undefined && state !== 'visited'

  return (
    <g data-testid={testId} data-edge-state={state}>
      {note ? <title>{note}</title> : null}
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={edgeStroke(state)}
        strokeWidth={emphasised ? 3 : 1.5}
        strokeDasharray={state === 'rejected' ? '4 3' : undefined}
        markerEnd={directed ? `url(#av-arrow-${state ?? 'idle'})` : undefined}
      />
      {weight !== undefined ? (
        <text
          x={(x1 + x2) / 2}
          y={(y1 + y2) / 2 - 5}
          textAnchor="middle"
          fontSize={10}
          fill="var(--av-text-dim)"
        >
          {weight}
        </text>
      ) : null}
    </g>
  )
}

const ARROW_STATES = ['idle', 'active', 'tree', 'rejected', 'path', 'reversed', 'visited'] as const

function ArrowDefs(): ReactNode {
  return (
    <defs>
      {ARROW_STATES.map((state) => (
        <marker
          key={state}
          id={`av-arrow-${state}`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path
            d="M 0 0 L 10 5 L 0 10 z"
            fill={edgeStroke(state === 'idle' ? undefined : (state as EdgeMark['class']))}
          />
        </marker>
      ))}
    </defs>
  )
}

function NodeCircle({
  at,
  label,
  marks,
  id,
}: {
  at: Point
  label: string
  marks: readonly { class: MarkClass }[]
  id: NodeId
}): ReactNode {
  const cls = winningClass(marks)
  const text = label.length > 4 ? `${label.slice(0, 3)}…` : label
  return (
    <g data-node-id={id} data-highlight={markAttr(marks)} data-value={label}>
      <title>{label}</title>
      <circle cx={at.x} cy={at.y} r={NODE_R} fill={nodeFill(cls)} stroke="var(--av-border)" strokeWidth={1.5} />
      <text
        x={at.x}
        y={at.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={text.length > 2 ? 10 : 13}
        fontWeight={cls ? 700 : 500}
        fill={textFill(cls)}
      >
        {text}
      </text>
    </g>
  )
}

function Canvas({ laid, children, label }: { laid: LaidOut; children: ReactNode; label: string }): ReactNode {
  return (
    <Scroll>
      <svg
        width={Math.max(laid.width, 120)}
        height={Math.max(laid.height, 80)}
        role="img"
        aria-label={label}
      >
        <ArrowDefs />
        {children}
      </svg>
    </Scroll>
  )
}

export function TreeViz({ snapshot }: { snapshot: Of<'tree'> }): ReactNode {
  const { nodes, root, marks, edgeMarks } = snapshot
  if (nodes.length === 0 || root === null) return <EmptyState what="tree" />

  const laid = layoutTree(nodes, root)
  const edgeState = new Map(edgeMarks.map((e) => [`${e.from}->${e.to}`, e]))

  return (
    <Canvas laid={laid} label="binary tree">
      {nodes.flatMap((n) =>
        ([n.left, n.right].filter((c): c is NodeId => c !== null)).map((child) => {
          const from = laid.positions.get(n.id)
          const to = laid.positions.get(child)
          if (!from || !to) return null
          const mark = edgeState.get(`${n.id}->${child}`)
          return (
            <Edge
              key={`${n.id}-${child}`}
              from={from}
              to={to}
              directed={false}
              testId={`edge-${n.id}-${child}`}
              {...(mark ? { state: mark.class } : {})}
              {...(mark?.note ? { note: mark.note } : {})}
            />
          )
        }),
      )}
      {nodes.map((n) => {
        const at = laid.positions.get(n.id)
        if (!at) return null
        return (
          <NodeCircle key={n.id} at={at} id={n.id} label={display(n.value)} marks={marksOnNode(marks, n.id)} />
        )
      })}
    </Canvas>
  )
}

export function GraphViz({ snapshot }: { snapshot: Of<'graph'> }): ReactNode {
  const { nodes, edges, directed, marks, edgeMarks } = snapshot
  if (nodes.length === 0) return <EmptyState what="graph" />

  const laid = layoutGraph(
    nodes.map((n) => n.id),
    edges,
  )
  // Edge marks are stored under the direction the edge was declared in; look both ways so a
  // decision recorded as `next -> city` still lights up the edge drawn as `city -> next`.
  const marked = new Map<string, EdgeMark>()
  for (const e of edgeMarks) {
    marked.set(`${e.from}->${e.to}`, e)
    marked.set(`${e.to}->${e.from}`, e)
  }

  return (
    <Canvas laid={laid} label="graph">
      {edges.map((e, i) => {
        const from = laid.positions.get(e.from)
        const to = laid.positions.get(e.to)
        if (!from || !to) return null
        const mark = marked.get(`${e.from}->${e.to}`)
        // A reversed road is drawn pointing the way the algorithm decided it should go.
        const flip = mark?.class === 'reversed'
        return (
          <Edge
            key={`${e.from}-${e.to}-${i}`}
            from={flip ? to : from}
            to={flip ? from : to}
            directed={directed}
            testId={`edge-${e.from}-${e.to}`}
            {...(mark ? { state: mark.class } : {})}
            {...(mark?.note ? { note: mark.note } : {})}
            {...(e.weight !== undefined ? { weight: e.weight } : {})}
          />
        )
      })}
      {nodes.map((n) => {
        const at = laid.positions.get(n.id)
        if (!at) return null
        return <NodeCircle key={n.id} at={at} id={n.id} label={n.label} marks={marksOnNode(marks, n.id)} />
      })}
    </Canvas>
  )
}

export function TrieViz({ snapshot }: { snapshot: Of<'trie'> }): ReactNode {
  const { nodes, root, marks } = snapshot
  if (nodes.length <= 1) return <EmptyState what="trie" />

  const laid = layoutTrie(nodes, root)

  return (
    <Canvas laid={laid} label="trie">
      {nodes.flatMap((n) =>
        n.children.map((child) => {
          const from = laid.positions.get(n.id)
          const to = laid.positions.get(child)
          if (!from || !to) return null
          return <Edge key={`${n.id}-${child}`} from={from} to={to} directed={false} testId={`edge-${n.id}-${child}`} />
        }),
      )}
      {nodes.map((n) => {
        const at = laid.positions.get(n.id)
        if (!at) return null
        const nodeMarks = marksOnNode(marks, n.id)
        return (
          <g key={n.id}>
            <NodeCircle at={at} id={n.id} label={n.id === root ? '·' : n.char} marks={nodeMarks} />
            {n.terminal ? (
              <circle
                cx={at.x}
                cy={at.y}
                r={NODE_R + 4}
                fill="none"
                stroke="var(--av-result)"
                strokeWidth={2}
                data-testid={`terminal-${n.id}`}
              />
            ) : null}
          </g>
        )
      })}
    </Canvas>
  )
}

/**
 * Linked list.
 *
 * Nodes unreachable from `head` are drawn on a second row: mid-reversal there is always a
 * detached node, and hiding it is exactly when a linked-list animation stops explaining
 * anything. A cycle renders as an arc back-edge rather than hanging the renderer.
 */
export function ListViz({ snapshot }: { snapshot: Of<'list'> }): ReactNode {
  const { nodes, head, marks, cursors } = snapshot
  if (nodes.length === 0) return <EmptyState what="list" />

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const chain: typeof nodes = []
  const seen = new Set<NodeId>()
  let cursor = head
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor)
    const node = byId.get(cursor)
    if (!node) break
    chain.push(node)
    cursor = node.next
  }
  const cycleTo = cursor !== null && seen.has(cursor) ? cursor : null
  const detached = nodes.filter((n) => !seen.has(n.id))

  const step = CELL + 34
  const rowY = 24
  const detachedY = rowY + CELL + 54
  const width = Math.max(chain.length, detached.length) * step + 20
  const height = detachedY + (detached.length > 0 ? CELL + 30 : 0)
  const xOf = (i: number): number => i * step

  const cursorsByNode = new Map<NodeId, string[]>()
  for (const c of cursors) {
    if (c.id === null) continue
    cursorsByNode.set(c.id, [...(cursorsByNode.get(c.id) ?? []), c.name])
  }

  const renderRow = (row: typeof nodes, y: number, prefix: string): ReactNode[] =>
    row.flatMap((n, i) => {
      const x = xOf(i)
      const items: ReactNode[] = [
        <Cell
          key={`${prefix}${n.id}`}
          x={x}
          y={y}
          value={n.value}
          marks={marksOnNode(marks, n.id)}
          nodeId={n.id}
        />,
      ]
      const names = cursorsByNode.get(n.id)
      if (names) {
        items.push(
          <text
            key={`${prefix}c${n.id}`}
            x={x + CELL / 2}
            y={y - 8}
            textAnchor="middle"
            fontSize={10}
            fill="var(--av-accent)"
            data-testid={`cursor-${names.join('-')}`}
          >
            {names.join(', ')}
          </text>,
        )
      }
      if (i < row.length - 1) {
        items.push(
          <line
            key={`${prefix}e${n.id}`}
            x1={x + CELL}
            y1={y + CELL / 2}
            x2={x + step - 6}
            y2={y + CELL / 2}
            stroke="var(--av-edge)"
            strokeWidth={1.5}
            markerEnd="url(#av-arrow-idle)"
          />,
        )
      }
      return items
    })

  return (
    <Scroll>
      <svg width={width} height={height} role="img" aria-label="linked list">
        <ArrowDefs />
        {renderRow(chain, rowY, '')}
        {cycleTo !== null ? (
          <path
            d={`M ${xOf(chain.length - 1) + CELL / 2} ${rowY + CELL} Q ${xOf(chain.length - 1) / 2} ${rowY + CELL + 44} ${xOf(chain.findIndex((n) => n.id === cycleTo)) + CELL / 2} ${rowY + CELL}`}
            fill="none"
            stroke="var(--av-swap)"
            strokeWidth={2}
            markerEnd="url(#av-arrow-reversed)"
            data-testid="list-cycle"
          />
        ) : null}
        {detached.length > 0 ? (
          <>
            <text x={0} y={detachedY - 10} fontSize={10} fill="var(--av-text-dim)" data-testid="list-detached-label">
              detached
            </text>
            {renderRow(detached, detachedY, 'd')}
          </>
        ) : null}
        {chain.length > 0 ? (
          <text x={0} y={rowY - 10} fontSize={10} fill="var(--av-accent)" data-testid="list-head">
            head
          </text>
        ) : null}
      </svg>
    </Scroll>
  )
}
