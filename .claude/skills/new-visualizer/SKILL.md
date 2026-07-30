---
name: new-visualizer
description: Add a new tracked structure kind end to end — trace snapshot type, instrumented structure class, React visualizer, text renderer for the MCP tools, and tests at every layer. Use when a problem needs a structure the tracer cannot represent yet, or when asked to add or improve a visualizer for a data structure.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task
---

# Add a structure kind

The most cross-cutting change in the repo: five packages and three test layers. It is also the
easiest to half-finish, which is why this checklist exists. The type system catches one of the
gaps for you; the rest are on you.

## The completeness mechanism

`VISUALIZERS` in `packages/viz/src/Visualizer.tsx` is a mapped type over `StructureKind`:

```ts
export const VISUALIZERS: {
  [K in StructureKind]: ComponentType<VizProps<Extract<StructureSnapshot, { kind: K }>>>
} = { ... }
```

So the moment you add a kind to the union, **`tsc` fails until a component exists**. Run
`pnpm typecheck` after step 1 and let the compiler drive the rest.

## Order of work

1. **`packages/tracer/src/types.ts`** — add the kind to `StructureKind` and a member to the
   `StructureSnapshot` union. Snapshots must be plain JSON: no class instances, no `Map`/`Set`,
   no functions, no cycles. A test asserts `structuredClone` and `JSON` round-trips, because
   that one property is what makes the worker boundary, the MCP tools and fixtures all work
   with no adapters.

2. **`packages/tracer/src/structures/<name>.ts`** — the instrumented class. Extend
   `BaseStructure`, own a mark store, and record a frame on every mutation. Two rules:
   - Every recording method should read like the operation it wraps (`q.push`, `t.left(n)`).
     Provide a non-recording twin (`peek`, `contains`, `childrenOf`) for guard conditions, so
     users are not forced to pollute the timeline to write an `if`.
   - Transient highlights ("the cell being read right now") go through the `transient` argument,
     never `marks.set`. Persistent state (`visited`, `result`) goes through the store.

3. **`packages/tracer/src/viz.ts`** — a factory on `Viz`, plus the export in `index.ts`.

4. **`packages/viz/src/structures/*.tsx`** — the component. Requirements:
   - SVG, not canvas, so tests can assert on the DOM.
   - **Deterministic layout.** No force simulation, no randomness, nothing time-dependent. Two
     renders of the same snapshot must produce byte-identical markup; there is a test for it.
   - Emit `data-node-id`, `data-highlight` (space-separated classes), and `data-value` on every
     element. That is the whole UI test surface.
   - Colours come from `var(--av-<markclass>)` in `tokens.css`. Never hard-code a colour.
   - Render an `<EmptyState>` rather than a blank panel when the structure is empty.
   - Virtualize above a few hundred elements, and say so on screen when you do.

5. **`packages/viz/src/Visualizer.tsx`** — add the entry (typecheck now passes) and a `case` in
   `digestOne` so `data-digest` changes when this structure's meaningful state changes.

6. **`packages/mcp-server/src/render.ts`** — add a `case` to `renderSnapshot`. Without it an
   agent inspecting a trace gets nothing for this structure and cannot verify its own work.

7. **`packages/roadmap/src/schema.ts`** — add the tag to `STRUCTURE_KINDS`, and tag at least one
   roadmap problem with it. A structure with no planned problem is a visualizer with no user.

## Tests

- `packages/tracer/src/tracer.test.ts` — ops emitted, snapshot shape, mark lifecycle, and add
  the kind to the `Viz facade registers every structure kind` case.
- `packages/viz/src/visualizers.dom.test.tsx` — render from a snapshot; assert `data-highlight`
  and `data-node-id`; assert layout determinism; assert the empty state.
- `packages/mcp-server/src/server.test.ts` — a `renderSnapshot` case.
- Then `pnpm verify`.
