// The checker (07 section 5): deterministic rules over the model, run on every version. Each issue
// says what is wrong in one plain sentence, where, how serious, and (when one operation fixes it)
// the fix. 'blocks' is only for code minimums; NKBA guidance is 'fix'; everything else is a 'note'.
import { pointInPolygon, polygonBounds, wallLength } from '../model/geom'
import type { Op } from '../model/ops'
import { badgeOf, type Item, type Model, type Opening, type Room, type Vec, type Wall } from '../model/types'
import { formatFeetInches } from '../model/units'
import S from '../library/standards.json'
import { clearAlong, footprint, frameOf, obstacles, onFloor, openingFrame, overlaps, ray, roomOf, roomsAcross, type Seg, shrink, swingArea } from './space'

export type Severity = 'blocks' | 'fix' | 'note'
export type Issue = {
  id: string
  severity: Severity
  rule: string
  where: { level: string; room?: string; ids: string[] }
  message: string
  fix?: Op[]
  fixLabel?: string
  /** Structural cautions can be acknowledged but never dismissed. */
  locked?: boolean
}

export type CheckOptions = { asBuilt?: Model | null }

const add = (p: Vec, q: Vec): Vec => [p[0] + q[0], p[1] + q[1]]
const mul = (p: Vec, k: number): Vec => [p[0] * k, p[1] * k]
const r8 = (v: number) => Math.round(v * 8) / 8
/** Feet and inches, but 6" rather than 0'-6" under a foot. */
const fmt = (v: number) => formatFeetInches(v).replace(/^(-?)0'-/, '$1')
const nameOf = (it: Item) => it.label || it.kind.replace('_', ' ')
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
/** "the Primary Bath", but "Room 3" (a generic name reads better without it). */
const theRoom = (name: string) => (/^(room|space|area)\b/i.test(name) ? name : `the ${name}`)
const ROOM_WET = /bath|powder|wc|shower|laundry/i
const BEDROOM = /bed(room)?\b/i
const CLOSET = /clo?se?t|clst|w\.?i\.?c|pantry|linen|storage/i
const HALL = /hall|corridor|gallery/i
const KITCHEN_KINDS = new Set(['base_cabinet', 'island', 'sink', 'range', 'cooktop', 'dishwasher', 'fridge', 'oven_tower', 'tall_cabinet', 'stove'])

/** Every issue in the model, ordered most serious first, then by room. */
export function runChecks(m: Model, opts: CheckOptions = {}): Issue[] {
  const out: Issue[] = []
  const segsBy = new Map<string, Seg[]>()
  const segs = (level: string) => {
    let s = segsBy.get(level)
    if (!s) segsBy.set(level, (s = obstacles(m, level)))
    return s
  }
  const push = (i: Omit<Issue, 'id'>) => out.push({ ...i, id: `${i.rule}:${i.where.ids.join(',')}` })
  const roomName = (level: string, p: Vec) => roomOf(m, level, p)?.name

  for (const it of m.items) {
    // A sink or cooktop set into a counter, island or vanity: the host carries the clearances.
    const host = hostOf(m, it)
    const guests = new Set(m.items.filter((g) => hostOf(m, g)?.id === it.id).map((g) => g.id))
    const others = segs(it.level).filter((s) => s.id !== it.id && s.id !== host?.id && !guests.has(s.id))
    const room = roomOf(m, it.level, [it.x, it.y])
    const where = { level: it.level, room: room?.id, ids: [it.id] }
    const { c, f, s } = frameOf(it)
    const frontPts = (n = 3): Vec[] => Array.from({ length: n }, (_, i) => add(add(c, mul(f, it.d / 2 + 0.01)), mul(s, (it.w / 2 - 1) * (n === 1 ? 0 : (2 * i) / (n - 1) - 1))))
    if (it.kind === 'toilet') checkToilet(it, others, where, push)
    if (it.kind === 'shower') {
      const lo = Math.min(it.w, it.d)
      if (lo < S.bath.showerMinSide.code || it.w * it.d < S.bath.showerMinArea.code)
        push({ severity: 'blocks', rule: 'shower-size', where, message: `The ${lc(nameOf(it))} is ${fmt(it.w)} by ${fmt(it.d)} inside; code needs at least 2'-6" each way and 900 square inches.` })
      else if (lo < S.bath.showerMinSide.nkba) push({ severity: 'fix', rule: 'shower-size', where, message: `The ${lc(nameOf(it))} is ${fmt(it.w)} by ${fmt(it.d)}; 3'-0" by 3'-0" inside is the comfortable minimum.` })
      const front = clearAlong(frontPts(1), f, others)
      if (front.dist < S.bath.showerFront.code)
        push({ severity: 'blocks', rule: 'shower-front', where, message: `Only ${fmt(front.dist)} clear in front of the ${lc(nameOf(it))}; code needs 2'-0" in front of the opening.` })
      else if (front.dist < S.bath.showerFront.nkba) push({ severity: 'fix', rule: 'shower-front', where, message: `${fmt(front.dist)} clear in front of the ${lc(nameOf(it))}; 2'-6" is recommended.` })
    }
    if (it.kind === 'tub') {
      // The 21 in has to be there along a usable stretch of the open side (at least 2'-6", or half a
      // short tub), not along every inch: a toilet beside the end of the tub is the usual 5 by 8 bath.
      const n = Math.max(3, Math.round(it.w / 2))
      const pts = frontPts(n)
      const need = Math.min(30, it.w / 2)
      const step = (it.w - 2) / (n - 1)
      let run = 0
      let best = 0
      let deepest = 0
      for (const p of pts) {
        const d = ray(p, f, others).dist
        deepest = Math.max(deepest, d)
        run = d >= S.bath.tubFront.code ? run + step : 0
        best = Math.max(best, run)
      }
      if (best < need) push({ severity: 'blocks', rule: 'tub-front', where, message: `Only ${fmt(Math.min(deepest, S.bath.tubFront.code - 0.5))} clear along the open side of the ${lc(nameOf(it))}; code needs 1'-9".` })
    }
    if ((it.kind === 'vanity' || (it.kind === 'sink' && room && ROOM_WET.test(room.name))) && !host) {
      const front = clearAlong(frontPts(3), f, others)
      if (front.dist < S.bath.lavatoryFront.code)
        push({ severity: 'blocks', rule: 'lavatory-front', where, message: `Only ${fmt(front.dist)} clear in front of the ${lc(nameOf(it))}; code needs 1'-9".` })
      const sinks = Number((it.props as { sinks?: number } | undefined)?.sinks ?? (it.w >= 60 ? 2 : 1))
      if (it.kind === 'vanity' && it.w / sinks < S.bath.lavatoryWidthPerSink.nkba)
        push({ severity: 'note', rule: 'lavatory-width', where, message: `The ${lc(nameOf(it))} gives ${fmt(it.w / sinks)} per sink; 2'-6" per sink is recommended.` })
    }
    if (KITCHEN_KINDS.has(it.kind) && it.kind !== 'dishwasher' && !host) checkAisle(m, it, others, where, push)
    if (it.kind === 'dishwasher') checkDishwasher(it, others, where, push)
    if (it.kind === 'range' || it.kind === 'cooktop' || it.kind === 'stove') checkRangeWindow(m, it, where, push)
    if (it.kind === 'fridge') checkFridgeDoor(m, it, where, push)
    if (it.kind === 'sink') {
      const island = host?.kind === 'island' ? host : undefined
      if (island)
        push({ severity: 'note', rule: 'island-sink', where: { ...where, ids: [it.id, island.id] }, message: `A sink in the ${lc(nameOf(island))} needs an island vent (or loop vent) and a drain route to the stack; a plumber should confirm.` })
    }
  }

  checkDoors(m, push, roomName)
  checkHalls(m, push)
  checkEgress(m, push)
  checkStairs(m, push)
  checkGlazing(m, push)
  checkPlumbingMoves(m, opts.asBuilt ?? null, push)

  // Structural cautions recorded on the plan: shown every time, never dismissed.
  for (const n of m.notes)
    if (n.locked) {
      const room = n.at ? nearRoom(m, n.at.level, n.at.p) : undefined
      push({
        severity: 'note',
        rule: 'structure',
        where: { level: n.at?.level ?? m.levels[0]?.id ?? 'L1', room: room?.id, ids: [n.id] },
        message: n.text.replace(/\bwall (?!may\b)[\w-]+/g, room ? `a wall of the ${room.name}` : 'a wall').replace(/ (\d+\.\d) in\b/, (_, v) => ` ${fmt(Number(v))}`),
        locked: true,
      })
    }

  const rank: Record<Severity, number> = { blocks: 0, fix: 1, note: 2 }
  return dedupe(out).sort((a, b) => rank[a.severity] - rank[b.severity] || (a.where.room ?? '').localeCompare(b.where.room ?? ''))
}

/** The room at a point, or the nearest one within 1 ft (notes sit on wall centerlines, between rooms). */
function nearRoom(m: Model, level: string, p: Vec) {
  const at = roomOf(m, level, p)
  if (at) return at
  for (const k of [6, 12])
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Vec[]) {
      const r = roomOf(m, level, add(p, mul(d, k)))
      if (r) return r
    }
  return undefined
}

