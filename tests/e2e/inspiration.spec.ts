import { readFileSync, writeFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import jpeg from 'jpeg-js'

// 09 Phase 6, the page side: three pictures dropped in the chat box and a Pinterest board pasted in
// the Inspiration tab, both for the Primary Bathroom, become tagged cards (one version each); three
// picked cards become the room's theme through Velda; the mood board shows them; a card dragged onto
// a room in the plan is filed there. Pinterest's widget endpoints answer from the saved fixture and
// Velda is a stand-in that answers from what each prompt lists. BUILDLOG=1 saves screenshots.

const SHOTS = process.env.BUILDLOG ? 'docs/buildlog' : 'test-results'
const BOARD = 'https://www.pinterest.com/someone/marble-shower-tray-finish-anti-slip/'
const board = JSON.parse(readFileSync('tests/inspiration/fixtures/pinterest-board.json', 'utf8'))
const st = (page: Page) => page.evaluate(() => (window as any).__studio.store.getState())

/** A small JPEG of a few color bands, like a photo of a room in those colors. */
function picture(colors: [number, number, number][], file: string) {
  const w = 120
  const h = 90
  const data = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = colors[Math.min(colors.length - 1, Math.floor((y / h) * colors.length))]
      const i = (y * w + x) * 4
      data[i] = c[0]
      data[i + 1] = c[1]
      data[i + 2] = c[2]
      data[i + 3] = 255
    }
  writeFileSync(file, jpeg.encode({ data, width: w, height: h }, 90).data)
  return file
}

