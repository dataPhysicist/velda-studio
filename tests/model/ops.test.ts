import { describe, expect, it } from 'vitest'
import { applyOps } from '../../src/model/ops'
import { twoRooms } from './fixtures'

// The v0.3 operations, kept in v2 with the same behavior (now with provenance and rules).
describe('model operations kept from v0.3', () => {
  it('keeps a new window inside its wall and replaces an opening it overlaps', () => {
    const { model, applied, skipped } = applyOps(twoRooms(), [
      { op: 'add_opening', wall: 'top', kind: 'window', at: 5, w: 36 }, // asks to start off the end of the wall
      { op: 'add_opening', wall: 'mid', kind: 'door', at: 60, w: 32 }, // overlaps d1
    ])
    expect(skipped).toEqual([])
    expect(applied).toBe(2)
    const win = model.openings.find((o) => o.wall === 'top')!
    expect(win.at).toBe(18) // half its width from the wall's start
    expect(win.sill).toBe(36)
    const onMid = model.openings.filter((o) => o.wall === 'mid')
    expect(onMid.map((o) => o.id)).not.toContain('d1')
    expect(onMid).toHaveLength(1)
  })

  it('applies the good operations and reports the bad one instead of failing the whole change', () => {
    const before = twoRooms()
    const { model, applied, skipped } = applyOps(before, [
      { op: 'move', id: 'nothing-here', dx: 12 },
      { op: 'room', id: 'r1', rename: 'Study' },
    ])
    expect(applied).toBe(1)
    expect(skipped).toEqual(['move nothing-here: nothing with id nothing-here'])
    expect(model.rooms.find((r) => r.id === 'r1')!.name).toBe('Study')
    expect(before.rooms[0].name).toBe('Den') // the input model is never changed in place
  })

  it('keeps doors where they were in the room when a wall start moves', () => {
    const { model } = applyOps(twoRooms(), [{ op: 'update_wall', id: 'mid', a: [120, -12] }])
    const d1 = model.openings.find((o) => o.id === 'd1')!
    expect(d1.at).toBe(62) // the door center stays at y = 50 in plan
  })

  it('refuses a ceiling outside 7 ft to 20 ft', () => {
    expect(applyOps(twoRooms(), [{ op: 'ceiling', h: 60 }]).skipped).toEqual(['ceiling: ceiling must be 7 ft to 20 ft'])
    expect(applyOps(twoRooms(), [{ op: 'ceiling', h: 108 }]).model.levels[0].ceiling).toBe(108)
  })
})
