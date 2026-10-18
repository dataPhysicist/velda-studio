// Things computed from the walls: joints (corners and tees), healed wall ends, rooms as the faces of
// the wall network, exterior walls, dimension status and anchored items. Pure functions on Model.
// Spec: 04-scene-model-v2 "Rules the code must enforce".
import {
  EPS,
  add,
  centroid,
  clipHalfPlane,
  cross,
  dist,
  distToSegment,
  dot,
  lineIntersect,
  mul,
  pointAt,
  pointInPolygon,
  poleOfInaccessibility,
  polygonArea,
  project,
  rv,
  signedArea,
  simplifyPolygon,
  sub,
  wallDir,
  wallLeft,
  wallLength,
} from './geom'
import type { Dimension, Model, Room, RoomFlag, Vec, Wall } from './types'

/** Ends within this distance are one corner; an end this close to another wall's centerline is a tee. */
export const JOINT_TOL = 0.5

export type End = { wall: string; end: 'a' | 'b' }
export type Corner = { at: Vec; ends: End[] }
export type Tee = { host: string; s: number; end: End } // s: distance along the host from its a end

export function endPoint(w: Wall, e: 'a' | 'b'): Vec {
  return e === 'a' ? w.a : w.b
}

/** Corners (ends that meet) and tees (an end on another wall's body) for the walls of one level. */
export function findJoints(walls: Wall[], tol = JOINT_TOL): { corners: Corner[]; tees: Tee[] } {
  const ends: (End & { p: Vec })[] = []
  for (const w of walls) for (const e of ['a', 'b'] as const) ends.push({ wall: w.id, end: e, p: endPoint(w, e) })
  // Union-find over ends closer than tol.
  const parent = ends.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < ends.length; i++)
    for (let j = i + 1; j < ends.length; j++) if (ends[i].wall !== ends[j].wall && dist(ends[i].p, ends[j].p) <= tol) parent[find(i)] = find(j)
  const groups = new Map<number, (End & { p: Vec })[]>()
  ends.forEach((e, i) => {
    const r = find(i)
    groups.set(r, [...(groups.get(r) ?? []), e])
  })
  const corners: Corner[] = []
  for (const g of groups.values()) {
    if (g.length < 2) continue
    const at: Vec = [g.reduce((s, e) => s + e.p[0], 0) / g.length, g.reduce((s, e) => s + e.p[1], 0) / g.length]
    corners.push({ at, ends: g.map(({ wall, end }) => ({ wall, end })) })
  }
  const tees: Tee[] = []
  for (const e of ends)
    for (const h of walls) {
      if (h.id === e.wall) continue
      const L = wallLength(h)
      const { s, off } = project(h, e.p)
      if (Math.abs(off) <= tol && s > tol && s < L - tol) tees.push({ host: h.id, s, end: { wall: e.wall, end: e.end } })
    }
  return { corners, tees }
}

const sameLevel = (m: Model, level: string) => m.walls.filter((w) => w.level === level)
const angleBetween = (u: Vec, v: Vec) => Math.abs(cross(u, v)) // sin of the angle between unit vectors

/**
 * Close small gaps the way a drafter would: two ends that nearly meet at a corner are moved to the
 * crossing of their centerlines, and an end that stops at another wall's face is extended to that
 * wall's centerline. Only gaps within about half a wall thickness plus 1.5 in are closed. Returns new
 * wall objects for the walls that changed; the rest are returned as they were.
 */
