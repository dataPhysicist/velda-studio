// Wall tracing on a hollow double-line plan raster (05 section 3.4 and 3.5): face pairs with a white
// core become wall pieces, collinear pieces are bridged across doors and windows, and each wall's
// cross sections are read to find windows (extra lines in the core), doors (a gap with a swing arc),
// sliding doors (a leaf line) and cased openings (a clean gap).
// Everything here works in raster pixels; trace.ts converts to inches at the end.
import { type Chain, type Mask, chains, transpose } from './lines'

export type Orient = 'h' | 'v'

/** A wall core between two face lines. cross: x for a vertical wall, y for a horizontal one. */
export type Piece = { o: Orient; c1: number; c2: number; s0: number; s1: number; open?: [boolean, boolean] }

export type RawOpening = {
  kind: 'door' | 'window' | 'opening'
  style: 'swing' | 'french' | 'sliding' | 'cased' | 'double_hung'
  s0: number // along the wall, px from the wall's start
  s1: number
  hinge?: 'a' | 'b'
  side?: 'left' | 'right'
  conf: number
}

export type RawWall = {
  o: Orient
  /** Face positions across the wall (px), c1 < c2. */
  c1: number
  c2: number
  s0: number
  s1: number
  pieces: Piece[]
  exterior: boolean
  openings: RawOpening[]
  codes?: string
}

export type Scales = { x: number; y: number } // px per real inch

/** View of a mask where rows run along a wall and columns run across it. */
type View = { m: Mask; o: Orient }
const along = (o: Orient, s: Scales) => (o === 'v' ? s.y : s.x)
const across = (o: Orient, s: Scales) => (o === 'v' ? s.x : s.y)

function isDark(v: View, row: number, col: number): boolean {
  const { width: W, height: H, data } = v.m
  if (row < 0 || row >= H || col < 0 || col >= W) return false
  return data[row * W + col] === 1
}
function faceAt(v: View, row: number, c: number): boolean {
  const ci = Math.round(c)
  return isDark(v, row, ci) || isDark(v, row, ci - 1) || isDark(v, row, ci + 1)
}
/** Dark pixels strictly inside the core (3 px clear of each face line). */
function coreDark(v: View, row: number, c1: number, c2: number): number {
  const a = Math.round(c1) + 3
  const b = Math.round(c2) - 3
  if (b < a) return 99
  let dark = 0
  for (let col = a; col <= b; col++) if (isDark(v, row, col)) dark++
  return dark
}

/** One or two thin dark runs inside the core and nothing else: a window's sash lines. */
function coreLines(v: View, row: number, c1: number, c2: number): boolean {
  const a = Math.round(c1) + 3
  const b = Math.round(c2) - 3
  if (b < a) return false
  let runs = 0
  let run = 0
  for (let col = a; col <= b + 1; col++) {
    if (col <= b && isDark(v, row, col)) run++
    else if (run) {
      if (run > 4) return false
      // sash lines sit in the middle of the wall, not hard against one face
      const at = (col - run / 2 - c1) / (c2 - c1)
      if (at < 0.2 || at > 0.8) return false
      runs++
      run = 0
    }
  }
  return runs >= 1 && runs <= 2
}

/**
 * Whether a wall core stays open past one end of a piece: at a corner or tee it flows into the
 * other wall's core (white for that wall's thickness); at a jamb or around a fixture a line closes it.
 */
function openEnd(v: View, mid: number, end: number, dir: 1 | -1, minPx: number): boolean {
  const c = Math.round(mid)
  for (let k = 1; k <= minPx; k++) {
    const r = Math.round(end + dir * k)
    if (isDark(v, r, c) || isDark(v, r, c - 1) || isDark(v, r, c + 1)) return false
  }
  return true
}

/**
 * Dashed lines (closet rods, upper cabinets, shelves above): three or more short chains on one line
 * with short gaps between them. They are never wall faces.
 */
