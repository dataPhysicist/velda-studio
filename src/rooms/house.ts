// The house as the floor plans have it: the rooms, their real sizes, what stands in them, the style
// direction on file, and what the plan checker says. This is what ties a photo to the measured house.
import { checksFor, type Issue } from '../analysis/checks'
import { itemWall, sideWord } from '../ai/summary'
import { changeLog } from '../export/changes'
import type { Theme } from '../lib/theme'
import { pointInPolygon, polygonArea, polygonBounds } from '../model/geom'
import { migrateV1 } from '../model/migrate'
import { roomEdges } from '../model/place'
import type { Item, Model, Room } from '../model/types'
import { formatFeetInches } from '../model/units'
import { lit } from '../toolbelt'
import type { Backend } from './backend'

export type RoomKind = 'bath' | 'kitchen' | 'bedroom' | 'laundry' | 'closet' | 'living' | 'hall' | 'outside' | 'other'

export type RoomInfo = {
  id: string
  name: string
  level: string
  levelName: string
  kind: RoomKind
  /** Clear size across and down the sheet, inches. */
  w: number
  d: number
  sf: number
  ceiling: number | null
  /** Closets and other small rooms sort after the rooms people photograph. */
  minor: boolean
}

export type Plan = { id: string; name: string; model: Model }
export type House = { name: string; asBuilt: Model; asBuiltName: string; plans: Plan[]; rooms: RoomInfo[] }

