// Plan import, one sheet: page data (from the adapter) and the raster trace (from the worker) in, a
// model v2 for that level and an ImportReport out. Pure, so it runs in vitest on recorded fixtures
// and in the page on a fresh PDF. Spec: 05-plan-import-spec.
import { bindCoordinate, deriveRooms, healWalls, updateDimensionStatus } from '../model/derive'
import { pointInPolygon, polygonArea, polygonBounds, wallLength } from '../model/geom'
import type { Dimension, Item, Level, Model, Opening, Prov, Room, Sheet, Vec, Wall } from '../model/types'
import { emptyModel } from '../model/types'
import { formatFeetInches } from '../model/units'
import { type SheetGuess, classifySheet, planLabels } from './classify-sheet'
import { type DimRead, pairDimensions, readDimensions } from './dims'
import { type PlanLabel, type SheetFrame, readLabels, roomName, toSheet } from './labels'
import { type TraceResult, normalizeThickness } from './raster/trace'
import { solveDimensions } from './solver'
import { type TintRect, readTints } from './tints'
import type { Box, PageData } from './types'

export type ImportReport = {
  sheets: { id: string; role: string; level: string | null; scale: string; tier: 'A' | 'B' | 'C'; dims: { parsed: number; paired: number; bound: number; conflicts: number } }[]
  counts: { walls: number; doors: number; windows: number; openings: number; rooms: number; stairs: number }
  conflicts: { dimension: string; drawn: number; traced: number; where: Vec }[]
  unresolved: string[]
  /** Strings that measure fixtures or cabinets (one end on no wall): kept on the plan, not used for walls. */
  fixtureStrings: string[]
  /** Closed spaces with no label, named Room 1, Room 2 ... for the person to name. */
  unnamedRooms: string[]
  assumptions: { what: string; value: string; prov: 'default' }[]
  flags: { kind: 'needs_confirming' | 'demolish'; rooms: string[] }[]
  timingMs: Record<string, number>
}

export type ImportDefaults = {
  ceiling: number // 108 = 9 ft, asked in the intake
  floorThickness: number
  windowHead: number
  windowSill: number
  doorHeight: number
}
export const DEFAULTS: ImportDefaults = { ceiling: 108, floorThickness: 12, windowHead: 84, windowSill: 36, doorHeight: 80 }

export type SheetImport = {
  guess: SheetGuess
  frame: SheetFrame
  ptPerInch: number | null
  pxPerInch: { x: number; y: number } | null
  dims: DimRead[]
  labels: PlanLabel[]
  tints: TintRect[]
  model: Model
  report: ImportReport
}

/** Raster pixels per real inch for the plan image once the drawing scale is known. */
export function rasterScale(plan: { px: [number, number]; rect: Box }, ptPerInch: number) {
  return { x: (plan.px[0] / (plan.rect[2] - plan.rect[0])) * ptPerInch, y: (plan.px[1] / (plan.rect[3] - plan.rect[1])) * ptPerInch }
}

/** Read the page: strings, scale, sheet facts. Cheap; runs before the raster trace. */
export function readSheet(page: PageData) {
  const parsed = readDimensions(page.text)
  const { dims, scale } = pairDimensions(parsed, page.segs)
  const guess = classifySheet(page, parsed.length)
  const ptPerInch = scale.ptPerInch ?? guess.scaleText?.ptPerInch ?? null
  return { dims, scale, guess, ptPerInch, pxPerInch: guess.plan && ptPerInch ? rasterScale(guess.plan, ptPerInch) : null }
}

const evenInch = (v: number) => Math.round(v / 2) * 2
const id = (prefix: string, i: number) => `${prefix}${i + 1}`

