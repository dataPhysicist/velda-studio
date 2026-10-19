import { expect, type Page, test } from '@playwright/test'

// 09 Phase 3 gate: the three kitchen changes from the design review, made by hand in the plan on the
// level 1 kitchen of the migrated v0.3 "N8 kitchen" scheme (the local preview): the sink to the
// island, patio doors on the sink wall, and the range swapped with the refrigerator tower. Every step
// is a real mouse or keyboard gesture in the plan or the Selection panel; the store is only read.
//
// That scheme already has the sink on the island (v0.3 made that change by chat), so one setup edit
// first puts it back on the sink wall counter. BUILDLOG=1 saves the screenshots to docs/buildlog.

type V = [number, number]
const SHOTS = process.env.BUILDLOG ? 'docs/buildlog' : 'test-results'
const toScreen = (page: Page, p: V) => page.evaluate((q) => (window as any).__plan.toScreen(q) as V, p)
const item = (page: Page, id: string) => page.evaluate((i) => (window as any).__studio.store.getState().model.items.find((x: any) => x.id === i), id)
const versions = (page: Page) => page.evaluate(() => (window as any).__studio.store.getState().versions.length as number)

async function drag(page: Page, from: V, to: V, steps = 10) {
  const a = await toScreen(page, from)
  const b = await toScreen(page, to)
  await page.mouse.move(a[0], a[1])
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) await page.mouse.move(a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps)
  await page.mouse.up()
}
async function click(page: Page, p: V, modifiers: ('Shift' | 'Alt')[] = []) {
  const a = await toScreen(page, p)
  for (const k of modifiers) await page.keyboard.down(k)
  await page.mouse.click(a[0], a[1])
  for (const k of modifiers) await page.keyboard.up(k)
}
/** Wait for the version count to reach n (each hand edit saves one). */
const settled = (page: Page, n: number) => expect.poll(() => versions(page)).toBe(n)

test.use({ video: process.env.BUILDLOG ? 'on' : 'off' })

