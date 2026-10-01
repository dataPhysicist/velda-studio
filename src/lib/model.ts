// The Studio model: a small, plain description of the house in inches that the conversation edits.
// It is the source of truth and what each version stores. The Pascal 3D scene is compiled from it.
// Plan coordinates: x to the right, y down the sheet (same frame as the Velda 3D plans).

import { type Geo, planRooms, planWalls } from './plan-walls'
import type { Theme } from './theme'

export type LevelId = string
export type Vec = [number, number]

export type StudioLevel = { id: LevelId; name: string; elev: number; height: number }
export type OpeningKind = 'door' | 'window' | 'opening'
export type StudioOpening = {
  id: string
  kind: OpeningKind
  at: number // distance from the wall's start point to the opening's center
  w: number
  h: number
  sill?: number // windows: floor to bottom of glass
  shape?: 'rectangle' | 'arch'
  style?: 'swing' | 'pocket' | 'sliding' | 'french'
}
export type StudioWall = {
  id: string
  level: LevelId
  a: Vec
  b: Vec
  t: number
  h?: number // defaults to the level's ceiling height
  kind?: 'wall' | 'glass' | 'half'
  openings: StudioOpening[]
}
export type StudioRoom = { id: string; level: LevelId; name: string; polygon: Vec[]; theme?: string | null }
export type ItemKind =
  | 'base_cabinet'
  | 'island'
  | 'vanity'
  | 'sink'
  | 'range'
  | 'cooktop'
  | 'dishwasher'
  | 'fridge'
  | 'oven_tower'
  | 'tall_cabinet'
  | 'wall_cabinet'
  | 'hood'
  | 'tub'
  | 'shower'
  | 'toilet'
  | 'bench'
  | 'glass'
  | 'beam'
  | 'item'
export type StudioItem = {
  id: string
  level: LevelId
  kind: ItemKind
  label: string
  x: number
  y: number
  rot: number // degrees; 0 = front faces down the sheet (+y), 90 = faces right (+x)
  w: number // along the front
  d: number
  h: number
  z?: number // lift off the floor
  catalog?: string // Pascal catalog id for kind 'item'
  color?: string
  props?: Record<string, unknown>
}
export type StudioModel = {
  v: 1
  ceiling: number
  levels: StudioLevel[]
  walls: StudioWall[]
  rooms: StudioRoom[]
  items: StudioItem[]
  theme: string | null // house theme id
  themes: Record<string, Theme> // themes this scheme uses (house and per-room), versioned with it
  notes?: string[]
}

let counter = 0
export function sid(prefix: string) {
  counter = (counter + 1) % 1e6
  return `${prefix}${Date.now().toString(36).slice(-5)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

export function wallLength(w: StudioWall) {
  return Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
}

// ------------------------------------------------------------------ import from Velda 3D

export type Velda3DScene = {
  levels: { id: string; name: string; elev: number; height: number }[]
  sheets: Record<string, { dx: number; dy: number; level: string; title: string }>
}
export type Velda3DItem = {
  id: string
  level: string
  type: string
  label: string
  x: number
  y: number
  rot: number
  w: number
  d: number
  h: number
  z?: number
  color?: string
  props?: string | Record<string, unknown> | null
}

const ITEM_KIND: Record<string, ItemKind> = {
  vanity: 'vanity',
  base_cabinet: 'base_cabinet',
  island: 'island',
  sink: 'sink',
  range: 'range',
  cooktop: 'cooktop',
  dishwasher: 'dishwasher',
  fridge: 'fridge',
  oven: 'oven_tower',
  tall_cabinet: 'tall_cabinet',
  tub: 'tub',
  corner_tub: 'tub',
  shower: 'shower',
  toilet: 'toilet',
  bench: 'bench',
  glass: 'glass',
}

/** Build a Studio model from Velda 3D's plan extraction (one geo per level) and its items. */
export function modelFromVelda3D(opts: {
  scene: Velda3DScene
  geos: { sheet: string; level: string; geo: Geo }[]
  items: Velda3DItem[]
  ceiling: number
  theme: string | null
  themes?: Record<string, Theme>
}): StudioModel {
  const { scene, geos, items, ceiling } = opts
  const model: StudioModel = {
    v: 1,
    ceiling,
    levels: scene.levels.map((l) => ({ id: l.id, name: l.name, elev: l.elev, height: l.height || ceiling })),
    walls: [],
    rooms: [],
    items: [],
    theme: opts.theme,
    themes: opts.themes ?? {},
  }
  for (const { sheet, level, geo } of geos) {
    const off = scene.sheets[sheet] ?? { dx: 0, dy: 0 }
    const pw = planWalls(geo, off.dx, off.dy)
    pw.forEach((w, i) => {
      const id = `${level}w${i + 1}`
      const a: Vec = w.horiz ? [w.s, w.cross] : [w.cross, w.s]
      const b: Vec = w.horiz ? [w.e, w.cross] : [w.cross, w.e]
      model.walls.push({
        id,
        level,
        a: a.map(r1) as Vec,
        b: b.map(r1) as Vec,
        t: r1(w.t),
        openings: w.openings.map((o, k) => {
          const width = o.e - o.s
          const at = (o.s + o.e) / 2 - w.s
          return o.kind === 'door'
            ? { id: `${id}d${k + 1}`, kind: 'door', at: r1(at), w: r1(width), h: Math.min(80, ceiling - 6), style: width > 70 ? 'sliding' : 'swing' }
            : { id: `${id}n${k + 1}`, kind: 'window', at: r1(at), w: r1(width), h: 48, sill: 36 }
        }),
      })
    })
    planRooms(geo, pw, off.dx, off.dy).forEach((r, i) => {
      model.rooms.push({ id: `${level}r${i + 1}`, level, name: r.name, polygon: r.polygon.map((p) => p.map(r1) as Vec) })
    })
  }
  for (const it of items) {
    const kind = ITEM_KIND[it.type] ?? 'item'
    let props: Record<string, unknown> = {}
    try {
      props = typeof it.props === 'string' ? JSON.parse(it.props) : (it.props ?? {})
    } catch {}
    if (it.type === 'corner_tub') props = { ...props, corner: true }
    model.items.push({
      id: it.id,
      level: it.level,
      kind,
      label: it.label,
      x: r1(it.x),
      y: r1(it.y),
      rot: r1(it.rot || 0),
      w: r1(it.w),
      d: r1(it.d),
      h: r1(it.h),
      ...(it.z ? { z: r1(it.z) } : {}),
      ...(it.color ? { color: it.color } : {}),
      ...(Object.keys(props).length ? { props } : {}),
    })
  }
  return model
}

const r1 = (v: number) => Math.round(v * 10) / 10

// ------------------------------------------------------------------ geometry helpers

export function pointInPolygon(p: Vec, poly: Vec[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function polygonBounds(poly: Vec[]) {
  const xs = poly.map((p) => p[0])
  const ys = poly.map((p) => p[1])
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

export function polygonArea(poly: Vec[]) {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(s) / 2
}

export function roomAt(model: StudioModel, level: LevelId, p: Vec): StudioRoom | null {
  return model.rooms.find((r) => r.level === level && pointInPolygon(p, r.polygon)) ?? null
}
