import { describe, expect, it } from 'vitest'
import { deriveRooms, findJoints, healWalls, moveWall, updateDimensionStatus } from '../../src/model/derive'
import { polygonBounds, wallLength } from '../../src/model/geom'
import { applyOps } from '../../src/model/ops'
import { badgeOf } from '../../src/model/types'
import { twoRooms, wall } from './fixtures'

const size = (m: ReturnType<typeof twoRooms>, name: string) => {
  const r = m.rooms.find((x) => x.name === name)!
  const b = polygonBounds(r.polygon)
  return { x: Math.round((b.x1 - b.x0) * 100) / 100, y: Math.round((b.y1 - b.y0) * 100) / 100 }
}

describe('joints', () => {
  it('finds the four corners of a box and the two tees of a wall dividing it', () => {
    const { corners, tees } = findJoints(twoRooms().walls)
    expect(corners).toHaveLength(4)
    expect(tees.map((t) => `${t.end.wall}.${t.end.end}->${t.host}`).sort()).toEqual(['mid.a->top', 'mid.b->bottom'])
  })

  it('closes a gap where a wall stops at the face of another', () => {
    const walls = [wall('host', [0, 0], [200, 0], 6), wall('stub', [100, 3], [100, 80], 4)] // stops at the host's face
    const { walls: healed, moved } = healWalls(walls)
    expect(moved).toEqual(['stub'])
    expect(healed.find((w) => w.id === 'stub')!.a).toEqual([100, 0])
  })
})

describe('rooms come from the walls', () => {
  it('derives the two rooms with clear sizes from the wall faces', () => {
    const m = deriveRooms(twoRooms())
    expect(m.rooms.map((r) => r.name).sort()).toEqual(['Den', 'Office'])
    // Den: from the left wall's inside face (3) to the middle wall's face (118); top 3 to bottom 97.
    expect(size(m, 'Den')).toEqual({ x: 115, y: 94 })
    expect(size(m, 'Office')).toEqual({ x: 115, y: 94 })
    expect(m.rooms.find((r) => r.name === 'Den')!.id).toBe('r1')
  })

  it('splits a face with two names between them and names a face with none', () => {
    const m0 = twoRooms()
    m0.walls = m0.walls.filter((w) => w.id !== 'mid')
    m0.openings = []
    const split = deriveRooms(m0)
    expect(split.rooms.map((r) => r.name).sort()).toEqual(['Den', 'Office'])
    expect(size(split, 'Den').x).toBeCloseTo(117, 1) // the bisector between the two labels at x = 120
    const m1 = twoRooms()
    m1.rooms = [m1.rooms[0]]
    const named = deriveRooms(m1)
    const other = named.rooms.find((r) => r.name !== 'Den')!
    expect(other.name).toBe('Room 1')
    expect(other.flags).toContain('needs_name')
  })

  it('treats an alcove behind a cased opening as part of the named room, but not one behind a door', () => {
    const m = twoRooms()
    m.rooms = [m.rooms[0]]
    m.openings[0] = { ...m.openings[0], kind: 'opening', style: 'cased', swing: undefined }
    const cased = deriveRooms(m)
    expect(cased.rooms).toHaveLength(1)
    expect(cased.rooms[0].name).toBe('Den')
  })
})

describe('moving walls keeps the plan connected', () => {
  it('moves the dividing wall 12 in: one room grows 12, the other shrinks 12, the door stays put', () => {
    const r = applyOps(deriveRooms(twoRooms()), [{ op: 'move', id: 'mid', dx: 12, dy: 0 }], { author: 'user' })
    expect(r.skipped).toEqual([])
    expect(size(r.model, 'Den').x).toBe(127)
    expect(size(r.model, 'Office').x).toBe(103)
    const mid = r.model.walls.find((w) => w.id === 'mid')!
    expect(mid.a).toEqual([132, 0])
    expect(mid.b).toEqual([132, 100])
    expect(r.model.rooms.find((x) => x.name === 'Den')!.id).toBe('r1') // same room, same id
    expect(badgeOf(mid.prov.a)).toBe('measured') // a person moved it
  })

  it('stretches the walls at both corners when an outside wall moves', () => {
    const r = moveWall(twoRooms(), 'right', 24, { src: 'user' }) // left of 'right' (a->b points down the sheet) is +x, outward
    expect(r.ok).toBe(true)
    const top = r.model.walls.find((w) => w.id === 'top')!
    const bottom = r.model.walls.find((w) => w.id === 'bottom')!
    expect(wallLength(top)).toBe(264)
    expect(wallLength(bottom)).toBe(264)
    expect(r.model.walls.find((w) => w.id === 'right')!.a).toEqual([264, 0])
  })

  it('drags the walls tee-d into a wall when it moves', () => {
    const r = moveWall(twoRooms(), 'top', 12, { src: 'user' }) // left of top (a->b points right) is up the sheet
    expect(r.ok).toBe(true)
    const mid = r.model.walls.find((w) => w.id === 'mid')!
    expect(mid.a).toEqual([120, -12])
    expect(wallLength(mid)).toBe(112)
  })

  it('refuses a move that would push a door off the end of a wall', () => {
    const m = twoRooms()
    m.openings[0].at = 85 // near the bottom end of the middle wall
    const r = applyOps(m, [{ op: 'move', id: 'bottom', dx: 0, dy: -20 }], { author: 'user' })
    expect(r.applied).toBe(0)
    expect(r.skipped[0]).toMatch(/would no longer fit/)
  })

  it('records who moved it: Velda edits carry the version label', () => {
    const r = applyOps(twoRooms(), [{ op: 'move', id: 'mid', dx: -6 }], { author: 'ai', versionLabel: 'v7 Bigger office' })
    const mid = r.model.walls.find((w) => w.id === 'mid')!
    expect(mid.prov.a).toEqual({ src: 'ai', note: 'v7 Bigger office' })
    expect(badgeOf(mid.prov.a)).toBe('velda')
  })
})

