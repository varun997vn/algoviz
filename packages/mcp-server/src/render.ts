import {
  TraceReader,
  type Frame,
  type StructureSnapshot,
  type Trace,
} from '@algoviz/tracer'

/**
 * Compact text rendering of trace state.
 *
 * The MCP tools return diagrams, not JSON dumps. An agent asking "what does frame 12 look
 * like?" needs to *see* the array with its pointers, and a 40 KB JSON blob of a snapshot burns
 * context without conveying the picture. `height: [1 8* 6 …] ↑left=1 ↑right=6` does.
 */

const MARK_GLYPH: Record<string, string> = {
  active: '*',
  compare: '?',
  swap: '~',
  visited: '.',
  frontier: '+',
  path: ':',
  result: '#',
  match: '=',
  excluded: 'x',
  pinned: '!',
}

function glyphs(marks: readonly { class: string }[]): string {
  return marks.map((m) => MARK_GLYPH[m.class] ?? '?').join('')
}

function cell(value: unknown, marks: readonly { class: string }[]): string {
  const text = value === null ? '_' : String(value)
  // Quote anything that isn't a plain number: cells are space-separated, so a coordinate like
  // "(1,1)" or any value containing a space would otherwise read as two cells.
  const safe = /^-?\d+(\.\d+)?$/.test(text) || text === '_' ? text : JSON.stringify(text)
  return `${safe}${glyphs(marks)}`
}