export function importSheet(
  page: PageData,
  trace: TraceResult | null,
  opts: { file?: string; level?: string; levelName?: string; role?: 'asbuilt' | 'proposed'; defaults?: Partial<ImportDefaults>; projectName?: string; ignoreDims?: string[] } = {},
): SheetImport {
  const t0 = performance.now()
  const timing: Record<string, number> = { ...(trace?.timingMs ?? {}) }
  const D = { ...DEFAULTS, ...opts.defaults }
  const read = readSheet(page)
  const { guess, dims, scale } = read
  const ptPerInch = read.ptPerInch ?? 1.5
  const sheetId = guess.number ?? `P${page.page}`
  const level = opts.level ?? guess.level ?? 'L1'
  const plan = guess.plan
  const frame: SheetFrame = { x0: plan ? plan.rect[0] : 0, y0: plan ? plan.rect[1] : 0, ptPerInch }

  const labels = plan ? readLabels(planLabels(page, plan.rect), frame) : []
  const { tints } = readTints(page.fills, page.text, plan?.rect ?? null, frame)
  timing.read = Math.round(performance.now() - t0)

  // ---- walls and openings from the trace
  const conf = (c: number): Prov => ({ src: 'sheet_raster', conf: Math.round(c * 100) / 100 })
  const traced = (trace?.walls ?? []).filter((w) => !w.closed && Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) >= 6)
  let walls: Wall[] = traced.map((w, i) => {
    const p = conf(w.exterior ? 0.9 : 0.8)
    return {
      id: `${sheetId}w${i + 1}`,
      level,
      a: w.a,
      b: w.b,
      t: normalizeThickness(w.tMeasured),
      tMeasured: w.tMeasured,
      kind: 'wall',
      exterior: w.exterior,
      bearing: w.exterior ? 'yes' : 'unknown',
      prov: { a: p, b: p, t: conf(0.9) },
    }
  })
  let openings: Opening[] = []
  traced.forEach((tw, i) => {
    tw.openings.forEach((o, j) => {
      const wall = walls[i].id
      const oid = `${wall}${o.kind === 'window' ? 'n' : 'd'}${j + 1}`
      const width = o.kind === 'window' ? evenInch(o.w) : o.w > 24 ? evenInch(o.w) : Math.round(o.w)
      const base = { id: oid, wall, at: o.at, w: width }
      if (o.kind === 'window')
        openings.push({
          ...base,
          kind: 'window',
          h: D.windowHead,
          sill: D.windowSill,
          style: 'double_hung',
          prov: { at: conf(o.conf), w: conf(o.conf), h: { src: 'default' }, sill: { src: 'default' } },
        })
      else
        openings.push({
          ...base,
          kind: o.kind === 'opening' ? 'opening' : 'door',
          h: D.doorHeight,
          style: o.style === 'cased' ? 'cased' : o.style,
          ...(o.swing ? { swing: o.swing } : {}),
          prov: { at: conf(o.conf), w: conf(o.conf), h: { src: 'default' }, ...(o.swing ? { swing: conf(o.conf) } : {}) },
        } as Opening)
    })
  })

  // Close corners and tees; openings keep their place in the plan.
  const centers = centersOf(walls, openings)
  walls = dropLooseStubs(closeLooseEnds(healWalls(walls).walls))
  openings = openings.filter((o) => walls.some((w) => w.id === o.wall))
  openings = openings.map((o) => {
    const w = walls.find((x) => x.id === o.wall)!
    const c = centers.get(o.id) ?? centerOf(walls, o)
    const L = wallLength(w)
    const s = ((c[0] - w.a[0]) * (w.b[0] - w.a[0]) + (c[1] - w.a[1]) * (w.b[1] - w.a[1])) / L
    return { ...o, at: Math.round(s * 100) / 100 }
  })
  timing.heal = Math.round(performance.now() - t0) - timing.read

  // ---- strings govern: the solver
  // Strings the person chose to overrule ("use traced") stay on the plan but do not move walls.
  const ignored = new Set(opts.ignoreDims ?? [])
  const solveDims = dims
    .filter((d) => d.line && !ignored.has(d.id))
    .map((d) => ({ id: d.id, text: d.text, value: d.inches, a: toSheet(frame, d.line!.a), b: toSheet(frame, d.line!.b) }))
  const solved = solveDimensions(walls, openings, solveDims, { sheet: sheetId, level })
  walls = solved.walls
  openings = solved.openings
  timing.solve = Math.round(performance.now() - t0) - timing.read - timing.heal

  // ---- the model
  const m = emptyModel(opts.projectName ?? '5008 Velda Dairy')
  const lv: Level = {
    id: level,
    name: opts.levelName ?? guess.levelName ?? `Level ${level.replace(/\D/g, '') || 1}`,
    elev: 0,
    ceiling: D.ceiling,
    floorThickness: D.floorThickness,
    sheetIds: [sheetId],
    prov: { ceiling: { src: 'default', note: 'not on the drawing; asked when the plan is confirmed' }, floorThickness: { src: 'default' } },
  }
  m.levels = [lv]
  const sheet: Sheet = {
    id: sheetId,
    file: opts.file ?? '',
    page: page.page,
    title: guess.title,
    role: opts.role ?? (guess.role === 'reference' ? 'asbuilt' : guess.role),
    level,
    scale: { ptPerInch, text: guess.scaleText?.text ?? `${formatFeetInches(72 / ptPerInch / 12)} = 1'-0"` },
    raster: { blobId: '', px: plan ? plan.px : [0, 0], pxPerInch: read.pxPerInch ? (read.pxPerInch.x + read.pxPerInch.y) / 2 : 0 },
    toHouse: [1, 0, 0, 1, 0, 0],
    tints: tints.map((t) => ({ kind: t.kind, polygon: rectPoly(t.rect) })),
  }
  m.sheets = [sheet]
  m.walls = walls
  m.openings = openings
  m.dimensions = solved.dimensions
  m.meta = { createdFrom: `${sheetId}${guess.issue ? ` (${guess.issue})` : ''}` }
  // Room seeds from the labels; rooms come from the walls.
  m.rooms = labels
    .filter((l) => l.kind === 'room')
    .map((l, i): Room => ({ id: `${sheetId.toLowerCase()}r${i + 1}`, level, name: roomName(l.text), polygon: [], labelAt: l.at, flags: [], prov: { src: 'sheet_vector', note: `label ${l.text} on ${sheetId}` } }))
  m.items = labels
    .filter((l) => l.kind === 'appliance' && l.item)
    .map(
      (l, i): Item => ({
        id: `${sheetId.toLowerCase()}i${i + 1}`,
        level,
        kind: l.item!.kind,
        label: l.text,
        x: Math.round(l.at[0] * 10) / 10,
        y: Math.round(l.at[1] * 10) / 10,
        rot: 0,
        w: l.item!.w,
        d: l.item!.d,
        h: l.item!.h,
        prov: { src: 'sheet_vector', note: `tag ${l.text} on ${sheetId}; size assumed` },
      }),
    )
  const below = `L${Math.max(1, Number(level.replace(/\D/g, '') || 1) - 1)}`
  m.stairs = (trace?.stairs ?? []).map((st, i) => {
    const [x0, y0, x1, y1] = st.rect
    // treads run along treadDir; travel is across them. On an upper floor the visible run comes up
    // from below, so up points away from the break line; on the lowest floor it points toward it.
    const upper = level !== below
    const towardEnd = (st.breakAt === 'end') !== upper
    const up: Vec = st.treadDir === 'h' ? [0, towardEnd ? 1 : -1] : [towardEnd ? 1 : -1, 0]
    return {
      id: `${sheetId.toLowerCase()}s${i + 1}`,
      level: upper ? below : level,
      toLevel: upper ? level : `L${Number(level.replace(/\D/g, '') || 1) + 1}`,
      polygon: rectPoly([x0, y0, x1, y1]),
      up,
      prov: { src: 'sheet_raster', conf: 0.7, note: `${st.treads} treads traced on ${sheetId}; direction assumed from the break line` },
    }
  })
  const derived = deriveRooms(m)
  Object.assign(m, { rooms: derived.rooms })

  // ---- legend flags
  const confirmTints = tints.filter((t) => t.kind === 'confirm')
  const demolishTints = tints.filter((t) => t.kind === 'demolish')
  for (const r of m.rooms) {
    if (r.polygon.length < 3) continue
    const area = polygonArea(r.polygon)
    const flagged = confirmTints.some((t) => (r.labelAt && inRect(t.rect, r.labelAt)) || overlapArea(r.polygon, t.rect) > 0.1 * area)
    if (flagged && !r.flags.includes('needs_confirming')) r.flags.push('needs_confirming')
  }
  for (const w of m.walls) {
    const mid: Vec = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2]
    if (demolishTints.some((t) => inRect(t.rect, mid) && inRect(t.rect, w.a) && inRect(t.rect, w.b))) {
      w.demolish = true
      w.prov = { ...w.prov, a: { ...w.prov.a, note: 'marked to be demolished on sheet' } }
    }
  }
  for (const it of m.items)
    if (demolishTints.some((t) => inRect(t.rect, [it.x, it.y]))) {
      it.demolish = true
      it.prov = { ...it.prov, note: 'marked to be demolished on sheet' }
    }
  updateDimensionStatus(m)
  timing.model = Math.round(performance.now() - t0) - timing.read - timing.heal - timing.solve

  // ---- report
  const bound = m.dimensions.filter((d) => d.binds.length === 2).length
  const unresolvedDims = dims.filter((d) => !d.line).map((d) => `${d.text}: no dimension line found next to it`)
  const unnamed = m.rooms.filter((r) => r.flags.includes('needs_name')).map((r) => r.name)
  const named = new Set(m.rooms.map((r) => r.name))
  const labelsWithoutRoom = labels.filter((l) => l.kind === 'room' && !named.has(roomName(l.text))).map((l) => `${roomName(l.text)}: the label is not inside a closed room (a wall is missing around it)`)
  // Conflicts as the finished model has them (re-trimming corners after the solve can tip a string
  // that just fit over the half-inch line), so the Confirm screen and the plan never disagree.
  const conflicts = m.dimensions
    .filter((d) => d.status === 'conflict')
    .map((d) => {
      const solved1 = solved.conflicts.find((c) => c.id === d.id)
      const c0 = bindCoordinate(m, d, 0)
      const c1 = bindCoordinate(m, d, 1)
      const traced = c0 !== null && c1 !== null ? Math.round(Math.abs(c1 - c0) * 100) / 100 : (solved1?.traced ?? d.value)
      return { dimension: d.text, drawn: d.value, traced, where: solved1?.where ?? ([(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] as Vec) }
    })
  const report: ImportReport = {
    sheets: [
      {
        id: sheetId,
        role: sheet.role,
        level,
        scale: sheet.scale.text,
        tier: guess.tier,
        dims: { parsed: dims.length, paired: scale.pairs, bound, conflicts: conflicts.length },
      },
    ],
    counts: {
      walls: m.walls.length,
      doors: m.openings.filter((o) => o.kind === 'door').length,
      windows: m.openings.filter((o) => o.kind === 'window').length,
      openings: m.openings.filter((o) => o.kind === 'opening').length,
      rooms: m.rooms.filter((r) => !r.flags.includes('needs_name')).length,
      stairs: m.stairs.length,
    },
    conflicts,
    unresolved: [...unresolvedDims, ...solved.unresolved.filter((u) => u.kind !== 'fixture').map((u) => `${u.text}: ${u.why}`), ...labelsWithoutRoom],
    fixtureStrings: solved.unresolved.filter((u) => u.kind === 'fixture').map((u) => u.text),
    unnamedRooms: unnamed,
    assumptions: [
      { what: 'Ceiling height', value: formatFeetInches(D.ceiling), prov: 'default' },
      { what: 'Window sills', value: formatFeetInches(D.windowSill), prov: 'default' },
      { what: 'Window heads', value: formatFeetInches(D.windowHead), prov: 'default' },
      { what: 'Door heights', value: formatFeetInches(D.doorHeight), prov: 'default' },
      { what: 'Floor structure', value: formatFeetInches(D.floorThickness), prov: 'default' },
    ],
    flags: [
      { kind: 'needs_confirming', rooms: m.rooms.filter((r) => r.flags.includes('needs_confirming')).map((r) => r.name) },
      { kind: 'demolish', rooms: [...new Set(m.items.filter((i) => i.demolish).map((i) => roomAt(m.rooms, [i.x, i.y])).filter(Boolean) as string[])] },
    ],
    timingMs: timing,
  }
  return { guess, frame, ptPerInch: read.ptPerInch, pxPerInch: read.pxPerInch, dims, labels, tints, model: m, report }
}

