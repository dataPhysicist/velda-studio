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
  await expect(page.locator('.composer textarea')).toHaveValue('Move the sink to the island')
  await page.screenshot({ path: `${SHOTS}/phase9-tour-velda.jpg`, type: 'jpeg', quality: 80 })
  await tour.getByRole('button', { name: 'Next' }).click() // Velda needs Toolbelt; skip this one here
  await expect(tour).toContainText('Drag a wall')
  await tour.getByRole('button', { name: 'Next' }).click()
  await expect(tour).toContainText('Add inspiration')
  expect((await st(page)).ctxTab).toBe('inspiration')
  await tour.getByRole('button', { name: 'Next' }).click()
  await expect(tour).toContainText('Share it')
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(tour).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Share a read-only link' })).toBeVisible()
  expect((await st(page)).prefs.tourDone).toBe(true)
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