export function renderSnapshot(name: string, snapshot: StructureSnapshot): string {
  switch (snapshot.kind) {
    case 'array': {
      const cells = snapshot.values.map((v, i) =>
        cell(v, snapshot.marks.filter((m) => m.index === i)),
      )
      const cursors = snapshot.cursors.map((c) => `${c.name}=${c.index}`).join(' ')
      const win = snapshot.window ? ` window ${snapshot.window[0]}..${snapshot.window[1]}` : ''
      return `${name}: [${cells.join(' ')}]${cursors ? `  ${cursors}` : ''}${win}`
    }
    case 'string': {
      const chars = [...snapshot.value].map((ch, i) =>
        cell(ch, snapshot.marks.filter((m) => m.index === i)),
      )
      const cursors = snapshot.cursors.map((c) => `${c.name}=${c.index}`).join(' ')
      return `${name}: "${chars.join('')}"${cursors ? `  ${cursors}` : ''}`
    }
    case 'stack':
      return `${name} (stack, top right): [${snapshot.values
        .map((v, i) => cell(v, snapshot.marks.filter((m) => m.index === i)))
        .join(' ')}]`
    case 'queue':
      return `${name} (${snapshot.deque ? 'deque' : 'queue'}, front left): [${snapshot.values
        .map((v, i) => cell(v, snapshot.marks.filter((m) => m.index === i)))
        .join(' ')}]`
    case 'set':
      return `${name} (set): {${snapshot.values
        .map((v, i) => cell(v, snapshot.marks.filter((m) => m.index === i)))
        .join(' ')}}`
    case 'heap':
      return `${name} (${snapshot.comparatorLabel}): [${snapshot.values
        .map((v, i) => cell(v, snapshot.marks.filter((m) => m.index === i)))
        .join(' ')}]`
    case 'map':
      return `${name} (map): {${snapshot.entries
        .map((e) => `${e.key}: ${JSON.stringify(e.value)}${glyphs(snapshot.marks.filter((m) => m.key === e.key))}`)
        .join(', ')}}`
    case 'matrix':
    case 'dp': {
      const rows =
        snapshot.kind === 'matrix'
          ? snapshot.values
          : snapshot.dims === 1
            ? [snapshot.values as unknown[]]
            : (snapshot.values as unknown[][])
      const lines = rows.map((row, r) =>
        `  ${(row as unknown[])
          .map((v, c) => cell(v, snapshot.marks.filter((m) => m.row === r && m.col === c)))
          .join(' ')}`,
      )
      const cursors =
        snapshot.kind === 'matrix'
          ? snapshot.cursors.map((c) => `${c.name}=(${c.row},${c.col})`).join(' ')
          : ''
      return `${name} (${snapshot.kind}):${cursors ? ` ${cursors}` : ''}\n${lines.join('\n')}`
    }
    case 'intervals':
      return `${name} (intervals): ${snapshot.items
        .map((item, i) => `[${item.start},${item.end}]${glyphs(snapshot.marks.filter((m) => m.index === i))}`)
        .join(' ')}`
    case 'tree': {
      const byId = new Map(snapshot.nodes.map((n) => [n.id, n]))
      const lines: string[] = []
      const walk = (id: string | null, depth: number, side: string): void => {
        if (id === null) return
        const node = byId.get(id)
        if (!node) return
        const nodeMarks = snapshot.marks.filter((m) => m.id === id)
        lines.push(`  ${'  '.repeat(depth)}${side}${String(node.value)}${glyphs(nodeMarks)}`)
        walk(node.left, depth + 1, 'L ')
        walk(node.right, depth + 1, 'R ')
      }
      walk(snapshot.root, 0, '')
      const edges = snapshot.edgeMarks.map((e) => `${e.from}->${e.to}:${e.class}`).join(' ')
      return `${name} (tree):\n${lines.join('\n')}${edges ? `\n  edges: ${edges}` : ''}`
    }
    case 'graph': {
      const nodes = snapshot.nodes
        .map((n) => `${n.label}${glyphs(snapshot.marks.filter((m) => m.id === n.id))}`)
        .join(' ')
      const arrow = snapshot.directed ? '->' : '--'
      const edges = snapshot.edges
        .map((e) => {
          const mark = snapshot.edgeMarks.find(
            (m) => (m.from === e.from && m.to === e.to) || (m.from === e.to && m.to === e.from),
          )
          const weight = e.weight === undefined ? '' : `(${e.weight})`
          return `${e.from}${arrow}${e.to}${weight}${mark ? `:${mark.class}` : ''}`
        })
        .join(' ')
      return `${name} (graph): nodes ${nodes}\n  edges ${edges}`
    }
    case 'trie': {
      const byId = new Map(snapshot.nodes.map((n) => [n.id, n]))
      const lines: string[] = []
      const walk = (id: string, depth: number): void => {
        const node = byId.get(id)
        if (!node) return
        if (depth > 0) {
          const marks = snapshot.marks.filter((m) => m.id === id)
          lines.push(`  ${'  '.repeat(depth - 1)}${node.char}${node.terminal ? '.' : ''}${glyphs(marks)}`)
        }
        for (const child of node.children) walk(child, depth + 1)
      }
      walk(snapshot.root, 0)
      return `${name} (trie):\n${lines.join('\n')}`
    }
    case 'list': {
      const byId = new Map(snapshot.nodes.map((n) => [n.id, n]))
      const parts: string[] = []
      const seen = new Set<string>()
      let cursor = snapshot.head
      while (cursor !== null && !seen.has(cursor)) {
        seen.add(cursor)
        const node = byId.get(cursor)
        if (!node) break
        parts.push(`${String(node.value)}${glyphs(snapshot.marks.filter((m) => m.id === cursor))}`)
        cursor = node.next
      }
      const cycle = cursor !== null ? ` (cycle back to ${cursor})` : ''
      const detached = snapshot.nodes.filter((n) => !seen.has(n.id))
      const cursors = snapshot.cursors.map((c) => `${c.name}->${c.id ?? 'null'}`).join(' ')
      // Detached nodes get their mark glyphs too, and their real `next`. Without the glyphs a
      // rewire frame rendered identically to the frame before it, so the one frame whose whole
      // purpose was the rewire looked like a duplicate — which is how a genuine arrow bug in
      // ListViz shipped past its author, who was reading this output.
      const detachedText = detached
        .map((n) => {
          const target = n.next === null ? '' : `->${n.next}`
          return `${String(n.value)}${glyphs(snapshot.marks.filter((m) => m.id === n.id))}${target}`
        })
        .join(' ')
      return (
        `${name} (list): ${parts.join(' -> ')}${cycle}` +
        (detached.length > 0 ? `  detached: ${detachedText}` : '') +
        (cursors ? `  ${cursors}` : '')
      )
    }
  }
}

export const MARK_LEGEND = Object.entries(MARK_GLYPH)
  .map(([name, glyph]) => `${glyph}=${name}`)
  .join(' ')

export function renderFrame(trace: Trace, index: number): string {
  const reader = new TraceReader(trace)
  const frame = reader.frame(index)
  if (!frame) return `Frame ${index} does not exist (trace has ${trace.frames.length} frames).`

  const world = reader.at(index)
  const byId = new Map(trace.structures.map((s) => [s.id, s]))
  const lines = [
    `frame ${index}/${trace.frames.length - 1}  op=${frame.op}${frame.label ? `  "${frame.label}"` : ''}`,
  ]
  if (frame.groups.length > 0) lines.push(`groups: ${frame.groups.join(' > ')}`)
  if (frame.line !== undefined) lines.push(`source line: ${frame.line}`)

  for (const [id, snapshot] of world) {
    lines.push(renderSnapshot(byId.get(id)?.name ?? id, snapshot))
  }

  const watch = reader.watchAt(index)
  if (watch) {
    lines.push(`watch: ${Object.entries(watch).map(([k, v]) => `${k}=${String(v)}`).join(' ')}`)
  }
  lines.push(`legend: ${MARK_LEGEND}`)
  return lines.join('\n')
}