const ft = (v: number) => formatFeetInches(v).replace(/^0'-/, '')

export function kindOf(name: string): RoomKind {
  const n = name.toLowerCase()
  if (/bath|powder|shower|\bwc\b|toilet|jack/.test(n)) return 'bath'
  if (/kitchen|pantry|scullery/.test(n)) return 'kitchen'
  if (/closet|w\.?i\.?c|linen|storage|i\.?t\.?\b|mech/.test(n)) return 'closet'
  if (/bed|nursery|guest room/.test(n)) return 'bedroom'
  if (/laundry|mud/.test(n)) return 'laundry'
  if (/living|family|great|den|dining|office|study|library|sun|bonus|play|media|game|loft|sitting|breakfast|nook/.test(n)) return 'living'
  if (/hall|stair|foyer|entry|landing|corridor|vestibule/.test(n)) return 'hall'
  if (/garage|deck|porch|patio|balcony|terrace/.test(n)) return 'outside'
  return 'other'
}

export function roomsOf(m: Model): RoomInfo[] {
  const out: RoomInfo[] = []
  for (const r of m.rooms) {
    if (r.polygon.length < 3) continue
    const b = polygonBounds(r.polygon)
    const lv = m.levels.find((l) => l.id === r.level)
    const sf = Math.round(Math.abs(polygonArea(r.polygon)) / 144)
    const kind = kindOf(r.name)
    out.push({
      id: r.id,
      name: r.name,
      level: r.level,
      levelName: lv?.name ?? r.level,
      kind,
      w: b.x1 - b.x0,
      d: b.y1 - b.y0,
      sf,
      ceiling: r.ceiling ?? lv?.ceiling ?? null,
      minor: kind === 'closet' || sf < 22 || /^room \d+$/i.test(r.name),
    })
  }
  const order = (l: string) => m.levels.findIndex((x) => x.id === l)
  return out.sort((a, b) => order(a.level) - order(b.level) || Number(a.minor) - Number(b.minor) || b.sf - a.sf)
}

export const sizeWords = (r: RoomInfo) => `${ft(r.w)} by ${ft(r.d)}`

const inRoom = (m: Model, room: Room) => m.items.filter((it) => it.level === room.level && pointInPolygon([it.x, it.y], room.polygon))
const itemName = (it: Item) => (it.label || it.kind.replace(/_/g, ' ')).split(/,\s/)[0]

/** The room in words, from the plan: size, ceiling, each wall's windows and doors, and the fixtures with their sizes. */
export function roomFacts(m: Model, roomId: string): string {
  const room = m.rooms.find((r) => r.id === roomId)
  if (!room) return ''
  const info = roomsOf(m).find((r) => r.id === roomId)!
  const lines = [`The ${room.name} (${info.levelName}): ${sizeWords(info)}, about ${info.sf} square feet${info.ceiling ? `, ceiling ${ft(info.ceiling)}` : ''}.`]
  const walls: string[] = []
  for (const e of roomEdges(m, room)) {
    if (e.len < 18) continue
    const bits: string[] = []
    for (const { o } of e.openings) bits.push(o.kind === 'window' ? `a ${ft(o.w)} window` : o.kind === 'opening' ? `a ${ft(o.w)} open passage` : `a ${ft(o.w)} door`)
    const side = sideWord(e)
    walls.push(`${side} wall ${ft(e.len)}${e.wall?.exterior ? ' (outside wall)' : ''}${bits.length ? ` with ${bits.join(' and ')}` : ''}`)
  }
  if (walls.length) lines.push(`Walls as drawn on the plan: ${walls.join('; ')}.`)
  const items = inRoom(m, room).filter((it) => it.w >= 6 && !it.demolish)
  if (items.length)
    lines.push(
      `On the plan it holds: ${items
        .slice(0, 12)
        .map((it) => {
          const w = itemWall(m, it)
          return `${itemName(it)} ${ft(it.w)} by ${ft(it.d)}${w?.edge.wall ? ` on the ${sideWord(w.edge)} wall` : ''}`
        })
        .join('; ')}.`,
    )
  return lines.join('\n')
}

export function themeOf(m: Model, roomId: string): Theme | null {
  const room = m.rooms.find((r) => r.id === roomId)
  return (room?.theme && m.themes[room.theme]) || (m.theme ? m.themes[m.theme] : null) || null
}

/** The style direction for a room in a few plain lines (for Velda and for the image model). */
export function styleWords(t: Theme | null): string {
  if (!t) return ''
  const d = t.data ?? ({ palette: [] } as Theme['data'])
  const out = [`${t.name}${d.description ? `: ${d.description}` : ''}`]
  if (d.palette?.length) out.push(`Colors: ${d.palette.map((p) => `${p.name} ${p.hex}${p.role ? ` for ${p.role}` : ''}`).join('; ')}.`)
  if (d.materials?.length) out.push(`Materials: ${d.materials.map((x) => `${x.category}: ${x.choice}`).join('; ')}.`)
  if (d.avoid?.length) out.push(`Avoid: ${d.avoid.join('; ')}.`)
  return out.join('\n')
}

export type PlanFinding = { id: string; title: string; body: string; ask: string; from: string; serious: boolean }

const ASK_BY_RULE: [RegExp, string][] = [
  [/engineer|structur|bearing|header|load/i, 'engineer'],
  [/toilet|drain|vent|plumb|shower|tub|sink|lav/i, 'plumber'],
  [/egress|stair|code|tempered|glass|window/i, 'architect'],
  [/aisle|clear|door|swing|hall/i, 'designer'],
]
const askFor = (text: string) => ASK_BY_RULE.find(([re]) => re.test(text))?.[1] ?? 'designer'

function findingsFor(m: Model, room: Room, from: string, asBuilt: Model | null): PlanFinding[] {
  const out: PlanFinding[] = []
  let issues: Issue[] = []
  try {
    issues = checksFor(m, room.id, { asBuilt })
  } catch (e) {
    console.warn('[rooms] plan checks failed', e)
  }
  for (const i of issues) {
    out.push({
      id: `${from}:${i.id}`,
      title: i.severity === 'blocks' ? 'Does not meet code as drawn' : i.locked ? 'Needs an engineer' : i.severity === 'fix' ? 'Worth fixing' : 'Worth knowing',
      body: i.message,
      ask: i.locked ? 'engineer' : askFor(i.message),
      from,
      serious: i.severity === 'blocks' || !!i.locked,
    })
  }
  for (const n of m.notes) {
    if (!n.at || n.at.level !== room.level || !pointInPolygon(n.at.p, room.polygon)) continue
    if (out.some((f) => f.body === n.text)) continue
    out.push({ id: `${from}:note:${n.id}`, title: n.locked ? 'Needs an engineer' : 'Note on the plan', body: n.text, ask: n.locked ? 'engineer' : askFor(n.text), from, serious: !!n.locked })
  }
  if (room.flags.includes('needs_confirming'))
    out.push({ id: `${from}:confirm:${room.id}`, title: 'Sizes need checking', body: `The drawing marks the ${room.name}'s dimensions as needing confirmation. Measure before ordering anything sized to fit.`, ask: 'contractor', from, serious: false })
  return out
}

/** What the floor plans say about a room: checks on the house as it is, then on each design that changes it. */
export function planFindings(h: House, roomId: string): PlanFinding[] {
  const room = h.asBuilt.rooms.find((r) => r.id === roomId)
  if (!room) return []
  const out = findingsFor(h.asBuilt, room, 'the house as it is', null)
  const seen = new Set(out.map((f) => f.body))
  for (const p of h.plans) {
    const same = p.model.rooms.find((r) => r.id === room.id) ?? p.model.rooms.find((r) => r.level === room.level && r.name.toLowerCase() === room.name.toLowerCase())
    if (!same) continue
    for (const f of findingsFor(p.model, same, `the design "${p.name}"`, h.asBuilt)) {
      if (seen.has(f.body)) continue
      seen.add(f.body)
      out.push(f)
    }
  }
  return out.sort((a, b) => Number(b.serious) - Number(a.serious))
}

/** What each saved design changes in this room, as sentences ("The sink moves to the island."). */
export function plannedChanges(h: House, roomId: string): { plan: string; lines: string[] }[] {
  const room = h.asBuilt.rooms.find((r) => r.id === roomId)
  if (!room) return []
  const out: { plan: string; lines: string[] }[] = []
  for (const p of h.plans) {
    let lines: string[] = []
    try {
      const name = room.name.toLowerCase()
      const ids = new Set(inRoom(p.model, p.model.rooms.find((r) => r.id === room.id) ?? room).map((i) => i.id))
      lines = changeLog(h.asBuilt, p.model)
        .filter((c) => c.level === room.level && (c.text.toLowerCase().includes(name) || c.ids.some((id) => ids.has(id) || id === room.id)))
        .map((c) => c.text)
    } catch (e) {
      console.warn('[rooms] change log failed', e)
    }
    if (lines.length) out.push({ plan: p.name, lines: lines.slice(0, 8) })
  }
  return out
}

/** A small drawing of the room from the plan: its walls, windows, doors and fixtures, with its size. */
export function roomSvg(m: Model, roomId: string): string {
  const room = m.rooms.find((r) => r.id === roomId)
  if (!room) return ''
  const b = polygonBounds(room.polygon)
  const pad = 30
  const x0 = b.x0 - pad
  const y0 = b.y0 - pad
  const w = b.x1 - b.x0 + pad * 2
  const h = b.y1 - b.y0 + pad * 2
  const near = (p: [number, number]) => p[0] > x0 - 40 && p[0] < x0 + w + 40 && p[1] > y0 - 40 && p[1] < y0 + h + 40
  const parts: string[] = []
  parts.push(`<polygon points="${room.polygon.map((p) => p.join(',')).join(' ')}" fill="#dbe7e3"/>`)
  const walls = m.walls.filter((wl) => wl.level === room.level && (near(wl.a) || near(wl.b)))
  for (const wl of walls) parts.push(`<line x1="${wl.a[0]}" y1="${wl.a[1]}" x2="${wl.b[0]}" y2="${wl.b[1]}" stroke="${wl.kind === 'wall' ? '#23282c' : '#8a949a'}" stroke-width="${Math.max(3, wl.t)}" stroke-linecap="square"/>`)
  const byId = new Map(walls.map((wl) => [wl.id, wl]))
  for (const o of m.openings) {
    const wl = byId.get(o.wall)
    if (!wl) continue
    const L = Math.hypot(wl.b[0] - wl.a[0], wl.b[1] - wl.a[1]) || 1
    const ux = (wl.b[0] - wl.a[0]) / L
    const uy = (wl.b[1] - wl.a[1]) / L
    const cx = wl.a[0] + ux * o.at
    const cy = wl.a[1] + uy * o.at
    const hw = o.w / 2
    const seg = `x1="${cx - ux * hw}" y1="${cy - uy * hw}" x2="${cx + ux * hw}" y2="${cy + uy * hw}"`
    parts.push(`<line ${seg} stroke="#f6f6f2" stroke-width="${Math.max(3, wl.t) + 1}"/>`)
    if (o.kind === 'window') parts.push(`<line ${seg} stroke="#4a8fb5" stroke-width="2"/>`)
  }
  for (const it of inRoom(m, room)) {
    if (it.w < 6 || it.demolish) continue
    parts.push(`<rect x="${it.x - it.w / 2}" y="${it.y - it.d / 2}" width="${it.w}" height="${it.d}" transform="rotate(${it.rot} ${it.x} ${it.y})" fill="#fbfbf8" stroke="#5f6a72" stroke-width="1.2"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}" role="img" aria-label="Plan of the ${room.name.replace(/"/g, '')}">${parts.join('')}</svg>`
}

// ---------------------------------------------------------------- loading

function asModel(raw: unknown): Model | null {
  let v: any = raw
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return null
    }
  }
  if (!v || typeof v !== 'object') return null
  return v.v === 2 ? (v as Model) : migrateV1(v).model
}

export async function loadHouse(be: Backend): Promise<House> {
  if (be.kind === 'local') return localHouse()
  const schemes = await be.sql(`SELECT id, name, head_version, sort, role FROM schemes ORDER BY sort, created_at`)
  if (!schemes.length) throw new Error('there are no floor plans yet. Bring a plan into Velda Studio first, then come back')
  const asb = schemes.find((s) => s.role === 'asbuilt') ?? schemes.find((s) => /^as-built/i.test(s.name)) ?? schemes[0]
  const head = async (s: any) => asModel((await be.sql(`SELECT model FROM versions WHERE id = ${lit(s.head_version)}`))[0]?.model)
  const asBuilt = await head(asb)
  if (!asBuilt) throw new Error('the floor plan could not be read')
  const house: House = { name: asBuilt.project?.name || 'Our house', asBuilt, asBuiltName: asb.name, plans: [], rooms: roomsOf(asBuilt) }
  // The designs load after the page is up; they only add to the designer's notes.
  house.plans = []
  void (async () => {
    for (const s of schemes) {
      if (s.id === asb.id || !s.head_version || s.role === 'asbuilt' || /^as-built/i.test(s.name)) continue
      try {
        const m = await head(s)
        if (m) house.plans.push({ id: s.id, name: s.name, model: m })
      } catch (e) {
        console.warn('[rooms] a design could not be read', s.name, e)
      }
    }
    plansReady?.()
  })()
  return house
}

let plansReady: (() => void) | null = null
/** Called once the saved designs have loaded (so a room's notes can refresh). */
export function onPlans(fn: () => void) {
  plansReady = fn
}

/** The local preview's house: a slice of the real plans (the same fixture the Studio's preview uses). */
async function localHouse(): Promise<House> {
  const [{ modelFromVelda3D }, { designsUnlimitedThemes }, a2, a4] = await Promise.all([
    import('../lib/model'),
    import('../lib/import'),
    import('../../scripts/fixtures/geo_A2.json'),
    import('../../scripts/fixtures/geo_A4.json'),
  ])
  const themes = designsUnlimitedThemes('.')
  const base = {
    scene: {
      levels: [
        { id: 'L1', name: 'Level 1', elev: 0, height: 114 },
        { id: 'L2', name: 'Level 2', elev: 126, height: 114 },
      ],
      sheets: { A2: { dx: -3.1, dy: -126, level: 'L2', title: 'A2' }, A4: { dx: 10.3, dy: -21.8, level: 'L1', title: 'A4' } },
    },
    geos: [
      { sheet: 'A4', level: 'L1', geo: (a4 as any).default ?? a4 },
      { sheet: 'A2', level: 'L2', geo: (a2 as any).default ?? a2 },
    ],
    ceiling: 114,
    theme: null,
    themes: Object.fromEntries(themes.map((t) => [t.id, t])),
  }
  const fixtures = [
    { id: 'nb-vanity-top', level: 'L2', type: 'vanity', label: 'Vanity (top wall)', x: 664, y: 171, rot: 0, w: 84.6, d: 23.7, h: 34 },
    { id: 'nb-tub', level: 'L2', type: 'corner_tub', label: 'Jetted corner tub', x: 739, y: 197, rot: 90, w: 72.3, d: 72.9, h: 22 },
    { id: 'du-wc', level: 'L2', type: 'toilet', label: 'Toilet (WC)', x: 757.5, y: 335.4, rot: -90, w: 20, d: 28, h: 30 },
    { id: 'n8-island', level: 'L1', type: 'island', label: 'Island 8x5', x: 319, y: 294.2, rot: 0, w: 96, d: 60, h: 36 },
    { id: 'n8-range', level: 'L1', type: 'range', label: 'Gas range', x: 206.3, y: 296.2, rot: 90, w: 30, d: 26, h: 36.5 },
  ]
  const build = (items: any[]) => {
    const m = migrateV1(modelFromVelda3D({ ...base, items } as any)).model
    for (const r of m.rooms) {
      if (/^kitchen/i.test(r.name)) r.theme = 'theme-du-kitchen'
      if (/primary bath/i.test(r.name)) r.theme = 'theme-du-bath'
    }
    return m
  }
  const asBuilt = build(fixtures)
  const plan = build([...fixtures, { id: 'n8-sink', level: 'L1', type: 'sink', label: 'Main sink (on island)', x: 319, y: 306, rot: 180, w: 33, d: 22, h: 36 }])
  return { name: 'Local preview', asBuilt, asBuiltName: 'As-built', plans: [{ id: 'kitchen', name: 'Kitchen with the sink on the island', model: plan }], rooms: roomsOf(asBuilt) }
}
