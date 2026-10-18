import { expect, test } from '@playwright/test'

// The local preview opens on the memory store with the fixture house (level 1 from A4, level 2 from A2).
test('the studio opens the local preview on model v2 with both levels and draws the 3D view', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/')

  // Wait for boot to finish: a model is loaded and nothing is covering the stage.
  await page.waitForFunction(() => {
    const s = (window as any).__studio?.store?.getState?.()
    return !!s?.model && !s.status && !s.error
  })
  const summary = await page.evaluate(() => {
    const s = (window as any).__studio.store.getState()
    const m = s.model
    return {
      repo: s.repo.kind,
      v: m.v,
      openings: m.openings.length,
      ceilings: m.levels.map((l: any) => [l.ceiling, l.prov.ceiling.src]),
      levels: m.levels.map((l: any) => l.id),
      walls: m.walls.length,
      l2Walls: m.walls.filter((w: any) => w.level === 'L2').length,
      rooms: m.rooms.length,
      schemes: s.schemes.length,
    }
  })
  expect(summary.repo).toBe('memory')
  expect(summary.v).toBe(2) // the v0.3 fixture was migrated to model v2 on import
  expect(summary.openings).toBeGreaterThan(30)
  expect(summary.ceilings).toEqual([[114, 'default'], [114, 'default']]) // carried over, marked assumed
  expect(summary.levels).toEqual(['L1', 'L2'])
  expect(summary.walls).toBeGreaterThan(40)
  expect(summary.rooms).toBeGreaterThan(10)
  expect(summary.schemes).toBe(1)

  // The 3D canvas exists and has a drawing context (WebGL through SwiftShader in headless runs).
  const canvas = page.locator('.stage-canvas canvas').first()
  await expect(canvas).toBeVisible()
  await expect(page.locator('.title-block .wordmark')).toHaveText('Velda Studio')
  expect(errors).toEqual([])
})
