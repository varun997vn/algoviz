import type { ProblemDefinition, Viz } from '../types.js'

/**
 * LeetCode 11 — Container With Most Water.
 *
 * The ergonomics benchmark for the whole platform. Compare against the plain solution:
 *
 *   let left = 0, right = height.length - 1, best = 0
 *   while (left < right) { ... if (height[left] < height[right]) left++; else right-- }
 *
 * The instrumented version keeps the same control flow and the same `h[left]` indexing —
 * only the declarations change. If a future structure's API can't hit that bar, the API is
 * wrong, not the solution.
 */
export function reference(height: number[], viz: Viz): number {
  const h = viz.array(height, { name: 'height' })
  const left = viz.cursor('left', 0, h)
  const right = viz.cursor('right', height.length - 1, h)
  let best = 0
  viz.watch(() => ({ best, width: right.value - left.value }))

  while (left.value < right.value) {
    const width = right.value - left.value
    const area = width * Math.min(h[left.value], h[right.value])

    if (area > best) {
      best = area
      h.clearMarks('result')
      h.mark([left.value, right.value], 'result', `area ${area}`)
    }
    viz.step(`area ${area}, best ${best}`)

    if (h[left.value] < h[right.value]) left.inc()
    else right.dec()
  }

  return best
}

const starter = `// Two pointers from both ends: the shorter wall always limits the area,
// so moving the shorter one inward is the only move that can help.
export default function maxArea(height: number[], viz: Viz): number {
  const h = viz.array(height, { name: 'height' })
  const left = viz.cursor('left', 0, h)
  const right = viz.cursor('right', height.length - 1, h)
  let best = 0
  viz.watch(() => ({ best }))

  while (left.value < right.value) {
    // TODO: measure the container between left and right, keep the best,
    // then move the pointer at the shorter wall inward.
    viz.step('measure')
    break
  }

  return best
}
`

export const containerWithMostWater: ProblemDefinition = {
  id: 'p011',
  leetcode: 11,
  slug: 'container-with-most-water',
  title: 'Container With Most Water',
  difficulty: 'medium',
  category: 'two-pointers',
  statement:
    'Given an array `height` where each element is the height of a vertical line at that index, ' +
    'pick two lines that together with the x-axis form a container holding the most water. ' +
    'Return that maximum area. The area is limited by the shorter of the two lines.',
  structures: ['array'],
  comparator: 'deep',
  entry: 'maxArea',
  starter,
  reference: reference as ProblemDefinition['reference'],
  cases: [
    { name: 'example', args: [[1, 8, 6, 2, 5, 4, 8, 3, 7]], expected: 49, tags: ['example'] },
    { name: 'two bars', args: [[1, 1]], expected: 1, tags: ['example'] },
    { name: 'strictly increasing', args: [[1, 2, 3, 4, 5]], expected: 6, tags: ['edge'] },
    { name: 'tall outer walls', args: [[9, 1, 1, 1, 9]], expected: 36, tags: ['edge'] },
    { name: 'all equal', args: [[5, 5, 5, 5]], expected: 15, tags: ['edge'] },
    { name: 'zeros present', args: [[0, 2, 0, 2, 0]], expected: 4, tags: ['edge'] },
  ],
  hints: [
    'The area is `min(height[left], height[right]) * (right - left)`.',
    'Moving the taller wall inward can never increase the area — the shorter wall still caps it.',
    'So always move the pointer at the shorter wall, and stop when they meet.',
  ],
}