/**
 * Ends that still touch nothing after healing: carry them straight on, up to 14 in, to the first
 * wall they reach (a traced piece often stops short where a jamb or a jog breaks a face line).
 * When the wall reached ends right there too, both meet at the corner.
 */
export function closeLooseEnds(walls: Wall[], reach = 14): Wall[] {
  const out = walls.map((w) => ({ ...w, a: [...w.a] as Vec, b: [...w.b] as Vec }))
  const touches = (p: Vec, self: Wall) =>
    out.some((o) => o !== self && (Math.hypot(p[0] - o.a[0], p[1] - o.a[1]) <= 0.5 || Math.hypot(p[0] - o.b[0], p[1] - o.b[1]) <= 0.5 || segDist(p, o.a, o.b) <= 0.5))
  for (const w of out)
    for (const e of ['a', 'b'] as const) {
      const p = w[e]
      if (touches(p, w)) continue
      const L = wallLength(w)
      const u: Vec = e === 'b' ? [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L] : [(w.a[0] - w.b[0]) / L, (w.a[1] - w.b[1]) / L]
      let best: { k: number; x: Vec; o: Wall } | null = null
      for (const o of out) {
        if (o === w) continue
        const lo = wallLength(o)
        const v: Vec = [(o.b[0] - o.a[0]) / lo, (o.b[1] - o.a[1]) / lo]
        const den = u[0] * v[1] - u[1] * v[0]
        if (Math.abs(den) < 0.17) continue // not across
        // p + u*k = o.a + v*s
        const dx = o.a[0] - p[0]
        const dy = o.a[1] - p[1]
        const k = (dx * v[1] - dy * v[0]) / den
        const sAlong = (dx * u[1] - dy * u[0]) / den
        if (k <= 0 || k > reach) continue
        if (sAlong < -(o.t / 2 + w.t / 2 + 1) || sAlong > lo + o.t / 2 + w.t / 2 + 1) continue
        if (!best || k < best.k) best = { k, x: [p[0] + u[0] * k, p[1] + u[1] * k], o }
      }
      if (!best) continue
      const x: Vec = [Math.round(best.x[0] * 100) / 100, Math.round(best.x[1] * 100) / 100]
      w[e] = [...x]
      // the wall reached ends just short of (or past) the meeting point: make it a corner
      for (const oe of ['a', 'b'] as const) {
        const q = best.o[oe]
        if (Math.hypot(q[0] - x[0], q[1] - x[1]) <= best.o.t / 2 + w.t / 2 + 1.5 && !touches(q, best.o)) best.o[oe] = [...x]
      }
    }
  return out
}

