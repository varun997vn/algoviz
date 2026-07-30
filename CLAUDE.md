# AlgoViz — working notes

A web app for solving the LeetCode 75 set by **writing the algorithm yourself** and watching your
own code execute over a live visualization of whatever structures it touches. The visualization is
derived from instrumented execution, never pre-baked.

## Layout

```
packages/tracer      the trace model + instrumented structures. Zero deps, pure TS.
packages/problems    problem definitions, test cases, reference solutions. Hand-written registry.
packages/runner      transpile + sandbox + execute. Shared by the browser worker, Vitest, MCP.
packages/viz         React SVG visualizers + player. Pure functions of a snapshot.
packages/roadmap     roadmap schema, validation, ROADMAP.md generation.
packages/mcp-server  stdio MCP server: run solutions and inspect traces headlessly.
apps/web             Vite + React app: picker, editor, workbench.
```

Dependency direction is one-way and enforced by convention plus project references:

```
tracer   -> nothing
problems -> tracer
runner   -> tracer, problems
viz      -> tracer                (never problems, never runner)
roadmap  -> tracer (types only)
mcp      -> tracer, problems, runner, roadmap
web      -> all of the above
```

`viz` must never import `runner` or `problems`: a visualizer is a pure function of one snapshot,
and if it needs problem context the model is wrong.

## Commands

| | |
|---|---|
| `pnpm verify` | lint + typecheck + roadmap check + unit + integration. **Run before every commit.** |
| `pnpm verify:all` | the above plus a production build and Playwright |
| `pnpm dev` | dev server |
| `pnpm test:unit` / `test:integration` / `test:ui` | one layer at a time |
| `pnpm roadmap:generate` | regenerate `ROADMAP.md` |

Always `pnpm`, never bare `npm`/`yarn`. Filter with `pnpm --filter @algoviz/<pkg>`.

## Generated files — never hand-edit

- `ROADMAP.md` — from `roadmap/roadmap.yaml` via `pnpm roadmap:generate`. `pnpm roadmap:check`
  fails CI *and* the local test run when it drifts.

## Version pins are load-bearing

- **`@playwright/test` must stay `1.56.1`.** That is the version whose `browsers.json` names
  chromium revision **1194**, which is the build baked into this container at
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. A newer Playwright expects a revision that is not
  there and tries to download one.
- **Never run `playwright install` locally.** Use `pnpm test:ui`. CI installs browsers because
  GitHub runners have no `/opt/pw-browsers`; that asymmetry is intentional.
- Vite 7 / Vitest 3 / TypeScript 5.9 deliberately, not the newest majors.

## Trace invariants

These hold everywhere and have tests. Breaking one breaks all 75 problems at once.

1. **Snapshots are plain JSON.** No class instances, `Map`/`Set`, functions or cycles. This one
   property is what lets a trace cross the worker boundary, be asserted in Node, and be rendered
   as text by the MCP tools with no adapters.
2. **Frames carry only structures that changed.** `TraceReader` resolves the rest by walking back,
   and returns the *same object reference* for an unchanged structure so `React.memo` works.
3. **Transient vs persistent marks.** A transient mark ("the cell being read right now") is
   flagged and stripped when a snapshot is carried forward, so a structure that stopped changing
   does not keep looking active. Marks **layer, they do not replace** — stripping the transient
   layer must never lose `visited`/`result`.
4. **No colours in the tracer.** It emits semantic mark classes; `packages/viz/src/tokens.css` is
   the only place a class becomes a colour.
5. **Visualizers are pure functions of a snapshot**, with deterministic layout. Two renders of the
   same snapshot produce identical markup.

## Instrumentation style — the rule that matters

An instrumented solution must read like the plain one you'd write in an interview:

```ts
const h = viz.array(height, { name: 'height' })
const left = viz.cursor('left', 0, h)
while (left.value < right.value) {
  const area = (right.value - left.value) * Math.min(h[left.value], h[right.value])
  ...
}
```

**If it doesn't, fix the `viz` API — not the solution.** That is a real finding about the API, not
an inconvenience to work around. `viz.graph({ n, edges })` builds the adjacency list precisely so
an instrumented BFS ends up *shorter* than the plain one.

Corollaries:
- Every recording method has a non-recording twin (`peek`, `contains`, `childrenOf`) so a guard
  condition doesn't have to pollute the timeline.
- `viz.quiet()` for setup, `viz.group()` around recursion (it buys the call-stack outline for one
  line), `t.onPath()` for tree path state so it unwinds.
- `packages/problems` compiles with `noUncheckedIndexedAccess: false` on purpose — solution code
  is the one place `nums[i]` must read exactly as it does on LeetCode. The setting stays on
  everywhere else.

### Known gap: one frame per op

There is no way to say "these two mutations are one step". Three audits have now reported the
same consequence independently: `waiting.push(day)` then `t.mark(day, 'pinned')` are two frames,
so for one frame the day is on the stack and not yet marked, and any invariant that ties two
structures together is briefly false. Every such case so far has been fixable by *ordering* the
ops so the lag runs in the harmless direction — a mark that trails the queue rather than leading
it, an answer written before the mark that announces it — and where ordering was enough, that is
what was done, because the alternative is not free.

A coalescing primitive (`viz.atomic(label, () => { ... })`, emitting one frame carrying every
structure the body touched) would remove the lag entirely. It would also erase the per-op frames,
and the op log is what the integration tests and `trace_assert` reason over: "`visited` is never
set before the frame that dequeues the cell" is only checkable because the dequeue *has* a frame.
Deciding that trade is a design question, not a cleanup — do it deliberately, with the op-level
assertions rewritten first, or not at all.

## Prefer the MCP tools over ad-hoc scripts

`run_solution` executes a solution headlessly and returns pass/fail plus trace IDs.
`trace_inspect` renders a frame, an op log, a per-structure timeline or the group tree as compact
text. `trace_assert` checks trace semantics mechanically.

Passing tests say nothing about whether the animation is right. `trace_assert` is what turns
"does it look correct?" into something checkable, and it is the reason the `trace-verifier`
subagent produces evidence rather than plausible prose.

## Testing

Four layers, and the boundaries are meaningful:

- **unit** — pure logic. Cheapest, most of the value.
- **integration** — execute a real solution, assert the **frame sequence**: loop invariants, marks
  that must clear, counts in the picture matching the returned answer. This layer catches traces
  that are plausible but wrong.
- **dom** — a visualizer rendered from a snapshot; assert `data-highlight` / `data-node-id` and
  layout determinism.
- **e2e** — the real app. Two hard rules: drive time with `window.__algoviz.seek()/advance()`
  rather than waiting for it (no `waitForTimeout` anywhere), and assert `data-digest`/`data-*`
  rather than pixels. Set editor text with `window.__algoviz.setSource()`, never by typing —
  CodeMirror auto-closes brackets, so typing a deliberately-broken snippet makes it valid.

## Delegation

| Change | Agent |
|---|---|
| a problem definition and its cases | `problem-author` |
| verifying a trace is a faithful animation | `trace-verifier` (read-only on purpose) |
| visualizer, layout or player work | `visualizer-engineer` |
| test coverage | `test-author` |
| roadmap bookkeeping | `roadmap-keeper` |

## Conventions

One problem per commit. Commit bodies say what the visualization shows and why, not just what
changed. Do not open a pull request unless asked.
