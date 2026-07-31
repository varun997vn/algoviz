import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 875 — Koko Eating Bananas.
 *
 * The first binary search in the set, and deliberately the one that searches an **answer space**
 * rather than a structure. That is the modelling question this problem exists to answer: every
 * other binary search here will put `lo`/`mid`/`hi` on an array that was handed to the solution,
 * and this one has no such array. The thing being halved is the set of speeds 1..max, which is not
 * an input, is not stored anywhere, and in the real constraints has a billion elements.
 *
 * ### The answer space is drawn as an array, and the array is never read
 *
 * `speeds` is `[0, 1, 2, …, max]`, so **index equals speed**: a caret labelled `mid` sits on the
 * number it names. (Building it as `[1, 2, …]` would put `mid = 3` above a cell reading `4`, and a
 * pointer that lies about where it points is worse than an off-by-one in a comment — see the same
 * decision in Longest Common Subsequence. Slot 0 is spent on the illegal speed instead, which has
 * something true to say: eating nothing never finishes.)
 *
 * The panel is materialised purely so the halving is visible. The algorithm computes `mid`
 * arithmetically and **never indexes `speeds` at all** — and that is not a fudge to apologise for,
 * it is exactly the distinction the problem teaches. Searching a structure means reading it;
 * searching an answer space means only that the candidates are ordered and the predicate is
 * monotone. The cases here keep `max(piles)` small enough to draw for that reason, and nothing
 * about the algorithm changes if it is a billion.
 *
 * ### The three mark classes partition the space, and the boundary is the answer
 *
 * A probe has two possible verdicts and they rule out different things, so they get different
 * marks — one class for both would throw away the whole point:
 *
 *  - **too slow** (`excluded`): `mid` cannot finish in `h` hours, so neither can anything slower.
 *    Rules out `[lo, mid]`.
 *  - **fast enough, but not the smallest** (`match`): `mid` finishes in time, so everything faster
 *    than `mid` also finishes — none of them can be the *minimum*. Rules out `[mid + 1, hi]`.
 *
 * Those two ranges tile outward from the answer and never overlap, so when the loop ends every
 * cell is marked exactly once and the final frame reads: a solid block of `excluded`, the
 * `result`, a solid block of `match`. That picture *is* the monotone predicate — the thing that
 * makes binary search legal here — drawn rather than asserted, and the integration test checks the
 * partition exactly, which is why a linear scan that returns the same number cannot pass.
 *
 * Both marks go on in **one frame each** (`mark` takes a list of indices), because ruling out half
 * the space is one decision. Marking them one at a time would cost O(max) frames and would animate
 * a linear scan — the very thing the algorithm is not doing.
 *
 * ### Each probe is itself a computation, so it gets a scope
 *
 * Testing a speed is not a lookup: it walks every pile and sums `ceil(pile / speed)`. `viz.group`
 * nests that under the probe, so the call-stack outline reads `speed 4: does it finish in 8
 * hours?` with the per-pile work inside it. `piles` clears its marks **before** the scope opens
 * rather than as its first statement: otherwise the second probe's picture is the first probe's
 * with more paint on it, and — the reason the placement matters — the frame that *enters*
 * `speed 3: …` still showed speed 6's eaten piles and speed 6's hour count, one frame of two
 * panels describing different probes under a caption naming only one of them.
 */
