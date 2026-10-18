import { describe, expect, it } from 'vitest'
import { findJoints } from '../../src/model/derive'
import { distToSegment, polygonBounds } from '../../src/model/geom'
import { migrateV1 } from '../../src/model/migrate'
import { badgeOf } from '../../src/model/types'
import { level2HandChecked, v03AsBuilt, v03Kitchen } from './fixtures'

const now = '2026-10-18T00:00:00.000Z'
const handChecked = level2HandChecked.map((w) => ({ id: w.id, level: w.level, a: w.a, b: w.b }))

describe('migrating v0.3 schemes to model v2', () => {
  const v1 = v03AsBuilt()
  const { model, report } = migrateV1(v1, { handChecked, now })

  it('keeps every wall and opening (the live As-built head has 108 walls and 51 openings)', () => {
    expect(v1.walls).toHaveLength(108)
    expect(v1.walls.reduce((s, w) => s + w.openings.length, 0)).toBe(51)
    expect(model.walls).toHaveLength(108)
    expect(model.openings).toHaveLength(51)
    expect(report.handChecked).toBe(59)
  })

  it('moves the house into the A2 sheet frame so a fresh A2 import lands on top of it', () => {
    const w1 = model.walls.find((w) => w.id === 'L2w1')!
    expect(w1.a).toEqual([377.2, 160.8]) // the ground truth's reference wall L2w1
    expect(badgeOf(w1.prov.a)).toBe('measured') // hand-checked against A2 in v0.3
  })

  it('turns window glass heights into head heights and gives doors a swing marked as assumed', () => {
    const win = model.openings.find((o) => o.id === 'L2w1n1')!
    expect(win.h).toBe(84) // 36 sill + 48 glass
    expect(win.sill).toBe(36)
    expect(win.style).toBe('double_hung')
    expect(badgeOf(win.prov.h)).toBe('assumed')
    const door = model.openings.find((o) => o.id === 'L2w49d1')!
    expect(door.swing).toEqual({ hinge: 'a', side: 'left' })
    expect(badgeOf(door.prov.swing)).toBe('assumed')
    const cased = model.openings.find((o) => o.id === 'L2w3d1')!
    expect(cased.style).toBe('cased')
  })

  it('carries 9 ft 6 in ceilings as assumed so the app asks again', () => {
    for (const l of model.levels) {
      expect(l.ceiling).toBe(114)
      expect(badgeOf(l.prov.ceiling)).toBe('assumed')
    }
    expect(model.levels.find((l) => l.id === 'L2')!.elev).toBe(126)
  })

  it('marks walls on the outside of each level as exterior and load-bearing, and nothing else as no-load', () => {
    expect(report.exterior).toBeGreaterThan(20)
    for (const w of model.walls) {
      if (w.exterior) expect(w.bearing).toBe('yes')
      else expect(w.bearing).toBe('unknown')
    }
    expect(model.walls.find((w) => w.id === 'L2w1')!.exterior).toBe(true) // primary bedroom back wall
    expect(model.walls.find((w) => w.id === 'L2w44')!.exterior).toBe(false) // closet wall inside
  })

  it('closes every near-miss corner and tee; what stays open is a real gap in the v0.3 trace', () => {
    expect(report.healed.length).toBeGreaterThan(0)
    const l2 = model.walls.filter((w) => w.level === 'L2')
    const { corners, tees } = findJoints(l2)
    const joined = new Set<string>()
    for (const c of corners) for (const e of c.ends) joined.add(`${e.wall}.${e.end}`)
    for (const t of tees) joined.add(`${t.end.wall}.${t.end.end}`)
    for (const w of l2)
      for (const e of ['a', 'b'] as const) {
        if (joined.has(`${w.id}.${e}`)) continue
        const p = e === 'a' ? w.a : w.b
        // A loose end is never within healing reach (half the other wall plus 1.5 in) of another wall.
        for (const o of l2) if (o.id !== w.id) expect(distToSegment(p, o.a, o.b), `${w.id}.${e} near ${o.id}`).toBeGreaterThan(Math.min(o.t / 2 + 1.5, 3) - 0.01)
      }
  })

  it('derives the level 2 rooms the walls close, with sizes matching the drawn strings, and keeps v0.3 outlines elsewhere', () => {
    const l2 = model.rooms.filter((r) => r.level === 'L2')
    expect(l2.filter((r) => !r.flags.includes('needs_name')).map((r) => r.name).sort()).toEqual(v1.rooms.filter((r) => r.level === 'L2').map((r) => r.name).sort())
    const sizeOf = (name: string) => {
      const b = polygonBounds(l2.find((r) => r.name === name)!.polygon)
      return [b.x1 - b.x0, b.y1 - b.y0]
    }
    const pb = sizeOf('Primary Bedroom')
    expect(Math.abs(pb[0] - 236)).toBeLessThan(1) // 19'-8" on A2
    expect(Math.abs(pb[1] - 221.5)).toBeLessThan(1) // 18'-5 1/2"
    const laundry = sizeOf('Laundry Room')
    expect(Math.abs(laundry[0] - 90.75)).toBeLessThan(1.5) // 7'-6 3/4"
    expect(Math.abs(laundry[1] - 117.25)).toBeLessThan(1.5) // 9'-9 1/4"
    expect(l2.find((r) => r.name === 'Primary Bedroom')!.explicit).toBeFalsy()
    for (const r of l2.filter((x) => x.explicit)) expect(r.flags).toContain('open_outline')
    expect(report.explicitRooms).toBeLessThan(model.rooms.length)
  })

  it('migrates the kitchen scheme too, with its items moved into the same frame', () => {
    const k = v03Kitchen()
    const { model: m2 } = migrateV1(k, { now })
    expect(m2.walls).toHaveLength(k.walls.length)
    expect(m2.openings).toHaveLength(k.walls.reduce((s, w) => s + w.openings.length, 0))
    const island = m2.items.find((i) => i.id === 'n8-island')!
    expect([island.x, island.y]).toEqual([322.1, 420.2])
    expect(island.kind).toBe('island')
  })
})
