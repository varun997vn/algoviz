import { beforeAll, describe, expect, it } from 'vitest'
import { executeRun, type CaseResult } from '@algoviz/runner'
import { requireProblem } from '@algoviz/problems'
import { TraceReader, type Frame, type StructureSnapshot, type Trace } from '@algoviz/tracer'

/**
 * Implement Trie (Prefix Tree) — frame-sequence assertions.
 *
 * The return value proves nothing at all here, and this file exists to say so out loud: a
 * `Set<string>` of inserted words answers every case in this problem correctly (`search` is
 * `has`, `startsWith` is `.some(w => w.startsWith(p))`) while drawing a trie that never grows a
 * single node. That solution is run at the bottom of this file, shown to pass, and shown to fail
 * the invariants above it.
 *
 * The load-bearing assertions, in order of how much they carry:
 *
 * 1. **The drawn trie justifies the answer.** At the frame that reports each lookup, the words
 *    spelled by the root→terminal paths of the *picture* must answer it the same way the
 *    solution did. This is what a `Set` cannot fake.
 * 2. **Nodes appear only for genuinely new prefixes.** `insert("app")` after `insert("apple")`
 *    emits three `visit` frames and zero `insert` frames; over a whole case the number of nodes
 *    created equals the number of distinct prefixes, and not one more.
 * 3. **`search` and `startsWith` traverse identically.** On the same word their walk frames are
 *    equal op-for-op and label-for-label, and the two runs diverge on exactly one frame: the
 *    verdict mark on the node they both landed on.
 * 4. **A lookup walks exactly as far as the trie can take it.** Depth is derived from the ops
 *    seen so far, independently of the trace, so both over-walking and short-circuiting fail.
 */

const PROBLEM = 'implement-trie-prefix-tree'

type Op = [string, string]
type TrieSnapshot = Extract<StructureSnapshot, { kind: 'trie' }>

const CASES = requireProblem(PROBLEM).cases
const CASE_NAMES = CASES.map((c) => c.name)

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

function opsOf(name: string): Op[] {
  const testCase = CASES.find((c) => c.name === name)
  if (!testCase) throw new Error(`no case named "${name}"`)
  return testCase.args[0] as Op[]
}

function trieAt(reader: TraceReader, frame: number): TrieSnapshot {
  const found = [...reader.at(frame).values()].filter(
    (s): s is TrieSnapshot => s.kind === 'trie',
  )
  expect(found, `frame ${frame} has ${found.length} trie snapshots`).toHaveLength(1)
  return found[0]!
}

function finalTrie(result: CaseResult): TrieSnapshot {
  const reader = new TraceReader(result.trace)
  return trieAt(reader, reader.frameCount - 1)
}

/**
 * Read the picture back as strings: every root→node path, and the subset flagged as a word end.
 *
 * Deliberately derived from the snapshot alone — `char`, `children`, `terminal` — so it says what
 * a viewer sees rather than what the solution believes.
 */
function spell(snapshot: TrieSnapshot): { paths: Set<string>; words: Set<string> } {
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]))
  const paths = new Set<string>()
  const words = new Set<string>()
  const seen = new Set<string>()
  const go = (id: string, acc: string): void => {
    const node = byId.get(id)
    if (!node || seen.has(id)) return
    seen.add(id)
    if (acc !== '') {
      paths.add(acc)
      if (node.terminal) words.add(acc)
    }
    for (const child of node.children) go(child, acc + (byId.get(child)?.char ?? ''))
  }
  go(snapshot.root, '')
  return { paths, words }
}

function prefixesOf(words: Iterable<string>): Set<string> {
  const out = new Set<string>()
  for (const word of words) {
    for (let i = 1; i <= word.length; i += 1) out.add(word.slice(0, i))
  }
  return out
}

/** How far a walk down `word` can get, given only the words inserted before it. */
function reachableDepth(word: string, inserted: readonly string[]): number {
  const present = prefixesOf(inserted)
  let depth = 0
  while (depth < word.length && present.has(word.slice(0, depth + 1))) depth += 1
  return depth
}