export function dashed(lines: Chain[], al: number): Set<Chain> {
  const out = new Set<Chain>()
  const short = lines.filter((l) => l.t1 - l.t0 <= 12 * al).sort((p, q) => p.c - q.c || p.t0 - q.t0)
  const used = new Set<Chain>()
  for (const l of short) {
    if (used.has(l)) continue
    const run = [l]
    used.add(l)
    let last = l
    for (;;) {
      const next = short.find((q) => !used.has(q) && Math.abs(q.c - last.c) <= 1.5 && q.t0 > last.t1 && q.t0 - last.t1 <= 8 * al)
      if (!next) break
      run.push(next)
      used.add(next)
      last = next
    }
    if (run.length >= 3) for (const r of run) out.add(r)
  }
  return out
}

/** Wall pieces from pairs of parallel line chains with a white core between them. */
export function facePairs(v: View, lines: Chain[], s: Scales, o: Orient, opts: { tMin?: number; tMax?: number; minLen?: number } = {}): Piece[] {
  const ca = across(o, s)
  const al = along(o, s)
  const tMin = (opts.tMin ?? 2.5) * ca
  const tMax = (opts.tMax ?? 14) * ca
  const minLen = (opts.minLen ?? 4) * al
  const step = Math.max(1, Math.round(0.5 * al))
  const dash = dashed(lines, al)
  const sorted = lines.filter((l) => !dash.has(l)).sort((p, q) => p.c - q.c)
  const out: Piece[] = []
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i]
    for (let j = i + 1; j < sorted.length; j++) {
      const g = sorted[j]
      const d = g.c - f.c
      if (d < tMin) continue
      if (d > tMax) break
      const r0 = Math.max(f.t0, g.t0)
      const r1 = Math.min(f.t1, g.t1)
      if (r1 - r0 < minLen) continue
      let runStart = -1
      let last = -1
      const flush = () => {
        if (runStart >= 0 && last - runStart >= minLen) {
          const mid = (f.c + g.c) / 2
          const probe = Math.round(1.5 * al) + step
          out.push({ o, c1: f.c, c2: g.c, s0: runStart, s1: last, open: [openEnd(v, mid, runStart, -1, probe), openEnd(v, mid, last, 1, probe)] })
        }
        runStart = -1
      }
      // Sample states: 1 clean core, 2 window (one or two thin lines along the core), 0 neither.
      const rows: number[] = []
      const state: number[] = []
      for (let r = r0; r <= r1; r += step) {
        rows.push(r)
        if (!faceAt(v, r, f.c) || !faceAt(v, r, g.c)) state.push(0)
        else if (coreDark(v, r, f.c, g.c) <= 1) state.push(1)
        else state.push(coreLines(v, r, f.c, g.c) ? 2 : 0)
      }
      // Window samples count only in runs of 12 in or more (a sash), never as stray dashes.
      const minWin = Math.ceil((12 * al) / step)
      for (let k = 0; k < state.length; ) {
        if (state[k] !== 2) {
          k++
          continue
        }
        let e = k
        while (e < state.length && state[e] === 2) e++
        if (e - k < minWin) for (let q = k; q < e; q++) state[q] = 0
        k = e
      }
      if ((g.c - f.c) / ca > 10) for (let k = 0; k < state.length; k++) if (state[k] === 2) state[k] = 0 // no sash in very thick walls
      // A piece needs some clean core: a band that only ever holds lines is not a wall.
      let clean = 0
      const minClean = Math.ceil((2 * al) / step)
      for (let k = 0; k <= state.length; k++) {
        if (k < state.length && state[k]) {
          if (runStart < 0) {
            runStart = rows[k]
            clean = 0
          }
          if (state[k] === 1) clean++
          last = rows[k]
        } else {
          if (clean < minClean) runStart = -1
          flush()
        }
      }
    }
  }
  return out
}

export type RawStair = { o: Orient; c0: number; c1: number; s0: number; s1: number; treads: number; lens: number[] }

/**
 * Stairs: tread lines 9 to 12 in apart read as a stack of "walls" sharing faces. Four or more in a
 * row with matching ends are a stair; take them out of the wall pieces.
 */
