// What Velda sees of the model (07 section 2): every level and room in one line each, and the rooms
// the conversation is about in full (walls as the room sees them, openings with their swings, items
// with the wall they stand against), plus the theme, inspiration, open checks and recent versions.
// Under 6 KB for the whole house.
import type { Issue } from '../analysis/checks'
import { roomsAcross } from '../analysis/space'
import { pointAt, pointInPolygon, polygonArea, polygonBounds } from '../model/geom'
import { type RoomEdge, roomEdges } from '../model/place'
import { type Item, type Model, type Room, type Vec, badgeOf } from '../model/types'
import { formatFeetInches as ft } from '../model/units'
import { themeBrief } from '../lib/theme'

const r = (v: number) => Math.round(v)
const pt = (p: Vec) => `(${r(p[0])},${r(p[1])})`

export type SummaryOpts = {
  /** The room the person has selected. */
  focusRoomId?: string | null
  focusLevel?: string | null
  /** The person's message: rooms and fixtures it names get full detail too. */
  text?: string
  checks?: Issue[]
  recentVersions?: string[]
}

/** Which rooms get full detail: the focused one, then rooms or fixtures the message names (at most 3). */
export function roomsInDetail(m: Model, opts: SummaryOpts): Room[] {
  const out: Room[] = []
  const addRoom = (x: Room | undefined) => x && !out.includes(x) && out.length < 3 && out.push(x)
  addRoom(m.rooms.find((x) => x.id === opts.focusRoomId))
  const text = (opts.text ?? '').toLowerCase()
  if (text) {
    for (const room of [...m.rooms].sort((a, b) => b.name.length - a.name.length)) if (room.name.length > 2 && text.includes(room.name.toLowerCase())) addRoom(room)
    for (const it of m.items) {
      const words = [it.kind.replace('_', ' '), ...(it.label ? [it.label.toLowerCase()] : []), ...(KIND_WORDS[it.kind] ?? [])]
      if (words.some((w) => w && new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(text))) addRoom(roomAt(m, it))
    }
  }
  return out
}

const KIND_WORDS: Partial<Record<Item['kind'], string[]>> = {
  fridge: ['fridge', 'refrigerator'],
  range: ['range', 'stove', 'cooktop', 'oven'],
  oven_tower: ['oven', 'tower'],
  sink: ['sink'],
  island: ['island'],
  dishwasher: ['dishwasher'],
  toilet: ['toilet', 'wc'],
  tub: ['tub', 'bath tub', 'bathtub'],
  shower: ['shower'],
  vanity: ['vanity'],
  washer: ['washer', 'laundry'],
  dryer: ['dryer'],
}

export function roomAt(m: Model, it: { level: string; x: number; y: number }) {
  return m.rooms.find((x) => x.level === it.level && x.polygon.length >= 3 && pointInPolygon([it.x, it.y], x.polygon))
}

/** "top", "left" ... the side of the room a wall is on, on the sheet (not a compass direction). */
function sideWord(e: RoomEdge) {
  const [x, y] = e.inward
  if (y > 0.9) return 'top'
  if (y < -0.9) return 'bottom'
  if (x > 0.9) return 'left'
  if (x < -0.9) return 'right'
  return 'angled'
}

/** The wall an item stands against (its back within 2 in of a wall face of its room). */
export function itemWall(m: Model, it: Item, edges?: RoomEdge[]) {
  const room = roomAt(m, it)
  if (!room) return null
  const rad = (it.rot * Math.PI) / 180
  const f: Vec = [Math.sin(rad), Math.cos(rad)]
  const back: Vec = [it.x - (f[0] * it.d) / 2, it.y - (f[1] * it.d) / 2]
  for (const e of edges ?? roomEdges(m, room)) {
    if (!e.wall) continue
    const off = (back[0] - e.a[0]) * e.inward[0] + (back[1] - e.a[1]) * e.inward[1]
    const along = (back[0] - e.a[0]) * e.dir[0] + (back[1] - e.a[1]) * e.dir[1]
    if (Math.abs(off) <= 2 && along > -1 && along < e.len + 1 && f[0] * e.inward[0] + f[1] * e.inward[1] > 0.9) return { edge: e, at: along }
  }
  return null
}

