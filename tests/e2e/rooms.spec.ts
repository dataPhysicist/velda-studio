import { expect, test, type Page } from '@playwright/test'

// Rooms, the photo-first page, in the local preview: the house comes from the plan fixture, the image
// model is a stand-in that repaints a block in the middle of the picture and brightens everything a
// little (the drift a real model adds), and Velda's answers are canned. What is checked is the page's
// own work: only what was asked for changes, a marked spot is the only thing that can change, versions
// are kept, and the designer's notes follow the conversation.

const state = (page: Page) => page.evaluate(() => (window as any).__rooms.store.getState())

/** A drawn "room photo": flat wall, floor and a cabinet, 1600 x 1200. */
async function photo(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 1600
    c.height = 1200
    const g = c.getContext('2d')!
    g.fillStyle = '#e8e0d2'
    g.fillRect(0, 0, 1600, 760)
    g.fillStyle = '#b9a58c'
    g.fillRect(0, 760, 1600, 440)
    g.fillStyle = '#8a6a48'
    g.fillRect(520, 460, 560, 320)
    g.fillStyle = '#f4f1ea'
    g.fillRect(1180, 160, 260, 380)
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(0,0,0,${0.02 + (i % 5) * 0.01})`
      g.fillRect((i * 97) % 1600, 780 + ((i * 53) % 400), 180, 6)
    }
    return c.toDataURL('image/jpeg', 0.92).split(',')[1]
  })
  return Buffer.from(b64, 'base64')
}

test('a room from the plan, a photo, a change that leaves the rest alone, a marked spot, and the designer notes', async ({ page }) => {
  await page.goto('/rooms.html')
  await expect(page.locator('.wordmark')).toContainText('Rooms')
  const rooms: any[] = (await state(page)).house.rooms
  const bath = rooms.find((r) => r.kind === 'bath' && !r.minor)
  expect(bath, 'the plan fixture has a bathroom').toBeTruthy()
  await page.screenshot({ path: 'docs/buildlog/rooms-1-home.jpg', type: 'jpeg', quality: 80 })

  // The room page says its real size, from the plan.
  await page.locator('.room-card', { hasText: bath.name }).first().click()
  await expect(page.locator('.room-head h1')).toHaveText(bath.name)
  await expect(page.locator('.room-head')).toContainText('from your floor plan')
  await expect(page.locator('.room-head')).toContainText('square feet')

  // Add a photo through the page's own file picker.
  await page.locator(`input[data-add-photo="${bath.id}"]`).first().setInputFiles({ name: 'bath.jpg', mimeType: 'image/jpeg', buffer: await photo(page) })
  await expect(page.locator('.strip .ver')).toHaveCount(1)
  await expect(page.locator('.strip')).toContainText('Your photo')
  // Velda's ideas arrive for the photo, with what she noticed.
  await expect(page.locator('.idea h3').first()).toHaveText('Warmer wall color')
  await expect(page.locator('.panel', { hasText: "The designer's eye" })).toContainText('Check the light at the mirror')
  let s = await state(page)
  expect(s.be.asked[0]).toContain('square feet')

  // Ask for a change in words. The stand-in repaints the middle and brightens the whole picture.
  await page.getByLabel('What would you like to change?').fill('paint the cabinet teal')
  await page.getByRole('button', { name: 'Show me' }).click()
  await expect(page.locator('.review')).toBeVisible()
  s = await state(page)
  expect(s.pending.result.kind).toBe('full')
  expect(s.pending.protect).toBe(true)
  expect(s.pending.keep.length).toBe(1)
  expect(s.be.calls[0].input.prompt).toContain('Change only this: paint the cabinet teal')
  expect(s.be.calls[0].input.prompt).toContain('measured floor plan')
  // Only the repainted block differs; a corner pixel is the photo's own, byte for byte, although the model brightened it.
  const check = await page.evaluate(() => {
    const p = (window as any).__rooms.store.getState().pending
    const a = p.base.data
    const b = p.final.data
    const raw = p.result.raw.data
    let n = 0
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++
    const corner = 4 * (20 * p.base.w + 20)
    const mid = 4 * (Math.floor(p.base.h / 2) * p.base.w + Math.floor(p.base.w / 2))
    return { share: n / (a.length / 4), cornerSame: a[corner] === b[corner] && a[corner + 1] === b[corner + 1], cornerDrifted: raw[corner] !== a[corner], midChanged: a[mid] !== b[mid] }
  })
  expect(check.cornerDrifted).toBe(true)
  expect(check.cornerSame).toBe(true)
  expect(check.midChanged).toBe(true)
  expect(check.share).toBeGreaterThan(0.06)
  expect(check.share).toBeLessThan(0.2)
  await expect(page.locator('.review-say')).toContainText('One area changed')
  await expect(page.locator('.area.kept')).toHaveCount(1)
  await page.screenshot({ path: 'docs/buildlog/rooms-2-review.jpg', type: 'jpeg', quality: 80 })

  // Putting the area back leaves the photo untouched; taking it again brings the change back.
  await page.locator('.area.kept').click()
  expect((await state(page)).pending.keep.length).toBe(0)
  await page.locator('.area').first().click()
  expect((await state(page)).pending.keep.length).toBe(1)

  await page.getByRole('button', { name: 'Keep it' }).click()
  await expect(page.locator('.strip .ver')).toHaveCount(2)
  await expect(page.locator('.strip')).toContainText('Paint the cabinet teal')
  s = await state(page)
  expect(s.versions.length).toBe(2)
  expect(s.versions[1].meta.mode).toBe('kept')
  expect(s.versions[1].parent_id).toBe(s.versions[0].id)

  // Mark a spot: only the painted part goes to the model, and nothing outside it can change.
  await page.getByRole('button', { name: 'Mark a spot' }).click()
  const frame = await page.locator('.frame').boundingBox()
  const at = (fx: number, fy: number) => [frame!.x + frame!.width * fx, frame!.y + frame!.height * fy] as const
  await page.mouse.move(...at(0.76, 0.2))
  await page.mouse.down()
  for (const [fx, fy] of [[0.86, 0.2], [0.86, 0.4], [0.76, 0.4], [0.76, 0.3], [0.86, 0.3]]) await page.mouse.move(...at(fx, fy), { steps: 6 })
  await page.mouse.up()
  await expect(page.locator('.mark-bar')).toContainText('Only the painted part will change')
  await page.getByLabel('What would you like to change?').fill('make this window an arched window')
  await page.getByRole('button', { name: 'Show me' }).click()
  await expect(page.locator('.review')).toBeVisible()
  s = await state(page)
  expect(s.pending.result.kind).toBe('spot')
  const call = s.be.calls[s.be.calls.length - 1].input
  expect(call.prompt).toContain('part of a real photo')
  expect(call.width * call.height).toBeLessThanOrEqual(1792 * 1792)
  const spot = await page.evaluate(() => {
    const p = (window as any).__rooms.store.getState().pending
    const a = p.base.data
    const b = p.final.data
    const w = p.base.w
    const h = p.base.h
    let outside = 0
    let inside = 0
    for (let y = 0; y < h; y += 3)
      for (let x = 0; x < w; x += 3) {
        const i = 4 * (y * w + x)
        const diff = a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]
        const fx = x / w
        const fy = y / h
        // The painted box, with the brush's width and soft edge around it.
        if (fx > 0.66 && fx < 0.96 && fy > 0.08 && fy < 0.52) inside += diff ? 1 : 0
        else outside += diff ? 1 : 0
      }
    return { outside, inside }
  })
  expect(spot.outside).toBe(0)
  expect(spot.inside).toBeGreaterThan(50)
  await expect(page.locator('.review-say')).toContainText('Only the part you marked changed')
  await page.getByRole('button', { name: 'Keep it' }).click()
  await expect(page.locator('.strip .ver')).toHaveCount(3)
  expect((await state(page)).versions[2].meta.mode).toBe('spot')

  // An idea is one tap.
  await page.locator('.idea', { hasText: 'Brass hardware' }).getByRole('button', { name: 'Try it' }).click()
  await expect(page.locator('.review')).toBeVisible()
  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(page.locator('.strip .ver')).toHaveCount(3)

  // The designer's notes follow what is being asked for, while it is typed.
  const eye = page.locator('.panel', { hasText: "The designer's eye" })
  await expect(eye).not.toContainText('A curbless shower needs the floor lowered')
  await page.getByLabel('What would you like to change?').fill('replace the tub with a curbless walk-in shower')
  await expect(eye).toContainText('A curbless shower needs the floor lowered')
  await expect(eye).toContainText('Ask a structural engineer')
  await expect(eye).toContainText('Plan the exhaust fan now')

  // Save one for the designer, ask Velda a question, and find both on the questions list.
  await eye.locator('.note', { hasText: 'A curbless shower needs the floor lowered' }).getByRole('button').click()
  await page.getByLabel('Ask Velda about this room').fill('Can the toilet move to the other wall?')
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(eye.locator('.note.answer')).toContainText('A plumber can tell')
  await page.getByRole('button', { name: /Questions \(2\)/ }).click()
  await expect(page.locator('.questions')).toContainText('A curbless shower needs the floor lowered')
  await expect(page.locator('.questions')).toContainText('Can the toilet move to the other wall?')

  // Back on the room card, the latest version is the picture.
  await page.getByRole('button', { name: 'All rooms' }).click()
  await expect(page.locator('.room-card.has-photo')).toHaveCount(1)
  await expect(page.locator('.room-card.has-photo')).toContainText('1 photo, 2 versions')
})

test('the same page on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/rooms.html')
  await expect(page.locator('.wordmark')).toContainText('Rooms')
  const rooms: any[] = (await state(page)).house.rooms
  const room = rooms.find((r) => r.kind === 'kitchen') ?? rooms[0]
  await page.locator('.room-card', { hasText: room.name }).first().click()
  await page.locator(`input[data-add-photo="${room.id}"]`).first().setInputFiles({ name: 'room.jpg', mimeType: 'image/jpeg', buffer: await photo(page) })
  await expect(page.locator('.strip .ver')).toHaveCount(1)
  // Nothing is wider than the screen.
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(wide).toBeLessThanOrEqual(1)
  await page.getByLabel('What would you like to change?').fill('paint the cabinet teal')
  await page.getByRole('button', { name: 'Show me' }).click()
  await expect(page.locator('.review')).toBeVisible()
  await page.screenshot({ path: 'docs/buildlog/rooms-3-phone.jpg', type: 'jpeg', quality: 80 })
  await page.getByRole('button', { name: 'Keep it' }).click()
  await expect(page.locator('.strip .ver')).toHaveCount(2)
})