export function healWalls(walls: Wall[]): { walls: Wall[]; moved: string[] } {
  const out = walls.map((w) => ({ ...w, a: [...w.a] as Vec, b: [...w.b] as Vec }))
  const moved = new Set<string>()
  const near = (p: Vec, q: Vec) => dist(p, q) <= JOINT_TOL
  // Straight runs traced as two pieces a little off line (1 in jogs): put the shorter piece on the
  // longer piece's line, so the run is one straight line again.
  const byLength = [...out].sort((p, q) => wallLength(q) - wallLength(p))
  for (const long of byLength)
    for (const short of out) {
      if (short === long || short.level !== long.level || short.kind !== 'wall' || long.kind !== 'wall') continue
      if (wallLength(short) > wallLength(long) || angleBetween(wallDir(short), wallDir(long)) > 0.017) continue
      const endToEnd = (['a', 'b'] as const).some((e) => (['a', 'b'] as const).some((f) => dist(endPoint(short, e), endPoint(long, f)) <= 3.5))
      if (!endToEnd) continue
      const mid = project(long, mul(add(short.a, short.b), 0.5)).s
      if (mid > 0 && mid < wallLength(long)) continue // side by side, not a continuation
      const off = project(long, short.a).off
      const off2 = project(long, short.b).off
      if (Math.abs(off) < 1e-6 && Math.abs(off2) < 1e-6) continue
      if (Math.abs(off) > 1.5 || Math.abs(off2) > 1.5) continue
      const left = wallLeft(long)
      short.a = rv(sub(short.a, mul(left, off)))
      short.b = rv(sub(short.b, mul(left, off2)))
      moved.add(short.id)
    }
  const touches = (p: Vec, self: Wall) =>
    out.some((o) => o.id !== self.id && o.level === self.level && o.kind === 'wall' && (near(p, o.a) || near(p, o.b) || distToSegment(p, o.a, o.b) <= JOINT_TOL))
  // Corners: pairs of loose ends whose lines cross close to both.
  for (const w of out)
    for (const e of ['a', 'b'] as const) {
      const p = endPoint(w, e)
      if (touches(p, w)) continue
      let best: { o: Wall; oe: 'a' | 'b'; x: Vec; d: number } | null = null
      for (const o of out) {
        if (o.id === w.id || o.level !== w.level || o.kind !== 'wall') continue
        if (angleBetween(wallDir(w), wallDir(o)) < 0.17) continue // within 10 degrees: not a corner
        for (const oe of ['a', 'b'] as const) {
          const q = endPoint(o, oe)
          const x = lineIntersect(w.a, wallDir(w), o.a, wallDir(o))
          if (!x) continue
          if (touches(q, o) && !near(q, p)) {
            // q already meets other walls: only extend o past q (those walls then tee into o), never trim it.
            const outward = oe === 'b' ? wallDir(o) : mul(wallDir(o), -1)
            if (dot(sub(x, q), outward) <= 1e-6) continue
          }
          const dw = dist(x, p)
          const dq = dist(x, q)
          if (dw <= o.t / 2 + 1.5 && dq <= w.t / 2 + 1.5 && (!best || dw + dq < best.d)) best = { o, oe, x, d: dw + dq }
        }
      }
      if (best && best.d > 1e-6) {
        const x = rv(best.x)
        if (e === 'a') w.a = x
        else w.b = x
        if (best.oe === 'a') best.o.a = x
        else best.o.b = x
        moved.add(w.id)
        moved.add(best.o.id)
      }
    }
  // Tees: an end short of (or just past) another wall's centerline.
  for (const w of out)
    for (const e of ['a', 'b'] as const) {
      const p = endPoint(w, e)
      if (touches(p, w)) continue
      const d = wallDir(w)
      const outward: Vec = e === 'b' ? d : mul(d, -1)
      let best: { x: Vec; k: number } | null = null
      for (const h of out) {
        if (h.id === w.id || h.level !== w.level || h.kind !== 'wall') continue
        if (angleBetween(d, wallDir(h)) < 0.17) continue
        const x = lineIntersect(p, outward, h.a, wallDir(h))
        if (!x) continue
        const k = dot(sub(x, p), outward) // + extends, - trims
        const { s } = project(h, x)
        if (s < -JOINT_TOL || s > wallLength(h) + JOINT_TOL) continue
        if (Math.abs(k) <= h.t / 2 + 1.5 && (!best || Math.abs(k) < Math.abs(best.k))) best = { x, k }
      }
      if (best && Math.abs(best.k) > 1e-6) {
        const x = rv(best.x)
        if (e === 'a') w.a = x
        else w.b = x
        moved.add(w.id)
      }
    }
  return { walls: out, moved: [...moved] }
}

// ------------------------------------------------------------------------------------------ moving walls

export type MoveResult = { model: Model; ok: true; moved: string[] } | { model: Model; ok: false; reason: string }

/**
 * Move a wall along its normal by `delta` inches (positive = toward the left of a->b). Corner
 * neighbors keep their direction and stretch to meet it; walls tee'd into it follow; if its own end is
 * tee'd onto another wall, that end slides along the host. A straight continuation (collinear corner
 * with nothing else at the joint) gets a short connecting wall so the plan stays closed. Openings and
 * anchored items stay where they are in the plan. Refuses when an opening would no longer fit.
 */