export function findStairs(pieces: Piece[], s: Scales): { stairs: RawStair[]; rest: Piece[] } {
  const used = new Set<Piece>()
  const stairs: RawStair[] = []
  for (const o of ['h', 'v'] as Orient[]) {
    const ca = across(o, s)
    const al = along(o, s)
    const treadLike = pieces.filter((p) => p.o === o && p.c2 - p.c1 >= 8.5 * ca && p.c2 - p.c1 <= 12.5 * ca && p.s1 - p.s0 >= 24 * al)
    for (const start of treadLike) {
      if (used.has(start)) continue
      const run = [start]
      let cur = start
      for (;;) {
        const next = treadLike.find(
          (q) => !used.has(q) && !run.includes(q) && Math.abs(q.c1 - cur.c2) <= 1.5 && Math.abs(q.s0 - cur.s0) <= 6 * al && Math.abs(q.c2 - q.c1 - (cur.c2 - cur.c1)) <= 1.5 * ca,
        )
        if (!next) break
        run.push(next)
        cur = next
      }
      // extend downward too
      let first = start
      for (;;) {
        const prev = treadLike.find(
          (q) => !used.has(q) && !run.includes(q) && Math.abs(q.c2 - first.c1) <= 1.5 && Math.abs(q.s0 - first.s0) <= 6 * al && Math.abs(q.c2 - q.c1 - (first.c2 - first.c1)) <= 1.5 * ca,
        )
        if (!prev) break
        run.unshift(prev)
        first = prev
      }
      if (run.length < 3) continue // 3 gaps = 4 treads
      for (const r of run) used.add(r)
      stairs.push({ o, c0: run[0].c1, c1: run[run.length - 1].c2, s0: Math.min(...run.map((r) => r.s0)), s1: Math.max(...run.map((r) => r.s1)), treads: run.length + 1, lens: run.map((r) => r.s1 - r.s0) })
    }
  }
  // treads cut short by the break line: same depth, stacked on either side of a found stair
  for (const st of stairs) {
    const ca = across(st.o, s)
    const al = along(st.o, s)
    const depth = (st.c1 - st.c0) / (st.treads - 1)
    for (let grew = true; grew; ) {
      grew = false
      for (const q of pieces) {
        if (used.has(q) || q.o !== st.o || q.s1 - q.s0 < 6 * al || Math.abs(q.c2 - q.c1 - depth) > 1.5 * ca) continue
        if (q.s0 < st.s0 - 6 * al || q.s1 > st.s1 + 6 * al) continue
        if (Math.abs(q.c1 - st.c1) <= 1.5) {
          st.c1 = q.c2
        } else if (Math.abs(q.c2 - st.c0) <= 1.5) {
          st.c0 = q.c1
        } else continue
        used.add(q)
        st.treads++
        grew = true
      }
    }
  }
  // drop the other pieces that sit wholly inside a stair (tread fragments)
  const inStair = (p: Piece) =>
    stairs.some((st) => st.o === p.o && p.c1 >= st.c0 - 1.5 && p.c2 <= st.c1 + 1.5 && p.s0 >= st.s0 - 6 * along(p.o, s) && p.s1 <= st.s1 + 6 * along(p.o, s))
  return { stairs, rest: pieces.filter((p) => !used.has(p) && !inStair(p)) }
}

/** Drop pieces that sit inside a wider piece's band over the same stretch (window sashes). */
export function dropNested(pieces: Piece[]): Piece[] {
  return pieces.filter(
    (p) =>
      !pieces.some(
        (q) =>
          q !== p &&
          q.o === p.o &&
          q.c1 <= p.c1 + 0.5 &&
          q.c2 >= p.c2 - 0.5 &&
          q.c2 - q.c1 > p.c2 - p.c1 + 1 &&
          Math.min(q.s1, p.s1) - Math.max(q.s0, p.s0) > 0.5 * (p.s1 - p.s0),
      ),
  )
}

/**
 * Join collinear pieces (centerline within 2.25 in, faces within 1.5 in) across gaps up to 120 in
 * into one wall. `bridgeable` decides whether a gap may be crossed (it is not outside the house).
 */
