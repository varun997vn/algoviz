import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 136 — Single Number.
 *
 * The whole solution is one line: `nums.reduce((a, b) => a ^ b)`. That is what makes this the
 * hardest animation in the set so far, not the easiest — a running number changing on screen
 * teaches a viewer that XOR *does something*, not *why it works*. The two facts that make it
 * work are invisible in a decimal accumulator: `x ^ x === 0`, and XOR is commutative and
 * associative, so every pair of equal values cancels regardless of where it sits or which order
 * the scan meets it in.
 *
 * Three ways to make that visible, and why two of them were rejected:
 *
 *  - **The accumulator itself, in binary, as 32 flipping cells.** This is the most literal
 *    reading of "`x ^ x == 0`" — a column that has been touched twice is back to where it
 *    started. But a column that was touched twice looks *identical*, at the end, to one that was
 *    never touched at all: both are 0. The cancellation is only visible mid-scan, so "proving"
 *    the invariant means scrubbing back to catch two flips in the act, for every one of up to 32
 *    columns. Nothing on the final frame — the one a viewer actually studies — shows the fact
 *    that made the algorithm correct.
 *  - **The input array, with each value's partner marked when its duplicate is found.** This
 *    shows pairing, but it does it by inventing bookkeeping — "the partner of index k" — that
 *    the algorithm itself has no notion of and does not need. Worse, it smuggles back in exactly
 *    the thing XOR is notable for *not* needing: a canonical partner, tied to scan order. Two
 *    different orderings of the same multiset would draw two different pairings, which
 *    misrepresents an algorithm whose defining property is that order is irrelevant.
 *  - **A per-bit tally: for each of the 32 bit positions, how many values seen so far have it
 *    set.** This is what is chosen below. `acc`'s bit `b` is exactly `tally[b] % 2` — not
 *    "coincidentally equal to", *equal by definition*, because XOR of a column is the parity of
 *    how many 1s have gone into it.
 *
 *    That identity holds on every **narrated** frame, and the qualifier is load-bearing rather
 *    than an escape hatch. Absorbing one value touches up to 32 columns and one frame per op means
 *    the tally cannot arrive all at once, so mid-update the two genuinely disagree. What can be
 *    chosen is the direction: `acc ^= num` runs *after* the columns it accounts for, so the
 *    picture is ahead of the number rather than the number claiming a result the picture has not
 *    shown. Written the other way round the identity was false on 90% of the frames of a
 *    three-element case — `acc = 7` beside an all-zero tally — which is the model's whole
 *    justification contradicted on screen. "Every bit appears an even
 *    number of times except the lone value's" stops being a claim about the algorithm and
 *    becomes a number on screen a viewer can literally count. And because addition does not care
 *    what order it happens in, the final tally — and therefore the answer — is manifestly the
 *    same no matter what order `nums` is scanned in, which is the commutativity half of the
 *    argument for free, with no extra bookkeeping.
 *
 * `tally` does not feed `acc`; the two are computed independently (`acc` by the real `^=`, the
 * one the `xor` technique tag promises) and the trace-level tests below check that they never
 * disagree — `tally[b] % 2` reconstructs `acc` bit for bit at the end of every case. That
 * agreement is exactly the assertion an impostor cannot fake: a solution that folds `nums` with
 * `^` beside a bare `viz.array(nums)` and nothing else returns every right answer and has no
 * `tally` structure for the check to even look at (see "the frame-sequence checks have teeth" in
 * the test file).
 */
