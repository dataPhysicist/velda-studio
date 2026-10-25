import { describe, expect, it } from 'vitest'
import { type Issue, runChecks, windowClear } from '../../src/analysis/checks'
import { roomOf } from '../../src/analysis/space'
import { deriveRooms } from '../../src/model/derive'
import { applyOps, type Op } from '../../src/model/ops'
import type { Item, Model, Opening, Stair } from '../../src/model/types'
import { twoRooms, wall } from '../model/fixtures'

// Synthetic rooms. twoRooms() is a 20'-0" by 8'-4" box split down the middle; with 6" outside walls
// and a 4" middle wall the left room's faces are x 3 to 118 and y 3 to 97 (inches, y down the sheet).
const P = { src: 'user' as const }
const L2 = { id: 'L2', name: 'Level 2', elev: 120, ceiling: 108, floorThickness: 12, sheetIds: [], prov: { ceiling: P, floorThickness: P } }

function house(left = 'Bath', right = 'Office', more: (m: Model) => void = () => {}): Model {
  const m = twoRooms()
  more(m)
  const d = deriveRooms(m)
  d.rooms.find((r) => r.name === 'Den')!.name = left
  d.rooms.find((r) => r.name === 'Office')!.name = right
  return d
}
const item = (id: string, kind: Item['kind'], x: number, y: number, w: number, d: number, extra: Partial<Item> = {}): Item => ({ id, level: 'L1', kind, label: '', x, y, rot: 0, w, d, h: 36, prov: P, ...extra })
const opening = (id: string, wallId: string, at: number, w: number, extra: Partial<Opening> = {}): Opening => ({
  id,
  wall: wallId,
  kind: 'window',
  at,
  w,
  h: 80,
  sill: 36,
  style: 'double_hung',
  prov: { at: P, w: P, h: P, sill: P },
  ...extra,
})
const of = (m: Model, rule: string) => runChecks(m).filter((i) => i.rule === rule)
const fixIt = (m: Model, i: Issue) => applyOps(m, i.fix as Op[], { author: 'user' }).model