export function bridge(pieces: Piece[], s: Scales, bridgeable: (o: Orient, cross: number, s0: number, s1: number) => boolean, only?: Orient): RawWall[] {
  const walls: RawWall[] = []
  for (const o of (only ? [only] : ['h', 'v']) as Orient[]) {
    const ca = across(o, s)
    const al = along(o, s)
    // Cluster by centerline and thickness; long pieces seed the clusters so stray bits cannot.
    const ps = pieces.filter((p) => p.o === o).sort((p, q) => q.s1 - q.s0 - (p.s1 - p.s0))
    const groups: Piece[][] = []
    const stats: { mid: number; t: number }[] = []
    for (const p of ps) {
      const mid = (p.c1 + p.c2) / 2
      const t = p.c2 - p.c1
      let best = -1
      let bestD = Infinity
      stats.forEach((st, i) => {
        const d = Math.abs(st.mid - mid)
        if (d <= 2.25 * ca && Math.abs(st.t - t) <= 1.5 * ca && d < bestD) {
          best = i
          bestD = d
        }
      })
      if (best >= 0) groups[best].push(p)
      else {
        groups.push([p])
        stats.push({ mid, t })
      }
    }
    for (const g of groups) {
      g.sort((p, q) => p.s0 - q.s0)
      let cur: Piece[] = [g[0]]
      let end = g[0].s1
      const emit = () => {
        const c1 = median(cur.map((p) => p.c1))
        const c2 = median(cur.map((p) => p.c2))
        walls.push({ o, c1, c2, s0: Math.min(...cur.map((p) => p.s0)), s1: Math.max(...cur.map((p) => p.s1)), pieces: cur, exterior: false, openings: [] })
      }
      for (let k = 1; k < g.length; k++) {
        const p = g[k]
        const gap = p.s0 - end
        const mid = (median(cur.map((q) => (q.c1 + q.c2) / 2)) + (p.c1 + p.c2) / 2) / 2
        if (gap <= 2 * al || (gap <= 120 * al && bridgeable(o, mid, end, p.s0))) {
          cur.push(p)
          end = Math.max(end, p.s1)
        } else {
          emit()
          cur = [p]
          end = p.s1
        }
      }
      emit()
    }
  }
  return walls
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b)
  const n = s.length
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

/**
 * Two bands that share a face line are a wall and something drawn against it (a door leaf, a furring
 * line, a fixture edge). Keep the longer one.
 */
export function dropSharedFace(walls: RawWall[], s: Scales): RawWall[] {
  const drop = new Set<RawWall>()
  for (const p of walls)
    for (const q of walls) {
      if (p === q || p.o !== q.o || drop.has(p) || drop.has(q)) continue
      const tol = 1.5
      const share = Math.abs(p.c2 - q.c1) <= tol || Math.abs(p.c1 - q.c2) <= tol
      if (!share) continue
      const ov = Math.min(p.s1, q.s1) - Math.max(p.s0, q.s0)
      const shorter = p.s1 - p.s0 <= q.s1 - q.s0 ? p : q
      if (ov > 0.5 * (shorter.s1 - shorter.s0)) drop.add(shorter)
    }
  void s
  return walls.filter((w) => !drop.has(w))
}

// ------------------------------------------------------------------ outside of the building

export type Outside = { block: number; w: number; h: number; out: Uint8Array }