/** The floor at grade: the lowest level, unless its name says it is an upper floor (a sheet imported on its own). */
function groundLevel(m: Model) {
  const lowest = [...m.levels].sort((a, b) => a.elev - b.elev)[0]
  return lowest && !/\b(2|3|second|third|upper)\b/i.test(lowest.name) ? lowest.id : undefined
}

/** The counter, island or vanity an item is set into: a larger floor item whose footprint holds its center. */
export function hostOf(m: Model, it: Item): Item | undefined {
  if (!['sink', 'cooktop', 'range', 'dishwasher'].includes(it.kind)) return undefined
  return m.items.find((x) => x.id !== it.id && x.level === it.level && ['island', 'base_cabinet', 'vanity'].includes(x.kind) && x.w * x.d > it.w * it.d && pointInPolygon([it.x, it.y], footprint(x)))
}

function dedupe(list: Issue[]) {
  const seen = new Set<string>()
  return list.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
}

type Push = (i: Omit<Issue, 'id'>) => void

// ------------------------------------------------------------------ bathrooms

function checkToilet(it: Item, others: Seg[], where: Issue['where'], push: Push) {
  const { c, f, s } = frameOf(it)
  // Side clearance is measured from the centerline at the bowl, a little in front of the tank.
  const at = add(c, mul(f, it.d * 0.15))
  const left = ray(at, mul(s, -1), others).dist
  const right = ray(at, s, others).dist
  const tight = Math.min(left, right)
  const label = lc(nameOf(it))
  if (tight < S.bath.toiletCenterToSide.nkba) {
    const code = tight < S.bath.toiletCenterToSide.code
    // One move fixes it when there is room on the other side: slide to the code (or NKBA) distance.
    const want = left + right >= 2 * S.bath.toiletCenterToSide.nkba ? S.bath.toiletCenterToSide.nkba : S.bath.toiletCenterToSide.code
    const shift = left < right ? want - left : -(want - right)
    const roomy = left + right >= 2 * want
    push({
      severity: code ? 'blocks' : 'fix',
      rule: 'toilet-side',
      where,
      message: code
        ? `The ${label} is ${fmt(tight)} from its center to the ${left < right ? 'left' : 'right'}; code needs 1'-3" each side.`
        : `The ${label} is ${fmt(tight)} from its center to the side; 1'-6" each side is recommended.`,
      ...(roomy ? { fix: [{ op: 'move', id: it.id, dx: r8(s[0] * shift), dy: r8(s[1] * shift) }], fixLabel: `Slide it ${fmt(Math.abs(shift))}` } : {}),
    })
  }
  const front = clearAlong([add(c, mul(f, it.d / 2 + 0.01))], f, others).dist
  if (front < S.bath.toiletFront.code) push({ severity: 'blocks', rule: 'toilet-front', where, message: `Only ${fmt(front)} clear in front of the ${label}; code needs 1'-9".` })
  else if (front < S.bath.toiletFront.nkba) push({ severity: 'fix', rule: 'toilet-front', where, message: `${fmt(front)} clear in front of the ${label}; 2'-6" is recommended.` })
}

