// DXF R12 (AC1009), the format every CAD program reads (08 section 4). One file per scheme, inches,
// origin at the house frame origin, y up (the sheet's y is flipped). LINE, ARC, TEXT and POLYLINE with
// VERTEX and SEQEND only: no blocks, no DIMENSION entities. Layers per level, AIA style.
import { polygonBounds } from '../model/geom'
import type { Item, Model, Vec, Wall } from '../model/types'
import { formatFeetInches } from '../model/units'
import { levelOverall, openingShape, roomClearDims, roomLabel, thick, unit, wallPoly } from '../plan2d/geometry'

const EQUIPMENT = new Set<Item['kind']>(['range', 'fridge', 'dishwasher', 'washer', 'dryer', 'water_heater', 'hvac', 'oven_tower', 'cooktop', 'hood', 'stove'] as Item['kind'][])
const COLORS: Record<string, number> = { WALL: 7, 'WALL-CNTR': 8, DOOR: 4, GLAZ: 5, 'FLOR-STRS': 6, 'FLOR-IDEN': 2, 'ANNO-DIMS': 1, FIXT: 30, EQPM: 140, 'ANNO-NOTE': 3 }

type Ent = string[]

/** Plain ASCII for TEXT (R12 is not Unicode): curly quotes and dashes become ASCII. */
const ascii = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e]/g, '?')
const num = (v: number) => (Math.round(v * 10000) / 10000).toString()

export type DxfOpts = { scheme: string; version?: string; date?: string }

