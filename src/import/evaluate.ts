// Compare an imported wall list with a reference list (the ground truth's hand-checked walls):
// the edit cost a person would face fixing the import by hand. Definition from the A2 ground truth
// (hard_checks.edit_cost): a reference wall matches a produced wall when they are collinear within
// 1.5 in and overlap at least 80 percent of the shorter one; cost = unmatched reference walls +
// unmatched produced walls + openings whose kind differs or whose center is more than 2 in off,
// matched per wall.
import type { Vec } from '../model/types'

export type EvalOpening = { id?: string; kind: string; at: number; w: number }
export type EvalWall = { id: string; a: Vec; b: Vec; openings: EvalOpening[] }

export type EditCost = {
  cost: number
  unmatchedReference: string[]
  unmatchedProduced: string[]
  openings: { ref?: string; wall: string; problem: string }[]
  pairs: [string, string][]
}

const len = (w: EvalWall) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])

/** Collinear within tol and overlapping at least `share` of the shorter wall. */
export function wallsMatch(p: EvalWall, q: EvalWall, tol = 1.5, share = 0.8): boolean {
  const lp = len(p)
  const lq = len(q)
  if (lp < 1e-6 || lq < 1e-6) return false
  const u: Vec = [(p.b[0] - p.a[0]) / lp, (p.b[1] - p.a[1]) / lp]
  const off = (pt: Vec) => Math.abs((pt[0] - p.a[0]) * u[1] - (pt[1] - p.a[1]) * u[0])
  if (off(q.a) > tol || off(q.b) > tol) return false
  const s = (pt: Vec) => (pt[0] - p.a[0]) * u[0] + (pt[1] - p.a[1]) * u[1]
  const q0 = Math.min(s(q.a), s(q.b))
  const q1 = Math.max(s(q.a), s(q.b))
  const overlap = Math.min(lp, q1) - Math.max(0, q0)
  return overlap >= share * Math.min(lp, lq) - 1e-6
}

const centerOf = (w: EvalWall, o: EvalOpening): Vec => {
  const l = len(w)
  return [w.a[0] + ((w.b[0] - w.a[0]) / l) * o.at, w.a[1] + ((w.b[1] - w.a[1]) / l) * o.at]
}

export function editCost(produced: EvalWall[], reference: EvalWall[]): EditCost {
  const pairs: [string, string][] = []
  const refHit = new Set<string>()
  const prodHit = new Set<string>()
  for (const r of reference)
    for (const p of produced)
      if (wallsMatch(r, p) || wallsMatch(p, r)) {
        pairs.push([r.id, p.id])
        refHit.add(r.id)
        prodHit.add(p.id)
      }
  const openings: EditCost['openings'] = []
  // Openings: compare per group of matched walls (a reference wall may match several pieces).
  const usedProd = new Set<string>()
  for (const r of reference) {
    const mine = pairs.filter(([ri]) => ri === r.id).map(([, pi]) => produced.find((p) => p.id === pi)!)
    const cands = mine.flatMap((p) => p.openings.map((o, k) => ({ key: `${p.id}#${k}`, wall: p.id, o, c: centerOf(p, o) })))
    for (const ro of r.openings) {
      const rc = centerOf(r, ro)
      let best: (typeof cands)[number] | null = null
      let bestD = Infinity
      for (const c of cands) {
        if (usedProd.has(c.key)) continue
        const d = Math.hypot(c.c[0] - rc[0], c.c[1] - rc[1])
        if (d < bestD) {
          best = c
          bestD = d
        }
      }
      if (!best || bestD > Math.max(12, ro.w / 2)) {
        openings.push({ ref: ro.id, wall: r.id, problem: `missing ${ro.kind} ${ro.w}" at ${Math.round(ro.at)}` })
        continue
      }
      usedProd.add(best.key)
      if (best.o.kind !== ro.kind) openings.push({ ref: ro.id, wall: r.id, problem: `${ro.kind} read as ${best.o.kind}` })
      else if (bestD > 2) openings.push({ ref: ro.id, wall: r.id, problem: `${ro.kind} center ${bestD.toFixed(1)} in off` })
    }
  }
  for (const p of produced)
    p.openings.forEach((o, k) => {
      if (!usedProd.has(`${p.id}#${k}`)) openings.push({ wall: p.id, problem: `extra ${o.kind} ${Math.round(o.w)}" at ${Math.round(o.at)}` })
    })
  const unmatchedReference = reference.filter((r) => !refHit.has(r.id)).map((r) => r.id)
  const unmatchedProduced = produced.filter((p) => !prodHit.has(p.id)).map((p) => p.id)
  return { cost: unmatchedReference.length + unmatchedProduced.length + openings.length, unmatchedReference, unmatchedProduced, openings, pairs }
}
