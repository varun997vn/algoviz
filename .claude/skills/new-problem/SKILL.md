---
name: new-problem
description: Scaffold one or several LeetCode 75 problem definitions without solving them — metadata, test cases derived from the constraints, and starter code. Use when asked to stub out problems, bulk-add upcoming ones, or prepare a problem for someone else to solve.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task, mcp__algoviz__roadmap_list, mcp__algoviz__problem_get, mcp__algoviz__problem_list
---

# Scaffold a problem

Scaffolding only — no reference solution, no roadmap status change beyond `todo`. Separate from
`solve-problem` so you can prepare ten problems cheaply without paying for ten solve loops.

For each problem, create `packages/problems/src/problems/<slug>.ts` and register it in
`packages/problems/src/index.ts`. Read `container-with-most-water.ts` first for the shape.

What to get right, because these are the parts that are tedious to fix later:

- **`structures`** must be what a *good* visualization needs, not the minimum that compiles. A
  BFS wants the graph and the frontier queue and the visited set — seeing all three in sync is
  the explanation.
- **`cases`** — at least 6, each tagged, with at least one `example` and one `edge`. Derive the
  edges from the LeetCode constraints rather than inventing them: minimum input size, all values
  equal, duplicates, zeros and negatives where allowed, and the answer sitting at a boundary.
- **`starter`** — declare the structures and leave the algorithm as a TODO. The user is here to
  write the algorithm; making them retype `viz.array(...)` wastes the part they came for. Keep it
  compiling and keep any comment free of backticks (it lives inside a template literal).
- **`comparator`** — `deep` unless order genuinely does not matter.
- **`hints`** — three, escalating: an observation, then the approach, then the exact predicate.

Leave the reference as unimplemented only if you are truly not solving it; otherwise `pnpm test`
will fail on the "every reference solution passes every case" sweep, which is working as intended.

Consider delegating the per-problem authoring to the `problem-author` subagent, one problem each,
and run `pnpm verify` once at the end.
