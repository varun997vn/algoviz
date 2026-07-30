import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 1207 — Unique Number of Occurrences.
 *
 * The first problem to drive `VizMap` and `VizSet`, and it drives both at once on purpose: the
 * whole algorithm is one structure handing its *values* to another as *keys*.
 *
 * Counting is the boring half. Every tally problem looks the same on screen — a table that grows
 * and then a number that ticks up — and if that were all this animation showed, it would be a
 * picture of `Map` rather than a picture of the answer. The interesting half is the second pass,
 * where each count is offered to a set and the answer is decided by the **first collision**.
 *
 * So the design rule here is: the collision gets a frame of its own, and on that frame the
 * viewer can point at both culprits without reading the caption. Three panels are lit together —
 * the two `occurrences` rows that tie, the `counts claimed` cell they both want, and every
 * position in `arr` holding either value. Nothing else in the trace wears `excluded`, so the
 * moment the answer became `false` is the only crossed-out frame in the run.
 *
 * The mirror of that on a true case is that the run *ends* with every map row `result` and no
 * `excluded` anywhere: "unique" is not the absence of evidence, it is `occurrences.size` rows
 * each of which successfully claimed a distinct count, and the claims are on screen.
 *
 * Two API notes that shaped the code:
 *
 *  - `occurrences.get(v) ?? 0` rather than `peek`. A miss is a real step of the algorithm here
 *    ("this value is new"), and `get` renders it as `get 5 -> miss`; `peek` would make the first
 *    sighting of every value indistinguishable from a re-count.
 *  - `claimed.has(count)` rather than `contains`. This *is* the decision the problem turns on, so
 *    it must be a frame — the one place in the run where the set is interrogated rather than
 *    grown. Every other guard-shaped read in the solution is a non-recording twin.
 */
export function reference(arr: number[], viz: Viz): boolean {
  const a = viz.array(arr, { name: 'arr' })
  const occurrences = viz.map<number, number>([], { name: 'occurrences (value -> count)' })
  const claimed = viz.set<number>([], { name: 'counts claimed' })
  const i = viz.cursor('i', 0, a)
  viz.watch(() => ({ i: i.value, distinct: occurrences.size, claimed: claimed.size }))

  // Instrumentation, not algorithm: where a value sits in the input, so a collision can be
  // pointed at in `arr` and not only in the two panels. `a.at()` is the array's non-recording
  // read, so locating the cells to mark costs no frames of its own.
  const positionsOf = (value: number): number[] =>
    [...Array(a.length).keys()].filter((k) => a.at(k) === value)

  // Pass 1 — tally. Nothing is decided here; the map is just being built.
  for (i.value = 0; i.value < a.length; i.inc()) {
    const value = a[i.value]
    const seenSoFar = occurrences.get(value) ?? 0
    occurrences.set(value, seenSoFar + 1)
    viz.step(
      seenSoFar === 0
        ? `arr[${i.value}] = ${value} is a value we have not seen — start it at 1`
        : `arr[${i.value}] = ${value} again — that is ${seenSoFar + 1} occurrence(s)`,
    )
  }
  viz.step(
    `${a.length} element(s) counted into ${occurrences.size} distinct value(s) — now the counts have to be distinct too`,
  )

  // Pass 2 — the actual question. Offer each count to the set; the first one already there is
  // the answer.
  for (const [value, count] of occurrences) {
    if (claimed.has(count)) {
      // Name the rival. Every count claimed so far belongs to exactly one earlier value, so the
      // first entry carrying this count *is* the value that claimed it. `toEntries()` is the
      // map's non-recording twin, so finding it does not pollute the timeline — the collision
      // frame stays the collision frame.
      const rival = occurrences.toEntries().find(([, c]) => c === count)?.[0] ?? value
      claimed.mark(count, 'excluded', `two values want ${count}`)
      occurrences.mark(rival, 'excluded', `occurs ${count} time(s)`)
      occurrences.mark(value, 'excluded', `occurs ${count} time(s) as well`)
      a.mark(positionsOf(rival), 'excluded', `the ${count} occurrence(s) of ${rival}`)
      a.mark(positionsOf(value), 'excluded', `the ${count} occurrence(s) of ${value}`)
      viz.step(
        `${rival} and ${value} both occur exactly ${count} time(s) — the occurrence counts are not unique`,
      )
      return false
    }

    // The claim is recorded in the set *and* on the row that made it. The set alone says which
    // counts are taken; the marked row says who took them, which is what makes a later collision
    // legible as "somebody already has this" rather than as an unexplained stop.
    claimed.add(count)
    occurrences.mark(value, 'result', `${count} occurrence(s), claimed`)
    viz.step(`${value} occurs ${count} time(s), and no earlier value did — ${count} is claimed`)
  }

  viz.step(
    `all ${occurrences.size} count(s) were different — every value has its own number of occurrences`,
  )
  return true
}