// ------------------------------------------------------------------ kitchens

function checkAisle(m: Model, it: Item, others: Seg[], where: Issue['where'], push: Push) {
  const { c, f, s } = frameOf(it)
  const dirs: Vec[] = it.kind === 'island' ? [f, mul(f, -1)] : [f]
  for (const d of dirs) {
    const edge = add(c, mul(d, it.d / 2 + 0.01))
    const pts = [-0.35, 0, 0.35].map((k) => add(edge, mul(s, it.w * k)))
    const hit = clearAlong(pts, d, others)
    if (!hit.seg || hit.seg.kind !== 'item') continue
    const other = m.items.find((x) => x.id === hit.seg!.id)
    if (!other || !KITCHEN_KINDS.has(other.kind)) continue
    const ids = [it.id, other.id].sort()
    if (hit.dist < S.kitchen.workAisle.one)
      push({
        severity: 'fix',
        rule: 'kitchen-aisle',
        where: { ...where, ids },
        message: `${fmt(hit.dist)} between the ${lc(nameOf(it))} and the ${lc(nameOf(other))}; a kitchen aisle needs 3'-6" for one cook (4'-0" for two)${hit.dist < S.kitchen.walkway.nkba ? ', and 3\'-0" anywhere you walk' : ''}.`,
      })
  }
}

