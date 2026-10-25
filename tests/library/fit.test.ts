import { describe, expect, it } from 'vitest'
import { fitsForPrompt, showerFits } from '../../src/library/fit'
import { deriveRooms } from '../../src/model/derive'
import { wallLength } from '../../src/model/geom'
import type { Model } from '../../src/model/types'
import { a2 } from '../import/a2-fixture'
import { twoRooms, wall } from '../model/fixtures'

const P = { src: 'user' as const }
/** A bath with 6" outside walls, the given clear size, and a 2'-8" door in its bottom wall near the right corner. */
function bath(w: number, d: number, ceiling = 108): Model {
  const m = twoRooms()
  const W = w + 6
  const D = d + 6
  m.levels[0].ceiling = ceiling
  m.walls = [wall('top', [0, 0], [W, 0], 6), wall('right', [W, 0], [W, D], 6), wall('bottom', [W, D], [0, D], 6), wall('left', [0, D], [0, 0], 6)]
  m.openings = [{ id: 'd1', wall: 'bottom', kind: 'door', at: 24, w: 32, h: 80, style: 'swing', swing: { hinge: 'a', side: 'right' }, prov: { at: P, w: P, h: P } }]
  m.rooms = [{ id: 'r1', level: 'L1', name: 'Bath', polygon: [], labelAt: [W / 2, D / 2], flags: [], prov: { src: 'derived' } }]
  return deriveRooms(m)
}
const ids = (m: Model) => showerFits(m, m.rooms[0]).fits.map((f) => f.id)

describe('which showers fit', () => {
  it('in the A2 primary bath (as-built walls): every type but steam, which needs a lower ceiling', () => {
    const m = a2().result.model
    const room = m.rooms.find((r) => r.name === 'Primary Bathroom')!
    const { fits, misses } = showerFits(m, room)
    expect(fits.map((f) => f.id).sort()).toEqual(['alcove', 'curbless', 'double', 'neo_angle', 'tub_shower', 'walk_in', 'wet_room'])
    expect(misses.map((x) => x.id)).toEqual(['steam'])
    expect(misses[0].why).toMatch(/ceiling is 9'-0"/)
    for (const f of fits.filter((x) => x.wall)) {
      const w = m.walls.find((x) => x.id === f.wall)!
      expect(wallLength(w)).toBeGreaterThanOrEqual(f.size[0])
      expect(f.front).toBeGreaterThanOrEqual(24)
    }
  }, 60_000)

  it('in a 5 by 8 hall bath: alcove, tub and walk-in at their least, no double and no wet room', () => {
    const m = bath(60, 96)
    const { fits, misses } = showerFits(m, m.rooms[0])
    expect(ids(m)).toEqual(expect.arrayContaining(['alcove', 'tub_shower', 'walk_in', 'neo_angle']))
    expect(misses.map((x) => x.id)).toEqual(expect.arrayContaining(['double', 'wet_room', 'steam']))
    const walk = fits.find((f) => f.id === 'walk_in')!
    expect(walk.size).toEqual([60, 36]) // 60 long, leaving exactly 2'-0" to step out
    expect(walk.ideal).toBe(false)
  })

  it('keeps showers out of the door and its swing', () => {
    const m = bath(40, 40)
    // The door near the bottom right swings in over that corner: a shower goes in one of the others.
    const neo = showerFits(m, m.rooms[0]).fits.find((f) => f.id === 'neo_angle')
    expect(neo).toBeUndefined() // 36 + 24 does not fit across 40 in
    const big = bath(84, 84)
    const f = showerFits(big, big.rooms[0]).fits.find((x) => x.id === 'neo_angle')!
    expect(f.where).not.toMatch(/bottom right/)
  })

  it('offers steam when the ceiling is 8 ft', () => {
    expect(ids(bath(96, 96, 96))).toContain('steam')
  })

  it('writes the fits and the misses for Velda', () => {
    const m = bath(60, 96)
    const t = fitsForPrompt(m, m.rooms[0])
    expect(t).toMatch(/^SHOWER TYPES THAT FIT the Bath/)
    expect(t).toMatch(/- Walk-in with a fixed glass panel \(doorless\): up to 5'-0" x 3'-0" inside \(below its ideal size\)/)
    expect(t).toMatch(/DO NOT FIT:\n.*Double/)
  })
})
