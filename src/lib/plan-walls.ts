// Turns the rectangle extraction from a plan sheet (walls, doors and windows as axis-aligned
// boxes, in inches) into clean wall centerlines with openings, plus room outlines found by
// flood-filling from each room label. Pure functions, inches throughout.

export type Rect = [number, number, number, number] // x, y (top-left), w, h
export type Geo = {
  walls: Rect[]
  windows: Rect[]
  doors: Rect[]
  rooms: [string, number, number][]
}
export type Opening = { kind: 'door' | 'window'; s: number; e: number }
export type PlanWall = {
  horiz: boolean
  cross: number // y of a horizontal wall's centerline, x of a vertical one
  s: number // start along the wall (x for horizontal, y for vertical)
  e: number
  t: number // thickness
  openings: Opening[]
}
export type PlanRoom = { name: string; polygon: [number, number][]; label: [number, number]; area: number }

type Piece = { kind: 'wall' | 'door' | 'window'; horiz: boolean; cross: number; s: number; e: number; t: number }

const MIN_DOOR = 20
const MIN_WINDOW = 14
const CROSS_TOL = 2.25
const GAP_TOL = 2.0

function toPiece(r: Rect, kind: Piece['kind'], dx: number, dy: number): Piece {
  const [x0, y0, w, h] = r
  const x = x0 + dx
  const y = y0 + dy
  const horiz = w >= h
  return horiz
    ? { kind, horiz, cross: y + h / 2, s: x, e: x + w, t: h }
    : { kind, horiz, cross: x + w / 2, s: y, e: y + h, t: w }
}

/** Merge collinear pieces into walls; door and window pieces become openings in them. */
export function planWalls(geo: Geo, dx = 0, dy = 0): PlanWall[] {
  const pieces: Piece[] = [
    ...geo.walls.map((r) => toPiece(r, 'wall', dx, dy)),
    ...geo.doors.map((r) => toPiece(r, 'door', dx, dy)),
    ...geo.windows.map((r) => toPiece(r, 'window', dx, dy)),
  ]
  // Short door/window slivers are jamb leftovers: treat them as wall.
  for (const p of pieces) {
    const len = p.e - p.s
    if ((p.kind === 'door' && len < MIN_DOOR) || (p.kind === 'window' && len < MIN_WINDOW)) p.kind = 'wall'
  }
  const walls: PlanWall[] = []
  for (const horiz of [true, false]) {
    const group = pieces.filter((p) => p.horiz === horiz).sort((a, b) => a.cross - b.cross)
    // Cluster by centerline.
    const clusters: Piece[][] = []
    for (const p of group) {
      const c = clusters.find((cl) => Math.abs(mean(cl.map((q) => q.cross)) - p.cross) <= CROSS_TOL && overlapsOrNear(cl, p))
      if (c) c.push(p)
      else clusters.push([p])
    }
    for (const cl of clusters) {
      cl.sort((a, b) => a.s - b.s)
      let run: Piece[] = []
      let end = -Infinity
      const flush = () => {
        if (run.length) walls.push(buildWall(run, horiz))
        run = []
      }
      for (const p of cl) {
        if (run.length && p.s > end + GAP_TOL) flush()
        run.push(p)
        end = run.length === 1 ? p.e : Math.max(end, p.e)
      }
      flush()
    }
  }
  joinCorners(walls)
  return walls.filter((w) => w.e - w.s >= 3)
}

function overlapsOrNear(cluster: Piece[], p: Piece) {
  // Same centerline is not enough when two unrelated walls happen to line up far apart;
  // that is fine (they stay separate runs), so clustering only needs the centerline test.
  void cluster
  void p
  return true
}

function buildWall(run: Piece[], horiz: boolean): PlanWall {
  const wallPieces = run.filter((p) => p.kind === 'wall')
  const basis = wallPieces.length ? wallPieces : run
  const weights = basis.map((p) => Math.max(1, p.e - p.s))
  const total = weights.reduce((a, b) => a + b, 0)
  const cross = basis.reduce((a, p, i) => a + p.cross * weights[i], 0) / total
  const t = weightedMedian(
    basis.map((p) => p.t),
    weights,
  )
  const s = Math.min(...run.map((p) => p.s))
  const e = Math.max(...run.map((p) => p.e))
  const openings: Opening[] = []
  for (const p of run) {
    if (p.kind === 'wall') continue
    const prev = openings.find((o) => o.kind === p.kind && p.s <= o.e + 1 && p.e >= o.s - 1)
    if (prev) {
      prev.s = Math.min(prev.s, p.s)
      prev.e = Math.max(prev.e, p.e)
    } else openings.push({ kind: p.kind, s: p.s, e: p.e })
  }
  openings.sort((a, b) => a.s - b.s)
  return { horiz, cross, s, e, t: Math.max(2, Math.min(12, t)), openings }
}

