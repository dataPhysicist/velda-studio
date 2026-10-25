// The change log against the as-built (08 section 6): every wall, opening, room, fixture and level
// change as a sentence a general contractor can read, with sizes in feet and inches. Written to
// changes.md and changes.csv, and to the PDF cover's open items when walls that may carry load move.
import { roomsAcross } from '../analysis/space'
import { diffModels } from '../model/diff'
import { dist, polygonArea, polygonBounds, wallLength } from '../model/geom'
import { roomEdges } from '../model/place'
import type { Model, Opening, Room, Wall } from '../model/types'
import { formatFeetInches } from '../model/units'

export type Change = { kind: 'wall' | 'opening' | 'room' | 'item' | 'level'; level: string; ids: string[]; text: string; engineer?: boolean }

const ft = (v: number) => formatFeetInches(v)
const size = (r: Room) => {
  const b = polygonBounds(r.polygon)
  return `${ft(b.x1 - b.x0)} x ${ft(b.y1 - b.y0)}`
}
const sf = (r: Room) => Math.round(polygonArea(r.polygon) / 144)
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** The rooms on either side of a wall, by name ("Kitchen and Dining", or "Kitchen and the outside"). */
function beside(m: Model, w: Wall): string {
  const names = m.rooms.filter((r) => r.level === w.level && r.polygon.length >= 3 && roomEdges(m, r).some((e) => e.wall?.id === w.id)).map((r) => r.name)
  const u = [...new Set(names)]
  if (!u.length) return w.exterior ? `${w.id} on the outside` : w.id
  if (u.length === 1) return w.exterior ? `between ${u[0]} and the outside` : `in ${u[0]}`
  return `between ${list(u)}`
}

function bearingWords(w: Wall) {
  if (w.bearing === 'yes') return ' (load-bearing: engineer to size a beam)'
  if (w.bearing === 'unknown') return ' (bearing unknown, engineer to confirm)'
  return ''
}

function openingName(o: Opening) {
  if (o.kind === 'window') return `${o.style === 'double_hung' ? 'double-hung' : o.style.replace(/_/g, ' ')} window`
  if (o.kind === 'opening' || o.style === 'cased') return 'cased opening'
  if (o.kind === 'garage') return 'garage door'
  return o.style === 'swing' ? 'door' : `${o.style} door`
}

function where(m: Model, o: Opening) {
  const [a, b] = roomsAcross(m, o)
  const n = [a?.name, b?.name].filter(Boolean) as string[]
  if (!n.length) return ''
  if (n.length === 1) return o.kind === 'window' ? `in ${n[0]}` : `between ${n[0]} and the outside`
  return `between ${list([...new Set(n)])}`
}

