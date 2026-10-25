// Layout templates for the `arrange` op (10-design-reference section 7). Each one is a function of
// the room's outline and its walls: it clears the room's items of that kind, places new ones with the
// clearances the checker enforces, and says plainly what it could not meet. It returns plain ops
// (delete and add_item with computed x, y and rot), so the result is one ordinary version.
import { dist, dot, pointInPolygon } from './geom'
import { type PlaceSpec, type RoomEdge, freeSpans, placement, roomEdges } from './place'
import type { Item, ItemKind, Model, Room, Vec } from './types'
import { formatFeetInches as ft } from './units'

export const LAYOUTS = ['galley', 'l', 'u', 'island', 'vanity_toilet_shower', 'double_vanity', 'bed_wall', 'side_by_side'] as const
export type Layout = (typeof LAYOUTS)[number]

const KINDS: Record<string, ItemKind[]> = {
  kitchen: ['base_cabinet', 'island', 'sink', 'range', 'cooktop', 'dishwasher', 'fridge', 'oven_tower', 'tall_cabinet', 'wall_cabinet', 'hood', 'stove'],
  bath: ['vanity', 'toilet', 'tub', 'shower', 'sink', 'glass'],
  bedroom: ['bed', 'table'],
  laundry: ['washer', 'dryer'],
}
const GROUP: Record<Layout, keyof typeof KINDS> = {
  galley: 'kitchen',
  l: 'kitchen',
  u: 'kitchen',
  island: 'kitchen',
  vanity_toilet_shower: 'bath',
  double_vanity: 'bath',
  bed_wall: 'bedroom',
  side_by_side: 'laundry',
}

type Draft = Omit<Item, 'prov' | 'level'>

