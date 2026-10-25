import { expect, type Page, test } from '@playwright/test'

// 09 Phase 5, the page side of chat: Velda's answers go through the real send() path (ops table
// check, as-built rule, one version per answer, skipped ops reported, analyze in two steps, propose as
// option schemes). Velda itself needs Toolbelt, so here a stand-in answers with the ops Velda would
// return, built from the ids the prompt shows it; the signed-in page runs the same three requests
// against the real Velda (build log). BUILDLOG=1 saves screenshots to docs/buildlog.

const SHOTS = process.env.BUILDLOG ? 'docs/buildlog' : 'test-results'
const state = (page: Page) => page.evaluate(() => (window as any).__studio.store.getState())
const item = (page: Page, id: string) => page.evaluate((i) => (window as any).__studio.store.getState().model.items.find((x: any) => x.id === i), id)
const versions = (page: Page) => page.evaluate(() => (window as any).__studio.store.getState().versions.length as number)

/** Say something in the chat; the stand-in answers with the given JSON answers in turn. */
async function say(page: Page, text: string, ...answers: object[]) {
  const before = await page.evaluate(() => (window as any).__studio.store.getState().messages.length as number)
  await page.evaluate((a) => (window as any).__answers.push(...a), answers)
  const box = page.locator('.composer textarea')
  await box.fill(text)
  await box.press('Enter')
  await expect.poll(() => page.evaluate(() => !(window as any).__studio.store.getState().thinking)).toBe(true)
  await expect.poll(() => page.evaluate(() => (window as any).__studio.store.getState().messages.length as number)).toBe(before + 2)
  return page.evaluate(() => (window as any).__studio.store.getState().messages.at(-1))
}
/** Positions are kept to the nearest 1/8 in. */
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(0.126)
const lastPrompt = (page: Page) => page.evaluate(() => (window as any).__prompts.at(-1)?.prompt as string)

