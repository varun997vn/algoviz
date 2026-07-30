---
name: solve-problem
description: Take one LeetCode 75 roadmap problem from todo to a review-ready state — branch, author the problem definition and test cases, write the instrumented reference solution, verify the emitted trace is a faithful animation, add tests across all three layers, update the roadmap, commit and push. Use when the user says "do the next problem", names a LeetCode problem to add, or asks to continue the roadmap.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task, mcp__algoviz__roadmap_list, mcp__algoviz__roadmap_next, mcp__algoviz__roadmap_update, mcp__algoviz__problem_get, mcp__algoviz__problem_list, mcp__algoviz__run_solution, mcp__algoviz__trace_inspect, mcp__algoviz__trace_assert
---

# Solve one roadmap problem

The unit of work in this repo, repeated 75 times. Follow it in order; skipping the trace
verification step is how a problem ships with passing tests and a misleading animation.

## 1. Pick the problem

Unless the user named one, call `mcp__algoviz__roadmap_next` with `count: 1`. Confirm the choice
with the user in one line, then mark it in progress:

```
mcp__algoviz__roadmap_update  { id: "<id>", status: "in-progress" }
```

## 2. Branch

Work on the branch named in the repo's git instructions. If a previous problem's PR for that
branch has already merged, restart the branch from the default branch rather than stacking.

## 3. Author the problem definition

Create `packages/problems/src/problems/<slug>.ts` following the shape of an existing one — read
`container-with-most-water.ts` first. It must export a `ProblemDefinition` with:

- `id` matching the roadmap entry, plus `leetcode`, `slug`, `title`, `difficulty`, `category`
- `statement` — one short paragraph, no LeetCode boilerplate
- `structures` — the tracked structures the visualization needs; must match what the reference
  solution actually creates, or the roadmap coverage matrix silently lies
- `comparator` — pick from `deep | unordered | set-of-sets | approx | boolean`. Never let a
  solution decide what counts as correct.
- `entry` — the function name the sandbox looks for
- `starter` — code the editor opens with: the scaffolding and structure declarations done, the
  algorithm itself left as a TODO. The user is here to write the algorithm, not the boilerplate.
- `cases` — **at least 6**, tagged, with at least one `example` and one `edge`. Derive edges from
  the problem's stated constraints: minimum size, all-equal values, duplicates, zeros/negatives,
  the answer being at a boundary.
- `hints` — three, escalating from observation to approach to the exact predicate

Consider delegating this to the `problem-author` subagent; it keeps a narrow context and does
not need to load the visualizer code.

Then register it in `packages/problems/src/index.ts` — the registry is deliberately hand-written,
not a glob, so Vite, Vitest and the MCP server all resolve identically.

## 4. Write the instrumented reference solution

**The style rule that matters:** the instrumented solution must read like the plain one you'd
write in an interview. Declarations change; control flow does not.

```ts
const h = viz.array(height, { name: 'height' })   // then use h[i] exactly like height[i]
const left = viz.cursor('left', 0, h)             // named carets, moved with .inc()/.dec()
viz.watch(() => ({ best }))                        // sampled into every frame
viz.step('measure the current pair')               // narrate each meaningful iteration
```

If you find yourself contorting the algorithm to satisfy the API, **fix the API in
`packages/tracer`, not the solution.** That is a real finding, not an inconvenience.

Reach for `viz.group()` around recursion — it gives the call-stack outline for one line of code.
Use `t.onPath()` for tree path state so it unwinds correctly, and `viz.quiet()` for setup that
isn't algorithm.

## 5. Run it and verify the *animation*, not just the answer

```
mcp__algoviz__run_solution  { problem: "<slug>", useReference: true }
```

Every case must pass, and the `structures:` line must list something — a solution that passes
with no structures animates nothing.

Then actually look at the trace:

```
mcp__algoviz__trace_inspect { traceId: "<id>", select: "summary" }
mcp__algoviz__trace_inspect { traceId: "<id>", select: "frame", at: <mid-run> }
mcp__algoviz__trace_inspect { traceId: "<id>", select: "groups" }
```

And assert its semantics mechanically:

```
mcp__algoviz__trace_assert { traceId: "<id>", assertions: [
  { kind: "never-marked-at-end", structure: "<name>", class: "path" },
  { kind: "cursor-in-range", structure: "<name>", cursor: "left", min: 0, max: <n-1> },
  { kind: "has-steps", min: 3 },
  { kind: "final-equals", value: <expected> }
]}
```

For anything non-obvious, hand it to the `trace-verifier` subagent. It is read-only on purpose:
an agent that can fix what it audits stops auditing.

## 6. Tests, all three layers

- **Unit** — only if you changed the tracer. Add to `packages/tracer/src/tracer.test.ts`.
- **Integration** — add a `describe` block to `tests/integration/run-solutions.test.ts`
  asserting the *frame sequence*, not just the return value: loop invariants, marks that must
  clear, counts in the picture matching the returned number.
- **DOM** — if you added or changed a visualizer, extend
  `packages/viz/src/visualizers.dom.test.tsx`.
- **E2E** — add a case to `tests/e2e/workbench.spec.ts` if the problem exercises UI not already
  covered. Use `window.__algoviz.seek()` and `data-digest`; never `waitForTimeout`, never pixels.

## 7. Verify and record

```bash
pnpm verify        # lint, typecheck, roadmap:check, unit + integration
pnpm test:ui       # Playwright, needs pnpm build first
```

Then:

```
mcp__algoviz__roadmap_update { id: "<id>", status: "done", branch: "<branch>", notes: "<one line>" }
```

That regenerates `ROADMAP.md`. Never hand-edit it.

## 8. Commit and push

One problem per commit. Explain in the body what the visualization shows and any tracer change
you had to make. Push to the designated branch. Do not open a pull request unless asked.
