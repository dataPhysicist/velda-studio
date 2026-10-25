// Operations: the only way the model changes (chat, hand edits, import and migration all produce
// them). applyOps validates each op against the rules in 04 "Rules the code must enforce", applies
// the ones that pass, reports the rest in plain words, and never throws on one bad op.
import { type Role, ROLES, type Theme, slug } from '../lib/theme'
import { LAYOUTS, type Layout, arrangeOps } from './arrange'
import { bindCoordinate, deriveRooms, moveWall, placeAnchoredItems, updateDimensionStatus } from './derive'
import { add, dist, dot, isAxisAligned, mul, pointAt, pointInPolygon, polygonBounds, project, rv, sub, wallDir, wallLeft, wallLength } from './geom'
import { type Align, SIZES, placement, roomEdges, swapPlaces } from './place'
import { checkShape, opKind } from './table'
import { formatFeetInches } from './units'
import {
  type Author,
  type Dimension,
  ITEM_KINDS,
  type Item,
  type ItemKind,
  type Model,
  type Note,
  type Opening,
  type OpeningKind,
  type OpeningStyle,
  type Prov,
  type Vec,
  type Wall,
} from './types'

export type Op = Record<string, any> & { op: string }
export type OpContext = { author: Author; versionLabel?: string; focusLevel?: string | null; now?: string }
export type OpResult = { model: Model; applied: number; skipped: string[]; notes: string[] }

const STYLES: OpeningStyle[] = ['swing', 'pocket', 'sliding', 'french', 'bifold', 'barn', 'fixed', 'casement', 'double_hung', 'slider', 'cased']
const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : undefined)
const vec = (v: any): Vec | undefined => (Array.isArray(v) && v.length >= 2 && num(v[0]) !== undefined && num(v[1]) !== undefined ? [num(v[0])!, num(v[1])!] : undefined)