/** The ops that lay out a room, plus what the layout could not meet. */
export function arrangeOps(input: Model, room: Room, layout: Layout): { ops: Record<string, any>[]; misses: string[]; removed: string[] } {
  const m: Model = structuredClone(input)
  const inRoom = (it: Item) => it.level === room.level && pointInPolygon([it.x, it.y], room.polygon)
  const removed = m.items.filter((it) => inRoom(it) && KINDS[GROUP[layout]].includes(it.kind))
  m.items = m.items.filter((it) => !removed.includes(it))
  const misses: string[] = []
  const placed: Draft[] = []
  let n = 0
  const id = (k: string) => `${k}-${room.id}-${++n}`
  const put = (kind: ItemKind, label: string, w: number, d: number, h: number, spec: Omit<PlaceSpec, 'w' | 'd'>, extra: Partial<Item> = {}): Draft | null => {
    const p = placement(m, { w, d, room, ...spec })
    if (typeof p === 'string') {
      misses.push(`${label}: ${p}`)
      return null
    }
    const it: Draft = { id: id(kind), kind, label, x: p.x, y: p.y, rot: p.rot, w, d, h, ...(p.anchor ? { anchor: p.anchor } : {}), ...extra }
    m.items.push({ ...it, level: room.level, prov: { src: 'ai' } })
    placed.push(it)
    return it
  }
  /** Fill the free stretches of a wall with counter runs (whole 3 in steps, 15 in or longer). */
  const run = (e: RoomEdge, label = 'Base cabinets') => {
    const out: Draft[] = []
    for (const [p, q] of freeSpans(m, e)) {
      const w = Math.floor((q - p) / 3) * 3
      if (w < 15) continue
      const it = put('base_cabinet', label, w, 24, 36, { against: e.wall!.id, align: { from: 'start', in: p + (q - p - w) / 2 } })
      if (it) out.push(it)
    }
    return out
  }
  const into = (host: Draft | undefined, kind: ItemKind, label: string, w: number, d: number, align: PlaceSpec['align'] = 'center') => {
    if (!host) return null
    const h = m.items.find((x) => x.id === host.id)!
    return put(kind, label, w, d, 36, { on: h, align })
  }
  const edges = roomEdges(m, room).filter((e) => e.wall && e.wall.kind === 'wall')
  const usable = (e: RoomEdge) => Math.max(0, ...freeSpans(m, e).map(([p, q]) => q - p))
  const byLength = [...edges].sort((p, q) => usable(q) - usable(p))
  const facing = (e: RoomEdge) => edges.filter((x) => dot(x.inward, e.inward) < -0.99).sort((p, q) => usable(q) - usable(p))[0]
  const across = (e: RoomEdge, o: RoomEdge) => Math.abs(dot([o.a[0] - e.a[0], o.a[1] - e.a[1]], e.inward))
  const adjacent = (e: RoomEdge) => edges.filter((x) => Math.abs(dot(x.dir, e.dir)) < 0.01 && (dist(x.a, e.b) < 1 || dist(x.b, e.a) < 1 || dist(x.a, e.a) < 1 || dist(x.b, e.b) < 1))
  const hasWindow = (e: RoomEdge) => e.openings.some((x) => x.o.kind === 'window')
  const nearDoor = (e: RoomEdge): 'start' | 'end' => {
    const doors = edges.flatMap((x) => x.openings.filter((o) => o.o.kind !== 'window').map((o) => [x, o] as const))
    if (!doors.length) return 'end'
    const at = (s: number): Vec => [e.a[0] + e.dir[0] * s, e.a[1] + e.dir[1] * s]
    const doorAt = ([x, o]: (typeof doors)[number]): Vec => [x.a[0] + x.dir[0] * ((o.from + o.to) / 2), x.a[1] + x.dir[1] * ((o.from + o.to) / 2)]
    const dStart = Math.min(...doors.map((d) => dist(doorAt(d), at(0))))
    const dEnd = Math.min(...doors.map((d) => dist(doorAt(d), at(e.len))))
    return dStart <= dEnd ? 'start' : 'end'
  }
  const sinkRun = (runs: Draft[], e: RoomEdge) => {
    // Sink centered under the window when there is one, dishwasher beside it.
    const win = e.openings.filter((x) => x.o.kind === 'window').sort((p, q) => q.o.w - p.o.w)[0]
    const target = win ? (win.from + win.to) / 2 : e.len / 2
    const host = [...runs].sort((p, q) => Math.abs(alongOf(e, p) - target) - Math.abs(alongOf(e, q) - target))[0]
    if (!host) return misses.push('Sink: no counter run long enough')
    const offset = target - alongOf(e, host) // along the edge
    const hs = m.items.find((x) => x.id === host.id)!
    const sign = sideSign(e, hs)
    const sinkAt = Math.max(0, Math.min(host.w - 33, host.w / 2 + offset * sign - 33 / 2))
    into(host, 'sink', 'Sink', 33, 22, { from: 'start', in: sinkAt })
    if (host.w - (sinkAt + 33) >= 24) into(host, 'dishwasher', 'Dishwasher', 24, 24, { from: 'start', in: sinkAt + 33 })
    else if (sinkAt >= 24) into(host, 'dishwasher', 'Dishwasher', 24, 24, { from: 'start', in: sinkAt - 24 })
    else misses.push('Dishwasher: no 2\'-0" of counter beside the sink')
  }
  const rangeOn = (runs: Draft[], minFromCorner = 0) => {
    const host = [...runs].sort((p, q) => q.w - p.w)[0]
    if (!host || host.w < 30 + 2 * 12) return misses.push('Range: no counter run long enough for 1\'-0" of landing each side')
    into(host, 'range', 'Range', 30, 26, minFromCorner ? { from: 'start', in: Math.max(minFromCorner, (host.w - 30) / 2) } : 'center')
  }
  const aisle = (e: RoomEdge, o: RoomEdge | undefined, need = 42) => {
    if (!o) return
    const clear = across(e, o) - 48
    if (clear < need) misses.push(`Aisle: ${ft(clear)} between the counters; ${ft(need)} is the least for one cook`)
  }

  switch (layout) {
    case 'galley': {
      const a = byLength[0]
      const b = a && facing(a)
      if (!a || !b) {
        misses.push('Galley: the room needs two facing walls')
        break
      }
      aisle(a, b)
      const [sinkWall, rangeWall] = hasWindow(b) && !hasWindow(a) ? [b, a] : [a, b]
      // A full-depth refrigerator only where it still leaves the aisle; else a counter-depth one.
      const deep = across(a, b) - 24 - 42 >= 30
      put('fridge', deep ? 'Refrigerator' : 'Refrigerator (counter depth)', 36, deep ? 30 : 25, 70, { against: rangeWall.wall!.id, align: nearDoor(rangeWall) })
      const sinkRuns = run(sinkWall)
      const rangeRuns = run(rangeWall)
      sinkRun(sinkRuns, sinkWall)
      rangeOn(rangeRuns)
      break
    }
    case 'l':
    case 'u': {
      const a = byLength.find((e) => adjacent(e).length) ?? byLength[0]
      if (!a) break
      const legs = adjacent(a).sort((p, q) => usable(q) - usable(p))
      const walls = layout === 'u' ? [a, ...legs.slice(0, 2)] : [a, legs[0]].filter(Boolean)
      if (walls.length < (layout === 'u' ? 3 : 2)) {
        misses.push(`${layout === 'u' ? 'U' : 'L'} shape: the room needs ${layout === 'u' ? 'three' : 'two'} walls that meet`)
        break
      }
      if (layout === 'u') aisle(walls[1], walls[2])
      const sinkWall = walls.find(hasWindow) ?? walls[0]
      const others = walls.filter((e) => e !== sinkWall)
      put('fridge', 'Refrigerator', 36, 30, 70, { against: others[others.length - 1].wall!.id, align: nearDoor(others[others.length - 1]) })
      // Corner: the first wall's run takes the corner; the others start 24 in out of it.
      const runs = new Map(walls.map((e) => [e, run(e)]))
      sinkRun(runs.get(sinkWall)!, sinkWall)
      rangeOn(runs.get(others[0])!, 15)
      break
    }
    case 'island': {
      const a = byLength[0]
      if (!a) break
      const o = facing(a)
      const depth = o ? across(a, o) : 0
      put('fridge', 'Refrigerator', 36, 30, 70, { against: a.wall!.id, align: nearDoor(a) })
      const runs = run(a)
      sinkRun(runs, a)
      rangeOn(runs)
      // Island 36 to 42 in deep, 42 in aisles on both sides of it (36 in walkway behind).
      const room4 = depth - 24 - 42 - 36
      if (room4 < 36) {
        misses.push(`Island: the room is ${ft(depth)} deep; an island with 3'-6" aisles needs ${ft(24 + 42 + 36 + 36)}`)
        break
      }
      const isl = Math.min(42, room4)
      const len = Math.min(96, Math.max(48, Math.floor((a.len - 84) / 6) * 6))
      put('island', 'Island', len, isl, 36, { against: a.wall!.id, offset: 24 + 42, align: 'center' })
      break
    }
    case 'vanity_toilet_shower': {
      const long = byLength.find((e) => !e.openings.some((x) => x.o.kind === 'door')) ?? byLength[0]
      if (!long) break
      const toward = nearDoor(long)
      const far = adjacent(long).sort((p, q) => {
        const end = toward === 'start' ? long.b : long.a // the end away from the door
        return Math.min(dist(p.a, end), dist(p.b, end)) - Math.min(dist(q.a, end), dist(q.b, end))
      })[0]
      if (far && far.len >= 59) put('tub', 'Tub', 60, 30, 20, { against: far.wall!.id, align: 'center' })
      else if (far) put('shower', 'Shower', Math.min(48, Math.floor(far.len)), 36, 80, { against: far.wall!.id, align: 'center' })
      const v = put('vanity', 'Vanity', 36, 21, 34, { against: long.wall!.id, align: toward })
      if (v) {
        const vAt = alongOf(long, v)
        const dir = toward === 'start' ? 1 : -1
        const want = vAt + dir * (18 + 15) // 15 in from the vanity's side to the toilet center
        put('toilet', 'Toilet', 20, 28, 30, { against: long.wall!.id, align: { from: 'start', in: want - 10 } })
      }
      break
    }
    case 'double_vanity': {
      const long = byLength[0]
      if (!long) break
      const free = usable(long)
      if (free < 60) misses.push(`Double vanity: the longest clear wall is ${ft(free)}; a double vanity wants 5'-0" to 6'-0"`)
      else put('vanity', 'Double vanity', Math.min(72, Math.floor(free / 6) * 6), 21, 34, { against: long.wall!.id, align: 'center' }, { props: { sinks: 2 } })
      const end = adjacent(long).sort((p, q) => usable(q) - usable(p))[0]
      if (end) put('shower', 'Shower', Math.min(60, Math.floor(usable(end) / 6) * 6), 42, 80, { against: end.wall!.id, align: 'center' })
      const opp = facing(long)
      if (opp) put('toilet', 'Toilet', 20, 28, 30, { against: opp.wall!.id, align: 'center' })
      const win = edges.find((e) => hasWindow(e) && e !== long && e !== end && e !== opp)
      if (win && usable(win) >= 60) put('tub', 'Tub', 60, 30, 20, { against: win.wall!.id, align: 'window' })
      break
    }
    case 'bed_wall': {
      const door = edges.find((e) => e.openings.some((x) => x.o.kind === 'door'))
      const wall = (door && facing(door) && !hasWindow(facing(door)!) ? facing(door) : byLength.find((e) => !hasWindow(e))) ?? byLength[0]
      if (!wall) break
      const bed = put('bed', 'Bed', 60, 80, 24, { against: wall.wall!.id, align: 'center' })
      if (bed) {
        const c = alongOf(wall, bed)
        for (const s of [-1, 1]) {
          const at = c + s * (30 + 12) - 12
          if (at < 0 || at + 24 > wall.len) misses.push('Nightstand: no 2\'-0" beside the bed')
          else put('table', 'Nightstand', 24, 18, 26, { against: wall.wall!.id, align: { from: 'start', in: at } })
        }
        const sideRoom = Math.min(c - 30, wall.len - c - 30)
        if (sideRoom < 30) misses.push(`Walkway: ${ft(sideRoom)} beside the bed; 2'-6" is comfortable`)
      }
      break
    }
    case 'side_by_side': {
      // The pair goes on the wall with the most clear length, centered in its longest clear stretch.
      const wall = [...edges].sort((p, q) => Math.max(0, ...freeSpans(m, q, new Set(), 3, 30).map(([a, b]) => b - a)) - Math.max(0, ...freeSpans(m, p, new Set(), 3, 30).map(([a, b]) => b - a)))[0]
      if (!wall) break
      const span = freeSpans(m, wall, new Set(), 3, 30).sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0]
      if (!span || span[1] - span[0] < 55) {
        misses.push(`Washer and dryer: no 4'-7" clear stretch of wall`)
        break
      }
      const start = span[0] + (span[1] - span[0] - 55) / 2
      put('washer', 'Washer', 27, 30, 38, { against: wall.wall!.id, align: { from: 'start', in: start } })
      put('dryer', 'Dryer', 27, 30, 38, { against: wall.wall!.id, align: { from: 'start', in: start + 28 } })
      const o = facing(wall)
      if (o && across(wall, o) - 30 < 36) misses.push(`Clearance: ${ft(across(wall, o) - 30)} in front of the washer and dryer; 3'-0" is needed`)
      if (!wall.wall!.exterior) misses.push('Dryer vent: this wall is not an outside wall; the vent run must reach one within 25 ft')
      break
    }
  }
  const ops: Record<string, any>[] = [
    ...removed.map((it) => ({ op: 'delete', id: it.id })),
    ...placed.map((it) => ({ op: 'add_item', ...it, level: room.level })),
  ]
  return { ops, misses, removed: removed.map((it) => it.label || it.kind) }
}

/** Where an item's center sits along a room edge. */
function alongOf(e: RoomEdge, it: { x: number; y: number }) {
  return dot([it.x - e.a[0], it.y - e.a[1]], e.dir)
}
/** +1 when an item's own width axis runs the same way as the edge. */
function sideSign(e: RoomEdge, it: Item) {
  const r = (it.rot * Math.PI) / 180
  return dot([Math.cos(r), -Math.sin(r)], e.dir) >= 0 ? 1 : -1
}