/**
 * The trace split into one run per LeetCode call, using the `viz.group()` boundaries.
 *
 * A run starts at its `group` frame and swallows every following frame that is still inside a
 * group — which is every frame the call emits, since the reference wraps each call and nothing
 * else in a scope.
 */
function calls(trace: Trace): { label: string; frames: Frame[] }[] {
  const out: { label: string; frames: Frame[] }[] = []
  for (const frame of trace.frames) {
    if (frame.op === 'group') {
      out.push({ label: (frame.label ?? '').replace(/^enter /, ''), frames: [frame] })
      continue
    }
    if (frame.groups.length === 0) continue
    out[out.length - 1]?.frames.push(frame)
  }
  return out
}

/** The steps of the walk itself: one `visit` per character matched, one `read` per dead end. */
function walkTrace(frames: readonly Frame[]): string[] {
  return frames
    .filter((f) => f.op === 'visit' || f.op === 'read')
    .map((f) => `${f.op} ${f.label ?? ''}`)
}

/** The single `match`/`excluded` mark a lookup leaves on the node it landed on. */
function verdict(snapshot: TrieSnapshot): { id: string; class: string } {
  const found = snapshot.marks.filter(
    (m) => !m.transient && (m.class === 'match' || m.class === 'excluded'),
  )
  expect(found.map((m) => `${m.id}:${m.class}`), 'expected exactly one verdict mark').toHaveLength(1)
  return { id: found[0]!.id, class: found[0]!.class }
}

/** The frame a viewer stops on to read a call's answer. */
function reportingFrame(frames: readonly Frame[]): Frame {
  const steps = frames.filter((f) => f.op === 'step')
  expect(steps.length, 'a call must narrate its result exactly once').toBe(1)
  return steps[0]!
}

describe('the reference solution', () => {
  it('passes every one of its own cases', () => {
    const failures = [...byName.values()].filter((r) => !r.passed)
    expect(
      failures.map(
        (f) => `${f.name}: got ${JSON.stringify(f.returned)}, want ${JSON.stringify(f.expected)}`,
      ),
    ).toEqual([])
  })

  it('drives a trie, and only a trie', () => {
    for (const result of byName.values()) {
      expect(result.trace.structures.map((s) => s.kind), result.name).toEqual(['trie'])
    }
  })

  it('scopes one group per LeetCode call, in order', () => {
    for (const name of CASE_NAMES) {
      const ops = opsOf(name)
      const labels = calls(caseByName(name).trace).map((c) => c.label)
      expect(labels, name).toEqual(ops.map(([op, arg]) => `${op}("${arg}")`))
    }
  })
})

describe('the drawn trie justifies the answer', () => {
  // The assertion the whole file exists for. Everything below narrows *how* the picture is
  // wrong; this one says the picture and the returned array cannot disagree at all.
  it.each(CASE_NAMES)('%s — each answer is readable off the trie at the frame reporting it', (name) => {
    const ops = opsOf(name)
    const result = caseByName(name)
    const reader = new TraceReader(result.trace)
    const runs = calls(result.trace)
    const returned = result.returned as (boolean | null)[]

    let checked = 0
    ops.forEach(([op, arg], i) => {
      if (op === 'insert') return
      const at = reportingFrame(runs[i]!.frames).index
      const { paths, words } = spell(trieAt(reader, at))
      const fromPicture = op === 'search' ? words.has(arg) : paths.has(arg)
      expect(fromPicture, `${runs[i]!.label} at frame ${at}: picture disagrees with the answer`)
        .toBe(returned[i])
      checked += 1
    })
    expect(checked).toBeGreaterThan(0)
  })

  it.each(CASE_NAMES)('%s — the final trie spells exactly the words that were inserted', (name) => {
    const inserted = new Set(opsOf(name).filter(([op]) => op === 'insert').map(([, w]) => w))
    const { paths, words } = spell(finalTrie(caseByName(name)))
    expect([...words].sort(), name).toEqual([...inserted].sort())
    expect([...paths].sort(), name).toEqual([...prefixesOf(inserted)].sort())
  })
})

