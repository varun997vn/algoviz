import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 933 — Number of Recent Calls.
 *
 * ## Encoding the call sequence
 *
 * 208 (the trie) set the convention for a class-design problem whose entry takes a *sequence* of
 * LeetCode method calls: `[operation, argument][]`, constructor dropped, so a case reads as a
 * script instead of two parallel arrays. `RecentCounter` has exactly one method — `ping(t)` — so
 * pairing every call with the literal string `'ping'` would repeat the same token `pings.length`
 * times for zero information; there is nothing a second array could keep aligned with. The
 * argument here is simply `number[]`, the `t` values in the order `ping` receives them, and
 * `expected` is the array of return values, one per call — the same 1:1 alignment 208 uses,
 * without the constructor's `null` since there is no constructor call to encode.
 *
 * ## What the animation has to explain
 *
 * The queue is not a supporting structure here, it *is* the answer: `ping(t)` pushes `t` onto the
 * back, evicts from the front every timestamp older than `t - 3000`, and the return value is
 * however many are left. The whole problem is "watch old pings fall off the front while new ones
 * arrive at the back" — a queue used exactly as a sliding window over time, which is why this is
 * the first queue problem where the queue is the point rather than a BFS frontier.
 *
 * Three moments matter, and only two of them earn a mark:
 *
 * - **Just arrived.** `push` already flags the newest slot `frontier` for the one frame right
 *   after it lands — see `VizQueue.push` — and that transient mark is the whole story. Nothing
 *   extra is needed to show a ping showing up.
 * - **About to be evicted.** Marked `excluded` immediately before its `shift()` — mark first, then
 *   narrate, then remove, the same order `rotting-oranges` documents for the opposite reason: here
 *   the mark must vanish exactly when its element does, not linger on whatever value slides into
 *   index 0 next. It does, for free: `shift()` re-indexes every mark down by one and drops
 *   anything that lands below zero (`IndexMarkStore.shiftFrom`), so the `excluded` mark set on
 *   index 0 disappears in the very frame that removes index 0. No `clearMarks` call is needed, or
 *   even available — see the note below.
 * - **Still in range.** Deliberately left unmarked. Everything left in the queue after eviction is
 *   in range *by construction* — that is the loop invariant, not a fact worth repainting on every
 *   element on every frame. A third colour covering the whole queue body forever would dilute the
 *   two transitions that actually carry information (arriving, leaving) into permanent background
 *   noise. Marks earn their colour by naming a change, not a steady state.
 *
 * A mark set by index survives the shifts that follow it because `VizQueue` re-indexes marks along
 * with the values on every dequeue — the `excluded` mark on index 0 always means "the element
 * leaving right now", never "whatever happens to be at position 0 next frame", which is exactly
 * what the eviction loop above relies on when it keeps re-marking index 0 call after call.
 *
 * **API gap found writing this**: `VizStack` has `clearMarks()`, `VizQueue` does not — the two
 * share `IndexMarkStore` underneath, so the omission looks accidental rather than deliberate. It
 * was not needed here, because eviction's own `shift()` clears each `excluded` mark as a side
 * effect of removing the element it describes, and nothing else in this solution needs a bulk
 * clear. Left as a note for whichever queue/deque problem needs to reset without dequeuing.
 */
export function reference(pings: number[], viz: Viz): number[] {
  const recent = viz.queue<number>([], { name: 'recent' })
  // The answers, as a panel. Kept as a plain local it was the one thing a viewer parked at the end
  // could not see: the queue shows the last window and the watch shows its size, and the sequence
  // of counts the problem actually returns appeared nowhere. Every other problem in the set that
  // accumulates an answer draws it.
  const out = viz.array<number>(pings.length, { name: 'calls in the last 3000ms', fill: null })
  let cutoff = 0
  // `cutoff`, named for what it is. It was called `oldest_kept`, which is a different quantity and
  // usually a different number: on 106 of 157 frames the panel showed a timestamp no ping ever
  // had, and once the caption below started naming the genuinely-oldest kept ping, the two sat one
  // frame apart stating different values for the same thing. The name is the whole bug — it agreed
  // with the truth only on the boundary cases, which is exactly when it looked right.
  viz.watch(() => ({ pings: recent.size, window_opens_at: cutoff }))

  pings.forEach((t, call) => {
    viz.group(`ping(${t})`, () => {
      // Cutoff first, then the push. The other way round, every enqueue frame shows the new ping
      // already in the queue beside the *previous* call's window — the window trailing the arrival
      // it is meant to bound. This way it leads, which is the harmless direction.
      cutoff = t - 3000
      recent.push(t)

      // The window is inclusive of `t - 3000`, so only strictly older pings leave.
      while (!recent.isEmpty && (recent.front() as number) < cutoff) {
        const evicted = recent.front() as number
        recent.mark(0, 'excluded', `${evicted} < ${cutoff} — outside [${cutoff}, ${t}]`)
        viz.step(`evict ${evicted} — older than the window`)
        recent.shift()
      }

      // Written before the narration that announces it, so the frame carrying the caption also
      // carries the number. The caption names the cutoff every time, not only when something is
      // evicted: `front()` is the silent read, so an eviction test that comes back *false* has no
      // frame of its own — and on the case that exists to prove the boundary is inclusive, that
      // was every test in the run. Its animation was shape-identical to a case with no boundary
      // in it at all, and the one thing it was written to show never reached the screen.
      out[call] = recent.size
      const kept = recent.front() as number
      viz.step(
        `ping(${t}) -> ${recent.size} — the window is [${cutoff}, ${t}], and the oldest ping still ` +
          `in it is ${kept}${kept === cutoff ? ', exactly on the boundary, which counts' : ''}`,
      )
    })
  })

  return out.toArray()
}

