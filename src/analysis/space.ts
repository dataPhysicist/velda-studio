// Clear-space geometry for the checker: the solid lines a person bumps into on a level (wall faces
// with door and passage gaps cut out, fixture footprints) and rays cast against them. Plan inches.
import { pointInPolygon, wallLength } from '../model/geom'
import type { Item, Model, Opening, Room, Vec, Wall } from '../model/types'

export type Seg = { a: Vec; b: Vec; kind: 'wall' | 'item'; id: string }

const add = (p: Vec, q: Vec): Vec => [p[0] + q[0], p[1] + q[1]]
const mul = (p: Vec, k: number): Vec => [p[0] * k, p[1] * k]

/** An item's frame: center, front direction (rot 0 faces +y), side direction (along its width). */
export function frameOf(it: Item) {
  const r = (it.rot * Math.PI) / 180
  const f: Vec = [Math.sin(r), Math.cos(r)]
  const s: Vec = [Math.cos(r), -Math.sin(r)]
  const c: Vec = [it.x, it.y]
  return { c, f, s }
}

/** Footprint corners: back-left, back-right, front-right, front-left (seen from the front). */
export function footprint(it: Item): Vec[] {
  const { c, f, s } = frameOf(it)
  const hw = it.w / 2
  const hd = it.d / 2
  return [add(add(c, mul(s, -hw)), mul(f, -hd)), add(add(c, mul(s, hw)), mul(f, -hd)), add(add(c, mul(s, hw)), mul(f, hd)), add(add(c, mul(s, -hw)), mul(f, hd))]
}

/** Things that take up floor space: not rugs, plants or lamps, and not wall cabinets or hoods above head height. */
export const onFloor = (it: Item) => !['rug', 'plant', 'lamp', 'mirror', 'beam', 'hood', 'wall_cabinet', 'closet_rod', 'shelf'].includes(it.kind) && (it.z ?? 0) < 40 && it.h >= 12

const unit = (w: Wall): Vec => {
  const L = wallLength(w) || 1
  return [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L]
}

/** Spans along a wall you can walk through: doors and open passages (not windows). */
export function walkGaps(m: Model, w: Wall): [number, number][] {
  return m.openings
    .filter((o) => o.wall === w.id && o.kind !== 'window')
    .map((o) => [o.at - o.w / 2, o.at + o.w / 2] as [number, number])
    .sort((p, q) => p[0] - q[0])
}

/** Solid lines on a level: both faces of each wall minus walkable gaps, and fixture outlines. */
export function obstacles(m: Model, level: string, opts: { skipItems?: Set<string>; itemsToo?: boolean } = {}): Seg[] {
  const segs: Seg[] = []
  for (const w of m.walls) {
    if (w.level !== level || w.kind === 'rail') continue
    const L = wallLength(w)
    if (L < 0.5) continue
    const u = unit(w)
    const n: Vec = [u[1], -u[0]]
    const half = w.t / 2
    let s = 0
    const push = (from: number, to: number) => {
      if (to - from < 0.25) return
      for (const k of [half, -half]) {
        const a: Vec = [w.a[0] + u[0] * from + n[0] * k, w.a[1] + u[1] * from + n[1] * k]
        const b: Vec = [w.a[0] + u[0] * to + n[0] * k, w.a[1] + u[1] * to + n[1] * k]
        segs.push({ a, b, kind: 'wall', id: w.id })
      }
    }
    for (const [g0, g1] of walkGaps(m, w)) {
      push(s, Math.max(s, g0))
      s = Math.max(s, g1)
    }
    push(s, L)
  }
  if (opts.itemsToo !== false)
    for (const it of m.items) {
      if (it.level !== level || !onFloor(it) || opts.skipItems?.has(it.id)) continue
      const p = footprint(it)
      for (let i = 0; i < 4; i++) segs.push({ a: p[i], b: p[(i + 1) % 4], kind: 'item', id: it.id })
    }
  return segs
}

/** Distance from `o` along unit `d` to the first solid line (or `max`). */
export function ray(o: Vec, d: Vec, segs: Seg[], max = 1200): { dist: number; seg: Seg | null } {
  let best = max
  let hit: Seg | null = null
  for (const s of segs) {
    const ex = s.b[0] - s.a[0]
    const ey = s.b[1] - s.a[1]
    const den = d[0] * ey - d[1] * ex
    if (Math.abs(den) < 1e-9) continue
    const qx = s.a[0] - o[0]
    const qy = s.a[1] - o[1]
    const t = (qx * ey - qy * ex) / den
    const u = (qx * d[1] - qy * d[0]) / den
    if (t > 1e-6 && t < best && u >= -1e-6 && u <= 1 + 1e-6) {
      best = t
      hit = s
    }
  }
  return { dist: best, seg: hit }
}