describe('shared prefixes share nodes', () => {
  it.each(CASE_NAMES)('%s — one node per distinct prefix, and not one more', (name) => {
    const inserted = opsOf(name).filter(([op]) => op === 'insert').map(([, w]) => w)
    const result = caseByName(name)
    // Every node creation is an `insert` op frame; nothing else in the trace emits one.
    const created = result.trace.frames.filter((f) => f.op === 'insert').length
    expect(created, `${name}: nodes created`).toBe(prefixesOf(inserted).size)
    expect(finalTrie(result).nodes.length, `${name}: nodes in the picture`).toBe(created + 1)
  })

  it('walks three existing nodes and creates none when "app" is inserted after "apple"', () => {
    const result = caseByName("example — LeetCode's own call sequence")
    const reader = new TraceReader(result.trace)
    const run = calls(result.trace).find((c) => c.label === 'insert("app")')
    expect(run, 'no insert("app") scope').toBeDefined()

    expect(run!.frames.filter((f) => f.op === 'insert'), 'created a node for an existing prefix')
      .toHaveLength(0)
    expect(run!.frames.filter((f) => f.op === 'visit'), 'did not walk the shared prefix')
      .toHaveLength(3)

    const before = trieAt(reader, run!.frames[0]!.index).nodes.length
    const after = trieAt(reader, run!.frames.at(-1)!.index).nodes.length
    expect(after, 'the trie grew while re-inserting a prefix').toBe(before)

    // And the node it lands on gains the terminal flag it did not have before: that is the
    // entire difference "apple" then "app" makes to the picture.
    const ends = spell(trieAt(reader, run!.frames.at(-1)!.index)).words
    expect([...ends].sort()).toEqual(['app', 'apple'])
  })

  it('re-inserting the same word changes nothing in the picture', () => {
    const result = caseByName('inserting the same word twice changes nothing')
    const reader = new TraceReader(result.trace)
    const runs = calls(result.trace)
    const second = runs[1]!
    expect(second.label).toBe('insert("abc")')
    expect(second.frames.filter((f) => f.op === 'insert')).toHaveLength(0)
    expect(second.frames.filter((f) => f.op === 'visit')).toHaveLength(3)
    expect(trieAt(reader, second.frames.at(-1)!.index).nodes).toHaveLength(4)
  })
})