export function changeLog(asBuilt: Model, scheme: Model): Change[] {
  const d = diffModels(asBuilt, scheme)
  const out: Change[] = []
  const lvName = (m: Model, id: string) => m.levels.find((l) => l.id === id)?.name ?? id
  // Walls.
  for (const c of d.walls.removed) {
    const w = asBuilt.walls.find((x) => x.id === c.id)!
    const engineer = w.bearing !== 'no' || w.exterior
    out.push({ kind: 'wall', level: lvName(asBuilt, w.level), ids: [w.id], engineer, text: `Remove the ${ft(wallLength(w))} wall ${beside(asBuilt, w)}${bearingWords(w)}.`.replace(/ +\./, '.') })
  }
  for (const c of d.walls.added) {
    const w = scheme.walls.find((x) => x.id === c.id)!
    out.push({ kind: 'wall', level: lvName(scheme, w.level), ids: [w.id], text: `Build a new ${ft(wallLength(w))} ${w.kind === 'half' ? 'half wall' : w.kind === 'glass' ? 'glass wall' : w.kind === 'rail' ? 'rail' : `wall, ${ft(w.t)} thick,`} ${beside(scheme, w)}.`.replace(/ +\./, '.').replace(/,\s*\./, '.') })
  }
  for (const c of d.walls.moved) {
    const now = scheme.walls.find((x) => x.id === c.id)!
    const was = asBuilt.walls.find((x) => x.id === c.id)!
    const move = Math.max(dist(was.a, now.a), dist(was.b, now.b))
    if (move < 0.25 && Math.abs(was.t - now.t) < 0.05) continue
    const what = move >= 0.25 ? `Move the wall ${beside(asBuilt, was)} ${ft(move)}` : `Change the wall ${beside(asBuilt, was)} from ${ft(was.t)} to ${ft(now.t)} thick`
    out.push({ kind: 'wall', level: lvName(scheme, now.level), ids: [now.id], engineer: move >= 0.25 && (was.bearing !== 'no' || was.exterior), text: `${what}${move >= 0.25 ? bearingWords(was) : ''}.` })
  }
  // Rooms that change size or name, or come and go.
  for (const r of d.rooms.renamed) out.push({ kind: 'room', level: lvName(scheme, scheme.rooms.find((x) => x.id === r.id)!.level), ids: [r.id], text: `Rename ${r.was} to ${r.name}.` })
  for (const c of d.rooms.resized) {
    const was = asBuilt.rooms.find((x) => x.id === c.id)!
    const now = scheme.rooms.find((x) => x.id === c.id)!
    const grows = sf(now) > sf(was)
    out.push({ kind: 'room', level: lvName(scheme, now.level), ids: [now.id], text: `${now.name} ${grows ? 'grows' : 'shrinks'} from ${size(was)} (${sf(was)} sf) to ${size(now)} (${sf(now)} sf).` })
  }
  for (const c of d.rooms.removed) {
    const was = asBuilt.rooms.find((x) => x.id === c.id)!
    // A room joined into another keeps no room of its own; say where it went.
    const into = scheme.rooms.find((r) => r.level === was.level && r.polygon.length >= 3 && sf(r) > sf(was) && polygonContains(r, was))
    out.push({ kind: 'room', level: lvName(asBuilt, was.level), ids: [was.id], text: into ? `${was.name} becomes part of ${into.name}.` : `${was.name} (${size(was)}) is no longer a room.` })
  }
  for (const c of d.rooms.added) {
    const now = scheme.rooms.find((x) => x.id === c.id)!
    if (now.polygon.length < 3) continue
    out.push({ kind: 'room', level: lvName(scheme, now.level), ids: [now.id], text: `New room: ${now.name}, ${size(now)} (${sf(now)} sf).` })
  }
  // Openings.
  for (const c of d.openings.removed) {
    const o = asBuilt.openings.find((x) => x.id === c.id)!
    out.push({ kind: 'opening', level: lvName(asBuilt, asBuilt.walls.find((w) => w.id === o.wall)?.level ?? ''), ids: [o.id], text: `Remove the ${ft(o.w)} ${openingName(o)} ${where(asBuilt, o)}${o.kind === 'window' ? ' and close the wall' : ''}.`.replace(/ +\./, '.') })
  }
  for (const c of d.openings.added) {
    const o = scheme.openings.find((x) => x.id === c.id)!
    const w = scheme.walls.find((x) => x.id === o.wall)
    out.push({ kind: 'opening', level: lvName(scheme, w?.level ?? ''), ids: [o.id], engineer: !!w && (w.bearing !== 'no' || w.exterior), text: `Add a ${ft(o.w)} ${openingName(o)} ${where(scheme, o)}${w && (w.bearing !== 'no' || w.exterior) ? ' (new header: engineer to size it)' : ''}.`.replace(/ +\./, '.') })
  }
  for (const c of d.openings.changed) {
    const was = asBuilt.openings.find((x) => x.id === c.id)!
    const now = scheme.openings.find((x) => x.id === c.id)!
    const parts: string[] = []
    if (c.what.includes('width')) parts.push(`${now.w > was.w ? 'widen' : 'narrow'} it from ${ft(was.w)} to ${ft(now.w)}`)
    if (c.what.includes('height')) parts.push(`set its head at ${ft(now.h)} (was ${ft(was.h)})`)
    if (c.what.includes('sill')) parts.push(`set its sill at ${ft(now.sill ?? 0)} (was ${ft(was.sill ?? 0)})`)
    if (c.what.includes('position') && !c.what.includes('wall')) parts.push(`move it ${ft(Math.abs(now.at - was.at))} along the wall`)
    if (c.what.includes('wall')) parts.push(`move it to the wall ${beside(scheme, scheme.walls.find((w) => w.id === now.wall)!)}`)
    if (c.what.includes('type')) parts.push(`make it a ${openingName(now)}`)
    if (c.what.includes('swing')) parts.push('change which way it swings')
    out.push({ kind: 'opening', level: lvName(scheme, scheme.walls.find((w) => w.id === now.wall)?.level ?? ''), ids: [now.id], text: `The ${ft(was.w)} ${openingName(was)} ${where(asBuilt, was)}: ${parts.join('; ')}.` })
  }
  // Fixtures.
  const roomOf = (m: Model, it: { level: string; x: number; y: number }) => m.rooms.find((r) => r.level === it.level && r.polygon.length >= 3 && inPoly([it.x, it.y], r.polygon))?.name
  const label = (it: { label: string; kind: string }) => (it.label || it.kind.replace(/_/g, ' ')).split(/,\s/)[0]
  for (const c of d.items.added) {
    const it = scheme.items.find((x) => x.id === c.id)!
    const r = roomOf(scheme, it)
    out.push({ kind: 'item', level: lvName(scheme, it.level), ids: [it.id], text: `Add ${label(it)} (${ft(it.w)} by ${ft(it.d)})${r ? ` in ${r}` : ''}.` })
  }
  for (const c of d.items.removed) {
    const it = asBuilt.items.find((x) => x.id === c.id)!
    const r = roomOf(asBuilt, it)
    out.push({ kind: 'item', level: lvName(asBuilt, it.level), ids: [it.id], text: `Remove ${label(it)}${r ? ` from ${r}` : ''}.` })
  }
  for (const c of d.items.changed) {
    const was = asBuilt.items.find((x) => x.id === c.id)!
    const it = scheme.items.find((x) => x.id === c.id)!
    const r = roomOf(scheme, it)
    const parts: string[] = []
    if (c.what.includes('position')) {
      const r0 = roomOf(asBuilt, was)
      parts.push(r0 && r && r0 !== r ? `move it from ${r0} to ${r}` : `move it ${ft(Math.hypot(it.x - was.x, it.y - was.y))}`)
    }
    if (c.what.includes('rotation')) parts.push('turn it')
    if (c.what.includes('size')) parts.push(`make it ${ft(it.w)} by ${ft(it.d)} (was ${ft(was.w)} by ${ft(was.d)})`)
    if (c.what.includes('type')) parts.push(`replace it with ${label(it)}`)
    out.push({ kind: 'item', level: lvName(scheme, it.level), ids: [it.id], text: `${label(was)}${r ? ` in ${r}` : ''}: ${parts.join('; ')}.` })
  }
  // Levels.
  for (const l of d.levels) {
    const was = asBuilt.levels.find((x) => x.id === l.id)
    const now = scheme.levels.find((x) => x.id === l.id)!
    if (!was) out.push({ kind: 'level', level: now.name, ids: [now.id], text: `New level: ${now.name}.` })
    else {
      if (l.what.includes('ceiling')) out.push({ kind: 'level', level: now.name, ids: [now.id], text: `Ceiling on ${now.name} changes from ${ft(was.ceiling)} to ${ft(now.ceiling)}.` })
      if (l.what.includes('floor structure')) out.push({ kind: 'level', level: now.name, ids: [now.id], text: `Floor structure under ${now.name} changes from ${ft(was.floorThickness)} to ${ft(now.floorThickness)}.` })
    }
  }
  return out
}

