import type { ProblemDefinition, Viz } from '../types.js'

/**
 * A string clipped for a one-line narration label.
 *
 * The pieces this algorithm carries around reach 60 characters on the largest case, and a step
 * label is a caption, not a panel. The panels carry the full value; the caption quotes a clipped
 * form and says how much it left out, so a label never silently shows a prefix as if it were the
 * whole thing.
 */
function quote(text: string, max = 12): string {
  return text.length <= max ? `"${text}"` : `"${text.slice(0, max)}…" (${text.length} chars)`
}

/**
 * LeetCode 394 — Decode String.
 *
 * The first problem in this repo where a stack stands in for *recursion* rather than for a
 * monotonic invariant, and the difference is the whole reason it is worth animating. In Daily
 * Temperatures the stack's shape is the fact being taught. Here the stack's **height** is the
 * fact being taught: it is literally the bracket nesting depth, so "how deep am I?" is answered
 * by looking at the picture rather than by counting brackets in the source string.
 *
 * ### Two stacks, not one
 *
 * A `[` has to save two things — the text built so far, and the count that will repeat what comes
 * next — and `VizStack<T extends Primitive>` cannot hold a pair. The three options were:
 *
 *  1. **one stack of encoded pairs** (`"3×ab"`). One panel, exact depth on every frame — and the
 *     solution has to `split` the cell back apart on every pop. Daily Temperatures rejected
 *     exactly this trade in its own docstring ("encoding `day:temp` strings into the stack would
 *     fix the picture and wreck the solution"), and it would wreck it harder here, because the
 *     saved text is arbitrary and would need escaping.
 *  2. **one stack of counts, text kept in a plain array.** Half the state invisible; the panel
 *     would show numbers going up and down with no way to see what they apply to.
 *  3. **two parallel stacks** — the one taken. `counts.push(k)` and `saved.push(built)` are the
 *     two lines a plain interview solution writes anyway, so nothing is contorted, and the two
 *     panels *align row for row*: `StackViz` draws top-down with a fixed cell height, so slot d of
 *     `repeat counts` sits at the same y as slot d of `text before the [`. Reading a pair off the
 *     screen is a horizontal glance, not the bottom-to-top-versus-left-to-right rotation Daily
 *     Temperatures has to apologise for.
 *
 * The price is the known one-frame-per-op gap: two pushes cannot land on one frame. It is spent
 * in a chosen direction. `counts` is pushed **first** and popped **last**, which makes it the
 * depth gauge that is never behind — `saved.size` is either `counts.size` or one less, never more
 * — and the lag is one frame on the way in and one on the way out. On every `viz.step()` frame,
 * which is what the player stops on, both are exactly the nesting depth.
 *
 * ### Why the pieces are written before the pops
 *
 * `built = before + inner.repeat(times)` runs *before* `saved.pop()` / `counts.pop()`, so no frame
 * ever shows a context popped off the stack while the thing it was popped for has not appeared.
 * The one frame it costs shows `before` in two places at once — on the stack and inside `built` —
 * which reads as the hand-off it is. Same rule as Daily Temperatures: the answer lands before the
 * structural change that announces it.
 *
 * ### The input panel
 *
 * Letters are marked `visited` and digits and brackets `excluded` as they are consumed, so the
 * string reads as content-versus-syntax at a glance: the slashed cells are exactly the characters
 * that never appear in the answer. Together with the caret that is the whole "what have I read?"
 * story, which frees both stack panels to be purely about depth.
 *
 * ### Known rendering limits, exercised on purpose
 *
 * `text before the [` is the first stack in the repo to hold **strings**, and two of its cells are
 * unreadable as `StackViz` stands today. `display('')` returns `''`, so the empty string — the
 * saved text at every top-level `[`, and by far the most common value here — renders as a
 * completely blank 44px box, indistinguishable from a cell with nothing in it. And `fontSizeFor`
 * floors at 9px with no truncation, so a saved prefix of ten characters is already ~47px wide in a
 * 44px cell and a long one runs clean off the 114px-wide `<svg>`, which clips it.
 *
 * Every parked cell is therefore marked `path` **with a note**, and a note now renders as a
 * `<title>` tooltip, so the value is at least recoverable — but the cell itself is not, and a
 * tooltip is not a picture. The fix belongs in `display`/`Cell` in
 * `packages/viz/src/primitives.tsx`, not here; `abcdefghij2[xy]` is in the case set so the
 * overflow stays reproducible, and `3[a]` reproduces the blank cell.
 */
