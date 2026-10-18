// Dimension reconciliation (05 section 3.8): strings govern, pixels locate. Each paired string binds
// its two ends to wall faces (or centerlines, or opening edges); a weighted least squares then
// moves wall lines and opening positions so every bound string holds, while keeping everything as
// close to the trace as the strings allow. Bindings that would drag a wall more than 2 in are
// dropped and listed. Pure: model pieces in, model pieces out.
import { findJoints } from '../model/derive'
import { wallLength } from '../model/geom'
import type { DimBind, Dimension, Opening, Prov, Vec, Wall } from '../model/types'

export type SolveDim = {
  id: string
  text: string
  value: number
  /** Ends of the drawn dimension line, sheet inches. */
  a: Vec
  b: Vec
}

export type SolveResult = {
  walls: Wall[]
  openings: Opening[]
  dimensions: Dimension[]
  /** Strings that could not bind both ends, or were dropped by the robustness pass. */
  unresolved: { id: string; text: string; why: string; kind: 'diagonal' | 'fixture' | 'near_miss' | 'dropped' }[]
  conflicts: { id: string; text: string; drawn: number; traced: number; where: Vec }[]
  moved: { wall: string; by: number }[]
  iterations: number
}

type Axis = 'x' | 'y'
const axisOfDim = (d: SolveDim): Axis | null => {
  const dx = Math.abs(d.b[0] - d.a[0])
  const dy = Math.abs(d.b[1] - d.a[1])
  if (dy <= dx * 0.03) return 'x'
  if (dx <= dy * 0.03) return 'y'
  return null
}
const k = (a: Axis) => (a === 'x' ? 0 : 1)
const other = (a: Axis): Axis => (a === 'x' ? 'y' : 'x')
/** A wall runs along y (vertical) or x (horizontal), or neither. */
const runOf = (w: Wall): Axis | null => {
  if (Math.abs(w.a[0] - w.b[0]) < 0.01) return 'y'
  if (Math.abs(w.a[1] - w.b[1]) < 0.01) return 'x'
  return null
}

type End = {
  coord: number // traced coordinate along the dimension axis
  bind: DimBind
  /** Unknown this end depends on and its offset: coord = X[u] + off. u < 0: fixed. */
  u: number
  off: number
  scale: number // +1, or the sign that maps the unknown to the coordinate
}

