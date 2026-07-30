import type { ProblemDefinition, Viz } from '../types.js'

/** 4-directional neighbours. Rot does not travel diagonally. */
const DIRS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const

/**
 * LeetCode 994 — Rotting Oranges.
 *
 * The multi-source BFS reference, and the first problem to drive the matrix and the queue at
 * the same time. That pairing *is* the explanation: the grid shows where the rot has got to,
 * the queue shows which cells are about to spread it, and the two move in lockstep because the
 * queue literally holds the coordinates the grid is highlighting.
 *
 * Two decisions carry the whole animation:
 *
 * 1. **A minute is one loop iteration, not one dequeue.** `wave` snapshots `frontier.size` and
 *    the inner loop drains exactly that many cells, so an orange that rots *now* cannot rot its
 *    neighbour until the next round. Processing one cell per outer iteration would return the
 *    same number while animating something that has no notion of a minute at all.
 * 2. **`frontier` and `visited` mean different things.** A cell marked `frontier` is rotten and
 *    has not spread yet; `visited` is rotten and done spreading. The band of `frontier` cells is
 *    the wavefront, and watching it sweep outward while the queue behind it drains is the point.
 *
 *    That only holds because a cell is *un*marked `frontier` when it is dequeued. Marks layer
 *    rather than replace, so adding `visited` on its own left every cell ever queued wearing
 *    `frontier` for the rest of the run: the "wavefront" grew monotonically into the whole rotten
 *    region, stating the exact opposite of what these two classes exist to distinguish. On screen
 *    it looked fine purely because the renderer resolves a cell's colour last-mark-wins and
 *    `visited` happened to be added second. The snapshot, the text dump and every mark count were
 *    wrong, so the invariant to hold onto is `frontier` marks == queue contents, at every frame.
 *
 * The whole-grid scan uses `peek`, which records nothing — otherwise 100 reads per seed pass
 * would bury the handful of frames that matter. It is *not* wrapped in `viz.quiet`: in
 * multi-source BFS the seed is the algorithm's distinguishing feature, and hiding it would leave
 * the queue looking as though it filled itself.
 */
