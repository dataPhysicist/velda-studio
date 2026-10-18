// The import accuracy gate (05 section 9): the A2 sheet, read from the recorded adapter output and
// the plan JPEG decoded in Node, must pass every hard check in the ground truth.
import { describe, expect, it } from 'vitest'
import { splitAtJunctions } from '../../src/import'
import { editCost } from '../../src/import/evaluate'
import { bindCoordinate } from '../../src/model/derive'
import { pointInPolygon, wallLength } from '../../src/model/geom'
import type { Opening, Vec, Wall } from '../../src/model/types'
import { a2, truth } from './a2-fixture'

const H = truth.hard_checks
const refWalls: { id: string; a: Vec; b: Vec; t: number; openings: { id: string; kind: string; at: number; w: number; style?: string }[] }[] = truth.reference_walls_v0_3.walls

const centerOf = (w: { a: Vec; b: Vec }, at: number): Vec => {
  const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
  return [w.a[0] + ((w.b[0] - w.a[0]) / L) * at, w.a[1] + ((w.b[1] - w.a[1]) / L) * at]
}
/** Wall segments between tees, the counting rule in hard_checks.walls_expected.counted_as. */
function segments(walls: Wall[], openings: Opening[]) {
  const centers = new Map(openings.map((o) => [o.id, centerOf(walls.find((w) => w.id === o.wall)!, o.at)]))
  return splitAtJunctions(walls, openings, centers).walls.length
}
const asWall = (w: (typeof refWalls)[number]): Wall => ({ id: w.id, level: 'L2', a: w.a, b: w.b, t: w.t, kind: 'wall', exterior: false, bearing: 'unknown', prov: { a: { src: 'user' }, b: { src: 'user' }, t: { src: 'user' } } })
const asOpenings = (w: (typeof refWalls)[number]) => w.openings.map((o) => ({ ...o, wall: w.id }) as unknown as Opening)

