// A level of the plan as a standalone SVG string, in plan inches (y down the sheet), for the PDF sheet
// set and the share viewer. The same shapes as the studio's plan (src/plan2d/geometry.ts), drawn for
// paper: walls, doors with their swings, windows, stairs, fixtures, room names and areas, every room's
// clear dimensions colored by where the number came from, the level's overall size, the sheet's own
// dimension strings that still hold, and a north arrow when north is set. A demolition view adds the
// walls the scheme removes (dashed red), new walls (red outline) and moved walls (an arrow and how far).
import { diffModels } from '../model/diff'
import { polygonBounds } from '../model/geom'
import type { Badge, Model, Vec, Wall } from '../model/types'
import { formatFeetInches } from '../model/units'
import { dimText, levelOverall, openingShape, pts, roomClearDims, roomLabel, wallPoly } from '../plan2d/geometry'

export const BADGE_COLOR: Record<Badge | 'conflict', string> = {
  measured: '#23282c',
  traced: '#a5670f',
  assumed: '#8a9297',
  velda: '#2f5f9e',
  conflict: '#9a3b2e',
}
export const BADGE_WORD: Record<Badge | 'conflict', string> = {
  measured: 'measured (from the drawing or the field)',
  traced: 'traced from the drawing, no dimension string',
  assumed: 'assumed (a default)',
  velda: 'set by Velda',
  conflict: 'drawing and model disagree',
}