function segDist(p: Vec, a: Vec, b: Vec) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const L2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

const centersOf = (walls: Wall[], openings: Opening[]) => new Map(openings.map((o) => [o.id, centerOf(walls, o)]))

/**
 * Short walls (under 24 in) and very thin ones (under 3 1/4 in) with a free end inside the house are
 * cabinet sides and fixture edges (a tub rim reads as a thin band), not walls.
 */
export function dropLooseStubs(walls: Wall[]): Wall[] {
  const touches = (p: Vec, self: Wall) =>
    walls.some((o) => o !== self && (Math.hypot(p[0] - o.a[0], p[1] - o.a[1]) <= 0.5 || Math.hypot(p[0] - o.b[0], p[1] - o.b[1]) <= 0.5 || segDist(p, o.a, o.b) <= 0.5))
  return walls.filter((w) => w.exterior || (touches(w.a, w) && touches(w.b, w)) || (wallLength(w) >= 24 && (w.tMeasured ?? w.t) >= 3.25))
}

/**
 * Split walls where other walls meet them, so each wall runs from junction to junction (the unit a
 * person picks and moves). Openings go with the piece that holds their center.
 */
export function splitAtJunctions(walls: Wall[], openings: Opening[], centers: Map<string, Vec>): { walls: Wall[]; openings: Opening[] } {
  const out: Wall[] = []
  const owner = new Map<string, string>()
  for (const w of walls) {
    const L = wallLength(w)
    const u: Vec = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L]
    const cuts: number[] = []
    for (const o of walls) {
      if (o === w || (!o.exterior && wallLength(o) < 24)) continue
      for (const p of [o.a, o.b]) {
        const s = (p[0] - w.a[0]) * u[0] + (p[1] - w.a[1]) * u[1]
        const off = Math.abs((p[0] - w.a[0]) * u[1] - (p[1] - w.a[1]) * u[0])
        if (off <= 0.5 && s > 1 && s < L - 1) cuts.push(s)
      }
    }
    // keep openings whole: no cut inside an opening
    const mine = openings.filter((o) => o.wall === w.id)
    const sorted = [...new Set(cuts.map((c) => Math.round(c * 100) / 100))]
      .sort((a, b) => a - b)
      .filter((c) => !mine.some((o) => c > o.at - o.w / 2 - 0.5 && c < o.at + o.w / 2 + 0.5))
    // no slivers: every piece at least 12 in
    const ok: number[] = []
    for (const c of sorted) if (c - (ok[ok.length - 1] ?? 0) >= 12 && L - c >= 12) ok.push(c)
    const bounds = [0, ...ok, L]
    for (let i = 0; i < bounds.length - 1; i++) {
      const s0 = bounds[i]
      const s1 = bounds[i + 1]
      if (s1 - s0 < 0.5) continue
      const id = i === 0 ? w.id : `${w.id}s${i + 1}`
      const a: Vec = [Math.round((w.a[0] + u[0] * s0) * 100) / 100, Math.round((w.a[1] + u[1] * s0) * 100) / 100]
      const b: Vec = [Math.round((w.a[0] + u[0] * s1) * 100) / 100, Math.round((w.a[1] + u[1] * s1) * 100) / 100]
      out.push({ ...w, id, a, b, prov: { ...w.prov } })
      for (const o of mine) if (o.at >= s0 - 0.01 && o.at <= s1 + 0.01 && !owner.has(o.id)) owner.set(o.id, id)
    }
  }
  const outOpenings = openings
    .filter((o) => owner.has(o.id))
    .map((o) => {
      const wall = owner.get(o.id)!
      const w = out.find((x) => x.id === wall)!
      const c = centers.get(o.id)!
      const L = wallLength(w)
      const at = ((c[0] - w.a[0]) * (w.b[0] - w.a[0]) + (c[1] - w.a[1]) * (w.b[1] - w.a[1])) / L
      return { ...o, wall, at: Math.round(at * 100) / 100 }
    })
  return { walls: out, openings: outOpenings }
}

