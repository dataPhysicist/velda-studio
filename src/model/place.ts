// Where things go in a room, computed by the app so Velda never does the arithmetic (07 section 3):
// the walls around a room as the room sees them, `place` (back against a wall face, or set into an
// island or counter), `swap`, and the `arrange` layout templates from 10-design-reference section 7.
import { add, cross, dist, dot, len, mul, pointAt, pointInPolygon, project, sub, wallDir, wallLeft, wallLength } from './geom'
import { swingArea } from '../analysis/space'
import type { Item, Model, Opening, Room, Vec, Wall } from './types'

const r8 = (v: number) => Math.round(v * 8) / 8

/** Typical sizes (w, d, h in inches) when an item is placed without one (10-design-reference). */
export const SIZES: Partial<Record<Item['kind'], [number, number, number]>> = {
  base_cabinet: [36, 24, 36],
  island: [72, 36, 36],
  vanity: [36, 21, 34],
  sink: [33, 22, 36],
  range: [30, 26, 36],
  stove: [30, 26, 36],
  cooktop: [30, 21, 36],
  dishwasher: [24, 24, 34.5],
  fridge: [36, 30, 70],
  oven_tower: [30, 24, 84],
  tall_cabinet: [24, 24, 84],
  wall_cabinet: [30, 12, 30],
  hood: [30, 20, 18],
  tub: [60, 30, 20],
  shower: [36, 36, 80],
  toilet: [20, 28, 30],
  washer: [27, 30, 38],
  dryer: [27, 30, 38],
  water_heater: [24, 24, 60],
  bed: [60, 80, 24],
  table: [24, 18, 26],
  sofa: [84, 36, 32],
  desk: [48, 24, 30],
  chair: [24, 24, 32],
  bench: [48, 16, 18],
}
const unit = (v: Vec): Vec => {
  const L = len(v) || 1
  return [v[0] / L, v[1] / L]
}

export type RoomEdge = {
  /** Interior face segment, in the order the room outline runs. */
  a: Vec
  b: Vec
  len: number
  dir: Vec
  /** Points into the room. */
  inward: Vec
  wall: Wall | null
  /** Which side of its wall (a to b) the room is on. */
  side: 'left' | 'right'
  /** Openings on this stretch, as spans along the edge from a. */
  openings: { o: Opening; from: number; to: number }[]
}

/** The walls around a room, one entry per straight stretch of its outline. */
export function roomEdges(m: Model, room: Room): RoomEdge[] {
  const poly = room.polygon
  const out: RoomEdge[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const L = dist(a, b)
    if (L < 1) continue
    const dir = unit(sub(b, a))
    let inward: Vec = [dir[1], -dir[0]]
    const mid: Vec = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    if (!pointInPolygon(add(mid, mul(inward, 0.75)), poly)) inward = mul(inward, -1)
    // The wall behind this stretch: parallel, its centerline half a thickness behind the face, overlapping.
    let wall: Wall | null = null
    let best = Infinity
    for (const w of m.walls) {
      if (w.level !== room.level || w.kind === 'rail') continue
      const WL = wallLength(w)
      if (WL < 1 || Math.abs(cross(dir, wallDir(w))) > 0.02) continue
      const off = Math.abs(project(w, mid).off)
      const miss = Math.abs(off - w.t / 2)
      if (miss > 1.5) continue
      const s0 = project(w, a).s
      const s1 = project(w, b).s
      const overlap = Math.min(WL, Math.max(s0, s1)) - Math.max(0, Math.min(s0, s1))
      if (overlap < 1) continue
      if (miss < best) {
        best = miss
        wall = w
      }
    }
    const side: 'left' | 'right' = wall && dot(inward, wallLeft(wall)) > 0 ? 'left' : 'right'
    const openings = wall
      ? m.openings
          .filter((o) => o.wall === wall!.id)
          .map((o) => {
            const c = dot(sub(pointAt(wall!, o.at), a), dir)
            return { o, from: c - o.w / 2, to: c + o.w / 2 }
          })
          .filter((x) => x.to > 0 && x.from < L)
      : []
    out.push({ a, b, len: L, dir, inward, wall, side, openings })
  }
  return out
}

/** Floor items whose back sits on this stretch, as spans along the edge (for packing runs). */
function occupied(m: Model, e: RoomEdge, skip: Set<string>) {
  const spans: [number, number][] = []
  for (const it of m.items) {
    if (skip.has(it.id) || (it.z ?? 0) >= 40) continue
    const r = (it.rot * Math.PI) / 180
    const f: Vec = [Math.sin(r), Math.cos(r)]
    const back = add([it.x, it.y], mul(f, -it.d / 2))
    const off = dot(sub(back, e.a), e.inward)
    if (Math.abs(off) > 2 || dot(f, e.inward) < 0.9) continue
    const c = dot(sub(back, e.a), e.dir)
    spans.push([c - it.w / 2, c + it.w / 2])
  }
  return spans
}

