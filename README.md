# AlgoViz

Solve the LeetCode 75 set by **writing the algorithm yourself** and watching your own code
execute, frame by frame, over a live visualization of whatever data structures it touches.

Not a gallery of pre-rendered animations. Every frame is recorded from executing *your* solution:
if your two-pointer scan moves the wrong pointer, you see the wrong pointer move.

```
┌──────────────────────────────┬────────────────────────────────────────┐
│ problem statement + hints    │  height  array                         │
│                              │  ┌───┬───┬───┬───┬───┬───┬───┬───┬───┐ │
│ your solution (CodeMirror,   │  │ 1 │ 8 │ 6 │ 2 │ 5 │ 4 │ 8 │ 3 │ 7 │ │
│ executing line highlighted)  │  └───┴───┴───┴───┴───┴───┴───┴───┴───┘ │
│                              │        ▲                       ▲       │
│ [Run] [Run reference]        │      left                    right     │
│ ✓example ✓edge ✓all-equal    │  best 49   width 6                     │
│                              │  ⏮ ⏪ ◀ ▶ ▶ ⏩ ⏭  ──────●───  39/54  1× │
└──────────────────────────────┴────────────────────────────────────────┘
```

## Quick start

```bash
pnpm install
pnpm dev            # http://localhost:5173
```

Pick a problem, write your solution, hit **Run**. Or hit **Run reference** to watch a known-good
version first. `space` plays, `←`/`→` step, `[`/`]` jump between narrated steps.

## How the visualization works

You write normal code — but declare your state through `viz`, and every read, write, push and
visit is recorded as a frame:

```ts
export default function maxArea(height: number[], viz: Viz): number {
  const h = viz.array(height, { name: 'height' })      // tracked: h[i] reads like height[i]
  const left = viz.cursor('left', 0, h)                 // a labelled caret that moves
  const right = viz.cursor('right', height.length - 1, h)
  let best = 0
  viz.watch(() => ({ best }))                           // sampled into every frame

  while (left.value < right.value) {
    const area = (right.value - left.value) * Math.min(h[left.value], h[right.value])
    if (area > best) { best = area; h.mark([left.value, right.value], 'result') }
    viz.step(`area ${area}, best ${best}`)              // narrates the timeline
    if (h[left.value] < h[right.value]) left.inc()
    else right.dec()
  }
  return best
}
```

The design rule the whole project is held to: **an instrumented solution must read like the plain
one you'd write in an interview.** Declarations change; control flow doesn't. Where it can't,
that's treated as a bug in the `viz` API rather than something for you to work around —
`viz.graph({ n, edges })` builds the adjacency list, so an instrumented BFS ends up *shorter*
than the uninstrumented one.

Fourteen structure kinds are tracked and rendered: array, string, matrix, DP table, stack, queue
and deque, heap (as array *and* the tree that array implies), hash map, hash set, interval list,
binary tree, general graph, trie, and linked list. The `StructureKind → Component` map is a
mapped type, so adding a structure without a visualizer is a compile error — "any structure you
use gets visualized" is enforced, not aspirational.

Solutions run in a Web Worker with three layers of runaway protection: op and frame budgets, a
wall clock, and a host-side `terminate()` for the one case the others can't see — a loop that
never touches a tracked structure. A budget trip still shows you the partial trace, because
seeing *where* it ran away is the point.

## Roadmap

All 75 problems live in [`roadmap/roadmap.yaml`](roadmap/roadmap.yaml); [`ROADMAP.md`](ROADMAP.md)
is generated from it and shows progress by category plus a **visualizer coverage matrix** — how
many solved problems actually exercise each structure, so a renderer never ships with no real
user. Three reference problems are solved (11, 1448, 1466), covering the array, tree and graph
paths through the whole pipeline.

## Working on it

```bash
pnpm verify       # lint + typecheck + roadmap check + unit + integration
pnpm verify:all   # the above plus a production build and Playwright
```

Four test layers, each doing a distinct job:

| Layer | What it proves |
|---|---|
| unit | tracer/runner/roadmap logic, including that the changed-only frame encoding is indistinguishable from full snapshots |
| integration | a real solution executes and its **frame sequence** is semantically right — loop invariants hold, path marks unwind, counts in the picture match the returned answer |
| dom | each visualizer renders correctly from a snapshot, with deterministic layout |
| e2e | the real app, driven through run → step → scrub → error paths |

The UI tests contain no `waitForTimeout` and no pixel snapshots: the player's clock is injectable
so tests drive time, and the stage exposes a structural `data-digest` so assertions target meaning
rather than rendering.

## Agent tooling

The development system ships as a first-class part of the deliverable:

- **MCP server** (`packages/mcp-server`) — `run_solution` executes a solution headlessly;
  `trace_inspect` renders any frame, op log, per-structure timeline or recursion tree as compact
  text; `trace_assert` checks trace semantics mechanically. Together they let an agent verify
  that the *animation* is faithful, not just that the return value is correct — which is the
  failure mode this project is most exposed to, since tests stay green through it.
- **Skills** (`.claude/skills`) — `solve-problem` (the full per-problem loop), `new-problem`,
  `new-visualizer`, `roadmap`, `debug-trace`.
- **Subagents** (`.claude/agents`) — including `trace-verifier`, which is read-only on purpose:
  an agent that can fix what it audits stops auditing.

See [CLAUDE.md](CLAUDE.md) for conventions, trace invariants, and the version pins that are
load-bearing.

## Layout

```
packages/tracer      trace model + instrumented structures. Zero dependencies.
packages/problems    problem definitions, test cases, reference solutions.
packages/runner      transpile + sandbox + execute. Shared by the worker, Vitest and MCP.
packages/viz         React SVG visualizers + player. Pure functions of a snapshot.
packages/roadmap     roadmap schema, validation, ROADMAP.md generation.
packages/mcp-server  stdio MCP server.
apps/web             Vite + React app.
```
