import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 739 — Daily Temperatures.
 *
 * The first real driver for `StackViz`, and the reason it is worth having: the monotonic stack
 * is almost impossible to read off the code, because the interesting fact is not *what* is on
 * the stack but *why the stack is shaped the way it is*.
 *
 * The rendering decision that matters here is what the stack cells contain. The algorithm
 * pushes **day numbers**, and a column of day numbers next to an array of temperatures in the
 * same 30..100-ish range is genuinely ambiguous — you cannot tell whether `73` is a day or a
 * reading. Encoding `day:temp` strings into the stack would fix the picture and wreck the
 * solution, so instead the two panels split the job: the stack shows *which* days are still
 * waiting and in what order, and `temperatures` shows the readings, with every waiting day
 * marked `pinned`. The monotonic invariant is then a visible property of the *array* — the
 * pinned cells read downhill left to right — while the stack shows the LIFO order that makes it
 * hold. A day flips `pinned -> result` on the frame it is popped, and the days still pinned when
 * the scan ends flip to `excluded`: they never warm up, so their answer is 0.
 *
 * Note the invariant is *non-increasing*, not strictly decreasing. "Warmer" is strict, so an
 * equal temperature does not pop, and two tied days sit on the stack together — which is exactly
 * why the `all equal` and `duplicates mid-array` cases are here.
 *
 * `answer` is seeded blank rather than zero-filled, and that is load-bearing. Zero-filled, the
 * panel named `answer` asserted `0` for 40 of 42 days from the first frame of the cold-snap case
 * — the same digit as the two zeros that were the real answer, with nothing to tell them apart.
 * Blank cells make "not decided yet" visible, and the price is that the days that never warm up
 * have to be written explicitly at the end instead of arriving for free, which is an improvement:
 * their 0 is a conclusion the algorithm reaches, and now there is a frame where it reaches it.
 */
export function reference(temperatures: number[], viz: Viz): number[] {
  const t = viz.array(temperatures, { name: 'temperatures' })
  const answer = viz.array<number>(temperatures.length, { name: 'answer', fill: null })
  // Day numbers, not temperatures — the days still waiting for something warmer.
  const waiting = viz.stack<number>([], { name: 'waiting (day #)' })
  const day = viz.cursor('day', 0, t)
  let resolved = 0
  viz.watch(() => ({ day: day.value, waiting: waiting.size, resolved }))

  for (day.value = 0; day.value < t.length; day.inc()) {
    // `requireTop()` is the silent twin of `peek()`, typed as present so the guard needs no cast.
    // `compare` is one frame with both temperatures lit, and returns their ordering — written as
    // `t[waiting.requireTop()] < t[day.value]` this reads identically but emits two lone `read`
    // frames, so the single comparison the whole algorithm turns on never appeared on screen *as*
    // a comparison and the `compare` mark class never showed up once.
    while (!waiting.isEmpty && t.compare(waiting.requireTop(), day.value) < 0) {
      const earlier = waiting.requireTop()
      const wait = day.value - earlier
      // Marked *before* the pop, not after. A day that has already left the stack while still
      // wearing "still waiting" inverts the one heuristic the split panels exist for — rightmost
      // pinned cell == top of stack — and it did so on the pop frames, which are precisely the
      // ones worth stopping on.
      t.mark(earlier, 'result', `warmer after ${wait} days`)
      waiting.pop()
      answer[earlier] = wait
      resolved += 1
      viz.step(`day ${day.value} is the first warmer day for day ${earlier} — waited ${wait}`)
    }

    waiting.push(day.value)
    t.mark(day.value, 'pinned', 'still waiting')
    // Name the *rejection*. Not being warmer than the stack top is the common case, and it had no
    // narration at all — a viewer had to infer it from the absence of a pop.
    const below = waiting.size > 1 ? waiting.toArray()[waiting.size - 2] : undefined
    viz.step(
      below === undefined
        ? `day ${day.value} at ${t.at(day.value)} starts the wait with an empty stack`
        : `day ${day.value} at ${t.at(day.value)} is not warmer than day ${below} at ${t.at(below)} — both keep waiting`,
    )
  }

  // Whatever is left on the stack never saw a warmer day. Their answer is decided *here*, so it
  // is written here: with `answer` seeded blank, a 0 on screen only ever means a decided 0.
  for (const stranded of waiting) {
    answer[stranded] = 0
    t.mark(stranded, 'excluded', 'no warmer day ever comes')
  }
  viz.step(`${waiting.size} day(s) never warmed up — every day still pinned is still on the stack`)

  return answer.toArray()
}

/**
 * A 41-day cold snap — 100 down to 60, one degree per day — followed by a single 100-degree day.
 *
 * Hand-derived answer: day 0 is already at 100 and nothing later beats it, so it waits forever.
 * Every day k in 1..40 is colder than 100 and every day between it and the end is colder still
 * (the run is strictly decreasing), so its first warmer day is the last one, index 41 — a wait of
 * `41 - k`. The last day has no future at all. That makes the whole 41-deep stack drain on one
 * frame-run at the end, which is both the best picture in the set and the case that would blow up
 * if the scan were accidentally quadratic.
 */