/** Extend or trim wall ends to meet a perpendicular wall's centerline so corners close. */
function joinCorners(walls: PlanWall[]) {
  for (const w of walls) {
    for (const end of ['s', 'e'] as const) {
      const at = w[end]
      let best: { d: number; to: number } | null = null
      for (const o of walls) {
        if (o === w || o.horiz === w.horiz) continue
        // o's centerline (o.cross) runs across w's axis; it must span w's centerline.
        if (w.cross < o.s - 3 || w.cross > o.e + 3) continue
        const d = Math.abs(o.cross - at)
        const reach = o.t / 2 + w.t / 2 + 3
        if (d <= reach && (!best || d < best.d)) best = { d, to: o.cross }
      }
      if (best) {
        // Do not trim a wall past its own openings.
        if (end === 's') {
          const limit = w.openings.length ? w.openings[0].s : w.e - 1
          w.s = Math.min(best.to, limit)
        } else {
          const limit = w.openings.length ? w.openings[w.openings.length - 1].e : w.s + 1
          w.e = Math.max(best.to, limit)
        }
      }
    }
  }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
function weightedMedian(values: number[], weights: number[]) {
  const idx = values.map((v, i) => i).sort((a, b) => values[a] - values[b])
  const half = weights.reduce((a, b) => a + b, 0) / 2
  let acc = 0
  for (const i of idx) {
    acc += weights[i]
    if (acc >= half) return values[i]
  }
  return values[idx[idx.length - 1]]
}

// ------------------------------------------------------------------ rooms

const NOT_A_ROOM =
  /^(bay window|dimensions|tv on|tall$|cab$|desk$|buffet$|chaise|acoustical|that can|fireplace$|steps|shower$)/i

export function titleCase(s: string) {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\bWic\b|\bW\.I\.C\.?/gi, 'Walk-in Closet')
    .replace(/\bClst\b/gi, 'Closet')
    .replace(/\bI\.t\./i, 'IT')
    .replace(/\s+/g, ' ')
    .trim()
}

const CELL = 2 // inches per grid cell
const OUTSIDE_GAP = 30 // exterior gaps up to 2x this are treated as closed when finding the outside
const MIN_ROOM_SQFT = 12

/**
 * Split the floor into rooms: find the building interior (everything the outside cannot reach
 * once small gaps in the exterior are closed), then grow all room labels at once through the
 * interior so open plans divide between their labels and doorways do not leak.
 */
