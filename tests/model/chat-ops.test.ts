import { describe, expect, it } from 'vitest'
import { runChecks } from '../../src/analysis/checks'
import { deriveRooms } from '../../src/model/derive'
import { polygonBounds, wallLength } from '../../src/model/geom'
import { type Op, applyOps } from '../../src/model/ops'
import { OP_TABLE, checkShape, opsPromptText } from '../../src/model/table'
import type { Item, Model } from '../../src/model/types'
import { twoRooms, wall } from './fixtures'

// Den: faces x 3..118, y 3..97 (115 by 94). Office: x 122..237. Door d1 in the middle wall at y 35..65.
const P = { src: 'user' as const }
const base = (): Model => deriveRooms(twoRooms())
const run = (m: Model, ...ops: Op[]) => applyOps(m, ops, { author: 'ai', versionLabel: 'v2 test' })
const size = (m: Model, name: string) => {
  const b = polygonBounds(m.rooms.find((r) => r.name === name)!.polygon)
  return { x: Math.round((b.x1 - b.x0) * 100) / 100, y: Math.round((b.y1 - b.y0) * 100) / 100 }
}
const item = (m: Model, id: string) => m.items.find((i) => i.id === id)!
const add = (m: Model, it: Partial<Item> & { id: string; kind: Item['kind'] }) => run(m, { op: 'add_item', x: 0, y: 0, ...it }).model
/** A box room with 6" outside walls and the given clear size, door on the left wall. */
function box(name: string, w: number, d: number): Model {
  const m = twoRooms()
  const W = w + 6
  const D = d + 6
  m.walls = [
    wall('top', [0, 0], [W, 0], 6, { exterior: true, bearing: 'yes' }),
    wall('right', [W, 0], [W, D], 6, { exterior: true, bearing: 'yes' }),
    wall('bottom', [W, D], [0, D], 6, { exterior: true, bearing: 'yes' }),
    wall('left', [0, D], [0, 0], 6, { exterior: true, bearing: 'yes' }),
  ]
  m.openings = [{ id: 'd1', wall: 'left', kind: 'door', at: D - 24, w: 32, h: 80, style: 'swing', swing: { hinge: 'a', side: 'right' }, prov: { at: P, w: P, h: P } }]
  m.rooms = [{ id: 'r1', level: 'L1', name, polygon: [], labelAt: [W / 2, D / 2], flags: [], prov: { src: 'derived' } }]
  return deriveRooms(m)
}

describe('the ops table', () => {
  it('rejects an op of the wrong shape with a plain reason, before it touches the model', () => {
    expect(checkShape({ op: 'fly' })).toBe('unknown operation "fly"')
    expect(checkShape({ op: 'move_wall', by: 12 })).toBe('needs id')
    expect(checkShape({ op: 'move_wall', id: 'mid' })).toBe('needs one of by, to, so_that')
    expect(checkShape({ op: 'set_dimension', room: 'Den', axis: 'z', value: 120 })).toBe('axis should be one of x, y')
    expect(checkShape({ op: 'add_wall', a: [0, 0], b: 'here' })).toBe('b should be a point [x, y]')
    expect(checkShape({ op: 'move', id: 'i1', dx: '12' })).toBeNull() // numbers as text are fine, as before
    const r = run(base(), { op: 'move_wall', id: 'mid' })
    expect(r.applied).toBe(0)
    expect(r.skipped).toEqual(['move_wall mid: needs one of by, to, so_that'])
  })

  it('writes every op Velda may use into the prompt, and none of the hand-edit ones', () => {
    const text = opsPromptText()
    for (const d of OP_TABLE) expect(text.includes(`"op":"${d.op}"`)).toBe(!d.hidden)
    expect(text).toContain('"so_that"?:{"room":ROOM,"clear":IN}')
    expect(text).toContain('"axis":"x"|"y"')
    expect(text).not.toContain('"anchor"?:{...}')
  })
})