const starter = `// A queue is a sliding window over time: every ping enters at the back, and
// everything older than the trailing 3000ms window leaves from the front before you count
// what's left.
export default function recentCounter(pings: number[], viz: Viz): number[] {
  const recent = viz.queue<number>([], { name: 'recent' })
  // The answers, as a panel rather than a plain array -- it is what the problem returns, and a
  // viewer parked at the end should be able to see it.
  const out = viz.array<number>(pings.length, { name: 'calls in the last 3000ms', fill: null })
  let cutoff = 0
  // Named for what it holds. Calling it oldest_kept would be a different quantity and usually a
  // different number -- a timestamp no ping ever had -- agreeing with the truth only on the
  // boundary cases, which is exactly when it looks right.
  viz.watch(() => ({ pings: recent.size, window_opens_at: cutoff }))

  pings.forEach((t, call) => {
    viz.group(\`ping(\${t})\`, () => {
      // TODO: set cutoff = t - 3000 FIRST, then push t onto the back of recent. The other order
      // shows the new ping already queued beside the previous call's window -- the bound
      // trailing the arrival it bounds. Then, while the front of the queue is older than the
      // cutoff (strictly less than -- a ping exactly at the cutoff stays, the window is
      // inclusive), mark it 'excluded' and shift() it off before checking the new front.
      //
      // TODO: write recent.size into out[call] -- that count is the answer to this call --
      // and write it BEFORE the narration below, so the frame carrying the caption also
      // carries the number it is about.
      //
      // Name the cutoff in that caption every time, not only when something is evicted.
      // recent.front() is the silent read, so an eviction test that comes back false has no
      // frame at all -- and on an input where nothing is ever evicted that is every test in
      // the run, leaving an animation identical to one with no window in it.
      viz.step(\`ping(\${t})\`)
    })
  })

  return out.toArray()
}
`

export const numberOfRecentCalls: ProblemDefinition = {
  id: 'p933',
  leetcode: 933,
  slug: 'number-of-recent-calls',
  title: 'Number of Recent Calls',
  difficulty: 'easy',
  category: 'queue',
  statement:
    'You are handed the whole stream of timestamps a `ping(t)` call receives, one call per ' +
    'element and each strictly later than the one before it, and must return, for every call, ' +
    'how many pings — this one included — land in the trailing 3000-millisecond window ending ' +
    'at `t`. LeetCode frames this as a class, `RecentCounter`, with one method; here it is one ' +
    'function over the whole stream of calls, answering once per `ping`.',
  structures: ['queue'],
  comparator: 'deep',
  entry: 'recentCounter',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    {
      name: "example — LeetCode's own call sequence",
      args: [[1, 100, 3001, 3002]],
      expected: [1, 2, 3, 3],
      tags: ['example'],
    },
    {
      name: 'single ping — minimum input',
      args: [[1]],
      expected: [1],
      tags: ['edge'],
    },
    {
      name: 'a ping exactly 3000ms old stays — the window is inclusive',
      args: [[1, 3001]],
      expected: [1, 2],
      tags: ['edge'],
    },
    {
      name: 'one ping evicts several at once',
      args: [[1, 2, 3, 3003]],
      expected: [1, 2, 3, 2],
      tags: ['edge'],
    },
    {
      name: 'nothing is ever evicted — every ping is well within the window',
      args: [[1, 2, 3, 4, 5]],
      expected: [1, 2, 3, 4, 5],
      tags: ['edge'],
    },
    {
      name: 'evictions spread one at a time across separate calls',
      args: [[1, 10000, 10001, 10002]],
      expected: [1, 1, 2, 3],
      tags: ['example'],
    },
    {
      name: 'a steady four-ping window once the ramp-up settles',
      args: [[1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]],
      expected: [1, 2, 3, 4, 4, 4, 4, 4, 4, 4],
      tags: ['large'],
    },
  ],
  hints: [
    "A ping's window is always the trailing 3000ms ending at t, and t only ever increases — so " +
      'nothing that has fallen out of range can ever come back into range later.',
    'Keep every ping seen so far in the order it arrived. The ones that fall out of the window ' +
      'are always the oldest ones still held, so they are always at the front — that is a queue.',
    'After pushing t, pop from the front while `queue.front() < t - 3000`. What is left when that ' +
      "stops is the answer's count.",
  ],
}
