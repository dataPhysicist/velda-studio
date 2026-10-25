import { expect, type Page, test } from '@playwright/test'

// 09 Phase 5 DoD, the checker in the page: a toilet 12" from a wall is flagged against code in the
// Checks tab; clicking the issue selects the toilet and frames it; nudging it to 15" leaves a
// should-fix (18" is recommended); the Fix button slides it to 18" and the issue clears.
// BUILDLOG=1 saves screenshots to docs/buildlog.

const SHOTS = process.env.BUILDLOG ? 'docs/buildlog' : 'test-results'
const st = (page: Page) => page.evaluate(() => (window as any).__studio.store.getState())
const toiletIssues = (page: Page) => page.evaluate(() => (window as any).__studio.store.getState().checks.filter((i: any) => i.rule === 'toilet-side' && i.where.ids.includes('t-check')))

test('checks: a toilet 12 in from a wall is flagged and clears when moved', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/')
  await page.waitForFunction(() => {
    const s = (window as any).__studio?.store?.getState?.()
    return !!s?.model && !s.status && !s.error
  })
  await page.keyboard.press('1')
  await page.getByRole('navigation', { name: 'Level' }).getByRole('button', { name: 'Level 1' }).click()
  // A toilet against the bath's longest wall, its center 12" from the corner (the side wall's face).
  const bath = await page.evaluate(() => (window as any).__studio.store.getState().model.rooms.find((r: any) => r.name === 'Hall Bath').id)
  await page.evaluate(async (room) => {
    const ed = await (window as any).__studio.editor()
    await ed.handEdit([{ op: 'place', item: { id: 't-check', kind: 'toilet', label: 'Toilet' }, room, against: 'longest', align: { from: 'start', in: 2 } }], 'Toilet for the check (test setup)')
  }, bath)
  await expect.poll(async () => (await toiletIssues(page)).length).toBe(1)
  // Measure the toilet's tight side the way the checker does, then set its center 12" from that wall.
  const [first] = await toiletIssues(page)
  const step = await page.evaluate(async (fix) => {
    const sp = await (window as any).__studio.space()
    const m = (window as any).__studio.store.getState().model
    const it = m.items.find((x: any) => x.id === 't-check')
    const { c, f, s } = sp.frameOf(it)
    const at = [c[0] + f[0] * it.d * 0.15, c[1] + f[1] * it.d * 0.15]
    const segs = sp.obstacles(m, it.level).filter((g: any) => g.id !== it.id)
    // The fix slides away from the tight side, so the wall is the other way.
    const away = Math.sign(fix.dx * s[0] + fix.dy * s[1])
    const tight = sp.ray(at, [-s[0] * away, -s[1] * away], segs).dist
    const k = tight - 12
    return [-s[0] * away * k, -s[1] * away * k]
  }, first.fix[0])
  await page.evaluate(async (d) => {
    const ed = await (window as any).__studio.editor()
    await ed.handEdit([{ op: 'move', id: 't-check', dx: d[0], dy: d[1] }], 'Toilet 12 in from the wall (test setup)')
  }, step)
  await expect.poll(async () => (await toiletIssues(page)).map((i: any) => i.severity)).toEqual(['blocks'])

  // The Checks tab counts it and lists it against code, in feet and inches.
  const tab = page.getByRole('tab', { name: /Checks/ })
  await expect(tab.locator('.ctx-count')).toHaveClass(/is-code/)
  await tab.click()
  const row = page.locator('.issue', { hasText: /toilet is 1'-0" from its center/ })
  await expect(row).toHaveCount(1)
  await expect(row.locator('.issue-sev')).toHaveText('Code')
  await expect(row).toContainText(`code needs 1'-3"`)

  // Clicking it selects the toilet and frames the bath in the plan.
  await row.locator('.issue-main').click()
  await expect.poll(async () => (await st(page)).selection).toEqual([{ kind: 'item', id: 't-check' }])
  const onScreen = await page.evaluate(() => {
    const it = (window as any).__studio.store.getState().model.items.find((x: any) => x.id === 't-check')
    const p = (window as any).__plan.toScreen([it.x, it.y])
    const r = document.querySelector('.plan')!.getBoundingClientRect()
    return p[0] > r.left && p[0] < r.right && p[1] > r.top && p[1] < r.bottom
  })
  expect(onScreen).toBe(true)
  await page.screenshot({ path: `${SHOTS}/phase5-checks-toilet-flagged.jpg`, type: 'jpeg', quality: 80 })

  // Nudge it 3" away from the wall by hand: code is met, the 18" guideline is not.
  const [issue] = await toiletIssues(page)
  const fx = issue.fix[0].dx
  const fy = issue.fix[0].dy
  const key = Math.abs(fx) > Math.abs(fy) ? (fx > 0 ? 'ArrowRight' : 'ArrowLeft') : fy > 0 ? 'ArrowDown' : 'ArrowUp'
  const v0 = (await st(page)).versions.length
  for (let k = 1; k <= 3; k++) {
    await page.keyboard.press(key)
    await expect.poll(async () => (await st(page)).versions.length).toBe(v0 + k)
  }
  await expect.poll(async () => (await toiletIssues(page)).map((i: any) => i.severity)).toEqual(['fix'])
  await expect(page.locator('.issue', { hasText: /toilet is 1'-3" from its center/ }).locator('.issue-sev')).toHaveText('Should fix')

  // The Fix button slides it the rest of the way to 18" and the issue clears.
  await page.locator('.issue', { hasText: /toilet is 1'-3"/ }).getByRole('button', { name: /^Slide it/ }).click()
  await expect.poll(async () => (await toiletIssues(page)).length).toBe(0)
  await expect(page.locator('.issue', { hasText: /toilet is/ })).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/phase5-checks-toilet-cleared.jpg`, type: 'jpeg', quality: 80 })

  // Undo brings it back: the checks follow every version.
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await toiletIssues(page)).map((i: any) => i.severity)).toEqual(['fix'])
  expect(errors).toEqual([])
})
