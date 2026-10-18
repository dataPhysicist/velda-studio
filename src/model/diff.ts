// What changed between two versions of a model: used by the version chips, Compare and the change
// log against as-built. Pure; inches in, plain records out.
import { dist, polygonArea, wallLength } from './geom'
import type { Item, Model, Opening, Room, Wall } from './types'

export type WallChange = { id: string; level: string; length: number; move?: number; bearing: Wall['bearing']; exterior: boolean }
export type OpeningChange = { id: string; wall: string; kind: Opening['kind']; what: string[] }
export type RoomChange = { id: string; name: string; was?: string; areaBefore?: number; areaAfter?: number }
export type ItemChange = { id: string; label: string; kind: Item['kind']; what: string[] }

export type ModelDiff = {
  walls: { added: WallChange[]; removed: WallChange[]; moved: WallChange[] }
  openings: { added: OpeningChange[]; removed: OpeningChange[]; changed: OpeningChange[] }
  rooms: { added: RoomChange[]; removed: RoomChange[]; renamed: RoomChange[]; resized: RoomChange[] }
  items: { added: ItemChange[]; removed: ItemChange[]; changed: ItemChange[] }
  levels: { id: string; what: string[] }[]
  empty: boolean
}

const wc = (w: Wall, move?: number): WallChange => ({ id: w.id, level: w.level, length: round(wallLength(w)), ...(move !== undefined ? { move: round(move) } : {}), bearing: w.bearing, exterior: w.exterior })
const round = (v: number) => Math.round(v * 100) / 100
const sf = (r: Room) => Math.round(polygonArea(r.polygon) / 144)

export function diffModels(a: Model, b: Model): ModelDiff {
  const aw = new Map(a.walls.map((w) => [w.id, w]))
  const bw = new Map(b.walls.map((w) => [w.id, w]))
  const walls: ModelDiff['walls'] = { added: [], removed: [], moved: [] }
  for (const w of b.walls) if (!aw.has(w.id)) walls.added.push(wc(w))
  for (const w of a.walls) if (!bw.has(w.id)) walls.removed.push(wc(w))
  for (const w of b.walls) {
    const o = aw.get(w.id)
    if (!o) continue
    const move = Math.max(dist(o.a, w.a), dist(o.b, w.b))
    if (move > 0.05 || Math.abs(o.t - w.t) > 0.05) walls.moved.push(wc(w, move))
  }

  const ao = new Map(a.openings.map((o) => [o.id, o]))
  const bo = new Map(b.openings.map((o) => [o.id, o]))
  const openings: ModelDiff['openings'] = { added: [], removed: [], changed: [] }
  const oc = (o: Opening, what: string[] = []): OpeningChange => ({ id: o.id, wall: o.wall, kind: o.kind, what })
  for (const o of b.openings) if (!ao.has(o.id)) openings.added.push(oc(o))
  for (const o of a.openings) if (!bo.has(o.id)) openings.removed.push(oc(o))
  for (const o of b.openings) {
    const p = ao.get(o.id)
    if (!p) continue
    const what: string[] = []
    if (p.wall !== o.wall) what.push('wall')
    if (Math.abs(p.at - o.at) > 0.05) what.push('position')
    if (Math.abs(p.w - o.w) > 0.05) what.push('width')
    if (Math.abs(p.h - o.h) > 0.05) what.push('height')
    if ((p.sill ?? 0) !== (o.sill ?? 0)) what.push('sill')
    if (p.kind !== o.kind || p.style !== o.style) what.push('type')
    if (JSON.stringify(p.swing ?? null) !== JSON.stringify(o.swing ?? null)) what.push('swing')
    if (what.length) openings.changed.push(oc(o, what))
  }

  const ar = new Map(a.rooms.map((r) => [r.id, r]))
  const br = new Map(b.rooms.map((r) => [r.id, r]))
  const rooms: ModelDiff['rooms'] = { added: [], removed: [], renamed: [], resized: [] }
  for (const r of b.rooms) if (!ar.has(r.id)) rooms.added.push({ id: r.id, name: r.name, areaAfter: sf(r) })
  for (const r of a.rooms) if (!br.has(r.id)) rooms.removed.push({ id: r.id, name: r.name, areaBefore: sf(r) })
  for (const r of b.rooms) {
    const p = ar.get(r.id)
    if (!p) continue
    if (p.name !== r.name) rooms.renamed.push({ id: r.id, name: r.name, was: p.name })
    if (sf(p) !== sf(r)) rooms.resized.push({ id: r.id, name: r.name, areaBefore: sf(p), areaAfter: sf(r) })
  }

  const ai = new Map(a.items.map((i) => [i.id, i]))
  const bi = new Map(b.items.map((i) => [i.id, i]))
  const items: ModelDiff['items'] = { added: [], removed: [], changed: [] }
  for (const i of b.items) if (!ai.has(i.id)) items.added.push({ id: i.id, label: i.label, kind: i.kind, what: [] })
  for (const i of a.items) if (!bi.has(i.id)) items.removed.push({ id: i.id, label: i.label, kind: i.kind, what: [] })
  for (const i of b.items) {
    const p = ai.get(i.id)
    if (!p) continue
    const what: string[] = []
    if (Math.hypot(p.x - i.x, p.y - i.y) > 0.05 || p.level !== i.level) what.push('position')
    if (Math.abs(p.rot - i.rot) > 0.05) what.push('rotation')
    if (Math.abs(p.w - i.w) > 0.05 || Math.abs(p.d - i.d) > 0.05 || Math.abs(p.h - i.h) > 0.05) what.push('size')
    if (p.label !== i.label || p.kind !== i.kind) what.push('type')
    if (what.length) items.changed.push({ id: i.id, label: i.label, kind: i.kind, what })
  }

  const levels: ModelDiff['levels'] = []
  for (const l of b.levels) {
    const p = a.levels.find((x) => x.id === l.id)
    if (!p) {
      levels.push({ id: l.id, what: ['added'] })
      continue
    }
    const what: string[] = []
    if (p.ceiling !== l.ceiling) what.push('ceiling')
    if (p.floorThickness !== l.floorThickness) what.push('floor structure')
    if (what.length) levels.push({ id: l.id, what })
  }

  const empty =
    !walls.added.length &&
    !walls.removed.length &&
    !walls.moved.length &&
    !openings.added.length &&
    !openings.removed.length &&
    !openings.changed.length &&
    !rooms.added.length &&
    !rooms.removed.length &&
    !rooms.renamed.length &&
    !rooms.resized.length &&
    !items.added.length &&
    !items.removed.length &&
    !items.changed.length &&
    !levels.length
  return { walls, openings, rooms, items, levels, empty }
}