describe('checker', () => {
  it('finds nothing wrong in a plain two-room plan', () => {
    expect(runChecks(house())).toEqual([])
  })

  describe('bathrooms', () => {
    it('flags a toilet 12" from a wall as blocking, and clears it when the toilet is moved', () => {
      const m = house()
      m.items.push(item('t', 'toilet', 15, 17, 20, 28)) // centerline 12" from the left wall face
      const [i] = of(m, 'toilet-side')
      expect(i).toMatchObject({ severity: 'blocks', where: { level: 'L1', ids: ['t'] } })
      expect(i.message).toMatch(/1'-0"/)
      expect(i.message).toMatch(/code needs 1'-3"/)
      expect(i.where.room).toBe(m.rooms.find((r) => r.name === 'Bath')!.id)
      // The Fix button slides it to 18" (NKBA), which clears the issue entirely.
      expect(i.fixLabel).toBe('Slide it 6"')
      expect(of(fixIt(m, i), 'toilet-side')).toEqual([])
      // Moved by hand to 15": code is met, NKBA's 18" is not.
      const at15 = applyOps(m, [{ op: 'move', id: 't', dx: 3 }], { author: 'user' }).model
      expect(of(at15, 'toilet-side').map((x) => x.severity)).toEqual(['fix'])
      const at18 = applyOps(m, [{ op: 'move', id: 't', dx: 6 }], { author: 'user' }).model
      expect(of(at18, 'toilet-side')).toEqual([])
    })

    it('flags the clear space in front of a toilet', () => {
      const m = house()
      m.items.push(item('t', 'toilet', 60, 17, 20, 28), item('c', 'tall_cabinet', 60, 63, 30, 24, { h: 84 })) // 20" in front
      expect(of(m, 'toilet-front').map((x) => x.severity)).toEqual(['blocks'])
      m.items[1].y = 70 // 27"
      expect(of(m, 'toilet-front').map((x) => x.severity)).toEqual(['fix'])
      m.items[1].y = 80 // 37"
      expect(of(m, 'toilet-front')).toEqual([])
    })

    it('checks shower size and the space in front of it', () => {
      const m = house()
      m.items.push(item('s', 'shower', 3 + 15, 3 + 14, 30, 28))
      expect(of(m, 'shower-size')[0]).toMatchObject({ severity: 'blocks' })
      Object.assign(m.items[0], { w: 34, d: 34, x: 20, y: 20 })
      expect(of(m, 'shower-size')[0]).toMatchObject({ severity: 'fix' })
      Object.assign(m.items[0], { w: 36, d: 36, x: 21, y: 21 })
      expect(of(m, 'shower-size')).toEqual([])
      m.items.push(item('c', 'tall_cabinet', 21, 39 + 20 + 12, 30, 24, { h: 84 }))
      expect(of(m, 'shower-front').map((x) => x.severity)).toEqual(['blocks'])
      m.items[1].y = 39 + 26 + 12
      expect(of(m, 'shower-front').map((x) => x.severity)).toEqual(['fix'])
    })

    it('checks the open side of a tub', () => {
      const m = house()
      m.items.push(item('tub', 'tub', 33, 18, 60, 30), item('c', 'tall_cabinet', 33, 33 + 18 + 12, 30, 24, { h: 84 }))
      expect(of(m, 'tub-front').map((x) => x.severity)).toEqual(['blocks'])
      m.items.pop()
      expect(of(m, 'tub-front')).toEqual([])
    })

    it('checks the space in front of a vanity and its width per sink; a sink set into the vanity is not checked twice', () => {
      const m = house()
      m.items.push(item('v', 'vanity', 60, 13.5, 36, 21), item('sk', 'sink', 60, 13.5, 20, 16), item('c', 'tall_cabinet', 60, 24 + 18 + 12, 30, 24, { h: 84 }))
      expect(of(m, 'lavatory-front').map((x) => x.where.ids)).toEqual([['v']])
      m.items.pop()
      expect(of(m, 'lavatory-front')).toEqual([])
      Object.assign(m.items[0], { w: 48, props: { sinks: 2 } })
      expect(of(m, 'lavatory-width')[0]).toMatchObject({ severity: 'note' })
      expect(of(m, 'lavatory-width')[0].message).toMatch(/2'-0" per sink/)
    })
  })

  describe('fixtures in each other\'s way', () => {
    it('flags a counter run moved into a tall cabinet, but not a sink set into its counter', () => {
      const m = house('Kitchen')
      m.items.push(item('run', 'base_cabinet', 50, 15, 60, 24), item('oven', 'oven_tower', 85, 15, 30, 26, { h: 84 }), item('sk', 'sink', 35, 15, 30, 20))
      const [i] = of(m, 'items-overlap')
      expect(i).toMatchObject({ severity: 'fix', where: { ids: ['run', 'oven'] } })
      expect(i.message).toBe('The base cabinet runs into the oven tower.')
      expect(of(m, 'items-overlap')).toHaveLength(1)
      m.items[1].x = 100
      expect(of(m, 'items-overlap')).toEqual([])
      m.items.push(item('rg', 'range', 65, 16, 30, 26)) // set into the run, standing 2" proud as installed
      expect(of(m, 'items-overlap')).toEqual([])
    })
  })

  describe('kitchens', () => {
    it('measures the aisle between counters and the island', () => {
      const m = house('Kitchen')
      m.items.push(item('base', 'base_cabinet', 40, 15, 60, 24), item('isl', 'island', 60, 75, 72, 36))
      const aisles = of(m, 'kitchen-aisle')
      expect(aisles).toHaveLength(1) // counter to island and island to counter are one issue
      expect(aisles[0]).toMatchObject({ severity: 'fix', where: { ids: ['base', 'isl'] } })
      expect(aisles[0].message).toMatch(/^2'-6" between/)
      Object.assign(m.items[1], { y: 83, d: 24 }) // 3'-8"
      expect(of(m, 'kitchen-aisle')).toEqual([])
    })

    it('wants standing room beside the dishwasher', () => {
      const m = house('Kitchen')
      m.items.push(item('dw', 'dishwasher', 15, 15, 24, 24), item('isl', 'island', 55, 39, 36, 30))
      expect(of(m, 'dishwasher-standing')).toHaveLength(1)
      m.items.pop()
      expect(of(m, 'dishwasher-standing')).toEqual([])
    })

    it('keeps the range out from under a window', () => {
      const m = house('Kitchen')
      m.openings.push(opening('w1', 'top', 60, 36, { style: 'casement', sill: 42 }))
      m.items.push(item('r', 'range', 60, 16, 30, 26))
      expect(of(m, 'range-window')[0]).toMatchObject({ severity: 'fix', where: { ids: ['r', 'w1'] } })
      m.items[0].x = 100
      expect(of(m, 'range-window')).toEqual([])
    })

    it('sees the refrigerator door hit the island', () => {
      const m = house('Kitchen')
      m.items.push(item('f', 'fridge', 21, 18, 36, 30, { h: 70 }), item('isl', 'island', 50, 68, 60, 36))
      expect(of(m, 'fridge-door')[0]).toMatchObject({ severity: 'fix', where: { ids: ['f', 'isl'] } })
      m.items[1].x = 90
      expect(of(m, 'fridge-door')).toEqual([])
    })

    it('notes the vent an island sink needs, and does not measure an aisle from the sink inside the island', () => {
      const m = house('Kitchen')
      m.items.push(item('isl', 'island', 60, 50, 72, 36), item('sk', 'sink', 60, 50, 30, 20, { rot: 180 }))
      expect(of(m, 'island-sink')[0]).toMatchObject({ severity: 'note', where: { ids: ['sk', 'isl'] } })
      expect(of(m, 'kitchen-aisle')).toEqual([])
    })
  })

  describe('doors and halls', () => {
    it('holds the way out to 2\'-8" clear, with a one-step fix', () => {
      const m = house('Den')
      m.openings.push(opening('e1', 'left', 50, 30, { kind: 'door', style: 'swing', h: 80, sill: undefined, swing: { hinge: 'a', side: 'right' } }))
      const [i] = of(m, 'egress-door')
      expect(i).toMatchObject({ severity: 'blocks', where: { ids: ['e1'] } })
      expect(of(fixIt(m, i), 'egress-door')).toEqual([])
    })

    it('flags a narrow door into a room you live in, but not into a closet, and suggests 2\'-8" only where you are remodeling', () => {
      const m = house('Den')
      m.openings[0].w = 24
      expect(of(m, 'door-width')[0]).toMatchObject({ severity: 'fix' })
      expect(of(m, 'door-width')[0].message).toMatch(/^The door to the Office is 2'-0" clear/)
      const closet = house('Den', 'Closet')
      closet.openings[0].w = 24
      expect(of(closet, 'door-width')).toEqual([])
      const remodel = house('Den')
      expect(of(remodel, 'door-width')).toEqual([]) // a 2'-6" door is fine as built
      remodel.project.remodelRooms = [remodel.rooms.find((r) => r.name === 'Office')!.id]
      expect(of(remodel, 'door-width')[0]).toMatchObject({ severity: 'note' })
    })

    it('finds two doors that swing into each other and offers a flip that clears it', () => {
      const m = house('Den')
      m.openings[0].at = 20
      m.openings.push(opening('d2', 'top', 140, 30, { kind: 'door', style: 'swing', sill: undefined, swing: { hinge: 'a', side: 'right' } }))
      const [i] = of(m, 'door-clash')
      expect(i).toMatchObject({ severity: 'fix', where: { ids: ['d1', 'd2'] }, fixLabel: 'Swing it into the other room' })
      expect(of(fixIt(m, i), 'door-clash')).toEqual([])
    })

    it('finds a door swinging into a fixture or over a stair', () => {
      const m = house('Den')
      m.items.push(item('c', 'tall_cabinet', 140, 50, 24, 24, { h: 84 }))
      const [i] = of(m, 'door-hits')
      expect(i.where.ids).toEqual(['d1', 'c'])
      expect(of(fixIt(m, i), 'door-hits')).toEqual([])

      const s = house('Den', 'Office', (x) => x.levels.push(L2))
      s.stairs = [{ id: 's1', level: 'L1', toLevel: 'L2', polygon: [[125, 40], [165, 40], [165, 95], [125, 95]], up: [0, -1], prov: P }]
      expect(of(s, 'door-stair')[0]).toMatchObject({ severity: 'fix', where: { ids: ['d1', 's1'] } })
    })

    it('holds halls to 3\'-0"', () => {
      const m = deriveRooms(twoRooms())
      const narrow = twoRooms()
      narrow.walls.push(wall('h', [40, 0], [40, 100], 4))
      const d = deriveRooms(narrow)
      roomOf(d, 'L1', [20, 50])!.name = 'Hall'
      expect(of(d, 'hall-width')[0]).toMatchObject({ severity: 'blocks' })
      expect(of(d, 'hall-width')[0].message).toMatch(/2'-11"/)
      expect(of(m, 'hall-width')).toEqual([])
    })
  })

  describe('egress, stairs and glass', () => {
    it('needs a bedroom window big enough to climb out of, or an outside door', () => {
      const none = house('Bedroom 2')
      expect(of(none, 'bedroom-egress')[0]).toMatchObject({ severity: 'blocks' })
      expect(of(none, 'bedroom-egress')[0].message).toMatch(/plan shows no window/)

      const casement = house('Bedroom 2')
      casement.openings.push(opening('w1', 'left', 50, 36, { style: 'casement', sill: 24 }))
      expect(of(casement, 'bedroom-egress')).toEqual([])

      const hung = house('Bedroom 2')
      hung.openings.push(opening('w1', 'left', 50, 36)) // 3'-0" by 3'-8" of glass opens about 20" high
      expect(windowClear(hung.openings[1]).h).toBeCloseTo(20.5)
      expect(of(hung, 'bedroom-egress')[0]).toMatchObject({ severity: 'blocks', where: { ids: [hung.rooms.find((r) => r.name === 'Bedroom 2')!.id, 'w1'] } })

      const guessed = house('Bedroom 2')
      guessed.openings.push(opening('w1', 'left', 50, 36, { prov: { at: P, w: P, h: { src: 'default' }, sill: { src: 'default' } } }))
      expect(of(guessed, 'bedroom-egress')[0]).toMatchObject({ severity: 'fix' })
      expect(of(guessed, 'bedroom-egress')[0].message).toMatch(/assumed, so measure them first/)

      const door = house('Bedroom 2')
      door.openings.push(opening('e1', 'left', 50, 36, { kind: 'door', style: 'swing', swing: { hinge: 'a', side: 'right' } }))
      expect(of(door, 'bedroom-egress')).toEqual([])
    })

    it('checks stair width, steps, headroom and landings', () => {
      const m = house('Den', 'Office', (x) => x.levels.push(L2))
      const st: Stair = { id: 's1', level: 'L1', toLevel: 'L2', polygon: [[150, 20], [180, 20], [180, 90], [150, 90]], up: [0, -1], prov: P }
      m.stairs = [st]
      const rules = runChecks(m).filter((i) => i.where.ids.includes('s1')).map((i) => i.rule)
      expect(rules).toEqual(expect.arrayContaining(['stair-width', 'stair-tread', 'stair-landing']))
      expect(of(m, 'stair-landing')[0].message).toMatch(/at the bottom/)
      st.risers = 14
      expect(of(m, 'stair-riser')[0].message).toMatch(/8 5\/8"/)
      m.levels[0].ceiling = 78
      expect(of(m, 'stair-headroom')).toHaveLength(1)

      // A stair that meets code: 3'-4" wide, 16 risers of 7 1/2", 15 treads of 10 2/3", open at both ends.
      const open = house('Den', 'Office', (x) => x.levels.push(L2))
      open.walls = []
      open.stairs = [{ id: 's2', level: 'L1', toLevel: 'L2', polygon: [[300, 0], [340, 0], [340, 160], [300, 160]], up: [0, -1], risers: 16, prov: P }]
      expect(runChecks(open).filter((i) => i.rule.startsWith('stair'))).toEqual([])
    })

    it('flags glass that has to be tempered, and a window in a shower', () => {
      const tub = house()
      tub.items.push(item('tub', 'tub', 33, 18, 60, 30))
      tub.openings.push(opening('w1', 'left', 60, 30, { sill: 20, h: 70 }))
      expect(of(tub, 'tempered-glass')[0]).toMatchObject({ severity: 'note', where: { ids: ['w1', 'tub'] } })

      const byDoor = house('Den')
      byDoor.openings.push(opening('w1', 'top', 60, 30, { sill: 30 }), opening('e2', 'top', 90, 30, { kind: 'door', style: 'swing', swing: { hinge: 'a', side: 'right' } }))
      expect(of(byDoor, 'tempered-glass')[0].where.ids).toEqual(['w1', 'e2'])

      const shower = house()
      shower.items.push(item('s', 'shower', 21, 21, 36, 36))
      shower.openings.push(opening('w1', 'left', 79, 24, { sill: 48 }))
      expect(of(shower, 'shower-window')[0].where.ids).toEqual(['w1', 's'])
    })
  })

  describe('plumbing and structure', () => {
    it('notes a toilet moved more than 2\'-0" or onto another wall', () => {
      const asBuilt = house()
      asBuilt.items.push(item('t', 'toilet', 25, 17, 20, 28))
      const far = applyOps(asBuilt, [{ op: 'move', id: 't', dx: 30 }], { author: 'user' }).model
      expect(runChecks(far, { asBuilt }).filter((i) => i.rule === 'toilet-drain')[0].message).toMatch(/moved 2'-6"/)
      const turned = applyOps(asBuilt, [{ op: 'move', id: 't', x: 17, y: 30, rot: 90 }], { author: 'user' }).model
      expect(runChecks(turned, { asBuilt }).filter((i) => i.rule === 'toilet-drain')[0].message).toMatch(/another wall/)
      expect(runChecks(asBuilt, { asBuilt }).filter((i) => i.rule === 'toilet-drain')).toEqual([])
    })

    it('carries every engineer caution as a note that cannot be dismissed, in plain words', () => {
      const m = applyOps(house('Den'), [{ op: 'move', id: 'mid', dx: 10 }], { author: 'user' }).model
      const [i] = of(m, 'structure')
      expect(i).toMatchObject({ severity: 'note', locked: true })
      expect(i.message).toMatch(/^Engineer to confirm: a wall of the (Den|Office) may carry load and was moved 10"\.$/)
    })
  })

  it('runs fast enough to check every version', () => {
    const m = house('Kitchen')
    for (let i = 0; i < 40; i++) m.items.push(item(`b${i}`, 'base_cabinet', 10 + (i % 8) * 12, 15 + Math.floor(i / 8) * 15, 12, 12))
    const t = performance.now()
    for (let k = 0; k < 10; k++) runChecks(m)
    expect((performance.now() - t) / 10).toBeLessThan(50)
  })
})
