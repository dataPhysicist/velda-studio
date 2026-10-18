import { describe, expect, it } from 'vitest'
import type { StudioModel } from '../../src/lib/model'
import { applyOps } from '../../src/lib/ops'

// A one-room level: a 10'-0" by 8'-0" box, door on the bottom wall.
function room(): StudioModel {
  return {
    v: 1,
    ceiling: 108,
    levels: [{ id: 'L1', name: 'Level 1', elev: 0, height: 108 }],
    walls: [
      { id: 'w1', level: 'L1', a: [0, 0], b: [120, 0], t: 4.5, openings: [] },
      { id: 'w2', level: 'L1', a: [120, 0], b: [120, 96], t: 4.5, openings: [] },
      { id: 'w3', level: 'L1', a: [120, 96], b: [0, 96], t: 4.5, openings: [{ id: 'd1', kind: 'door', at: 60, w: 30, h: 80, style: 'swing' }] },
      { id: 'w4', level: 'L1', a: [0, 96], b: [0, 0], t: 4.5, openings: [] },
    ],
    rooms: [{ id: 'r1', level: 'L1', name: 'Den', polygon: [[2.25, 2.25], [117.75, 2.25], [117.75, 93.75], [2.25, 93.75]] }],
    items: [],
    theme: null,
    themes: {},
  }
}

describe('model operations (v0.3 ops, kept in v2)', () => {
  it('keeps a new window inside its wall and replaces an opening it overlaps', () => {
    const { model, applied, skipped } = applyOps(room(), [
      { op: 'add_opening', wall: 'w1', kind: 'window', at: 5, w: 36 }, // asks to start off the end of the wall
      { op: 'add_opening', wall: 'w3', kind: 'door', at: 70, w: 32 }, // overlaps d1
    ])
    expect(skipped).toEqual([])
    expect(applied).toBe(2)
    const win = model.walls.find((w) => w.id === 'w1')!.openings[0]
    expect(win.at).toBe(18) // half its width from the wall's start
    expect(win.sill).toBe(36)
    const bottom = model.walls.find((w) => w.id === 'w3')!.openings
    expect(bottom.map((o) => o.id)).not.toContain('d1')
    expect(bottom).toHaveLength(1)
  })

  it('applies the good operations and reports the bad one instead of failing the whole change', () => {
    const before = room()
    const { model, applied, skipped } = applyOps(before, [
      { op: 'move', id: 'nothing-here', dx: 12 },
      { op: 'room', id: 'r1', rename: 'Study' },
    ])
    expect(applied).toBe(1)
    expect(skipped).toEqual(['move: nothing with id nothing-here'])
    expect(model.rooms[0].name).toBe('Study')
    expect(before.rooms[0].name).toBe('Den') // the input model is never changed in place
  })

  it('keeps doors where they were in the room when a wall start moves', () => {
    const { model } = applyOps(room(), [{ op: 'update_wall', id: 'w3', a: [132, 96] }])
    const w3 = model.walls.find((w) => w.id === 'w3')!
    const d1 = w3.openings[0]
    // the door center stays at x = 60 in plan, so its distance from the new start grows by 12
    expect(w3.a[0] - d1.at).toBe(60)
  })

  it('refuses a ceiling outside 7 ft to 20 ft', () => {
    expect(applyOps(room(), [{ op: 'ceiling', h: 60 }]).skipped).toEqual(['ceiling: ceiling must be 84 to 240 inches'])
    expect(applyOps(room(), [{ op: 'ceiling', h: 108 }]).model.ceiling).toBe(108)
  })
})
