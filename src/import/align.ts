// Multi-level alignment (05 section 3.10): find the translation that lays one sheet's exterior walls
// over the house's, by voting on the shifts that line up parallel exterior walls and scoring each by
// how much exterior wall length lands within 3 in. Axis-aligned shifts only; rotated sheets are rare
// for one firm's set and the Confirm screen asks for a click pair when the overlap is low.
import { wallLength } from '../model/geom'
import type { Vec, Wall } from '../model/types'

export type Alignment = { dx: number; dy: number; overlap: number; matchedLength: number; sheetLength: number }

const run = (w: Wall): 'h' | 'v' | null => (Math.abs(w.a[1] - w.b[1]) < 0.01 ? 'h' : Math.abs(w.a[0] - w.b[0]) < 0.01 ? 'v' : null)

/** Length of `w` (shifted) lying within tol of any of `targets` (same run, collinear within tol). */
function coveredLength(w: Wall, shift: Vec, targets: Wall[], tol: number): number {
  const r = run(w)
  if (!r) return 0
  const a: Vec = [w.a[0] + shift[0], w.a[1] + shift[1]]
  const b: Vec = [w.b[0] + shift[0], w.b[1] + shift[1]]
  const k = r === 'h' ? 0 : 1
  const cross = r === 'h' ? a[1] : a[0]
  const lo = Math.min(a[k], b[k])
  const hi = Math.max(a[k], b[k])
  const spans: [number, number][] = []
  for (const t of targets) {
    if (run(t) !== r) continue
    const tc = r === 'h' ? t.a[1] : t.a[0]
    if (Math.abs(tc - cross) > tol) continue
    const s0 = Math.max(lo, Math.min(t.a[k], t.b[k]))
    const s1 = Math.min(hi, Math.max(t.a[k], t.b[k]))
    if (s1 > s0) spans.push([s0, s1])
  }
  spans.sort((p, q) => p[0] - q[0])
  let total = 0
  let end = -Infinity
  for (const [s0, s1] of spans) {
    if (s1 <= end) continue
    total += s1 - Math.max(s0, end)
    end = s1
  }
  return total
}

export function alignExteriors(sheetWalls: Wall[], houseWalls: Wall[], tol = 3): Alignment {
  const sheet = sheetWalls.filter((w) => w.exterior && run(w))
  const house = houseWalls.filter((w) => w.exterior && run(w))
  const sheetLength = sheet.reduce((s, w) => s + wallLength(w), 0)
  // votes for dx from vertical pairs and dy from horizontal pairs, weighted by the shorter length
  const vote = (r: 'h' | 'v') => {
    const bins = new Map<number, number>()
    for (const s of sheet.filter((w) => run(w) === r))
      for (const h of house.filter((w) => run(w) === r)) {
        const d = r === 'v' ? h.a[0] - s.a[0] : h.a[1] - s.a[1]
        const key = Math.round(d)
        bins.set(key, (bins.get(key) ?? 0) + Math.min(wallLength(s), wallLength(h)))
      }
    return [...bins.entries()].sort((p, q) => q[1] - p[1]).slice(0, 6).map(([d]) => d)
  }
  const dxs = [0, ...vote('v')]
  const dys = [0, ...vote('h')]
  let best: Alignment = { dx: 0, dy: 0, overlap: 0, matchedLength: 0, sheetLength }
  for (const dx0 of dxs)
    for (const dy0 of dys) {
      // refine each candidate to the sub-inch shift that best lines the walls up
      for (const fx of [-1, -0.5, 0, 0.5, 1])
        for (const fy of [-1, -0.5, 0, 0.5, 1]) {
          const shift: Vec = [dx0 + fx, dy0 + fy]
          const m = sheet.reduce((s, w) => s + coveredLength(w, shift, house, tol), 0)
          if (m > best.matchedLength + 1e-6) best = { dx: shift[0], dy: shift[1], overlap: sheetLength ? m / sheetLength : 0, matchedLength: m, sheetLength }
        }
    }
  return best
}
