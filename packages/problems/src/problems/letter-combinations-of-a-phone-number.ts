import type { ProblemDefinition, Viz } from '../types.js'

/** The standard telephone keypad. `1` and `0` carry no letters, so the input never contains them. */
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

/**
 * LeetCode 17 — Letter Combinations of a Phone Number.
 *
 * The first backtracking animation in the repo, so the modelling decision here is the one every
 * later backtracking problem (216 Combination Sum III next) will copy. It is written down at
 * length because the *answer* to this problem is trivial — a triple-nested loop or a repeated
 * cartesian product returns the identical list — and the only thing that distinguishes a search
 * from a product is what the picture does on the way back up.
 *
 * ## Two structures, because "the search" is two different facts
 *
 * 1. **`word` — a `viz.string` that is appended to and truncated.** This is the pen. `append` on
 *    choose, `removeLast` on un-choose, one frame each. A viewer watching only this panel sees
 *    the word grow to full length, shrink by one, grow again — which *is* backtracking, with no
 *    marks or colours involved at all. Nothing can fake it: a cartesian product never shortens
 *    the word it is holding.
 * 2. **`search tree` — a `viz.trie` grown one node per choice.** This is the paper. `viz.tree` was
 *    the obvious candidate and is the wrong one twice over: it is binary (digit `7` has four
 *    branches) and it has no node-insertion API at all, so "the search tree built as you go"
 *    cannot be expressed on it. `VizTrie` is the repo's only n-ary node structure, it lays out
 *    through the same tidy-tree code, its node label *is* a character, and `terminal` already
 *    renders as a ring — which is exactly "a complete word is a leaf". Each digit is a level,
 *    each letter is a branch, and because `addChild` reuses an existing branch, the tree that
 *    accumulates on screen is the real search tree and not a list of words drawn side by side.
 *
 * The two are redundant on purpose, and the redundancy is the check: at every frame the letters
 * on the lit branch of the tree spell the contents of `word`, give or take the single op that is
 * in flight. `combinations` is the third panel and is just the answer filling up, so the leaf
 * count in the picture and the length of the returned list are visibly the same number.
 *
 * ## The choice has to un-happen
 *
 * The classic way a backtracking animation lies is to only ever add: the final frame lights every
 * branch at once and claims the algorithm ended up everywhere simultaneously. So the un-choose is
 * two calls, `unchoose()` then `word.removeLast()`, and the invariant they buy is that the set of
 * `path`-marked nodes is always the live root→node chain — never a node from a branch that has
 * been left.
 *
 * `unchoose()` should be one call into the tracer and is not; see the note on it below. It is the
 * single API gap this problem found.
 *
 * ## Ordering, given one frame per op
 *
 * There is no way to say "these two mutations are one step", so on either side of the recursion
 * two ops that belong together land in different frames and one of them is briefly ahead. The
 * ordering here makes the *tree* the one that trails, in both directions:
 *
 * ```
 * word.append(letter)        tree lit "a",  word "ad"   <- tree behind
 * tree.addChild(...)         tree lit "ad", word "ad"
 *   ...recurse...
 * unchoose()                 tree lit "a",  word "ad"   <- tree behind
 * word.removeLast()          tree lit "a",  word "a"
 * ```
 *
 * So the invariant is **the lit branch is always a prefix of `word`** — every frame, no
 * exceptions. The tree can be one letter behind the pen; it can never be one letter ahead, and in
 * particular it can never still be lighting a branch the search has already left. That is the
 * direction that matters: an animation that briefly under-claims is confusing, one that
 * over-claims is wrong, and "still lit after we left" is the exact failure this problem exists to
 * avoid. Group depth is pinned the same way — `viz.group` opens after the letter is written and
 * closes before it is erased, so `groups.length <= word.length <= groups.length + 1` at every
 * frame, and the group tree the player draws *is* the search tree, level for level.
 *
 * ## `""` is `[]`, not `[""]`
 *
 * The recursion below would happily return `[""]` for an empty input — depth 0 is immediately
 * "complete". LeetCode says no combinations exist, so the empty input is answered before the
 * search starts, with a narrated frame rather than an empty trace: a run that emits nothing at
 * all is indistinguishable from a run that crashed.
 */
