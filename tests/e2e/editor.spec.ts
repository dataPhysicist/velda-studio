import { expect, type Page, test } from '@playwright/test'

// 09 Phase 3: select a room, drag a wall 12 in, both rooms change by 12 and the neighbor walls
// stretch; add a door, flip the swing, delete it, undo twice. Everything goes through the real
// plan with the mouse and keyboard; assertions read the app's store.

type V = [number, number]
type Pick = {
  wall: string
  mid: V
  n: V
  a: { id: string; name: string; across: number }
  b: { id: string; name: string; across: number }
  corners: { id: string; length: number }[]
  doorAt: V
}

const state = (page: Page) => page.evaluate(() => (window as any).__studio.store.getState())
const versions = (page: Page) => page.evaluate(() => (window as any).__studio.store.getState().versions.length as number)
const toScreen = (page: Page, p: V) => page.evaluate((q) => (window as any).__plan.toScreen(q) as V, p)

/** An interior wall on level 2 with a derived room on each side, perpendicular walls at both ends, and room for a door. */
async function pickWall(page: Page): Promise<Pick | null> {
  return page.evaluate(() => {
    const m = (window as any).__studio.store.getState().model
    const inPoly = (p: number[], poly: number[][]) => {
      let c = false
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i]
        const [xj, yj] = poly[j]
        if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c
      }
      return c
    }
    const len = (w: any) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
    const across = (poly: number[][], n: number[]) => {
      const v = poly.map((p) => p[0] * n[0] + p[1] * n[1])
      return Math.max(...v) - Math.min(...v)
    }
    for (const w of m.walls) {
      if (w.level !== 'L2' || w.exterior) continue
      const L = len(w)
      if (L < 72) continue
      const u = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L]
      const n = [u[1], -u[0]]
      const mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2]
      const probe = (k: number) => [mid[0] + n[0] * (w.t / 2 + 6) * k, mid[1] + n[1] * (w.t / 2 + 6) * k]
      const ra = m.rooms.find((r: any) => r.level === 'L2' && !r.explicit && inPoly(probe(1), r.polygon))
      const rb = m.rooms.find((r: any) => r.level === 'L2' && !r.explicit && inPoly(probe(-1), r.polygon))
      if (!ra || !rb || ra.id === rb.id) continue
      const near = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= 0.5
      const corners = m.walls.filter((o: any) => {
        if (o.id === w.id || o.level !== 'L2') return false
        if (![o.a, o.b].some((e: number[]) => near(e, w.a) || near(e, w.b))) return false
        const ou = [(o.b[0] - o.a[0]) / len(o), (o.b[1] - o.a[1]) / len(o)]
        return Math.abs(ou[0] * u[0] + ou[1] * u[1]) < 0.05
      })
      if (corners.length < 2) continue
      // A clear 40 in stretch for the door, away from the openings already in this wall.
      const ops = m.openings.filter((o: any) => o.wall === w.id)
      let s = -1
      for (let t = 24; t <= L - 24; t += 2) if (ops.every((o: any) => Math.abs(o.at - t) > o.w / 2 + 22)) { s = t; break }
      if (s < 0) continue
      return {
        wall: w.id,
        mid,
        n,
        a: { id: ra.id, name: ra.name, across: across(ra.polygon, n) },
        b: { id: rb.id, name: rb.name, across: across(rb.polygon, n) },
        corners: corners.map((o: any) => ({ id: o.id, length: len(o) })),
        doorAt: [w.a[0] + u[0] * s, w.a[1] + u[1] * s],
      }
    }
    return null
  }) as Promise<Pick | null>
}