export function reference(s: string, viz: Viz): string {
  const input = viz.string(s, { name: 's' })
  const i = viz.cursor('i', 0, input)
  // Pushed first and popped last, so this is the panel whose height is the nesting depth on
  // every frame; `text before the [` trails it by one frame at each bracket.
  const counts = viz.stack<number>([], { name: 'repeat counts' })
  const saved = viz.stack<string>([], { name: 'text before the [' })
  let built = ''
  let k = 0
  viz.watch(() => ({ i: i.value, depth: counts.size, k, built }))

  for (i.value = 0; i.value < input.length; i.inc()) {
    const ch = input.charAt(i.value)
    // Marked consumed on the frame after it is read and before anything is done with it, so no
    // frame ever shows a character being acted on that the picture still calls unread.
    input.mark(i.value, ch >= 'a' && ch <= 'z' ? 'visited' : 'excluded')

    if (ch >= '0' && ch <= '9') {
      // Digits accumulate: `10[` is ten, not one then zero.
      k = k * 10 + Number(ch)
      viz.step(`digit ${ch} — the count in front of the next "[" now reads ${k}`)
    } else if (ch === '[') {
      const times = k
      const parked = built
      counts.push(times)
      counts.mark(
        counts.size - 1,
        'path',
        `repeat whatever gets built inside this bracket ${times} time(s)`,
      )
      saved.push(parked)
      // The note is what makes this cell legible at all: an empty saved prefix draws a blank box
      // and a long one overflows, so the tooltip is the only place the value is readable in full.
      saved.mark(
        saved.size - 1,
        'path',
        `text held over from before the "[" at s[${i.value}]: ${quote(parked, 60)}`,
      )
      // Reset before narrating, so the step frame shows the parked text on the stack and an empty
      // `built` beside it, rather than the same text in both places.
      k = 0
      built = ''
      viz.step(
        `"[" — parked ${quote(parked)} and its ${times}×; starting a fresh piece at depth ${counts.size}`,
      )
    } else if (ch === ']') {
      const inner = built
      // `requireTop()` rather than the value `pop()` returns: `pop()` is typed `T | undefined`, and
      // a `?? ''` fallback in the one line that expresses the algorithm would be a lie (there is
      // always a context to come back to on a well-formed input) as well as noise. See the report:
      // `requirePop()` is the twin `VizStack` is missing.
      const before = saved.requireTop()
      const times = counts.requireTop()
      built = before + inner.repeat(times)
      // Popped in the mirror of the push order, so `counts` is never the shorter of the two.
      saved.pop()
      counts.pop()
      viz.step(
        `"]" — ${times} × ${quote(inner)} glued onto the end of ${quote(before)}; back to depth ${counts.size}`,
      )
    } else {
      built += ch
      viz.step(`letter ${ch} — the piece at depth ${counts.size} is now ${quote(built)}`)
    }
  }

  // Say the thing the two panels exist to show, on the frame where both are empty: every `[` that
  // was opened has been closed, so nothing is held over and `built` is the whole answer.
  viz.step(`both stacks are empty — nothing is left open, so the answer is ${quote(built, 40)}`)
  return built
}

const starter = `// Scan left to right. Digits build up a repeat count; a "[" parks the work in progress
// and starts a fresh piece; a "]" pulls the parked context back and glues on the repeats.
// Two parallel stacks, so the height of either one is the bracket nesting depth.
export default function decodeString(s: string, viz: Viz): string {
  const input = viz.string(s, { name: 's' })
  const i = viz.cursor('i', 0, input)
  // Push this one first and pop it last, so its height is the nesting depth on every frame.
  const counts = viz.stack<number>([], { name: 'repeat counts' })
  const saved = viz.stack<string>([], { name: 'text before the [' })
  let built = ''
  let k = 0
  viz.watch(() => ({ i: i.value, depth: counts.size, k, built }))

  for (i.value = 0; i.value < input.length; i.inc()) {
    const ch = input.charAt(i.value)
    // Letters become output, digits and brackets never do — marking them apart makes the input
    // panel readable as content versus syntax, and 'excluded' draws a slash through the cell.
    input.mark(i.value, ch >= 'a' && ch <= 'z' ? 'visited' : 'excluded')

    // TODO: four cases, in this order.
    //
    //   digit  -> k = k * 10 + Number(ch), because "10[" is ten and not one then zero.
    //   "["    -> push k onto counts and the text built so far onto saved, then reset both
    //             to start a fresh piece. Push counts BEFORE saved: the two pushes cannot
    //             share a frame, and this way counts is never the shorter of the two.
    //   "]"    -> the piece you just finished repeats counts-top times and goes on the end of
    //             saved-top. Compute the new 'built' BEFORE popping, or there is a frame where
    //             the context has left the stack and the text it was kept for has not appeared.
    //             Use saved.requireTop() / counts.requireTop(): pop() is typed T | undefined.
    //             Pop saved first, then counts, mirroring the push order.
    //   letter -> built += ch
    //
    // Invariant to preserve: at every viz.step(), counts.size === saved.size === the number of
    // "[" you have read minus the number of "]" you have read. Both stacks end empty.
    //
    // Mark each pushed cell 'path' with a note. 'path' is documented as unwinding when the
    // stack pops, which VizStack.pop() does for free — and the note is the only place a saved
    // empty string or a long one is readable, since the cell itself is 44px wide.
    viz.step('s[' + i.value + '] = ' + ch + ' (depth ' + counts.size + ', parked ' + saved.size + ')')
  }

  return built
}
`

