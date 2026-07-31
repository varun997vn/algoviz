import type { EdgeMark, NodeId } from './types.js'

/**
 * Which mark applies to the edge drawn from `from` to `to`.
 *
 * One rule, in one place, because there is more than one renderer and they drifted. `GraphViz`
 * folded `edgeMarks` into a `Map` (last entry wins) while the MCP text renderer used `.find()`
 * (first entry wins) — and a snapshot lists persistent marks before the transient ones, so on any
 * frame where an edge carried both a settled state and the `active` highlight of the walk
 * considering it, the SVG showed `active` and `trace_inspect` reported the settled state. That is
 * the worst possible place for a disagreement: `trace_inspect` is the channel every audit reads
 * its evidence from, so it could report an edge state the user was not being shown.
 *
 * The transient mark wins. It is the "right now" state, it is what the frame is *about*, and it
 * lasts exactly one frame — after which the settled state underneath it is what shows.
 *
 * `undirected` folds `b->a` onto `a->b`, because an undirected edge is stored once and a walk down
 * it in either direction is a decision about the same drawn line. A directed graph must not fold:
 * `a->b` and `b->a` are two different edges there, and mirroring meant marking one lit both.
 */
export function edgeMarkFor(
  edgeMarks: readonly EdgeMark[],
  from: NodeId,
  to: NodeId,
  directed: boolean,
): EdgeMark | undefined {
  let found: EdgeMark | undefined
  for (const m of edgeMarks) {
    const hit =
      (m.from === from && m.to === to) || (!directed && m.from === to && m.to === from)
    if (hit && (found === undefined || m.transient === true)) found = m
  }
  return found
}
