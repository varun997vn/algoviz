import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 208 — Implement Trie (Prefix Tree).
 *
 * ## Encoding a class-design problem as a pure function
 *
 * Every other problem in this repo is `f(input) -> answer`. 208 is not: LeetCode hands you a
 * *sequence of method calls* on an object and compares the *sequence of return values*. The
 * harness calls one entry function per case, so the operation sequence has to be an argument.
 * The convention chosen here, and the reasoning, because the next design problem should follow
 * it rather than invent a second one:
 *
 * 1. **One argument: an array of `[op, arg]` pairs.** LeetCode's own JSON form is two parallel
 *    arrays (`["Trie","insert","search"]` and `[[],["apple"],["app"]]`), which forces you to
 *    count indices to see which word belongs to which call. Pairs keep the two together, so a
 *    case reads top-to-bottom as a script. It is also a single argument, so `entry` keeps the
 *    same `(input, viz)` shape as every other problem and `cases[].args` stays one element long.
 * 2. **The constructor call is dropped.** LeetCode's first entry is `"Trie"` with `null`
 *    expected. It encodes nothing — the trie always starts empty — and keeping it would force
 *    the learner's dispatch loop to special-case a no-op before writing any algorithm.
 * 3. **`expected` stays aligned 1:1 with the ops, `null` for `insert`.** That is LeetCode's own
 *    output shape, and it means a failing case names the operation *index* directly instead of
 *    making you re-derive which of the answered calls disagreed. `deep` is therefore the
 *    comparator: order matters and the nulls have to be exactly where LeetCode puts them.
 * 4. **The dispatch loop is in the starter, the three methods are not.** The learner is here to
 *    write `insert` / `search` / `startsWith`, not a parser. The starter hands over the loop,
 *    the `viz.group()` per call and the result array; the three bodies are the TODO — which is
 *    exactly the three methods LeetCode asks for.
 *
 * Note for whoever picks up 1268 (Search Suggestions System): that one is genuinely a pure
 * function, `(products, searchWord) -> string[][]`, so it needs none of this. The convention
 * above is for the *class-design* problems (211, 155, 146 …). What 1268 does share is the
 * node-level walk below.
 *
 * ## What the animation has to explain
 *
 * Two things, and they are the entire content of the problem:
 *
 * - **Shared prefixes share nodes.** `insert("app")` after `insert("apple")` must visibly walk
 *   three existing nodes and create none. That is why `insert` steps character by character with
 *   `t.addChild` instead of handing a whole word to the trie: the frame that reuses a node and
 *   the frame that creates one are different ops (`visit` vs `insert`), so the picture states
 *   which happened.
 * - **`search` and `startsWith` are the same walk.** They share `walk()` here on purpose — the
 *   frame sequences for `search("app")` and `startsWith("app")` are identical right up to the
 *   final node, and then differ by exactly one question: is that node flagged as the end of a
 *   word? `startsWith` never asks it.
 */
export function reference(ops: [string, string][], viz: Viz): (boolean | null)[] {
  const t = viz.trie([], { name: 'trie' })
  const out: (boolean | null)[] = []
  let words = 0
  viz.watch(() => ({ words, answered: out.length }))

  const insert = (word: string): void => {
    let node = t.root
    for (const ch of word) node = t.addChild(node, ch)
    t.setTerminal(node, word)
    words += 1
  }

  /** Follow one child per character. Null the moment a character has no branch. */
  const walk = (word: string): string | null => {
    let node: string | null = t.root
    for (const ch of word) {
      node = t.child(node, ch)
      if (node === null) return null
    }
    return node
  }

  const search = (word: string): boolean => {
    const node = walk(word)
    if (node === null) return false
    const ends = t.isTerminal(node)
    t.mark(node, ends ? 'match' : 'excluded', ends ? `end of "${word}"` : `"${word}" is only a prefix`)
    return ends
  }

  const startsWith = (prefix: string): boolean => {
    const node = walk(prefix)
    if (node === null) return false
    t.mark(node, 'match', `every word below starts with "${prefix}"`)
    return true
  }

  for (const [op, arg] of ops) {
    viz.group(`${op}("${arg}")`, () => {
      t.clearMarks()
      if (op === 'insert') {
        insert(arg)
        out.push(null)
        viz.step(`inserted "${arg}" — ${words} word(s) in the trie`)
        return
      }
      const answer = op === 'search' ? search(arg) : startsWith(arg)
      out.push(answer)
      viz.step(
        op === 'search'
          ? `search("${arg}") -> ${answer}`
          : `startsWith("${arg}") -> ${answer}`,
      )
    })
  }

  return out
}

