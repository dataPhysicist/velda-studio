// Plan drawing geometry, in plan inches: wall outlines, door and window symbols, room labels with
// areas, a room's clear dimensions with the provenance of the walls that set them, and the level's
// overall size. Pure; the plan, the import Confirm screen and exports use the same shapes.
import { pointInPolygon, poleOfInaccessibility, polygonArea, polygonBounds, wallLength } from '../model/geom'
import { type Badge, type Dimension, type Model, type Opening, type Room, type Vec, type Wall, badgeOf, weakestBadge } from '../model/types'
import { formatFeetInches } from '../model/units'

export const unit = (w: { a: Vec; b: Vec }): Vec => {
  const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1
  return [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L]
}
/** Left of a->b with y down the sheet. */
export const leftOf = (w: { a: Vec; b: Vec }): Vec => {
  const u = unit(w)
  return [u[1], -u[0]]
}
export const pointOn = (w: { a: Vec; b: Vec }, s: number): Vec => {
  const u = unit(w)
  return [w.a[0] + u[0] * s, w.a[1] + u[1] * s]
}
export const along = (w: { a: Vec; b: Vec }, p: Vec) => {
  const u = unit(w)
  return (p[0] - w.a[0]) * u[0] + (p[1] - w.a[1]) * u[1]
}
export const across = (w: { a: Vec; b: Vec }, p: Vec) => {
  const n = leftOf(w)
  return (p[0] - w.a[0]) * n[0] + (p[1] - w.a[1]) * n[1]
}
export const thick = (w: Wall) => w.tMeasured ?? w.t
export const pts = (p: Vec[]) => p.map((q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`).join(' ')

export function wallPoly(w: Wall): Vec[] {
  const n = leftOf(w)
  const h = thick(w) / 2
  return [
    [w.a[0] + n[0] * h, w.a[1] + n[1] * h],
    [w.b[0] + n[0] * h, w.b[1] + n[1] * h],
    [w.b[0] - n[0] * h, w.b[1] - n[1] * h],
    [w.a[0] - n[0] * h, w.a[1] - n[1] * h],
  ]
}

export type OpeningShape = {
  gap: Vec[] // the white cut through the wall
  lines: [Vec, Vec][] // leaf, glass lines, jambs, sliding leaves
  arc?: string // SVG path for a swing
  dashed?: [Vec, Vec][] // cased jambs
}

/** The plan symbol for an opening: doors with leaf and swing, windows as three lines, cased as dashed jambs. */
export function openingShape(o: Opening, w: Wall): OpeningShape {
  const t = thick(w) / 2 + 0.4
  const n = leftOf(w)
  const u = unit(w)
  const p0 = pointOn(w, o.at - o.w / 2)
  const p1 = pointOn(w, o.at + o.w / 2)
  const off = (p: Vec, k: number): Vec => [p[0] + n[0] * k, p[1] + n[1] * k]
  const gap = [off(p0, t), off(p1, t), off(p1, -t), off(p0, -t)]
  if (o.kind === 'window') {
    const k = thick(w) / 2
    return { gap, lines: [-k * 0.55, 0, k * 0.55].map((d) => [off(p0, d), off(p1, d)] as [Vec, Vec]) }
  }
  if (o.kind === 'opening' || o.style === 'cased') return { gap, lines: [], dashed: [[off(p0, t), off(p0, -t)], [off(p1, t), off(p1, -t)]] }
  if (o.style === 'sliding' || o.style === 'pocket' || o.style === 'barn') {
    const k = thick(w) * 0.18
    const mid = pointOn(w, o.at)
    const lines: [Vec, Vec][] =
      o.style === 'pocket'
        ? [[off(p0, 0), off(mid, 0)]]
        : [
            [off(p0, k), off(pointOn(w, o.at + o.w * 0.05), k)],
            [off(pointOn(w, o.at - o.w * 0.05), -k), off(p1, -k)],
          ]
    return { gap, lines }
  }
  const side = o.swing?.side === 'right' ? -1 : 1
  if (o.style === 'french' || (o.swing && o.w >= 60 && o.style !== 'swing')) {
    // a pair: two leaves from both jambs, meeting in the middle
    const half = o.w / 2
    const f0 = off(p0, side * (t - 0.4))
    const f1 = off(p1, side * (t - 0.4))
    const e0: Vec = [f0[0] + n[0] * side * half, f0[1] + n[1] * side * half]
    const e1: Vec = [f1[0] + n[0] * side * half, f1[1] + n[1] * side * half]
    const midF = off(pointOn(w, o.at), side * (t - 0.4))
    const sw = side > 0 ? 0 : 1
    return {
      gap,
      lines: [
        [f0, e0],
        [f1, e1],
      ],
      arc: `M ${e0[0]} ${e0[1]} A ${half} ${half} 0 0 ${sw} ${midF[0]} ${midF[1]} M ${e1[0]} ${e1[1]} A ${half} ${half} 0 0 ${1 - sw} ${midF[0]} ${midF[1]}`,
    }
  }
  const hingeA = (o.swing?.hinge ?? 'a') === 'a'
  const hinge = hingeA ? p0 : p1
  const toward: Vec = hingeA ? u : [-u[0], -u[1]]
  const face = off(hinge, side * (t - 0.4))
  const leafEnd: Vec = [face[0] + n[0] * side * o.w, face[1] + n[1] * side * o.w]
  const jamb: Vec = [face[0] + toward[0] * o.w, face[1] + toward[1] * o.w]
  const cross = side * (toward[0] * n[1] - toward[1] * n[0])
  return { gap, lines: [[face, leafEnd]], arc: `M ${leafEnd[0]} ${leafEnd[1]} A ${o.w} ${o.w} 0 0 ${cross > 0 ? 0 : 1} ${jamb[0]} ${jamb[1]}` }
}

export function roomLabel(r: Room): { at: Vec; name: string; area: string } {
  const at = r.polygon.length >= 3 ? poleOfInaccessibility(r.polygon, 2) : (r.labelAt ?? [0, 0])
  return { at, name: r.name, area: `${Math.round(polygonArea(r.polygon) / 144)} sf` }
}

const prov2badge = (w: Wall | undefined): Badge => (w ? weakestBadge([badgeOf(w.prov.a), badgeOf(w.prov.b)]) : 'assumed')

/** The wall a room edge runs along (a face within half its thickness plus an inch). */
function wallAlong(m: Model, level: string, p: Vec, q: Vec): Wall | undefined {
  const mid: Vec = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  const ux = q[0] - p[0]
  const uy = q[1] - p[1]
  const L = Math.hypot(ux, uy) || 1
  let best: { w: Wall; d: number } | undefined
  for (const w of m.walls) {
    if (w.level !== level) continue
    const wu = unit(w)
    if (Math.abs(wu[0] * uy / L - wu[1] * ux / L) > 0.05) continue
    const s = along(w, mid)
    if (s < -1 || s > wallLength(w) + 1) continue
    const d = Math.abs(Math.abs(across(w, mid)) - thick(w) / 2)
    if (d <= 1.5 && (!best || d < best.d)) best = { w, d }
  }
  return best?.w
}

export type ClearDim = { a: Vec; b: Vec; length: number; text: string; badge: Badge; at: Vec; vertical: boolean }

/**
 * A room's clear dimensions, one per side: the length of each edge of its interior polygon, set by
 * the two walls at the edge's ends (the weakest of their badges is the dimension's badge).
 */
export function roomClearDims(m: Model, r: Room): ClearDim[] {
  const poly = r.polygon
  const out: ClearDim[] = []
  if (poly.length < 3) return out
  const c = poleOfInaccessibility(poly, 2)
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (len < 30) continue // jogs and returns read as clutter; the panel lists the room's main sides
    const prev = poly[(i - 1 + poly.length) % poly.length]
    const next = poly[(i + 2) % poly.length]
    const wa = wallAlong(m, r.level, prev, p)
    const wb = wallAlong(m, r.level, q, next)
    const badge = weakestBadge([prov2badge(wa), prov2badge(wb)])
    // place the text just inside the edge
    const mid: Vec = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    const nx = -(q[1] - p[1]) / len
    const ny = (q[0] - p[0]) / len
    const inward = (c[0] - mid[0]) * nx + (c[1] - mid[1]) * ny > 0 ? 1 : -1
    const at: Vec = [mid[0] + nx * inward * 9, mid[1] + ny * inward * 9]
    out.push({ a: p, b: q, length: len, text: formatFeetInches(len), badge, at, vertical: Math.abs(q[1] - p[1]) > Math.abs(q[0] - p[0]) })
  }
  return out
}

/** The level's overall size from its exterior walls' outer faces. */
export function levelOverall(m: Model, level: string): { x0: number; y0: number; x1: number; y1: number } | null {
  const ext = m.walls.filter((w) => w.level === level && w.exterior)
  const walls = ext.length ? ext : m.walls.filter((w) => w.level === level)
  if (!walls.length) return null
  const pts = walls.flatMap((w) => wallPoly(w))
  const b = polygonBounds(pts)
  return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }
}

/** Badge for a dimension on the plan: conflict wins; otherwise the walls it binds to. */
export function dimBadge(m: Model, d: Dimension): Badge | 'conflict' {
  if (d.status === 'conflict') return 'conflict'
  if (d.source === 'user' || d.source === 'field') return 'measured'
  if (d.source === 'sheet') return d.status === 'ok' ? 'measured' : 'assumed'
  return 'assumed'
}

export function roomAt(m: Model, level: string, p: Vec): Room | undefined {
  return m.rooms.find((r) => r.level === level && r.polygon.length >= 3 && pointInPolygon(p, r.polygon))
}
