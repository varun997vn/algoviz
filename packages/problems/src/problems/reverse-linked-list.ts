import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 206 — Reverse Linked List.
 *
 * The list reference, and deliberately the one that drives `ListViz`'s riskiest code path.
 * An iterative reversal is the only common algorithm where the structure is *legitimately
 * broken* while it runs: the moment `current.next = prev` lands, the untouched suffix is no
 * longer reachable from the head, so the renderer's "detached" row is not an edge case here,
 * it is the main event. Every frame in the middle of the run has a non-empty detached row.
 *
 * The one non-obvious instrumentation line is `list.head = prev` inside the loop. LeetCode's
 * plain solution only returns `prev` at the end, but `prev` *is* the head of the reversed
 * portion at every step, and saying so is what makes the picture legible: the reversed prefix
 * grows on the main row while the untouched suffix shrinks on the detached row. Without it the
 * main row would freeze at a single node for the whole run and the animation would explain
 * nothing.
 *
 * `rawNext` is used for the stash on purpose: reading `current.next` would record a `visit`
 * frame for a link we are about to overwrite one line later, so the timeline would show a
 * traversal that the algorithm never performs.
 */
export function reference(head: number[], viz: Viz): number[] {
  const list = viz.list(head, { name: 'list' })
  let current = list.head
  let prev: typeof current = null
  list.cursor('prev', prev)
  list.cursor('current', current)
  viz.watch(() => ({
    prev: prev ? prev.rawValue : 'null',
    current: current ? current.rawValue : 'null',
  }))

  while (current) {
    const next = current.rawNext // stash the rest of the list before clobbering the link
    current.next = prev // the entire algorithm is this one rewire
    prev = current
    current = next

    // Everything from `prev` backwards is already reversed, so `prev` is the head now.
    list.head = prev
    // `current` is moved before `prev`: one cursor per frame means whichever goes second
    // would otherwise share a node with the other for a frame and both labels would pile up.
    list.cursor('current', current)
    list.cursor('prev', prev)
    viz.step(
      current
        ? `reversed ${prev.rawValue}, next up ${current.rawValue}`
        : `reversed ${prev.rawValue} — list exhausted`,
    )
  }

  if (prev) list.mark(prev, 'result', 'new head')
  return list.toArray()
}

const starter = `// Walk the list once, flipping one link per step. You need three references: the
// node behind you (prev), the node you are rewiring (current), and the rest of the
// list (next) — stash next BEFORE overwriting current.next, or the tail is lost.
export default function reverseList(head: number[], viz: Viz): number[] {
  const list = viz.list(head, { name: 'list' })
  let current = list.head
  let prev: typeof current = null
  list.cursor('prev', prev)
  list.cursor('current', current)
  viz.watch(() => ({
    prev: prev ? prev.rawValue : 'null',
    current: current ? current.rawValue : 'null',
  }))

  while (current) {
    // INVARIANT: everything from prev backwards is already reversed, and current is the
    // head of the part nothing has touched yet.
    //
    // TODO: stash current.rawNext (rawNext does not record a frame), point current.next
    // at prev, then advance prev and current. Assign list.head = prev as well, so the
    // reversed prefix stays on the main row and the untouched suffix renders as detached.
    list.cursor('current', current)
    list.cursor('prev', prev)
    viz.step('rewire one link')
    break
  }

  return list.toArray()
}
`

export const reverseLinkedList: ProblemDefinition = {
  id: 'p206',
  leetcode: 206,
  slug: 'reverse-linked-list',
  title: 'Reverse Linked List',
  difficulty: 'easy',
  category: 'linked-list',
  statement:
    'Given the head of a singly linked list, reverse the list and return the new head. The list ' +
    'is handed to you as a plain array of values and your answer is compared as a plain array of ' +
    'the reversed values. Reverse the links in place — do not build a second list. ' +
    'The list has 0 to 5000 nodes and each value is between -5000 and 5000.',
  structures: ['list'],
  comparator: 'deep',
  entry: 'reverseList',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    {
      name: 'example — five ascending nodes',
      args: [[1, 2, 3, 4, 5]],
      expected: [5, 4, 3, 2, 1],
      tags: ['example'],
    },
    { name: 'example — two nodes', args: [[1, 2]], expected: [2, 1], tags: ['example'] },
    { name: 'empty list', args: [[]], expected: [], tags: ['edge'] },
    { name: 'single node stays put', args: [[7]], expected: [7], tags: ['edge'] },
    {
      name: 'duplicate values',
      args: [[4, 4, 4, 4]],
      expected: [4, 4, 4, 4],
      tags: ['edge'],
    },
    {
      name: 'negatives and constraint bounds',
      args: [[-5000, 0, 5000, -1]],
      expected: [-1, 5000, 0, -5000],
      tags: ['edge'],
    },
    { name: 'three nodes, mixed signs', args: [[1, -2, 3]], expected: [3, -2, 1], tags: ['edge'] },
    {
      name: 'longer list stays within the frame budget',
      args: [Array.from({ length: 200 }, (_, i) => i - 100)],
      expected: Array.from({ length: 200 }, (_, i) => 99 - i),
      tags: ['large'],
    },
  ],
  hints: [
    'Keep three references as you walk: `prev`, `current`, and the stashed `next`.',
    'Save `current.next` into `next` *before* you assign `current.next = prev`, otherwise you have thrown away the rest of the list.',
    'The loop ends when `current` is null, and at that point `prev` is the new head — which is why an empty list needs no special case.',
  ],
}