/** Value `v` repeated `v` times, for v = 1..k: k distinct values with k distinct counts. */
function triangle(k: number): number[] {
  return [...Array(k).keys()].flatMap((idx) => Array<number>(idx + 1).fill(idx + 1))
}

const starter = `// Two passes. First count how many times each value occurs, then ask whether those
// counts are all different from each other.
export default function uniqueOccurrences(arr, viz) {
  const a = viz.array(arr, { name: 'arr' })
  const occurrences = viz.map([], { name: 'occurrences (value -> count)' })
  const claimed = viz.set([], { name: 'counts claimed' })
  const i = viz.cursor('i', 0, a)
  viz.watch(() => ({ i: i.value, distinct: occurrences.size, claimed: claimed.size }))

  for (i.value = 0; i.value < a.length; i.inc()) {
    // TODO: tally a[i.value] into \`occurrences\`. occurrences.get(v) returns undefined for a
    // value you have not seen yet, and renders that miss as a frame — which is the picture
    // you want the first time each value shows up.
    viz.step('counting arr[' + i.value + ']')
  }

  // TODO: walk the map with \`for (const [value, count] of occurrences)\` and offer each count
  // to \`claimed\`.
  //   - claimed.has(count) is the one decision this problem makes, so let it be a frame
  //     (claimed.contains(count) is the silent twin, and here you want the noisy one).
  //   - if the count is already claimed, two values tie. That is the whole animation, so light
  //     all three panels on that one frame, not just the map:
  //       * mark BOTH map rows 'excluded' — not only the one you are standing on. The rival is
  //         the row whose count equals this one; occurrences.toEntries() finds it without
  //         recording a frame.
  //       * mark the contested cell in \`claimed\` 'excluded' too — the set is what rejected it.
  //       * mark every position in \`arr\` holding either value 'excluded', so the array says
  //         where the tie came from instead of going dead for the whole second pass.
  //     Then viz.step() naming which two values tie and at what count, and return false.
  //     Two panels out of three is the difference between a picture and an assertion.
  //     occurrences.toEntries() is the map's non-recording twin; the first entry with this
  //     count is the value that claimed it.
  //   - otherwise claimed.add(count) and mark the row 'result', so a viewer can see which row
  //     took which count rather than just that the set got bigger.
  return true
}
`