function checkDishwasher(it: Item, others: Seg[], where: Issue['where'], push: Push) {
  const { c, f, s } = frameOf(it)
  // Standing room beside the open door: look sideways from a point 1 ft in front of it.
  const stand = add(c, mul(f, it.d / 2 + 12))
  const sideFree = [s, mul(s, -1)].map((d) => ray(add(stand, mul(d, it.w / 2)), d, others).dist)
  if (sideFree.every((v) => v < S.kitchen.dishwasherStanding.nkba))
    push({ severity: 'fix', rule: 'dishwasher-standing', where, message: `No 1'-9" of standing room beside the ${lc(nameOf(it))} on either side; a corner cabinet or appliance is in the way.` })
}

/** The wall an item backs onto (its back edge within 2 in of a wall face), if any. */
function backWall(m: Model, it: Item): Wall | undefined {
  const { c, f } = frameOf(it)
  const back = add(c, mul(f, -it.d / 2))
  return m.walls.find((w) => {
    if (w.level !== it.level) return false
    const L = wallLength(w)
    const u: Vec = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L]
    const along = (back[0] - w.a[0]) * u[0] + (back[1] - w.a[1]) * u[1]
    const across = Math.abs((back[0] - w.a[0]) * u[1] - (back[1] - w.a[1]) * u[0])
    return along > -2 && along < L + 2 && Math.abs(across - w.t / 2) <= 2 && Math.abs(u[0] * f[0] + u[1] * f[1]) < 0.2
  })
}

function checkRangeWindow(m: Model, it: Item, where: Issue['where'], push: Push) {
  const w = backWall(m, it)
  if (!w) return
  const L = wallLength(w)
  const u: Vec = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L]
  const at = (it.x - w.a[0]) * u[0] + (it.y - w.a[1]) * u[1]
  const win = m.openings.find((o) => o.wall === w.id && o.kind === 'window' && Math.abs(o.at - at) < (o.w + it.w) / 2 + S.kitchen.cooktopWindowEdge.nkba)
  if (win)
    push({ severity: 'fix', rule: 'range-window', where: { ...where, ids: [it.id, win.id] }, message: `The ${lc(nameOf(it))} sits under a window; a cooktop should stay at least 3" from the window edge (curtains, reaching across a flame).` })
}