export function moveWall(input: Model, wallId: string, delta: number, prov: Wall['prov']['a']): MoveResult {
  const m: Model = structuredClone(input)
  const w = m.walls.find((x) => x.id === wallId)
  if (!w) return { model: input, ok: false, reason: `no wall ${wallId}` }
  if (Math.abs(delta) < 1e-6) return { model: input, ok: true, moved: [] }
  const level = sameLevel(m, w.level)
  const { corners, tees } = findJoints(level)
  const n = wallLeft(w)
  const off = mul(n, delta)
  const newA = add(w.a, off)
  const newB = add(w.b, off)
  const d = wallDir(w)
  const touched = new Set<string>([w.id])
  const lengthsBefore = new Map(level.map((x) => [x.id, wallLength(x)]))
  const shiftAt = new Map<string, number>() // wall id -> how far its a end moved along its own direction

  const setEnd = (o: Wall, e: 'a' | 'b', p: Vec) => {
    const old = endPoint(o, e)
    if (e === 'a') {
      shiftAt.set(o.id, (shiftAt.get(o.id) ?? 0) + dot(sub(p, old), wallDir(o)))
      o.a = rv(p)
    } else o.b = rv(p)
    o.prov[e] = prov
    touched.add(o.id)
  }

  // The moved wall's own ends: corner partners stretch along their own lines; tees slide on hosts.
  const jogs: Wall[] = []
  for (const e of ['a', 'b'] as const) {
    const oldP = endPoint(w, e)
    const newP = e === 'a' ? newA : newB
    const corner = corners.find((c) => c.ends.some((x) => x.wall === w.id && x.end === e))
    const host = tees.find((t) => t.end.wall === w.id && t.end.end === e)
    let target = newP
    if (host) {
      const h = level.find((x) => x.id === host.host)!
      const x = lineIntersect(newP, d, h.a, wallDir(h))
      if (x) target = x
    }
    for (const pe of corner?.ends ?? []) {
      if (pe.wall === w.id) continue
      const o = level.find((x) => x.id === pe.wall)!
      const od = wallDir(o)
      if (angleBetween(d, od) < 0.17) {
        // Straight continuation: keep it, add a short wall from its end to ours (unless a host bridges).
        if (!host) {
          jogs.push({
            ...structuredClone(w),
            id: `${w.id}j${e}`,
            a: rv(oldP),
            b: rv(target),
            prov: { a: prov, b: prov, t: w.prov.t },
          })
        }
        continue
      }
      const x = lineIntersect(newP, d, o.a, od)
      if (x) setEnd(o, pe.end, x)
    }
    if (e === 'a') w.a = rv(target)
    else w.b = rv(target)
    w.prov[e] = prov
  }
  // Walls tee'd into the moved wall follow it along their own lines.
  for (const t of tees) {
    if (t.host !== w.id) continue
    const o = level.find((x) => x.id === t.end.wall)!
    if (touched.has(o.id) && o.id === w.id) continue
    const x = lineIntersect(newA, d, o.a, wallDir(o))
    if (x) setEnd(o, t.end.end, x)
  }
  for (const j of jogs) if (wallLength(j) > 0.25 && !m.walls.some((x) => x.id === j.id)) m.walls.push(j)

  // Keep openings and anchored items where they were in the plan; refuse if an opening no longer fits.
  for (const id of touched) {
    const o = m.walls.find((x) => x.id === id)!
    const shift = shiftAt.get(id) ?? 0
    const L = wallLength(o)
    for (const op of m.openings) {
      if (op.wall !== id) continue
      op.at -= shift
      if (op.at - op.w / 2 < -0.01 || op.at + op.w / 2 > L + 0.01) {
        const before = lengthsBefore.get(id) ?? L
        return {
          model: input,
          ok: false,
          reason: `the ${op.kind} ${op.id} on wall ${id} would no longer fit (wall ${before.toFixed(1)} in to ${L.toFixed(1)} in)`,
        }
      }
    }
    for (const it of m.items) if (it.anchor?.wall === id) it.anchor.at -= shift
  }
  placeAnchoredItems(m)
  return { model: m, ok: true, moved: [...touched, ...jogs.map((j) => j.id)] }
}

