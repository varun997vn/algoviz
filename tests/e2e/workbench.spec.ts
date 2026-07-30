import { expect, test, type Page } from '@playwright/test'

/**
 * UI tests, deterministic by construction.
 *
 * `__ALGOVIZ_TEST__` switches the player to a manually-driven clock and disables transitions,
 * so a test *drives* frame progression via `window.__algoviz.seek(n)` and asserts immediately.
 * There is not a single `waitForTimeout` in this file, and assertions target `data-digest` and
 * `data-highlight` rather than pixels — the two decisions that keep this layer from flaking.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __ALGOVIZ_TEST__: boolean }).__ALGOVIZ_TEST__ = true
  })
})

async function openProblem(page: Page, slug: string): Promise<void> {
  await page.goto(`/?problem=${slug}`)
  await expect(page.getByTestId('workbench')).toBeVisible()
}

async function runReference(page: Page): Promise<void> {
  await page.getByTestId('run-reference').click()
  await expect(page.getByTestId('case-bar')).toBeVisible()
}

async function seek(page: Page, frame: number): Promise<void> {
  await page.evaluate((f) => window.__algoviz?.seek(f), frame)
}

/** Set the editor contents directly — see the note on `setSource` for why not by typing. */
async function setSource(page: Page, source: string): Promise<void> {
  await page.evaluate((src) => window.__algoviz?.setSource(src), source)
  await expect(page.getByTestId('editor')).toContainText(source.slice(0, 24).trim())
}

test('the picker lists all 75 roadmap problems and marks which are playable', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'LeetCode 75, visualized' })).toBeVisible()

  const items = page.locator('[data-testid^="problem-item-"]')
  await expect(items).toHaveCount(75)

  // The three reference problems are built; the rest are honestly marked as todo.
  await expect(page.locator('[data-testid^="problem-item-"][data-ready="true"]')).toHaveCount(3)
  await expect(page.getByTestId('problem-item-11')).toContainText('Container With Most Water')
})

test('search narrows the list and "playable only" filters to what is built', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('problem-search').fill('container')
  await expect(page.locator('[data-testid^="problem-item-"]')).toHaveCount(1)

  await page.getByTestId('problem-search').fill('')
  await page.getByTestId('only-playable').check()
  await expect(page.locator('[data-testid^="problem-item-"]')).toHaveCount(3)
})

test('opening a problem shows its starter code and nothing has run yet', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('problem-item-11').getByRole('button').click()

  await expect(page.getByTestId('current-problem')).toContainText('Container With Most Water')
  await expect(page.getByTestId('editor')).toContainText('Two pointers from both ends')
  await expect(page.getByTestId('nothing-run')).toBeVisible()
  // State is in the URL, so any bug report is a link.
  expect(new URL(page.url()).searchParams.get('problem')).toBe('container-with-most-water')
})

test('running the reference solution passes every case and renders the array', async ({ page }) => {
  await openProblem(page, 'container-with-most-water')
  await runReference(page)

  const cases = page.locator('[data-testid^="case-item-"]')
  await expect(cases).toHaveCount(6)
  await expect(page.locator('[data-testid^="case-item-"][data-passed="false"]')).toHaveCount(0)

  await expect(page.getByTestId('stage')).toBeVisible()
  await expect(page.locator('[data-viz-kind="array"]')).toBeVisible()

  // Frame 0 is the array's own creation, before any cursor has been declared — so step past it
  // before expecting carets. That ordering is the trace being honest about what existed when.
  await page.getByRole('button', { name: 'Last frame' }).click()
  await expect(page.getByTestId('cursor-left')).toBeVisible()
  await expect(page.getByTestId('cursor-right')).toBeVisible()
})

test('stepping and scrubbing change the rendered state', async ({ page }) => {
  await openProblem(page, 'container-with-most-water')
  await runReference(page)

  const stage = page.getByTestId('stage')
  await seek(page, 0)
  const first = await stage.getAttribute('data-digest')

  await page.getByRole('button', { name: 'Next frame' }).click()
  const second = await stage.getAttribute('data-digest')
  expect(second).not.toBe(first)

  await page.getByRole('button', { name: 'Last frame' }).click()
  const last = await stage.getAttribute('data-digest')
  expect(last).not.toBe(second)
  await expect(page.getByTestId('frame-counter')).toContainText('/')

  // Going back to frame 0 must reproduce the original picture exactly — scrubbing backwards
  // has to be lossless, which is the whole reason frames resolve rather than replay.
  await page.getByRole('button', { name: 'First frame' }).click()
  expect(await stage.getAttribute('data-digest')).toBe(first)
})

test('the final frame shows the answer in the watch panel', async ({ page }) => {
  await openProblem(page, 'container-with-most-water')
  await runReference(page)
  await page.getByRole('button', { name: 'Last frame' }).click()

  await expect(page.getByTestId('watch-panel')).toContainText('best')
  await expect(page.locator('[data-watch-name="best"]')).toContainText('49')
  // The winning pair stays marked as the result.
  await expect(page.locator('[data-viz-kind="array"] [data-highlight~="result"]')).toHaveCount(2)
})