export const uniqueNumberOfOccurrences: ProblemDefinition = {
  id: 'p1207',
  leetcode: 1207,
  slug: 'unique-number-of-occurrences',
  title: 'Unique Number of Occurrences',
  difficulty: 'easy',
  category: 'hashmap-set',
  statement:
    'Given an array of integers `arr`, return `true` if the number of occurrences of each value ' +
    'in the array is unique, and `false` otherwise. Count how many times each distinct value ' +
    'appears; the answer is `true` exactly when no two distinct values appear the same number of ' +
    'times.',
  structures: ['array', 'map', 'set'],
  // A boolean answer is the easiest kind to accidentally let a solution grade itself on, so the
  // comparator is declared here and compares truthiness against the case's expected value.
  comparator: 'boolean',
  entry: 'uniqueOccurrences',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    {
      // The smallest possible false, and LeetCode's own second example.
      //
      // First on purpose. The workbench opens on case 0, and a `false` answer is the one a stub
      // that does nothing yet cannot accidentally get right — this problem's own note says a
      // boolean is the easiest kind to let a solution grade itself on, and with the `true` case
      // first the untouched starter passed the very case a learner sees first. It was the only
      // problem in the set where that happened.
      name: 'example — two values, one occurrence each',
      args: [[1, 2]],
      expected: false,
      tags: ['example'],
    },
    {
      // 1 -> 3, 2 -> 2, 3 -> 1. Three values, three different counts.
      name: 'example — counts 3, 2 and 1 are all different',
      args: [[1, 2, 2, 1, 1, 3]],
      expected: true,
      tags: ['example'],
    },
    {
      // -3 -> 3, 0 -> 2, 1 -> 4, 10 -> 1.
      name: 'example — negatives and zero, counts 3, 2, 4 and 1',
      args: [[-3, 0, 1, -3, 1, 1, 1, -3, 10, 0]],
      expected: true,
      tags: ['example'],
    },
    {
      // Minimum array size from the constraints. One value, one count, nothing to collide with.
      name: 'single element — one count cannot collide',
      args: [[7]],
      expected: true,
      tags: ['edge'],
    },
    {
      // One map row and one set cell for the whole run: the degenerate shape of both panels.
      name: 'all equal — one value with a count of 4',
      args: [[5, 5, 5, 5]],
      expected: true,
      tags: ['edge'],
    },
    {
      // The collision is on the second row examined — the earliest it can possibly happen.
      name: 'two values tied at 2 — collides on the second row',
      args: [[1, 1, 2, 2]],
      expected: false,
      tags: ['edge'],
    },
    {
      // Value bounds from the constraints, and the tie is between the two extremes.
      name: 'constraint bounds — -1000 and 1000 both occur once',
      args: [[0, 0, -1000, 1000]],
      expected: false,
      tags: ['edge'],
    },
    {
      // 1 -> 3, 2 -> 2, 3 -> 1, 4 -> 1: the tie is only discovered on the very last row, so the
      // set has to be carried all the way to the end before the answer flips.
      name: 'tie discovered on the last row',
      args: [[1, 1, 1, 2, 2, 3, 4]],
      expected: false,
      tags: ['edge'],
    },
    {
      // Same multiset as the example, reordered so first-occurrence order differs. The map's row
      // order changes and the answer does not.
      name: 'order of first appearance does not matter',
      args: [[3, 1, 2, 1, 2, 1]],
      expected: true,
      tags: ['edge'],
    },
    {
      // 20 values with counts 1..20 — 210 elements, 20 map rows, 20 set cells, no collision.
      name: 'twenty values with twenty different counts',
      args: [triangle(20)],
      expected: true,
      tags: ['large'],
    },
    {
      // The same 20, plus a 21st value occurring 7 times — which value 7 already claimed. The
      // collision lands on the last row after 20 successful claims.
      name: 'twenty distinct counts and then one repeat',
      args: [[...triangle(20), ...Array<number>(7).fill(21)]],
      expected: false,
      tags: ['large'],
    },
  ],
  hints: [
    'The question is about the *counts*, not the values. So the first thing you need is, for ' +
      'each distinct value, how many times it appears — a map from value to count.',
    'Once you have that map, the answer is a question about its values alone: are they all ' +
      'different? You never need to look at `arr` again.',
    'Walk the counts and keep the ones you have already seen in a set. The moment a count is ' +
      'already in the set, two different values occur that many times, so the answer is `false`. ' +
      'If you get through every count without a repeat, it is `true`.',
  ],
}