export function reference(nums: number[], viz: Viz): number {
  const a = viz.array(nums, { name: 'nums' })
  // One counter per bit position, ordered MSB (index 0, the sign bit) to LSB (index 31) so the
  // row reads left to right the way a binary literal does.
  const tally = viz.array<number>(32, { name: 'bit tally (count of 1s, MSB->LSB)' })
  const i = viz.cursor('i', 0, a)
  let acc = 0
  viz.watch(() => ({ acc, i: i.value }))

  // Which bit positions are set in a value. `>>> ` reads `num` as an unsigned 32-bit pattern, so
  // a negative number's sign bit lands in tally[0] exactly like any other bit — no special case.
  const setBitsOf = (num: number): number[] => {
    const out: number[] = []
    for (let bit = 0; bit < 32; bit += 1) {
      if ((num >>> (31 - bit)) & 1) out.push(bit)
    }
    return out
  }

  for (i.value = 0; i.value < a.length; i.inc()) {
    const num = a[i.value]
    const bits = setBitsOf(num)
    tally.clearMarks('active')
    tally.mark(bits, 'active', `bit(s) set in nums[${i.value}] = ${num}`)
    // `tally.at` is the non-recording read. Written `tally[bit] = tally[bit] + 1` the proxy
    // recorded a `read` frame per increment as well as the write, so 44% of the trace was the
    // solution reading a counter it had just written — 95 of the 214 frames on a three-element
    // case, and the increment is not a step of the algorithm, it *is* the algorithm's bookkeeping.
    for (const bit of bits) tally[bit] = (tally.at(bit) ?? 0) + 1
    // `acc` last, so the number never announces a column the picture has not counted yet. Written
    // first it landed whole and instantly while the tally caught up one bit at a time over up to
    // 32 frames, and the identity below — the entire justification for this model — was visibly
    // false for most of the run: `acc = 7` beside a tally reading all zeros with 7's three columns
    // lit and holding nothing. The lag is unavoidable (a 32-bit update cannot be one frame) but
    // its direction is not: the picture may lead the number, never the reverse.
    acc ^= num
    viz.step(`xor in nums[${i.value}] = ${num} -> running xor = ${acc}`)
  }

  // The parity of each column *is* the answer: an even count cancelled (x ^ x == 0, and the
  // pair's order never mattered), an odd count survived. This reads the odd columns off `tally`
  // and reconstructs `acc` bit for bit without ever touching `acc`.
  tally.clearMarks('active')
  const resultBits: number[] = []
  for (let bit = 0; bit < 32; bit += 1) {
    if ((tally.at(bit) ?? 0) % 2 === 1) resultBits.push(bit)
  }
  tally.mark(resultBits, 'result', 'odd count -> set in the answer')

  for (let k = 0; k < a.length; k += 1) {
    if (a.at(k) === acc) {
      a.mark(k, 'result', 'the value with no partner')
      break
    }
  }
  viz.step(
    `${resultBits.length} bit(s) had an odd count — everything else cancelled in pairs, leaving ${acc}`,
  )

  return acc
}

const starter = `// Every value in nums appears exactly twice except for one, which appears exactly once.
// Two facts pin down the answer: x ^ x === 0, and XOR does not care about order, so every
// pair cancels wherever it sits. Track both a running XOR and a per-bit tally that counts,
// for each of the 32 bit positions, how many values seen so far have it set — the tally lets
// you *see* the cancellation instead of just computing it.
export default function singleNumber(nums: number[], viz: Viz): number {
  const a = viz.array(nums, { name: 'nums' })
  const tally = viz.array<number>(32, { name: 'bit tally (count of 1s, MSB->LSB)' })
  const i = viz.cursor('i', 0, a)
  let acc = 0
  viz.watch(() => ({ acc, i: i.value }))

  for (i.value = 0; i.value < a.length; i.inc()) {
    // TODO: work out which of the 32 bit positions are set in a[i.value] (MSB at index 0,
    // LSB at index 31 — use (num >>> (31 - bit)) & 1 to read one). Mark those positions
    // 'active' on tally first (tally.clearMarks('active') then tally.mark([...], 'active')),
    // so the picture says which columns this number is about to move. Then add 1 to each of
    // them. Then, LAST, xor the number into acc.
    //
    // That order is the point, not a detail. acc changes in one step and the tally cannot —
    // 32 columns is up to 32 frames — so the two disagree while the tally catches up. With
    // acc first, the watch panel announces a running xor whose columns the picture has not
    // counted yet, and "acc's bit b is tally[b] % 2", the reason this panel exists at all,
    // is visibly false for most of the run. With acc last, the picture only ever leads.
    //
    // Increment with tally[bit] = (tally.at(bit) ?? 0) + 1, not tally[bit] + 1. The proxy
    // records a frame for every read, and reading back a counter you are about to write is
    // not a step of the algorithm — written the other way it is 44% of the whole trace.
    viz.step('xor in nums[' + i.value + ']')
  }

  // TODO: a bit position's final count is odd exactly when it is set in the answer — that is
  // the invariant the whole tally exists to make visible. Mark those positions 'result' on
  // tally (tally.at(bit) is the non-recording read). Then find the index in a whose value
  // equals acc and mark it 'result' too, so the array agrees with the tally.
  return acc
}
`