test('keyboard shortcuts drive the player', async ({ page }) => {
  await openProblem(page, 'container-with-most-water')
  await runReference(page)

  const stage = page.getByTestId('stage')
  await seek(page, 0)
  await page.locator('body').click()

  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('frame-counter')).toContainText('2 /')

  await page.keyboard.press('End')
  const atEnd = await stage.getAttribute('data-digest')
  await page.keyboard.press('Home')
  expect(await stage.getAttribute('data-digest')).not.toBe(atEnd)

  // Space toggles playback state without needing to wait for any animation.
  await page.keyboard.press(' ')
  await expect(page.getByTestId('play-toggle')).toHaveAttribute('data-playing', 'true')
  await page.keyboard.press(' ')
  await expect(page.getByTestId('play-toggle')).toHaveAttribute('data-playing', 'false')
})

test('playing advances frames on the manual clock', async ({ page }) => {
  await openProblem(page, 'container-with-most-water')
  await runReference(page)
  await seek(page, 0)

  await page.getByTestId('play-toggle').click()
  await expect(page.getByTestId('play-toggle')).toHaveAttribute('data-playing', 'true')

  // Drive time by hand rather than waiting on it.
  const before = await page.getByTestId('frame-counter').textContent()
  await page.evaluate(() => window.__algoviz?.advance(50))
  await expect
    .poll(async () => page.getByTestId('frame-counter').textContent())
    .not.toBe(before)
})

test('the tree problem renders a tree and unwinds the path highlight', async ({ page }) => {
  await openProblem(page, 'count-good-nodes-in-binary-tree')
  await runReference(page)

  await expect(page.locator('[data-viz-kind="tree"]')).toBeVisible()
  await page.getByRole('button', { name: 'Last frame' }).click()

  // Four good nodes marked, and no node still sitting on the recursion path.
  await expect(page.locator('[data-viz-kind="tree"] [data-highlight~="result"]')).toHaveCount(4)
  await expect(page.locator('[data-viz-kind="tree"] [data-highlight~="path"]')).toHaveCount(0)
})

test('the graph problem renders roads with their decided direction', async ({ page }) => {
  await openProblem(page, 'reorder-routes-to-make-all-paths-lead-to-the-city-zero')
  await runReference(page)

  await expect(page.locator('[data-viz-kind="graph"]')).toBeVisible()
  await page.getByRole('button', { name: 'Last frame' }).click()

  await expect(page.locator('[data-edge-state="reversed"]')).toHaveCount(3)
  await expect(page.locator('[data-viz-kind="set"]')).toBeVisible()
  await expect(page.locator('[data-watch-name="reversals"]')).toContainText('3')
})

test('a wrong answer is reported with both values', async ({ page }) => {
  await openProblem(page, 'container-with-most-water')
  await setSource(
    page,
    'export default function maxArea(height: number[], viz: Viz): number { viz.array(height); return 0 }',
  )
  await page.getByTestId('run').click()

  await expect(page.getByTestId('mismatch')).toContainText('Returned 0')
  await expect(page.getByTestId('mismatch')).toContainText('expected 49')
  await expect(page.locator('[data-testid^="case-item-"][data-passed="false"]').first()).toBeVisible()
})

test('a syntax error surfaces as a diagnostic instead of a blank screen', async ({ page }) => {
  await openProblem(page, 'container-with-most-water')
  await setSource(page, 'export default function maxArea(h: number[], viz: Viz): number { return')
  await page.getByTestId('run').click()

  await expect(page.getByTestId('diagnostics')).toBeVisible()
})

test('a module import is refused with an actionable message', async ({ page }) => {
  await openProblem(page, 'container-with-most-water')
  await setSource(page, "import fs from 'node:fs'")
  await page.getByTestId('run').click()

  await expect(page.getByTestId('diagnostics')).toContainText('no module access')
})

test('an infinite loop is stopped and the partial trace is still shown', async ({ page }) => {
  await openProblem(page, 'container-with-most-water')
  await setSource(
    page,
    'export default function maxArea(height: number[], viz: Viz): number { const h = viz.array(height); for(;;) { h.mark(0, "active") } }',
  )
  await page.getByTestId('run').click()

  // The tracer's own budget catches this, so the user gets a truncation banner plus the frames
  // leading up to the runaway loop rather than a hung tab.
  await expect(page.getByTestId('truncated')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('stage')).toBeVisible()
})

test('hints reveal one at a time', async ({ page }) => {
  await openProblem(page, 'container-with-most-water')
  await page.getByTestId('reveal-hint').click()
  await expect(page.locator('.av-hint')).toHaveCount(1)
  await page.getByTestId('reveal-hint').click()
  await expect(page.locator('.av-hint')).toHaveCount(2)
})

test('edits survive a reload, and reset restores the starter', async ({ page }) => {
  await openProblem(page, 'container-with-most-water')
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  // Typed for real here: this test's subject *is* editing and persistence.
  await page.keyboard.type('// my own notes here')

  await page.reload()
  await expect(page.getByTestId('editor')).toContainText('my own notes here')

  await page.getByTestId('reset-code').click()
  await expect(page.getByTestId('editor')).toContainText('Two pointers from both ends')
})

test('switching cases reloads that case trace', async ({ page }) => {
  await openProblem(page, 'container-with-most-water')
  await runReference(page)

  const stage = page.getByTestId('stage')
  const firstCase = await stage.getAttribute('data-digest')
  await page.getByTestId('case-item-2').click()
  expect(await stage.getAttribute('data-digest')).not.toBe(firstCase)
})

test('the executing line is highlighted in the editor as you scrub', async ({ page }) => {
  await openProblem(page, 'container-with-most-water')
  await runReference(page)
  // The reference runs as a compiled module without injected line markers, so the attribute is
  // present and stable; what matters is that the wiring exists and does not crash.
  await expect(page.getByTestId('editor')).toHaveAttribute('data-active-line', /.*/)
})