export function reference(grid: number[][], viz: Viz): number {
  const g = viz.matrix(grid, { name: 'grid' })
  // The queue holds cells as "(row,col)". It only takes primitives, so a coordinate has to be
  // encoded somehow, and this is the encoding that still reads as a coordinate both in a 44px
  // queue cell and in a text dump — `[(1,0) (0,1)]` cannot be misread the way `[1,0 0,1]` can.
  const frontier = viz.queue<string>([], { name: 'frontier' })
  const cell = (r: number, c: number): string => `(${r},${c})`
  const coords = (key: string): [number, number] =>
    key.slice(1, -1).split(',').map(Number) as [number, number]

  let minutes = 0
  let fresh = 0
  viz.watch(() => ({ minute: minutes, fresh, frontier: frontier.size }))

  // Every orange that starts rotten is a source, so they all go in before minute 1.
  viz.group('seed — every orange that starts rotten', () => {
    for (let r = 0; r < g.rows; r += 1) {
      for (let c = 0; c < g.cols; c += 1) {
        if (g.peek(r, c) === 2) {
          // Queued first, marked second — see the note on the dequeue order below.
          frontier.push(cell(r, c))
          g.mark(r, c, 'frontier', 'rotten from the start')
        } else if (g.peek(r, c) === 1) {
          fresh += 1
        }
      }
    }
    viz.step(`${frontier.size} rotten source(s), ${fresh} fresh`)
  })

  while (fresh > 0 && !frontier.isEmpty) {
    minutes += 1
    // Snapshot the size *before* draining: these are the oranges that were rotten when the
    // minute began, and they are the only ones allowed to spread during it.
    const wave = frontier.size
    const before = fresh

    viz.group(`minute ${minutes}`, () => {
      for (let i = 0; i < wave; i += 1) {
        // The cursor moves onto the front cell *before* it is dequeued. `shift()` removes the
        // value and then records, so the one frame that shows a cell leaving the queue — the
        // instant that explains BFS — had nothing on the grid saying which cell it was, and the
        // coordinate existed only in that frame's caption. Pointing first fixes it with no extra
        // frame: `front()` is the silent read of the queue head.
        const [r, c] = coords(frontier.front() as string)
        // Counted with `peek`, which records nothing, so the narration can say whether this cell
        // had anything left to rot instead of leaving a viewer to infer it from four missing frames.
        const spreads = DIRS.filter(([dr, dc]) => g.peek(r + dr, c + dc) === 1).length
        g.cursor('rotting', r, c)
        // It is being picked up, so it leaves the wavefront. Without this the `frontier` layer only
        // ever grew — see the note on `frontier` vs `visited` above.
        //
        // Unmarked *before* the shift, and enqueues are marked *after* the push, so the wavefront
        // never leads the queue: no frame ever shows a `frontier` cell that is not in the queue.
        // The reverse lag is harmless, and it is the only ordering with no phantom wavefront cell
        // in it. `visited` has to wait until after the shift — a cell may not look done spreading
        // before the frame that pulls it off the queue.
        g.unmarkClass(r, c, 'frontier')
        frontier.shift()
        g.mark(
          r,
          c,
          'visited',
          spreads > 0
            ? `spread to ${spreads} neighbour(s) at minute ${minutes}`
            : 'nothing fresh left beside it',
        )

        for (const [dr, dc] of DIRS) {
          const nr = r + dr
          const nc = c + dc
          if (!g.inBounds(nr, nc) || g.peek(nr, nc) !== 1) continue
          g.set(nr, nc, 2)
          frontier.push(cell(nr, nc))
          g.mark(nr, nc, 'frontier', `rots at minute ${minutes}`)
          fresh -= 1
        }
      }
      // A minute that rots nothing is the moment the rot stalls, and it is why the answer will be
      // -1. It renders identically to a productive minute otherwise.
      viz.step(
        fresh === before
          ? `minute ${minutes}: nothing rotted — the rot has stalled with ${fresh} fresh left`
          : `minute ${minutes}: ${fresh} fresh left`,
      )
    })
  }

  // A fresh orange still standing once the rot stopped spreading is unreachable. Marking those
  // is what makes -1 legible: the picture names the oranges that caused it.
  if (fresh > 0) {
    for (let r = 0; r < g.rows; r += 1) {
      for (let c = 0; c < g.cols; c += 1) {
        if (g.peek(r, c) === 1) g.mark(r, c, 'excluded', 'the rot never reaches it')
      }
    }
    viz.step(`${fresh} orange(s) unreachable — impossible`)
    return -1
  }

  // Say why the run stopped. The loop exits on `fresh === 0`, which on a solvable grid leaves the
  // final wave still sitting in the queue — an honest picture of "there was nothing left to rot",
  // but one that reads as "it gave up early" when nothing says otherwise and the only clue is
  // `fresh=0` in the watch panel.
  viz.step(
    frontier.isEmpty
      ? `nothing left to rot — ${minutes} minute(s)`
      : `no fresh oranges left after ${minutes} minute(s) — the ${frontier.size} cell(s) still queued have nothing to spread to`,
  )
  return minutes
}

