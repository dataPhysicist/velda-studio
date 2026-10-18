// v0.3 (model v1) to model v2. Runs once per scheme on first open of 1.0 and writes a new version
// with author 'migration'; the v1 version stays in the table. Spec: 04 "Migration from v1", 05 3.10.
import type { StudioModel } from '../lib/model'
import { deriveRooms, exteriorWallIds, healWalls } from './derive'
import { centroid, dist, dot, pointInPolygon, poleOfInaccessibility, polygonArea, rv, wallDir } from './geom'
import { restack } from './ops'
import { ITEM_KINDS, type ItemKind, type Model, type Opening, type OpeningStyle, type Prov, type Room, type Vec, type Wall } from './types'
import { formatFeetInches } from './units'

/** v0.3 coordinates are this far from the A2 sheet frame (sheet-raster inches); both levels move together. */
export const V03_TO_A2: Vec = [3.1, 126]

export type HandCheckedWall = { id: string; level: string; a: Vec; b: Vec }

export type MigrateOptions = {
  projectName?: string
  /** v0.3 level 2 walls checked by hand against A2 (scripts/plan-openings/level2-asbuilt-walls.json), in the v0.3 frame. */
  handChecked?: HandCheckedWall[]
  offset?: Vec
  now?: string
}

export type MigrateReport = { walls: number; openings: number; rooms: number; explicitRooms: number; healed: string[]; handChecked: number; exterior: number }

const MIGRATED: Prov = { src: 'sheet_raster', note: 'migrated from v0.3' }

export function isV1(m: any): m is StudioModel {
  return !!m && m.v === 1
}

