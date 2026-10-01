// Operations Velda returns to change the model. Each is plain JSON in inches and plan coordinates.
// applyOps never throws on one bad op: it skips it and reports why, so the rest still lands.

import {
  type ItemKind,
  type StudioItem,
  type StudioModel,
  type StudioOpening,
  type StudioWall,
  type Vec,
  clone,
  sid,
  wallLength,
} from './model'
import { ROLES, type Theme, slug } from './theme'

export type Op = Record<string, any> & { op: string }
export type OpResult = { model: StudioModel; applied: number; skipped: string[] }

const ITEM_KINDS: ItemKind[] = [
  'base_cabinet',
  'island',
  'vanity',
  'sink',
  'range',
  'cooktop',
  'dishwasher',
  'fridge',
  'oven_tower',
  'tall_cabinet',
  'wall_cabinet',
  'hood',
  'tub',
  'shower',
  'toilet',
  'bench',
  'glass',
  'beam',
  'item',
]

const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : undefined)
const vec = (v: any): Vec | undefined => (Array.isArray(v) && v.length >= 2 && num(v[0]) !== undefined && num(v[1]) !== undefined ? [num(v[0])!, num(v[1])!] : undefined)

export function applyOps(input: StudioModel, ops: Op[]): OpResult {
  const model = clone(input)
  model.themes = model.themes ?? {}
  const skipped: string[] = []
  let applied = 0
  for (const op of ops ?? []) {
    try {
      const why = applyOne(model, op)
      if (why) skipped.push(`${op.op}: ${why}`)
      else applied++
    } catch (e) {
      skipped.push(`${op?.op}: ${(e as Error).message}`)
    }
  }
  return { model, applied, skipped }
}

function findItem(m: StudioModel, id: any) {
  return m.items.find((i) => i.id === id)
}
function findWall(m: StudioModel, id: any) {
  return m.walls.find((w) => w.id === id)
}
function findOpening(m: StudioModel, id: any): { wall: StudioWall; o: StudioOpening } | null {
  for (const wall of m.walls) {
    const o = wall.openings.find((x) => x.id === id)
    if (o) return { wall, o }
  }
  return null
}
function findRoom(m: StudioModel, key: any) {
  if (!key) return null
  const k = String(key).toLowerCase()
  return m.rooms.find((r) => r.id === key) ?? m.rooms.find((r) => r.name.toLowerCase() === k) ?? m.rooms.find((r) => r.name.toLowerCase().includes(k)) ?? null
}
function levelOk(m: StudioModel, level: any) {
  return m.levels.some((l) => l.id === level) ? level : m.levels[0].id
}

