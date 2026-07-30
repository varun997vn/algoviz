import { beforeAll, describe, expect, it } from 'vitest'
import { executeRun, type CaseResult } from '@algoviz/runner'
import { requireProblem, compare } from '@algoviz/problems'
import { TraceReader, type StructureSnapshot, type Trace } from '@algoviz/tracer'

/**
 * Letter Combinations of a Phone Number — frame-sequence assertions.
 *
 * The return value is worth almost nothing here. A three-line cartesian product returns the
 * identical list, and it is run at the bottom of this file, shown to pass every case, and shown
 * to fail everything above. What separates a search from a product is entirely in the trace:
 *
 * 1. **The lit branch is always a prefix of `word`.** Derived from the trie snapshot alone — the
 *    `path`-marked nodes, walked back to the root — so it says what a viewer sees, not what the
 *    solution believes. It catches the classic backtracking bug in both directions: a choice that
 *    is never un-made leaves a branch lit that the word has already left, and a wrongly-scoped
 *    clear blanks the ancestors that are still chosen.
 * 2. **Recursion depth is the digit position.** `groups.length <= word.length <= groups.length+1`
 *    at every frame, the group at nesting level *k* names `digits[k]`, and the deepest nesting
 *    reached equals `digits.length`. A product has no nesting at all.
 * 3. **The word moves one letter at a time.** Between consecutive frames it changes by at most
 *    one character, it shrinks exactly as many times as it grows, and it ends empty.
 * 4. **One leaf per combination.** The words spelled by the root→terminal paths of the *final
 *    picture* are exactly the returned list.
 */

const PROBLEM = 'letter-combinations-of-a-phone-number'

/** Transcribed independently of the reference, so a typo in either keypad shows up as a failure. */
const KEYPAD: Record<string, string> = {
  '2': 'abc',
  '3': 'def',
  '4': 'ghi',
  '5': 'jkl',
  '6': 'mno',
  '7': 'pqrs',
  '8': 'tuv',
  '9': 'wxyz',
}

type TrieSnapshot = Extract<StructureSnapshot, { kind: 'trie' }>

/** One frame reduced to the four facts every assertion in this file is about. */
interface Shot {
  index: number
  op: string
  groups: string[]
  /** The word under the pen. */
  word: string
  /** The letters on the `path`-marked branch of the drawn tree, root first. */
  lit: string
  /** False when the lit nodes are not one unbroken chain hanging off the root. */
  litIsChain: boolean
  /** Words spelled by root→terminal paths of the drawn tree. */
  leaves: string[]
  /** Contents of the `combinations` panel. */
  out: string[]
}

const CASES = requireProblem(PROBLEM).cases
const digitsOf = (name: string): string => {
  const found = CASES.find((c) => c.name === name)
  if (!found) throw new Error(`no case named "${name}" — cases: ${CASES.map((c) => c.name).join(', ')}`)
  return found.args[0] as string
}

let byName: Map<string, CaseResult>

beforeAll(() => {
  const run = executeRun({ problem: PROBLEM, useReference: true, caseIndex: 'all' })
  expect(run.diagnostics).toEqual([])
  byName = new Map(run.results.map((r) => [r.name, r]))
})

function caseByName(name: string): CaseResult {
  const result = byName.get(name)
  if (!result) throw new Error(`no case named "${name}" — cases: ${[...byName.keys()].join(', ')}`)
  return result
}

/**
 * Read the `path` marks back as a word.
 *
 * Walks up from the one lit node that has no lit child. `litIsChain` is false if there is not
 * exactly one such node, if the walk does not reach the root, or if it does not account for every
 * lit node — i.e. exactly when the picture is claiming to be in two places at once, which is what
 * a backtracking animation looks like when the un-choose is missing.
 */
function litBranch(snapshot: TrieSnapshot): { lit: string; litIsChain: boolean } {
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]))
  const parent = new Map<string, string>()
  for (const n of snapshot.nodes) for (const child of n.children) parent.set(child, n.id)

  const marked = new Set(
    snapshot.marks.filter((m) => m.class === 'path' && !m.transient).map((m) => m.id),
  )
  if (marked.size === 0) return { lit: '', litIsChain: true }

  const tips = [...marked].filter((id) => !(byId.get(id)?.children ?? []).some((c) => marked.has(c)))
  if (tips.length !== 1) return { lit: '', litIsChain: false }

  const chars: string[] = []
  let cursor: string | undefined = tips[0]
  while (cursor !== undefined && marked.has(cursor)) {
    chars.unshift(byId.get(cursor)?.char ?? '?')
    cursor = parent.get(cursor)
  }
  return { lit: chars.join(''), litIsChain: chars.length === marked.size && cursor === snapshot.root }
}