/** Items glued to a wall recompute their position and rotation from the wall. */
export function placeAnchoredItems(m: Model) {
  for (const it of m.items) {
    if (!it.anchor) continue
    const w = m.walls.find((x) => x.id === it.anchor!.wall)
    if (!w) {
      delete it.anchor
      continue
    }
    const c = pointAt(w, it.anchor.at)
    const left = wallLeft(w)
    const side = it.anchor.side === 'left' ? left : mul(left, -1)
    const p = add(c, mul(side, w.t / 2 + it.d / 2))
    it.x = Math.round(p[0] * 100) / 100
    it.y = Math.round(p[1] * 100) / 100
    // rot 0 faces +y; the item faces away from the wall, along `side`.
    it.rot = Math.round(((Math.atan2(side[0], side[1]) * 180) / Math.PI) * 100) / 100
  }
}

// ------------------------------------------------------------------------------------------ rooms

type HalfEdge = { from: number; to: number; wall: string; t: number; ang: number; twin: number; face: number }

/** Faces of the centerline network of one level's walls (kind 'wall' only; glass, half walls and rails do not split rooms). */
export function wallFaces(walls: Wall[], removed: Set<string> = new Set()): {
  faces: { nodes: number[]; edges: number[]; area: number }[]
  he: HalfEdge[]
  nodes: Vec[]
} {
  const { walls: healed } = healWalls(walls.filter((w) => w.kind === 'wall'))
  const segs = healed.filter((w) => wallLength(w) > 0.25)
  // Split every wall where another wall's end touches its body or where two walls cross.
  const cuts = new Map<string, number[]>(segs.map((w) => [w.id, [0, wallLength(w)]]))
  for (const w of segs) {
    const L = wallLength(w)
    for (const o of segs) {
      if (o.id === w.id) continue
      for (const p of [o.a, o.b]) {
        const { s, off } = project(w, p)
        if (Math.abs(off) <= 0.6 && s > 0.3 && s < L - 0.3) cuts.get(w.id)!.push(s)
      }
      const x = segX(w, o)
      if (x !== null && x > 0.3 && x < L - 0.3) cuts.get(w.id)!.push(x)
    }
  }
  const nodes: Vec[] = []
  const nodeAt = (p: Vec) => {
    for (let i = 0; i < nodes.length; i++) if (dist(nodes[i], p) <= 0.6) return i
    nodes.push(p)
    return nodes.length - 1
  }
  const edgeMap = new Map<string, { u: number; v: number; wall: string; t: number }>()
  for (const w of segs) {
    const list = [...new Set(cuts.get(w.id)!.map((s) => Math.round(s * 100) / 100))].sort((p, q) => p - q)
    for (let i = 0; i + 1 < list.length; i++) {
      const u = nodeAt(pointAt(w, list[i]))
      const v = nodeAt(pointAt(w, list[i + 1]))
      if (u === v) continue
      const key = u < v ? `${u}-${v}` : `${v}-${u}`
      const prev = edgeMap.get(key)
      if (!prev || w.t > prev.t) edgeMap.set(key, { u, v, wall: w.id, t: w.t })
    }
  }
  let edges = [...edgeMap.values()].filter((e) => !removed.has(e.wall) && !removed.has(`${e.wall}@${Math.min(e.u, e.v)}-${Math.max(e.u, e.v)}`))
  // Prune dangling edges: they do not bound a room.
  for (;;) {
    const deg = new Map<number, number>()
    for (const e of edges) {
      deg.set(e.u, (deg.get(e.u) ?? 0) + 1)
      deg.set(e.v, (deg.get(e.v) ?? 0) + 1)
    }
    const keep = edges.filter((e) => (deg.get(e.u) ?? 0) > 1 && (deg.get(e.v) ?? 0) > 1)
    if (keep.length === edges.length) break
    edges = keep
  }
  const he: HalfEdge[] = []
  for (const e of edges) {
    const i = he.length
    const pu = nodes[e.u]
    const pv = nodes[e.v]
    he.push({ from: e.u, to: e.v, wall: e.wall, t: e.t, ang: Math.atan2(pv[1] - pu[1], pv[0] - pu[0]), twin: i + 1, face: -1 })
    he.push({ from: e.v, to: e.u, wall: e.wall, t: e.t, ang: Math.atan2(pu[1] - pv[1], pu[0] - pv[0]), twin: i, face: -1 })
  }
  const outgoing = new Map<number, number[]>()
  he.forEach((h, i) => outgoing.set(h.from, [...(outgoing.get(h.from) ?? []), i]))
  for (const list of outgoing.values()) list.sort((p, q) => he[p].ang - he[q].ang)
  const next = (i: number) => {
    // Arriving at v along i, leave by the edge just before the reverse edge in angular order: this
    // walks each face keeping it on the same side.
    const list = outgoing.get(he[i].to)!
    const k = list.indexOf(he[i].twin)
    return list[(k - 1 + list.length) % list.length]
  }
  const faces: { nodes: number[]; edges: number[]; area: number }[] = []
  for (let i = 0; i < he.length; i++) {
    if (he[i].face >= 0) continue
    const loop: number[] = []
    let j = i
    let guard = 0
    while (he[j].face < 0 && guard++ < 10000) {
      he[j].face = faces.length
      loop.push(j)
      j = next(j)
    }
    const pts = loop.map((k) => nodes[he[k].from])
    faces.push({ nodes: loop.map((k) => he[k].from), edges: loop, area: signedArea(pts) })
  }
  return { faces, he, nodes }
}