export function reference(digits: string, viz: Viz): string[] {
  const tree = viz.trie([], { name: 'search tree' })
  const word = viz.string('', { name: 'word' })
  const found = viz.array<string>([], { name: 'combinations' })
  viz.watch(() => ({ word: word.toString(), depth: word.length, found: found.length }))

  if (digits.length === 0) {
    viz.step('no digits — there is nothing to spell, so there are no combinations (not one empty one)')
    return []
  }

  // The node ids from the root down to the live prefix.
  //
  // Pure bookkeeping for `unchoose`, and it should not exist. `VizTrie` can *add* a `path` mark —
  // every `addChild` sets one — but has no way to take one back off a single node: no `unmark`,
  // no `exitPath`/`onPath` (which is exactly what `VizTree` has, and the reason tree recursion
  // unwinds correctly), and `clearMarks('path')` is global. So the only way to retire one choice
  // is to clear every choice and re-light the ones still standing. With `tree.exitPath(child)`
  // this array and the whole helper collapse into the one line at the un-choose site.
  const branch: string[] = []
  const unchoose = (): void => {
    branch.pop()
    tree.clearMarks('path')
    for (const id of branch) tree.mark(id, 'path')
  }

  const place = (node: string, i: number): void => {
    if (i === digits.length) {
      // Every digit is spent, so this node is a leaf and the word under the pen is an answer.
      tree.setTerminal(node, word.toString())
      found.push(word.toString())
      viz.step(`"${word}" is complete — combination ${found.length}`)
      return
    }

    for (const letter of KEYPAD[digits[i]]) {
      word.append(letter) //                      choose: the letter goes onto the paper...
      const child = tree.addChild(node, letter) // ...and the branch it opens lights up
      branch.push(child)
      viz.group(`digit ${digits[i]} -> '${letter}'`, () => place(child, i + 1))
      unchoose() //        un-choose: the branch goes dark first...
      word.removeLast() // ...and only then does the pen come off the paper
    }
  }

  place(tree.root, 0)
  viz.step(`${digits.length} digit(s) spell ${found.length} combination(s)`)
  return found.toArray()
}

const starter = `// Each digit is a level of a search tree and each of its letters is a branch; a word that has
// used every digit is a leaf. Choose a letter, recurse, then take it back off before trying the
// next one — if the word only ever grows, you are drawing a product, not a search.
export default function letterCombinations(digits: string, viz: Viz): string[] {
  const KEYPAD: Record<string, string> = {
    '2': 'abc', '3': 'def', '4': 'ghi', '5': 'jkl',
    '6': 'mno', '7': 'pqrs', '8': 'tuv', '9': 'wxyz',
  }

  const tree = viz.trie([], { name: 'search tree' })
  const word = viz.string('', { name: 'word' })
  const found = viz.array<string>([], { name: 'combinations' })
  viz.watch(() => ({ word: word.toString(), depth: word.length, found: found.length }))

  // "" has no digits to spell. LeetCode wants [], not [""] — and a narrated frame, so the run
  // shows something instead of an empty trace.
  if (digits.length === 0) {
    viz.step('no digits — there is nothing to spell')
    return []
  }

  // Bookkeeping, not algorithm: \`addChild\` lights the branch it creates, and re-lighting what is
  // left is currently the only way to un-light one node. Call \`unchoose()\` when you take a
  // letter back; leave the rest of this alone.
  const branch: string[] = []
  const unchoose = (): void => {
    branch.pop()
    tree.clearMarks('path')
    for (const id of branch) tree.mark(id, 'path')
  }

  const place = (node: string, i: number): void => {
    if (i === digits.length) {
      // TODO: every digit is spent, so this node is a leaf. Flag it with
      // \`tree.setTerminal(node, word.toString())\`, push \`word.toString()\` onto \`found\`,
      // and narrate it with viz.step.
      return
    }

    // TODO: for each letter of KEYPAD[digits[i]], in order. The order of these six lines is the
    // animation: the branch must go dark *before* the letter is erased, never after, or the tree
    // spends a frame claiming to be somewhere the search has already left.
    //   word.append(letter)                         // choose
    //   const child = tree.addChild(node, letter)
    //   branch.push(child)
    //   viz.group(\`digit \${digits[i]} -> '\${letter}'\`, () => place(child, i + 1))
    //   unchoose()                                  // un-choose
    //   word.removeLast()                           // ...the word must shrink here
  }

  place(tree.root, 0)
  return found.toArray()
}
`