export function toDxf(m: Model, o: DxfOpts): string {
  const ents: Ent[] = []
  const layers = new Set<string>(['0'])
  const P = (p: Vec): [number, number] => [p[0], -p[1]] // y up
  const L = (lv: string, kind: string) => {
    const name = `${lv}-A-${kind}`
    layers.add(name)
    return name
  }
  const line = (layer: string, a: Vec, b: Vec) => {
    const [x1, y1] = P(a)
    const [x2, y2] = P(b)
    ents.push(['0', 'LINE', '8', layer, '10', num(x1), '20', num(y1), '30', '0', '11', num(x2), '21', num(y2), '31', '0'])
  }
  const poly = (layer: string, ps: Vec[], closed = true) => {
    const e = ['0', 'POLYLINE', '8', layer, '66', '1', '10', '0', '20', '0', '30', '0', '70', closed ? '1' : '0']
    for (const p of ps) {
      const [x, y] = P(p)
      e.push('0', 'VERTEX', '8', layer, '10', num(x), '20', num(y), '30', '0')
    }
    e.push('0', 'SEQEND', '8', layer)
    ents.push(e)
  }
  const text = (layer: string, at: Vec, s: string, h: number, rot = 0, center = true) => {
    const [x, y] = P(at)
    const e = ['0', 'TEXT', '8', layer, '10', num(x), '20', num(y), '30', '0', '40', num(h), '1', ascii(s)]
    if (rot) e.push('50', num(rot))
    if (center) e.push('72', '1', '11', num(x), '21', num(y), '31', '0')
    ents.push(e)
  }
  /** An arc about c from a to b, the short way, in the flipped frame (ARC runs counterclockwise). */
  const arc = (layer: string, c: Vec, a: Vec, b: Vec) => {
    const [cx, cy] = P(c)
    const [ax, ay] = P(a)
    const [bx, by] = P(b)
    const r = Math.hypot(ax - cx, ay - cy)
    let s = (Math.atan2(ay - cy, ax - cx) * 180) / Math.PI
    let t = (Math.atan2(by - cy, bx - cx) * 180) / Math.PI
    const ccw = (((t - s) % 360) + 360) % 360
    if (ccw > 180) [s, t] = [t, s]
    ents.push(['0', 'ARC', '8', layer, '10', num(cx), '20', num(cy), '30', '0', '40', num(r), '50', num(((s % 360) + 360) % 360), '51', num(((t % 360) + 360) % 360)])
  }

  for (const lv of m.levels) {
    const id = lv.id
    const walls = m.walls.filter((w) => w.level === id)
    const byId = new Map(walls.map((w) => [w.id, w] as [string, Wall]))
    // Walls: the solid pieces between openings as closed outlines, and the centerline.
    for (const w of walls) {
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
      if (len < 0.5) continue
      const cuts = m.openings
        .filter((x) => x.wall === w.id)
        .map((x) => [Math.max(0, x.at - x.w / 2), Math.min(len, x.at + x.w / 2)] as [number, number])
        .sort((p, q) => p[0] - q[0])
      const pieces: [number, number][] = []
      let s = 0
      for (const [c0, c1] of cuts) {
        if (c0 > s + 0.05) pieces.push([s, c0])
        s = Math.max(s, c1)
      }
      if (len > s + 0.05) pieces.push([s, len])
      const u = unit(w)
      const n: Vec = [u[1], -u[0]]
      const h = thick(w) / 2
      for (const [p0, p1] of pieces) {
        const a: Vec = [w.a[0] + u[0] * p0, w.a[1] + u[1] * p0]
        const b: Vec = [w.a[0] + u[0] * p1, w.a[1] + u[1] * p1]
        // Pieces at the wall's ends keep the full outline (joints overlap the way the plan draws them).
        const full = p0 <= 0.05 && p1 >= len - 0.05
        const ps: Vec[] = full
          ? wallPoly(w)
          : [
              [a[0] + n[0] * h, a[1] + n[1] * h],
              [b[0] + n[0] * h, b[1] + n[1] * h],
              [b[0] - n[0] * h, b[1] - n[1] * h],
              [a[0] - n[0] * h, a[1] - n[1] * h],
            ]
        poly(L(id, 'WALL'), ps)
      }
      line(L(id, 'WALL-CNTR'), w.a, w.b)
    }
    // Doors (leaf and swing, or jambs) and windows (three lines across the wall).
    for (const op of m.openings) {
      const w = byId.get(op.wall)
      if (!w) continue
      const s = openingShape(op, w)
      if (op.kind === 'window') {
        for (const [a, b] of s.lines) line(L(id, 'GLAZ'), a, b)
        if ((op.prov.h.src === 'default' || op.prov.sill?.src === 'default') && op.h) text(L(id, 'ANNO-NOTE'), mid(s.lines[1] ?? s.lines[0]), 'HT ASSUMED', 3)
        continue
      }
      for (const [a, b] of s.lines) line(L(id, 'DOOR'), a, b)
      for (const [a, b] of s.dashed ?? []) line(L(id, 'DOOR'), a, b)
      if (s.arc) for (const seg of arcs(s.arc)) {
        const leaf = s.lines.find(([, e]) => near(e, seg.from))
        if (leaf) arc(L(id, 'DOOR'), leaf[0], seg.from, seg.to)
      }
    }
    // Stairs: outline and treads across the run.
    for (const st of m.stairs.filter((x) => x.level === id)) {
      poly(L(id, 'FLOR-STRS'), st.polygon)
      const along = st.polygon.map((p) => p[0] * st.up[0] + p[1] * st.up[1])
      const lo = Math.min(...along)
      const hi = Math.max(...along)
      const steps = st.risers ? st.risers - 1 : Math.max(1, Math.floor((hi - lo) / 10))
      const across: Vec = [-st.up[1], st.up[0]]
      const span = st.polygon.map((p) => p[0] * across[0] + p[1] * across[1])
      const c0 = Math.min(...span)
      const c1 = Math.max(...span)
      for (let i = 1; i <= steps; i++) {
        const t = lo + ((hi - lo) * i) / (steps + 1)
        line(L(id, 'FLOR-STRS'), [st.up[0] * t + across[0] * c0, st.up[1] * t + across[1] * c0], [st.up[0] * t + across[0] * c1, st.up[1] * t + across[1] * c1])
      }
    }
    // Rooms: name and area; flags as notes.
    for (const r of m.rooms.filter((x) => x.level === id && x.polygon.length >= 3)) {
      const l = roomLabel(r)
      text(L(id, 'FLOR-IDEN'), l.at, r.name.toUpperCase(), 6)
      text(L(id, 'FLOR-IDEN'), [l.at[0], l.at[1] + 8], l.area.toUpperCase(), 4)
      if (r.flags.includes('needs_confirming')) text(L(id, 'ANNO-NOTE'), [l.at[0], l.at[1] + 15], 'DIMENSIONS TO CONFIRM', 3.5)
      // Clear dimensions: a line just inside each side and its length.
      for (const c of roomClearDims(m, r)) {
        const d: Vec = [c.at[0] - (c.a[0] + c.b[0]) / 2, c.at[1] - (c.a[1] + c.b[1]) / 2]
        const k = Math.hypot(d[0], d[1]) || 1
        const off: Vec = [(d[0] / k) * 4, (d[1] / k) * 4]
        line(L(id, 'ANNO-DIMS'), [c.a[0] + off[0], c.a[1] + off[1]], [c.b[0] + off[0], c.b[1] + off[1]])
        text(L(id, 'ANNO-DIMS'), c.at, `${c.text}${c.badge === 'measured' ? '' : c.badge === 'traced' ? ' (TRACED)' : c.badge === 'assumed' ? ' (ASSUMED)' : ' (VELDA)'}`, 3.5, c.vertical ? 90 : 0)
      }
    }
    // Overall size.
    const ov = levelOverall(m, id)
    if (ov) {
      line(L(id, 'ANNO-DIMS'), [ov.x0, ov.y0 - 24], [ov.x1, ov.y0 - 24])
      text(L(id, 'ANNO-DIMS'), [(ov.x0 + ov.x1) / 2, ov.y0 - 28], formatFeetInches(ov.x1 - ov.x0), 5)
      line(L(id, 'ANNO-DIMS'), [ov.x0 - 24, ov.y0], [ov.x0 - 24, ov.y1])
      text(L(id, 'ANNO-DIMS'), [ov.x0 - 28, (ov.y0 + ov.y1) / 2], formatFeetInches(ov.y1 - ov.y0), 5, 90)
    }
    // Fixtures and equipment.
    for (const it of m.items.filter((x) => x.level === id)) {
      const a = (it.rot * Math.PI) / 180
      const f: Vec = [Math.sin(a), Math.cos(a)]
      const s: Vec = [Math.cos(a), -Math.sin(a)]
      const corner = (i: number, j: number): Vec => [it.x + s[0] * (i * it.w) / 2 + f[0] * (j * it.d) / 2, it.y + s[1] * (i * it.w) / 2 + f[1] * (j * it.d) / 2]
      const layer = L(id, EQUIPMENT.has(it.kind) ? 'EQPM' : 'FIXT')
      poly(layer, [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)])
      text(layer, [it.x, it.y], (it.label || it.kind.replace(/_/g, ' ')).split(/,\s/)[0].toUpperCase().slice(0, 40), Math.min(3, Math.max(1.5, it.d * 0.12)))
    }
  }
  // Title notes on layer 0.
  const all = m.walls.flatMap((w) => wallPoly(w))
  const b = all.length ? polygonBounds(all) : { x0: 0, y0: 0, x1: 100, y1: 100 }
  const notes = [
    `${m.project.name}${m.project.address ? `, ${m.project.address}` : ''}`,
    `SCHEME: ${o.scheme}${o.version ? `, ${o.version}` : ''}${o.date ? `, ${o.date}` : ''}`,
    'UNITS: INCHES. ORIGIN AT THE HOUSE FRAME ORIGIN, Y UP.',
    'DESIGN INTENT. NOT FOR CONSTRUCTION. FIELD VERIFY ALL DIMENSIONS.',
  ]
  notes.forEach((t, i) => text('0', [b.x0, b.y1 + 30 + i * 9], t, 5, 0, false))

  // Header extents from everything drawn.
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const e of ents)
    for (let i = 0; i < e.length - 1; i += 2) {
      if (e[i] === '10' || e[i] === '11') {
        const v = Number(e[i + 1])
        x0 = Math.min(x0, v)
        x1 = Math.max(x1, v)
      }
      if (e[i] === '20' || e[i] === '21') {
        const v = Number(e[i + 1])
        y0 = Math.min(y0, v)
        y1 = Math.max(y1, v)
      }
    }
  const header = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSBASE', '10', '0', '20', '0', '30', '0', '9', '$EXTMIN', '10', num(x0), '20', num(y0), '30', '0', '9', '$EXTMAX', '10', num(x1), '20', num(y1), '30', '0', '9', '$LUNITS', '70', '4', '0', 'ENDSEC']
  const layerList = [...layers]
  const tables = [
    '0', 'SECTION', '2', 'TABLES',
    '0', 'TABLE', '2', 'LTYPE', '70', '1',
    '0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0.0',
    '0', 'ENDTAB',
    '0', 'TABLE', '2', 'LAYER', '70', String(layerList.length),
    ...layerList.flatMap((n) => ['0', 'LAYER', '2', n, '70', '0', '62', String(COLORS[n.replace(/^[^-]+-A-/, '')] ?? 7), '6', 'CONTINUOUS']),
    '0', 'ENDTAB',
    '0', 'TABLE', '2', 'STYLE', '70', '1',
    '0', 'STYLE', '2', 'STANDARD', '70', '0', '40', '0.0', '41', '1.0', '50', '0.0', '71', '0', '42', '2.5', '3', 'txt', '4', '',
    '0', 'ENDTAB',
    '0', 'ENDSEC',
  ]
  const blocks = ['0', 'SECTION', '2', 'BLOCKS', '0', 'ENDSEC']
  const entities = ['0', 'SECTION', '2', 'ENTITIES', ...ents.flat(), '0', 'ENDSEC']
  const all2 = [...header, ...tables, ...blocks, ...entities, '0', 'EOF']
  // Group codes right-aligned to 3 characters, as AutoCAD writes them.
  const outLines: string[] = []
  for (let i = 0; i < all2.length; i += 2) outLines.push(all2[i].padStart(3, ' '), all2[i + 1])
  return outLines.join('\r\n') + '\r\n'
}

const mid = ([a, b]: [Vec, Vec]): Vec => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
const near = (p: Vec, q: Vec) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.01

/** The arcs in an opening's SVG swing path: "M x y A r r 0 0 s X Y" one or more times. */
function arcs(d: string): { from: Vec; to: Vec }[] {
  const out: { from: Vec; to: Vec }[] = []
  const re = /M\s*(-?[\d.e-]+)\s+(-?[\d.e-]+)\s*A\s*[-\d.e]+\s+[-\d.e]+\s+[-\d.e]+\s+[01]\s+[01]\s+(-?[\d.e-]+)\s+(-?[\d.e-]+)/g
  let mm: RegExpExecArray | null
  while ((mm = re.exec(d))) out.push({ from: [Number(mm[1]), Number(mm[2])], to: [Number(mm[3]), Number(mm[4])] })
  return out
}