/** The item an item is set into (a sink in an island or counter). */
function hostOf(m: Model, it: Item) {
  if (!['sink', 'cooktop', 'range', 'dishwasher'].includes(it.kind)) return null
  return m.items.find((x) => x.id !== it.id && x.level === it.level && ['island', 'base_cabinet', 'vanity'].includes(x.kind) && x.w * x.d > it.w * it.d && insideItem([it.x, it.y], x)) ?? null
}
function insideItem(p: Vec, h: Item) {
  const a = (h.rot * Math.PI) / 180
  const dx = p[0] - h.x
  const dy = p[1] - h.y
  const s = dx * Math.cos(a) - dy * Math.sin(a)
  const f = dx * Math.sin(a) + dy * Math.cos(a)
  return Math.abs(s) <= h.w / 2 && Math.abs(f) <= h.d / 2
}

function roomLine(m: Model, room: Room) {
  const b = polygonBounds(room.polygon)
  const flags = room.flags.filter((f) => f !== 'open_outline').map((f) => f.replace(/_/g, ' '))
  return `${room.id} "${room.name}" ${ft(b.x1 - b.x0)} x ${ft(b.y1 - b.y0)} (${r(polygonArea(room.polygon) / 144)} sf)${room.theme ? `, theme ${room.theme}` : ''}${flags.length ? `, ${flags.join(', ')}` : ''}`
}

function roomDetail(m: Model, room: Room, focused: boolean): string[] {
  const out = [`ROOM ${roomLine(m, room)}${focused ? ' <- FOCUSED' : ''}`]
  const edges = roomEdges(m, room)
  out.push('  walls (each from its start to its end as the outline runs; "a" is the wall\'s own start):')
  for (const e of edges) {
    if (!e.wall) {
      out.push(`  - open side ${pt(e.a)}->${pt(e.b)}`)
      continue
    }
    const w = e.wall
    const props = [w.exterior ? 'exterior' : 'interior', `${w.t}"`, `bearing ${w.bearing}`, w.kind !== 'wall' ? w.kind : ''].filter(Boolean).join(', ')
    out.push(`  - ${w.id} ${sideWord(e)} wall (${props}) face ${pt(e.a)}->${pt(e.b)} ${ft(e.len)}; wall a ${pt(w.a)} b ${pt(w.b)}`)
    for (const { o } of e.openings) {
      const [left, right] = roomsAcross(m, o)
      const into = o.swing ? (o.swing.side === 'left' ? left : right) : null
      const assumed = o.kind === 'window' && (badgeOf(o.prov.h) === 'assumed' || badgeOf(o.prov.sill) === 'assumed') ? ' (heights assumed)' : ''
      const c = pointAt(w, o.at)
      out.push(
        `    ${o.id} ${o.kind} ${o.style} ${ft(o.w)} at ${r(o.at)} from a ${pt(c)}${o.kind === 'window' ? `, sill ${o.sill ?? 36} head ${r(o.h)}${assumed}` : `, head ${r(o.h)}`}${o.swing ? `, hinge ${o.swing.hinge}, swings into ${into?.name ?? 'outside'}` : ''}`,
      )
    }
  }
  const items = m.items.filter((it) => roomAt(m, it)?.id === room.id)
  if (items.length) out.push('  items:')
  for (const it of items) {
    const host = hostOf(m, it)
    const wall = host ? null : itemWall(m, it, edges)
    out.push(
      `  - ${it.id} ${it.kind}${it.label ? ` "${it.label}"` : ''} ${r(it.w)}w ${r(it.d)}d ${r(it.h)}h at ${pt([it.x, it.y])} rot ${r(it.rot)}${it.z ? ` z ${r(it.z)}` : ''}${host ? `, set into ${host.id}` : wall ? `, against ${wall.edge.wall!.id}` : ''}${it.catalog ? `, model ${it.catalog}` : ''}`,
    )
  }
  return out
}

