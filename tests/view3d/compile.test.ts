import { describe, expect, it } from 'vitest'
import { deriveRooms } from '../../src/model/derive'
import { applyOps } from '../../src/model/ops'
import type { Model } from '../../src/model/types'
import { IN } from '../../src/model/units'
import { compileScene } from '../../src/view3d/compile'
import { twoRooms, wall } from '../model/fixtures'

const node = (m: Model, id: string) => compileScene(m).nodes[id]

describe('3D from model v2', () => {
  it('gives every wall, opening and room a node that carries its model id (selection and edits follow it)', () => {
    const m = deriveRooms(twoRooms())
    const scene = compileScene(m)
    const sids = new Set(Object.values(scene.nodes).map((n) => n.metadata?.sid))
    for (const w of m.walls) expect(scene.nodes[`wall_${w.id}`]?.metadata.sid).toBe(w.id)
    for (const o of m.openings) expect(sids.has(o.id)).toBe(true)
    for (const r of m.rooms) expect(scene.nodes[`zone_${r.id}`]?.metadata.sid).toBe(r.id)
  })

  it('swings doors the way the plan shows them', () => {
    // d1 is hinged at the wall's start and swings to the left of start to end; Pascal's +z is the right.
    const m = deriveRooms(twoRooms())
    expect(node(m, 'door_d1')).toMatchObject({ doorType: 'hinged', hingesSide: 'left', swingDirection: 'outward' })
    const flipped = applyOps(m, [{ op: 'update_opening', id: 'd1', swing: { hinge: 'b', side: 'right' } }], { author: 'user' }).model
    expect(node(flipped, 'door_d1')).toMatchObject({ hingesSide: 'right', swingDirection: 'inward' })
    expect(node(flipped, 'door_d1').swingAngle).toBeGreaterThan(0.5) // stands open, so the leaf shows the swing
  })

  it('draws sliding, pocket and pair doors and cased openings as what they are', () => {
    const m = deriveRooms(twoRooms())
    const as = (style: string, w = 30) => node(applyOps(m, [{ op: 'update_opening', id: 'd1', style, w }], { author: 'user' }).model, 'door_d1')
    expect(as('sliding', 60)).toMatchObject({ doorType: 'sliding' })
    expect(as('pocket')).toMatchObject({ doorType: 'pocket' })
    expect(as('french', 60)).toMatchObject({ doorType: 'french', leafCount: 2 })
    expect(as('cased')).toMatchObject({ openingKind: 'opening' })
  })

  it('stops half walls and rails short of the ceiling', () => {
    const m = twoRooms()
    m.walls.push(wall('half', [20, 20], [80, 20], 4, { kind: 'half' }), wall('rail', [20, 60], [80, 60], 2, { kind: 'rail' }))
    const scene = compileScene(deriveRooms(m))
    expect(scene.nodes.wall_half.height).toBeCloseTo(42 * IN)
    expect(scene.nodes.wall_rail.height).toBeCloseTo(36 * IN)
    expect(scene.nodes.wall_mid.height).toBeCloseTo(108 * IN)
  })

  it('builds a stair as one flight from its bottom step, up the direction the plan gives', () => {
    const m = twoRooms()
    m.levels.push({ id: 'L2', name: 'Level 2', elev: 120, ceiling: 108, floorThickness: 12, sheetIds: [], prov: m.levels[0].prov })
    // 40 in wide, 130 in run, going up toward -y (up the sheet).
    m.stairs = [{ id: 's1', level: 'L1', toLevel: 'L2', polygon: [[150, 10], [190, 10], [190, 140], [150, 140]], up: [0, -1], prov: { src: 'user' } }]
    const scene = compileScene(m)
    const st = scene.nodes.stair_s1
    expect(st.parentId).toBe('level_L1')
    expect(st.position[0]).toBeCloseTo(170 * IN)
    expect(st.position[2]).toBeCloseTo(140 * IN) // the bottom step is at the far end from "up"
    expect(Math.cos(st.rotation)).toBeCloseTo(-1) // local +z points up the sheet
    const seg = scene.nodes.sseg_s1
    expect(seg.parentId).toBe('stair_s1')
    expect(seg.length).toBeCloseTo(130 * IN)
    expect(seg.width).toBeCloseTo(40 * IN)
    expect(seg.height).toBeCloseTo(120 * IN)
    expect(seg.stepCount).toBe(16)
  })

  it("colors a room's walls with its own theme only where every room the wall faces shares it", () => {
    const m = deriveRooms(twoRooms())
    m.themes = { warm: { id: 'warm', name: 'Warm', data: { palette: [{ role: 'walls', hex: '#c08050', name: 'Clay' }] } } }
    m.rooms.find((r) => r.name === 'Den')!.theme = 'warm'
    const scene = compileScene(m)
    expect(scene.nodes.wall_left.slots.interior).toContain('warm') // outside wall of the Den only
    expect(scene.nodes.wall_mid.slots.interior).not.toContain('warm') // shared with the Office
  })
})

describe('sun presets', () => {
  it('puts the 10 am sun in the south-east and the 4 pm sun in the south-west, turned by north', async () => {
    const { sunDirection } = await import('../../src/view3d/sun')
    const am = sunDirection(10, 0)
    const pm = sunDirection(16, 0)
    expect(am[0]).toBeGreaterThan(0) // east is +x
    expect(am[2]).toBeGreaterThan(0) // south is down the sheet (+z)
    expect(pm[0]).toBeLessThan(0)
    expect(am[1]).toBeGreaterThan(0.6) // about 48 degrees up at 30.5 N
    const turned = sunDirection(10, 90) // north points to the right of the sheet
    expect(turned[0]).toBeLessThan(0) // the sun is now down-left
    expect(turned[2]).toBeGreaterThan(0)
  })
})