const starter = `// Multi-source BFS. Every orange that starts rotten is a source, and one minute is
// one *level* of the search: drain exactly the cells that were queued before the minute
// began, or an orange that rots now will rot its neighbour in the same minute.
export default function orangesRotting(grid: number[][], viz: Viz): number {
  const g = viz.matrix(grid, { name: 'grid' })
  const frontier = viz.queue<string>([], { name: 'frontier' })
  const cell = (r: number, c: number) => \`(\${r},\${c})\`
  const coords = (key: string) => key.slice(1, -1).split(',').map(Number) as [number, number]
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]

  let minutes = 0
  let fresh = 0
  viz.watch(() => ({ minute: minutes, fresh, frontier: frontier.size }))

  // \`peek\` reads without recording, so scanning the whole grid costs no frames.
  viz.group('seed — every orange that starts rotten', () => {
    for (let r = 0; r < g.rows; r += 1) {
      for (let c = 0; c < g.cols; c += 1) {
        // TODO: push every rotten cell onto \`frontier\` (mark it 'frontier'),
        // and count the fresh ones into \`fresh\`.
      }
    }
    viz.step(\`\${frontier.size} rotten source(s), \${fresh} fresh\`)
  })

  while (fresh > 0 && !frontier.isEmpty) {
    minutes += 1
    const wave = frontier.size
    viz.group(\`minute \${minutes}\`, () => {
      for (let i = 0; i < wave; i += 1) {
        // Point at the front cell before removing it — \`front()\` reads without recording, so
        // the frame that dequeues already shows which cell it is.
        const [r, c] = coords(frontier.front() as string)
        g.cursor('rotting', r, c)
        frontier.shift()
        // 'frontier' means "rotten, has not spread yet", so it has to come *off* here. Marks
        // layer rather than replace: adding 'visited' alone leaves both on the cell forever,
        // and the wavefront grows into the whole rotten region.
        g.unmarkClass(r, c, 'frontier')
        g.mark(r, c, 'visited', \`spread at minute \${minutes}\`)
        // TODO: for each of the four neighbours that is still fresh, set it to 2,
        // mark it 'frontier', push it, and decrement \`fresh\`.
      }
      viz.step(\`minute \${minutes}: \${fresh} fresh left\`)
    })
  }

  return fresh > 0 ? -1 : minutes
}
`

export const rottingOranges: ProblemDefinition = {
  id: 'p994',
  leetcode: 994,
  slug: 'rotting-oranges',
  title: 'Rotting Oranges',
  difficulty: 'medium',
  category: 'graphs-bfs',
  statement:
    'You are given an `m x n` grid where each cell is `0` (empty), `1` (a fresh orange) or `2` ' +
    '(a rotten orange). Every minute, any fresh orange that is 4-directionally adjacent to a ' +
    'rotten orange becomes rotten. Return the minimum number of minutes that must elapse until ' +
    'no cell has a fresh orange, or `-1` if that is impossible.',
  structures: ['matrix', 'queue'],
  comparator: 'deep',
  entry: 'orangesRotting',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    {
      name: 'example — rot reaches the far corner',
      args: [[[2, 1, 1], [1, 1, 0], [0, 1, 1]]],
      expected: 4,
      tags: ['example'],
    },
    {
      name: 'example — one orange the rot can never reach',
      args: [[[2, 1, 1], [0, 1, 1], [1, 0, 1]]],
      expected: -1,
      tags: ['example'],
    },
    {
      name: 'example — no fresh oranges at all',
      args: [[[0, 2]]],
      expected: 0,
      tags: ['example', 'edge'],
    },
    {
      name: 'two sources close in from both ends',
      args: [[[2, 1, 1, 1, 1, 1, 2]]],
      expected: 3,
      tags: ['example'],
    },
    {
      name: 'farthest orange sets the clock',
      args: [[[2, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]]],
      expected: 6,
      tags: ['edge'],
    },
    {
      name: 'single corridor, one minute per cell',
      args: [[[2, 1, 1, 1, 1, 1, 1, 1, 1, 1]]],
      expected: 9,
      tags: ['edge'],
    },
    { name: 'lone fresh orange, nothing rotten', args: [[[1]]], expected: -1, tags: ['edge'] },
    { name: 'lone rotten orange', args: [[[2]]], expected: 0, tags: ['edge'] },
    { name: 'entirely empty grid', args: [[[0, 0], [0, 0]]], expected: 0, tags: ['edge'] },
    { name: 'rot does not travel diagonally', args: [[[2, 0], [0, 1]]], expected: -1, tags: ['edge'] },
    {
      name: 'fresh orange walled off behind empty cells',
      args: [[[2, 1, 0], [0, 0, 0], [0, 0, 1]]],
      expected: -1,
      tags: ['edge'],
    },
    {
      name: 'fresh oranges but no rot to start',
      args: [[[1, 1], [1, 1]]],
      expected: -1,
      tags: ['edge'],
    },
  ],
  hints: [
    'Start every rotten orange in the queue at once — the answer is the depth of a BFS with many sources, not many separate BFSes.',
    'Count the fresh oranges up front. The run is impossible exactly when that count is still above zero after the rot stops spreading.',
    'Process a whole level per iteration: read the queue size before draining, then dequeue exactly that many. One level is one minute.',
  ],
}