export function reference(piles: number[], h: number, viz: Viz): number {
  const p = viz.array(piles, { name: 'piles' })
  // `piles` is the raw argument, not the proxy, so finding the maximum records nothing. Eating at
  // the largest pile's speed always finishes — one pile per hour — and the constraints guarantee
  // `h >= piles.length`, so the answer space is guaranteed to contain an answer.
  const fastest = Math.max(...piles)

  const speeds = viz.array(
    Array.from({ length: fastest + 1 }, (_, k) => k),
    { name: 'speeds (bananas per hour)' },
  )
  let lo = 1
  let hi = fastest
  let hours = 0
  let testing = 0
  const loAt = viz.cursor('lo', lo, speeds)
  const hiAt = viz.cursor('hi', hi, speeds)
  const midAt = viz.cursor('mid', lo, speeds)
  viz.watch(() => ({ lo, hi, testing, hours, deadline: h }))

  speeds.mark(0, 'excluded', 'eating nothing never finishes')
  speeds.setWindow(lo, hi)
  viz.step(
    `any speed from 1 to ${fastest} would do — ${fastest} certainly does, since it clears a pile ` +
      `an hour. The question is which is the smallest.`,
  )

  /** Hours needed to clear every pile at `speed`. The probe, and it is a whole loop. */
  const hoursAt = (speed: number): number => {
    // Cleared *before* the scope opens, not inside it. Inside, the frame that entered
    // `speed 3: …` still carried the previous probe's eaten piles and its hour count — one frame
    // of a caption naming one speed over a picture of another. Outside, the probe opens on an
    // empty panel, which is the truth: nothing has been eaten at this speed yet.
    p.clearMarks()
    hours = 0
    return viz.group(`speed ${speed}: does it finish within ${h} hours?`, () => {
      let total = 0
      for (let i = 0; i < p.length; i += 1) {
        // Read **once**, into a local. Written as `Math.ceil(p[i] / speed)` and then `${p[i]}`
        // again in the note, this read every pile twice — one frame for the arithmetic and a
        // second, identical `read [i]` frame that existed only to build a caption. Half the frames
        // in every probe were a sentence being written.
        const pile = p[i]
        // One hour per pile at most, and a partial hour is still an hour — which is the whole
        // reason the answer is not `sum(piles) / h`.
        const needed = Math.ceil(pile / speed)
        total += needed
        // `hours` updated before the mark, so the frame carrying the mark also carries the total it
        // just contributed to. After the mark it would trail by one pile on every frame.
        hours = total
        p.mark(i, 'visited', `${pile} bananas at ${speed}/h takes ${needed} hour(s)`)
      }
      viz.step(
        total <= h
          ? `${total} hours at ${speed}/h — that fits in ${h}`
          : `${total} hours at ${speed}/h — over the ${h}-hour deadline`,
      )
      return total
    })
  }

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    testing = mid
    midAt.value = mid
    const spent = hoursAt(mid)

    if (spent <= h) {
      // `mid` works, so every speed above it works too — and none of *those* can be the smallest
      // speed that works. Half the space, ruled out for being unnecessarily fast.
      if (mid < hi) {
        speeds.mark(between(mid + 1, hi), 'match', `also fast enough, but ${mid} already is`)
      }
      hi = mid
    } else {
      // `mid` is too slow, so everything slower is too slow. Half the space, ruled out for good.
      speeds.mark(between(lo, mid), 'excluded', `${spent} hours at ${mid}/h misses the deadline`)
      lo = mid + 1
    }

    loAt.value = lo
    hiAt.value = hi
    speeds.setWindow(lo, hi)
    viz.step(
      lo === hi
        ? `only ${lo} is left`
        : `${hi - lo + 1} speed(s) still in the running: ${lo} to ${hi}`,
    )
  }

  hours = 0
  testing = lo
  speeds.mark(lo, 'result', `the slowest speed that finishes in ${h} hours`)
  viz.step(
    `${lo} is the answer: everything below it is too slow, everything above it is faster than it ` +
      `needs to be, and the whole space was crossed off ${fastest > 1 ? 'a half at a time' : 'at once'}.`,
  )
  return lo
}

/** `[from, to]` inclusive, as a list of indices — one `mark` call, so one frame for one decision. */
function between(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, k) => from + k)
}

/**
 * 240 piles of a fixed scrambled size, `(j * 37) % 240 + 1`, so every size 1..240 appears exactly
 * once (37 is coprime with 240). The maximum is 240, so the answer space has 241 cells and the
 * search takes 8 probes over 240 piles — enough that a linear scan over speeds would be visibly
 * absurd, and enough that the frame budget is a real number rather than a rounding error. The
 * answer, 180, clears the piles in exactly 300 hours and 179 takes 301, so the case also pins the
 * boundary itself: `<=` versus `<` in the probe's verdict changes what it returns.
 */