function applyOne(m: StudioModel, op: Op): string | null {
  switch (op.op) {
    case 'move': {
      const it = findItem(m, op.id)
      if (it) {
        const x = num(op.x)
        const y = num(op.y)
        if (x !== undefined) it.x = x
        if (y !== undefined) it.y = y
        it.x += num(op.dx) ?? 0
        it.y += num(op.dy) ?? 0
        if (num(op.rot) !== undefined) it.rot = num(op.rot)!
        if (op.level) it.level = levelOk(m, op.level)
        return null
      }
      const w = findWall(m, op.id)
      if (w) {
        const dx = num(op.dx) ?? 0
        const dy = num(op.dy) ?? 0
        w.a = [w.a[0] + dx, w.a[1] + dy]
        w.b = [w.b[0] + dx, w.b[1] + dy]
        return null
      }
      const fo = findOpening(m, op.id)
      if (fo) {
        if (num(op.at) !== undefined) fo.o.at = num(op.at)!
        if (num(op.dat) !== undefined) fo.o.at += num(op.dat)!
        return null
      }
      return `nothing with id ${op.id}`
    }
    case 'resize': {
      const it = findItem(m, op.id)
      if (!it) return `no item ${op.id}`
      const w = num(op.w)
      if (w !== undefined && w > 0) {
        // Keep one end fixed if asked: shift the center along the item's width axis.
        const grow = w - it.w
        const anchor = op.anchor
        if (anchor === 'left' || anchor === 'right') {
          const yaw = (it.rot * Math.PI) / 180
          const sign = anchor === 'left' ? 1 : -1
          it.x += (Math.cos(yaw) * grow * sign) / 2
          it.y += (-Math.sin(yaw) * grow * sign) / 2
        }
        it.w = w
      }
      if (num(op.d) !== undefined && num(op.d)! > 0) it.d = num(op.d)!
      if (num(op.h) !== undefined && num(op.h)! > 0) it.h = num(op.h)!
      if (num(op.z) !== undefined) it.z = num(op.z)!
      return null
    }
    case 'delete':
    case 'remove': {
      const before = m.items.length + m.walls.length
      m.items = m.items.filter((i) => i.id !== op.id)
      m.walls = m.walls.filter((w) => w.id !== op.id)
      if (m.items.length + m.walls.length !== before) return null
      const fo = findOpening(m, op.id)
      if (fo) {
        fo.wall.openings = fo.wall.openings.filter((o) => o.id !== op.id)
        return null
      }
      const room = findRoom(m, op.id)
      if (room) {
        m.rooms = m.rooms.filter((r) => r !== room)
        return null
      }
      return `nothing with id ${op.id}`
    }
    case 'add_item': {
      const kind: ItemKind = ITEM_KINDS.includes(op.kind) ? op.kind : 'item'
      const x = num(op.x)
      const y = num(op.y)
      if (x === undefined || y === undefined) return 'needs x and y'
      const it: StudioItem = {
        id: op.id && !findItem(m, op.id) ? String(op.id) : sid('i'),
        level: levelOk(m, op.level),
        kind,
        label: String(op.label || kind.replace('_', ' ')),
        x,
        y,
        rot: num(op.rot) ?? 0,
        w: num(op.w) ?? 30,
        d: num(op.d) ?? 24,
        h: num(op.h) ?? 36,
        ...(num(op.z) !== undefined ? { z: num(op.z) } : {}),
        ...(op.catalog ? { catalog: String(op.catalog) } : {}),
        ...(op.props && typeof op.props === 'object' ? { props: op.props } : {}),
      }
      m.items.push(it)
      return null
    }
    case 'update_item': {
      const it = findItem(m, op.id)
      if (!it) return `no item ${op.id}`
      if (op.label) it.label = String(op.label)
      if (op.kind && ITEM_KINDS.includes(op.kind)) it.kind = op.kind
      if (op.catalog) it.catalog = String(op.catalog)
      for (const k of ['x', 'y', 'rot', 'w', 'd', 'h', 'z'] as const) if (num(op[k]) !== undefined) (it as any)[k] = num(op[k])
      if (op.props && typeof op.props === 'object') it.props = { ...(it.props ?? {}), ...op.props }
      return null
    }
    case 'add_wall': {
      const a = vec(op.a)
      const b = vec(op.b)
      if (!a || !b) return 'needs a and b'
      m.walls.push({
        id: op.id && !findWall(m, op.id) ? String(op.id) : sid('w'),
        level: levelOk(m, op.level),
        a,
        b,
        t: num(op.t) ?? 4.5,
        ...(num(op.h) !== undefined ? { h: num(op.h) } : {}),
        ...(op.kind === 'glass' || op.kind === 'half' ? { kind: op.kind } : {}),
        openings: [],
      })
      return null
    }
    case 'update_wall': {
      const w = findWall(m, op.id)
      if (!w) return `no wall ${op.id}`
      const a = vec(op.a)
      const b = vec(op.b)
      const oldLen = wallLength(w)
      if (a) w.a = a
      if (b) w.b = b
      if (num(op.t) !== undefined) w.t = num(op.t)!
      if (num(op.h) !== undefined) w.h = num(op.h)!
      if (op.kind) w.kind = op.kind === 'glass' || op.kind === 'half' ? op.kind : 'wall'
      // If the start point moved along the wall, keep openings where they were in the room.
      if (a && !b) {
        const shift = oldLen - wallLength(w)
        for (const o of w.openings) o.at -= shift
      }
      return null
    }
    case 'add_opening': {
      const w = findWall(m, op.wall)
      if (!w) return `no wall ${op.wall}`
      const len = wallLength(w)
      let at = num(op.at)
      const p = vec([op.x, op.y])
      if (at === undefined && p) {
        const dx = (w.b[0] - w.a[0]) / len
        const dy = (w.b[1] - w.a[1]) / len
        at = (p[0] - w.a[0]) * dx + (p[1] - w.a[1]) * dy
      }
      if (at === undefined) at = len / 2
      const kind = op.kind === 'window' || op.kind === 'opening' ? op.kind : 'door'
      const width = Math.min(num(op.w) ?? (kind === 'window' ? 36 : 32), len - 2)
      const o: StudioOpening = {
        id: op.id ? String(op.id) : sid(kind === 'window' ? 'n' : 'd'),
        kind,
        at: Math.max(width / 2, Math.min(len - width / 2, at)),
        w: width,
        h: num(op.h) ?? (kind === 'window' ? 48 : 80),
        ...(kind === 'window' ? { sill: num(op.sill) ?? 36 } : {}),
        ...(op.shape === 'arch' ? { shape: 'arch' as const } : {}),
        ...(['swing', 'pocket', 'sliding', 'french'].includes(op.style) ? { style: op.style } : {}),
      }
      // Replace anything it overlaps.
      w.openings = w.openings.filter((x) => x.at + x.w / 2 <= o.at - o.w / 2 || x.at - x.w / 2 >= o.at + o.w / 2)
      w.openings.push(o)
      w.openings.sort((a1, b1) => a1.at - b1.at)
      return null
    }
    case 'update_opening': {
      const fo = findOpening(m, op.id)
      if (!fo) return `no opening ${op.id}`
      const { o } = fo
      for (const k of ['at', 'w', 'h', 'sill'] as const) if (num(op[k]) !== undefined) (o as any)[k] = num(op[k])
      if (op.kind === 'door' || op.kind === 'window' || op.kind === 'opening') o.kind = op.kind
      if (op.shape === 'arch' || op.shape === 'rectangle') o.shape = op.shape
      if (['swing', 'pocket', 'sliding', 'french'].includes(op.style)) o.style = op.style
      return null
    }
    case 'room': {
      const r = findRoom(m, op.id ?? op.name)
      if (!r) return `no room ${op.id ?? op.name}`
      if (op.rename) r.name = String(op.rename)
      if ('theme' in op) {
        if (op.theme === null || op.theme === 'house') r.theme = null
        else if (m.themes[op.theme]) r.theme = op.theme
        else return `no theme ${op.theme}`
      }
      return null
    }
    case 'theme': {
      let t: Theme | undefined = op.id ? m.themes[op.id] : undefined
      if (!t) {
        if (op.id && !op.name) return `no theme ${op.id}`
        const id = op.id && !m.themes[op.id] ? String(op.id) : `theme-${slug(op.name || 'new')}-${Date.now().toString(36).slice(-4)}`
        t = { id, name: String(op.name || 'New theme'), data: { palette: [] } }
        m.themes[id] = t
      } else t = clone(t)
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
          ;(d.finishes as any)[role] = fin
          // Keep the palette in step so swatches show the change.
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
      return null
    }
    case 'house_theme': {
      if (!m.themes[op.theme]) return `no theme ${op.theme}`
      m.theme = op.theme
      return null
    }
    case 'ceiling': {
      const h = num(op.h)
      if (!h || h < 84 || h > 240) return 'ceiling must be 84 to 240 inches'
      m.ceiling = h
      return null
    }
    case 'note': {
      if (op.text) m.notes = [...(m.notes ?? []), String(op.text)].slice(-30)
      return null
    }
    default:
      return 'unknown op'
  }
}