test('the plan editor: drag a wall 12 in, add a door, flip it, delete it, undo twice, join two rooms', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/')
  await page.waitForFunction(() => {
    const s = (window as any).__studio?.store?.getState?.()
    return !!s?.model && !s.status && !s.error
  })

  // Plan view (key 1), level 2.
  await page.keyboard.press('1')
  await page.getByRole('navigation', { name: 'Level' }).getByRole('button', { name: 'Level 2' }).click()
  await expect(page.getByTestId('plan')).toBeVisible()
  await expect(page.getByRole('toolbar', { name: 'Plan tools' }).getByRole('button')).toHaveCount(5)

  const pick = await pickWall(page)
  expect(pick, 'an interior wall between two rooms on level 2').not.toBeNull()
  const p = pick!

  // Zoom in on the wall so 12 in is many pixels.
  await page.evaluate((c) => (window as any).__plan.look(c, 6), p.mid)
  await page.waitForTimeout(200)

  // Select a room: click inside room A next to the wall. The Selection panel shows its name.
  const inA = await toScreen(page, [p.mid[0] + p.n[0] * 30, p.mid[1] + p.n[1] * 30])
  await page.mouse.click(inA[0], inA[1])
  await expect.poll(async () => (await state(page)).selection).toEqual([{ kind: 'room', id: p.a.id }])
  await expect(page.locator('#ctx-room-name')).toHaveValue(p.a.name)

  // Drag the wall 12 in into room A.
  const v0 = await versions(page)
  const from = await toScreen(page, p.mid)
  const to = await toScreen(page, [p.mid[0] + p.n[0] * 12, p.mid[1] + p.n[1] * 12])
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8)
  await expect(page.locator('.readout')).toContainText('→') // the two rooms' sizes update live
  await page.mouse.up()
  // 12 in is more than 6 in on a wall that may carry load: the engineer confirm comes first.
  await expect(page.getByRole('alertdialog')).toContainText('may carry load')
  await page.getByRole('button', { name: 'Move it' }).click()
  await expect.poll(() => versions(page)).toBe(v0 + 1)

  const after = await page.evaluate(
    ({ p }) => {
      const m = (window as any).__studio.store.getState().model
      const across = (poly: number[][], n: number[]) => {
        const v = poly.map((q) => q[0] * n[0] + q[1] * n[1])
        return Math.max(...v) - Math.min(...v)
      }
      const len = (w: any) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
      const room = (id: string) => m.rooms.find((r: any) => r.id === id)
      return {
        a: across(room(p.a.id).polygon, p.n),
        b: across(room(p.b.id).polygon, p.n),
        corners: p.corners.map((c: any) => len(m.walls.find((w: any) => w.id === c.id))),
        note: m.notes.some((n: any) => n.locked && n.text.includes(p.wall)),
        summary: (window as any).__studio.store.getState().versions.at(-1).summary,
      }
    },
    { p },
  )
  expect(after.summary).toBe(`Moved a wall 1'-0"`)
  expect(after.a - p.a.across).toBeCloseTo(-12, 1) // the wall moved into room A
  expect(after.b - p.b.across).toBeCloseTo(12, 1)
  p.corners.forEach((c, i) => expect(Math.abs(after.corners[i] - c.length)).toBeCloseTo(12, 1)) // neighbors stretched
  expect(after.note).toBe(true) // the engineer note stays with the plan

  // Add a door with the Opening tool: click on the wall.
  await page.keyboard.press('o')
  await expect(page.getByRole('toolbar', { name: 'Plan tools' }).getByRole('button', { name: 'Opening' })).toHaveAttribute('aria-pressed', 'true')
  const moved: V = [p.doorAt[0] + p.n[0] * 12, p.doorAt[1] + p.n[1] * 12]
  const at = await toScreen(page, moved)
  await page.mouse.move(at[0], at[1])
  await page.mouse.down()
  await page.mouse.up()
  await expect(page.getByRole('alertdialog')).toContainText('header')
  await page.getByRole('button', { name: 'Add it' }).click()
  await expect.poll(() => versions(page)).toBe(v0 + 2)
  const door = await page.evaluate(() => {
    const s = (window as any).__studio.store.getState()
    const sel = s.selection[0]
    return sel?.kind === 'opening' ? s.model.openings.find((o: any) => o.id === sel.id) : null
  })
  expect(door).toMatchObject({ wall: p.wall, kind: 'door', w: 32, swing: { hinge: 'a', side: 'left' } })
  expect((await state(page)).tool).toBe('select')

  // Flip the hinge (Space) and the side it swings into (Shift-Space).
  const swing = () => page.evaluate((id) => (window as any).__studio.store.getState().model.openings.find((o: any) => o.id === id)?.swing ?? null, door.id)
  await page.keyboard.press('Space')
  await expect.poll(swing).toEqual({ hinge: 'b', side: 'left' })
  await page.keyboard.press('Shift+Space')
  await expect.poll(swing).toEqual({ hinge: 'b', side: 'right' })

  // Delete it, then undo twice: the door is back with the hinge flipped and the side as it was.
  await page.keyboard.press('Delete')
  await expect.poll(swing).toBeNull()
  expect(await versions(page)).toBe(v0 + 5)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(swing).toEqual({ hinge: 'b', side: 'right' })
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(swing).toEqual({ hinge: 'b', side: 'left' })
  const head = await page.evaluate(() => {
    const s = (window as any).__studio.store.getState()
    return s.versions.find((v: any) => v.id === s.headId).summary
  })
  expect(head).toBe('Moved the door hinge to the other side')

  // Remove the wall itself: the two rooms become one, and the person picks the name that stays.
  const clear = await page.evaluate((id) => {
    const m = (window as any).__studio.store.getState().model
    const w = m.walls.find((x: any) => x.id === id)
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
    const ops = m.openings.filter((o: any) => o.wall === id)
    for (let t = 8; t <= L - 8; t += 2) if (ops.every((o: any) => Math.abs(o.at - t) > o.w / 2 + 6)) return [w.a[0] + ((w.b[0] - w.a[0]) * t) / L, w.a[1] + ((w.b[1] - w.a[1]) * t) / L]
    return null
  }, p.wall)
  expect(clear).not.toBeNull()
  const onWall = await toScreen(page, clear as V)
  await page.mouse.click(onWall[0], onWall[1])
  await expect.poll(async () => (await state(page)).selection).toEqual([{ kind: 'wall', id: p.wall }])
  await page.keyboard.press('Delete')
  const ask = page.getByRole('alertdialog')
  await expect(ask).toContainText('become one room')
  await ask.getByRole('button', { name: p.b.name, exact: true }).click()
  await expect(ask).toContainText('may carry load')
  await ask.getByRole('button', { name: 'Remove it' }).click()
  await expect
    .poll(() => page.evaluate(({ a, b }) => (window as any).__studio.store.getState().model.rooms.filter((r: any) => r.id === a || r.id === b).map((r: any) => r.name), { a: p.a.id, b: p.b.id }))
    .toEqual([p.b.name])

  await page.evaluate((id) => (window as any).__plan.frameRoom(id), p.b.id)
  await page.evaluate((id) => (window as any).__studio.store.setState({ roomId: id, selection: [{ kind: 'room', id }] }), p.b.id)
  await expect(page.locator('.notice')).toHaveCount(0, { timeout: 10_000 })
  await page.screenshot({ path: `${process.env.BUILDLOG ? 'docs/buildlog' : 'test-results'}/phase3-editor-joined-rooms.jpg`, type: 'jpeg', quality: 80 })
  expect(errors).toEqual([])
})