let seq = 0
export function newId(prefix: string) {
  seq = (seq + 1) % 1e6
  return `${prefix}${Date.now().toString(36).slice(-5)}${seq.toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

/** The provenance a change by this author leaves on the numbers it touches. */
export function provFor(ctx: OpContext): Prov {
  switch (ctx.author) {
    case 'ai':
      return { src: 'ai', ...(ctx.versionLabel ? { note: ctx.versionLabel } : {}) }
    case 'migration':
      return { src: 'sheet_raster', note: 'migrated from v0.3' }
    case 'import':
      return { src: 'sheet_raster' }
    default:
      return { src: 'user' }
  }
}

export function applyOps(input: Model, ops: Op[], ctx: OpContext = { author: 'user' }): OpResult {
  let model: Model = structuredClone(input)
  model.themes = model.themes ?? {}
  const skipped: string[] = []
  const notes: string[] = []
  let applied = 0
  let geometry = false
  for (const op of ops ?? []) {
    const bad = checkShape(op)
    if (bad) {
      skipped.push(`${(op as Op)?.op ?? 'op'} ${(op as Op)?.id ?? (op as Op)?.wall ?? ''}`.trim() + `: ${bad}`)
      continue
    }
    if (opKind(op.op) !== 'model') continue // actions and turn ops are the page's, not the model's
    try {
      const r = applyOne(model, op, ctx)
      if (typeof r === 'string') skipped.push(`${op?.op} ${op?.id ?? op?.wall ?? ''}`.trim() + `: ${r}`)
      else {
        model = r.model
        applied++
        geometry ||= r.geometry
        if (r.note) notes.push(r.note)
      }
    } catch (e) {
      skipped.push(`${op?.op}: ${(e as Error).message}`)
    }
  }
  if (geometry) model = settle(model, notes)
  return { model, applied, skipped, notes }
}

/** After any wall or opening change: openings back inside their walls, rooms re-derived, items and dimensions updated. */
export function settle(input: Model, notes: string[] = []): Model {
  const m = input
  const walls = new Map(m.walls.map((w) => [w.id, w]))
  m.openings = m.openings.filter((o) => {
    const w = walls.get(o.wall)
    if (!w) {
      notes.push(`Removed ${o.kind} ${o.id}: its wall is gone.`)
      return false
    }
    const L = wallLength(w)
    if (o.w > L) {
      notes.push(`Removed ${o.kind} ${o.id}: wall ${w.id} is now shorter than it.`)
      return false
    }
    const at = Math.min(Math.max(o.at, o.w / 2), L - o.w / 2)
    // Rounding nudges (under half an inch) are not worth a sentence.
    if (Math.abs(at - o.at) >= 0.5) notes.push(`Kept ${o.kind} ${o.id} inside wall ${w.id} (moved ${Math.abs(at - o.at).toFixed(1)} in).`)
    o.at = Math.round(at * 100) / 100
    return true
  })
  const out = deriveRooms(m)
  placeAnchoredItems(out)
  updateDimensionStatus(out)
  return out
}

type Applied = { model: Model; geometry: boolean; note?: string }

function findRoom(m: Model, key: any) {
  if (!key) return null
  const k = String(key).toLowerCase()
  return m.rooms.find((r) => r.id === key) ?? m.rooms.find((r) => r.name.toLowerCase() === k) ?? m.rooms.find((r) => r.name.toLowerCase().includes(k)) ?? null
}
function levelOk(m: Model, level: any, ctx: OpContext) {
  if (m.levels.some((l) => l.id === level)) return level as string
  if (ctx.focusLevel && m.levels.some((l) => l.id === ctx.focusLevel)) return ctx.focusLevel
  return m.levels[0]?.id ?? 'L1'
}
function openingsOn(m: Model, wallId: string) {
  return m.openings.filter((o) => o.wall === wallId)
}

function applyOne(m: Model, op: Op, ctx: OpContext): Applied | string {
  const prov = provFor(ctx)
  switch (op.op) {
    case 'move': {
      const it = m.items.find((i) => i.id === op.id)
      if (it) {
        if (num(op.x) !== undefined) it.x = num(op.x)!
        if (num(op.y) !== undefined) it.y = num(op.y)!
        it.x += num(op.dx) ?? 0
        it.y += num(op.dy) ?? 0
        if (num(op.rot) !== undefined) it.rot = num(op.rot)!
        if (op.level) it.level = levelOk(m, op.level, ctx)
        if (num(op.x) !== undefined || num(op.y) !== undefined || num(op.dx) || num(op.dy)) delete it.anchor
        it.prov = prov
        return { model: m, geometry: false }
      }
      const w = m.walls.find((x) => x.id === op.id)
      if (w) {
        const dx = num(op.dx) ?? 0
        const dy = num(op.dy) ?? 0
        const left = wallLeft(w)
        const across = dx * left[0] + dy * left[1]
        const along = dot([dx, dy], wallDir(w))
        const r = moveWall(m, w.id, across, prov)
        if (!r.ok) return (r as { reason: string }).reason
        if (Math.abs(across) > 6 && (w.exterior || w.bearing !== 'no'))
          addLockedNote(r.model, `Engineer to confirm: wall ${w.id} may carry load and was moved ${Math.abs(across).toFixed(1)} in.`, w, ctx)
        const note = Math.abs(along) > 0.5 ? `Moved wall ${w.id} ${Math.abs(across).toFixed(1)} in across its length; walls only move sideways, the ${Math.abs(along).toFixed(1)} in along it was not applied.` : undefined
        return { model: r.model, geometry: true, note }
      }
      const o = m.openings.find((x) => x.id === op.id)
      if (o) {
        if (num(op.at) !== undefined) o.at = num(op.at)!
        if (num(op.dat) !== undefined) o.at += num(op.dat)!
        o.prov.at = prov
        return { model: m, geometry: true }
      }
      return `nothing with id ${op.id}`
    }
    case 'resize': {
      const it = m.items.find((i) => i.id === op.id)
      if (!it) return `no item ${op.id}`
      const w = num(op.w)
      if (w !== undefined && w > 0) {
        const grow = w - it.w
        if (op.anchor === 'left' || op.anchor === 'right') {
          const yaw = (it.rot * Math.PI) / 180
          const sign = op.anchor === 'left' ? 1 : -1
          it.x += (Math.cos(yaw) * grow * sign) / 2
          it.y += (-Math.sin(yaw) * grow * sign) / 2
        }
        it.w = w
      }
      if (num(op.d) !== undefined && num(op.d)! > 0) it.d = num(op.d)!
      if (num(op.h) !== undefined && num(op.h)! > 0) it.h = num(op.h)!
      if (num(op.z) !== undefined) it.z = num(op.z)!
      it.prov = prov
      return { model: m, geometry: false }
    }
    case 'delete':
    case 'remove': {
      if (m.items.some((i) => i.id === op.id)) {
        m.items = m.items.filter((i) => i.id !== op.id)
        return { model: m, geometry: false }
      }
      const w = m.walls.find((x) => x.id === op.id)
      if (w) {
        const n = openingsOn(m, w.id).length
        m.walls = m.walls.filter((x) => x.id !== op.id)
        m.openings = m.openings.filter((o) => o.wall !== op.id)
        const caution = w.exterior || w.bearing !== 'no'
        if (caution) addLockedNote(m, `Engineer to confirm: wall ${w.id} may carry load and was removed.`, w, ctx)
        return { model: m, geometry: true, note: n ? `Removed wall ${w.id} and its ${n} opening${n > 1 ? 's' : ''}.` : undefined }
      }
      if (m.openings.some((o) => o.id === op.id)) {
        m.openings = m.openings.filter((o) => o.id !== op.id)
        return { model: m, geometry: true }
      }
      if (m.dimensions.some((d) => d.id === op.id)) {
        m.dimensions = m.dimensions.filter((d) => d.id !== op.id)
        return { model: m, geometry: false }
      }
      const room = findRoom(m, op.id)
      if (room) return `rooms come from the walls around them; rename ${room.name} or remove a wall instead`
      return `nothing with id ${op.id}`
    }
    case 'add_item': {
      const kind: ItemKind = (ITEM_KINDS as readonly string[]).includes(op.kind) ? op.kind : 'item'
      const x = num(op.x)
      const y = num(op.y)
      if (x === undefined || y === undefined) return 'needs x and y'
      const it: Item = {
        id: op.id && !m.items.some((i) => i.id === op.id) ? String(op.id) : newId('i'),
        level: levelOk(m, op.level, ctx),
        kind,
        label: String(op.label || kind.replace('_', ' ')),
        x,
        y,
        rot: num(op.rot) ?? 0,
        w: num(op.w) ?? SIZES[kind]?.[0] ?? 30,
        d: num(op.d) ?? SIZES[kind]?.[1] ?? 24,
        h: num(op.h) ?? SIZES[kind]?.[2] ?? 36,
        ...(op.anchor && m.walls.some((w) => w.id === op.anchor.wall) && num(op.anchor.at) !== undefined && (op.anchor.side === 'left' || op.anchor.side === 'right')
          ? { anchor: { wall: String(op.anchor.wall), at: num(op.anchor.at)!, side: op.anchor.side } }
          : {}),
        ...(num(op.z) !== undefined ? { z: num(op.z) } : {}),
        ...(op.catalog ? { catalog: String(op.catalog) } : {}),
        ...(op.props && typeof op.props === 'object' ? { props: op.props } : {}),
        prov,
      }
      m.items.push(it)
      return { model: m, geometry: false }
    }
    case 'update_item': {
      const it = m.items.find((i) => i.id === op.id)
      if (!it) return `no item ${op.id}`
      if (op.label) it.label = String(op.label)
      if (op.kind && (ITEM_KINDS as readonly string[]).includes(op.kind)) it.kind = op.kind
      if (op.catalog) it.catalog = String(op.catalog)
      for (const k of ['x', 'y', 'rot', 'w', 'd', 'h', 'z'] as const) if (num(op[k]) !== undefined) (it as any)[k] = num(op[k])
      if (op.props && typeof op.props === 'object') it.props = { ...(it.props ?? {}), ...op.props }
      it.prov = prov
      return { model: m, geometry: false }
    }
    case 'add_wall': {
      const a = vec(op.a)
      const b = vec(op.b)
      if (!a || !b) return 'needs a and b'
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1) return 'a wall needs to be at least 1 in long'
      const w: Wall = {
        id: op.id && !m.walls.some((x) => x.id === op.id) ? String(op.id) : newId('w'),
        level: levelOk(m, op.level, ctx),
        a: rv(a),
        b: rv(b),
        t: num(op.t) ?? 4.5,
        ...(num(op.h) !== undefined ? { h: num(op.h) } : {}),
        kind: op.kind === 'glass' || op.kind === 'half' || op.kind === 'rail' ? op.kind : 'wall',
        exterior: false,
        bearing: 'unknown',
        prov: { a: prov, b: prov, t: prov },
      }
      m.walls.push(w)
      return { model: m, geometry: true }
    }
    case 'update_wall': {
      const w = m.walls.find((x) => x.id === op.id)
      if (!w) return `no wall ${op.id}`
      if (op.bearing === 'no' && ctx.author !== 'user') return 'only a person can say a wall carries no load'
      const a = vec(op.a)
      const b = vec(op.b)
      if (a) {
        // Keep openings where they were in the plan when the start point moves along the wall.
        const shift = dot([a[0] - w.a[0], a[1] - w.a[1]], wallDir(w))
        for (const o of openingsOn(m, w.id)) o.at -= shift
        w.a = rv(a)
        w.prov.a = prov
      }
      if (b) {
        w.b = rv(b)
        w.prov.b = prov
      }
      if (num(op.t) !== undefined && num(op.t)! > 0) {
        w.t = num(op.t)!
        w.prov.t = prov
      }
      if (num(op.h) !== undefined) w.h = num(op.h)!
      if (op.kind) w.kind = op.kind === 'glass' || op.kind === 'half' || op.kind === 'rail' ? op.kind : 'wall'
      if (op.bearing === 'yes' || op.bearing === 'no' || op.bearing === 'unknown') {
        if (w.bearing === 'yes' && op.bearing === 'unknown' && ctx.author !== 'user') return 'software never clears a load-bearing mark'
        w.bearing = op.bearing
      }
      return { model: m, geometry: true }
    }
    case 'add_opening': {
      const w = m.walls.find((x) => x.id === op.wall)
      if (!w) return `no wall ${op.wall}`
      const L = wallLength(w)
      let at = num(op.at)
      const p = vec([op.x, op.y])
      if (at === undefined && p) at = dot([p[0] - w.a[0], p[1] - w.a[1]], wallDir(w))
      if (at === undefined) at = L / 2
      const kind: OpeningKind = op.kind === 'window' || op.kind === 'opening' || op.kind === 'garage' ? op.kind : 'door'
      const width = num(op.w) ?? (kind === 'window' ? 36 : 32)
      if (width > L) return `a ${width} in ${kind} does not fit on wall ${w.id} (${L.toFixed(1)} in long)`
      const sill = kind === 'window' ? (num(op.sill) ?? 36) : undefined
      const head = headHeight(kind, num(op.h), sill)
      const style: OpeningStyle = STYLES.includes(op.style) ? op.style : kind === 'window' ? 'double_hung' : kind === 'opening' ? 'cased' : 'swing'
      const o: Opening = {
        id: op.id && !m.openings.some((x) => x.id === op.id) ? String(op.id) : newId(kind === 'window' ? 'n' : 'd'),
        wall: w.id,
        kind,
        at: Math.max(width / 2, Math.min(L - width / 2, at)),
        w: width,
        h: head.h,
        ...(sill !== undefined ? { sill } : {}),
        style,
        ...(kind === 'door' && (style === 'swing' || style === 'french') ? { swing: swingFrom(op) ?? { hinge: 'a' as const, side: 'left' as const } } : {}),
        ...(op.shape === 'arch' ? { shape: 'arch' as const } : {}),
        prov: {
          at: prov,
          w: num(op.w) !== undefined ? prov : { src: 'default' },
          h: num(op.h) !== undefined ? prov : { src: 'default' },
          ...(sill !== undefined ? { sill: num(op.sill) !== undefined ? prov : { src: 'default' } } : {}),
          ...(kind === 'door' ? { swing: swingFrom(op) ? prov : { src: 'default' } } : {}),
        },
      }
      // Replace anything it overlaps on that wall.
      const before = openingsOn(m, w.id).length
      m.openings = m.openings.filter((x) => x.wall !== w.id || x.at + x.w / 2 <= o.at - o.w / 2 || x.at - x.w / 2 >= o.at + o.w / 2)
      const replaced = before - openingsOn(m, w.id).length
      m.openings.push(o)
      if (mayCarryLoad(w)) addLockedNote(m, `Engineer to confirm: the new ${kind} in wall ${w.id} needs a header sized for the load.`, w, ctx)
      return { model: m, geometry: true, note: [head.note, replaced ? `Replaced ${replaced} opening${replaced > 1 ? 's' : ''} it overlapped.` : ''].filter(Boolean).join(' ') || undefined }
    }
    case 'update_opening': {
      const o = m.openings.find((x) => x.id === op.id)
      if (!o) return `no opening ${op.id}`
      if (op.kind === 'door' || op.kind === 'window' || op.kind === 'opening' || op.kind === 'garage') o.kind = op.kind
      if (num(op.at) !== undefined) {
        o.at = num(op.at)!
        o.prov.at = prov
      }
      if (num(op.w) !== undefined) {
        const wall = m.walls.find((x) => x.id === o.wall)
        if (wall && num(op.w)! - o.w > 6 && mayCarryLoad(wall))
          addLockedNote(m, `Engineer to confirm: the ${o.kind} in wall ${wall.id} was widened to ${formatFeetInches(num(op.w)!)} and needs a header sized for the load.`, wall, ctx)
        o.w = num(op.w)!
        o.prov.w = prov
      }
      if (num(op.sill) !== undefined) {
        o.sill = num(op.sill)!
        o.prov.sill = prov
      }
      if (num(op.h) !== undefined) {
        const head = headHeight(o.kind, num(op.h), o.sill)
        o.h = head.h
        o.prov.h = prov
      }
      if (op.shape === 'arch' || op.shape === 'rectangle') o.shape = op.shape
      if (STYLES.includes(op.style)) o.style = op.style
      const sw = swingFrom(op)
      if (sw) {
        o.swing = sw
        o.prov.swing = prov
      }
      return { model: m, geometry: true }
    }
    case 'room':
    case 'rename_room': {
      const r = findRoom(m, op.id ?? op.name)
      if (!r) return `no room ${op.id ?? op.name}`
      const rename = op.rename ?? (op.op === 'rename_room' ? op.name : undefined)
      if (rename) {
        r.name = String(rename)
        r.flags = r.flags.filter((f) => f !== 'needs_name')
      }
      if ('theme' in op) {
        if (op.theme === null || op.theme === 'house') r.theme = null
        else if (m.themes[op.theme]) r.theme = op.theme
        else return `no theme ${op.theme}`
      }
      return { model: m, geometry: false }
    }
    case 'theme':
      return applyTheme(m, op)
    case 'house_theme': {
      if (!m.themes[op.theme]) return `no theme ${op.theme}`
      m.theme = op.theme
      return { model: m, geometry: false }
    }
    case 'ceiling':
    case 'set_level': {
      const h = num(op.op === 'ceiling' ? op.h : op.ceiling)
      const ft = num(op.floorThickness)
      if (h !== undefined && (h < 84 || h > 240)) return 'ceiling must be 7 ft to 20 ft'
      if (ft !== undefined && (ft < 0 || ft > 48)) return 'floor structure must be 0 to 48 in'
      const targets = op.op === 'set_level' && op.id ? m.levels.filter((l) => l.id === op.id) : ctx.focusLevel ? m.levels.filter((l) => l.id === ctx.focusLevel) : m.levels
      if (!targets.length) return `no level ${op.id ?? ctx.focusLevel}`
      for (const l of targets) {
        if (h !== undefined) {
          l.ceiling = h
          l.prov.ceiling = prov
        }
        if (ft !== undefined) {
          l.floorThickness = ft
          l.prov.floorThickness = prov
        }
      }
      restack(m)
      return { model: m, geometry: false }
    }
    case 'split_wall': {
      // Two walls where there was one (the Wall tool clicking on a wall): the joint becomes a corner.
      const w = m.walls.find((x) => x.id === op.id)
      if (!w) return `no wall ${op.id}`
      const L = wallLength(w)
      const p = vec(op.at) ?? vec([op.x, op.y])
      let s = num(op.s) ?? num(op.at)
      if (s === undefined && p) s = dot([p[0] - w.a[0], p[1] - w.a[1]], wallDir(w))
      if (s === undefined || s < 1 || s > L - 1) return 'split point must be inside the wall'
      const mine = openingsOn(m, w.id)
      if (mine.some((o) => s! > o.at - o.w / 2 && s! < o.at + o.w / 2)) return 'cannot split a wall inside an opening'
      const d = wallDir(w)
      const x = rv([w.a[0] + d[0] * s, w.a[1] + d[1] * s])
      const b: Wall = { ...structuredClone(w), id: op.newId && !m.walls.some((q) => q.id === op.newId) ? String(op.newId) : newId('w'), a: [...x] as Vec }
      w.b = [...x] as Vec
      m.walls.push(b)
      for (const o of mine)
        if (o.at > s) {
          o.wall = b.id
          o.at -= s
        }
      return { model: m, geometry: true }
    }
    case 'move_joint': {
      // Drag a wall endpoint: every wall ending at that point moves with it.
      const at = vec(op.at)
      const to = vec(op.to)
      if (!at || !to) return 'needs at and to'
      const ends = m.walls.flatMap((w) => (['a', 'b'] as const).filter((e) => Math.hypot(w[e][0] - at[0], w[e][1] - at[1]) <= 0.5).map((e) => ({ w, e })))
      if (!ends.length) return 'no wall ends there'
      const moved = Math.hypot(to[0] - at[0], to[1] - at[1])
      for (const { w, e } of ends) {
        if (moved > 6 && mayCarryLoad(w)) addLockedNote(m, `Engineer to confirm: wall ${w.id} may carry load and its end was moved ${moved.toFixed(1)} in.`, w, ctx)
        if (e === 'a') {
          const shift = dot([to[0] - w.a[0], to[1] - w.a[1]], wallDir(w))
          for (const o of openingsOn(m, w.id)) o.at -= shift
        }
        w[e] = rv(to)
        w.prov[e] = prov
        if (wallLength(w) < 1) return `wall ${w.id} would be shorter than 1 in`
      }
      return { model: m, geometry: true }
    }
    case 'dimension': {
      // A measurement left on the plan (Measure tool); kept until cleared.
      const a = vec(op.a)
      const b = vec(op.b)
      if (!a || !b) return 'needs a and b'
      const value = num(op.value) ?? Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * 8) / 8
      const d: Dimension = {
        id: op.id && !m.dimensions.some((x) => x.id === op.id) ? String(op.id) : newId('dim'),
        level: levelOk(m, op.level, ctx),
        a: rv(a),
        b: rv(b),
        value,
        text: String(op.text ?? formatFeetInches(value)),
        source: ctx.author === 'user' ? 'user' : 'auto',
        status: 'unresolved',
        binds: [],
      }
      m.dimensions.push(d)
      return { model: m, geometry: false }
    }
    case 'merge_rooms': {
      // Two rooms become one (the wall between them was removed): the dropped room's name goes, so the
      // next derivation gives the joined space the kept room's name and id.
      const keep = findRoom(m, op.keep)
      const drop = findRoom(m, op.drop)
      if (!keep || !drop || keep.id === drop.id) return 'needs two different rooms'
      m.rooms = m.rooms.filter((r) => r.id !== drop.id)
      if (op.name) keep.name = String(op.name)
      return { model: m, geometry: true }
    }
    case 'place': {
      const existing = op.id ? m.items.find((i) => i.id === op.id) : undefined
      if (op.id && !existing && !op.item) return `no item ${op.id}`
      const host = op.on ? m.items.find((i) => i.id === op.on) : null
      if (op.on && !host) return `no item ${op.on} to set it into`
      const spec: Record<string, any> = existing ?? op.item ?? {}
      const kind: ItemKind = (ITEM_KINDS as readonly string[]).includes(spec.kind) ? spec.kind : 'item'
      const w = num(spec.w) ?? SIZES[kind]?.[0] ?? 30
      const d = num(spec.d) ?? SIZES[kind]?.[1] ?? 24
      const room = op.room ? findRoom(m, op.room) : !host && existing ? (m.rooms.find((r) => r.level === existing.level && pointInPolygon([existing.x, existing.y], r.polygon)) ?? null) : null
      if (op.room && !room) return `no room ${op.room}`
      if (!host && !room) return 'say which room, or which item to set it into (on)'
      const align: Align | undefined = typeof op.align === 'object' && op.align ? { from: op.align.from === 'end' ? 'end' : 'start', in: num(op.align.in) ?? 0 } : ['center', 'start', 'end', 'window'].includes(op.align) ? op.align : undefined
      const p = placement(m, { w, d, room, against: op.against, on: host, align, offset: num(op.offset), facing: op.facing === 'back' ? 'back' : 'out', skip: new Set(existing ? [existing.id] : []) })
      if (typeof p === 'string') return p
      const level = host?.level ?? room!.level
      if (existing) {
        Object.assign(existing, { x: p.x, y: p.y, rot: p.rot, level, prov })
        if (p.anchor) existing.anchor = p.anchor
        else delete existing.anchor
        return { model: m, geometry: false }
      }
      return applyOne(m, { ...op.item, op: 'add_item', kind, w, d, x: p.x, y: p.y, rot: p.rot, level, ...(p.anchor ? { anchor: p.anchor } : {}) }, ctx)
    }
    case 'swap': {
      const a = m.items.find((i) => i.id === op.a)
      const b = m.items.find((i) => i.id === op.b)
      if (!a || !b) return `no item ${a ? op.b : op.a}`
      const s = swapPlaces(a, b)
      const [la, lb] = [a.level, b.level]
      for (const [it, to, lv] of [
        [a, s.a, lb],
        [b, s.b, la],
      ] as const) {
        Object.assign(it, { x: to.x, y: to.y, rot: to.rot, level: lv, prov })
        if (to.anchor) it.anchor = to.anchor
        else delete it.anchor
      }
      return { model: m, geometry: false }
    }
    case 'arrange': {
      const room = findRoom(m, op.room)
      if (!room) return `no room ${op.room}`
      if (!(LAYOUTS as readonly string[]).includes(op.layout)) return `no layout ${op.layout}`
      const r = arrangeOps(m, room, op.layout as Layout)
      let cur = m
      for (const sub of r.ops) {
        const res = applyOne(cur, sub as Op, ctx)
        if (typeof res !== 'string') cur = res.model
      }
      const said = [
        r.removed.length ? `Cleared ${r.removed.length} item${r.removed.length > 1 ? 's' : ''} from the ${room.name}.` : '',
        r.misses.length ? `Could not meet: ${r.misses.join('; ')}.` : '',
      ].filter(Boolean)
      return { model: cur, geometry: false, note: said.join(' ') || undefined }
    }
    case 'move_wall': {
      const w = m.walls.find((x) => x.id === op.id)
      if (!w) return `no wall ${op.id}`
      const left = wallLeft(w)
      const sideOf = (key: any) => {
        const room = findRoom(m, key)
        if (!room) return { room: null, side: 0 }
        const e = roomEdges(m, room).find((x) => x.wall?.id === w.id)
        return { room, side: e ? (e.side === 'left' ? 1 : -1) : 0 }
      }
      let across: number
      if (num(op.to) !== undefined) {
        const axis = isAxisAligned(w)
        if (!axis) return 'this wall runs at an angle; use by and toward'
        const cur = axis === 'v' ? (w.a[0] + w.b[0]) / 2 : (w.a[1] + w.b[1]) / 2
        across = (num(op.to)! - cur) * dot(axis === 'v' ? [1, 0] : [0, 1], left)
      } else if (num(op.by) !== undefined) {
        if (!op.toward) return 'say which room it moves toward (toward)'
        const { room, side } = sideOf(op.toward)
        if (!room) return `no room ${op.toward}`
        if (!side) return `wall ${w.id} is not a wall of the ${room.name}`
        across = num(op.by)! * side
      } else {
        const { room, side } = sideOf(op.so_that?.room)
        const clear = num(op.so_that?.clear)
        if (!room || clear === undefined) return 'so_that needs room and clear'
        if (!side) return `wall ${w.id} is not a wall of the ${room.name}`
        const ext = room.polygon.map((p) => dot(p, left))
        across = -side * (clear - (Math.max(...ext) - Math.min(...ext)))
      }
      if (Math.abs(across) < 1 / 16) return { model: m, geometry: false }
      return applyOne(m, { op: 'move', id: w.id, dx: left[0] * across, dy: left[1] * across }, ctx)
    }
    case 'set_dimension': {
      const room = findRoom(m, op.room)
      if (!room) return `no room ${op.room}`
      const axis: Vec = op.axis === 'y' ? [0, 1] : [1, 0]
      const value = num(op.value)!
      if (value < 12) return 'a room needs to be at least 1 ft across'
      const b = polygonBounds(room.polygon)
      const delta = value - (op.axis === 'y' ? b.y1 - b.y0 : b.x1 - b.x0)
      if (Math.abs(delta) < 1 / 16) return { model: m, geometry: false }
      const edges = roomEdges(m, room).filter((e) => e.wall)
      // The wall on the far (max) side has its inside facing back along the axis, and the reverse.
      const sideWall = (sign: 1 | -1) => edges.filter((e) => dot(e.inward, axis) * sign > 0.99).sort((p, q) => q.len - p.len)[0]?.wall
      const anchor = op.anchor === 'max' || op.anchor === 'center' ? op.anchor : 'min'
      const moves: [Wall | undefined, number][] =
        anchor === 'min' ? [[sideWall(-1), delta]] : anchor === 'max' ? [[sideWall(1), -delta]] : [[sideWall(-1), delta / 2], [sideWall(1), -delta / 2]]
      let cur = m
      for (const [wall, k] of moves) {
        if (!wall) return `could not find the ${room.name}'s wall on that side`
        const ww = cur.walls.find((x) => x.id === wall.id)!
        const across = k * dot(axis, wallLeft(ww))
        const r = applyOne(cur, { op: 'move', id: ww.id, dx: wallLeft(ww)[0] * across, dy: wallLeft(ww)[1] * across }, ctx)
        if (typeof r === 'string') return r
        cur = r.model
      }
      return { model: cur, geometry: true }
    }
    case 'join_walls': {
      const A = m.walls.find((x) => x.id === op.a)
      const B = m.walls.find((x) => x.id === op.b)
      if (!A || !B || A.id === B.id) return 'needs two different walls'
      if (A.level !== B.level) return 'the walls are on different levels'
      if (Math.abs(project(A, B.a).off) > 0.5 || Math.abs(project(A, B.b).off) > 0.5) return 'the walls do not run in one straight line'
      const ends = (['a', 'b'] as const).flatMap((ea) => (['a', 'b'] as const).filter((eb) => dist(A[ea], B[eb]) < 0.5).map((eb) => [ea, eb] as const))
      if (!ends.length) return 'the walls do not touch'
      const [ea, eb] = ends[0]
      const P = A[ea]
      const meets = m.walls.some((w) => w.id !== A.id && w.id !== B.id && w.level === A.level && (dist(w.a, P) < 1 || dist(w.b, P) < 1))
      if (meets) return 'another wall meets them there'
      const centers = m.openings.filter((o) => o.wall === A.id || o.wall === B.id).map((o) => ({ o, c: pointAt(o.wall === A.id ? A : B, o.at) }))
      const far = (w: Wall, e: 'a' | 'b'): Vec => (e === 'a' ? [...w.b] : [...w.a]) as Vec
      A.a = rv(far(A, ea))
      A.b = rv(far(B, eb))
      A.prov.a = prov
      A.prov.b = prov
      for (const { o, c } of centers) {
        o.wall = A.id
        o.at = Math.round(project(A, c).s * 100) / 100
      }
      m.walls = m.walls.filter((w) => w.id !== B.id)
      return { model: m, geometry: true }
    }
    case 'open_wall': {
      const w = m.walls.find((x) => x.id === op.id)
      if (!w) return `no wall ${op.id}`
      if (w.exterior) return 'wall is exterior; use a window or door'
      const L = wallLength(w)
      const inset = (P: Vec) =>
        Math.max(0, ...m.walls.filter((o) => o.id !== w.id && o.level === w.level && (dist(o.a, P) < 1 || dist(o.b, P) < 1 || (Math.abs(project(o, P).off) < 1 && project(o, P).s > 0 && project(o, P).s < wallLength(o)))).map((o) => o.t / 2))
      let from = op.full === true || op.full === 'true' ? inset(w.a) : num(op.from)
      let to = op.full === true || op.full === 'true' ? L - inset(w.b) : num(op.to)
      if (from === undefined || to === undefined) return 'needs from and to, or full'
      if (to < from) [from, to] = [to, from]
      from = Math.max(0, from)
      to = Math.min(L, to)
      const width = to - from
      if (width < 12) return 'an opening needs to be at least 1 ft wide'
      const lv = m.levels.find((l) => l.id === w.level)
      const ceiling = w.h ?? lv?.ceiling ?? 96
      const header = !(op.header === false || op.header === 'false')
      const removed = openingsOn(m, w.id).filter((o) => o.at + o.w / 2 > from! && o.at - o.w / 2 < to!)
      m.openings = m.openings.filter((o) => !removed.includes(o))
      m.openings.push({
        id: newId('d'),
        wall: w.id,
        kind: 'opening',
        at: Math.round(((from + to) / 2) * 100) / 100,
        w: Math.round(width * 100) / 100,
        h: header ? Math.min(ceiling - 12, 96) : ceiling,
        style: 'cased',
        prov: { at: prov, w: prov, h: prov },
      })
      if (mayCarryLoad(w)) addLockedNote(m, `Engineer to confirm: wall ${w.id} may carry load and was opened ${formatFeetInches(width)} wide.`, w, ctx)
      return { model: m, geometry: true, note: removed.length ? `Replaced ${removed.length} opening${removed.length > 1 ? 's' : ''} in that span.` : undefined }
    }
    case 'replace_opening': {
      const o = m.openings.find((x) => x.id === op.id)
      if (!o) return `no opening ${op.id}`
      const w = m.walls.find((x) => x.id === o.wall)!
      const kind = op.kind as OpeningKind
      if (kind === 'opening' && w.exterior) return 'an outside wall needs a door or window, not an open passage'
      const insideSide = (): 'left' | 'right' => {
        const c = pointAt(w, o.at)
        const n = wallLeft(w)
        const roomAt = (k: number) => m.rooms.some((r) => r.level === w.level && pointInPolygon(add(c, mul(n, k * (w.t / 2 + 12))), r.polygon))
        return roomAt(1) && !roomAt(-1) ? 'left' : roomAt(-1) && !roomAt(1) ? 'right' : (o.swing?.side ?? 'left')
      }
      const was = o.kind
      o.kind = kind
      if (kind === 'opening') {
        o.style = 'cased'
        delete o.swing
        delete o.sill
        delete o.prov.sill
        delete o.prov.swing
        if (o.h < 80) o.h = 80
      } else if (kind === 'door') {
        o.style = STYLES.includes(op.style) && !['fixed', 'casement', 'double_hung', 'slider', 'cased'].includes(op.style) ? op.style : 'swing'
        delete o.sill
        delete o.prov.sill
        if (was !== 'door') {
          o.h = 80
          o.prov.h = { src: 'default' }
        }
        if (o.style === 'swing' || o.style === 'french') {
          o.swing = o.swing ?? { hinge: 'a', side: insideSide() }
          o.prov.swing = o.prov.swing ?? { src: 'default' }
        } else {
          delete o.swing
          delete o.prov.swing
        }
      } else {
        o.style = STYLES.includes(op.style) && ['fixed', 'casement', 'double_hung', 'slider'].includes(op.style) ? op.style : 'double_hung'
        delete o.swing
        delete o.prov.swing
        if (was !== 'window') {
          o.sill = 36
          o.h = 84
          o.prov.sill = { src: 'default' }
          o.prov.h = { src: 'default' }
        }
      }
      if (num(op.w) !== undefined) {
        const r = applyOne(m, { op: 'update_opening', id: o.id, w: num(op.w) }, ctx)
        if (typeof r === 'string') return r
        const nw = num(op.w)!
        m.openings = m.openings.filter((x) => x === o || x.wall !== o.wall || x.at + x.w / 2 <= o.at - nw / 2 || x.at - x.w / 2 >= o.at + nw / 2)
      }
      return { model: m, geometry: true }
    }
    case 'set_swing': {
      const o = m.openings.find((x) => x.id === op.id)
      if (!o || o.kind !== 'door') return `no door ${op.id}`
      if (o.style !== 'swing' && o.style !== 'french') return `a ${o.style} door does not swing`
      const hinge = op.hinge === 'a' || op.hinge === 'b' ? op.hinge : (o.swing?.hinge ?? 'a')
      let side = op.side === 'left' || op.side === 'right' ? op.side : (o.swing?.side ?? 'left')
      if (op.into) {
        const room = findRoom(m, op.into)
        if (!room) return `no room ${op.into}`
        const w = m.walls.find((x) => x.id === o.wall)!
        const c = pointAt(w, o.at)
        const n = wallLeft(w)
        const k = w.t / 2 + 12
        if (pointInPolygon(add(c, mul(n, k)), room.polygon) && room.level === w.level) side = 'left'
        else if (pointInPolygon(add(c, mul(n, -k)), room.polygon) && room.level === w.level) side = 'right'
        else return `that door does not open into the ${room.name}`
      }
      o.swing = { hinge, side }
      o.prov.swing = prov
      return { model: m, geometry: true }
    }
    case 'flag_room': {
      const r = findRoom(m, op.id)
      if (!r) return `no room ${op.id}`
      const on = op.on === true || op.on === 'true'
      r.flags = on ? [...new Set([...r.flags, op.flag])] : r.flags.filter((f) => f !== op.flag)
      return { model: m, geometry: false }
    }
    case 'field_dimension': {
      const a = vec(op.a)!
      const b = vec(op.b)!
      const value = num(op.value)!
      const L = dist(a, b)
      if (L < 1) return 'the two points are the same'
      const axis: Vec = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
      const level = levelOk(m, op.level, ctx)
      // Bind each end to the wall face it was taken from (a face crossing the line within 3 in).
      const bindAt = (p: Vec, k: number): Dimension['binds'][number] | null => {
        let best: { id: string; which: 'left' | 'right'; miss: number } | null = null
        for (const w of m.walls) {
          if (w.level !== level || Math.abs(dot(wallDir(w), axis)) > 0.1) continue
          const s = project(w, p).s
          if (s < -1 || s > wallLength(w) + 1) continue
          for (const which of ['left', 'right'] as const) {
            const face = add(w.a, mul(wallLeft(w), (which === 'left' ? 1 : -1) * ((w.tMeasured ?? w.t) / 2)))
            const miss = Math.abs(dot(sub(face, a), axis) - k)
            if (miss <= 3 && (!best || miss < best.miss)) best = { id: w.id, which, miss }
          }
        }
        return best ? { kind: 'wall_face', id: best.id, which: best.which } : null
      }
      const b0 = bindAt(a, 0)
      const b1 = bindAt(b, L)
      const dim: Dimension = {
        id: newId('dim'),
        level,
        a: rv(a),
        b: rv(b),
        value,
        text: String(op.text ?? formatFeetInches(value)),
        source: 'field',
        status: 'unresolved',
        binds: b0 && b1 ? [b0, b1] : [],
      }
      let out = m
      let note: string | undefined
      if (b0 && b1) {
        const c0 = bindCoordinate(m, dim, 0)!
        const c1 = bindCoordinate(m, dim, 1)!
        const delta = value - Math.abs(c1 - c0)
        if (Math.abs(delta) > 0.25) {
          // Field measurements govern: move the end that is not an outside wall (the far end if both are alike).
          const w1 = m.walls.find((x) => x.id === b1.id)!
          const w0 = m.walls.find((x) => x.id === b0.id)!
          const moveFar = !(w1.exterior && !w0.exterior)
          const wall = moveFar ? w1 : w0
          const k = (moveFar ? 1 : -1) * delta * Math.sign(c1 - c0 || 1)
          const r = moveWall(m, wall.id, k * dot(axis, wallLeft(wall)), { src: 'field', ...(op.text ? { note: `field measured ${op.text}` } : {}) })
          if (!r.ok) return (r as { reason: string }).reason
          out = r.model
          note = `Moved wall ${wall.id} ${formatFeetInches(Math.abs(delta))} to match the measured ${dim.text}.`
        }
      } else note = `Kept the ${dim.text} measurement; it does not line up with two wall faces, so nothing moved.`
      out.dimensions.push(dim)
      return { model: out, geometry: true, note }
    }
    case 'note': {
      if (!op.text) return 'needs text'
      const note: Note = { id: newId('note'), text: String(op.text), author: ctx.author === 'ai' ? 'ai' : 'user', createdAt: ctx.now ?? new Date().toISOString() }
      m.notes = [...m.notes, note].slice(-60)
      return { model: m, geometry: false }
    }
    default:
      return 'unknown op'
  }
}