const scrambled = Array.from({ length: 240 }, (_, j) => ((j * 37) % 240) + 1)

const starter = `// Binary search, but not over the input — over the *answer*. Any speed from 1 to
// max(piles) is a candidate, eating at max(piles) always finishes (one pile an hour),
// and if a speed works then every faster speed works too. That last fact is what makes
// the space searchable: the "does it finish in time?" answers are all NO and then all
// YES, and you are looking for the boundary.
export default function minEatingSpeed(piles: number[], h: number, viz: Viz): number {
  const p = viz.array(piles, { name: 'piles' })
  const fastest = Math.max(...piles)

  // Index == speed, so the caret labelled mid sits on the number it names. Slot 0 is the
  // illegal speed and is crossed off before anything else happens.
  const speeds = viz.array(
    Array.from({ length: fastest + 1 }, (_, k) => k),
    { name: 'speeds (bananas per hour)' },
  )
  let lo = 1
  let hi = fastest
  let hours = 0
  let testing = 0
  const loAt = viz.cursor('lo', lo, speeds)
  const hiAt = viz.cursor('hi', hi, speeds)
  const midAt = viz.cursor('mid', lo, speeds)
  viz.watch(() => ({ lo, hi, testing, hours, deadline: h }))

  speeds.mark(0, 'excluded', 'eating nothing never finishes')
  speeds.setWindow(lo, hi)
  viz.step('any speed from 1 to ' + fastest + ' would do; which is the smallest?')

  const hoursAt = (speed: number): number => {
    // Cleared BEFORE the scope opens. Inside it, the frame that enters "speed 3" still shows
    // the previous probe's eaten piles and its hour count — a caption naming one speed over a
    // picture of another.
    p.clearMarks()
    hours = 0
    return viz.group('speed ' + speed + ': does it finish within ' + h + ' hours?', () => {
      let total = 0
      // TODO: for each pile, the hours it costs at this speed is Math.ceil(pile / speed) —
      // a partial hour is still an hour, which is why the answer is not sum(piles) / h.
      // Add it to \`total\`, set \`hours = total\` *before* marking the pile 'visited', and
      // give the mark a note saying what that pile cost. Updating \`hours\` after the mark
      // leaves every frame's watch panel one pile behind the picture beside it.
      //
      // Read each pile into a local ONCE — \`const pile = p[i]\` — and use that local in both
      // the arithmetic and the note. \`p[i]\` in the note as well records a second, identical
      // read frame per pile, so half of every probe becomes a caption being written.
      viz.step(total + ' hours at ' + speed + '/h')
      return total
    })
  }

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    testing = mid
    midAt.value = mid
    const spent = hoursAt(mid)

    // TODO: two verdicts, and they rule out different things — so they get different marks.
    //   spent <= h: mid finishes in time, so every speed *above* mid does too, and none of
    //     them can be the smallest one that does. Mark [mid + 1, hi] 'match' and set hi = mid.
    //     (Guard the empty case: when mid === hi there is nothing above it to mark.)
    //   spent > h:  mid is too slow, so everything *below* it is too. Mark [lo, mid]
    //     'excluded' and set lo = mid + 1.
    // Mark the whole range in ONE mark() call — it takes a list of indices. Marking cell by
    // cell costs a frame each and animates a linear scan, which is the one thing this
    // algorithm is not doing.

    loAt.value = lo
    hiAt.value = hi
    speeds.setWindow(lo, hi)
    viz.step(lo + '..' + hi + ' still in the running')
  }

  // TODO: lo === hi now, and that is the answer. Mark it 'result' and return it. The two
  // blocks either side of it are the picture the problem exists for: too-slow on the left,
  // faster-than-necessary on the right, and the boundary between them is the answer.
  return 0
}
`