function segX(w: Wall, o: Wall): number | null {
  const r = sub(w.b, w.a)
  const s = sub(o.b, o.a)
  const den = cross(r, s)
  if (Math.abs(den) < 1e-9) return null
  const qp = sub(o.a, w.a)
  const t = cross(qp, s) / den
  const u = cross(qp, r) / den
  if (t < 0 || t > 1 || u < -0.002 || u > 1.002) return null
  return t * wallLength(w)
}

/** Interior polygon of a face: each centerline edge moved inward by half its wall's thickness. */
function insetFace(nodes: Vec[], he: HalfEdge[], loop: number[], inwardSign: number): Vec[] {
  // Merge consecutive collinear edges of equal thickness first.
  type E = { p: Vec; q: Vec; t: number }
  const es: E[] = []
  for (const k of loop) {
    const e = { p: nodes[he[k].from], q: nodes[he[k].to], t: he[k].t }
    const last = es[es.length - 1]
    if (last && Math.abs(last.t - e.t) < 1e-6 && Math.abs(cross(unit(sub(last.q, last.p)), unit(sub(e.q, e.p)))) < 1e-4 && dot(sub(last.q, last.p), sub(e.q, e.p)) > 0) last.q = e.q
    else es.push(e)
  }
  if (es.length > 1) {
    const f = es[0]
    const l = es[es.length - 1]
    if (Math.abs(l.t - f.t) < 1e-6 && Math.abs(cross(unit(sub(l.q, l.p)), unit(sub(f.q, f.p)))) < 1e-4 && dot(sub(l.q, l.p), sub(f.q, f.p)) > 0) {
      f.p = l.p
      es.pop()
    }
  }
  const lines = es.map((e) => {
    const dir = unit(sub(e.q, e.p))
    const nrm: Vec = [dir[1] * inwardSign, -dir[0] * inwardSign]
    return { o: add(e.p, mul(nrm, e.t / 2)), dir, e }
  })
  const pts: Vec[] = []
  for (let i = 0; i < lines.length; i++) {
    const L0 = lines[(i - 1 + lines.length) % lines.length]
    const L1 = lines[i]
    const x = lineIntersect(L0.o, L0.dir, L1.o, L1.dir)
    if (x && dist(x, L1.e.p) < 60) pts.push(x)
    else {
      // Parallel neighbors of different thickness: step across at the shared vertex.
      const v = L1.e.p
      pts.push(add(v, sub(L0.o, L0.e.p)))
      pts.push(add(v, sub(L1.o, L1.e.p)))
    }
  }
  return simplifyPolygon(pts.map(rv))
}

const unit = (v: Vec): Vec => {
  const L = Math.hypot(v[0], v[1])
  return L < EPS ? [0, 0] : [v[0] / L, v[1] / L]
}

type Label = { name: string; at: Vec; prevId?: string }

/**
 * Re-derive the rooms of every level from the wall graph. Rooms keep their ids, names, themes and
 * flags across edits: a derived room takes the id of the previous room with the same name, else of
 * the previous room whose label point it contains. Faces separated only by a wall with a cased
 * opening are one room unless both have a name. A face with two or more names is split between them;
 * a face with none is called "Room 1", "Room 2" and flagged for naming. Explicit rooms are left alone.
 */