export function planRooms(geo: Geo, walls: PlanWall[], dx = 0, dy = 0): PlanRoom[] {
  if (!walls.length) return []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const w of walls) {
    const [x0, y0, x1, y1] = wallBox(w)
    minX = Math.min(minX, x0)
    minY = Math.min(minY, y0)
    maxX = Math.max(maxX, x1)
    maxY = Math.max(maxY, y1)
  }
  const pad = OUTSIDE_GAP + 10
  minX -= pad
  minY -= pad
  maxX += pad
  maxY += pad
  const cols = Math.ceil((maxX - minX) / CELL)
  const rows = Math.ceil((maxY - minY) / CELL)
  const N = cols * rows
  const wallGrid = new Uint8Array(N)
  for (const w of walls) {
    const [x0, y0, x1, y1] = wallBox(w, 0.5)
    const c0 = Math.max(0, Math.floor((x0 - minX) / CELL))
    const c1 = Math.min(cols - 1, Math.floor((x1 - minX) / CELL))
    const r0 = Math.max(0, Math.floor((y0 - minY) / CELL))
    const r1 = Math.min(rows - 1, Math.floor((y1 - minY) / CELL))
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) wallGrid[r * cols + c] = 1
  }
  // Distance (in cells) from the nearest wall, by multi-source BFS.
  const dist = new Int32Array(N).fill(1 << 29)
  {
    const q: number[] = []
    for (let i = 0; i < N; i++) if (wallGrid[i]) {
      dist[i] = 0
      q.push(i)
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h]
      for (const j of nbrs(i)) if (dist[j] > dist[i] + 1) {
        dist[j] = dist[i] + 1
        q.push(j)
      }
    }
  }
  // Outside: reachable from the border through cells farther than OUTSIDE_GAP from any wall,
  // then grown back toward the walls (never through them).
  const R = Math.ceil(OUTSIDE_GAP / CELL)
  const outside = new Uint8Array(N)
  {
    const q: number[] = []
    for (let i = 0; i < N; i++) {
      const r = Math.floor(i / cols)
      const c = i % cols
      if ((r === 0 || c === 0 || r === rows - 1 || c === cols - 1) && dist[i] > R) {
        outside[i] = 1
        q.push(i)
      }
    }
    for (let h = 0; h < q.length; h++) for (const j of nbrs(q[h])) if (!outside[j] && dist[j] > R) {
      outside[j] = 1
      q.push(j)
    }
    // Grow back R cells through free space.
    let front = q.slice()
    for (let step = 0; step < R + 1; step++) {
      const nxt: number[] = []
      for (const i of front) for (const j of nbrs(i)) if (!outside[j] && !wallGrid[j]) {
        outside[j] = 1
        nxt.push(j)
      }
      front = nxt
    }
  }
  // Grow every label at once through the interior.
  const owner = new Int32Array(N).fill(-1)
  const seeds: { name: string; label: [number, number]; cell: number }[] = []
  for (const [rawName, lx, ly] of geo.rooms) {
    if (NOT_A_ROOM.test(rawName.trim())) continue
    const x = lx + dx
    const y = ly + dy
    let cell = cellAt(x, y)
    if (cell < 0 || wallGrid[cell]) cell = nearestFree(x, y)
    if (cell < 0 || outside[cell] || owner[cell] >= 0) continue
    owner[cell] = seeds.length
    seeds.push({ name: titleCase(rawName), label: [x, y], cell })
  }
  {
    let front = seeds.map((s) => s.cell)
    while (front.length) {
      const nxt: number[] = []
      for (const i of front) for (const j of nbrs(i)) if (owner[j] < 0 && !wallGrid[j] && !outside[j]) {
        owner[j] = owner[i]
        nxt.push(j)
      }
      front = nxt
    }
  }
  const byOwner: number[][] = seeds.map(() => [])
  for (let i = 0; i < N; i++) if (owner[i] >= 0) byOwner[owner[i]].push(i)
  const rooms: PlanRoom[] = []
  const seen = new Map<string, number>()
  seeds.forEach((s, k) => {
    const cells = byOwner[k]
    const area = (cells.length * CELL * CELL) / 144
    if (area < MIN_ROOM_SQFT) return
    const polygon = outline(new Set(cells))
    if (polygon.length < 4) return
    const n = (seen.get(s.name) ?? 0) + 1
    seen.set(s.name, n)
    rooms.push({ name: n > 1 ? `${s.name} ${n}` : s.name, polygon, label: s.label, area })
  })
  return rooms

  function nbrs(i: number) {
    const out: number[] = []
    const c = i % cols
    if (c > 0) out.push(i - 1)
    if (c < cols - 1) out.push(i + 1)
    if (i >= cols) out.push(i - cols)
    if (i < N - cols) out.push(i + cols)
    return out
  }
  function cellAt(x: number, y: number) {
    const c = Math.floor((x - minX) / CELL)
    const r = Math.floor((y - minY) / CELL)
    return c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c
  }
  function nearestFree(x: number, y: number) {
    for (let rad = 1; rad <= 6; rad++) {
      for (let oy = -rad; oy <= rad; oy++)
        for (let ox = -rad; ox <= rad; ox++) {
          const i = cellAt(x + ox * CELL, y + oy * CELL)
          if (i >= 0 && !wallGrid[i]) return i
        }
    }
    return -1
  }
  /** Trace the outer boundary of a set of grid cells into a simplified rectilinear polygon. */
  function outline(cells: Set<number>): [number, number][] {
    const vcols = cols + 1
    const next = new Map<number, number[]>()
    const add = (a: number, b: number) => {
      const l = next.get(a)
      if (l) l.push(b)
      else next.set(a, [b])
    }
    for (const i of cells) {
      const r = Math.floor(i / cols)
      const c = i % cols
      const tl = r * vcols + c
      const tr = tl + 1
      const bl = tl + vcols
      const br = bl + 1
      if (!cells.has(i - cols)) add(tl, tr)
      if (c === cols - 1 || !cells.has(i + 1)) add(tr, br)
      if (!cells.has(i + cols)) add(br, bl)
      if (c === 0 || !cells.has(i - 1)) add(bl, tl)
    }
    let bestLoop: number[] = []
    let bestArea = 0
    const used = new Set<string>()
    for (const [a, list] of next) {
      for (const b0 of list) {
        if (used.has(a + ':' + b0)) continue
        const loop = [a]
        let nb = b0
        let prev = a
        let guard = 0
        used.add(a + ':' + b0)
        while (guard++ < 400000 && nb !== a) {
          loop.push(nb)
          const opts = (next.get(nb) || []).filter((x) => !used.has(nb + ':' + x))
          if (!opts.length) break
          // At a pinch vertex prefer the right turn so loops stay simple.
          let pick = opts[0]
          if (opts.length > 1) {
            const d0 = dir(prev, nb)
            pick = opts.find((x) => turn(d0, dir(nb, x)) === 1) ?? opts[0]
          }
          used.add(nb + ':' + pick)
          prev = nb
          nb = pick
        }
        const pts = loop.map((v) => [v % vcols, Math.floor(v / vcols)] as [number, number])
        const ar = Math.abs(shoelace(pts))
        if (ar > bestArea) {
          bestArea = ar
          bestLoop = loop
        }
      }
    }
    const pts = bestLoop.map((v) => [minX + (v % vcols) * CELL, minY + Math.floor(v / vcols) * CELL] as [number, number])
    return douglasPeucker(simplify(pts), 2.5)

    function dir(a: number, b: number): [number, number] {
      return [(b % vcols) - (a % vcols), Math.floor(b / vcols) - Math.floor(a / vcols)]
    }
    function turn(a: [number, number], b: [number, number]) {
      return Math.sign(a[0] * b[1] - a[1] * b[0])
    }
  }
}

