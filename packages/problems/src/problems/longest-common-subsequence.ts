import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 1143 — Longest Common Subsequence.
 *
 * The first problem to drive the **2-D** arm of `VizDpTable`. Tribonacci proved a 1-D table can
 * explain a recurrence; this one has to prove a grid can, and the thing a grid adds is *direction*:
 * every cell is filled from one of exactly three neighbours, and which one it took is the entire
 * content of the algorithm. `dependsOn` is what makes that visible — one diagonal cell lit when the
 * characters match, the cell above and the cell to the left lit when they do not.
 *
 * Two decisions carry the animation:
 *
 * 1. **The table is `null`-filled, not zero-filled**, and only row 0 / column 0 are seeded. So the
 *    region ahead of the fill front renders empty rather than as a wall of plausible zeros — and in
 *    a problem whose answer is frequently 0, "not computed yet" and "computed, equals zero" must
 *    not look alike. It also means a misordered recurrence throws instead of quietly reading a 0.
 * 2. **The characters are compared through `charAt`, and the carets are the loop variables.** The
 *    strings are separate structures so the pair being compared is on screen while the cell it
 *    decides is being written. Ideally the two strings would label the table's own axes — that is
 *    what `axisLabels` is declared for, and it is passed here — but nothing renders it yet (see the
 *    note below), so the caret over each string is currently the only thing that says which
 *    character a row or column stands for.
 *
 * Loop variables are 0-based over the *characters*, and the cell they decide is `[i + 1][j + 1]`.
 * The alternative — 1-based dp indices with `text1[i - 1]` inside — is the more familiar textbook
 * form, but it puts a caret named `i` one cell away from the character `i` names, and a pointer
 * that lies about where it points is worse than an off-by-one in a comment.
 *
 * This solution reported that `axisLabels` was stored on the snapshot by `VizDpTable.twoD` and
 * read by *nothing*, so a 2-D table rendered with bare integers no matter what strings it was
 * given. `GridViz` reads it now: character k labels row/column k+1, and the base row and column
 * keep their index. The `viz.string` + `viz.cursor` panels stay — they were never only a stand-in
 * for the labels, they are how you see *which* character each step is comparing.
 */
export function reference(text1: string, text2: string, viz: Viz): number {
  const a = viz.string(text1, { name: 'text1' })
  const b = viz.string(text2, { name: 'text2' })

  // Row r stands for the prefix text1[0..r), column c for text2[0..c) — hence one more row and one
  // more column than there are characters, and hence the `+ 1`s below.
  const dp = viz.dp2d<number>(a.length + 1, b.length + 1, null, {
    name: 'dp',
    axisLabels: [text1, text2],
  })
  const i = viz.cursor('i', 0, a)
  const j = viz.cursor('j', 0, b)
  viz.watch(() => ({ i: i.value, j: j.value, lcs: dp.peek(a.length, b.length) }))

  // An empty prefix shares nothing with anything. Grouped rather than `viz.quiet`-ed, for two
  // reasons. It costs `m + n + 1` frames against the `m * n` the fill itself spends, so it is free
  // in proportion — and, decisively, `viz.quiet` would have made the caption below a lie: quiet
  // suppresses frame emission, and a structure's snapshot only exists on frames that touch it, so
  // a table written *only* inside a quiet block keeps resolving to its pre-quiet snapshot until
  // something else moves. Seeded quietly, the frame announcing the border showed an empty table.
  viz.group('base cases — an empty prefix has no common subsequence', () => {
    for (let c = 0; c <= b.length; c += 1) dp.set(0, c, 0)
    for (let r = 1; r <= a.length; r += 1) dp.set(r, 0, 0)
  })
  viz.step('row 0 and column 0 are 0 — an empty prefix has no common subsequence')

  for (i.value = 0; i.value < a.length; i.inc()) {
    for (j.value = 0; j.value < b.length; j.inc()) {
      // The cell this pair of characters decides.
      const r = i.value + 1
      const c = j.value + 1

      if (a.charAt(i.value) === b.charAt(j.value)) {
        dp.set(r, c, dp.get(r - 1, c - 1) + 1)
        // Named *after* the write, so the frame that lights the source cell also shows the value it
        // produced. The other order leaves a frame pointing at a cell for a result that is not there
        // yet — see the "one frame per op" note in CLAUDE.md.
        dp.dependsOn([[r - 1, c - 1]], `dp[${r}][${c}] = dp[${r - 1}][${c - 1}] + 1`)
        viz.step(
          `text1[${i.value}] = text2[${j.value}] = '${a.peek(i.value)}' — match, ` +
            `extend the diagonal to ${dp.peek(r, c)}`,
        )
      } else {
        dp.set(r, c, Math.max(dp.get(r - 1, c), dp.get(r, c - 1)))
        dp.dependsOn(
          [
            [r - 1, c],
            [r, c - 1],
          ],
          `dp[${r}][${c}] = max(dp[${r - 1}][${c}], dp[${r}][${c - 1}])`,
        )
        viz.step(
          `text1[${i.value}] = '${a.peek(i.value)}', text2[${j.value}] = '${b.peek(j.value)}' — ` +
            `no match, better of above (${dp.peek(r - 1, c)}) and left (${dp.peek(r, c - 1)}) = ` +
            `${dp.peek(r, c)}`,
        )
      }
    }
  }

  dp.mark(a.length, b.length, 'result', `LCS length = ${dp.peek(a.length, b.length)}`)
  return dp.get(a.length, b.length)
}