const starter = `// A trie stores one character per edge, so words sharing a prefix share nodes.
// viz.trie() owns the nodes and the drawing; you write the walk.
//
//   t.root                  the empty node every word starts from
//   t.addChild(id, ch)      child on 'ch', created if missing        -> node id
//   t.child(id, ch)         child on 'ch', or null if there is none  -> node id | null
//   t.isTerminal(id)        is this node the end of a word? (records nothing)
//   t.setTerminal(id, word) flag it as the end of a word
//   t.mark(id, cls, note)   highlight a node: 'match' | 'excluded' | 'result' | ...
//   t.clearMarks()          drop the highlights the previous call left behind
export default function trieOperations(ops: [string, string][], viz: Viz): (boolean | null)[] {
  const t = viz.trie([], { name: 'trie' })
  const out: (boolean | null)[] = []
  let words = 0
  viz.watch(() => ({ words, answered: out.length }))

  const insert = (word: string): void => {
    // TODO: step down one character at a time from t.root, creating the child when the
    // branch is missing, then flag the node you end on as the end of a word.
    words += 1
  }

  const search = (word: string): boolean => {
    // TODO: follow one child per character. Give up as soon as a character has no branch.
    //
    // Then mark the node you land on with your verdict — t.mark(id, 'match') when the word
    // is really here, t.mark(id, 'excluded') when the walk ended somewhere that is not the
    // end of a word. Without that mark the two lookups below draw exactly the same frames
    // and disagree only in the caption, which is the one thing this problem exists to show.
    return false
  }

  const startsWith = (prefix: string): boolean => {
    // TODO: the same walk as search — but a different question at the end, and therefore a
    // different mark on the very same node. Those two frames are the payoff: identical walk,
    // one glyph apart.
    return false
  }

  for (const [op, arg] of ops) {
    viz.group(\`\${op}("\${arg}")\`, () => {
      t.clearMarks()
      if (op === 'insert') {
        insert(arg)
        out.push(null)
        viz.step(\`inserted "\${arg}"\`)
        return
      }
      const answer = op === 'search' ? search(arg) : startsWith(arg)
      out.push(answer)
      viz.step(\`\${op}("\${arg}") -> \${answer}\`)
    })
  }

  return out
}
`

export const implementTrie: ProblemDefinition = {
  id: 'p208',
  leetcode: 208,
  slug: 'implement-trie-prefix-tree',
  title: 'Implement Trie (Prefix Tree)',
  difficulty: 'medium',
  category: 'trie',
  statement:
    'A trie is a tree that stores one character per edge, so every word sharing a prefix shares ' +
    'the nodes for that prefix. Implement `insert(word)`, `search(word)` — true only if the exact ' +
    'word was inserted — and `startsWith(prefix)` — true if any inserted word begins with it. ' +
    'You are given the calls as `[operation, argument]` pairs and must return one result per ' +
    'call, `null` for `insert`.',
  structures: ['trie'],
  comparator: 'deep',
  entry: 'trieOperations',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    {
      name: "example — LeetCode's own call sequence",
      args: [
        [
          ['insert', 'apple'],
          ['search', 'apple'],
          ['search', 'app'],
          ['startsWith', 'app'],
          ['insert', 'app'],
          ['search', 'app'],
        ],
      ],
      expected: [null, true, false, true, null, true],
      tags: ['example'],
    },
    {
      name: 'example — a shorter word inserted into an existing branch',
      args: [
        [
          ['insert', 'apple'],
          ['insert', 'app'],
          ['search', 'app'],
          ['search', 'appl'],
          ['startsWith', 'appl'],
          ['search', 'apple'],
        ],
      ],
      expected: [null, null, true, false, true, true],
      tags: ['example'],
    },
    {
      name: 'search and startsWith disagree on the same word',
      args: [
        [
          ['insert', 'apple'],
          ['search', 'app'],
          ['startsWith', 'app'],
        ],
      ],
      expected: [null, false, true],
      tags: ['edge'],
    },
    {
      name: 'nothing inserted yet',
      args: [
        [
          ['search', 'a'],
          ['startsWith', 'a'],
        ],
      ],
      expected: [false, false],
      tags: ['edge'],
    },
    {
      name: 'single-letter word',
      args: [
        [
          ['insert', 'a'],
          ['search', 'a'],
          ['startsWith', 'a'],
          ['search', 'ab'],
          ['startsWith', 'ab'],
        ],
      ],
      expected: [null, true, true, false, false],
      tags: ['edge'],
    },
    {
      name: 'inserting the same word twice changes nothing',
      args: [
        [
          ['insert', 'abc'],
          ['insert', 'abc'],
          ['search', 'abc'],
          ['search', 'ab'],
          ['startsWith', 'ab'],
        ],
      ],
      expected: [null, null, true, false, true],
      tags: ['edge'],
    },
    {
      name: 'branches that diverge at the first and last character',
      args: [
        [
          ['insert', 'cat'],
          ['insert', 'car'],
          ['insert', 'dog'],
          ['search', 'ca'],
          ['startsWith', 'ca'],
          ['search', 'car'],
          ['startsWith', 'do'],
          ['startsWith', 'dow'],
        ],
      ],
      expected: [null, null, null, false, true, true, true, false],
      tags: ['example'],
    },
    {
      name: 'the walk falls off in the middle of a word',
      args: [
        [
          ['insert', 'apple'],
          ['search', 'apply'],
          ['startsWith', 'apz'],
          ['startsWith', 'b'],
          ['search', 'applesauce'],
        ],
      ],
      expected: [null, false, false, false, false],
      tags: ['edge'],
    },
  ],
  hints: [
    'Words that share a prefix share nodes: inserting "app" after "apple" should create no new ' +
      'nodes at all, only walk the three that are already there.',
    '`search` and `startsWith` do exactly the same walk — one child per character, giving up the ' +
      'moment a character has no branch. Write it once and call it from both.',
    'The only difference is the last question. `startsWith` is true as soon as the walk survives ' +
      'to the end of the prefix; `search` additionally needs `t.isTerminal` on the node it landed on.',
  ],
}