function checkFridgeDoor(m: Model, it: Item, where: Issue['where'], push: Push) {
  const { c, f, s } = frameOf(it)
  // The door swings a quarter circle of the fridge's width in front of it.
  const hinge = add(add(c, mul(f, it.d / 2)), mul(s, -it.w / 2))
  const arc: Vec[] = [hinge]
  for (let i = 0; i <= 8; i++) {
    const a = (Math.PI / 2) * (i / 8)
    arc.push(add(hinge, mul(add(mul(s, Math.cos(a)), mul(f, Math.sin(a))), it.w)))
  }
  const island = m.items.find((x) => x.kind === 'island' && x.level === it.level && overlaps(shrink(arc), footprint(x)))
  if (island) push({ severity: 'fix', rule: 'fridge-door', where: { ...where, ids: [it.id, island.id] }, message: `The ${lc(nameOf(it))} door hits the ${lc(nameOf(island))} when it opens.` })
}

// ------------------------------------------------------------------ doors and halls

function checkDoors(m: Model, push: Push, roomName: (level: string, p: Vec) => string | undefined) {
  const remodel = new Set(m.project.remodelRooms ?? [])
  const ground = groundLevel(m)
  const doors = m.openings.filter((o) => o.kind === 'door')
  const wallOf = (o: Opening) => m.walls.find((w) => w.id === o.wall)
  // The egress door: the widest swinging door in an outside wall of the lowest floor.
  const egress = doors
    .filter((o) => {
      const w = wallOf(o)
      return w?.exterior && w.level === ground && ['swing', 'french'].includes(o.style)
    })
    .sort((a, b) => b.w - a.w)[0]
  for (const o of doors) {
    const w = wallOf(o)
    if (!w) continue
    const [ra, rb] = roomsAcross(m, o)
    const room = [ra, rb].find((r) => r && !HALL.test(r.name)) ?? ra ?? rb
    const where = { level: w.level, room: room?.id, ids: [o.id] }
    const into = room ? `the door to ${theRoom(room.name)}` : 'a door'
    if (o === egress && o.w < S.doors.egressClear.code)
      push({ severity: 'blocks', rule: 'egress-door', where, message: `The main way out is ${fmt(o.w)} clear; code needs 2'-8" clear and 6'-6" high.`, fix: [{ op: 'update_opening', id: o.id, w: 34 }], fixLabel: 'Make it 2\'-10" (2\'-8" clear)' })
    else if (o.w < S.doors.interiorMin.fix && !(room && CLOSET.test(room.name)))
      push({ severity: 'fix', rule: 'door-width', where, message: `${into[0].toUpperCase() + into.slice(1)} is ${fmt(o.w)} clear; 2'-4" is the least for a room you live in.` })
    else if (o.w < S.doors.recommended.nkba && room && (remodel.has(room.id) || remodel.has(room.name)))
      push({ severity: 'note', rule: 'door-width', where, message: `${into[0].toUpperCase() + into.slice(1)} is ${fmt(o.w)} clear; 2'-8" is recommended while you are remodeling.` })
  }
  // Swings: into each other, into fixtures, into a stair. The fix offered is one flip of the door
  // (hinge or swing side) that is checked to clear the clash; with none, the issue has no Fix button.
  const swings = doors.map((o) => ({ o, area: swingArea(m, o) })).filter((x): x is { o: Opening; area: Vec[] } => !!x.area)
  const hits = (area: Vec[], other: Vec[]) => overlaps(shrink(area, 1), shrink(other, 1))
  const flipFor = (o: Opening, clear: (area: Vec[]) => boolean): Pick<Issue, 'fix' | 'fixLabel'> => {
    const ext = !!wallOf(o)?.exterior
    const tries: [Opening['swing'], string][] = [
      [{ ...o.swing!, hinge: o.swing!.hinge === 'a' ? 'b' : 'a' }, 'Hinge it on the other side'],
      ...(ext ? [] : ([[{ ...o.swing!, side: o.swing!.side === 'left' ? 'right' : 'left' }, 'Swing it into the other room']] as [Opening['swing'], string][])),
    ]
    for (const [swing, label] of tries) {
      const area = swingArea(m, { ...o, swing })
      if (area && clear(area)) return { fix: [{ op: 'update_opening', id: o.id, swing }], fixLabel: label }
    }
    return {}
  }
  for (let i = 0; i < swings.length; i++) {
    const a = swings[i]
    const level = wallOf(a.o)!.level
    for (let j = i + 1; j < swings.length; j++) {
      const b = swings[j]
      if (wallOf(b.o)!.level !== level || !hits(a.area, b.area)) continue
      const fix = flipFor(a.o, (x) => !hits(x, b.area))
      const room = roomName(level, a.area[Math.floor(a.area.length / 2)])
      push({
        severity: 'fix',
        rule: 'door-clash',
        where: { level, room: roomOf(m, level, a.area[Math.floor(a.area.length / 2)])?.id, ids: [a.o.id, b.o.id].sort() },
        message: `Two doors swing into each other${room ? ` in ${theRoom(room)}` : ''}.`,
        ...(fix.fix ? fix : flipFor(b.o, (x) => !hits(x, a.area))),
      })
    }
    for (const it of m.items) {
      if (it.level !== level || !onFloor(it) || it.h < 20) continue
      const box = footprint(it)
      if (!hits(a.area, box)) continue
      push({
        severity: 'fix',
        rule: 'door-hits',
        where: { level, room: roomOf(m, level, [it.x, it.y])?.id, ids: [a.o.id, it.id] },
        message: `A door swings into the ${lc(nameOf(it))}.`,
        ...flipFor(a.o, (x) => !hits(x, box)),
      })
    }
    for (const st of m.stairs) {
      if (st.level !== level && st.toLevel !== level) continue
      if (!hits(a.area, st.polygon)) continue
      push({ severity: 'fix', rule: 'door-stair', where: { level, ids: [a.o.id, st.id] }, message: 'A door swings out over the stair; it needs a landing first, or should swing the other way.', ...flipFor(a.o, (x) => !hits(x, st.polygon)) })
    }
  }
}