/** Stretches of an edge free of doors, passages, door swings and items already against it. */
export function freeSpans(m: Model, e: RoomEdge, skip: Set<string> = new Set(), clearDoors = 3, depth = 24): [number, number][] {
  const swings: [number, number][] = []
  const level = e.wall?.level
  for (const o of m.openings) {
    if (o.kind !== 'door' || !level) continue
    const area = swingArea(m, o)
    if (!area || m.walls.find((w) => w.id === o.wall)?.level !== level) continue
    // The part of the swing within reach of an item this deep against the edge.
    const near = area.filter((p) => {
      const off = dot(sub(p, e.a), e.inward)
      return off > -1 && off < depth + 1
    })
    if (near.length < 2) continue
    const along = near.map((p) => dot(sub(p, e.a), e.dir))
    swings.push([Math.min(...along) - 1, Math.max(...along) + 1])
  }
  const blocked: [number, number][] = [
    ...e.openings.filter((x) => x.o.kind !== 'window').map((x) => [x.from - clearDoors, x.to + clearDoors] as [number, number]),
    ...swings,
    ...occupied(m, e, skip),
  ].sort((p, q) => p[0] - q[0])
  const out: [number, number][] = []
  let s = 0
  for (const [b0, b1] of blocked) {
    if (b0 > s) out.push([s, Math.min(b0, e.len)])
    s = Math.max(s, b1)
  }
  if (s < e.len) out.push([s, e.len])
  return out.filter(([p, q]) => q - p > 0.5)
}

export type Align = 'center' | 'start' | 'end' | 'window' | { from: 'start' | 'end'; in: number }
export type PlaceSpec = {
  w: number
  d: number
  room?: Room | null
  against?: string
  on?: Item | null
  align?: Align
  offset?: number
  facing?: 'out' | 'back'
  skip?: Set<string>
}
export type Placement = { x: number; y: number; rot: number; anchor?: Item['anchor']; edge?: RoomEdge }

const rotFor = (f: Vec) => {
  const deg = (Math.atan2(f[0], f[1]) * 180) / Math.PI
  return Math.round(((deg % 360) + 360) % 360)
}

/** Pick the room's wall a request names. */
export function pickEdge(m: Model, room: Room, against: string | undefined, edges = roomEdges(m, room)): RoomEdge | string {
  const walls = edges.filter((e) => e.wall && e.wall.kind !== 'glass')
  if (!walls.length) return `the ${room.name} has no walls to put things against`
  const longest = (list: RoomEdge[]) => [...list].sort((p, q) => usable(m, q) - usable(m, p))[0]
  const key = String(against ?? 'longest')
  if (key === 'longest') return longest(walls)
  if (key === 'exterior') return longest(walls.filter((e) => e.wall!.exterior)) ?? 'the room has no outside wall'
  if (key === 'window') return longest(walls.filter((e) => e.openings.some((x) => x.o.kind === 'window'))) ?? 'the room has no window'
  if (key === 'door') return longest(walls.filter((e) => e.openings.some((x) => x.o.kind === 'door'))) ?? 'the room has no door'
  if (key.startsWith('shared:')) {
    const other = m.rooms.find((r) => r.id === key.slice(7) || r.name.toLowerCase() === key.slice(7).toLowerCase())
    if (!other) return `no room ${key.slice(7)}`
    const shared = walls.filter((e) => roomEdges(m, other).some((x) => x.wall?.id === e.wall!.id))
    return longest(shared) ?? `the ${room.name} shares no wall with the ${other.name}`
  }
  const toward = (d: Vec) => [...walls].sort((p, q) => dot(q.inward, d) - dot(p.inward, d))[0] // the edge whose inside faces away from d
  if (key === 'front' || key === 'back') {
    const front = m.project.front
    if (!front) return 'which side of the house faces the street is not set yet'
    const d: Vec = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[front] as Vec
    return toward(key === 'front' ? mul(d, -1) : d)
  }
  if (['north', 'south', 'east', 'west'].includes(key)) {
    if (m.project.north == null) return 'compass directions are not known until north is set'
    const a = (m.project.north * Math.PI) / 180
    const north: Vec = [Math.sin(a), -Math.cos(a)]
    const east: Vec = [Math.cos(a), Math.sin(a)]
    const d = { north, south: mul(north, -1), east, west: mul(east, -1) }[key as 'north'] as Vec
    return toward(mul(d, -1))
  }
  const byWall = walls.filter((e) => e.wall!.id === key)
  return longest(byWall) ?? `wall ${key} is not one of the ${room.name}'s walls`
}

const usable = (m: Model, e: RoomEdge) => Math.max(0, ...freeSpans(m, e).map(([p, q]) => q - p))

