// Which library fixtures fit a room (07 section 7, 10 section 6). A shower type fits when one of its
// sizes stands against a wall of the room (in a corner where it needs two walls), clear of doors and
// their swings, with the clear space in front that code asks for. The room is taken as its walls:
// fixtures already there are what a remodel replaces, so they do not count against a fit.
import { obstacles, ray } from '../analysis/space'
import { add, mul } from '../model/geom'
import { freeSpans, type RoomEdge, roomEdges } from '../model/place'
import type { Model, Room, Vec } from '../model/types'
import { formatFeetInches } from '../model/units'
import showers from './showers.json'
import S from './standards.json'

export type ShowerEntry = {
  id: string
  name: string
  min: number[]
  ideal: number[]
  sizes: number[][]
  walls: number
  corner?: boolean
  room?: boolean
  maxCeiling?: number
  needs: string
  bestFor: string
  watchOut: string
}
export type Fit = {
  id: string
  name: string
  /** Interior width along the wall by depth, inches. */
  size: [number, number]
  /** The type's ideal size fits, not only its minimum. */
  ideal: boolean
  wall: string | null
  where: string
  front: number
  needs: string
  bestFor: string
  watchOut: string
}
export type Miss = { id: string; name: string; why: string }

const ft = (v: number) => formatFeetInches(v).replace(/^0'-/, '')
const side = (e: RoomEdge) => (e.inward[1] > 0.9 ? 'top' : e.inward[1] < -0.9 ? 'bottom' : e.inward[0] > 0.9 ? 'left' : e.inward[0] < -0.9 ? 'right' : 'angled')

/** The shower types that fit the room, best size first, and why the others do not. */
export function showerFits(m: Model, room: Room): { fits: Fit[]; misses: Miss[] } {
  const fits: Fit[] = []
  const misses: Miss[] = []
  const edges = roomEdges(m, room)
  const walls = obstacles(m, room.level, { itemsToo: false })
  const clearIn = (e: RoomEdge, from: number, to: number) => {
    // Depth of clear floor in from this stretch of wall (the least of three probes across it).
    return Math.min(
      ...[0.15, 0.5, 0.85].map((k) => {
        const p = add(add(e.a, mul(e.dir, from + (to - from) * k)), mul(e.inward, 0.01))
        return ray(p, e.inward, walls).dist
      }),
    )
  }
  const level = m.levels.find((l) => l.id === room.level)
  const xs = room.polygon.map((p) => p[0])
  const ys = room.polygon.map((p) => p[1])
  const roomW = Math.max(...xs) - Math.min(...xs)
  const roomD = Math.max(...ys) - Math.min(...ys)
  const front = S.bath.showerFront.code
  const frontIdeal = S.bath.showerFront.nkba

  for (const sh of showers.entries as unknown as ShowerEntry[]) {
    if (sh.maxCeiling && level && level.ceiling > sh.maxCeiling) {
      misses.push({ id: sh.id, name: sh.name, why: `the ceiling is ${ft(level.ceiling)}; a steam shower wants 7 to 8 ft, so it fits only if the ceiling over it is dropped and sloped` })
      continue
    }
    if (sh.room) {
      const size = sh.sizes.find(([w, d]) => (roomW >= w && roomD >= d) || (roomW >= d && roomD >= w))
      if (size) fits.push(make(sh, size as [number, number], null, `the whole room (${ft(roomW)} by ${ft(roomD)})`, 0))
      else misses.push({ id: sh.id, name: sh.name, why: `the room is ${ft(roomW)} by ${ft(roomD)}; a wet room needs at least ${ft(sh.min[0])} by ${ft(sh.min[1])}` })
      continue
    }
    let found: Fit | null = null
    for (const [w, d] of sh.sizes as [number, number][]) {
      for (let i = 0; i < edges.length && !found; i++) {
        const e = edges[i]
        if (!e.wall) continue
        const prev = edges[(i - 1 + edges.length) % edges.length]
        const next = edges[(i + 1) % edges.length]
        for (const [s0, s1] of freeSpans(m, e, new Set(m.items.map((it) => it.id)), 3, d + front)) {
          if (s1 - s0 < w - 0.01) continue
          // In a corner: the stretch starts where the wall meets the one before it, or ends at the next.
          const spots: [number, number, boolean][] = []
          if (s0 < 0.5 && prev.wall) spots.push([s0, s0 + w, true])
          if (s1 > e.len - 0.5 && next.wall) spots.push([s1 - w, s1, true])
          if (!sh.corner && sh.walls < 2) spots.push([s0, s0 + w, false])
          for (const [a, b] of spots) {
            const depth = clearIn(e, a, b)
            if (depth < d + front) continue
            found = make(sh, [w, d], e.wall.id, `in the ${corner(e, a < 0.5 ? 'start' : 'end', prev, next)} corner along the ${side(e)} wall (${ft(e.len)} long)`, depth - d)
            found.ideal = w >= sh.ideal[0] && d >= sh.ideal[1] && depth - d >= frontIdeal
            break
          }
          if (found) break
        }
      }
      if (found) break
    }
    if (found) fits.push(found)
    else misses.push({ id: sh.id, name: sh.name, why: `no wall has ${ft(sh.min[0])} clear in a corner with ${ft(sh.min[1] + front)} of floor in front of it (the shower plus ${ft(front)} to step out)` })
  }
  return { fits, misses }
}

function make(sh: ShowerEntry, size: [number, number], wall: string | null, where: string, front: number): Fit {
  return { id: sh.id, name: sh.name, size, ideal: size[0] >= sh.ideal[0] && size[1] >= sh.ideal[1], wall, where, front: Math.round(front), needs: sh.needs, bestFor: sh.bestFor, watchOut: sh.watchOut }
}

function corner(e: RoomEdge, end: 'start' | 'end', prev: RoomEdge, next: RoomEdge) {
  const other = end === 'start' ? prev : next
  return `${side(e)}-${side(other)}`.replace(/^(bottom|top)-(left|right)$/, '$1 $2').replace(/^(left|right)-(top|bottom)$/, '$2 $1')
}

/** Lines for Velda's prompt: the shower types that fit a bathroom, and the ones that do not. */
export function fitsForPrompt(m: Model, room: Room): string {
  const { fits, misses } = showerFits(m, room)
  const lines = [
    `SHOWER TYPES THAT FIT the ${room.name} (worked out from its walls, doors and swings; existing fixtures are taken as replaceable):`,
    ...fits.map((f) => `- ${f.name}: up to ${ft(f.size[0])} x ${ft(f.size[1])} inside${f.ideal ? ' (its ideal size)' : ' (below its ideal size)'}, ${f.where}${f.front ? `, ${ft(f.front)} clear in front` : ''}. Needs ${f.needs}. Best for ${f.bestFor}. Watch out: ${f.watchOut}.`),
    ...(misses.length ? ['DO NOT FIT:', ...misses.map((x) => `- ${x.name}: ${x.why}.`)] : []),
  ]
  return lines.join('\n')
}

export type { Vec }
