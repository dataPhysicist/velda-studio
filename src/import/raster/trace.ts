// Raster tracing entry point: a decoded plan bitmap in, walls with openings out, in sheet-raster
// inches (origin at the raster's top-left, x right, y down). Runs in the import worker.
import type { Vec } from '../../model/types'
import type { Gray } from '../types'
import { binarize, chains, otsu, transpose } from './lines'
import { type RawWall, type Scales, bridge, dropNested, dropSharedFace, extendToDoors, facePairs, findStairs, isOutside, outsideMap, readOpenings, sectionCodes } from './walls'

export type TracedOpening = {
  kind: 'door' | 'window' | 'opening'
  style: 'swing' | 'french' | 'sliding' | 'cased' | 'double_hung'
  at: number // inches from the wall's start to the opening's center
  w: number // inches, clear width as traced (not rounded)
  swing?: { hinge: 'a' | 'b'; side: 'left' | 'right' }
  conf: number
}

export type TracedWall = {
  id: string
  a: Vec
  b: Vec
  /** Face to face, inches, as traced. */
  tMeasured: number
  /** The two face lines across the wall (x for a vertical wall, y for a horizontal one), inches. */
  faces: [number, number]
  orient: 'h' | 'v'
  exterior: boolean
  openings: TracedOpening[]
  codes?: string
  /** Every piece of the wall is closed off at both ends (fixture outline or shelf, not a wall). */
  closed?: boolean
}

export type TraceResult = {
  threshold: number
  pxPerInch: Scales
  lines: { h: number; v: number }
  pieces: number
  extendedToDoors: number
  walls: TracedWall[]
  /** Stairs as rectangles (inches) with the run direction: along = the tread lines' direction. */
  stairs: { rect: [number, number, number, number]; treads: number; treadDir: 'h' | 'v'; /** the cut (break line) side: shorter treads */ breakAt: 'start' | 'end' }[]
  timingMs: Record<string, number>
}

const STANDARD_T = [3.5, 4.5, 5.5, 6, 6.5, 7.5, 8, 10, 12]
/** Nearest standard wall thickness (10-design-reference section 1). */
export function normalizeThickness(t: number): number {
  let best = STANDARD_T[0]
  for (const s of STANDARD_T) if (Math.abs(s - t) < Math.abs(best - t)) best = s
  return best
}