/** Words spelled by the root→terminal paths of the drawn tree. Derived from the snapshot alone. */
function leavesOf(snapshot: TrieSnapshot): string[] {
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]))
  const out: string[] = []
  const walk = (id: string, acc: string): void => {
    const node = byId.get(id)
    if (!node) return
    if (node.terminal && acc !== '') out.push(acc)
    for (const child of node.children) walk(child, acc + (byId.get(child)?.char ?? ''))
  }
  walk(snapshot.root, '')
  return out
}

function shotsOf(trace: Trace): Shot[] {
  const reader = new TraceReader(trace)
  const shots: Shot[] = []
  for (let i = 0; i < reader.frameCount; i += 1) {
    const frame = trace.frames[i]
    if (!frame) throw new Error(`frame ${i} missing`)
    let word = ''
    let lit = ''
    let litIsChain = true
    let leaves: string[] = []
    let out: string[] = []
    for (const snapshot of reader.at(i).values()) {
      if (snapshot.kind === 'string') word = snapshot.value
      if (snapshot.kind === 'array') out = snapshot.values.map(String)
      if (snapshot.kind === 'trie') {
        const branch = litBranch(snapshot)
        lit = branch.lit
        litIsChain = branch.litIsChain
        leaves = leavesOf(snapshot)
      }
    }
    shots.push({ index: i, op: frame.op, groups: frame.groups, word, lit, litIsChain, leaves, out })
  }
  return shots
}

/**
 * Every way this trace could be lying, as a list of strings.
 *
 * One function rather than a dozen loops so the reference, the filled-in starter and the
 * cartesian-product impostor are all held to a single standard — and so the impostor's failures
 * can be named rather than merely counted.
 */
function violations(trace: Trace, digits: string): string[] {
  const shots = shotsOf(trace)
  const bad: string[] = []
  const say = (shot: Shot, why: string): void => {
    bad.push(`${why} @${shot.index} ${shot.op} word=${JSON.stringify(shot.word)} lit=${JSON.stringify(shot.lit)} depth=${shot.groups.length}`)
  }

  let previous: Shot | undefined
  for (const shot of shots) {
    if (!shot.litIsChain) say(shot, 'lit nodes are not one chain from the root')
    if (!shot.word.startsWith(shot.lit)) say(shot, 'the lit branch is not a prefix of the word')
    if (shot.word.length > digits.length) say(shot, 'the word is longer than the input')
    if (shot.groups.length > shot.word.length) say(shot, 'recursion is deeper than the word')
    if (shot.word.length > shot.groups.length + 1) say(shot, 'the word ran ahead of the recursion')
    shot.groups.forEach((label, level) => {
      if (!label.startsWith(`digit ${digits[level]} `)) {
        say(shot, `group at level ${level} does not name digit ${digits[level]} (${label})`)
      }
    })
    if (shot.out.length > shot.leaves.length) say(shot, 'an answer with no leaf behind it')
    if (previous && Math.abs(shot.word.length - previous.word.length) > 1) {
      say(shot, 'the word moved by more than one letter')
    }
    previous = shot
  }

  const deepest = Math.max(0, ...shots.map((s) => s.groups.length))
  if (deepest !== digits.length) bad.push(`deepest recursion was ${deepest}, expected ${digits.length}`)

  const grew = shots.filter((s, i) => i > 0 && s.word.length > (shots[i - 1]?.word.length ?? 0)).length
  const shrank = shots.filter((s, i) => i > 0 && s.word.length < (shots[i - 1]?.word.length ?? 0)).length
  if (grew !== choiceCount(digits)) bad.push(`the word grew ${grew} times, expected ${choiceCount(digits)}`)
  if (shrank !== grew) bad.push(`the word grew ${grew} times but shrank ${shrank} — a choice was never un-made`)

  const last = shots[shots.length - 1]
  if (!last) return ['no frames at all']
  if (last.lit !== '') bad.push(`the final frame still lights "${last.lit}"`)
  if (last.word !== '') bad.push(`the final frame still holds "${last.word}"`)
  return bad
}