function inPoly(p: [number, number], poly: [number, number][]) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
function polygonContains(outer: Room, inner: Room) {
  const b = polygonBounds(inner.polygon)
  return inPoly([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], outer.polygon)
}

export function changesMd(asBuiltName: string, schemeName: string, log: Change[]): string {
  const lines = [`# Changes from ${asBuiltName} to ${schemeName}`, '', 'Design intent. Not for construction. Field verify all dimensions.', '']
  if (!log.length) return [...lines, 'No changes.', ''].join('\n')
  const levels = [...new Set(log.map((c) => c.level))]
  for (const lv of levels) {
    lines.push(`## ${lv || 'House'}`, '')
    for (const k of ['wall', 'opening', 'room', 'item', 'level'] as const) for (const c of log.filter((x) => x.level === lv && x.kind === k)) lines.push(`- ${c.text}`)
    lines.push('')
  }
  const eng = log.filter((c) => c.engineer)
  if (eng.length) lines.push('## For the engineer', '', ...eng.map((c) => `- ${c.text}`), '')
  return lines.join('\n')
}

export function changesCsv(log: Change[]): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return ['level,kind,ids,engineer,change', ...log.map((c) => [q(c.level), c.kind, q(c.ids.join(' ')), c.engineer ? 'yes' : '', q(c.text)].join(','))].join('\n') + '\n'
}