function checkHalls(m: Model, push: Push) {
  for (const r of m.rooms) {
    if (!HALL.test(r.name) || r.polygon.length < 3) continue
    const b = polygonBounds(r.polygon)
    const narrow = Math.min(b.x1 - b.x0, b.y1 - b.y0)
    if (narrow < S.halls.minWidth.code) push({ severity: 'blocks', rule: 'hall-width', where: { level: r.level, room: r.id, ids: [r.id] }, message: `The ${r.name} is ${fmt(narrow)} wide; code needs 3'-0".` })
  }
}

// ------------------------------------------------------------------ egress, stairs, glazing

/** Net clear opening of a window by its style (frames take about 3 in each way). */
export function windowClear(o: Opening): { w: number; h: number; sf: number } {
  const glassH = Math.max(0, o.h - (o.sill ?? 36))
  const fw = Math.max(0, o.w - 3)
  const fh = Math.max(0, glassH - 3)
  const [w, h] =
    o.style === 'fixed' ? [0, 0] : o.style === 'slider' ? [fw / 2, fh] : o.style === 'casement' ? [fw, fh] : [fw, fh / 2] // double or single hung opens half its height
  return { w, h, sf: (w * h) / 144 }
}

function checkEgress(m: Model, push: Push) {
  // 5.0 sf is allowed for a window at grade.
  const atGrade = (level: string) => level === groundLevel(m)
  for (const r of m.rooms) {
    if (!BEDROOM.test(r.name) || /bath|closet|clst/i.test(r.name) || r.polygon.length < 3) continue
    const mine = m.openings.filter((o) => roomsAcross(m, o).some((x) => x?.id === r.id))
    const outsideDoor = mine.some((o) => o.kind === 'door' && m.walls.find((w) => w.id === o.wall)?.exterior)
    if (outsideDoor) continue
    const need = atGrade(r.level) ? S.egress.netClearSf.grade : S.egress.netClearSf.code
    const windows = mine.filter((o) => o.kind === 'window')
    const ok = windows.some((o) => {
      const c = windowClear(o)
      return c.sf >= need && c.h >= S.egress.minClearHeight.code && c.w >= S.egress.minClearWidth.code && (o.sill ?? 36) <= S.egress.maxSill.code
    })
    if (ok) continue
    const best = windows.map((o) => ({ o, c: windowClear(o) })).sort((a, b) => b.c.sf - a.c.sf)[0]
    // A window too small on assumed head and sill heights is not yet a code failure: measure first.
    const assumed = !!best && (badgeOf(best.o.prov.h) === 'assumed' || badgeOf(best.o.prov.sill) === 'assumed')
    push({
      severity: assumed ? 'fix' : 'blocks',
      rule: 'bedroom-egress',
      where: { level: r.level, room: r.id, ids: [r.id, ...(best ? [best.o.id] : [])] },
      message: best
        ? `No window in the ${r.name} opens enough to climb out: the largest clears about ${best.c.sf.toFixed(1)} sf (${fmt(best.c.w)} by ${fmt(best.c.h)}); code needs ${need} sf, 2'-0" high, 1'-8" wide, sill 3'-8" or lower${assumed ? '. Its head and sill heights are assumed, so measure them first' : ''}.`
        : `The plan shows no window or outside door in the ${r.name} to climb out of; code needs one.`,
    })
  }
}