test('the three kitchen changes by hand in the plan, in under five minutes', async ({ page }) => {
  test.setTimeout(420_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/')
  await page.waitForFunction(() => {
    const s = (window as any).__studio?.store?.getState?.()
    return !!s?.model && !s.status && !s.error
  })
  await page.keyboard.press('1')
  await page.getByRole('navigation', { name: 'Level' }).getByRole('button', { name: 'Level 1' }).click()
  const kitchen = await page.evaluate(() => (window as any).__studio.store.getState().model.rooms.find((r: any) => r.name === 'Kitchen').id)
  await page.evaluate((id) => (window as any).__plan.frameRoom(id), kitchen)

  // Setup (not timed): the sink back on the sink wall counter, as it is in the house today.
  const start = await item(page, 'n8-counter-sink')
  await page.evaluate(async (y) => {
    const ed = await (window as any).__studio.editor()
    await ed.handEdit([{ op: 'move', id: 'n8-sink', x: 286, y, rot: 0 }], 'Put the sink back on the sink wall (test setup)')
  }, start.y)
  let v = await versions(page)
  await page.screenshot({ path: `${SHOTS}/phase3-kitchen-0-before.jpg`, quality: 80, type: 'jpeg' })

  const t0 = Date.now()

  // 1. The sink to the island: drag it onto the island, turn it to face the range side.
  const island = await item(page, 'n8-island')
  await drag(page, [286, start.y], [island.x, island.y + 12])
  await settled(page, ++v)
  await page.keyboard.press('r')
  await settled(page, ++v)
  await page.keyboard.press('r')
  await settled(page, ++v)
  const sink = await item(page, 'n8-sink')
  expect(Math.abs(sink.x - island.x)).toBeLessThan(3)
  expect(sink.rot).toBe(180)
  await page.screenshot({ path: `${SHOTS}/phase3-kitchen-1-sink.jpg`, quality: 80, type: 'jpeg' })

  // 2. Patio doors on the sink wall: drag a 6 ft opening along the wall with the Opening tool (it
  // takes the window's place), make it a sliding door, then shorten the counter so the doors open.
  const wall = await page.evaluate(() => (window as any).__studio.store.getState().model.walls.find((w: any) => w.id === 'L1w4'))
  const y = wall.a[1]
  await page.keyboard.press('o')
  await drag(page, [wall.a[0] + 56, y], [wall.a[0] + 128, y], 12)
  await expect(page.getByRole('alertdialog')).toContainText('header')
  await page.getByRole('button', { name: 'Add it' }).click()
  await settled(page, ++v)
  await page.locator('.ctx').getByRole('group', { name: 'Style' }).getByRole('button', { name: 'Sliding' }).click()
  await settled(page, ++v)
  const doors = await page.evaluate(() => (window as any).__studio.store.getState().model.openings.filter((o: any) => o.wall === 'L1w4'))
  expect(doors).toHaveLength(1)
  expect(doors[0]).toMatchObject({ kind: 'door', style: 'sliding', w: 72 })

  const counter = await item(page, 'n8-counter-sink')
  await click(page, [counter.x - 70, counter.y])
  const width = page.locator('.ctx label').filter({ hasText: 'Width' }).locator('input')
  await width.fill(`4'-6"`)
  await width.press('Enter')
  await settled(page, ++v)
  const shorter = await item(page, 'n8-counter-sink')
  await drag(page, [shorter.x, shorter.y], [wall.a[0] + 3.25 + 27, shorter.y])
  await settled(page, ++v)
  const moved = await item(page, 'n8-counter-sink')
  expect(moved.w).toBe(54)
  expect(moved.x + moved.w / 2).toBeLessThanOrEqual(wall.a[0] + 56 + 1) // clear of the doors
  await page.screenshot({ path: `${SHOTS}/phase3-kitchen-2-patio-doors.jpg`, quality: 80, type: 'jpeg' })

  // 3. Swap the range and the refrigerator tower: select both columns, turn them to face the room
  // from the range wall, and slide them onto it; then the range goes where the tower was.
  const fridge = await item(page, 'n8-fridge')
  const freezer = await item(page, 'n8-freezer')
  const range = await item(page, 'n8-range')
  await click(page, [fridge.x, fridge.y])
  await click(page, [freezer.x, freezer.y], ['Shift'])
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('r')
    await settled(page, ++v)
  }
  const turned = await item(page, 'n8-fridge')
  const left = await page.evaluate(() => (window as any).__studio.store.getState().model.walls.find((w: any) => w.id === 'L1w36'))
  const face = left.a[0] + left.t / 2
  const top = Math.min(left.a[1], left.b[1])
  // The fridge column goes to the top of that wall, the freezer below it.
  await drag(page, [turned.x, turned.y], [face + 13, top + 16])
  await settled(page, ++v)
  await drag(page, [range.x, range.y], [fridge.x, fridge.y])
  await settled(page, ++v)
  await page.keyboard.press('r')
  await settled(page, ++v)
  const elapsed = (Date.now() - t0) / 1000

  const end = await page.evaluate(() => {
    const m = (window as any).__studio.store.getState().model
    const it = (id: string) => m.items.find((x: any) => x.id === id)
    return { fridge: it('n8-fridge'), freezer: it('n8-freezer'), range: it('n8-range') }
  })
  expect(end.fridge.rot).toBe(90) // faces into the kitchen from the left wall
  expect(end.freezer.rot).toBe(90)
  expect(Math.abs(end.fridge.x - (face + 13))).toBeLessThan(1) // backs on the wall face
  expect(Math.abs(end.freezer.x - (face + 13))).toBeLessThan(1)
  expect(Math.abs(end.range.x - fridge.x)).toBeLessThan(3)
  expect(Math.abs(end.range.y - fridge.y)).toBeLessThan(3)
  expect(end.range.rot).toBe(180) // faces up into the kitchen from the bottom wall
  await page.screenshot({ path: `${SHOTS}/phase3-kitchen-3-swap.jpg`, quality: 80, type: 'jpeg' })
  console.log(`[kitchen] three changes in ${elapsed.toFixed(1)} s, ${v} versions`)
  expect(elapsed).toBeLessThan(300)
  expect(errors).toEqual([])
})