export function solveDimensions(wallsIn: Wall[], openingsIn: Opening[], dims: SolveDim[], opts: { sheet: string; level: string; tol?: number }): SolveResult {
  const walls: Wall[] = structuredClone(wallsIn)
  const openings: Opening[] = structuredClone(openingsIn)
  const tol = opts.tol ?? 1.5
  const byId = new Map(walls.map((w) => [w.id, w]))

  // Unknowns: one per line group (collinear walls joined end to end move together), one per opening.
  const groupOf = new Map<string, number>()
  const groups: { axis: Axis; walls: Wall[]; traced: number }[] = []
  for (const run of ['x', 'y'] as Axis[]) {
    const cross = other(run) // the coordinate a wall of this run sits at
    const ws = walls.filter((w) => runOf(w) === run).sort((p, q) => p.a[k(cross)] - q.a[k(cross)])
    for (const w of ws) {
      const c = w.a[k(cross)]
      const lo = Math.min(w.a[k(run)], w.b[k(run)])
      const hi = Math.max(w.a[k(run)], w.b[k(run)])
      const g = groups.findIndex(
        (gr) =>
          gr.axis === cross &&
          Math.abs(gr.traced - c) < 0.25 &&
          gr.walls.some((o) => Math.min(o.a[k(run)], o.b[k(run)]) <= hi + 1 && Math.max(o.a[k(run)], o.b[k(run)]) >= lo - 1),
      )
      if (g >= 0) {
        groups[g].walls.push(w)
        groupOf.set(w.id, g)
      } else {
        groups.push({ axis: cross, walls: [w], traced: c })
        groupOf.set(w.id, groups.length - 1)
      }
    }
  }
  const nG = groups.length
  const openIdx = new Map(openings.map((o, i) => [o.id, nG + i]))
  const n = nG + openings.length
  const traced = [...groups.map((g) => g.traced), ...openings.map((o) => o.at)]

  // ---- binding
  const candidatesFor = (axis: Axis, coord: number, line: number): End[] => {
    const out: (End & { dAxis: number; dPerp: number })[] = []
    const ax = k(axis)
    const pe = k(other(axis))
    for (const w of walls) {
      const run = runOf(w)
      if (!run) continue
      const t = w.tMeasured ?? w.t
      if (run === other(axis)) {
        // Perpendicular to the string: its faces and centerline are candidates.
        const lo = Math.min(w.a[pe], w.b[pe]) - t / 2
        const hi = Math.max(w.a[pe], w.b[pe]) + t / 2
        const dPerp = line < lo ? lo - line : line > hi ? line - hi : 0
        if (dPerp > 3) continue
        const c = w.a[ax]
        // which face is 'left' of a->b along this axis
        const left = run === 'y' ? (w.b[1] > w.a[1] ? 1 : -1) : w.b[0] > w.a[0] ? -1 : 1
        const g = groupOf.get(w.id)!
        for (const [which, off] of [
          ['left', (left * t) / 2],
          ['right', (-left * t) / 2],
          ['center', 0],
        ] as const) {
          const dAxis = Math.abs(c + off - coord)
          if (dAxis > tol) continue
          const bind: DimBind = which === 'center' ? { kind: 'wall_center', id: w.id, which: 'a' } : { kind: 'wall_face', id: w.id, which }
          out.push({ coord: c + off, bind, u: g, off, scale: 1, dAxis: dAxis + (which === 'center' ? 0.3 : 0), dPerp })
        }
      } else if (run === axis) {
        // Parallel: opening edges along it, when the string runs close to the wall.
        if (Math.abs(w.a[pe] - line) > 12) continue
        const L = wallLength(w)
        const dir = (w.b[ax] - w.a[ax]) / L // +1 or -1 along the axis
        for (const o of openings.filter((x) => x.wall === w.id)) {
          for (const which of ['a', 'b'] as const) {
            const s = o.at + (which === 'a' ? -o.w / 2 : o.w / 2)
            const c = w.a[ax] + dir * s
            const dAxis = Math.abs(c - coord)
            if (dAxis > tol) continue
            // coord = wall.a + dir*(at -/+ w/2): unknown is `at`
            out.push({
              coord: c,
              bind: { kind: 'opening_edge', id: o.id, which },
              u: openIdx.get(o.id)!,
              off: w.a[ax] + dir * (which === 'a' ? -o.w / 2 : o.w / 2),
              scale: dir,
              dAxis,
              dPerp: Math.abs(w.a[pe] - line) / 4,
            })
          }
        }
      }
    }
    out.sort((p, q) => p.dPerp + p.dAxis - (q.dPerp + q.dAxis))
    return out
  }

  /** Distance to the nearest perpendicular wall face around this point, if within 6 in. */
  const nearWall = (axis: Axis, coord: number, line: number): number | null => {
    let best: number | null = null
    for (const w of walls) {
      if (runOf(w) !== other(axis)) continue
      const pe = k(other(axis))
      const t = w.tMeasured ?? w.t
      const lo = Math.min(w.a[pe], w.b[pe]) - t / 2
      const hi = Math.max(w.a[pe], w.b[pe]) + t / 2
      if (line < lo - 3 || line > hi + 3) continue
      const d = Math.min(Math.abs(w.a[k(axis)] - t / 2 - coord), Math.abs(w.a[k(axis)] + t / 2 - coord))
      if (d <= 6 && (best === null || d < best)) best = d
    }
    return best
  }
  type Bound = { d: SolveDim; axis: Axis; ends: [End, End]; sign: number }
  const bound: Bound[] = []
  const unresolved: SolveResult['unresolved'] = []
  const widthSet: { d: SolveDim; o: Opening }[] = []
  const lineOf = (d: SolveDim, axis: Axis) => (d.a[k(other(axis))] + d.b[k(other(axis))]) / 2
  // First pass: a string across one opening is that opening's width (set before anything binds to its edges).
  for (const d of dims) {
    const axis = axisOfDim(d)
    if (!axis) continue
    const ca = candidatesFor(axis, d.a[k(axis)], lineOf(d, axis)).filter((x) => x.bind.kind === 'opening_edge')
    const cb = candidatesFor(axis, d.b[k(axis)], lineOf(d, axis)).filter((x) => x.bind.kind === 'opening_edge')
    const hit = ca.find((x) => cb.some((y) => y.bind.id === x.bind.id && y.bind.which !== x.bind.which))
    if (!hit) continue
    const o = openings.find((x) => x.id === hit.bind.id)!
    if (widthSet.some((x) => x.o === o)) continue
    widthSet.push({ d, o })
  }
  for (const { d, o } of widthSet) {
    // The string's ends are the opening's edges: width and position both come from it.
    const w = byId.get(o.wall)!
    const axis = axisOfDim(d)!
    const L = wallLength(w)
    const dir = (w.b[k(axis)] - w.a[k(axis)]) / L
    const s0 = (d.a[k(axis)] - w.a[k(axis)]) * dir
    const s1 = (d.b[k(axis)] - w.a[k(axis)]) * dir
    o.w = d.value
    o.at = Math.round(((s0 + s1) / 2) * 100) / 100
    traced[openIdx.get(o.id)!] = o.at
    const p: Prov = { src: 'sheet_dim', note: `string ${d.text} on ${opts.sheet}` }
    o.prov = { ...o.prov, w: p, at: p }
  }
  const widthIdsSet = new Set(widthSet.map((x) => x.d.id))
  for (const d of dims) {
    if (widthIdsSet.has(d.id)) continue
    const axis = axisOfDim(d)
    if (!axis) {
      unresolved.push({ id: d.id, text: d.text, why: 'diagonal string; no diagonal walls to bind', kind: 'diagonal' })
      continue
    }
    const line = lineOf(d, axis)
    const ca = candidatesFor(axis, d.a[k(axis)], line)
    const cb = candidatesFor(axis, d.b[k(axis)], line)
    const ea = ca[0]
    const eb = cb[0]
    if (!ea || !eb) {
      const near = (c: number) => nearWall(axis, c, line)
      const missing = [!ea ? d.a[k(axis)] : null, !eb ? d.b[k(axis)] : null].filter((x): x is number => x !== null)
      const nearMiss = missing.some((c) => near(c) !== null)
      unresolved.push({
        id: d.id,
        text: d.text,
        why: nearMiss
          ? `${missing.length === 2 ? 'neither end' : 'one end'} lands within 6 in of a wall face but not within ${tol} in`
          : `${missing.length === 2 ? 'neither end' : 'one end'} lands on a fixture or cabinet, not a wall`,
        kind: nearMiss ? 'near_miss' : 'fixture',
      })
      continue
    }
    bound.push({ d, axis, ends: [ea, eb], sign: Math.sign(eb.coord - ea.coord) || 1 })
  }

  // ---- weighted least squares, with the robustness pass
  let active = bound.slice()
  let X = traced.slice()
  let iterations = 0
  const residual = (b: Bound, x: number[]) => {
    const [ea, eb] = b.ends
    const fa = ea.u >= 0 ? ea.scale * x[ea.u] + ea.off : ea.coord
    const fb = eb.u >= 0 ? eb.scale * x[eb.u] + eb.off : eb.coord
    return b.sign * (fb - fa) - b.d.value
  }
  for (; iterations < 4; iterations++) {
    X = leastSquares(n, traced, active)
    const far = new Set<number>()
    for (let i = 0; i < nG; i++) if (Math.abs(X[i] - traced[i]) > 2) far.add(i)
    if (!far.size) break
    // Drop the strings pulling those walls, worst first.
    const culprits = active.filter((b) => b.ends.some((e) => far.has(e.u)))
    const worst = culprits.filter((b) => Math.abs(residual(b, traced)) > 1)
    const drop = new Set(worst.length ? worst : culprits)
    for (const b of drop) unresolved.push({ id: b.d.id, text: b.d.text, why: `would move a traced wall more than 2 in (it reads ${Math.abs(residual(b, traced) + b.d.value).toFixed(1)} in on the trace)`, kind: 'dropped' })
    active = active.filter((b) => !drop.has(b))
  }

  // ---- write back
  const delta = (i: number) => X[i] - traced[i]
  const joints = findJoints(walls)
  const before = new Map(walls.map((w) => [w.id, { a: [...w.a] as Vec, b: [...w.b] as Vec }]))
  for (let g = 0; g < nG; g++) {
    const dlt = delta(g)
    if (Math.abs(dlt) < 1e-6) continue
    const c = k(groups[g].axis)
    for (const w of groups[g].walls) {
      w.a[c] += dlt
      w.b[c] += dlt
    }
  }
  // Re-trim ends at corners and tees to the moved partner so the plan stays closed.
  const shiftEnd = (w: Wall, end: 'a' | 'b', partner: Wall) => {
    const run = runOf(w)
    const prun = runOf(partner)
    if (!run || !prun || run === prun) return
    const g = groupOf.get(partner.id)
    if (g === undefined) return
    w[end][k(run)] += delta(g)
  }
  for (const c of joints.corners) {
    for (const e of c.ends) {
      const w = byId.get(e.wall)
      if (!w) continue
      const partner = c.ends.map((f) => byId.get(f.wall)).find((p) => p && p !== w && runOf(p) && runOf(p) !== runOf(w))
      if (partner) shiftEnd(w, e.end, partner)
    }
  }
  for (const t of joints.tees) {
    const w = byId.get(t.end.wall)
    const h = byId.get(t.host)
    if (w && h) shiftEnd(w, t.end.end, h)
  }
  // Openings keep their place in the plan when a wall's start slid along it; bound ones take the solve.
  for (const o of openings) {
    const w = byId.get(o.wall)
    const was = before.get(o.wall)
    if (!w || !was) continue
    const L = wallLength(w)
    const u: Vec = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L]
    const slid = (w.a[0] - was.a[0]) * u[0] + (w.a[1] - was.a[1]) * u[1]
    const idx = openIdx.get(o.id)!
    const solved = X[idx] - traced[idx]
    o.at = o.at + solved - slid
    if (Math.abs(solved) > 0.01) o.prov = { ...o.prov, at: { src: 'sheet_dim', note: `placed by strings on ${opts.sheet}` } }
  }

  // Provenance: walls held by a resolved string are governed by the drawing.
  const conflicts: SolveResult['conflicts'] = []
  const govern = new Map<string, string>()
  for (const b of active) {
    const r = residual(b, X)
    if (Math.abs(r) > 0.5) {
      conflicts.push({ id: b.d.id, text: b.d.text, drawn: b.d.value, traced: Math.round((r + b.d.value) * 100) / 100, where: [(b.d.a[0] + b.d.b[0]) / 2, (b.d.a[1] + b.d.b[1]) / 2] })
      continue
    }
    for (const e of b.ends) if (e.bind.kind !== 'opening_edge') for (const w of groups[e.u]?.walls ?? []) if (!govern.has(w.id)) govern.set(w.id, b.d.text)
  }
  const moved: SolveResult['moved'] = []
  for (let g = 0; g < nG; g++) if (Math.abs(delta(g)) > 0.01) for (const w of groups[g].walls) moved.push({ wall: w.id, by: Math.round(delta(g) * 100) / 100 })
  for (const w of walls) {
    const text = govern.get(w.id)
    if (!text) continue
    const p: Prov = { src: 'sheet_dim', note: `string ${text} on ${opts.sheet}` }
    w.prov = { ...w.prov, a: p, b: p }
  }

  // Dimension records, bound to what they measure so later edits recompute their status.
  const boundById = new Map(active.map((b) => [b.d.id, b]))
  const conflictIds = new Set(conflicts.map((c) => c.id))
  const widthIds = new Map(widthSet.map((x) => [x.d.id, x.o]))
  const dimensions: Dimension[] = dims.map((d) => {
    const b = boundById.get(d.id)
    const o = widthIds.get(d.id)
    const binds: DimBind[] = b
      ? [b.ends[0].bind, b.ends[1].bind]
      : o
        ? [
            { kind: 'opening_edge', id: o.id, which: 'a' },
            { kind: 'opening_edge', id: o.id, which: 'b' },
          ]
        : []
    return {
      id: `dim_${d.id}`,
      level: opts.level,
      a: d.a,
      b: d.b,
      value: d.value,
      text: d.text,
      source: 'sheet',
      status: conflictIds.has(d.id) ? 'conflict' : binds.length === 2 ? 'ok' : 'unresolved',
      binds,
    }
  })
  return { walls, openings, dimensions, unresolved, conflicts, moved, iterations }
}

