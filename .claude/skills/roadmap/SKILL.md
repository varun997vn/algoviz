---
name: roadmap
description: Query or update the LeetCode 75 roadmap and regenerate ROADMAP.md. Use when asked what is next, what is done, how much progress has been made, which visualizers lack coverage, or to change a problem's status, branch, PR or notes.
allowed-tools: Read, Bash, mcp__algoviz__roadmap_list, mcp__algoviz__roadmap_next, mcp__algoviz__roadmap_update
---

# Roadmap

`roadmap/roadmap.yaml` is the source of truth. `ROADMAP.md` is **generated** — never hand-edit
it; `pnpm roadmap:check` fails CI and the local test run when it drifts.

## Reading

- What's next: `mcp__algoviz__roadmap_next { count: 3 }` — respects `dependsOn`, skips blocked.
- Filtered lists: `mcp__algoviz__roadmap_list { status, category, difficulty, structure }`.
- Progress and visualizer coverage: read `ROADMAP.md`. The coverage table shows how many *done*
  problems exercise each structure; a zero there means that visualizer has no real user yet,
  however green its unit tests are.

## Writing

Prefer the tool over editing YAML by hand — it validates before writing and regenerates the
markdown in the same step:

```
mcp__algoviz__roadmap_update { id: "p0011", status: "done", branch: "...", pr: 12, notes: "..." }
```

Statuses: `todo | in-progress | review | blocked | done`. A `done` entry must record a branch or
a PR, or validation rejects it.

If you do edit the YAML directly, run `pnpm roadmap:generate` and commit both files together.