export function migrateV1(m1: StudioModel, opts: MigrateOptions = {}): { model: Model; report: MigrateReport } {
  const [ox, oy] = opts.offset ?? V03_TO_A2
  const now = opts.now ?? new Date().toISOString()
  const T = (p: Vec): Vec => rv([p[0] + ox, p[1] + oy])
  const checked = new Map((opts.handChecked ?? []).map((w) => [w.id, w]))
  let handChecked = 0

  const levels = m1.levels.map((l) => {
    const ceiling = l.height || m1.ceiling
    return {
      id: l.id,
      name: l.name,
      elev: l.elev,
      ceiling,
      floorThickness: 12,
      sheetIds: [] as string[],
      prov: {
        ceiling: { src: 'default', note: `${formatFeetInches(ceiling)} carried over from v0.3; confirm the ceiling height` } as Prov,
        floorThickness: { src: 'default' } as Prov,
      },
    }
  })

  const walls: Wall[] = []
  const openings: Opening[] = []
  for (const w of m1.walls) {
    const hc = checked.get(w.id)
    const isChecked = !!hc && hc.level === w.level && dist(hc.a, w.a) <= 0.5 && dist(hc.b, w.b) <= 0.5
    if (isChecked) handChecked++
    const prov: Prov = isChecked ? { src: 'user', note: 'hand-checked against A2 in v0.3' } : MIGRATED
    walls.push({
      id: w.id,
      level: w.level,
      a: T(w.a),
      b: T(w.b),
      t: w.t,
      ...(w.h !== undefined ? { h: w.h } : {}),
      kind: w.kind === 'glass' || w.kind === 'half' ? w.kind : 'wall',
      exterior: false,
      bearing: 'unknown',
      prov: { a: { ...prov }, b: { ...prov }, t: { ...prov } },
    })
    for (const o of w.openings) {
      const kind = o.kind
      const style: OpeningStyle = o.style ? o.style : kind === 'window' ? 'double_hung' : kind === 'opening' ? 'cased' : 'swing'
      const isWindow = kind === 'window'
      const sill = isWindow ? (o.sill ?? 36) : undefined
      openings.push({
        id: o.id,
        wall: w.id,
        kind,
        at: o.at,
        w: o.w,
        // v1 window h is the glass height; v2 h is the head height.
        h: isWindow ? sill! + o.h : o.h,
        ...(sill !== undefined ? { sill } : {}),
        style: kind === 'opening' ? 'cased' : style,
        ...(kind === 'door' && (style === 'swing' || style === 'french') ? { swing: { hinge: 'a' as const, side: 'left' as const } } : {}),
        ...(o.shape ? { shape: o.shape } : {}),
        prov: {
          at: { ...prov },
          w: { ...prov },
          h: { src: 'default' },
          ...(sill !== undefined ? { sill: { src: 'default' } as Prov } : {}),
          ...(kind === 'door' ? { swing: { src: 'default' } as Prov } : {}),
        },
      })
    }
  }

  // Close small gaps so corners and tees connect for editing; keep openings where they were.
  const healed = healWalls(walls)
  for (const nw of healed.walls) {
    const ow = walls.find((x) => x.id === nw.id)!
    const shift = dot([nw.a[0] - ow.a[0], nw.a[1] - ow.a[1]], wallDir(ow))
    if (Math.abs(shift) > 1e-6) for (const o of openings) if (o.wall === nw.id) o.at = Math.round((o.at - shift) * 100) / 100
    ow.a = nw.a
    ow.b = nw.b
  }

  const model: Model = {
    v: 2,
    units: 'in',
    project: { name: opts.projectName ?? '5008 Velda Dairy', north: null, front: null, remodelRooms: [] },
    levels,
    sheets: [],
    walls,
    openings,
    rooms: m1.rooms.map((r) => {
      const polygon = r.polygon.map(T)
      return {
        id: r.id,
        level: r.level,
        name: r.name,
        polygon,
        flags: [],
        labelAt: polygon.length >= 3 ? poleOfInaccessibility(polygon) : undefined,
        ...(r.theme !== undefined ? { theme: r.theme } : {}),
        prov: { src: 'derived' as const },
      }
    }),
    items: m1.items.map((it) => {
      const kind: ItemKind = (ITEM_KINDS as readonly string[]).includes(it.kind) ? (it.kind as ItemKind) : 'item'
      const [x, y] = T([it.x, it.y])
      return {
        id: it.id,
        level: it.level,
        kind,
        label: it.label,
        x,
        y,
        rot: it.rot,
        w: it.w,
        d: it.d,
        h: it.h,
        ...(it.z !== undefined ? { z: it.z } : {}),
        ...(it.catalog ? { catalog: it.catalog } : {}),
        ...(it.color ? { color: it.color } : {}),
        ...(it.props ? { props: it.props } : {}),
        prov: { ...MIGRATED },
      }
    }),
    stairs: [],
    dimensions: [],
    inspiration: [],
    theme: m1.theme,
    themes: m1.themes ?? {},
    notes: (m1.notes ?? []).map((text, i) => ({ id: `note-v03-${i + 1}`, text, author: 'user' as const, createdAt: now })),
    meta: { migratedFrom: 1 },
  }
  restack(model)

  // Exterior walls: on the outer boundary of their level. Software may mark them load-bearing.
  let exterior = 0
  for (const lv of model.levels) {
    const ext = exteriorWallIds(model, lv.id)
    for (const w of model.walls)
      if (w.level === lv.id && ext.has(w.id)) {
        w.exterior = true
        w.bearing = 'yes'
        exterior++
      }
  }

  // Rooms: derive them from the walls, but keep a v0.3 outline where the v0.3 walls do not close
  // the room (traced gaps merge rooms into one face). Such rooms stay explicit and are flagged
  // 'open_outline' until the sheet is imported again.
  const v1Rooms = model.rooms
  const derived = deriveRooms(model)
  const kept: Room[] = []
  let explicit = 0
  for (const r1 of v1Rooms) {
    const d = derived.rooms.find((r) => r.id === r1.id && r.name === r1.name)
    const a1 = polygonArea(r1.polygon)
    const others = v1Rooms.filter((o) => o !== r1 && o.level === r1.level && o.labelAt && d && pointInPolygon(o.labelAt, d.polygon))
    const good = d && !others.length && a1 > 0 && Math.abs(polygonArea(d.polygon) - a1) / a1 <= 0.3
    if (good) kept.push(d!)
    else {
      explicit++
      kept.push({ ...r1, explicit: true, flags: ['open_outline'] })
    }
  }
  // Faces nobody named in v0.3 stay only where no kept room covers them.
  for (const r of derived.rooms)
    if (!kept.some((k) => k.id === r.id) && !kept.some((k) => k.level === r.level && pointInPolygon(r.labelAt ?? centroid(r.polygon), k.polygon))) kept.push(r)
  derived.rooms = kept
  return {
    model: derived,
    report: { walls: derived.walls.length, openings: derived.openings.length, rooms: derived.rooms.length, explicitRooms: explicit, healed: healed.moved, handChecked, exterior },
  }
}