/** Nodes a faithful search tree has: one per prefix of every combination. */
function choiceCount(digits: string): number {
  let level = 1
  let total = 0
  for (const digit of digits) {
    level *= (KEYPAD[digit] ?? '').length
    total += level
  }
  return total
}

/** The answer, worked out independently of both the reference and the expected literals. */
function spellings(digits: string): string[] {
  if (digits.length === 0) return []
  let acc = ['']
  for (const digit of digits) acc = acc.flatMap((w) => [...(KEYPAD[digit] ?? '')].map((c) => w + c))
  return acc
}

const NON_EMPTY = CASES.filter((c) => (c.args[0] as string).length > 0).map((c) => c.name)

describe('every case passes, and the picture says the same thing the return value does', () => {
  it.each(CASE_LIST())('%s', (name) => {
    const result = caseByName(name)
    expect(result.error).toBeUndefined()
    expect(result.truncated).toBeUndefined()
    expect(result.passed, `${name}: returned ${JSON.stringify(result.returned)}`).toBe(true)
    expect([...(result.returned as string[])].sort()).toEqual(spellings(digitsOf(name)).sort())
  })

  it('the leaves drawn in the final frame are exactly the returned combinations', () => {
    for (const name of CASE_LIST()) {
      const result = caseByName(name)
      const shots = shotsOf(result.trace)
      const final = shots[shots.length - 1]
      expect(final, name).toBeDefined()
      expect([...(final?.leaves ?? [])].sort(), `${name}: leaves drawn`).toEqual(
        [...(result.returned as string[])].sort(),
      )
      expect(final?.out.length, `${name}: combinations panel`).toBe((result.returned as string[]).length)
    }
  })
})

describe('the trace is a search, not a product', () => {
  it.each(CASE_LIST())('%s holds every frame invariant', (name) => {
    expect(violations(caseByName(name).trace, digitsOf(name))).toEqual([])
  })

  it.each(NON_EMPTY)('%s: the search tree grows one node per choice', (name) => {
    const digits = digitsOf(name)
    const result = caseByName(name)
    const trieId = result.trace.structures.find((s) => s.kind === 'trie')?.id
    expect(trieId, 'a trie structure').toBeDefined()
    const created = result.trace.frames.filter(
      (f) => f.structureId === trieId && f.op === 'insert',
    ).length
    // One node per prefix of every combination, and not one more — a tree, not a list of words
    // drawn side by side.
    expect(created, `${name}: nodes created`).toBe(choiceCount(digits))
  })

  it.each(NON_EMPTY)('%s: every choice is un-made on the way out', (name) => {
    const result = caseByName(name)
    const wordId = result.trace.structures.find((s) => s.kind === 'string')?.id
    const trieId = result.trace.structures.find((s) => s.kind === 'trie')?.id
    const chosen = result.trace.frames.filter((f) => f.structureId === wordId && f.op === 'push').length
    const unchosen = result.trace.frames.filter((f) => f.structureId === wordId && f.op === 'pop').length
    const created = result.trace.frames.filter((f) => f.structureId === trieId && f.op === 'insert').length
    expect(chosen, `${name}: letters written`).toBe(created)
    expect(unchosen, `${name}: letters taken back`).toBe(chosen)
  })

  it.each(NON_EMPTY)('%s: no frame lights a branch deeper than the input', (name) => {
    const digits = digitsOf(name)
    for (const shot of shotsOf(caseByName(name).trace)) {
      expect(shot.lit.length, `${name} @${shot.index}`).toBeLessThanOrEqual(digits.length)
    }
  })

  it('a complete word is announced with the whole branch lit and the recursion at full depth', () => {
    const name = firstCaseName()
    const digits = digitsOf(name)
    const announced = shotsOf(caseByName(name).trace).filter(
      (s) => s.op === 'step' && s.word.length === digits.length,
    )
    expect(announced.length, 'complete-word narrations').toBe(spellings(digits).length)
    for (const shot of announced) {
      expect(shot.lit, `@${shot.index}`).toBe(shot.word)
      expect(shot.groups.length, `@${shot.index}`).toBe(digits.length)
    }
  })
})