describe('structure and safety rules', () => {
  it('only a person can say a wall carries no load', () => {
    expect(applyOps(twoRooms(), [{ op: 'update_wall', id: 'mid', bearing: 'no' }], { author: 'ai' }).skipped[0]).toMatch(/only a person/)
    expect(applyOps(twoRooms(), [{ op: 'update_wall', id: 'mid', bearing: 'no' }], { author: 'user' }).model.walls.find((w) => w.id === 'mid')!.bearing).toBe('no')
  })

  it('keeps an engineer note when a wall that may carry load is removed or moved more than 6 in, not for a small nudge', () => {
    const removed = applyOps(twoRooms(), [{ op: 'delete', id: 'mid' }], { author: 'user' })
    expect(removed.model.notes.filter((n) => n.locked).map((n) => n.text)).toEqual(['Engineer to confirm: wall mid may carry load and was removed.'])
    expect(applyOps(twoRooms(), [{ op: 'move', id: 'mid', dx: 4 }], { author: 'user' }).model.notes).toEqual([])
    expect(applyOps(twoRooms(), [{ op: 'move', id: 'mid', dx: 8 }], { author: 'user' }).model.notes.filter((n) => n.locked)).toHaveLength(1)
  })

  it('reads a window height under its sill plus 12 in as glass height and stores the head height', () => {
    const r = applyOps(twoRooms(), [{ op: 'add_opening', wall: 'top', kind: 'window', at: 60, w: 36, h: 48, sill: 36 }], { author: 'ai' })
    const win = r.model.openings.find((o) => o.kind === 'window')!
    expect(win.h).toBe(84)
    expect(win.style).toBe('double_hung')
    expect(r.notes.join(' ')).toMatch(/glass height/)
  })

  it('a ceiling change sets the focused level and restacks the floors above', () => {
    const m = twoRooms()
    m.levels.push({ ...m.levels[0], id: 'L2', name: 'Level 2', elev: 120 })
    const r = applyOps(m, [{ op: 'set_level', id: 'L1', ceiling: 120 }], { author: 'user' })
    expect(r.model.levels.find((l) => l.id === 'L2')!.elev).toBe(132)
    expect(badgeOf(r.model.levels[0].prov.ceiling)).toBe('measured')
  })
})

describe('dimensions', () => {
  it('marks a dimension in conflict when the walls it binds to move away from its value', () => {
    const m = deriveRooms(twoRooms())
    m.dimensions = [
      { id: 'd', level: 'L1', a: [3, 50], b: [118, 50], value: 115, text: `9'-7"`, source: 'sheet', status: 'ok', binds: [{ kind: 'wall_face', id: 'left', which: 'right' }, { kind: 'wall_face', id: 'mid', which: 'right' }] },
    ]
    updateDimensionStatus(m)
    expect(m.dimensions[0].status).toBe('ok')
    const moved = applyOps(m, [{ op: 'move', id: 'mid', dx: 2 }], { author: 'user' })
    expect(moved.model.dimensions[0].status).toBe('conflict')
  })
})

describe('comparing versions', () => {
  it('lists the moved wall with how far it moved, the resized rooms and nothing else', async () => {
    const { diffModels } = await import('../../src/model/diff')
    const before = deriveRooms(twoRooms())
    const after = applyOps(before, [{ op: 'move', id: 'mid', dx: 12 }], { author: 'user' }).model
    const d = diffModels(before, after)
    expect(d.walls.moved.map((w) => [w.id, w.move])).toEqual([['mid', 12]])
    expect(d.walls.added).toEqual([])
    expect(d.rooms.resized.map((r) => r.name).sort()).toEqual(['Den', 'Office'])
    expect(d.openings.changed).toEqual([]) // the door stayed where it was on its wall
    expect(diffModels(after, after).empty).toBe(true)
  })
})