describe('walls by intent', () => {
  it('moves a wall toward a room by a distance, to a coordinate, or so a room comes out a given size', () => {
    const by = run(base(), { op: 'move_wall', id: 'mid', by: 12, toward: 'Office' }).model
    expect(size(by, 'Den').x).toBe(127)
    expect(size(by, 'Office').x).toBe(103)
    const to = run(base(), { op: 'move_wall', id: 'mid', to: 132 }).model
    expect(size(to, 'Den').x).toBe(127)
    const so = run(base(), { op: 'move_wall', id: 'mid', so_that: { room: 'Office', clear: 120 } }).model
    expect(size(so, 'Office').x).toBe(120)
    expect(size(so, 'Den').x).toBe(110)
    expect(run(base(), { op: 'move_wall', id: 'mid', by: 3, toward: 'Nowhere' }).skipped[0]).toMatch(/no room Nowhere/)
  })

  it('sets a room size by moving the far wall, the near wall, or both', () => {
    const min = run(base(), { op: 'set_dimension', room: 'Den', axis: 'x', value: 120 }).model
    expect(size(min, 'Den').x).toBe(120)
    expect(min.walls.find((w) => w.id === 'left')!.a[0]).toBe(0) // the left side stayed
    const center = run(base(), { op: 'set_dimension', room: 'Den', axis: 'y', value: 100, anchor: 'center' }).model
    expect(size(center, 'Den').y).toBe(100)
    expect(center.walls.find((w) => w.id === 'top')!.a[1]).toBe(-3)
    // Moving the outside wall keeps the engineer note.
    const max = run(base(), { op: 'set_dimension', room: 'Den', axis: 'x', value: 125, anchor: 'max' }).model
    expect(size(max, 'Den').x).toBe(125)
    expect(max.notes.some((n) => n.locked && /may carry load/.test(n.text))).toBe(true)
  })

  it('opens a wall between two rooms as a cased opening with a header, and refuses an outside wall', () => {
    const r = run(base(), { op: 'open_wall', id: 'mid', full: true })
    const o = r.model.openings.find((x) => x.wall === 'mid')!
    expect(o).toMatchObject({ kind: 'opening', style: 'cased', w: 94, h: 96 })
    expect(r.model.openings.some((x) => x.id === 'd1')).toBe(false)
    expect(r.model.notes.some((n) => n.locked && /opened 7'-10" wide/.test(n.text))).toBe(true)
    expect(run(base(), { op: 'open_wall', id: 'top', from: 20, to: 60 }).skipped[0]).toMatch(/exterior; use a window or door/)
    const part = run(base(), { op: 'open_wall', id: 'mid', from: 70, to: 94, header: false }).model.openings.find((x) => x.kind === 'opening')!
    expect(part).toMatchObject({ at: 82, w: 24, h: 108 })
  })

  it('joins two walls in a line back into one, keeping the door where it was', () => {
    const split = run(base(), { op: 'split_wall', id: 'mid', at: 20, newId: 'mid2' }).model
    expect(split.walls.find((w) => w.id === 'mid2')).toBeTruthy()
    const joined = run(split, { op: 'join_walls', a: 'mid', b: 'mid2' }).model
    expect(joined.walls.find((w) => w.id === 'mid2')).toBeUndefined()
    expect(wallLength(joined.walls.find((w) => w.id === 'mid')!)).toBe(100)
    expect(joined.openings.find((o) => o.id === 'd1')).toMatchObject({ wall: 'mid', at: 50 })
    expect(run(base(), { op: 'join_walls', a: 'top', b: 'right' }).skipped[0]).toMatch(/straight line/)
  })
})

describe('openings by intent', () => {
  it('turns a window into patio doors in the same place, with the header note on an outside wall', () => {
    let m = base()
    m.openings.push({ id: 'w1', wall: 'top', kind: 'window', at: 60, w: 36, h: 84, sill: 36, style: 'double_hung', prov: { at: P, w: P, h: P, sill: P } })
    m = run(m, { op: 'replace_opening', id: 'w1', kind: 'door', style: 'sliding', w: 72 }).model
    const o = m.openings.find((x) => x.id === 'w1')!
    expect(o).toMatchObject({ kind: 'door', style: 'sliding', at: 60, w: 72, h: 80 })
    expect(o.sill).toBeUndefined()
    expect(o.swing).toBeUndefined()
    expect(m.notes.some((n) => n.locked && /widened to 6'-0"/.test(n.text))).toBe(true)
    const swing = run(m, { op: 'replace_opening', id: 'w1', kind: 'door', style: 'swing' }).model.openings.find((x) => x.id === 'w1')!
    expect(swing.swing?.side).toBe('right') // into the house, not out of it
  })

  it('swings a door into the room named', () => {
    const den = run(base(), { op: 'set_swing', id: 'd1', into: 'Den' }).model
    expect(den.openings[0].swing).toEqual({ hinge: 'a', side: 'right' })
    const office = run(den, { op: 'set_swing', id: 'd1', into: 'Office', hinge: 'b' }).model
    expect(office.openings[0].swing).toEqual({ hinge: 'b', side: 'left' })
  })
})

describe('placing things', () => {
  it('puts a fixture with its back on a wall face, facing in, and it stays there when the wall moves', () => {
    let m = run(base(), { op: 'place', item: { id: 'v', kind: 'vanity', w: 36, d: 21 }, room: 'Den', against: 'top' }).model
    expect(item(m, 'v')).toMatchObject({ x: 60.5, y: 13.5, rot: 0, anchor: { wall: 'top', side: 'right' } })
    m = run(m, { op: 'move_wall', id: 'top', by: -12, toward: 'Den' }).model
    expect(item(m, 'v').y).toBe(1.5)
  })

  it('keeps clear of doors, sits under a window when asked, and says when nothing fits', () => {
    const m = base()
    m.openings.push({ id: 'w1', wall: 'top', kind: 'window', at: 40, w: 30, h: 84, sill: 42, style: 'double_hung', prov: { at: P, w: P, h: P, sill: P } })
    expect(item(run(m, { op: 'place', item: { id: 's', kind: 'sink' }, room: 'Den', against: 'window' }).model, 's').x).toBe(40)
    const r = run(m, { op: 'place', item: { id: 'c', kind: 'base_cabinet', w: 60 }, room: 'Office', against: 'mid' })
    expect(r.skipped[0]).toMatch(/no 60 in clear stretch/)
    const small = item(run(m, { op: 'place', item: { id: 'c', kind: 'base_cabinet', w: 24 }, room: 'Office', against: 'mid' }).model, 'c')
    expect(small.y - 12 >= 65 + 3 || small.y + 12 <= 35 - 3).toBe(true) // not across the door
  })

  it('sets a sink into an island, and re-places an existing item in another room', () => {
    let m = add(base(), { id: 'isl', kind: 'island', x: 180, y: 50, w: 72, d: 36, rot: 0 })
    m = add(m, { id: 'sk', kind: 'sink', x: 60, y: 14, w: 33, d: 22, rot: 0 })
    m = run(m, { op: 'place', id: 'sk', on: 'isl' }).model
    expect(item(m, 'sk')).toMatchObject({ x: 180, y: 57, rot: 0 })
    expect(item(m, 'sk').anchor).toBeUndefined()
    m = run(m, { op: 'place', id: 'sk', room: 'Den', against: 'left' }).model
    expect(item(m, 'sk')).toMatchObject({ x: 14, rot: 90 })
  })

  it('swaps two items, each back against the wall the other had', () => {
    let m = add(base(), { id: 'range', kind: 'range', x: 16, y: 50, w: 30, d: 26, rot: 90 }) // against the left wall
    m = add(m, { id: 'fridge', kind: 'fridge', x: 60, y: 82, w: 36, d: 30, rot: 180 }) // against the bottom wall
    m = run(m, { op: 'swap', a: 'range', b: 'fridge' }).model
    expect(item(m, 'range')).toMatchObject({ x: 60, y: 84, rot: 180 }) // back on y 97
    expect(item(m, 'fridge')).toMatchObject({ x: 18, y: 50, rot: 90 }) // back on x 3
  })
})

describe('layouts', () => {
  const noBlocks = (m: Model) => runChecks(m).filter((i) => i.severity === 'blocks')

  it('lays out a galley kitchen with a working aisle, sink and dishwasher together, range across', () => {
    const m = base()
    m.rooms.find((r) => r.name === 'Den')!.name = 'Kitchen'
    const r = run(m, { op: 'arrange', room: 'Kitchen', layout: 'galley' })
    const kinds = r.model.items.map((i) => i.kind).sort()
    expect(kinds).toEqual(expect.arrayContaining(['base_cabinet', 'dishwasher', 'fridge', 'range', 'sink']))
    expect(noBlocks(r.model)).toEqual([])
    expect(runChecks(r.model).filter((i) => i.rule === 'kitchen-aisle')).toEqual([])
    const sink = r.model.items.find((i) => i.kind === 'sink')!
    const range = r.model.items.find((i) => i.kind === 'range')!
    expect(Math.abs(sink.y - range.y)).toBeGreaterThan(40) // facing runs
  })

  it('says when a kitchen island will not fit with its aisles', () => {
    const m = base()
    m.rooms.find((r) => r.name === 'Den')!.name = 'Kitchen'
    const r = run(m, { op: 'arrange', room: 'Kitchen', layout: 'island' })
    expect(r.notes.join(' ')).toMatch(/Could not meet: .*Island: the room is 7'-10" deep/)
    expect(r.model.items.some((i) => i.kind === 'island')).toBe(false)
  })

  it('lays out a 5 by 8 hall bath with no code problems', () => {
    const r = run(box('Bath', 60, 96), { op: 'arrange', room: 'Bath', layout: 'vanity_toilet_shower' })
    expect(r.model.items.map((i) => i.kind).sort()).toEqual(['toilet', 'tub', 'vanity'])
    expect(noBlocks(r.model)).toEqual([])
  })

  it('puts a bed on a wall with nightstands and walkways, and a washer and dryer side by side', () => {
    const bed = run(box('Bedroom', 168, 144), { op: 'arrange', room: 'Bedroom', layout: 'bed_wall' })
    expect(bed.model.items.map((i) => i.kind).sort()).toEqual(['bed', 'table', 'table'])
    expect(bed.notes).toEqual([])
    const laundry = run(box('Laundry', 72, 72), { op: 'arrange', room: 'Laundry', layout: 'side_by_side' })
    expect(laundry.model.items.map((i) => i.kind).sort()).toEqual(['dryer', 'washer'])
  })

  it('replaces the fixtures already in the room rather than piling on', () => {
    let m = base()
    m.rooms.find((r) => r.name === 'Den')!.name = 'Laundry'
    m = add(m, { id: 'old', kind: 'washer', x: 60, y: 20, w: 27, d: 30 })
    const r = run(m, { op: 'arrange', room: 'Laundry', layout: 'side_by_side' })
    expect(r.model.items.some((i) => i.id === 'old')).toBe(false)
    expect(r.model.items.filter((i) => i.kind === 'washer')).toHaveLength(1)
  })
})

describe('field measurements', () => {
  it('moves the model to match a tape measurement between two wall faces', () => {
    const r = run(base(), { op: 'field_dimension', a: [3, 50], b: [118, 50], value: 116, text: '9\'-8"' })
    expect(size(r.model, 'Den').x).toBe(116)
    expect(r.model.walls.find((w) => w.id === 'mid')!.prov.a.src).toBe('field')
    expect(r.model.dimensions.at(-1)).toMatchObject({ source: 'field', status: 'ok', value: 116 })
    expect(r.model.notes.some((n) => n.locked)).toBe(false) // recording reality is not a design change
    const loose = run(base(), { op: 'field_dimension', a: [30, 50], b: [80, 50], value: 49 })
    expect(loose.notes[0]).toMatch(/does not line up with two wall faces/)
    expect(size(loose.model, 'Den').x).toBe(115)
  })
})