describe('search and startsWith are the same walk asking a different last question', () => {
  it('walks identically and diverges only on the verdict', () => {
    const result = caseByName('search and startsWith disagree on the same word')
    const reader = new TraceReader(result.trace)
    const runs = calls(result.trace)
    const searchRun = runs.find((c) => c.label === 'search("app")')!
    const prefixRun = runs.find((c) => c.label === 'startsWith("app")')!

    // Frame for frame, op for op, label for label: the traversals are indistinguishable.
    expect(walkTrace(searchRun.frames)).toEqual(walkTrace(prefixRun.frames))
    expect(walkTrace(searchRun.frames)).toHaveLength(3)

    // They land on the same node...
    const searchVerdict = verdict(trieAt(reader, reportingFrame(searchRun.frames).index))
    const prefixVerdict = verdict(trieAt(reader, reportingFrame(prefixRun.frames).index))
    expect(searchVerdict.id).toBe(prefixVerdict.id)
    // ...and disagree about it, because only `search` asks whether it ends a word.
    expect(searchVerdict.class).toBe('excluded')
    expect(prefixVerdict.class).toBe('match')
    expect(result.returned).toEqual([null, false, true])

    // The node they both stopped on is not terminal — that is the reason, visible in the picture.
    const landing = trieAt(reader, reportingFrame(searchRun.frames).index).nodes.find(
      (n) => n.id === searchVerdict.id,
    )
    expect(landing?.char).toBe('p')
    expect(landing?.terminal).toBe(false)
  })

  it('agrees once the shorter word is actually inserted', () => {
    // Same word, same walk, and now `search` gets `match` too — because the node became terminal,
    // not because the traversal changed.
    const result = caseByName("example — LeetCode's own call sequence")
    const reader = new TraceReader(result.trace)
    const runs = calls(result.trace)
    const before = runs.find((c) => c.label === 'search("app")')!
    const after = [...runs].reverse().find((c) => c.label === 'search("app")')!
    expect(before).not.toBe(after)

    expect(walkTrace(before.frames)).toEqual(walkTrace(after.frames))
    expect(verdict(trieAt(reader, reportingFrame(before.frames).index)).class).toBe('excluded')
    expect(verdict(trieAt(reader, reportingFrame(after.frames).index)).class).toBe('match')
  })

  it.each(CASE_NAMES)('%s — every lookup ends on exactly one verdict mark', (name) => {
    const ops = opsOf(name)
    const result = caseByName(name)
    const reader = new TraceReader(result.trace)
    const runs = calls(result.trace)
    ops.forEach(([op], i) => {
      if (op === 'insert') return
      // Throws unless there is exactly one, so a lookup can neither report nothing nor leave
      // two contradictory verdicts on screen.
      verdict(trieAt(reader, reportingFrame(runs[i]!.frames).index))
    })
  })

  it.each(CASE_NAMES)('%s — a call starts from a clean picture', (name) => {
    // Each call clears the previous one's highlights, so nothing a viewer sees mid-run is
    // left over from the call before it.
    const result = caseByName(name)
    const reader = new TraceReader(result.trace)
    for (const run of calls(result.trace)) {
      const clear = run.frames.find((f) => f.op === 'mark')
      expect(clear, `${run.label} never resets the highlights`).toBeDefined()
      expect(trieAt(reader, clear!.index).marks.filter((m) => !m.transient), run.label).toEqual([])
    }
  })
})

describe('a lookup walks exactly as far as the trie can take it', () => {
  it.each(CASE_NAMES)('%s — walk depth matches the longest prefix present', (name) => {
    const ops = opsOf(name)
    const runs = calls(caseByName(name).trace)
    const inserted: string[] = []

    ops.forEach(([op, arg], i) => {
      if (op === 'insert') {
        inserted.push(arg)
        return
      }
      const depth = reachableDepth(arg, inserted)
      const run = runs[i]!
      expect(run.frames.filter((f) => f.op === 'visit'), `${run.label} walked the wrong depth`)
        .toHaveLength(depth)
      // A walk that fell short records one dead-end read and stops; one that made it records none.
      expect(run.frames.filter((f) => f.op === 'read'), `${run.label} dead-end frames`)
        .toHaveLength(depth === arg.length ? 0 : 1)
    })
  })

  it('stops on the shared prefix, not at the first character, when a word diverges late', () => {
    // "apply" against a trie holding only "apple": four characters match, the fifth does not.
    const result = caseByName('the walk falls off in the middle of a word')
    const reader = new TraceReader(result.trace)
    const run = calls(result.trace).find((c) => c.label === 'search("apply")')!
    expect(run.frames.filter((f) => f.op === 'visit')).toHaveLength(4)
    const dead = run.frames.find((f) => f.op === 'read')!
    expect(dead.label).toContain("'y'")
    // The node the walk died on is called out, so the picture shows *where* it failed.
    const stopped = verdict(trieAt(reader, reportingFrame(run.frames).index))
    expect(stopped.class).toBe('excluded')
    expect(trieAt(reader, dead.index).nodes.find((n) => n.id === stopped.id)?.char).toBe('l')
  })

  it('gives up at the root when the first character has no branch', () => {
    const result = caseByName('the walk falls off in the middle of a word')
    const reader = new TraceReader(result.trace)
    const run = calls(result.trace).find((c) => c.label === 'startsWith("b")')!
    expect(run.frames.filter((f) => f.op === 'visit')).toHaveLength(0)
    const stopped = verdict(trieAt(reader, reportingFrame(run.frames).index))
    expect(stopped.id).toBe(trieAt(reader, run.frames.at(-1)!.index).root)
  })

  it('survives an empty trie', () => {
    const result = caseByName('nothing inserted yet')
    expect(result.returned).toEqual([false, false])
    expect(finalTrie(result).nodes).toHaveLength(1)
    expect(result.trace.frames.filter((f) => f.op === 'visit')).toHaveLength(0)
  })
})