function centerOf(walls: Wall[], o: Opening): Vec {
  const w = walls.find((x) => x.id === o.wall)!
  const L = wallLength(w)
  return [w.a[0] + ((w.b[0] - w.a[0]) / L) * o.at, w.a[1] + ((w.b[1] - w.a[1]) / L) * o.at]
}
const rectPoly = (r: Box): Vec[] => [
  [r[0], r[1]],
  [r[2], r[1]],
  [r[2], r[3]],
  [r[0], r[3]],
]
const inRect = (r: Box, p: Vec) => p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]
const roomAt = (rooms: Room[], p: Vec) => rooms.find((r) => r.polygon.length >= 3 && pointInPolygon(p, r.polygon))?.name ?? null

/** Area of a polygon inside an axis-aligned rectangle (clip, then shoelace). */
function overlapArea(poly: Vec[], r: Box): number {
  let pts = poly
  const clip = (keep: (p: Vec) => boolean, cut: (p: Vec, q: Vec) => Vec) => {
    const out: Vec[] = []
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const q = pts[(i + 1) % pts.length]
      if (keep(p)) out.push(p)
      if (keep(p) !== keep(q)) out.push(cut(p, q))
    }
    pts = out
  }
  const atX = (x: number) => (p: Vec, q: Vec): Vec => [x, p[1] + ((q[1] - p[1]) * (x - p[0])) / (q[0] - p[0])]
  const atY = (y: number) => (p: Vec, q: Vec): Vec => [p[0] + ((q[0] - p[0]) * (y - p[1])) / (q[1] - p[1]), y]
  clip((p) => p[0] >= r[0], atX(r[0]))
  if (pts.length) clip((p) => p[0] <= r[2], atX(r[2]))
  if (pts.length) clip((p) => p[1] >= r[1], atY(r[1]))
  if (pts.length) clip((p) => p[1] <= r[3], atY(r[3]))
  return pts.length >= 3 ? polygonArea(pts) : 0
}

export { polygonBounds }
export type { Dimension }