export const kokoEatingBananas: ProblemDefinition = {
  id: 'p875',
  leetcode: 875,
  slug: 'koko-eating-bananas',
  title: 'Koko Eating Bananas',
  difficulty: 'medium',
  category: 'binary-search',
  statement:
    'Koko has `piles` of bananas and `h` hours before the guards return. She picks an eating ' +
    'speed `k` bananas per hour; each hour she eats from a single pile, and if that pile has ' +
    'fewer than `k` bananas left she eats it and waits out the hour. Return the **smallest** `k` ' +
    'that clears every pile within `h` hours. You are guaranteed `h >= piles.length`.',
  structures: ['array'],
  comparator: 'deep',
  entry: 'minEatingSpeed',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    { name: 'example', args: [[3, 6, 7, 11], 8], expected: 4, tags: ['example'] },
    {
      name: 'example — only as many hours as piles, so she must clear one an hour',
      args: [[30, 11, 23, 4, 20], 5],
      expected: 30,
      tags: ['example'],
    },
    {
      name: 'example — one spare hour is worth seven bananas an hour',
      args: [[30, 11, 23, 4, 20], 6],
      expected: 23,
      tags: ['example'],
    },
    {
      name: 'a single pile with time to spare — the answer is a division, rounded up',
      args: [[9], 4],
      expected: 3,
      tags: ['edge'],
    },
    {
      name: 'the rounding is the whole problem — 4 bananas in 3 hours needs 2/h, not 4/3',
      args: [[4], 3],
      expected: 2,
      tags: ['edge'],
    },
    {
      name: 'every pile is one banana — the search space is a single speed and never halves',
      args: [[1, 1, 1, 1], 4],
      expected: 1,
      tags: ['edge'],
    },
    {
      name: 'one pile, one hour — no choice but to eat it whole',
      args: [[1000], 1],
      expected: 1000,
      tags: ['edge'],
    },
    {
      name: 'one pile, more hours than bananas — the slowest legal speed wins',
      args: [[1000], 1000],
      expected: 1,
      tags: ['edge'],
    },
    {
      name: 'all piles equal, generous deadline',
      args: [[12, 12, 12, 12], 12],
      expected: 4,
      tags: ['edge'],
    },
    {
      name: 'one huge pile beside small ones — the maximum sets the space, the sum sets the answer',
      args: [[1, 1, 1, 999], 10],
      expected: 143,
      tags: ['edge'],
    },
    {
      name: 'the deadline is exactly met, so the answer is feasible by a margin of zero',
      args: [[5, 5, 5], 3],
      expected: 5,
      tags: ['edge'],
    },
    {
      // 300 hours at speed 180 exactly, and 301 at 179 — the deadline is met with nothing to
      // spare, so an off-by-one in either direction of the comparison changes the answer.
      name: '240 scrambled piles in 300 hours, met exactly',
      args: [scrambled, 300],
      expected: 180,
      tags: ['large'],
    },
  ],
  hints: [
    'You cannot search the piles — the answer is not one of them. But you can search the *speeds*: ' +
      'the answer is somewhere between 1 and the largest pile, because eating at the largest ' +
      'pile’s speed clears one pile an hour and you are promised at least that many hours.',
    'Checking a single speed is easy: the hours it costs are `sum(ceil(pile / k))`. Notice that if ' +
      'speed `k` finishes in time then so does every speed above it — the answers to "does this ' +
      'finish?" read NO, NO, …, YES, YES as `k` grows. A sequence like that can be binary searched ' +
      'even though nothing is stored in an array.',
    'Binary search the range `[1, max(piles)]`. When `mid` finishes in time, `mid` might be the ' +
      'answer but nothing above it can be, so set `hi = mid`. When it does not, nothing at or ' +
      'below `mid` can be, so set `lo = mid + 1`. Stop when `lo === hi`. That is ' +
      'O(n log max(piles)).',
  ],
}
