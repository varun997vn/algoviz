import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 1768 — Merge Strings Alternately.
 *
 * The three-structure string reference: two read-only sources and one string that is *built*.
 * It is the smallest problem where the interesting thing to animate is not a decision but a
 * *transfer* — every frame, one character leaves a source and arrives in the output — so the
 * picture is only honest if the two sides stay in agreement. Consumed characters are marked
 * `visited` in their source, which makes the phase change the problem is really about
 * (one string runs dry, the other drains alone) visible instead of merely implied.
 *
 * Control flow is the plain interview solution unchanged: one loop, two bounds-checked appends.
 */
export function reference(word1: string, word2: string, viz: Viz): string {
  const a = viz.string(word1, { name: 'word1' })
  const b = viz.string(word2, { name: 'word2' })
  const merged = viz.string('', { name: 'merged' })
  const i = viz.cursor('i', 0, a)
  const j = viz.cursor('j', 0, b)
  viz.watch(() => ({ i: i.value, j: j.value, merged: merged.toString() }))

  // Invariant: `merged` holds word1[0..i) and word2[0..j) interleaved, word1 first in each
  // pair, so i and j never differ by more than one while both strings still have characters.
  while (i.value < a.length || j.value < b.length) {
    const takeA = i.value < a.length
    const takeB = j.value < b.length

    if (takeA) {
      merged.append(a.charAt(i.value))
      a.mark(i.value, 'visited')
      i.inc()
    }
    if (takeB) {
      merged.append(b.charAt(j.value))
      b.mark(j.value, 'visited')
      j.inc()
    }

    // Narrate the *decision*, not the accumulator. Labelling every step `merged: <whole string>`
    // duplicated the panel beside it and never once said why the pattern changed — so the moment
    // the merge stops alternating and starts draining a tail, which is the only interesting event
    // in this problem, was invisible in the timeline.
    if (takeA && takeB) viz.step(`take from both: ${a.peek(i.value - 1)} then ${b.peek(j.value - 1)}`)
    else if (takeA) viz.step(`word2 exhausted — draining word1's tail from index ${i.value - 1}`)
    else viz.step(`word1 exhausted — draining word2's tail from index ${j.value - 1}`)
  }

  return merged.toString()
}

const starter = `// Walk both strings at once, always taking from word1 first. When one of them runs
// out, the other simply drains to the end.
export default function mergeAlternately(word1: string, word2: string, viz: Viz): string {
  const a = viz.string(word1, { name: 'word1' })
  const b = viz.string(word2, { name: 'word2' })
  const merged = viz.string('', { name: 'merged' })
  // A caret per string, so you can see each one advance independently.
  const i = viz.cursor('i', 0, a)
  const j = viz.cursor('j', 0, b)
  viz.watch(() => ({ i: i.value, j: j.value, merged: merged.toString() }))

  while (i.value < a.length || j.value < b.length) {
    // TODO: hold the invariant that merged always contains word1[0..i) and word2[0..j)
    // interleaved, with word1 taking the earlier slot of every pair. Append the next
    // character from a if i is still in range, then from b if j is, advancing each
    // cursor you actually read. a.charAt(i.value) records the read; a.peek does not.
    viz.step(\`merged: \${merged}\`)
    break
  }

  return merged.toString()
}
`

export const mergeStringsAlternately: ProblemDefinition = {
  id: 'p1768',
  leetcode: 1768,
  slug: 'merge-strings-alternately',
  title: 'Merge Strings Alternately',
  difficulty: 'easy',
  category: 'array-string',
  statement:
    'You are given two strings `word1` and `word2`. Merge them by adding letters in alternating ' +
    'order, starting with `word1`. If one string is longer than the other, append the additional ' +
    'letters onto the end of the merged string. Return the merged string.',
  structures: ['string'],
  comparator: 'deep',
  entry: 'mergeAlternately',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    { name: 'equal lengths', args: ['abc', 'pqr'], expected: 'apbqcr', tags: ['example'] },
    { name: 'word2 longer', args: ['ab', 'pqrs'], expected: 'apbqrs', tags: ['example'] },
    { name: 'word1 longer', args: ['abcd', 'pq'], expected: 'apbqcd', tags: ['example'] },
    { name: 'single character each', args: ['a', 'b'], expected: 'ab', tags: ['edge'] },
    {
      name: 'word1 much longer, word2 a single letter',
      args: ['abcdefgh', 'z'],
      expected: 'azbcdefgh',
      tags: ['edge'],
    },
    {
      name: 'word2 much longer, word1 a single letter',
      args: ['z', 'abcdefgh'],
      expected: 'zabcdefgh',
      tags: ['edge'],
    },
    {
      name: 'ten and ten, fully interleaved',
      args: ['abcdefghij', 'klmnopqrst'],
      expected: 'akblcmdneofpgqhrisjt',
      tags: ['edge'],
    },
    {
      // The constraint ceiling: 100 against 1, the largest disparity the problem allows.
      name: 'maximum length disparity',
      args: ['a'.repeat(100), 'b'],
      expected: `ab${'a'.repeat(99)}`,
      tags: ['edge', 'large'],
    },
  ],
  hints: [
    'Keep one index per string. A single shared index only works while both strings still have ' +
      'characters left.',
    'One loop that runs while *either* index is still in range handles the leftover tail for ' +
      'free — no second loop needed.',
    'Guard each append with its own bounds check, and always take from `word1` before `word2` ' +
      'within an iteration.',
  ],
}