function checkStairs(m: Model, push: Push) {
  for (const st of m.stairs) {
    if (st.polygon.length < 3) continue
    const b = polygonBounds(st.polygon)
    const alongX = Math.abs(st.up[0]) > Math.abs(st.up[1])
    const run = alongX ? b.x1 - b.x0 : b.y1 - b.y0
    const width = alongX ? b.y1 - b.y0 : b.x1 - b.x0
    const from = m.levels.find((l) => l.id === st.level)
    const to = m.levels.find((l) => l.id === st.toLevel)
    const where = { level: st.level, ids: [st.id] }
    if (width < S.stairs.minWidth.code) push({ severity: 'blocks', rule: 'stair-width', where, message: `The stair is ${fmt(width)} wide; code needs 3'-0".` })
    if (from && to && to.elev > from.elev) {
      const rise = to.elev - from.elev
      // With the step count unknown, use the fewest steps code allows: that gives the deepest
      // treads, so a stair flagged this way is short of room whatever the real count is.
      const risers = st.risers ?? Math.ceil(rise / S.stairs.maxRiser.code)
      const riser = rise / risers
      const tread = run / Math.max(1, risers - 1)
      if (st.risers && riser > S.stairs.maxRiser.code) push({ severity: 'blocks', rule: 'stair-riser', where, message: `Each step rises ${fmt(riser)}; code allows 7 3/4" at most.` })
      if (tread < S.stairs.minTread.code)
        push({ severity: 'blocks', rule: 'stair-tread', where, message: st.risers ? `Each tread is ${fmt(tread)} deep; code needs 10".` : `The stair's ${fmt(run)} run is too short for 10" treads over a ${fmt(rise)} rise.` })
      if (from.ceiling < S.stairs.headroom.code) push({ severity: 'blocks', rule: 'stair-headroom', where, message: `The ceiling at the stair is ${fmt(from.ceiling)}; code needs 6'-8" of headroom.` })
    }
    // A landing at least as deep as 3'-0" at the bottom and at the top, measured in the direction you walk.
    const along = (p: Vec) => p[0] * st.up[0] + p[1] * st.up[1]
    const side: Vec = [st.up[1], -st.up[0]]
    for (const [end, lvl, dir] of [
      ['bottom', st.level, mul(st.up, -1)],
      ['top', st.toLevel, st.up],
    ] as [string, string, Vec][]) {
      const k = end === 'bottom' ? Math.min(...st.polygon.map(along)) : Math.max(...st.polygon.map(along))
      const edge = st.polygon.filter((p) => Math.abs(along(p) - k) < 1)
      if (edge.length < 2 || !m.levels.some((l) => l.id === lvl)) continue
      const c = edge.reduce<Vec>((s, p) => [s[0] + p[0] / edge.length, s[1] + p[1] / edge.length], [0, 0])
      const pts = [-0.35, 0, 0.35].map((f) => add(add(c, mul(side, width * f)), mul(dir, 0.01)))
      const clear = clearAlong(pts, dir, obstacles(m, lvl)).dist
      if (clear < S.stairs.landing.code) push({ severity: 'blocks', rule: 'stair-landing', where: { level: lvl, ids: [st.id] }, message: `Only ${fmt(clear)} clear at the ${end} of the stair; code needs a 3'-0" landing.` })
    }
  }
}

