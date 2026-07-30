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
          g.mark(r, c, 'frontier', 'rotten from the start')
          frontier.push(cell(r, c))
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

    viz.group(`minute ${minutes}`, () => {
      for (let i = 0; i < wave; i += 1) {
        const [r, c] = coords(frontier.shift() as string)
        g.cursor('rotting', r, c)
        g.mark(r, c, 'visited', `spread at minute ${minutes}`)

        for (const [dr, dc] of DIRS) {
          const nr = r + dr
          const nc = c + dc
          if (!g.inBounds(nr, nc) || g.peek(nr, nc) !== 1) continue
          g.set(nr, nc, 2)
          g.mark(nr, nc, 'frontier', `rots at minute ${minutes}`)
          frontier.push(cell(nr, nc))
          fresh -= 1
        }
      }
      viz.step(`minute ${minutes}: ${fresh} fresh left`)
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
        const [r, c] = coords(frontier.shift() as string)
        g.cursor('rotting', r, c)
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