/** Where an item of size w by d goes: back against a wall face, or set into a host item. */
export function placement(m: Model, spec: PlaceSpec): Placement | string {
  const { w, d } = spec
  if (spec.on) {
    const h = spec.on
    const r = (h.rot * Math.PI) / 180
    const f: Vec = [Math.sin(r), Math.cos(r)]
    const s: Vec = [Math.cos(r), -Math.sin(r)]
    if (w > h.w + 0.01) return `a ${Math.round(w)} in wide item does not fit in the ${h.label || h.kind} (${Math.round(h.w)} in)`
    const room = (h.w - w) / 2
    const a = spec.align ?? 'center'
    const along = a === 'start' ? -room : a === 'end' ? room : typeof a === 'object' ? (a.from === 'start' ? -h.w / 2 + a.in + w / 2 : h.w / 2 - a.in - w / 2) : 0
    const back = spec.facing === 'back'
    // A sink lines up with the host's front (or its back, turned round); a range deeper than the
    // counter keeps its back on the counter's back and stands proud at the front, as installed.
    const k = d <= h.d ? h.d / 2 - d / 2 : d / 2 - h.d / 2
    const c = add(add([h.x, h.y], mul(s, along)), mul(f, back ? -k : k))
    return { x: r8(c[0]), y: r8(c[1]), rot: rotFor(back ? mul(f, -1) : f) }
  }
  const room = spec.room
  if (!room) return 'say which room'
  const e = pickEdge(m, room, spec.against)
  if (typeof e === 'string') return e
  const spans = freeSpans(m, e, spec.skip, 3, d + (spec.offset ?? 0))
  const fits = spans.filter(([p, q]) => q - p >= w - 0.01)
  if (!fits.length) return `no ${Math.round(w)} in clear stretch on that wall of the ${room.name} (doors and other items take the rest)`
  const a = spec.align ?? (spec.against === 'window' ? 'window' : 'center')
  let c: number
  if (a === 'window') {
    const win = e.openings.filter((x) => x.o.kind === 'window').sort((p, q) => q.o.w - p.o.w)[0]
    const mid = win ? (win.from + win.to) / 2 : e.len / 2
    const span = fits.find(([p, q]) => mid - w / 2 >= p - 0.01 && mid + w / 2 <= q + 0.01) ?? fits.sort((p, q) => Math.abs((p[0] + p[1]) / 2 - mid) - Math.abs((q[0] + q[1]) / 2 - mid))[0]
    c = Math.min(Math.max(mid, span[0] + w / 2), span[1] - w / 2)
  } else if (a === 'start') c = fits[0][0] + w / 2
  else if (a === 'end') c = fits[fits.length - 1][1] - w / 2
  else if (typeof a === 'object') {
    const want = a.from === 'start' ? a.in + w / 2 : e.len - a.in - w / 2
    const span = fits.find(([p, q]) => want - w / 2 >= p - 0.01 && want + w / 2 <= q + 0.01)
    if (!span) return `${Math.round(a.in)} in from the ${a.from} of that wall runs into a door or another item`
    c = want
  } else {
    // Centered on the wall when that stretch is free, else centered in the longest free stretch.
    const mid = e.len / 2
    const span = fits.find(([p, q]) => mid - w / 2 >= p - 0.01 && mid + w / 2 <= q + 0.01) ?? [...fits].sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0]
    c = mid - w / 2 >= span[0] - 0.01 && mid + w / 2 <= span[1] + 0.01 ? mid : (span[0] + span[1]) / 2
  }
  const off = Math.max(0, spec.offset ?? 0)
  const p = add(add(e.a, mul(e.dir, c)), mul(e.inward, off + d / 2))
  const out: Placement = { x: r8(p[0]), y: r8(p[1]), rot: rotFor(spec.facing === 'back' ? mul(e.inward, -1) : e.inward), edge: e }
  if (e.wall && off === 0 && spec.facing !== 'back') out.anchor = { wall: e.wall.id, at: r8(project(e.wall, p).s), side: e.side }
  return out
}

/** Two items, or two groups of items (a refrigerator tower of two columns), trade places: each group's
 * back line goes where the other's was, centered on it, facing the way the other faced. */
export function swapPlaces(A: Item[], B: Item[]) {
  type Frame = { anchor: Vec; f: Vec; s: Vec; rot: number }
  const frameOf = (items: Item[]): Frame => {
    const r = (items[0].rot * Math.PI) / 180
    const f: Vec = [Math.sin(r), Math.cos(r)]
    const s: Vec = [Math.cos(r), -Math.sin(r)]
    // The back line is the back of the deepest-set item; the anchor is its middle across the group.
    const backs = items.map((it) => dot(add([it.x, it.y], mul(f, -it.d / 2)), f))
    const lo = Math.min(...items.map((it) => dot([it.x, it.y], s) - it.w / 2))
    const hi = Math.max(...items.map((it) => dot([it.x, it.y], s) + it.w / 2))
    const back = Math.min(...backs)
    const mid = (lo + hi) / 2
    return { anchor: add(mul(f, back), mul(s, mid)), f, s, rot: items[0].rot }
  }
  const fa = frameOf(A)
  const fb = frameOf(B)
  const move = (items: Item[], from: Frame, to: Frame) =>
    items.map((it) => {
      const rel = sub([it.x, it.y], from.anchor)
      const ls = dot(rel, from.s)
      const lf = dot(rel, from.f)
      const p = add(add(to.anchor, mul(to.s, ls)), mul(to.f, lf))
      const rot = (((it.rot + to.rot - from.rot) % 360) + 360) % 360
      return { id: it.id, x: r8(p[0]), y: r8(p[1]), rot }
    })
  return [...move(A, fa, fb), ...move(B, fb, fa)]
}