function checkGlazing(m: Model, push: Push) {
  const wet = m.items.filter((it) => it.kind === 'tub' || it.kind === 'shower')
  for (const o of m.openings) {
    if (o.kind !== 'window') continue
    const f = openingFrame(m, o)
    if (!f) continue
    const level = f.w.level
    const sill = o.sill ?? 36
    const where = { level, room: roomsAcross(m, o).find(Boolean)?.id, ids: [o.id] }
    const ends: Vec[] = [add(f.c, mul(f.u, -o.w / 2)), add(f.c, mul(f.u, o.w / 2))]
    const nearWet = wet.find((it) => it.level === level && distToPoly(f.c, footprint(it)) <= S.glazing.nearWetFloor + o.w / 2)
    const inShower = wet.find((it) => it.kind === 'shower' && it.level === level && ends.some((p) => pointInPolygon(p, footprint({ ...it, w: it.w + f.w.t + 2, d: it.d + f.w.t + 2 }))))
    if (inShower) push({ severity: 'note', rule: 'shower-window', where: { ...where, ids: [o.id, inShower.id] }, message: 'A window inside the shower needs tempered privacy glass and a fully waterproofed sill and jambs.' })
    else if (nearWet && sill < S.glazing.nearWetFloor) push({ severity: 'note', rule: 'tempered-glass', where: { ...where, ids: [o.id, nearWet.id] }, message: `This window is within 5'-0" of the ${lc(nameOf(nearWet))}; its glass has to be tempered.` })
    else {
      const door = m.openings.find((d) => d.kind === 'door' && d.wall === o.wall && Math.abs(d.at - o.at) - (d.w + o.w) / 2 < S.glazing.nearDoor)
      if (door && sill < 60) push({ severity: 'note', rule: 'tempered-glass', where: { ...where, ids: [o.id, door.id] }, message: 'This window is within 2\'-0" of a door; glass below 5\'-0" there has to be tempered.' })
    }
  }
}

function checkPlumbingMoves(m: Model, asBuilt: Model | null, push: Push) {
  if (!asBuilt) return
  for (const it of m.items) {
    if (it.kind !== 'toilet') continue
    const was = asBuilt.items.find((x) => x.id === it.id)
    if (!was) continue
    const moved = Math.hypot(it.x - was.x, it.y - was.y)
    const wallThen = backWall(asBuilt, was)?.id
    const wallNow = backWall(m, it)?.id
    if (moved > 1 && wallThen && wallNow && wallThen !== wallNow)
      push({ severity: 'note', rule: 'toilet-drain', where: { level: it.level, room: roomOf(m, it.level, [it.x, it.y])?.id, ids: [it.id] }, message: `The ${lc(nameOf(it))} moved to another wall; that means a new drain and vent. A plumber should confirm.` })
    else if (moved > S.plumbing.toiletMoveNote)
      push({ severity: 'note', rule: 'toilet-drain', where: { level: it.level, room: roomOf(m, it.level, [it.x, it.y])?.id, ids: [it.id] }, message: `The ${lc(nameOf(it))} moved ${fmt(moved)} from where it is today; that usually means a new drain and vent. A plumber should confirm.` })
  }
}

function distToPoly(p: Vec, poly: Vec[]) {
  if (pointInPolygon(p, poly)) return 0
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const ex = b[0] - a[0]
    const ey = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey || 1)))
    best = Math.min(best, Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t))
  }
  return best
}

/** Issues for one room (or the whole house), for Velda's prompt and the `analyze` op. */
export function checksFor(m: Model, roomId: string | null, opts: CheckOptions = {}) {
  const all = runChecks(m, opts)
  return roomId ? all.filter((i) => i.where.room === roomId || i.where.ids.includes(roomId)) : all
}

export type { Room }
