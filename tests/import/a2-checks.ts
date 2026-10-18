// The A2 hard checks as one function, so the unit gate (recorded adapter output, Node) and the
// browser test (real adapter, worker and Confirm screen) hold the import to exactly the same bar.
import { readFileSync } from 'node:fs'
import { splitAtJunctions } from '../../src/import'
import { editCost } from '../../src/import/evaluate'
import { bindCoordinate } from '../../src/model/derive'
import type { Model, Opening, Vec, Wall } from '../../src/model/types'

export const truth = JSON.parse(readFileSync(new URL('../../scripts/fixtures/A2-asbuilt-level2.ground-truth.json', import.meta.url), 'utf8'))
const H = truth.hard_checks
type RefWall = { id: string; a: Vec; b: Vec; t: number; openings: { id: string; kind: string; at: number; w: number }[] }
export const refWalls: RefWall[] = truth.reference_walls_v0_3.walls

const centerOf = (w: { a: Vec; b: Vec }, at: number): Vec => {
  const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
  return [w.a[0] + ((w.b[0] - w.a[0]) / L) * at, w.a[1] + ((w.b[1] - w.a[1]) / L) * at]
}
/** Wall segments between tees: the rule in hard_checks.walls_expected.counted_as. */
export function segments(walls: Wall[], openings: Opening[]) {
  const centers = new Map(openings.map((o) => [o.id, centerOf(walls.find((w) => w.id === o.wall)!, o.at)]))
  return splitAtJunctions(walls, openings, centers).walls.length
}
const asWall = (w: RefWall): Wall => ({ id: w.id, level: 'L2', a: w.a, b: w.b, t: w.t, kind: 'wall', exterior: false, bearing: 'unknown', prov: { a: { src: 'user' }, b: { src: 'user' }, t: { src: 'user' } } })
export const referenceSegments = () => segments(refWalls.map(asWall), refWalls.flatMap((w) => w.openings.map((o) => ({ ...o, wall: w.id }) as unknown as Opening)))

export function clearDimensionMisses(model: Model): string[] {
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
  return misses
}

export function thicknessMisses(model: Model): string[] {
  const out: string[] = []
  for (const c of H.wall_thickness_checks) {
    const mid = (c.faces_in[0] + c.faces_in[1]) / 2
    const m = /at ([xy])=(\d+)/.exec(c.where)!
    const along = Number(m[2])
    const vertical = m[1] === 'y'
    const w = model.walls.find((w) => {
      const run = vertical ? Math.abs(w.a[0] - w.b[0]) < 0.01 : Math.abs(w.a[1] - w.b[1]) < 0.01
      const cross = vertical ? w.a[0] : w.a[1]
      const [lo, hi] = vertical ? [Math.min(w.a[1], w.b[1]), Math.max(w.a[1], w.b[1])] : [Math.min(w.a[0], w.b[0]), Math.max(w.a[0], w.b[0])]
      return run && Math.abs(cross - mid) < 3 && lo <= along && hi >= along
    })
    if (!w) out.push(`${c.where}: no wall`)
    else if (Math.abs((w.tMeasured ?? w.t) - c.t_in) > c.tol) out.push(`${c.where}: ${w.tMeasured} in, want ${c.t_in}`)
  }
  return out
}

export function editCostOf(model: Model) {
  const produced = model.walls.map((w) => ({ id: w.id, a: w.a, b: w.b, openings: model.openings.filter((o) => o.wall === w.id).map((o) => ({ id: o.id, kind: o.kind, at: o.at, w: o.w })) }))
  const ec = editCost(produced, refWalls)
  const listed = [...ec.unmatchedReference.map((r) => `reference wall ${r} has no traced match`), ...ec.unmatchedProduced.map((p) => `traced wall ${p} is not in the reference`), ...ec.openings.map((o) => `${o.wall}: ${o.problem}`)]
  return { cost: ec.cost, listed }
}

/** Everything a saved model can be checked for; returns the failures (empty when A2 passes). */
export function checkA2Model(model: Model): string[] {
  const fail: string[] = []
  const names = new Set(model.rooms.map((r) => r.name.toUpperCase()))
  for (const label of H.room_labels_expected) if (!names.has(label)) fail.push(`room ${label} missing`)
  fail.push(...clearDimensionMisses(model))
  fail.push(...thicknessMisses(model))
  const ours = segments(model.walls, model.openings)
  const ref = referenceSegments()
  if (Math.abs(ours - ref) > H.walls_expected.tol) fail.push(`${ours} wall segments, reference ${ref}`)
  const want = H.openings_expected_on_level
  const count = (k: string) => model.openings.filter((o) => o.kind === k).length
  if (Math.abs(count('window') - want.windows) > 2) fail.push(`${count('window')} windows, want ${want.windows}`)
  if (Math.abs(count('door') - want.doors) > 2) fail.push(`${count('door')} doors, want ${want.doors}`)
  if (Math.abs(count('opening') - want.cased_openings) > 1) fail.push(`${count('opening')} cased openings, want ${want.cased_openings}`)
  const tints = model.sheets[0]?.tints ?? []
  if (tints.filter((t) => t.kind === 'demolish').length !== H.tint_checks.demolish_rects) fail.push('demolish tints')
  if (tints.filter((t) => t.kind === 'confirm').length !== H.tint_checks.confirm_rects) fail.push('confirm tints')
  const flagged = new Set(model.rooms.filter((r) => r.flags.includes('needs_confirming')).map((r) => r.name.toUpperCase()))
  for (const n of H.tint_checks.rooms_needs_confirming_must_include) if (!flagged.has(n)) fail.push(`${n} not flagged`)
  const ec = editCostOf(model)
  if (ec.cost > H.edit_cost.max) fail.push(`edit cost ${ec.cost}: ${ec.listed.join('; ')}`)
  if (Math.abs(model.sheets[0]?.scale.ptPerInch - H.scale_pt_per_inch.expected) > H.scale_pt_per_inch.tol) fail.push('scale')
  return fail
}