export type PlanSvgOpts = {
  level: string
  /** Draw the changes against this model (the as-built): removed, new and moved walls. */
  base?: Model | null
  /** Margin around the level, inches. */
  margin?: number
  /** Text height for room names, inches on the model (6 in is 1/8 in on paper at 1/4 in = 1 ft). */
  text?: number
  /** Fixtures with their labels (default true). */
  items?: boolean
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n2 = (v: number) => (Math.round(v * 100) / 100).toString()
const ft = (v: number) => formatFeetInches(v)

/** The drawing's extent for a level: walls, rooms and stairs, plus the margin. */
export function planBounds(m: Model, level: string, margin = 48) {
  const p: Vec[] = [
    ...m.walls.filter((w) => w.level === level).flatMap((w) => wallPoly(w)),
    ...m.rooms.filter((r) => r.level === level).flatMap((r) => r.polygon),
    ...m.stairs.filter((s) => s.level === level || s.toLevel === level).flatMap((s) => s.polygon),
  ]
  if (!p.length) return { x0: 0, y0: 0, x1: 240, y1: 240 }
  const b = polygonBounds(p)
  return { x0: b.x0 - margin, y0: b.y0 - margin, x1: b.x1 + margin, y1: b.y1 + margin }
}

export function planSvg(m: Model, o: PlanSvgOpts): { svg: string; bounds: { x0: number; y0: number; x1: number; y1: number }; w: number; h: number } {
  const L = o.level
  const T = o.text ?? 6
  const b = planBounds(m, L, o.margin ?? 54)
  const w = b.x1 - b.x0
  const h = b.y1 - b.y0
  const out: string[] = []
  const line = (p: Vec, q: Vec, stroke: string, sw: number, dash?: string) =>
    `<line x1="${n2(p[0])}" y1="${n2(p[1])}" x2="${n2(q[0])}" y2="${n2(q[1])}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
  const text = (at: Vec, s: string, size: number, fill: string, opts: { rotate?: boolean; weight?: string; anchor?: string } = {}) =>
    `<text x="${n2(at[0])}" y="${n2(at[1])}" font-family="helvetica" font-size="${n2(size)}" fill="${fill}" text-anchor="${opts.anchor ?? 'middle'}"${opts.weight ? ` font-weight="${opts.weight}"` : ''}${opts.rotate ? ` transform="rotate(-90 ${n2(at[0])} ${n2(at[1])})"` : ''}>${esc(s)}</text>`

  const walls = m.walls.filter((x) => x.level === L)
  const rooms = m.rooms.filter((r) => r.level === L && r.polygon.length >= 3)
  const diff = o.base ? diffModels(o.base, m) : null
  const added = new Set(diff?.walls.added.map((x) => x.id) ?? [])

  // Rooms (a light tint where the sheet asks to confirm).
  for (const r of rooms) out.push(`<polygon points="${pts(r.polygon)}" fill="${r.flags.includes('needs_confirming') ? '#f6e9f2' : '#ffffff'}" stroke="none"/>`)
  // Fixtures.
  if (o.items !== false)
    for (const it of m.items.filter((x) => x.level === L)) {
      const label = (it.label || it.kind.replace(/_/g, ' ')).split(/,\s/)[0]
      const size = Math.min(T * 0.75, Math.max(2.5, Math.min(it.w, it.d) * 0.28))
      out.push(
        `<g transform="translate(${n2(it.x)} ${n2(it.y)}) rotate(${n2(-it.rot)})"><title>${esc(`${label}, ${ft(it.w)} x ${ft(it.d)}`)}</title><rect x="${n2(-it.w / 2)}" y="${n2(-it.d / 2)}" width="${n2(it.w)}" height="${n2(it.d)}" fill="#ffffff" stroke="#737d83" stroke-width="0.6"/>${
          it.w >= 14 && it.d >= 8 && label.length * size * 0.55 < it.w ? text([0, size * 0.35], label, size, '#4a5257') : ''
        }</g>`,
      )
    }
  // Walls: exterior darker; new walls outlined red when compared with the as-built.
  for (const x of walls) {
    const fill = x.kind === 'glass' ? '#8fb3bb' : x.kind === 'half' ? '#8a9297' : x.kind === 'rail' ? '#ffffff' : x.exterior ? '#23282c' : '#4a5257'
    const stroke = added.has(x.id) ? ' stroke="#9a3b2e" stroke-width="1.2"' : x.kind === 'rail' ? ' stroke="#23282c" stroke-width="0.6"' : ''
    out.push(`<polygon points="${pts(wallPoly(x))}" fill="${fill}"${stroke}/>`)
  }
  // Walls the scheme removes: dashed red outlines where they stood.
  if (o.base)
    for (const id of diff!.walls.removed.map((x) => x.id)) {
      const x = o.base.walls.find((y) => y.id === id)
      if (x && x.level === L) out.push(`<polygon points="${pts(wallPoly(x))}" fill="none" stroke="#9a3b2e" stroke-width="1" stroke-dasharray="4 3"/>`)
    }
  // Openings.
  const byId = new Map(walls.map((x) => [x.id, x] as [string, Wall]))
  for (const op of m.openings) {
    const x = byId.get(op.wall)
    if (!x) continue
    const s = openingShape(op, x)
    out.push(`<polygon points="${pts(s.gap)}" fill="#ffffff"/>`)
    for (const [p, q] of s.lines) out.push(line(p, q, '#23282c', op.kind === 'window' ? 0.6 : 0.8))
    for (const [p, q] of s.dashed ?? []) out.push(line(p, q, '#23282c', 0.6, '2 2'))
    if (s.arc) out.push(`<path d="${s.arc}" fill="none" stroke="#23282c" stroke-width="0.5" stroke-dasharray="3 2"/>`)
  }
  // Moved walls: an arrow from where the centerline was, with how far.
  if (o.base)
    for (const mv of diff!.walls.moved) {
      const now = byId.get(mv.id)
      const was = o.base.walls.find((y) => y.id === mv.id)
      if (!now || !was || !mv.move || mv.move < 0.5) continue
      const a: Vec = [(was.a[0] + was.b[0]) / 2, (was.a[1] + was.b[1]) / 2]
      const c: Vec = [(now.a[0] + now.b[0]) / 2, (now.a[1] + now.b[1]) / 2]
      out.push(line(a, c, '#9a3b2e', 1))
      out.push(`<circle cx="${n2(c[0])}" cy="${n2(c[1])}" r="1.6" fill="#9a3b2e"/>`)
      out.push(text([c[0], c[1] - 3], `moved ${ft(mv.move)}`, T * 0.75, '#9a3b2e'))
    }
  // Stairs: outline and an arrow up.
  for (const s of m.stairs.filter((x) => x.level === L || x.toLevel === L)) {
    out.push(`<polygon points="${pts(s.polygon)}" fill="none" stroke="#4a5257" stroke-width="0.6" stroke-dasharray="6 3"/>`)
    const c = polygonBounds(s.polygon)
    const mid: Vec = [(c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2]
    const len = Math.min(c.x1 - c.x0, c.y1 - c.y0) * 0.6 + Math.abs(s.up[0] * (c.x1 - c.x0) + s.up[1] * (c.y1 - c.y0)) * 0.3
    const tip: Vec = [mid[0] + s.up[0] * len * 0.5, mid[1] + s.up[1] * len * 0.5]
    out.push(line([mid[0] - s.up[0] * len * 0.5, mid[1] - s.up[1] * len * 0.5], tip, '#4a5257', 0.6))
    out.push(text([mid[0], mid[1] + T * 0.3], s.level === L ? 'UP' : 'DN', T * 0.7, '#4a5257'))
  }
  // The sheet's own dimension strings that still hold (grey), and the person's measurements (ink).
  for (const d of m.dimensions.filter((x) => x.level === L)) {
    const keep = (d.source === 'sheet' && d.status === 'ok') || d.source === 'user' || d.source === 'field' || d.status === 'conflict'
    if (!keep) continue
    const col = d.status === 'conflict' ? BADGE_COLOR.conflict : d.source === 'sheet' ? '#a9b0b4' : BADGE_COLOR.measured
    const mid: Vec = [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2]
    const vertical = Math.abs(d.b[1] - d.a[1]) > Math.abs(d.b[0] - d.a[0])
    out.push(line(d.a, d.b, col, 0.4))
    out.push(text(vertical ? [mid[0] - 1.5, mid[1]] : [mid[0], mid[1] - 1.5], dimText(m, d).text, T * 0.62, col, { rotate: vertical }))
  }
  // Every room's clear dimensions, colored by provenance.
  for (const r of rooms)
    for (const c of roomClearDims(m, r)) out.push(text(c.at, c.text, T * 0.7, BADGE_COLOR[c.badge], { rotate: c.vertical }))
  // Overall size along the top and left.
  const ov = levelOverall(m, L)
  if (ov) {
    const y = ov.y0 - 22
    const x = ov.x0 - 22
    out.push(line([ov.x0, y], [ov.x1, y], '#23282c', 0.5), line([ov.x0, y - 4], [ov.x0, y + 4], '#23282c', 0.5), line([ov.x1, y - 4], [ov.x1, y + 4], '#23282c', 0.5))
    out.push(text([(ov.x0 + ov.x1) / 2, y - 3], ft(ov.x1 - ov.x0), T * 0.8, '#23282c'))
    out.push(line([x, ov.y0], [x, ov.y1], '#23282c', 0.5), line([x - 4, ov.y0], [x + 4, ov.y0], '#23282c', 0.5), line([x - 4, ov.y1], [x + 4, ov.y1], '#23282c', 0.5))
    out.push(text([x - 3, (ov.y0 + ov.y1) / 2], ft(ov.y1 - ov.y0), T * 0.8, '#23282c', { rotate: true }))
  }
  // Room names and areas.
  for (const r of rooms) {
    const l = roomLabel(r)
    out.push(text(l.at, l.name, T, '#23282c', { weight: 'bold' }))
    out.push(text([l.at[0], l.at[1] + T * 1.15], l.area, T * 0.75, '#4a5257'))
  }
  // North arrow, when a person has set north.
  if (m.project.north !== null && m.project.north !== undefined) {
    const at: Vec = [b.x1 - 30, b.y0 + 34]
    out.push(
      `<g transform="translate(${n2(at[0])} ${n2(at[1])}) rotate(${n2(m.project.north)})"><circle r="14" fill="none" stroke="#23282c" stroke-width="0.6"/><path d="M 0 -12 L 5 6 L 0 2 L -5 6 Z" fill="#23282c"/></g>`,
      text([at[0], at[1] + 24], 'N', T * 0.8, '#23282c', { weight: 'bold' }),
    )
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n2(b.x0)} ${n2(b.y0)} ${n2(w)} ${n2(h)}" width="${n2(w)}" height="${n2(h)}">${out.join('')}</svg>`
  return { svg, bounds: b, w, h }
}
