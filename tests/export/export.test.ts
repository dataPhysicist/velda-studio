import { describe, expect, it } from 'vitest'
import { changeLog, changesCsv, changesMd } from '../../src/export/changes'
import { checklist, checklistMd } from '../../src/export/checklist'
import { planSvg } from '../../src/export/plan-svg'
import { schedules, toCsv } from '../../src/export/schedules'
import { applyOps } from '../../src/model/ops'
import { roomEdges } from '../../src/model/place'
import type { Model } from '../../src/model/types'
import { a2 } from '../import/a2-fixture'

const asBuilt = (): Model => a2().result.model

/** A2 with the wall between the I.T. closet and the laundry below it moved 1'-0" into the closet, and a vanity. */
function scheme() {
  const base = asBuilt()
  const it = base.rooms.find((r) => r.name === 'I.T. Clst')!
  const laundry = base.rooms.find((r) => r.name === 'Laundry Room')!
  // The wall between them: an edge of each on the same wall, facing each other.
  const shared = roomEdges(base, it).find((e) => e.wall && roomEdges(base, laundry).some((f) => f.wall?.id === e.wall!.id && f.inward[0] * e.inward[0] + f.inward[1] * e.inward[1] < -0.9))!.wall!
  const bath = base.rooms.find((r) => r.name === 'Primary Bathroom')!
  const res = applyOps(
    base,
    [
      { op: 'move_wall', id: shared.id, by: 12, toward: it.id },
      { op: 'add_item', id: 'van', kind: 'vanity', label: 'Double vanity, white oak', x: 700, y: 296, w: 72, d: 22 },
    ],
    { author: 'user' },
  )
  expect(res.skipped).toEqual([])
  void bath
  return { base, m: res.model, wall: shared.id }
}

describe('plan SVG for the sheets and the viewer', () => {
  it('draws level 2 with its rooms, clear dimensions, door swings and overall size', () => {
    const m = asBuilt()
    const { svg, w, h } = planSvg(m, { level: m.levels[0].id })
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox=')).toBe(true)
    expect(svg).toContain('>Primary Bedroom<')
    expect(svg).toContain('19&#39;-8&quot;'.replace('&#39;', "'")) // the primary bedroom's 19'-8"
    expect((svg.match(/<path d="M /g) ?? []).length).toBeGreaterThan(5) // door swings
    expect(w).toBeGreaterThan(400)
    expect(h).toBeGreaterThan(300)
    expect(svg).not.toMatch(/NaN/)
  })

  it('shows what a scheme changes against the as-built: moved walls with how far', () => {
    const { base, m } = scheme()
    const { svg } = planSvg(m, { level: m.levels[0].id, base })
    expect(svg).toContain('moved 1&#39;-0&quot;'.replace('&#39;', "'"))
  })
})

describe('schedules', () => {
  it('lists rooms, doors, windows and fixtures, in decimal inches for CSV', () => {
    const { m } = scheme()
    const [rooms, doors, windows, items] = schedules(m)
    const bed = rooms.rows.find((r) => r.name === 'Primary Bedroom')!
    expect(Math.abs(Number(bed.width_in) - 236)).toBeLessThan(1) // the outline is within 1 in of the drawing's 19'-8"
    expect(bed.ceiling_in).toBe(108)
    expect(doors.rows.length).toBeGreaterThan(10)
    expect(doors.rows.some((r) => /^into .+, hinge at the (start|end) of the wall$/.test(String(r.swing)))).toBe(true)
    expect(windows.rows.length).toBe(14)
    expect(windows.rows.every((r) => /^(yes|no)/.test(String(r.egress)))).toBe(true)
    expect(items.rows.find((r) => r.item === 'Double vanity, white oak')).toMatchObject({ room: 'Primary Bathroom', width_in: 72, depth_in: 22 })
    const csv = toCsv(rooms)
    expect(csv.split('\n')[0]).toBe('level,name,width_in,depth_in,area_sf,ceiling_in,ceiling_source,flags,theme')
    expect(csv).toContain('"Guest Bath 1"'.replace(/"/g, '')) // names come through
  })
})

describe('change log against the as-built', () => {
  it('says each change as a sentence a contractor can read', () => {
    const { base, m } = scheme()
    const log = changeLog(base, m)
    const text = log.map((c) => c.text)
    expect(text.some((t) => /^Move the wall between .*I\.T\. Clst.* 1'-0"/.test(t))).toBe(true)
    expect(text).toContain('Laundry Room grows from 15\'-0" x 9\'-9 3/4" (121 sf) to 15\'-0" x 10\'-9 3/4" (136 sf).')
    expect(text.some((t) => /^I\.T\. Clst shrinks from /.test(t))).toBe(true)
    expect(text).toContain('Add Double vanity (6\'-0" by 1\'-10") in Primary Bathroom.')
    const md = changesMd('As-built', 'Option 1', log)
    expect(md).toContain('Design intent. Not for construction. Field verify all dimensions.')
    expect(changesCsv(log).split('\n')[0]).toBe('level,kind,ids,engineer,change')
    expect(md).not.toMatch(/—/)
  })
})

describe('handoff checklist', () => {
  it('says what is missing without blocking', () => {
    const m = asBuilt()
    const lines = checklist({ model: m, asBuilt: m, aside: new Set(), asBuiltEdits: [], isAsBuilt: true })
    const ceiling = lines.find((l) => /ceiling height/.test(l.text))!
    expect(ceiling.ok).toBe(false) // the fixture is the import before its Confirm screen answers
    expect(ceiling.missing[0]).toMatch(/^Level 2: ceiling \d+'-\d+" is assumed$/)
    expect(lines.find((l) => /measured head and sill/.test(l.text))!.ok).toBe(false)
    expect(lines.find((l) => /remodeled are named/.test(l.text))!.missing[0]).toMatch(/No rooms are marked/)
    expect(checklistMd(lines)).toMatch(/^- \[ \] Every level has a confirmed ceiling height and floor thickness\.\n  - Level 2: ceiling/)
  })
})
