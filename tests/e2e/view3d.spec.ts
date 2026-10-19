import { expect, type Page, test } from '@playwright/test'

// 09 Phase 4: switch to 3D, click a wall, the plan's selection is that wall; one screenshot per wall
// mode (BUILDLOG=1 saves them to docs/buildlog); Walk still works in the primary bath.
//
// In this sandbox 3D draws through SwiftShader and Pascal builds wall geometry a few walls per frame,
// so the test waits for the walls it needs before it clicks or takes a picture.

type V3 = [number, number, number]
const SHOTS = process.env.BUILDLOG ? 'docs/buildlog' : 'test-results'
const IN = 0.0254

const wallsBuilt = (page: Page, ids?: string[]) =>
  page.evaluate((only) => {
    const reg = (window as any).__studio.registry
    let built = 0
    let total = 0
    for (const [id, o] of reg.nodes as Map<string, any>) {
      if (!id.startsWith('wall_') || (only && !only.includes(id))) continue
      total++
      if ((o.geometry?.attributes?.position?.count ?? 0) > 3) built++
    }
    return total > 0 && built === total
  }, ids ?? null)

test('3D: a wall clicked in 3D is selected in the plan; the wall modes; Walk in the primary bath', async ({ page }) => {
  test.setTimeout(600_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/')
  await page.waitForFunction(() => {
    const s = (window as any).__studio?.store?.getState?.()
    return !!s?.model && !s.status && !s.error
  })
  await page.getByRole('navigation', { name: 'Level' }).getByRole('button', { name: 'Level 2' }).click()

  // Walls full height for the click (chosen in the 3D view options, as a person would).
  await page.getByRole('button', { name: /^Walls:/ }).click()
  await page.getByRole('group', { name: 'Walls' }).getByRole('button', { name: 'Full' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__studio.viewer.getState().wallMode)).toBe('up')
  await page.getByRole('button', { name: /^Walls:/ }).click() // close the options

  // A Primary Bedroom wall with nothing in its middle; stand 2.5 m inside the room and look at it.
  const pick = await page.evaluate(() => {
    const m = (window as any).__studio.store.getState().model
    const r = m.rooms.find((x: any) => x.name === 'Primary Bedroom')
    const inP = (p: number[], poly: number[][]) => {
      let c = false
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i]
        const [xj, yj] = poly[j]
        if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c
      }
      return c
    }
    let best: any = null
    for (const w of m.walls.filter((x: any) => x.level === 'L2')) {
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
      if (L < 72) continue
      const u = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L]
      const n = [u[1], -u[0]]
      const mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2]
      if (m.openings.some((o: any) => o.wall === w.id && Math.abs(o.at - L / 2) < o.w / 2 + 12)) continue
      for (const k of [1, -1]) {
        const eye = [mid[0] + n[0] * 100 * k, mid[1] + n[1] * 100 * k]
        if (inP(eye, r.polygon) && (!best || L > best.L)) best = { id: w.id, L, mid, eye, face: [mid[0] + n[0] * (w.t / 2) * k, mid[1] + n[1] * (w.t / 2) * k] }
      }
    }
    return best
  })
  expect(pick, 'a Primary Bedroom wall to click').not.toBeNull()
  await expect.poll(() => wallsBuilt(page, [`wall_${pick.id}`]), { timeout: 240_000, intervals: [2000] }).toBe(true)
  const floor = (await page.evaluate(() => (window as any).__studio3d.positionOf('level_L2')))[1] as number
  const at: V3 = [pick.face[0] * IN, floor + 1.3, pick.face[1] * IN]
  await page.evaluate(([e, a]) => (window as any).__studio3d.lookAt(e, a), [[pick.eye[0] * IN, floor + 1.3, pick.eye[1] * IN], at])
  const xy = (await page.evaluate((p) => (window as any).__studio3d.toScreen(p), at)) as [number, number]
  // Picking uses the camera as last drawn; at a frame or two a second the first click can land
  // before the new view is drawn, so click again until it takes (a person sees the view first).
  const selection = () => page.evaluate(() => (window as any).__studio.store.getState().selection)
  for (let i = 0; i < 6 && JSON.stringify(await selection()) !== JSON.stringify([{ kind: 'wall', id: pick.id }]); i++) {
    await page.waitForTimeout(2500)
    await page.mouse.click(xy[0], xy[1])
  }
  await expect.poll(selection, { timeout: 30_000 }).toEqual([{ kind: 'wall', id: pick.id }])
  await expect(page.locator('.ctx-title').first()).toHaveText(/wall/i)
  expect(await page.evaluate(() => (window as any).__studio.viewer.getState().externalSelectedIds)).toEqual([`wall_${pick.id}`])

  // The plan shows the same wall selected.
  await page.keyboard.press('1')
  await expect(page.locator(`.plan .wall[data-id="${pick.id}"]`)).toHaveClass(/is-sel/)

  // One picture per wall mode, from the usual view of level 2 (all walls built first).
  if (process.env.BUILDLOG) {
    await page.keyboard.press('2')
    await expect.poll(() => wallsBuilt(page), { timeout: 300_000, intervals: [3000] }).toBe(true)
    await page.evaluate(() => (window as any).__studio.focusOn({ levelId: 'L2', roomId: null, view: '3d' }))
    for (const [mode, name] of [
      ['cutaway', 'Cut away'],
      ['up', 'Full'],
      ['translucent', 'See-through'],
      ['down', 'Off'],
    ]) {
      await page.getByRole('button', { name: /^Walls:/ }).click()
      await page.getByRole('group', { name: 'Walls' }).getByRole('button', { name }).click()
      await page.getByRole('button', { name: /^Walls:/ }).click()
      await expect.poll(() => page.evaluate(() => (window as any).__studio.viewer.getState().wallMode)).toBe(mode)
      await page.waitForTimeout(6000)
      await page.screenshot({ path: `${SHOTS}/phase4-walls-${mode}.jpg`, type: 'jpeg', quality: 80, timeout: 240_000 })
    }
  }

  // Walk in the primary bath: it starts inside the room and W moves you.
  await page.keyboard.press('2')
  await page.getByRole('navigation', { name: 'Room' }).getByRole('button', { name: 'Primary Bathroom' }).click()
  await page.getByRole('button', { name: 'Walk through' }).click()
  const start = await page.evaluate(() => (window as any).__studio.store.getState().walk)
  expect(start?.levelId).toBe('L2')
  const bath = await page.evaluate(() => (window as any).__studio.store.getState().model.rooms.find((r: any) => r.name === 'Primary Bathroom').polygon)
  const inside = (x: number, z: number) => {
    let c = false
    for (let i = 0, j = bath.length - 1; i < bath.length; j = i++) {
      const [xi, yi] = bath[i]
      const [xj, yj] = bath[j]
      if (yi > z !== yj > z && x < ((xj - xi) * (z - yi)) / (yj - yi) + xi) c = !c
    }
    return c
  }
  const cam = () => page.evaluate(() => (window as any).__studioCam().three.camera.position.toArray() as V3)
  await expect.poll(async () => {
    const p = await cam()
    return inside(p[0] / IN, p[2] / IN)
  }, { timeout: 60_000 }).toBe(true)
  const before = await cam()
  // SwiftShader draws a frame or two a second here and each step is clamped, so allow a short walk.
  await page.keyboard.down('w')
  await page.waitForTimeout(4000)
  await page.keyboard.up('w')
  await expect.poll(async () => {
    const p = await cam()
    return Math.hypot(p[0] - before[0], p[2] - before[2])
  }, { timeout: 30_000 }).toBeGreaterThan(0.05)
  const after = await cam()
  expect(Math.abs(after[1] - before[1])).toBeLessThan(0.05) // eye height holds
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => !!(window as any).__studio.store.getState().walk)).toBe(false)
  expect(errors).toEqual([])
})