export const letterCombinationsOfAPhoneNumber: ProblemDefinition = {
  id: 'p017',
  leetcode: 17,
  slug: 'letter-combinations-of-a-phone-number',
  title: 'Letter Combinations of a Phone Number',
  difficulty: 'medium',
  category: 'backtracking',
  statement:
    'Given a string of digits from `2`-`9`, return every letter combination the number could ' +
    'spell on a standard telephone keypad (`2` is `abc`, `7` is `pqrs`, `9` is `wxyz`; `1` and ' +
    '`0` map to no letters). The combinations may come back in any order. An empty input spells ' +
    'nothing at all, so it returns an empty list.',
  structures: ['trie', 'string', 'array'],
  comparator: 'unordered',
  entry: 'letterCombinations',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    {
      name: 'example — two digits, three letters each',
      args: ['23'],
      expected: ['ad', 'ae', 'af', 'bd', 'be', 'bf', 'cd', 'ce', 'cf'],
      tags: ['example'],
    },
    {
      name: 'example — the empty string spells nothing',
      args: [''],
      expected: [],
      tags: ['example', 'edge'],
    },
    {
      name: 'example — a single digit is its own letters',
      args: ['2'],
      expected: ['a', 'b', 'c'],
      tags: ['example', 'edge'],
    },
    {
      name: 'a four-letter digit branches four ways',
      args: ['7'],
      expected: ['p', 'q', 'r', 's'],
      tags: ['edge'],
    },
    {
      name: 'the other four-letter digit',
      args: ['9'],
      expected: ['w', 'x', 'y', 'z'],
      tags: ['edge'],
    },
    {
      name: 'the same digit twice — the two levels are independent',
      args: ['22'],
      expected: ['aa', 'ab', 'ac', 'ba', 'bb', 'bc', 'ca', 'cb', 'cc'],
      tags: ['edge'],
    },
    {
      name: 'both four-letter digits — sixteen leaves',
      args: ['79'],
      expected: [
        'pw', 'px', 'py', 'pz',
        'qw', 'qx', 'qy', 'qz',
        'rw', 'rx', 'ry', 'rz',
        'sw', 'sx', 'sy', 'sz',
      ],
      tags: ['edge'],
    },
    {
      name: 'three digits — three levels of recursion',
      args: ['234'],
      expected: [
        'adg', 'adh', 'adi', 'aeg', 'aeh', 'aei', 'afg', 'afh', 'afi',
        'bdg', 'bdh', 'bdi', 'beg', 'beh', 'bei', 'bfg', 'bfh', 'bfi',
        'cdg', 'cdh', 'cdi', 'ceg', 'ceh', 'cei', 'cfg', 'cfh', 'cfi',
      ],
      tags: ['example'],
    },
    {
      name: 'four digits, mixed fan-out',
      args: ['2379'],
      expected: [
        'adpw', 'adpx', 'adpy', 'adpz', 'adqw', 'adqx', 'adqy', 'adqz',
        'adrw', 'adrx', 'adry', 'adrz', 'adsw', 'adsx', 'adsy', 'adsz',
        'aepw', 'aepx', 'aepy', 'aepz', 'aeqw', 'aeqx', 'aeqy', 'aeqz',
        'aerw', 'aerx', 'aery', 'aerz', 'aesw', 'aesx', 'aesy', 'aesz',
        'afpw', 'afpx', 'afpy', 'afpz', 'afqw', 'afqx', 'afqy', 'afqz',
        'afrw', 'afrx', 'afry', 'afrz', 'afsw', 'afsx', 'afsy', 'afsz',
        'bdpw', 'bdpx', 'bdpy', 'bdpz', 'bdqw', 'bdqx', 'bdqy', 'bdqz',
        'bdrw', 'bdrx', 'bdry', 'bdrz', 'bdsw', 'bdsx', 'bdsy', 'bdsz',
        'bepw', 'bepx', 'bepy', 'bepz', 'beqw', 'beqx', 'beqy', 'beqz',
        'berw', 'berx', 'bery', 'berz', 'besw', 'besx', 'besy', 'besz',
        'bfpw', 'bfpx', 'bfpy', 'bfpz', 'bfqw', 'bfqx', 'bfqy', 'bfqz',
        'bfrw', 'bfrx', 'bfry', 'bfrz', 'bfsw', 'bfsx', 'bfsy', 'bfsz',
        'cdpw', 'cdpx', 'cdpy', 'cdpz', 'cdqw', 'cdqx', 'cdqy', 'cdqz',
        'cdrw', 'cdrx', 'cdry', 'cdrz', 'cdsw', 'cdsx', 'cdsy', 'cdsz',
        'cepw', 'cepx', 'cepy', 'cepz', 'ceqw', 'ceqx', 'ceqy', 'ceqz',
        'cerw', 'cerx', 'cery', 'cerz', 'cesw', 'cesx', 'cesy', 'cesz',
        'cfpw', 'cfpx', 'cfpy', 'cfpz', 'cfqw', 'cfqx', 'cfqy', 'cfqz',
        'cfrw', 'cfrx', 'cfry', 'cfrz', 'cfsw', 'cfsx', 'cfsy', 'cfsz',
      ],
      tags: ['large'],
    },
  ],
  hints: [
    'Fix a letter for the first digit and the rest of the word is the same problem on the digits that are left.',
    'Recurse one digit at a time, carrying the word built so far; when every digit has been used, the word is finished and goes into the answer.',
    'After recursing on a letter, take it back off the word before trying the next one — otherwise the second branch inherits the first branch\'s letters. And `""` returns `[]`, not `[""]`.',
  ],
}