export const decodeString: ProblemDefinition = {
  id: 'p394',
  leetcode: 394,
  slug: 'decode-string',
  title: 'Decode String',
  difficulty: 'medium',
  category: 'stack',
  statement:
    'Given an encoded string `s`, return its decoded form. The encoding rule is ' +
    '`k[encoded_string]`, meaning the text inside the square brackets repeats exactly `k` times. ' +
    'Brackets may nest. The input is always well-formed — every bracket is matched, `k` is a ' +
    'positive integer, and digits only ever appear as a repeat count, never inside the decoded ' +
    'text.',
  structures: ['string', 'stack'],
  comparator: 'deep',
  entry: 'decodeString',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    { name: 'example', args: ['3[a]2[bc]'], expected: 'aaabcbc', tags: ['example'] },
    {
      // The case the whole visualization is for: the stack reaches depth 2 and the inner piece
      // is repeated inside the outer one, so "3×(a + 2×c)" is visible as two stack heights.
      name: 'nested — the depth-2 case',
      args: ['3[a2[c]]'],
      expected: 'accaccacc',
      tags: ['example'],
    },
    {
      name: 'trailing text outside every bracket',
      args: ['2[abc]3[cd]ef'],
      expected: 'abcabccdcdcdef',
      tags: ['example'],
    },
    {
      // Constraint floor: one character, no encoding at all. Both stacks stay empty for the
      // entire run, which is the animation saying "nothing here needed deferring".
      name: 'single letter, no brackets',
      args: ['a'],
      expected: 'a',
      tags: ['edge'],
    },
    { name: 'plain text, no brackets at all', args: ['abcdef'], expected: 'abcdef', tags: ['edge'] },
    {
      // k = 1 is the smallest legal count: a bracket that changes nothing still has to push and
      // pop, so the depth still moves.
      name: 'repeat count of one',
      args: ['1[a]'],
      expected: 'a',
      tags: ['edge'],
    },
    {
      // Two digits. A solution that treats each digit as its own count decodes this as
      // `1[` then `0[`, which is not the same string — the accumulation is not optional.
      name: 'multi-digit repeat count',
      args: ['10[ab]'],
      expected: 'abababababababababab',
      tags: ['edge'],
    },
    {
      // Depth 4, every level identical: the stack grows to four and drains to zero without a
      // single letter appearing until the innermost bracket closes.
      name: 'four levels of nesting',
      args: ['2[2[2[2[a]]]]'],
      expected: 'aaaaaaaaaaaaaaaa',
      tags: ['edge'],
    },
    {
      // The saved prefix is ten characters wide. That is the case that makes the `StackViz`
      // cell overflow reproducible — the cell is 44px and the text is not truncated.
      name: 'long literal prefix parked on the stack',
      args: ['abcdefghij2[xy]'],
      expected: 'abcdefghijxyxy',
      tags: ['edge'],
    },
    {
      // A bracket immediately followed by another at the same level: the stack returns to zero
      // in between, which is the frame that proves the depth gauge is not merely monotonic.
      name: 'siblings, not nested',
      args: ['2[a]2[b]2[c]'],
      expected: 'aabbcc',
      tags: ['edge'],
    },
    {
      // 28 characters, near the 30-character ceiling: nesting, siblings, multi-character pieces,
      // a count of 1, and text both between and after the brackets.
      name: 'the compound stress case',
      args: ['3[z]2[2[y]pq4[2[jk]e1[f]]]ef'],
      expected: 'zzzyypqjkjkefjkjkefjkjkefjkjkefyypqjkjkefjkjkefjkjkefjkjkefef',
      tags: ['large'],
    },
  ],
  hints: [
    'You cannot decode `k[...]` until you reach its `]`, and brackets nest — so the bracket that ' +
      'opened *last* is always the one that closes *first*. That is the definition of a stack.',
    'Keep one "piece under construction". When you meet a `[`, the piece you were building is not ' +
      'wrong, it is just not finished — park it, along with the count that will multiply whatever ' +
      'comes next, and start an empty piece. When you meet a `]`, take both back.',
    'On `]` the new piece is `parkedText + justBuilt.repeat(parkedCount)`. Accumulate digits with ' +
      '`k = k * 10 + d` so `10[` is ten, and reset both the count and the current piece to empty ' +
      'the moment you push them.',
  ],
}