/** Window and door heights are head heights. A window "h" less than 24 in above its sill reads as a glass height (the v0.3 meaning) and is converted. */
function headHeight(kind: OpeningKind, h: number | undefined, sill: number | undefined): { h: number; note?: string } {
  if (kind === 'window') {
    const s = sill ?? 36
    if (h === undefined) return { h: 84 }
    if (h < s + 24) return { h: s + h, note: `Read ${h} in as the window's glass height; its head is at ${s + h} in.` }
    return { h }
  }
  return { h: h ?? 80 }
}

function swingFrom(op: Op): Opening['swing'] | undefined {
  const hinge = op.hinge === 'a' || op.hinge === 'b' ? op.hinge : op.swing?.hinge
  const side = op.side === 'left' || op.side === 'right' ? op.side : op.swing?.side
  if ((hinge === 'a' || hinge === 'b') && (side === 'left' || side === 'right')) return { hinge, side }
  return undefined
}

/** Level elevations follow the stack: each floor sits on the ceiling and floor structure below it. */
export function restack(m: Model) {
  const levels = [...m.levels].sort((a, b) => a.elev - b.elev)
  for (let i = 1; i < levels.length; i++) {
    const below = levels[i - 1]
    levels[i].elev = below.elev + below.ceiling + below.floorThickness
  }
}