/** The smallest of several parallel rays from points along an edge (clear space in front of it). */
export function clearAlong(points: Vec[], d: Vec, segs: Seg[]) {
  let best = { dist: Infinity, seg: null as Seg | null }
  for (const p of points) {
    const r = ray(p, d, segs)
    if (r.dist < best.dist) best = r
  }
  return best
}

export function roomOf(m: Model, level: string, p: Vec): Room | undefined {
  return m.rooms.find((r) => r.level === level && r.polygon.length >= 3 && pointInPolygon(p, r.polygon))
}

/** Where an opening is: its center point on the wall, the wall, and its unit direction and left normal. */
export function openingFrame(m: Model, o: Opening) {
  const w = m.walls.find((x) => x.id === o.wall)
  if (!w) return null
  const u = unit(w)
  const n: Vec = [u[1], -u[0]]
  const c: Vec = [w.a[0] + u[0] * o.at, w.a[1] + u[1] * o.at]
  return { w, u, n, c }
}

/** The rooms on each side of an opening (left of the wall's a to b, then right). */
export function roomsAcross(m: Model, o: Opening): [Room | undefined, Room | undefined] {
  const f = openingFrame(m, o)
  if (!f) return [undefined, undefined]
  const k = f.w.t / 2 + 12
  return [roomOf(m, f.w.level, [f.c[0] + f.n[0] * k, f.c[1] + f.n[1] * k]), roomOf(m, f.w.level, [f.c[0] - f.n[0] * k, f.c[1] - f.n[1] * k])]
}

/** A door leaf's swept quarter circle as a polygon (hinge, leaf open 90 degrees, arc back to the jamb). */
export function swingArea(m: Model, o: Opening, steps = 8): Vec[] | null {
  const f = openingFrame(m, o)
  if (!f || o.kind !== 'door' || !o.swing || !['swing', 'french'].includes(o.style)) return null
  const side = o.swing.side === 'left' ? 1 : -1
  const face = (p: Vec): Vec => [p[0] + f.n[0] * side * (f.w.t / 2), p[1] + f.n[1] * side * (f.w.t / 2)]
  const leaves: { hinge: Vec; toward: Vec; r: number }[] =
    o.style === 'french'
      ? [
          { hinge: face(add(f.c, mul(f.u, -o.w / 2))), toward: f.u, r: o.w / 2 },
          { hinge: face(add(f.c, mul(f.u, o.w / 2))), toward: mul(f.u, -1), r: o.w / 2 },
        ]
      : [o.swing.hinge === 'a' ? { hinge: face(add(f.c, mul(f.u, -o.w / 2))), toward: f.u, r: o.w } : { hinge: face(add(f.c, mul(f.u, o.w / 2))), toward: mul(f.u, -1), r: o.w }]
  // One polygon covering the leaves (a pair is two quarter circles meeting in the middle).
  const pts: Vec[] = []
  for (const l of leaves) {
    const out: Vec = mul(f.n, side)
    pts.push(l.hinge)
    for (let i = 0; i <= steps; i++) {
      const a = (Math.PI / 2) * (i / steps)
      const dir: Vec = [l.toward[0] * Math.cos(a) + out[0] * Math.sin(a), l.toward[1] * Math.cos(a) + out[1] * Math.sin(a)]
      pts.push(add(l.hinge, mul(dir, l.r)))
    }
  }
  return pts
}

/** Do two polygons overlap (any vertex inside the other, or edges crossing)? */
export function overlaps(p: Vec[], q: Vec[]): boolean {
  if (p.some((v) => pointInPolygon(v, q)) || q.some((v) => pointInPolygon(v, p))) return true
  for (let i = 0; i < p.length; i++)
    for (let j = 0; j < q.length; j++) if (crosses(p[i], p[(i + 1) % p.length], q[j], q[(j + 1) % q.length])) return true
  return false
}

function crosses(a: Vec, b: Vec, c: Vec, d: Vec) {
  const o = (p: Vec, q: Vec, r: Vec) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
}

/** Shrink a polygon toward its center a little, so touching shapes do not count as overlapping. */
export function shrink(p: Vec[], by = 0.5): Vec[] {
  const c = p.reduce<Vec>((s, v) => [s[0] + v[0] / p.length, s[1] + v[1] / p.length], [0, 0])
  return p.map((v) => {
    const d = Math.hypot(v[0] - c[0], v[1] - c[1]) || 1
    return [v[0] - ((v[0] - c[0]) / d) * by, v[1] - ((v[1] - c[1]) / d) * by]
  })
}