export function traceWalls(gray: Gray, pxPerInch: Scales, opts: { debugCodes?: boolean } = {}): TraceResult {
  const timing: Record<string, number> = {}
  let t0 = performance.now()
  const lap = (k: string) => {
    const t = performance.now()
    timing[k] = Math.round(t - t0)
    t0 = t
  }
  const threshold = Math.max(100, Math.min(200, otsu(gray.data)))
  const M = binarize(gray, threshold)
  const MT = transpose(M)
  lap('binarize')
  const vLines = chains(M, { minLen: Math.round(3 * pxPerInch.y) })
  const hLines = chains(MT, { minLen: Math.round(3 * pxPerInch.x) })
  lap('lines')
  const found = dropNested([...facePairs({ m: M, o: 'v' }, vLines, pxPerInch, 'v'), ...facePairs({ m: MT, o: 'h' }, hLines, pxPerInch, 'h')])
  const { stairs: rawStairs, rest: pieces } = findStairs(found, pxPerInch)
  lap('pairs')
  const pre = outsideMap(M, pieces.map((p) => ({ ...p, pieces: [p], exterior: false, openings: [] })))
  let across: RawWall[] = []
  const bridgeable = (o: 'h' | 'v', cross: number, s0: number, s1: number) => {
    const mid = (s0 + s1) / 2
    const off = 12 * (o === 'v' ? pxPerInch.x : pxPerInch.y)
    const [ax, ay, bx, by] = o === 'v' ? [cross - off, mid, cross + off, mid] : [mid, cross - off, mid, cross + off]
    if (isOutside(pre, ax, ay) && isOutside(pre, bx, by)) {
      return false
    }
    // A gap that another wall runs across (a hallway between two rooms' walls) is not one wall.
    const margin = 2 * (o === 'v' ? pxPerInch.y : pxPerInch.x)
    for (const p of pieces) {
      if (p.o === o || p.s1 - p.s0 < 12 * (o === 'v' ? pxPerInch.x : pxPerInch.y)) continue
      if (cross < p.s0 - 2 || cross > p.s1 + 2) continue
      if (p.c2 > s0 + margin && p.c1 < s1 - margin && s1 - s0 > p.c2 - p.c1 + 2 * margin) {
        return false
      }
    }
    // A corridor: at both ends of the gap a wall across runs on past this line on both sides
    // (the hall's own walls). Bridging it would hang a header across the hall; a real opening
    // has a plain wall end on at least one side.
    const ia = o === 'v' ? pxPerInch.x : pxPerInch.y // along the other walls
    const ial = o === 'v' ? pxPerInch.y : pxPerInch.x
    const through = (at: number, inward: 1 | -1) =>
      across.some((w) => {
        if (w.o === o) return false
        const d = ((w.c1 + w.c2) / 2 - at) * inward
        return d >= -((w.c2 - w.c1) / 2 + 3 * ial) && d <= 14 * ial && w.s0 < cross - 12 * ia && w.s1 > cross + 12 * ia
      })
    if (s1 - s0 >= 20 * ial && through(s0, 1) && through(s1, -1)) return false
    return true
  }
  // Bridge one orientation at a time so each can see the other's finished walls (doors bridged).
  const hFirst = bridge(pieces, pxPerInch, bridgeable, 'h')
  across = hFirst
  const vWalls = bridge(pieces, pxPerInch, bridgeable, 'v')
  across = vWalls
  const hWalls = bridge(pieces, pxPerInch, bridgeable, 'h')
  let walls = dropSharedFace([...hWalls, ...vWalls], pxPerInch).filter((w) => (w.s1 - w.s0) / (w.o === 'v' ? pxPerInch.y : pxPerInch.x) >= 6)
  lap('bridge')
  const outside = outsideMap(M, walls)
  for (const w of walls) {
    const ca = w.o === 'v' ? pxPerInch.x : pxPerInch.y
    const off = (w.c2 - w.c1) / 2 + 5 * ca
    const mid = (w.c1 + w.c2) / 2
    let hits = 0
    for (const f of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      const s = w.s0 + (w.s1 - w.s0) * f
      for (const k of [-1, 1]) {
        const c = mid + k * off
        const [x, y] = w.o === 'v' ? [c, s] : [s, c]
        if (isOutside(outside, x, y)) hits++
      }
    }
    w.exterior = hits >= 3
  }
  lap('exterior')
  const extended = extendToDoors(M, MT, walls, pxPerInch)
  for (const w of walls) {
    const view = { m: w.o === 'v' ? M : MT, o: w.o }
    const { codes, step } = sectionCodes(view, w, pxPerInch)
    w.openings = readOpenings(M, w, codes, step, pxPerInch)
    if (opts.debugCodes) w.codes = codes
  }
  lap('openings')
  walls = walls.sort((p, q) => (p.o === q.o ? (p.c1 + p.c2) / 2 - (q.c1 + q.c2) / 2 || p.s0 - q.s0 : p.o === 'h' ? -1 : 1))
  return {
    threshold,
    pxPerInch,
    lines: { h: hLines.length, v: vLines.length },
    pieces: pieces.length,
    extendedToDoors: extended,
    walls: walls.map((w, i) => toInches(w, i, pxPerInch)),
    stairs: rawStairs.map((st) => {
      const r2 = (v: number) => Math.round(v * 100) / 100
      const [x0, y0, x1, y1] = st.o === 'h' ? [st.s0 / pxPerInch.x, st.c0 / pxPerInch.y, st.s1 / pxPerInch.x, st.c1 / pxPerInch.y] : [st.c0 / pxPerInch.x, st.s0 / pxPerInch.y, st.c1 / pxPerInch.x, st.s1 / pxPerInch.y]
      return { rect: [r2(x0), r2(y0), r2(x1), r2(y1)] as [number, number, number, number], treads: st.treads, treadDir: st.o, breakAt: (st.lens[0] < st.lens[st.lens.length - 1] ? 'start' : 'end') as 'start' | 'end' }
    }),
    timingMs: timing,
  }
}

function toInches(w: RawWall, i: number, s: Scales): TracedWall {
  const vert = w.o === 'v'
  const ca = vert ? s.x : s.y
  const al = vert ? s.y : s.x
  const mid = (w.c1 + w.c2) / 2 / ca
  const a: Vec = vert ? [mid, w.s0 / al] : [w.s0 / al, mid]
  const b: Vec = vert ? [mid, w.s1 / al] : [w.s1 / al, mid]
  const r2 = (v: number) => Math.round(v * 100) / 100
  return {
    id: `t${i + 1}`,
    a: [r2(a[0]), r2(a[1])],
    b: [r2(b[0]), r2(b[1])],
    tMeasured: r2((w.c2 - w.c1) / ca),
    faces: [r2(w.c1 / ca), r2(w.c2 / ca)],
    orient: w.o,
    exterior: w.exterior,
    openings: w.openings.map((o) => ({
      kind: o.kind,
      style: o.style,
      at: r2(((o.s0 + o.s1) / 2 - w.s0) / al),
      w: r2((o.s1 - o.s0) / al),
      ...(o.hinge && o.side ? { swing: { hinge: o.hinge, side: o.side } } : {}),
      conf: r2(o.conf),
    })),
    ...(w.codes ? { codes: w.codes } : {}),
    ...(w.pieces.every((p) => p.open && !p.open[0] && !p.open[1]) ? { closed: true } : {}),
  }
}
