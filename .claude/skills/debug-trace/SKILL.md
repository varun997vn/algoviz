---
name: debug-trace
description: Diagnose a visualization that is wrong or confusing even though the tests pass — a highlight that never clears, a pointer that lags, a structure that renders blank, an animation that does not match the algorithm. Use when the answer is correct but the picture is not.
allowed-tools: Read, Edit, Bash, Grep, Glob, Task, mcp__algoviz__run_solution, mcp__algoviz__trace_inspect, mcp__algoviz__trace_assert
---

# Debug a wrong animation

The failure mode with no test pointing at it: the solution returns the right answer, every case
is green, and the animation still misleads. Work the layers in order — the fix is very different
depending on which one is at fault.

## 1. Reproduce and look

```
mcp__algoviz__run_solution   { problem: "<slug>", useReference: true, caseIndex: 0 }
mcp__algoviz__trace_inspect  { traceId: "<id>", select: "summary" }
```

The summary tells you a lot immediately:

- **`structures:` empty** → the solution never wrapped anything. Nothing can animate.
- **frame count in the low single digits** → the algorithm ran outside the tracked structures.
- **`op mix` dominated by `read`** → the run is technically traced but has no narration; add
  `viz.step()` at the decision points.
- **`TRUNCATED`** → a budget tripped; the animation genuinely stops there.

Then read the frames around the suspect moment, and the structure's timeline, which is the
fastest way to see a pointer that stopped moving:

```
mcp__algoviz__trace_inspect { traceId: "<id>", select: "frame", at: <n> }
mcp__algoviz__trace_inspect { traceId: "<id>", select: "timeline", from: <n-6>, to: <n+6> }
mcp__algoviz__trace_inspect { traceId: "<id>", select: "ops", from: <n-6>, to: <n+6> }
```

## 2. Pin the symptom with an assertion

Turn what you observed into a check, so the bug cannot come back silently:

```
mcp__algoviz__trace_assert { traceId: "<id>", assertions: [
  { kind: "never-marked-at-end", structure: "tree", class: "path" },
  { kind: "cursor-monotonic", structure: "nums", cursor: "left", direction: "up" },
  { kind: "edge-state-count", structure: "g", state: "reversed", count: 3 }
]}
```

## 3. Triage — three layers, three different fixes

**Instrumentation bug (the solution).** The trace faithfully records what the code did, and what
the code did was not what you meant. Symptoms: a mark set inside a scope that is never removed;
an edge marked twice so the second overwrites the first; a cursor mutated as a plain local
instead of through `viz.cursor`. Fix the solution.

**Tracer bug (`packages/tracer`).** The solution is right and the recorded state is wrong.
Symptoms: a mark disappears that nothing removed; a structure's snapshot does not match its real
contents; a transient highlight persists into later frames. These are the expensive ones — they
affect every problem. Add a unit test in `tracer.test.ts` reproducing it *first*, then fix.
Two real examples from this repo's history, both worth recognising:
- marks keyed by node alone, so unwinding a path erased the `result` set beneath it;
- transient marks leaking forward once a structure stopped changing.

**Component bug (`packages/viz`).** The trace is correct and the render is not. Symptoms: the
text renderer from `trace_inspect` shows the right thing but the SVG does not; a `data-highlight`
attribute present but nothing visible; layout jumping between frames. Add a DOM test with a
committed snapshot, then fix the component.

The text renderer is the arbiter: if `trace_inspect` shows the correct picture, the bug is in the
component; if it does not, the bug is upstream.

## 4. Guard it

Every fix lands with a test at the layer that was wrong. If the bug was in the tracer, also add a
`trace_assert` call to the affected problem's integration test — that is the cheap check that
stops it recurring across all 75 problems.