const starter = `// dp[r][c] is the LCS length of text1[0..r) and text2[0..c). Row 0 and column 0 are the
// empty prefixes, so the table is one bigger than each string in each direction and its
// border is 0. Fill it row by row; the answer is the bottom-right corner.
export default function longestCommonSubsequence(text1: string, text2: string, viz: Viz): number {
  const a = viz.string(text1, { name: 'text1' })
  const b = viz.string(text2, { name: 'text2' })
  const dp = viz.dp2d<number>(a.length + 1, b.length + 1, null, {
    name: 'dp',
    axisLabels: [text1, text2],
  })
  const i = viz.cursor('i', 0, a)
  const j = viz.cursor('j', 0, b)
  viz.watch(() => ({ i: i.value, j: j.value, lcs: dp.peek(a.length, b.length) }))

  // An empty prefix has no common subsequence with anything, so the whole border is 0.
  viz.group('base cases — an empty prefix has no common subsequence', () => {
    for (let c = 0; c <= b.length; c += 1) dp.set(0, c, 0)
    for (let r = 1; r <= a.length; r += 1) dp.set(r, 0, 0)
  })
  viz.step('row 0 and column 0 are 0 — an empty prefix has no common subsequence')

  for (i.value = 0; i.value < a.length; i.inc()) {
    for (j.value = 0; j.value < b.length; j.inc()) {
      // The cell this pair of characters decides.
      const r = i.value + 1
      const c = j.value + 1

      // TODO: the recurrence, and only the recurrence.
      //
      //   a.charAt(i.value) === b.charAt(j.value)
      //     -> dp[r][c] is the diagonal cell dp[r - 1][c - 1] plus one
      //     -> otherwise it is the better of above, dp[r - 1][c], and left, dp[r][c - 1]
      //
      // Write it with dp.set(r, c, ...) and dp.get(...), then call
      //   dp.dependsOn([[row, col], ...], 'why')
      // naming exactly the cell or cells you read. That call is what turns the picture from
      // "a grid filling up" into "this cell came from *that* neighbour".
      viz.step('dp[' + r + '][' + c + ']')
    }
  }

  dp.mark(a.length, b.length, 'result', 'LCS length')
  return dp.get(a.length, b.length)
}
`