export function deriveRooms(input: Model): Model {
  const m: Model = structuredClone(input)
  const out: Room[] = []
  for (const lv of m.levels) {
    const prev = m.rooms.filter((r) => r.level === lv.id)
    const explicit = prev.filter((r) => r.explicit)
    const labels: Label[] = prev
      .filter((r) => !r.explicit)
      .map((r) => ({ name: r.name, at: r.labelAt ?? (r.polygon.length >= 3 ? poleOfInaccessibility(r.polygon) : [0, 0]), prevId: r.id }))
    const walls = sameLevel(m, lv.id)
    const cased = new Set(m.openings.filter((o) => o.kind === 'opening' || o.style === 'cased').map((o) => o.wall))
    let removed = new Set<string>()
    let graph = wallFaces(walls, removed)
    // Merge across cased openings where at most one side has a name.
    for (let pass = 0; pass < 4; pass++) {
      const inner = innerFaces(graph)
      const faceOfPoint = (p: Vec) => inner.find((f) => pointInPolygon(p, f.poly))?.i ?? -1
      const named = new Map<number, number>()
      for (const l of labels) {
        const f = faceOfPoint(l.at)
        if (f >= 0) named.set(f, (named.get(f) ?? 0) + 1)
      }
      const innerSet = new Set(inner.map((f) => f.i))
      const drop = new Set<string>()
      graph.he.forEach((h, k) => {
        if (k > h.twin || !cased.has(h.wall)) return
        const f1 = h.face
        const f2 = graph.he[h.twin].face
        if (f1 === f2 || !innerSet.has(f1) || !innerSet.has(f2)) return
        if ((named.get(f1) ?? 0) + (named.get(f2) ?? 0) <= 1) drop.add(`${h.wall}@${Math.min(h.from, h.to)}-${Math.max(h.from, h.to)}`)
      })
      if (!drop.size) break
      removed = new Set([...removed, ...drop])
      graph = wallFaces(walls, removed)
    }
    const inner = innerFaces(graph)
    let unnamed = 0
    const usedNames = new Set(labels.map((l) => l.name))
    for (const f of inner) {
      const poly = insetFace(graph.nodes, graph.he, f.loop, f.inward)
      if (poly.length < 3 || polygonArea(poly) < 144) continue // under 1 sf: a sliver between walls
      const here = labels.filter((l) => pointInPolygon(l.at, f.poly))
      // An explicit room already stands for this face.
      if (!here.length && explicit.some((r) => pointInPolygon(r.labelAt ?? centroid(r.polygon), f.poly))) continue
      if (!here.length) {
        let name = ''
        do name = `Room ${++unnamed}`
        while (usedNames.has(name))
        usedNames.add(name)
        out.push(room(lv.id, name, poly, ['needs_name'], undefined))
        continue
      }
      // Split a face that holds several names between them (perpendicular bisectors).
      for (const l of here) {
        let part = poly
        for (const o of here) {
          if (o === l || dist(o.at, l.at) < 1e-6) continue
          const mid = mul(add(l.at, o.at), 0.5)
          part = clipHalfPlane(part, mid, sub(o.at, l.at))
        }
        part = simplifyPolygon(part.map(rv))
        if (part.length >= 3) out.push(room(lv.id, l.name, part, [], l))
      }
    }
    // Explicit rooms stay; flag them when no derived face holds their label any more.
    for (const r of explicit) {
      const at = r.labelAt ?? centroid(r.polygon)
      const enclosed = inner.some((f) => pointInPolygon(at, f.poly))
      const flags = r.flags.filter((x) => x !== 'open_outline')
      out.push({ ...r, flags: enclosed ? flags : [...flags, 'open_outline'] })
    }
  }
  // Stable ids and carried fields.
  const prevAll = input.rooms
  const taken = new Set<string>()
  const result: Room[] = []
  const byLevelCount = new Map<string, number>()
  for (const r of out) {
    if (r.explicit) {
      taken.add(r.id)
      result.push(r)
      continue
    }
    const sameName = prevAll.filter((p) => p.level === r.level && p.name === r.name && !taken.has(p.id))
    const containing = prevAll.filter((p) => p.level === r.level && !taken.has(p.id) && p.labelAt && pointInPolygon(p.labelAt, r.polygon))
    const match = sameName.length === 1 ? sameName[0] : (sameName.find((p) => p.labelAt && pointInPolygon(p.labelAt, r.polygon)) ?? containing[0])
    let id = match?.id
    if (!id) {
      let n = byLevelCount.get(r.level) ?? prevAll.filter((p) => p.level === r.level).length
      do id = `${r.level}r${++n}`
      while (taken.has(id) || prevAll.some((p) => p.id === id))
      byLevelCount.set(r.level, n)
    }
    taken.add(id)
    const keepFlags = (match?.flags ?? []).filter((f) => f !== 'needs_name' && f !== 'open_outline')
    const labelAt = match?.labelAt && pointInPolygon(match.labelAt, r.polygon) ? match.labelAt : poleOfInaccessibility(r.polygon)
    result.push({
      ...r,
      id,
      labelAt,
      flags: [...new Set<RoomFlag>([...keepFlags, ...r.flags])],
      ...(match?.theme !== undefined ? { theme: match.theme } : {}),
      ...(match?.ceiling !== undefined ? { ceiling: match.ceiling } : {}),
    })
  }
  m.rooms = result
  return m
}