/** One line per frame for a single structure — the fastest way to spot a stuck pointer. */
export function renderTimeline(trace: Trace, structureId: string, from: number, to: number): string {
  const reader = new TraceReader(trace)
  const name = trace.structures.find((s) => s.id === structureId)?.name ?? structureId
  const lines: string[] = []
  for (let i = from; i <= Math.min(to, trace.frames.length - 1); i += 1) {
    const snapshot = reader.structureAt(structureId, i)
    if (!snapshot) continue
    lines.push(`${String(i).padStart(5)}  ${renderSnapshot(name, snapshot).replace(/\n/g, ' | ')}`)
  }
  return lines.length > 0 ? lines.join('\n') : `No snapshots for "${structureId}" in that range.`
}

export function renderOps(trace: Trace, from: number, to: number): string {
  return trace.frames
    .slice(from, to + 1)
    .map((f: Frame) => {
      const scope = f.groups.length > 0 ? ` [${f.groups.join(' > ')}]` : ''
      return `${String(f.index).padStart(5)}  ${f.op.padEnd(8)}${f.label ?? ''}${scope}`
    })
    .join('\n')
}

/**
 * The `viz.group` tree with the frame range each scope covers.
 *
 * Scopes are tracked as a *stack*, not as a map keyed by label path. Keyed by label, two disjoint
 * scopes that happen to share a name merged into one range that swallowed everything between them
 * — on a trie whose ops repeat, `search("app")` was reported as frames 19..46 when it was really
 * 19..25 and 40..46, silently absorbing the three calls in between. This function is how an
 * auditor navigates a trace, so a wrong range here sends the next investigation to the wrong
 * frames.
 */
export function renderGroups(trace: Trace): string {
  type Scope = { label: string; from: number; to: number; depth: number }
  const scopes: Scope[] = []
  const open: Scope[] = []

  for (const frame of trace.frames) {
    // Pop while the innermost open scope is not the one this frame is in — a mismatch at some
    // depth invalidates that depth and everything under it, and both are on top of the stack.
    while (open.length > 0) {
      const depth = open.length - 1
      if (depth < frame.groups.length && open[depth]?.label === frame.groups[depth]) break
      open.pop()
    }
    for (let depth = open.length; depth < frame.groups.length; depth += 1) {
      const entry = {
        label: frame.groups[depth] as string,
        from: frame.index,
        to: frame.index,
        depth,
      }
      open.push(entry)
      scopes.push(entry)
    }
    for (const scope of open) scope.to = frame.index
  }

  if (scopes.length === 0) return 'No viz.group() scopes in this trace.'
  return scopes
    .map(({ label, from, to, depth }) => `${'  '.repeat(depth)}${label}  frames ${from}..${to}`)
    .join('\n')
}

export function renderSummary(trace: Trace): string {
  const lines = [
    `frames: ${trace.frames.length}  recorded ops: ${trace.opCount}`,
    `structures: ${trace.structures.map((s) => `${s.name} (${s.kind}, id=${s.id})`).join(', ') || 'none'}`,
  ]
  if (trace.result) {
    lines.push(
      `returned: ${JSON.stringify(trace.result.returned)}` +
        (trace.result.expected !== undefined
          ? `  expected: ${JSON.stringify(trace.result.expected)}  passed: ${String(trace.result.passed)}`
          : ''),
    )
  }
  if (trace.truncated) lines.push(`TRUNCATED: ${trace.truncated.message}`)

  const opCounts = new Map<string, number>()
  for (const f of trace.frames) opCounts.set(f.op, (opCounts.get(f.op) ?? 0) + 1)
  // Labelled "frames by op", not "op mix": these count *frames*, and the terminal frame is
  // emitted without incrementing the op counter, so the two totals legitimately differ by one.
  // Under similar names that read as an off-by-one bug in the tool.
  lines.push(
    `frames by op: ${[...opCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([op, n]) => `${op}=${n}`)
      .join(' ')}`,
  )
  const steps = trace.frames.filter((f) => f.op === 'step').length
  lines.push(`viz.step() narrations: ${steps}`)
  return lines.join('\n')
}

/** Truncate a tool response to a byte budget rather than blowing up the caller's context. */
export function cap(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text
  return `${text.slice(0, maxBytes)}\n… truncated (${text.length - maxBytes} more characters). Narrow the range or raise maxBytes.`
}