/**
 * 8 pairs interleaved so no value sits next to its partner, plus one singleton — big enough
 * that the pairing is not visible by eye, small enough to hand-verify: every value below occurs
 * exactly twice except 999999, which occurs once, so the XOR of the whole array is 999999.
 */
const notObviousByEye = [
  3, -9, 47, 999999, 1000000, -256, 3, 17, 5, -9, 12345, 47, 1000000, 17, -256, 12345, 5,
]

export const singleNumber: ProblemDefinition = {
  id: 'p136',
  leetcode: 136,
  slug: 'single-number',
  title: 'Single Number',
  difficulty: 'easy',
  category: 'bit-manipulation',
  statement:
    'Every value in the integer array `nums` appears exactly twice, except for one value which ' +
    'appears exactly once. Find and return that value, using only constant extra space — no ' +
    'counting values into a hash map. Values may be negative.',
  structures: ['array'],
  comparator: 'deep',
  entry: 'singleNumber',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    { name: 'example — singleton last', args: [[2, 2, 1]], expected: 1, tags: ['example'] },
    {
      name: 'example — singleton in the middle',
      args: [[4, 1, 2, 1, 2]],
      expected: 4,
      tags: ['example'],
    },
    {
      name: 'negative pair and negative singleton',
      args: [[-1, -1, -3]],
      expected: -3,
      tags: ['edge'],
    },
    {
      // Minimum array length from the constraints: one value, no pair, nothing to cancel.
      name: 'single element — nothing to pair',
      args: [[42]],
      expected: 42,
      tags: ['edge'],
    },
    { name: 'single negative element', args: [[-17]], expected: -17, tags: ['edge'] },
    { name: 'zero pair, positive singleton', args: [[0, 0, 5]], expected: 5, tags: ['edge'] },
    {
      // -1 is every bit set (all 32 columns at once); this checks the sign bit and every other
      // column all cancel together on the very same frame.
      name: 'all-ones bit pattern cancels',
      args: [[-1, 2, -1]],
      expected: 2,
      tags: ['edge'],
    },
    { name: 'singleton at index 0', args: [[7, 3, 3]], expected: 7, tags: ['edge'] },
    { name: 'singleton at the last index', args: [[3, 3, 9]], expected: 9, tags: ['edge'] },
    {
      // 12 = 1100, 10 = 1010, 6 = 0110: every pair shares at least one bit with the others, so
      // several tally columns are shared work between values, not one column per value.
      name: 'overlapping bit patterns',
      args: [[12, 10, 12, 10, 6]],
      expected: 6,
      tags: ['edge'],
    },
    {
      name: 'seventeen elements, pairing not obvious by eye',
      args: [notObviousByEye],
      expected: 999999,
      tags: ['large'],
    },
  ],
  hints: [
    'If a value appeared twice, `x ^ x` is 0 — it contributes nothing to a running XOR of the ' +
      'whole array, no matter where the two copies sit or which order you meet them in.',
    'So XOR every value in `nums` together, in one pass, into a single accumulator: the paired ' +
      'values all cancel and only the lone value survives.',
    'Bit by bit, this is a counting argument: XOR of a column of bits is 1 exactly when an odd ' +
      'number of the inputs had a 1 there. Every bit position ends up odd only for the value ' +
      'with no partner — everything else was contributed an even number of times.',
  ],
}