export function describeModel(m: Model, opts: SummaryOpts = {}): string {
  const out: string[] = []
  out.push('Plan inches; x grows right, y grows down the sheet. Item rot: 0 faces +y (down the sheet), 90 faces +x. Opening h is the head height; sill is floor to glass.')
  out.push(m.project.north == null ? 'North is not set: use top, bottom, left, right of the plan, never compass words.' : `North is ${r(m.project.north)} degrees clockwise from the top of the sheet.`)
  for (const lv of [...m.levels].sort((a, b) => a.elev - b.elev)) {
    const ceiling = `${ft(lv.ceiling)}${badgeOf(lv.prov.ceiling) === 'assumed' ? ' (assumed)' : ''}`
    out.push('', `LEVEL ${lv.id} "${lv.name}", ceiling ${ceiling}. Rooms:`)
    for (const room of m.rooms.filter((x) => x.level === lv.id)) out.push(`- ${roomLine(m, room)}`)
  }
  const detail = roomsInDetail(m, opts)
  if (detail.length) {
    out.push('')
    for (const room of detail) out.push(...roomDetail(m, room, room.id === opts.focusRoomId), '')
  } else {
    out.push('', 'No room is focused; ask which room, or name one, before changing walls.')
  }
  const theme = m.theme ? m.themes[m.theme] : null
  const themes = new Set([m.theme, ...detail.map((x) => x.theme)].filter(Boolean) as string[])
  if (themes.size) {
    out.push(`THEMES (house: ${theme?.name ?? 'none'}):`)
    for (const id of themes) if (m.themes[id]) out.push(`- [${id}] ${themeBrief(m.themes[id]).split('\n').slice(0, 3).join(' ')}`)
  }
  // Inspiration for the rooms in detail (or the whole house), boards first; each with its sampled colors.
  const insp = (m.inspiration ?? [])
    .filter((x) => (detail.length ? x.rooms.some((id) => detail.some((d) => d.id === id)) : true))
    .sort((a, b) => Number(b.kind === 'board') - Number(a.kind === 'board'))
    .slice(0, 12)
  if (insp.length)
    out.push(
      `INSPIRATION (${insp.length} of ${m.inspiration.length} cards):`,
      ...insp.map((x) => {
        const words = [...x.tags.style, ...x.tags.materials, ...x.tags.fixtures].slice(0, 7).join(', ')
        const colors = x.tags.palette.slice(0, 5).map((p) => `${p.hex}${p.name ? ` ${p.name}` : ''}`).join(', ')
        return `- ${x.id} ${x.kind}${x.parent ? ` in ${x.parent}` : ''} "${x.title ?? ''}"${x.source ? ` (${x.source})` : ''}${words ? `: ${words}` : ''}${colors ? `; colors ${colors}` : ''}`
      }),
    )
  const checks = (opts.checks ?? []).filter((i) => !detail.length || detail.some((d) => d.id === i.where.room)).slice(0, 10)
  if (checks.length) out.push('OPEN CHECKS:', ...checks.map((i) => `- ${i.severity === 'blocks' ? 'code' : i.severity === 'fix' ? 'should fix' : 'note'}: ${i.message}`))
  const notes = m.notes.filter((n) => n.locked).slice(-6)
  if (notes.length) out.push('ENGINEER NOTES (cannot be removed):', ...notes.map((n) => `- ${n.text}`))
  if (opts.recentVersions?.length) out.push(`RECENT VERSIONS (newest last): ${opts.recentVersions.slice(-5).join('; ')}`)
  return out.join('\n')
}