describe('the empty input', () => {
  const name = 'example — the empty string spells nothing'

  it('returns [] rather than [""]', () => {
    const result = caseByName(name)
    expect(result.returned).toEqual([])
    expect(result.passed).toBe(true)
  })

  it('still narrates something instead of emitting an empty trace', () => {
    const result = caseByName(name)
    expect(result.trace.frames.filter((f) => f.op === 'step').length).toBeGreaterThan(0)
    const shots = shotsOf(result.trace)
    expect(shots[shots.length - 1]?.leaves).toEqual([])
    expect(violations(result.trace, '')).toEqual([])
  })
})

describe('the comparator is `unordered`, and it has to be', () => {
  // The first problem in the repo to declare it, so it is checked on real data here rather than
  // trusted. `deep` would reject a correct solution that enumerates the letters in another order.
  const problem = requireProblem(PROBLEM)

  it('is declared by the problem, not decided by the solution', () => {
    expect(problem.comparator).toBe('unordered')
  })

  it('accepts the right answer in any order and rejects a wrong multiset', () => {
    const expected = spellings('23')
    expect(compare('unordered', [...expected].reverse(), expected)).toBe(true)
    expect(compare('unordered', [...expected].sort(), expected)).toBe(true)
    expect(compare('deep', [...expected].reverse(), expected)).toBe(false)
    // Same length, same letters, one duplicate instead of one distinct combination.
    const dupe = [...expected.slice(0, -1), expected[0] as string]
    expect(compare('unordered', dupe, expected)).toBe(false)
    expect(compare('unordered', expected.slice(0, -1), expected)).toBe(false)
    expect(compare('unordered', 'ad', expected)).toBe(false)
  })

  it('every case is stated as a set the reference can match in its own order', () => {
    for (const testCase of problem.cases) {
      const digits = testCase.args[0] as string
      expect(compare('unordered', testCase.expected, spellings(digits)), testCase.name).toBe(true)
    }
  })
})

describe('the starter teaches the search, not just the answer', () => {
  // Five problems have shipped with a fix in the reference and the defect left in the starter, so
  // the starter is asserted rather than trusted. This is `problem.starter` with its two TODO
  // blocks filled in exactly as they instruct — including the ordering rule, which is the whole
  // point of the block: un-choose before the letter is erased, never after.
  const filled = `
export default function letterCombinations(digits: string, viz: Viz): string[] {
  const KEYPAD: Record<string, string> = {
    '2': 'abc', '3': 'def', '4': 'ghi', '5': 'jkl',
    '6': 'mno', '7': 'pqrs', '8': 'tuv', '9': 'wxyz',
  }

  const tree = viz.trie([], { name: 'search tree' })
  const word = viz.string('', { name: 'word' })
  const found = viz.array<string>([], { name: 'combinations' })
  viz.watch(() => ({ word: word.toString(), depth: word.length, found: found.length }))

  if (digits.length === 0) {
    viz.step('no digits — there is nothing to spell')
    return []
  }

  const place = (node: string, i: number): void => {
    if (i === digits.length) {
      tree.setTerminal(node, word.toString())
      found.push(word.toString())
      viz.step(\`"\${word}" is complete\`)
      return
    }

    for (const letter of KEYPAD[digits[i]]) {
      word.append(letter)
      const child = tree.addChild(node, letter)
      viz.group(\`digit \${digits[i]} -> '\${letter}'\`, () => place(child, i + 1))
      tree.exitPath(child)
      word.removeLast()
    }
  }

  place(tree.root, 0)
  return found.toArray()
}
`

  it('really is the shipped starter, with only its TODOs filled in', () => {
    // The transcription drifting from the starter is how a starter/reference divergence hides from
    // a test that claims to check it: this file would go on asserting a solution the editor never
    // opens with. Every line of the starter that is not a comment has to survive verbatim.
    const starter = requireProblem(PROBLEM).starter
    const kept = starter
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 6 && !line.startsWith('//'))
    for (const line of kept) expect(filled, `starter line missing: ${line}`).toContain(line)
  })

  it('passes every case when followed literally', () => {
    const run = executeRun({ problem: PROBLEM, source: filled, caseIndex: 'all' })
    expect(run.diagnostics).toEqual([])
    expect(run.results.filter((r) => !r.passed).map((r) => r.name)).toEqual([])
  })

  it('and holds every frame invariant the reference does', () => {
    const run = executeRun({ problem: PROBLEM, source: filled, caseIndex: 'all' })
    for (const result of run.results) {
      expect(violations(result.trace, digitsOf(result.name)), result.name).toEqual([])
    }
  })
})

