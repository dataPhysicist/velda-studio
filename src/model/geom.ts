// Plane geometry in plan inches. Pure functions.
import type { Vec, Wall } from './types'

export const EPS = 1e-9

export const sub = (p: Vec, q: Vec): Vec => [p[0] - q[0], p[1] - q[1]]
export const add = (p: Vec, q: Vec): Vec => [p[0] + q[0], p[1] + q[1]]
export const mul = (p: Vec, k: number): Vec => [p[0] * k, p[1] * k]
export const dot = (p: Vec, q: Vec) => p[0] * q[0] + p[1] * q[1]
export const cross = (p: Vec, q: Vec) => p[0] * q[1] - p[1] * q[0]
export const len = (p: Vec) => Math.hypot(p[0], p[1])
export const dist = (p: Vec, q: Vec) => Math.hypot(p[0] - q[0], p[1] - q[1])
export const lerp = (p: Vec, q: Vec, t: number): Vec => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
export const r2 = (v: number) => Math.round(v * 100) / 100
export const rv = (p: Vec): Vec => [r2(p[0]), r2(p[1])]

export function wallLength(w: { a: Vec; b: Vec }) {
  return dist(w.a, w.b)
}

/** Unit vector from a to b. */
export function wallDir(w: { a: Vec; b: Vec }): Vec {
  const L = wallLength(w)
  return L < EPS ? [1, 0] : [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L]
}

/**
 * Unit normal pointing to the LEFT of a->b in the plan frame (x right, y down). With y down, "left"
 * of a direction (dx, dy) is (dy, -dx): for a wall running right (1, 0) the left side is up the
 * sheet (0, -1).
 */
export function wallLeft(w: { a: Vec; b: Vec }): Vec {
  const [dx, dy] = wallDir(w)
  return [dy, -dx]
}

/** Point along the centerline at distance s from a. */
export function pointAt(w: { a: Vec; b: Vec }, s: number): Vec {
  const d = wallDir(w)
  return [w.a[0] + d[0] * s, w.a[1] + d[1] * s]
}

/** Distance along the wall from a to the projection of p, and the signed offset to the left. */
export function project(w: { a: Vec; b: Vec }, p: Vec): { s: number; off: number } {
  const d = wallDir(w)
  const v = sub(p, w.a)
  return { s: dot(v, d), off: dot(v, [d[1], -d[0]]) }
}

/** Shortest distance from p to the segment a-b. */
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a)
  const L2 = dot(ab, ab)
  if (L2 < EPS) return dist(p, a)
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2))
  return dist(p, lerp(a, b, t))
}

export function isAxisAligned(w: { a: Vec; b: Vec }, tolDeg = 0.5): 'h' | 'v' | null {
  const [dx, dy] = wallDir(w)
  const tol = Math.sin((tolDeg * Math.PI) / 180)
  if (Math.abs(dy) <= tol) return 'h'
  if (Math.abs(dx) <= tol) return 'v'
  return null
}

/** Intersection of the infinite lines p + t r and q + u s, or null when parallel. */
export function lineIntersect(p: Vec, r: Vec, q: Vec, s: Vec): Vec | null {
  const den = cross(r, s)
  if (Math.abs(den) < 1e-12) return null
  const t = cross(sub(q, p), s) / den
  return [p[0] + r[0] * t, p[1] + r[1] * t]
}

/** Segment intersection, with parameters along each, or null. */
export function segmentIntersect(a0: Vec, a1: Vec, b0: Vec, b1: Vec): { p: Vec; t: number; u: number } | null {
  const r = sub(a1, a0)
  const s = sub(b1, b0)
  const den = cross(r, s)
  if (Math.abs(den) < 1e-12) return null
  const qp = sub(b0, a0)
  const t = cross(qp, s) / den
  const u = cross(qp, r) / den
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null
  return { p: [a0[0] + r[0] * t, a0[1] + r[1] * t], t, u }
}

export function pointInPolygon(p: Vec, poly: Vec[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Signed area (shoelace). In the plan frame (y down) a clockwise-on-screen loop is positive. */
export function signedArea(poly: Vec[]) {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

export const polygonArea = (poly: Vec[]) => Math.abs(signedArea(poly))

export function polygonBounds(poly: Vec[]) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of poly) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return { x0, y0, x1, y1 }
}

export function centroid(poly: Vec[]): Vec {
  const A = signedArea(poly)
  if (Math.abs(A) < EPS) {
    const n = poly.length || 1
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n]
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const f = a[0] * b[1] - b[0] * a[1]
    cx += (a[0] + b[0]) * f
    cy += (a[1] + b[1]) * f
  }
  return [cx / (6 * A), cy / (6 * A)]
}

/** Remove repeated and collinear vertices. */
export function simplifyPolygon(poly: Vec[], tol = 0.01): Vec[] {
  let pts = poly.filter((p, i) => dist(p, poly[(i + 1) % poly.length]) > tol)
  let changed = true
  while (changed && pts.length > 3) {
    changed = false
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length]
      const b = pts[i]
      const c = pts[(i + 1) % pts.length]
      if (Math.abs(cross(sub(b, a), sub(c, b))) <= tol * Math.max(1, dist(a, c))) {
        pts = pts.filter((_, k) => k !== i)
        changed = true
        break
      }
    }
  }
  return pts
}

/**
 * A point well inside a polygon (pole of inaccessibility, coarse grid search then refine). Labels go
 * here, not at the centroid, because an L-shaped room's centroid can sit outside the room.
 */
export function poleOfInaccessibility(poly: Vec[], precision = 1): Vec {
  const b = polygonBounds(poly)
  const edgeDist = (p: Vec) => {
    let m = Infinity
    for (let i = 0; i < poly.length; i++) m = Math.min(m, distToSegment(p, poly[i], poly[(i + 1) % poly.length]))
    return pointInPolygon(p, poly) ? m : -m
  }
  let best: Vec = centroid(poly)
  let bestD = edgeDist(best)
  let cell = Math.max(b.x1 - b.x0, b.y1 - b.y0) / 8
  let cx = (b.x0 + b.x1) / 2
  let cy = (b.y0 + b.y1) / 2
  let span = Math.max(b.x1 - b.x0, b.y1 - b.y0)
  while (cell >= precision) {
    for (let x = cx - span / 2; x <= cx + span / 2; x += cell)
      for (let y = cy - span / 2; y <= cy + span / 2; y += cell) {
        const d = edgeDist([x, y])
        if (d > bestD) {
          bestD = d
          best = [x, y]
        }
      }
    cx = best[0]
    cy = best[1]
    span = cell * 2
    cell /= 2
  }
  return rv(best)
}

/** Clip a polygon to the half-plane where dot(p - o, n) <= 0 (Sutherland-Hodgman against one line). */
export function clipHalfPlane(poly: Vec[], o: Vec, n: Vec): Vec[] {
  const out: Vec[] = []
  const side = (p: Vec) => dot(sub(p, o), n)
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const sa = side(a)
    const sb = side(b)
    if (sa <= 0) out.push(a)
    if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) out.push(lerp(a, b, sa / (sa - sb)))
  }
  return out
}

export type WallLike = Pick<Wall, 'a' | 'b' | 't'>