/** Structural cautions are notes a person cannot remove (only acknowledge). */
/** Exterior walls and any wall not marked as carrying no load (04, 10 structural cautions). */
export const mayCarryLoad = (w: Wall) => w.exterior || w.bearing !== 'no'

function addLockedNote(m: Model, text: string, w: Wall, ctx: OpContext) {
  if (m.notes.some((n) => n.text === text)) return
  const p: Vec = rv([(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2])
  m.notes.push({ id: newId('note'), text, author: ctx.author === 'ai' ? 'ai' : 'user', createdAt: ctx.now ?? new Date().toISOString(), locked: true, at: { level: w.level, p } })
}

function applyTheme(m: Model, op: Op): Applied | string {
  let t: Theme | undefined = op.id ? m.themes[op.id] : undefined
  if (!t) {
    if (op.id && !op.name) return `no theme ${op.id}`
    const id = op.id && !m.themes[op.id] ? String(op.id) : `theme-${slug(op.name || 'new')}-${Date.now().toString(36).slice(-4)}`
    t = { id, name: String(op.name || 'New theme'), data: { palette: [] } }
    m.themes[id] = t
  } else t = structuredClone(t)
  const d = t.data
  if (op.name) t.name = String(op.name)
  if (typeof op.description === 'string') d.description = op.description
  if (typeof op.scope === 'string') d.scope = op.scope
  if (Array.isArray(op.palette)) d.palette = op.palette.filter((p: any) => p && /^#[0-9a-f]{6}$/i.test(p.hex))
  if (Array.isArray(op.materials)) d.materials = op.materials
  if (Array.isArray(op.avoid)) d.avoid = op.avoid.map(String)
  if (op.lighting && typeof op.lighting === 'object') d.lighting = op.lighting
  if (Array.isArray(op.images)) d.images = [...(d.images ?? []), ...op.images.filter((i: any) => i?.path || i?.url)]
  if (op.finishes && typeof op.finishes === 'object') {
    d.finishes = { ...(d.finishes ?? {}) }
    for (const [role, f] of Object.entries<any>(op.finishes)) {
      if (!(ROLES as readonly string[]).includes(role) || !f) continue
      const fin: any = {}
      if (typeof f === 'string') {
        if (/^#[0-9a-f]{6}$/i.test(f)) fin.color = f
        else fin.library = f.replace(/^library:/, '')
      } else {
        if (f.color && /^#[0-9a-f]{6}$/i.test(f.color)) fin.color = f.color
        if (f.library) fin.library = String(f.library).replace(/^library:/, '')
        if (f.note) fin.note = String(f.note)
      }
      ;(d.finishes as Record<Role, any>)[role as Role] = fin
      if (fin.color) {
        const pal = d.palette.find((p) => p.role === role)
        if (pal) pal.hex = fin.color
        else d.palette.push({ name: f.name || role, hex: fin.color, role })
      }
    }
  }
  m.themes[t.id] = t
  const applyTo = op.apply_to ?? op.applyTo
  const targets: string[] = Array.isArray(applyTo) ? applyTo : applyTo ? [applyTo] : []
  for (const target of targets) {
    if (target === 'house') m.theme = t.id
    else {
      const r = findRoom(m, target)
      if (r) r.theme = t.id
    }
  }
  return { model: m, geometry: false }
}

/** Clear width and depth of a room's bounding box, for summaries and tests. */
export function roomSize(m: Model, roomId: string) {
  const r = m.rooms.find((x) => x.id === roomId || x.name === roomId)
  if (!r) return null
  const b = polygonBounds(r.polygon)
  return { x: Math.round((b.x1 - b.x0) * 100) / 100, y: Math.round((b.y1 - b.y0) * 100) / 100 }
}
