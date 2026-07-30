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
  // Hoisted so the watch panel can show it. The stash is the crux of this problem — the hint says
  // so — and with it scoped inside the loop the animation showed only two of the three references.
  let next: typeof current = null

  list.setCursors({ prev, current })
  viz.watch(() => ({
    prev: prev ? prev.rawValue : 'null',
    current: current ? current.rawValue : 'null',
    next: next ? next.rawValue : 'null',
  }))

  if (!current) viz.step('empty list — nothing to reverse')

  while (current) {
    next = current.rawNext // stash the rest of the list before clobbering the link

    // All three references at once, while they are all distinct: `prev` behind, `current` about to
    // be rewired, `next` saved. Naming the stash in the watch panel alone was half a fix — by the
    // time the iteration narrated itself, `next` had already been copied into `current`, so the
    // panel showed the crux as a duplicate of something else and no node on the canvas was ever
    // labelled as the rest of the list.
    list.setCursors({ prev, current, next })

    current.next = prev // the entire algorithm is this one rewire

    // Recorded *before* the locals advance, so the carets on screen still describe the state this
    // frame is about. `current` is the node just rewired, which is exactly the new head — writing
    // it as `prev` after advancing said the same thing but drew both carets one step stale, and
    // the canvas then contradicted the watch panel rendered right beside it.
    list.head = current

    prev = current
    current = next
    next = null // consumed: leaving it set would show a caret duplicating `current`

    // All the pointers move as one frame, so there is no instant where one has advanced and the
    // others have not, and no instant where two of them appear to collide.
    list.setCursors({ prev, current, next })
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
  let next: typeof current = null
  // setCursors moves every named pointer in ONE frame. list.cursor() moves one at a time,
  // which forces an order, and every order leaves a frame where a caret has moved and the
  // others have not — so the canvas contradicts the watch panel rendered beside it.
  list.setCursors({ prev, current, next })
  viz.watch(() => ({
    prev: prev ? prev.rawValue : 'null',
    current: current ? current.rawValue : 'null',
    next: next ? next.rawValue : 'null',
  }))

  if (!current) viz.step('empty list — nothing to reverse')

  while (current) {
    // INVARIANT: everything from prev backwards is already reversed, and current is the
    // head of the part nothing has touched yet.
    //
    // TODO: stash current.rawNext into next (rawNext does not record a frame) and show all
    // three references with setCursors while they are still distinct. Then point
    // current.next at prev.
    //
    // Assign list.head = current — NOT list.head = prev — and do it BEFORE advancing the
    // locals. The node you just rewired is the new head, so writing it after the advance
    // draws every caret one step stale. Finally advance prev and current, clear next now
    // that it has been consumed, and setCursors once more before narrating.
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
