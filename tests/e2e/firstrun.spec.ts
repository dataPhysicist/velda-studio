import { expect, type Page, test } from '@playwright/test'
import { expectPlain } from './plain'

// 09 Phase 9, as a stranger: a new workspace opens on the welcome; the sample plan comes in through the
// Confirm screen; the tour points at the real thing and each step finishes when it is done (or is
// skipped); then the command palette, Settings and the shortcuts list.

const SHOTS = process.env.BUILDLOG ? 'docs/buildlog' : 'test-results'
const st = (page: Page) => page.evaluate(() => (window as any).__studio.store.getState())

test('first run: welcome, sample plan, tour, palette and settings', async ({ page }) => {
  test.setTimeout(15 * 60_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/?fresh=1')
  const welcome = page.getByRole('region', { name: 'Welcome' })
  await expect(welcome.getByRole('button', { name: "Drop your floor plan PDF. We'll read it and ask a few questions." })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/phase9-first-run.jpg`, type: 'jpeg', quality: 80 })
  await welcome.getByRole('button', { name: 'Try the sample plan' }).click()
  await expect(page.getByTestId('import-confirm')).toBeVisible({ timeout: 12 * 60_000 })
  await expectPlain(page, 'the Confirm screen') // 02 success criterion 6
  await page.getByRole('button', { name: 'Looks right, build my house' }).click()

  // The tour starts on its own after the first plan.
  const tour = page.getByRole('dialog', { name: 'Tour' })
  await expect(tour).toContainText('Step 1 of 5', { timeout: 120_000 })
  await expect(tour).toContainText('Click a room')
  await expectPlain(page, 'the tour')
  await page.getByRole('navigation', { name: 'Room' }).getByRole('button', { name: 'Primary Bedroom', exact: true }).click()
  await expect(tour).toContainText('Step 2 of 5')
  // A change that fits the room just clicked (the sample plan has no kitchen).
  await expect(page.locator('.composer textarea')).toHaveValue(`Make the Primary Bedroom 1'-0" bigger`)
  await page.screenshot({ path: `${SHOTS}/phase9-tour-velda.jpg`, type: 'jpeg', quality: 80 })
  await tour.getByRole('button', { name: 'Next' }).click() // Velda needs Toolbelt; skip this one here
  await expect(tour).toContainText('Drag a wall')
  // The card sits beside the plan, so the walls are free to drag. On the as-built it asks first.
  const wid = await page.evaluate(() => {
    const m = (window as any).__studio.store.getState().model
    return m.walls.find((w: any) => !w.exterior && Math.abs(w.a[0] - w.b[0]) < 1 && Math.abs(w.a[1] - w.b[1]) > 100)?.id
  })
  const wb = (await page.locator(`polygon.wall[data-id="${wid}"]`).boundingBox())!
  const card = (await tour.boundingBox())!
  const plan = (await page.locator('.plan-svg').boundingBox())!
  expect(card.x + card.width).toBeLessThanOrEqual(plan.x + 1)
  await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 4; i++) await page.mouse.move(wb.x + wb.width / 2 + i, wb.y + wb.height / 2)
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Make a new scheme' })).toBeVisible()
  await expect(tour).toHaveCount(0) // the question goes on top; the tour waits
  await page.getByRole('button', { name: 'Make a new scheme' }).click()
  await expect(tour).toContainText('Add inspiration')
  const after = await st(page)
  expect(after.schemes.find((x: any) => x.id === after.schemeId)?.role).not.toBe('asbuilt') // the record stayed as it was
  expect((await st(page)).ctxTab).toBe('inspiration')
  await tour.getByRole('button', { name: 'Next' }).click()
  await expect(tour).toContainText('Share it')
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(tour).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Share a read-only link' })).toBeVisible()
  expect((await st(page)).prefs.tourDone).toBe(true)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible()
  await expectPlain(page, 'Export, on the imported plan')
  await page.keyboard.press('Escape')

  // The palette: every action by name.
  await page.locator('.plan-svg').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+k')
  const pal = page.getByRole('dialog', { name: 'Command palette' })
  await expect(pal).toBeVisible()
  await pal.getByRole('combobox', { name: 'Command' }).fill('go laundry')
  await expect(pal.getByRole('option').first()).toContainText('Go to Laundry Room')
  await page.screenshot({ path: `${SHOTS}/phase9-palette.jpg`, type: 'jpeg', quality: 80 })
  await page.keyboard.press('Enter')
  await expect(pal).toHaveCount(0)
  await expect.poll(async () => {
    const s = await st(page)
    return s.model.rooms.find((r: any) => r.id === s.roomId)?.name
  }).toBe('Laundry Room')
  // Anything else goes to Velda.
  await page.keyboard.press('Control+k')
  await pal.getByRole('combobox', { name: 'Command' }).fill('make the laundry a mudroom')
  await expect(pal.getByRole('option').last()).toContainText('Ask Velda: "make the laundry a mudroom"')
  await page.keyboard.press('Escape')

  // Settings: new doors 36 in, kept.
  await page.keyboard.press('Control+k')
  await pal.getByRole('combobox', { name: 'Command' }).fill('settings')
  await page.keyboard.press('Enter')
  const set = page.getByRole('dialog', { name: 'Settings' })
  await set.getByRole('combobox', { name: 'Doors' }).selectOption('36')
  await expect.poll(async () => (await st(page)).prefs.doorW).toBe(36)
  expect(JSON.parse((await page.evaluate(() => (window as any).__studio.repo.setting('prefs'))) as string).doorW).toBe(36)
  await set.getByRole('button', { name: 'Close' }).click()
  // The shortcuts list.
  await page.locator('.plan-svg').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText('Command palette')
  expect(errors).toEqual([])
})
