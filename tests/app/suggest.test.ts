import { describe, expect, it } from 'vitest'
import { plainError } from '../../src/app/errors'
import { firstChange, suggestions } from '../../src/app/suggest'
import type { Issue } from '../../src/analysis/checks'
import { deriveRooms } from '../../src/model/derive'
import { twoRooms } from '../model/fixtures'

describe('suggested prompts', () => {
  const m = () => {
    const x = deriveRooms(twoRooms())
    x.rooms.find((r) => r.name === 'Den')!.name = 'Guest Bath 1'
    return x
  }
  it('puts a check that needs fixing first, named in plain words', () => {
    const model = m()
    const bath = model.rooms.find((r) => r.name === 'Guest Bath 1')!
    const issue: Issue = { id: 'toilet-side:wc', severity: 'blocks', rule: 'toilet-side', where: { level: bath.level, room: bath.id, ids: ['wc'] }, message: '' }
    const s = suggestions({ model, roomId: bath.id, checks: [issue], asBuilt: false })
    expect(s[0]).toBe('Fix the toilet clearance in the Guest Bath 1')
    expect(s).toContain('Find me the best shower for this bathroom')
    expect(s.length).toBeLessThanOrEqual(4)
  })
  it('fits the room in focus, offers the look after inspiration, and a field measurement on the as-built', () => {
    const model = m()
    const office = model.rooms.find((r) => r.name === 'Office')!
    const s = suggestions({ model, roomId: office.id, checks: [], asBuilt: true, recentInspiration: 'm1' }, 6)
    expect(s).toEqual(['Apply this look to the Office', 'What would you change in the Office?', 'Show this room realistically', 'Record a wall I measured with a tape'])
    expect(suggestions({ model: null, roomId: null, checks: [], asBuilt: false })).toEqual([]) // the welcome asks for a plan first
  })
})

describe('the first change the tour offers', () => {
  it('is about the room just clicked: its tub, its vanity, or the room itself', () => {
    const model = deriveRooms(twoRooms())
    const [a, b] = model.rooms
    const c = (r: (typeof model.rooms)[0]) => {
      const xs = r.polygon.map((p) => p[0])
      const ys = r.polygon.map((p) => p[1])
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
    }
    model.items.push({ id: 'tb', kind: 'tub', label: 'Tub', level: a.level, ...c(a), w: 60, d: 32, h: 20, rot: 0, elev: 0, prov: {} } as any)
    expect(firstChange(model, a.id)).toBe(`Swap the tub in the ${a.name} for a walk-in shower`)
    expect(firstChange(model, b.id)).toBe(`Make the ${b.name} 1'-0" bigger`)
    expect(firstChange(model, null)).toBe('What would you change first?')
    expect(firstChange(null, null)).toBe('Move the sink to the island')
  })
})

describe('errors in plain words', () => {
  it('never shows a tool name or a stack', () => {
    expect(plainError(new Error('Failed to execute public tool execute_code'))).toBe('this page cannot reach that part of Toolbelt right now')
    expect(plainError(new Error('Delegation timed out after 240s'))).toBe('Velda did not answer in time; try again in a minute')
    expect(plainError(new Error('TypeError: Failed to fetch'))).toBe('the connection dropped; check you are online and try again')
    expect(plainError(new Error('no image came back'))).toBe('no image came back')
    expect(plainError(new Error(`x is undefined\n    at foo (studio.js:1:2)`))).toBe('x is undefined')
  })
})