describe('A2 as-built level 2: import accuracy gate', () => {
  it('reads the sheet: number, level, as-built, scale 1.5 pt per inch from 96 of 98 strings', () => {
    const { result } = a2()
    expect(result.guess.number).toBe('A2')
    expect(result.guess.level).toBe('L2')
    expect(result.guess.role).toBe('asbuilt')
    expect(result.guess.tier).toBe('A')
    expect(Math.abs((result.ptPerInch ?? 0) - H.scale_pt_per_inch.expected)).toBeLessThanOrEqual(H.scale_pt_per_inch.tol)
    expect(result.guess.scaleText?.ptPerInch).toBe(1.5) // the title block agrees
    expect(result.dims.length).toBeGreaterThanOrEqual(H.dimension_strings_parsed_min)
    expect(result.dims.filter((d) => d.line).length).toBeGreaterThanOrEqual(H.dimension_strings_paired_min)
  })

  it('finds all 14 rooms by name (JACK & JILL SHOWER is one room from two lines; W and D are items)', () => {
    const { model } = a2().result
    const names = new Set(model.rooms.map((r) => r.name.toUpperCase()))
    for (const label of H.room_labels_expected) expect(names, label).toContain(label)
    expect(model.items.map((i) => [i.label, i.kind]).sort()).toEqual([
      ['D', 'dryer'],
      ['W', 'washer'],
    ])
  })

  it('every clear dimension check holds after the solve, measured between the faces its string binds to', () => {
    const { model } = a2().result
    const misses: string[] = []
    for (const c of H.clear_dimension_checks) {
      const [x0, y0, x1, y1] = c.string_line_in
      const near = (p: Vec, x: number, y: number) => Math.hypot(p[0] - x, p[1] - y) < 2
      const d = model.dimensions.find((d) => d.text === c.string && ((near(d.a, x0, y0) && near(d.b, x1, y1)) || (near(d.a, x1, y1) && near(d.b, x0, y0))))
      if (!d) {
        misses.push(`${c.room} ${c.string}: no dimension record`)
        continue
      }
      const a = bindCoordinate(model, d, 0)
      const b = bindCoordinate(model, d, 1)
      if (a === null || b === null || d.binds.some((x) => x.kind !== 'wall_face')) {
        misses.push(`${c.room} ${c.string}: not bound to two wall faces`)
        continue
      }
      const got = Math.abs(b - a)
      if (Math.abs(got - c.clear_in) > c.tol_in) misses.push(`${c.room} ${c.axis} ${c.string}: ${got.toFixed(2)} in, want ${c.clear_in}`)
    }
    expect(misses).toEqual([])
  })

  it('traces wall thickness within 0.5 in before normalization', () => {
    const { model } = a2().result
    for (const c of H.wall_thickness_checks) {
      const [f0, f1] = c.faces_in
      const mid = (f0 + f1) / 2
      // "left exterior wall at y=240": a vertical wall near x = mid covering y 240, and so on
      const m = /at ([xy])=(\d+)/.exec(c.where)!
      const along = Number(m[2])
      const vertical = m[1] === 'y'
      const w = model.walls.find((w) => {
        const run = vertical ? Math.abs(w.a[0] - w.b[0]) < 0.01 : Math.abs(w.a[1] - w.b[1]) < 0.01
        const cross = vertical ? w.a[0] : w.a[1]
        const [lo, hi] = vertical ? [Math.min(w.a[1], w.b[1]), Math.max(w.a[1], w.b[1])] : [Math.min(w.a[0], w.b[0]), Math.max(w.a[0], w.b[0])]
        return run && Math.abs(cross - mid) < 3 && lo <= along && hi >= along
      })
      expect(w, c.where).toBeTruthy()
      expect(Math.abs((w!.tMeasured ?? w!.t) - c.t_in), `${c.where}: ${w!.tMeasured}`).toBeLessThanOrEqual(c.tol)
    }
  })

  it('counts walls, windows, doors and cased openings within tolerance of the reference', () => {
    const { model } = a2().result
    const refSegments = segments(refWalls.map(asWall), refWalls.flatMap(asOpenings))
    const ours = segments(model.walls, model.openings)
    expect(Math.abs(ours - refSegments), `${ours} wall segments, reference ${refSegments}`).toBeLessThanOrEqual(H.walls_expected.tol)
    const refKinds = refWalls.flatMap((w) => w.openings.map((o) => o.kind))
    const count = (k: string) => model.openings.filter((o) => o.kind === k).length
    const want = H.openings_expected_on_level
    expect(refKinds.filter((k) => k === 'window').length).toBe(want.windows)
    expect(refKinds.filter((k) => k === 'door').length).toBe(want.doors)
    expect(refKinds.filter((k) => k === 'opening').length).toBe(want.cased_openings)
    expect(Math.abs(count('window') - want.windows)).toBeLessThanOrEqual(2)
    expect(Math.abs(count('door') - want.doors)).toBeLessThanOrEqual(2)
    expect(Math.abs(count('opening') - want.cased_openings)).toBeLessThanOrEqual(1)
  })

  it('reads the legend tints: 18 demolish and 4 confirm rectangles; the two flagged rooms are flagged', () => {
    const { result } = a2()
    expect(result.tints.filter((t) => t.kind === 'demolish')).toHaveLength(H.tint_checks.demolish_rects)
    expect(result.tints.filter((t) => t.kind === 'confirm')).toHaveLength(H.tint_checks.confirm_rects)
    const flagged = result.model.rooms.filter((r) => r.flags.includes('needs_confirming')).map((r) => r.name.toUpperCase())
    for (const name of H.tint_checks.rooms_needs_confirming_must_include) expect(flagged).toContain(name)
    // each tint lands where the ground truth measured it
    for (const t of truth.tints) {
      const hit = result.tints.find((x) => x.kind === t.kind && x.rect.every((v, i) => Math.abs(v - t.rect_in[i]) < 1))
      expect(hit, JSON.stringify(t.rect_in)).toBeTruthy()
    }
  })

  it('edit cost against the reference walls is 8 or less, and every unmatched item is listed', () => {
    const { model } = a2().result
    const produced = model.walls.map((w) => ({ id: w.id, a: w.a, b: w.b, openings: model.openings.filter((o) => o.wall === w.id).map((o) => ({ id: o.id, kind: o.kind, at: o.at, w: o.w })) }))
    const ec = editCost(produced, refWalls)
    const listed = [...ec.unmatchedReference.map((r) => `reference wall ${r} has no traced match`), ...ec.unmatchedProduced.map((p) => `traced wall ${p} is not in the reference`), ...ec.openings.map((o) => `${o.wall}: ${o.problem}`)]
    process.stderr.write(`edit cost ${ec.cost}\n${listed.map((l) => `  ${l}`).join('\n')}\n`)
    expect(listed).toHaveLength(ec.cost)
    expect(ec.cost, listed.join('; ')).toBeLessThanOrEqual(H.edit_cost.max)
  })

  it('shows at most 3 conflicts and 7 unresolved items on the Confirm screen', () => {
    const { report } = a2().result
    expect(report.conflicts.length).toBeLessThanOrEqual(3)
    expect(report.unresolved.length, report.unresolved.join('\n')).toBeLessThanOrEqual(7)
    // the known unpaired strings are among them, and fixture strings are kept apart, not lost
    expect(report.unresolved.filter((u) => /no dimension line/.test(u)).length).toBe(2)
    expect(report.fixtureStrings.length + report.unresolved.length + report.sheets[0].dims.bound).toBeGreaterThanOrEqual(96)
  })

  it('every number carries where it came from: strings govern the walls they bind, the rest is traced or assumed', () => {
    const { model } = a2().result
    const srcs = new Set(model.walls.map((w) => w.prov.a.src))
    expect([...srcs].every((s) => s === 'sheet_dim' || s === 'sheet_raster')).toBe(true)
    expect(model.walls.filter((w) => w.prov.a.src === 'sheet_dim').length).toBeGreaterThan(20)
    for (const o of model.openings) expect(o.prov.h.src).toBe('default') // heights are not on the plan
    expect(model.levels[0].prov.ceiling.src).toBe('default') // asked in the intake, never assumed as measured
    expect(model.levels[0].ceiling).toBe(108)
    // a door in a wall: inside its wall
    for (const o of model.openings) {
      const w = model.walls.find((x) => x.id === o.wall)!
      expect(o.at - o.w / 2, o.id).toBeGreaterThanOrEqual(-0.5)
      expect(o.at + o.w / 2, o.id).toBeLessThanOrEqual(wallLength(w) + 0.5)
    }
    // rooms are real polygons and their labels sit inside them
    for (const r of model.rooms.filter((r) => r.labelAt)) expect(pointInPolygon(r.labelAt!, r.polygon), r.name).toBe(true)
  })
})