function room(level: string, name: string, polygon: Vec[], flags: RoomFlag[], label: Label | undefined): Room {
  return { id: label?.prevId ?? '', level, name, polygon, flags, ...(label ? { labelAt: label.at } : {}), prov: { src: 'derived' } }
}

/** The bounded faces (rooms) of a face set, with centerline polygons and the side their inside is on. */
function innerFaces(graph: ReturnType<typeof wallFaces>) {
  // Bounded faces share one orientation; each connected group of walls also has one outer face with
  // the opposite sign. With this traversal bounded faces come out with positive signed area in the
  // plan frame (y down), so the inside is to the right of each half-edge (inward sign -1).
  return graph.faces
    .map((f, i) => ({ i, loop: f.edges, poly: f.nodes.map((n) => graph.nodes[n]), area: f.area, inward: -1 }))
    .filter((f) => f.area > 1)
}

/** Walls on the outer boundary of their level's wall network. */
export function exteriorWallIds(m: Model, level: string): Set<string> {
  const graph = wallFaces(sameLevel(m, level))
  const ids = new Set<string>()
  graph.faces.forEach((f) => {
    if (f.area < -1) for (const k of f.edges) ids.add(graph.he[k].wall)
  })
  return ids
}

// ------------------------------------------------------------------------------------------ dimensions

/** Where a dimension's bound end sits along the dimension's own axis, or null when it cannot be found. */
export function bindCoordinate(m: Model, dim: Dimension, end: 0 | 1): number | null {
  const bind = dim.binds[end]
  if (!bind) return null
  const axis = unit(sub(dim.b, dim.a))
  if (bind.kind === 'wall_face' || bind.kind === 'wall_center') {
    const w = m.walls.find((x) => x.id === bind.id)
    if (!w) return null
    // The wall must cross the dimension axis (perpendicular-ish).
    if (Math.abs(dot(wallDir(w), axis)) > 0.1) return null
    const left = wallLeft(w)
    let p = w.a
    if (bind.kind === 'wall_face') p = add(w.a, mul(left, (bind.which === 'left' ? 1 : -1) * ((w.tMeasured ?? w.t) / 2)))
    return dot(sub(p, dim.a), axis)
  }
  const o = m.openings.find((x) => x.id === bind.id)
  const w = o && m.walls.find((x) => x.id === o.wall)
  if (!o || !w) return null
  const s = bind.which === 'a' ? o.at - o.w / 2 : o.at + o.w / 2
  return dot(sub(pointAt(w, s), dim.a), axis)
}

/** Recompute status: conflict when the geometry the dimension binds to differs from its value by more than 0.5 in. */
export function updateDimensionStatus(m: Model) {
  for (const d of m.dimensions) {
    if (d.binds.length < 2) {
      d.status = 'unresolved'
      continue
    }
    const c0 = bindCoordinate(m, d, 0)
    const c1 = bindCoordinate(m, d, 1)
    if (c0 === null || c1 === null) {
      d.status = 'unresolved'
      continue
    }
    d.status = Math.abs(Math.abs(c1 - c0) - d.value) > 0.5 ? 'conflict' : 'ok'
  }
}