describe('the trace stays proportional to the characters typed', () => {
  it.each(CASE_NAMES)('%s', (name) => {
    const ops = opsOf(name)
    const chars = ops.reduce((n, [, arg]) => n + arg.length, 0)
    // One frame per character walked, plus a bounded few per call (group, clear, terminal
    // flag, verdict, narration). Re-walking from the root per character — the obvious wrong
    // way to reuse a whole-word API — is quadratic and blows straight through this.
    const result = caseByName(name)
    expect(result.frameCount, `${name}: ${result.frameCount} frames for ${chars} characters`)
      .toBeLessThanOrEqual(chars + 6 * ops.length + 4)
    expect(result.frameCount).toBeGreaterThan(ops.length)
  })
})

describe('a Set of words is not a trie', () => {
  // The proof that none of the above is a tautology. This solution is textbook-correct for the
  // stated contract and passes every case; it also declares `viz.trie`, so `structures:` still
  // reads `trie` and a reviewer skimming `run_solution` output sees nothing wrong. What it never
  // does is put a node in the picture.
  const source = `
export default function trieOperations(ops: [string, string][], viz: Viz): (boolean | null)[] {
  const t = viz.trie([], { name: 'trie' })
  const words = new Set<string>()
  const out: (boolean | null)[] = []
  for (const [op, arg] of ops) {
    if (op === 'insert') {
      words.add(arg)
      out.push(null)
    } else if (op === 'search') {
      out.push(words.has(arg))
    } else {
      out.push([...words].some((w) => w.startsWith(arg)))
    }
  }
  return out
}
`

  it('answers every case correctly', () => {
    const run = executeRun({ problem: PROBLEM, source, caseIndex: 'all' })
    expect(run.diagnostics).toEqual([])
    expect(run.results.filter((r) => !r.passed).map((r) => r.name)).toEqual([])
    expect(run.passed).toBe(true)
  })

  it('and fails this file, on every assertion that matters', () => {
    const run = executeRun({ problem: PROBLEM, source, caseIndex: 'all' })

    for (const result of run.results) {
      const reader = new TraceReader(result.trace)
      const final = trieAt(reader, reader.frameCount - 1)
      // The picture never grows past the empty root.
      expect(final.nodes, `${result.name}: nodes drawn`).toHaveLength(1)
      expect(spell(final).words, `${result.name}: words drawn`).toEqual(new Set())
      // No walk is ever animated.
      expect(result.trace.frames.filter((f) => f.op === 'visit')).toHaveLength(0)
      expect(result.trace.frames.filter((f) => f.op === 'insert')).toHaveLength(0)
    }

    // Stated as the inverse of the two invariants above, so this test fails if those ever stop
    // being able to tell the difference.
    const example = run.results.find((r) => r.name === CASE_NAMES[0])!
    const inserted = new Set(opsOf(example.name).filter(([op]) => op === 'insert').map(([, w]) => w))
    expect(inserted.size).toBeGreaterThan(0)
    expect([...spell(trieAt(new TraceReader(example.trace), example.frameCount - 1)).words])
      .not.toEqual([...inserted])
    expect(
      example.trace.frames.filter((f) => f.op === 'insert').length,
      'the Set solution must not create one node per distinct prefix',
    ).not.toBe(prefixesOf(inserted).size)
  })
})