test('inspiration: pictures and a Pinterest board for the primary bath become tagged cards, a theme and a mood board', async ({ page }) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const pin = jpeg.encode({ data: Buffer.alloc(40 * 40 * 4, 220), width: 40, height: 40 }, 80).data
  await page.route('https://widgets.pinterest.com/**', (r) => r.fulfill({ json: board }))
  await page.route('https://i.pinimg.com/**', (r) => r.fulfill({ body: pin, contentType: 'image/jpeg' }))
  const files = [
    picture([[242, 240, 236], [200, 196, 190], [120, 110, 100]], 'test-results/insp-marble.jpg'),
    picture([[236, 230, 220], [150, 120, 90]], 'test-results/insp-oak.jpg'),
    picture([[60, 70, 80], [230, 232, 234]], 'test-results/insp-slate.jpg'),
  ]

  await page.goto('/')
  await page.waitForFunction(() => {
    const s = (window as any).__studio?.store?.getState?.()
    return !!s?.model && !s.status && !s.error
  })
  // The stand-in for Velda and Velda storage.
  await page.evaluate(() => {
    const w = window as any
    w.__prompts = []
    const stored = new Map<string, string>()
    w.__studio.store.setState({
      sdk: {
        ask: async (prompt: string) => {
          w.__prompts.push(prompt)
          if (prompt.startsWith('You are Velda, tagging inspiration')) {
            const n = (prompt.match(/^\d+\. /gm) ?? []).length
            const measured = [...prompt.matchAll(/measured colors ([^.\n]+)/g)].map((m) => m[1].split(', ').map((x: string) => x.split(' ')[0]))
            const remote = (prompt.match(/const urls = (\[.*\])/) ?? [])[1]
            return JSON.stringify({
              items: Array.from({ length: n }, (_, k) => ({
                i: k + 1,
                title: `Spa bath idea ${k + 1}`,
                style: ['spa', 'warm minimal'],
                materials: ['honed Carrara marble', 'white oak'],
                fixtures: ['curbless shower'],
                palette: (measured[k] ?? ['#dcdcdc']).slice(0, 3).map((hex: string, j: number) => ({ hex, name: ['stone white', 'warm grey', 'oak'][j] })),
                notes: 'Light stone and warm wood.',
              })),
              measured: remote ? JSON.parse(remote).map((_u: string, k: number) => ({ i: k + 1, palette: [{ hex: '#dcdcdc', share: 1 }] })) : [],
            })
          }
          const bath = w.__studio.store.getState().model.rooms.find((r: any) => r.name === 'Primary Bathroom').id
          return JSON.stringify({
            reply: 'Here is a warm spa theme for the primary bath, from your three pictures.',
            summary: 'Primary bath spa theme',
            ops: [{ op: 'theme', name: 'Primary bath spa', description: 'Light stone and warm oak', palette: [{ name: 'Stone white', hex: '#f2f0ec', role: 'walls' }, { name: 'Warm grey', hex: '#c8c4be', role: 'floors' }, { name: 'Oak', hex: '#96785a', role: 'cabinets' }], materials: [{ category: 'floor', choice: 'honed Carrara marble' }], apply_to: bath }],
            question: null,
          })
        },
        upload: async (path: string, b64: string, type: string) => stored.set(path, `data:${type};base64,${b64}`),
        signedUrl: async (path: string) => stored.get(path) ?? '',
        readImage: async (path: string) => stored.get(path) ?? null,
      },
    })
  })
  await page.getByRole('navigation', { name: 'Level' }).getByRole('button', { name: 'Level 2' }).click()
  await page.getByRole('navigation', { name: 'Room' }).getByRole('button', { name: 'Primary Bathroom', exact: true }).click()
  const bath = (await st(page)).roomId
  const v0 = (await st(page)).versions.length

  // 1. Three pictures in the chat box: it offers to file them under the focused room.
  await page.locator('.composer input[type=file]').setInputFiles(files)
  await expect(page.locator('.att-edit:not(.is-uploading)')).toHaveCount(3)
  await expect(page.locator('.insp-line')).toContainText('Add 3 pictures to inspiration for')
  await expect(page.locator('.insp-line select')).toHaveValue(bath)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect.poll(async () => (await st(page)).model.inspiration.length, { timeout: 30_000 }).toBe(3)
  await expect.poll(async () => !(await st(page)).activity).toBe(true)
  let s = await st(page)
  expect(s.versions.length).toBe(v0 + 1)
  const pics = s.model.inspiration
  expect(pics.every((c: any) => c.kind === 'image' && c.rooms[0] === bath && /^velda-studio\/uploads\//.test(c.image))).toBe(true)
  expect(pics[0].sampled.length).toBeGreaterThan(1) // measured in the page
  expect(pics[0].tags.palette.every((p: any) => pics[0].sampled.some((q: any) => q.hex === p.hex))).toBe(true)
  expect(s.messages.at(-1).body).toMatch(/^Added 3 pictures to the Primary Bathroom's inspiration\. What they share: spa, warm minimal, honed carrara marble/)

  // 2. A Pinterest board pasted in the Inspiration tab: a board card and one card per picture.
  await page.getByRole('tab', { name: 'Inspiration' }).click()
  await page.locator('.insp-link input').fill(BOARD)
  await expect(page.locator('.insp-drop')).toContainText('A Pinterest board')
  await page.locator('.insp-link').getByRole('button', { name: 'Add' }).click()
  await expect.poll(async () => (await st(page)).model.inspiration.length, { timeout: 30_000 }).toBe(13)
  await expect.poll(async () => !(await st(page)).activity).toBe(true)
  s = await st(page)
  expect(s.versions.length).toBe(v0 + 2)
  const boardCard = s.model.inspiration.find((c: any) => c.kind === 'board')
  expect(boardCard.title).toBe('marble Shower Tray finish anti-slip')
  expect(s.model.inspiration.filter((c: any) => c.parent === boardCard.id)).toHaveLength(9)
  const prompts = await page.evaluate(() => (window as any).__prompts as string[])
  expect(prompts.filter((p) => p.startsWith('You are Velda, tagging'))).toHaveLength(3) // 3 pictures, then 9 pins in two batches
  await expect(page.locator('.insp-card')).toHaveCount(13)
  // The board card carries what its pins share, so a tag filter keeps it with them.
  await page.locator('.insp-tags').getByRole('button', { name: 'curbless shower' }).click()
  await expect(page.locator('.insp-card')).toHaveCount(13)
  await page.locator('.insp-tags').getByRole('button', { name: 'curbless shower' }).click()
  await page.locator('.insp-filters select').selectOption('none')
  await expect(page.locator('.insp-card')).toHaveCount(0)
  await expect(page.locator('.insp')).toContainText('Nothing here with that room or tag.')
  await page.locator('.insp-filters select').selectOption(bath)
  await page.screenshot({ path: `${SHOTS}/phase6-inspiration-tab.jpg`, type: 'jpeg', quality: 80 })

  // 3. Pick the three pictures and make a theme: one version, applied to the room.
  for (const c of pics) await page.locator('.insp-card', { hasText: c.title }).first().getByRole('checkbox').check()
  await expect(page.locator('.insp-picked')).toContainText('3 picked')
  await page.getByRole('button', { name: 'Make a theme from these' }).click()
  await expect
    .poll(async () => {
      const m = (await st(page)).model
      return m.themes[m.rooms.find((r: any) => r.id === bath).theme]?.name
    }, { timeout: 30_000 })
    .toBe('Primary bath spa')
  s = await st(page)
  const themeAsk = (await page.evaluate(() => (window as any).__prompts.at(-1))) as string
  expect(themeAsk).toContain(`N8: Make a theme for the Primary Bathroom from these inspiration cards: ${pics[0].id}`)
  expect(themeAsk).toMatch(/INSPIRATION \(\d+ of 13 cards\):/)
  expect(s.model.themes[s.model.rooms.find((r: any) => r.id === bath).theme].name).toBe('Primary bath spa')

  // 4. The mood board shows the theme and the pictures, and prints alone.
  await page.getByRole('button', { name: 'Mood board' }).click()
  const mb = page.getByRole('dialog', { name: 'Primary Bathroom mood board' })
  await expect(mb).toContainText('Primary bath spa')
  await expect(mb.locator('.mb-swatches li')).toHaveCount(3)
  await expect(mb.locator('.mb-grid li')).toHaveCount(12)
  await page.screenshot({ path: `${SHOTS}/phase6-mood-board.jpg`, type: 'jpeg', quality: 80 })
  await mb.getByRole('button', { name: 'Close' }).click()
  await expect(mb).toHaveCount(0)

  // 5. Drag a card onto another room in the plan to file it there too.
  await page.keyboard.press('1')
  await page.locator('.insp-filters select').selectOption('all')
  const target = s.model.rooms.find((r: any) => r.level === 'L2' && r.name === 'Primary Bedroom')
  const id = await page.evaluate(() => (window as any).__studio.store.getState().model.inspiration.find((c: any) => c.kind === 'board').id)
  const at = await page.evaluate((r: any) => {
    const xs = r.polygon.map((p: number[]) => p[0])
    const ys = r.polygon.map((p: number[]) => p[1])
    return (window as any).__plan.toScreen([(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2])
  }, target)
  await page.evaluate(
    ({ id, x, y }) => {
      const dt = new DataTransfer()
      dt.setData('application/x-velda-inspiration', id)
      const svg = document.querySelector('svg.plan-svg') as Element
      svg.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
      svg.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
    },
    { id, x: at[0], y: at[1] },
  )
  await expect.poll(async () => (await st(page)).model.inspiration.find((c: any) => c.id === id).rooms).toEqual([bath, target.id])
  expect(errors).toEqual([])
})