function shoelace(p: [number, number][]) {
  let s = 0
  for (let i = 0; i < p.length; i++) {
    const a = p[i]
    const b = p[(i + 1) % p.length]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

/** Closed-polygon Douglas-Peucker: turns flood-fill staircases into straight diagonals. */
function douglasPeucker(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 5) return pts
  // Split the ring at the two points farthest apart, simplify each half, rejoin.
  let a = 0
  let b = 0
  let best = -1
  for (let i = 0; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2
    if (d > best) {
      best = d
      b = i
    }
  }
  const half1 = dp(pts.slice(a, b + 1))
  const half2 = dp([...pts.slice(b), pts[0]])
  return [...half1.slice(0, -1), ...half2.slice(0, -1)]
  function dp(line: [number, number][]): [number, number][] {
    if (line.length < 3) return line
    const [x1, y1] = line[0]
    const [x2, y2] = line[line.length - 1]
    const len = Math.hypot(x2 - x1, y2 - y1) || 1
    let idx = 0
    let dmax = 0
    for (let i = 1; i < line.length - 1; i++) {
      const d = Math.abs((y2 - y1) * line[i][0] - (x2 - x1) * line[i][1] + x2 * y1 - y2 * x1) / len
      if (d > dmax) {
        dmax = d
        idx = i
      }
    }
    if (dmax <= tol) return [line[0], line[line.length - 1]]
    return [...dp(line.slice(0, idx + 1)).slice(0, -1), ...dp(line.slice(idx))]
  }
}

/** Drop collinear points and tiny one-cell jogs. */
function simplify(pts: [number, number][]): [number, number][] {
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1)
  let changed = true
  let out = pts
  while (changed && out.length > 4) {
    changed = false
    const res: [number, number][] = []
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length]
      const b = out[i]
      const c = out[(i + 1) % out.length]
      const collinear = (a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])
      if (collinear) {
        changed = true
        continue
      }
      res.push(b)
    }
    out = res
  }
  return out
}

/** Axis-aligned footprint of a wall, optionally grown on every side. */
export function wallBox(w: PlanWall, grow = 0): [number, number, number, number] {
  const h = w.t / 2 + grow
  return w.horiz ? [w.s - grow, w.cross - h, w.e + grow, w.cross + h] : [w.cross - h, w.s - grow, w.cross + h, w.e + grow]
}