/** Blocks connected to the sheet edge without crossing a line or a wall band. */
export function outsideMap(m: Mask, walls: RawWall[], block = 8): Outside {
  const w = Math.ceil(m.width / block)
  const h = Math.ceil(m.height / block)
  const barrier = new Uint8Array(w * h)
  for (let y = 0; y < m.height; y++) {
    const row = y * m.width
    const by = (y / block) | 0
    for (let x = 0; x < m.width; x++) if (m.data[row + x]) barrier[by * w + ((x / block) | 0)] = 1
  }
  for (const wl of walls) {
    const [x0, y0, x1, y1] = wl.o === 'v' ? [wl.c1, wl.s0, wl.c2, wl.s1] : [wl.s0, wl.c1, wl.s1, wl.c2]
    for (let by = Math.floor(y0 / block); by <= Math.floor(y1 / block); by++)
      for (let bx = Math.floor(x0 / block); bx <= Math.floor(x1 / block); bx++) if (bx >= 0 && by >= 0 && bx < w && by < h) barrier[by * w + bx] = 1
  }
  const out = new Uint8Array(w * h)
  const stack: number[] = []
  const push = (i: number) => {
    if (!barrier[i] && !out[i]) {
      out[i] = 1
      stack.push(i)
    }
  }
  for (let x = 0; x < w; x++) {
    push(x)
    push((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    push(y * w)
    push(y * w + w - 1)
  }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w
    const y = (i / w) | 0
    if (x > 0) push(i - 1)
    if (x < w - 1) push(i + 1)
    if (y > 0) push(i - w)
    if (y < h - 1) push(i + w)
  }
  return { block, w, h, out }
}

export function isOutside(o: Outside, x: number, y: number): boolean {
  const bx = Math.floor(x / o.block)
  const by = Math.floor(y / o.block)
  if (bx < 0 || by < 0 || bx >= o.w || by >= o.h) return true
  return o.out[by * o.w + bx] === 1
}

// ------------------------------------------------------------------ cross sections and openings

/**
 * Code each half inch of a wall: S solid (two faces, white core), W window (faces plus lines in the
 * core), G gap (nothing across), J jamb (a line straight across), P partial.
 */
export function sectionCodes(v: View, w: RawWall, s: Scales): { codes: string; step: number } {
  const al = along(w.o, s)
  const ca = across(w.o, s)
  const step = 0.5 * al
  const margin = 1.2 * ca
  const from = Math.round(w.c1 - margin)
  const to = Math.round(w.c2 + margin)
  let codes = ''
  for (let r = w.s0; r <= w.s1 + 0.01; r += step) {
    const row = Math.round(r)
    const prof: boolean[] = []
    for (let c = from; c <= to; c++) prof.push(isDark(v, row, c))
    const n = prof.length
    let runs = 0
    for (let k = 0; k < n; k++) if (prof[k] && (k === 0 || !prof[k - 1])) runs++
    const f1 = prof.slice(0, Math.round(n * 0.3)).some(Boolean)
    const f2 = prof.slice(Math.round(n * 0.7)).some(Boolean)
    const core = prof.slice(Math.round(n * 0.3), Math.round(n * 0.7))
    const mid = prof.slice(Math.round(n * 0.15), Math.round(n * 0.85))
    const full = mid.filter(Boolean).length / Math.max(1, mid.length) > 0.8
    let c: string
    if (full) c = 'J'
    else if (f1 && f2 && core.some(Boolean) && runs >= 3) c = 'W'
    else if (f1 && f2) c = 'S'
    else if (!prof.some(Boolean)) c = 'G'
    else c = 'P'
    codes += c
  }
  return { codes, step }
}

/** Fraction of a quarter circle (radius r around the hinge, swinging from `u` toward `n`) that is drawn. */
function arcScore(m: Mask, hinge: [number, number], u: [number, number], n: [number, number], rx: number, ry: number): number {
  let hit = 0
  let tot = 0
  for (let deg = 8; deg <= 82; deg += 3) {
    const t = (deg * Math.PI) / 180
    const px = hinge[0] + (u[0] * Math.cos(t) + n[0] * Math.sin(t)) * rx
    const py = hinge[1] + (u[1] * Math.cos(t) + n[1] * Math.sin(t)) * ry
    tot++
    let found = false
    for (let dy = -3; dy <= 3 && !found; dy++)
      for (let dx = -3; dx <= 3 && !found; dx++) {
        const X = Math.round(px) + dx
        const Y = Math.round(py) + dy
        if (X >= 0 && Y >= 0 && X < m.width && Y < m.height && m.data[Y * m.width + X]) found = true
      }
    if (found) hit++
  }
  return hit / tot
}

/** Openings in one wall from its codes; doors are checked for swing arcs on the full mask. */
export function readOpenings(m: Mask, w: RawWall, codes: string, step: number, s: Scales): RawOpening[] {
  const al = along(w.o, s)
  const out: RawOpening[] = []
  const toPx = (k: number) => w.s0 + k * step
  // windows: runs of W 14 in or longer, only on exterior walls
  if (w.exterior) {
    const re = /J?W[WJ]*W(?:J)?/g
    let mm: RegExpExecArray | null
    while ((mm = re.exec(codes))) {
      const s0 = toPx(mm.index)
      const s1 = toPx(mm.index + mm[0].length - 1)
      if ((s1 - s0) / al >= 14) out.push({ kind: 'window', style: 'double_hung', s0, s1, conf: 0.9 })
    }
  }
  // gaps: G runs, widened over partial samples to the jamb lines (J) on either side
  const re = /[PJ]{0,8}G+(?:[PJ]{0,4}G+)*[PJ]{0,8}/g
  let mm: RegExpExecArray | null
  while ((mm = re.exec(codes))) {
    const str = mm[0]
    const lead = /^[PJ]*/.exec(str)![0]
    const trail = /[PJ]*$/.exec(str)![0]
    const lastJ = lead.lastIndexOf('J')
    const firstJ = trail.indexOf('J')
    const k0 = mm.index + (lastJ >= 0 ? lastJ + 1 : 0)
    const k1 = mm.index + str.length - trail.length + (firstJ >= 0 ? firstJ : trail.length)
    if (k0 <= 1 || k1 >= codes.length - 1) continue // the wall's own end
    const s0 = toPx(k0) - step / 2
    const s1 = toPx(k1) - step / 2
    if ((s1 - s0) / al < 20) continue
    out.push(classifyGap(m, w, s0, s1, s))
  }
  return out.sort((a, b) => a.s0 - b.s0)
}

/**
 * A door at the very end of a wall: the wall stops, a swing arc fills the gap, and the next wall
 * across starts 16 to 48 in further on. Extend the wall to that wall's centerline so the door
 * becomes an opening in it (otherwise the two rooms either side would read as one).
 */
export function extendToDoors(m: Mask, mt: Mask, walls: RawWall[], s: Scales): number {
  let n = 0
  for (const w of walls) {
    const al = along(w.o, s)
    const mid = (w.c1 + w.c2) / 2
    for (const dir of [1, -1] as const) {
      const end = dir === 1 ? w.s1 : w.s0
      let best: { h: RawWall; gap: number } | null = null
      for (const h of walls) {
        if (h.o === w.o || h === w) continue
        // the wall across may itself end at this corner, so allow its own thickness of overhang
        const reach = w.c2 - w.c1 + 2 * across(w.o, s)
        if (mid < h.s0 - reach || mid > h.s1 + reach) continue
        const gap = dir === 1 ? h.c1 - end : end - h.c2
        if (gap < 16 * al || gap > 48 * al) continue
        if (!best || gap < best.gap) best = { h, gap }
      }
      if (!best) continue
      // nothing else in the way: no wall of this orientation continues in the gap
      const g0 = dir === 1 ? end : end - best.gap
      const g1 = dir === 1 ? end + best.gap : end
      if (walls.some((o) => o !== w && o.o === w.o && Math.abs((o.c1 + o.c2) / 2 - mid) < 3 * across(w.o, s) && o.s1 > g0 + 2 && o.s0 < g1 - 2)) continue
      // read the stretch like a wall: the clear opening is the run with nothing across it
      const view = { m: w.o === 'v' ? m : mt, o: w.o }
      const tmp: RawWall = { ...w, s0: g0, s1: g1, pieces: [], openings: [] }
      const { codes, step } = sectionCodes(view, tmp, s)
      const runs = [...codes.matchAll(/G+(?:[PJ]{0,4}G+)*/g)].map((x) => [x.index!, x.index! + x[0].length] as const)
      const run = runs.sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0]
      if (!run || ((run[1] - run[0]) * step) / al < 20) continue
      const door = classifyGap(m, w, g0 + run[0] * step - step / 2, g0 + run[1] * step - step / 2, s)
      if (door.kind !== 'door' || (door.style !== 'swing' && door.style !== 'french') || door.conf < 0.6) continue
      const hostMid = (best.h.c1 + best.h.c2) / 2
      if (dir === 1) w.s1 = hostMid
      else w.s0 = hostMid
      n++
    }
  }
  return n
}