describe('a cartesian product is not a search', () => {
  // The proof that none of the above is a tautology. This is the solution most people write, it
  // returns the identical list, it declares all three structures so `structures:` still reads
  // right, and it even ends on an identical picture — the same tree, the same leaves, the same
  // answer panel. What it never does is descend, back up, and try the next branch.
  const source = `
export default function letterCombinations(digits: string, viz: Viz): string[] {
  const KEYPAD: Record<string, string> = {
    '2': 'abc', '3': 'def', '4': 'ghi', '5': 'jkl',
    '6': 'mno', '7': 'pqrs', '8': 'tuv', '9': 'wxyz',
  }
  const tree = viz.trie([], { name: 'search tree' })
  const word = viz.string('', { name: 'word' })
  const found = viz.array<string>([], { name: 'combinations' })

  if (digits.length === 0) {
    viz.step('no digits — there is nothing to spell')
    return []
  }

  let acc: string[] = ['']
  for (const digit of digits) {
    const next: string[] = []
    for (const w of acc) for (const letter of KEYPAD[digit]) next.push(w + letter)
    acc = next
  }

  for (const w of acc) {
    word.append(w)
    tree.insert(w)
    found.push(w)
    viz.step(\`"\${w}" is complete\`)
    word.removeLast(w.length)
  }
  return found.toArray()
}
`

  it('answers every case correctly', () => {
    const run = executeRun({ problem: PROBLEM, source, caseIndex: 'all' })
    expect(run.diagnostics).toEqual([])
    expect(run.results.filter((r) => !r.passed).map((r) => r.name)).toEqual([])
    expect(run.passed).toBe(true)
  })

  it('draws the same final picture — same leaves, same answer panel', () => {
    const run = executeRun({ problem: PROBLEM, source, caseIndex: 0 })
    const shots = shotsOf(run.results[0]?.trace as Trace)
    const final = shots[shots.length - 1]
    expect([...(final?.leaves ?? [])].sort()).toEqual(spellings(digitsOf(firstCaseName())).sort())
  })

  it('and fails this file, by name, on the assertions that matter', () => {
    const run = executeRun({ problem: PROBLEM, source, caseIndex: 'all' })
    for (const result of run.results) {
      const digits = digitsOf(result.name)
      const bad = violations(result.trace, digits)
      if (digits.length === 0) continue
      expect(bad.length, `${result.name}: expected violations`).toBeGreaterThan(0)
      // Named, not counted: if these three ever stop being able to tell a product from a search,
      // this test fails rather than quietly passing on some other incidental difference.
      expect(bad.join('\n'), result.name).toMatch(/deepest recursion was 0/)
      if (digits.length > 1) {
        // On a one-digit input a product and a search are genuinely the same shape — the word
        // still moves one letter at a time and still grows once per combination. From two digits
        // on, the product writes whole words and never visits an internal node.
        expect(bad.join('\n'), result.name).toMatch(/the word moved by more than one letter/)
        expect(bad.join('\n'), result.name).toMatch(/the word grew \d+ times, expected/)
      }
    }
  })

  it('never lights a branch at all — the tree is a drawing of the answer, not of the search', () => {
    const run = executeRun({ problem: PROBLEM, source, caseIndex: 0 })
    const shots = shotsOf(run.results[0]?.trace as Trace)
    expect(shots.every((s) => s.lit === '')).toBe(true)
    // Stated as the inverse of the reference's own behaviour, so this stops passing if the
    // reference ever stops lighting the branch it is on.
    expect(shotsOf(caseByName(firstCaseName()).trace).some((s) => s.lit.length > 0)).toBe(true)
  })
})

/** Case names, read lazily so `CASES` is only touched once the registry has resolved. */
function CASE_LIST(): string[] {
  return CASES.map((c) => c.name)
}

function firstCaseName(): string {
  const first = CASES[0]
  if (!first) throw new Error(`"${PROBLEM}" has no cases`)
  return first.name
}