/** Dense weighted least squares: strings at weight 100, every unknown pulled to its traced value at weight 1. */
function leastSquares(n: number, traced: number[], bound: { ends: [End, End]; sign: number; d: { value: number } }[]): number[] {
  const N = Array.from({ length: n }, () => new Float64Array(n))
  const r = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    N[i][i] += 1
    r[i] += traced[i]
  }
  const W = 100
  for (const b of bound) {
    // sign * (fb - fa) = value, with f = scale * X[u] + off (or fixed coord)
    const row = new Map<number, number>()
    let rhs = b.d.value
    const [ea, eb] = b.ends
    if (eb.u >= 0) row.set(eb.u, (row.get(eb.u) ?? 0) + b.sign * eb.scale)
    else rhs -= b.sign * eb.coord
    if (eb.u >= 0) rhs -= b.sign * eb.off
    if (ea.u >= 0) row.set(ea.u, (row.get(ea.u) ?? 0) - b.sign * ea.scale)
    else rhs += b.sign * ea.coord
    if (ea.u >= 0) rhs += b.sign * ea.off
    const entries = [...row.entries()].filter(([, v]) => Math.abs(v) > 1e-12)
    if (!entries.length) continue
    for (const [i, vi] of entries) {
      r[i] += W * vi * rhs
      for (const [j, vj] of entries) N[i][j] += W * vi * vj
    }
  }
  // Gaussian elimination with partial pivoting (the system is small).
  const A = N.map((row) => Array.from(row))
  const x = Array.from(r)
  for (let c = 0; c < n; c++) {
    let p = c
    for (let i = c + 1; i < n; i++) if (Math.abs(A[i][c]) > Math.abs(A[p][c])) p = i
    if (Math.abs(A[p][c]) < 1e-12) continue
    ;[A[c], A[p]] = [A[p], A[c]]
    ;[x[c], x[p]] = [x[p], x[c]]
    for (let i = c + 1; i < n; i++) {
      const f = A[i][c] / A[c][c]
      if (!f) continue
      for (let j = c; j < n; j++) A[i][j] -= f * A[c][j]
      x[i] -= f * x[c]
    }
  }
  for (let c = n - 1; c >= 0; c--) {
    let s = x[c]
    for (let j = c + 1; j < n; j++) s -= A[c][j] * x[j]
    x[c] = Math.abs(A[c][c]) < 1e-12 ? traced[c] : s / A[c][c]
  }
  return x
}