export const longestCommonSubsequence: ProblemDefinition = {
  id: 'p1143',
  leetcode: 1143,
  slug: 'longest-common-subsequence',
  title: 'Longest Common Subsequence',
  difficulty: 'medium',
  category: 'dp-multidimensional',
  statement:
    'A subsequence of a string is what is left after deleting some characters without ' +
    'reordering the rest. Given `text1` and `text2`, return the length of their longest common ' +
    'subsequence, or `0` if they have none. Fill a table where `dp[r][c]` is the answer for the ' +
    'prefixes `text1[0..r)` and `text2[0..c)`: when the two characters match the cell is the ' +
    'diagonal neighbour plus one, and when they do not it is the larger of the cell above and ' +
    'the cell to the left. Constraints: `1 <= text1.length, text2.length <= 1000`, lowercase ' +
    'English letters only.',
  structures: ['string', 'dp'],
  comparator: 'deep',
  entry: 'longestCommonSubsequence',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    { name: 'example "abcde" / "ace" — the subsequence is "ace"', args: ['abcde', 'ace'], expected: 3, tags: ['example'] },
    { name: 'example "abc" / "abc" — identical strings', args: ['abc', 'abc'], expected: 3, tags: ['example'] },
    {
      name: 'example "abc" / "def" — nothing in common, every cell stays 0',
      args: ['abc', 'def'],
      expected: 0,
      tags: ['example', 'edge'],
    },
    {
      name: 'shortest possible pair, matching — a 2x2 table with one computed cell',
      args: ['a', 'a'],
      expected: 1,
      tags: ['edge'],
    },
    {
      name: 'shortest possible pair, not matching — the one computed cell is 0',
      args: ['a', 'b'],
      expected: 0,
      tags: ['edge'],
    },
    {
      name: 'duplicates — "aaaa" / "aa" is capped by the shorter string',
      args: ['aaaa', 'aa'],
      expected: 2,
      tags: ['edge'],
    },
    {
      name: 'single-column table — "abcdefg" / "g" matches only in the last row',
      args: ['abcdefg', 'g'],
      expected: 1,
      tags: ['edge'],
    },
    {
      name: 'single-row table — "g" / "abcdefg", the transpose of the case above',
      args: ['g', 'abcdefg'],
      expected: 1,
      tags: ['edge'],
    },
    {
      name: 'interleaved repeats — "abcba" / "abcbcba"',
      args: ['abcba', 'abcbcba'],
      expected: 5,
      tags: [],
    },
    { name: '"bsbininm" / "jmjkbkjkv" — one shared character', args: ['bsbininm', 'jmjkbkjkv'], expected: 1, tags: [] },
    {
      name: '"oxcpqrsvwf" / "shmtulqrypy" — a long table with a short answer',
      args: ['oxcpqrsvwf', 'shmtulqrypy'],
      expected: 2,
      tags: [],
    },
    {
      name: '"pmjghexybyrgzczy" / "hafcdqbgncrcbihkd" — 16x17, the largest table here',
      args: ['pmjghexybyrgzczy', 'hafcdqbgncrcbihkd'],
      expected: 4,
      tags: ['large'],
    },
  ],
  hints: [
    'Compare the two strings by *prefix*, not by whole string: let `dp[r][c]` be the answer for ' +
      'the first `r` characters of `text1` and the first `c` of `text2`. An empty prefix has no ' +
      'common subsequence, so row 0 and column 0 are all 0.',
    'For a cell `dp[r][c]`, look at the last character of each prefix. If they are equal, both ' +
      'prefixes can end with it and nothing else changes — so the answer is one more than the ' +
      'diagonal cell. If they are not, at least one of the two characters cannot be used, so the ' +
      'answer is the better of the two cells you get by dropping one of them.',
    '`dp[r][c] = text1[r - 1] === text2[c - 1] ? dp[r - 1][c - 1] + 1 : ' +
      'Math.max(dp[r - 1][c], dp[r][c - 1])`. After writing the cell, call ' +
      '`dp.dependsOn([[r - 1, c - 1]])` or `dp.dependsOn([[r - 1, c], [r, c - 1]])` with exactly ' +
      'the cells you read — that is the difference between a table that fills and a table that ' +
      'explains.',
  ],
}