const coldSnap = [...Array.from({ length: 41 }, (_, k) => 100 - k), 100]

const starter = `// Scan the days left to right, keeping a stack of day numbers that are still waiting
// for a warmer day. A day only survives on the stack while nothing warmer has shown up,
// so reading the stack from the bottom up the temperatures never increase — which is why
// today only ever has to pop from the top. (Never increase, not strictly decrease: an equal
// temperature is not warmer, so tied days stack up together.)
export default function dailyTemperatures(temperatures: number[], viz: Viz): number[] {
  const t = viz.array(temperatures, { name: 'temperatures' })
  // { fill: null } seeds the panel blank, so an untouched cell reads as "not decided yet"
  // instead of as a 0 you cannot tell apart from a real answer of 0. The catch is that
  // toArray() then refuses to invent a default: every day needs its answer written.
  const answer = viz.array<number>(temperatures.length, { name: 'answer', fill: null })
  const waiting = viz.stack<number>([], { name: 'waiting (day #)' })
  const day = viz.cursor('day', 0, t)
  viz.watch(() => ({ day: day.value, waiting: waiting.size }))

  for (day.value = 0; day.value < t.length; day.inc()) {
    // TODO: while the day on top of the stack is colder than today, pop it — today is its
    // first warmer day, so its answer is the gap between the two days. Then push today.
    //
    // Invariant to preserve: the stack holds the day numbers still waiting, and their
    // temperatures never increase from the bottom of the stack to the top.
    //
    // For the guard, prefer t.compare(waiting.requireTop(), day.value) < 0 over
    // t[waiting.requireTop()] < t[day.value]: same meaning, but one frame with both
    // temperatures lit instead of two frames each showing one of them.
    viz.step('day ' + day.value)
  }

  // TODO: the days still on the stack never warmed up. Write 0 for each of them and mark
  // them 'excluded' — with a blank-seeded answer panel, nothing else will.
  return answer.toArray()
}
`

export const dailyTemperatures: ProblemDefinition = {
  id: 'p739',
  leetcode: 739,
  slug: 'daily-temperatures',
  title: 'Daily Temperatures',
  difficulty: 'medium',
  category: 'monotonic-stack',
  statement:
    'Given an array `temperatures` of daily temperatures, return an array `answer` where ' +
    '`answer[i]` is the number of days you have to wait after day `i` to get a **warmer** ' +
    'temperature. If no future day is warmer, `answer[i] = 0`. "Warmer" is strict, so an equal ' +
    'temperature does not count.',
  structures: ['array', 'stack'],
  comparator: 'deep',
  entry: 'dailyTemperatures',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    {
      name: 'example',
      args: [[73, 74, 75, 71, 69, 72, 76, 73]],
      expected: [1, 1, 4, 2, 1, 1, 0, 0],
      tags: ['example'],
    },
    { name: 'strictly increasing', args: [[30, 40, 50, 60]], expected: [1, 1, 1, 0], tags: ['example'] },
    { name: 'three rising days', args: [[30, 60, 90]], expected: [1, 1, 0], tags: ['example'] },
    {
      name: 'strictly decreasing — nothing ever warms up',
      args: [[90, 80, 70, 60, 50]],
      expected: [0, 0, 0, 0, 0],
      tags: ['edge'],
    },
    {
      name: 'all equal — warmer is strict, so every answer is 0',
      args: [[55, 55, 55, 55]],
      expected: [0, 0, 0, 0],
      tags: ['edge'],
    },
    { name: 'single day', args: [[42]], expected: [0], tags: ['edge'] },
    {
      name: 'duplicates mid-array',
      args: [[73, 74, 74, 76, 73]],
      expected: [1, 2, 1, 0, 0],
      tags: ['edge'],
    },
    {
      name: 'cold streak cleared by one hot day — the whole stack drains at once',
      args: [[80, 70, 60, 50, 90]],
      expected: [4, 3, 2, 1, 0],
      tags: ['edge'],
    },
    {
      name: 'constraint bounds, hottest day first and last',
      args: [[100, 30, 31, 32, 100]],
      expected: [0, 1, 1, 1, 0],
      tags: ['edge'],
    },
    {
      name: 'long cold snap, then one warm day drains a 41-deep stack',
      args: [coldSnap],
      expected: [
        0, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19,
        18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
      ],
      tags: ['large'],
    },
  ],
  hints: [
    'A day is answered by the *first* later day that is warmer, so you can answer a day the ' +
      'moment you meet that warmer day — you never need to look forward.',
    'Keep the days you have not answered yet on a stack. Because you only leave a day there ' +
      'while nothing warmer has arrived, the temperatures on the stack never increase from the ' +
      'bottom to the top. (Never *increase*, not strictly decrease — an equal temperature is not ' +
      'warmer, so two tied days sit on the stack together.)',
    'That ordering is why the top of the stack is enough: if today is warmer than the top, pop ' +
      'it and record `today - that day`, and keep popping. Then push today. Every day is pushed ' +
      'once and popped at most once, so the whole scan is O(n).',
  ],
}