test('chat: the three kitchen changes each land as one version; analyze and propose', async ({ page }) => {
  test.setTimeout(300_000)
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
  await page.getByRole('navigation', { name: 'Room' }).getByRole('button', { name: 'Kitchen', exact: true }).click()
  await page.evaluate((id) => (window as any).__plan.frameRoom(id), kitchen)

  // Setup: the sink back on the sink wall counter, as it is in the house today.
  const counter = await item(page, 'n8-counter-sink')
  await page.evaluate(async (y) => {
    const ed = await (window as any).__studio.editor()
    await ed.handEdit([{ op: 'move', id: 'n8-sink', x: 286, y, rot: 0 }], 'Put the sink back on the sink wall (test setup)')
  }, counter.y)
  // The stand-in for Velda: records each prompt, answers from a queue.
  await page.evaluate(() => {
    const w = window as any
    w.__prompts = []
    w.__answers = []
    w.__studio.store.setState({
      sdk: {
        ask: async (prompt: string, model: string) => {
          w.__prompts.push({ prompt, model })
          return JSON.stringify(w.__answers.shift() ?? { reply: 'Nothing queued.', summary: '', ops: [], question: null })
        },
        upload: async () => {},
        signedUrl: async (p: string) => p,
        readImage: async () => '',
      },
    })
  })
  let v = await versions(page)

  // 1. "move the sink to the island": set into the island, facing the range side.
  const msg1 = await say(page, 'move the sink to the island', {
    reply: 'I set the sink into the island, facing the range.',
    summary: 'Sink moved to island',
    ops: [{ op: 'place', id: 'n8-sink', on: 'n8-island', facing: 'back' }],
    question: null,
  })
  const p1 = await lastPrompt(page)
  expect(p1).toContain('N8: move the sink to the island')
  expect(p1).toMatch(/n8-sink sink "Main sink \(on island\)" .*, set into n8-counter-sink/) // the prompt shows where it is now
  expect(await versions(page)).toBe(++v)
  const island = await item(page, 'n8-island')
  const sink = await item(page, 'n8-sink')
  near(sink.x, island.x)
  near(sink.y, island.y - (island.d / 2 - sink.d / 2)) // its front on the island's back edge
  expect(sink.rot).toBe(180)
  expect(msg1.version_id).toBeTruthy()
  await page.evaluate((id) => (window as any).__plan.frameRoom(id), kitchen)
  await page.screenshot({ path: `${SHOTS}/phase5-chat-1-sink-to-island.jpg`, type: 'jpeg', quality: 80 })

  // 2. "add patio doors where the sink wall is": the window behind where the sink was becomes 6 ft
  // sliding doors in the same place.
  const sinkWall = await page.evaluate(() => {
    const m = (window as any).__studio.store.getState().model
    const c = m.items.find((x: any) => x.id === 'n8-counter-sink')
    const backY = c.y - c.d / 2
    return m.walls.find((w: any) => w.level === 'L1' && Math.abs(w.a[1] - w.b[1]) < 1 && Math.abs(Math.abs(w.a[1] - backY) - w.t / 2) < 2 && Math.min(w.a[0], w.b[0]) < c.x && Math.max(w.a[0], w.b[0]) > c.x)
  })
  const windows = await page.evaluate((id) => (window as any).__studio.store.getState().model.openings.filter((o: any) => o.wall === id && o.kind === 'window'), sinkWall.id)
  expect(windows.length).toBeGreaterThan(0)
  const win = windows.sort((a: any, b: any) => b.w - a.w)[0]
  await say(page, 'add patio doors where the sink wall is', {
    reply: 'The window over the old sink spot is now a pair of 6 ft sliding doors. An engineer has to size the header in this outside wall.',
    summary: 'Patio doors on the sink wall',
    ops: [{ op: 'replace_opening', id: win.id, kind: 'door', style: 'sliding', w: 72 }],
    question: null,
  })
  expect(await versions(page)).toBe(++v)
  const door = await page.evaluate((id) => (window as any).__studio.store.getState().model.openings.find((o: any) => o.id === id), win.id)
  expect(door).toMatchObject({ kind: 'door', style: 'sliding', w: 72, h: 80, wall: sinkWall.id, at: win.at })
  expect(door.sill).toBeUndefined()
  expect((await state(page)).model.notes.some((n: any) => n.locked && /widened to 6'-0"/.test(n.text))).toBe(true)
  await page.evaluate((id) => (window as any).__plan.frameRoom(id), kitchen)
  await page.screenshot({ path: `${SHOTS}/phase5-chat-2-patio-doors.jpg`, type: 'jpeg', quality: 80 })

  // 3. "swap the range and the fridge tower": the two columns trade places with the range.
  const before = await page.evaluate(() => {
    const m = (window as any).__studio.store.getState().model
    return Object.fromEntries(['n8-range', 'n8-fridge', 'n8-freezer'].map((id) => [id, m.items.find((x: any) => x.id === id)]))
  })
  await say(page, 'swap the range and the fridge tower', {
    reply: 'The range and the refrigerator and freezer columns traded places.',
    summary: 'Range and fridge tower swapped',
    ops: [{ op: 'swap', a: 'n8-range', b: ['n8-fridge', 'n8-freezer'] }],
    question: null,
  })
  expect(await versions(page)).toBe(++v)
  const after = await page.evaluate(() => {
    const m = (window as any).__studio.store.getState().model
    return Object.fromEntries(['n8-range', 'n8-fridge', 'n8-freezer'].map((id) => [id, m.items.find((x: any) => x.id === id)]))
  })
  // The range's back sits where the tower's backs were, centered on the tower; the tower faces the
  // way the range did, its backs on the range wall, centered where the range was.
  const backOf = (it: any) => {
    const r = (it.rot * Math.PI) / 180
    return [it.x - (Math.sin(r) * it.d) / 2, it.y - (Math.cos(r) * it.d) / 2]
  }
  const range = after['n8-range']
  expect(range.rot).toBe(before['n8-fridge'].rot)
  near(backOf(range)[1], backOf(before['n8-fridge'])[1])
  near(range.x, (before['n8-fridge'].x + before['n8-freezer'].x) / 2)
  for (const id of ['n8-fridge', 'n8-freezer']) {
    expect(after[id].rot).toBe(before['n8-range'].rot)
    near(backOf(after[id])[0], backOf(before['n8-range'])[0])
  }
  near((after['n8-fridge'].y + after['n8-freezer'].y) / 2, before['n8-range'].y)
  await page.evaluate((id) => (window as any).__plan.frameRoom(id), kitchen)
  await page.screenshot({ path: `${SHOTS}/phase5-chat-3-range-fridge-swap.jpg`, type: 'jpeg', quality: 80 })

  // An op the app cannot do is not claimed: the reply says so and Velda hears it next turn.
  const msg4 = await say(page, 'make the patio doors swing into the kitchen', {
    reply: 'Done.',
    summary: 'Patio doors swing in',
    ops: [{ op: 'set_swing', id: win.id, into: 'Kitchen' }],
    question: null,
  })
  expect(await versions(page)).toBe(v)
  expect(msg4.body).toBe("I could not apply that to the model: a sliding door does not swing. Try saying it another way.")

  // Analyze: the page runs the checker after Velda's ops and Velda writes the reply from it.
  const msg5 = await say(
    page,
    'check the kitchen for me',
    { reply: 'Checking.', summary: '', ops: [{ op: 'analyze', scope: 'Kitchen' }], question: null },
    { reply: 'Two things: the island aisle is tight and the island sink needs a vent.', summary: '', ops: [], question: null },
  )
  const prompts = await page.evaluate(() => (window as any).__prompts.map((p: any) => p.prompt) as string[])
  expect(prompts.at(-2)).toContain(`SKIPPED: set_swing ${win.id}: a sliding door does not swing`)
  expect(prompts.at(-1)).toContain('CHECK RESULTS for the Kitchen')
  expect(prompts.at(-1)).toMatch(/island .*needs an island vent/)
  expect(msg5.body).toBe('Two things: the island aisle is tight and the island sink needs a vent.')

  // Propose: two option schemes branched from this one, shown as cards with a plan each.
  const schemesBefore = (await state(page)).schemes.length
  const msg6 = await say(page, 'what would you do with the kitchen?', {
    reply: 'Two ways to go: a galley along the long walls, or keep the island and tighten the run.',
    summary: '',
    ops: [
      {
        op: 'propose',
        room: 'Kitchen',
        options: [
          { label: 'Galley kitchen', ops: [{ op: 'arrange', room: 'Kitchen', layout: 'galley' }] },
          { label: 'Island kitchen', ops: [{ op: 'arrange', room: 'Kitchen', layout: 'island' }] },
        ],
      },
    ],
    question: null,
  })
  expect(msg6.meta.choices.map((c: any) => c.label)).toEqual(['Galley kitchen', 'Island kitchen'])
  expect((await state(page)).schemes.length).toBe(schemesBefore + 2)
  const cards = page.locator('.choice')
  await expect(cards).toHaveCount(2)
  await expect(cards.first().locator('svg.choice-thumb')).toBeVisible()
  await page.locator('.bubble').last().scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/phase5-chat-propose.jpg`, type: 'jpeg', quality: 80 })
  await cards.first().getByRole('button', { name: 'Open this one' }).click()
  await expect.poll(async () => (await state(page)).schemeId).toBe(msg6.meta.choices[0].scheme_id)
  expect((await state(page)).model.items.filter((i: any) => i.kind === 'sink')).toHaveLength(1)
  expect(errors).toEqual([])
})
