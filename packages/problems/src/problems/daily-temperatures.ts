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
 * pinned cells read strictly downhill left to right — while the stack shows the LIFO order that
 * makes it hold. A day flips `pinned -> result` the frame it is popped, and the days still
 * pinned when the scan ends flip to `excluded`: they never warm up, so their answer stays 0.
 */
export function reference(temperatures: number[], viz: Viz): number[] {
  const t = viz.array(temperatures, { name: 'temperatures' })
  const answer = viz.array<number>(temperatures.length, { name: 'answer' })
  // Day numbers, not temperatures — the days still waiting for something warmer.
  const waiting = viz.stack<number>([], { name: 'waiting (day #)' })
  const day = viz.cursor('day', 0, t)
  let resolved = 0
  viz.watch(() => ({ day: day.value, waiting: waiting.size, resolved }))

  for (day.value = 0; day.value < t.length; day.inc()) {
    // `top()` is the silent twin of `peek()`: the guard runs on every push as well as every
    // pop, and a recorded peek there would double the timeline for no information.
    while (!waiting.isEmpty && t[waiting.top() as number] < t[day.value]) {
      const earlier = waiting.pop() as number
      const wait = day.value - earlier
      answer[earlier] = wait
      resolved += 1
      t.mark(earlier, 'result', `warmer after ${wait} days`)
      viz.step(`day ${day.value} is the first warmer day for day ${earlier} — waited ${wait}`)
    }
    waiting.push(day.value)
    t.mark(day.value, 'pinned', 'still waiting')
    viz.step(`day ${day.value} at ${t.at(day.value)} joins ${waiting.size - 1} other(s) waiting`)
  }

  // Whatever is left on the stack never saw a warmer day, and `answer` is already 0 there.
  for (const stranded of waiting) t.mark(stranded, 'excluded', 'no warmer day ever comes')
  viz.step(`${waiting.size} day(s) never warmed up`)

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
// so the temperatures of the days on the stack are strictly decreasing bottom to top —
// which is why today only ever has to pop from the top.
export default function dailyTemperatures(temperatures: number[], viz: Viz): number[] {
  const t = viz.array(temperatures, { name: 'temperatures' })
  const answer = viz.array<number>(temperatures.length, { name: 'answer' })
  const waiting = viz.stack<number>([], { name: 'waiting (day #)' })
  const day = viz.cursor('day', 0, t)
  viz.watch(() => ({ day: day.value, waiting: waiting.size }))

  for (day.value = 0; day.value < t.length; day.inc()) {
    // TODO: while the day on top of the stack is colder than today, pop it — today is its
    // first warmer day, so its answer is the gap between the two days. Then push today.
    //
    // Invariant to preserve: the stack holds the day numbers still waiting, and their
    // temperatures are strictly decreasing from the bottom of the stack to the top.
    //
    // Use waiting.top() in the while guard, not waiting.peek() — top() is silent, so the
    // timeline stays one frame per real event.
    viz.step('day ' + day.value)
  }

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
      'while nothing warmer has arrived, the temperatures on the stack are always strictly ' +
      'decreasing from the bottom to the top.',
    'That ordering is why the top of the stack is enough: if today is warmer than the top, pop ' +
      'it and record `today - that day`, and keep popping. Then push today. Every day is pushed ' +
      'once and popped at most once, so the whole scan is O(n).',
  ],
}