function classifyGap(m: Mask, w: RawWall, s0: number, s1: number, s: Scales): RawOpening {
  // Plan-frame helpers: along-wall unit u and across unit n (n points toward c2, the 'right' face
  // for a vertical wall drawn top to bottom... resolved below into left/right of a->b).
  const vert = w.o === 'v'
  const u: [number, number] = vert ? [0, 1] : [1, 0]
  const n: [number, number] = vert ? [1, 0] : [0, 1]
  const width = s1 - s0
  const pt = (along: number, cross: number): [number, number] => (vert ? [cross, along] : [along, cross])
  const rAlong = width
  const scaleU = 1
  let best = { score: 0, hinge: 'a' as 'a' | 'b', toward: 1 as 1 | -1, french: false }
  for (const toward of [1, -1] as const) {
    const face = toward === 1 ? w.c2 : w.c1
    for (const hinge of ['a', 'b'] as const) {
      const at = hinge === 'a' ? s0 : s1
      const dirU: [number, number] = hinge === 'a' ? u : [-u[0], -u[1]]
      const dirN: [number, number] = [n[0] * toward, n[1] * toward]
      let sc = 0
      for (const f of [0.96, 1, 1.04]) sc = Math.max(sc, arcScore(m, pt(at, face), dirU, dirN, rAlong * scaleU * f, rAlong * scaleU * f))
      if (sc > best.score) best = { score: sc, hinge, toward, french: false }
    }
    // a pair of doors: two half-width arcs from both jambs on the same side
    const dirN: [number, number] = [n[0] * toward, n[1] * toward]
    const half = width / 2
    let sa = 0
    let sb = 0
    for (const f of [0.96, 1, 1.04]) {
      sa = Math.max(sa, arcScore(m, pt(s0, face), u, dirN, half * f, half * f))
      sb = Math.max(sb, arcScore(m, pt(s1, face), [-u[0], -u[1]], dirN, half * f, half * f))
    }
    const sf = Math.min(sa, sb)
    if (sf >= 0.6 && sf > best.score - 0.05) best = { score: sf, hinge: 'a', toward, french: true }
  }
  // Left of a->b in the plan (y down): for a horizontal wall a->b runs +x, left is -y (toward c1);
  // for a vertical wall a->b runs +y, left is +x (toward c2).
  const sideOf = (toward: 1 | -1): 'left' | 'right' => (vert ? (toward === 1 ? 'left' : 'right') : toward === 1 ? 'right' : 'left')
  if (best.score >= 0.6) {
    if (best.french) return { kind: 'door', style: 'french', s0, s1, side: sideOf(best.toward), conf: Math.min(1, best.score) }
    return { kind: 'door', style: 'swing', s0, s1, hinge: best.hinge, side: sideOf(best.toward), conf: Math.min(1, best.score) }
  }
  // a leaf line along the wall inside the gap: sliding or pocket door
  let leaf = 0
  let samples = 0
  for (let a = s0 + width * 0.15; a <= s1 - width * 0.15; a += Math.max(1, width / 24)) {
    samples++
    let hit = false
    for (let c = Math.round(w.c1 - 2 * across(w.o, s)); c <= Math.round(w.c2 + 2 * across(w.o, s)) && !hit; c++) {
      const [x, y] = pt(Math.round(a), c)
      if (x >= 0 && y >= 0 && x < m.width && y < m.height && m.data[y * m.width + x]) hit = true
    }
    if (hit) leaf++
  }
  if (samples && leaf / samples > 0.7) return { kind: 'door', style: 'sliding', s0, s1, conf: 0.7 }
  return { kind: 'opening', style: 'cased', s0, s1, conf: 0.6 }
}

export { chains, transpose }
export type { Chain, Mask, View }
