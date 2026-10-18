import { expect, test } from '@playwright/test'

// A scheme saved by v0.3 (model v1) opens on model v2: the page migrates it once, saves the result as
// a new version by "migration", keeps the old version, and keeps every wall and opening.
test('opening a v0.3 scheme migrates it once and keeps the old version', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const s = (window as any).__studio?.store?.getState?.()
    return !!s?.model && !s.status
  })
  const result = await page.evaluate(async () => {
    const st = (window as any).__studio
    const v1 = {
      v: 1,
      ceiling: 108,
      levels: [{ id: 'L1', name: 'Level 1', elev: 0, height: 108 }],
      walls: [
        { id: 'w1', level: 'L1', a: [0, 0], b: [144, 0], t: 6, openings: [{ id: 'n1', kind: 'window', at: 72, w: 36, h: 48, sill: 36 }] },
        { id: 'w2', level: 'L1', a: [144, 0], b: [144, 120], t: 6, openings: [] },
        { id: 'w3', level: 'L1', a: [144, 120], b: [0, 120], t: 6, openings: [{ id: 'd1', kind: 'door', at: 40, w: 32, h: 80, style: 'swing' }] },
        { id: 'w4', level: 'L1', a: [0, 120], b: [0, 0], t: 6, openings: [] },
      ],
      rooms: [{ id: 'r1', level: 'L1', name: 'Den', polygon: [[3, 3], [141, 3], [141, 117], [3, 117]] }],
      items: [],
      theme: null,
      themes: {},
    }
    await st.repo.saveScheme({ id: 'legacy', name: 'Old scheme', head_version: 'old-v1', sort: 9 })
    await st.repo.addVersion({ id: 'old-v1', scheme_id: 'legacy', seq: 1, summary: 'Saved by v0.3', source: 'chat' }, v1)
    await st.openScheme('legacy')
    const s = st.store.getState()
    const versions = await st.repo.versions('legacy')
    const old = await st.repo.model('old-v1')
    return {
      v: s.model.v,
      walls: s.model.walls.length,
      openings: s.model.openings.length,
      window: s.model.openings.find((o: any) => o.id === 'n1'),
      room: s.model.rooms.map((r: any) => r.name),
      versions: versions.map((v: any) => [v.seq, v.author ?? null, v.summary]),
      oldStillV1: old.v,
      head: s.headId === versions[versions.length - 1].id,
    }
  })
  expect(result.v).toBe(2)
  expect(result.walls).toBe(4)
  expect(result.openings).toBe(2)
  expect(result.window.h).toBe(84)
  expect(result.room).toEqual(['Den'])
  expect(result.versions).toEqual([
    [1, null, 'Saved by v0.3'],
    [2, 'migration', 'Updated to the new model (every wall and opening kept)'],
  ])
  expect(result.oldStillV1).toBe(1)
  expect(result.head).toBe(true)
})
