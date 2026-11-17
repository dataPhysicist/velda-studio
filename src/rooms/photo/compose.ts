// Keeping a photo edit honest. An image model redraws the whole picture even when asked to change one
// thing: tones shift, hardware changes color, lights lose their glow. This module finds what really
// changed between the photo and the model's version, and puts the model's pixels back only there.
// Everything else stays the photo's own pixels, exactly. Pure functions on RGBA arrays (no canvas), so
// the same code runs in the page and in tests.

export type Img = { w: number; h: number; data: Uint8ClampedArray | Uint8Array }

/** A picture averaged down to a coarse grid, one RGB triple per cell. */
export type Grid = { w: number; h: number; r: Float32Array; g: Float32Array; b: Float32Array }

/** Per-channel gain and offset that bring the model's tones back to the photo's. */
export type Tone = { gain: [number, number, number]; offset: [number, number, number] }
export const NO_TONE: Tone = { gain: [1, 1, 1], offset: [0, 0, 0] }

export type Region = {
  id: number
  /** Share of the picture, 0..1. */
  area: number
  /** Box in 0..1 of the picture: x0, y0, x1, y1. */
  box: [number, number, number, number]
  /** Middle of the region, 0..1. */
  at: [number, number]
  /** Average strength of the change, 0..255. */
  strength: number
  /** area x strength: how much of a change this is. */
  score: number
  /** True when the difference mostly goes away if the area is nudged a few pixels: the model moved it, it did not repaint it. */
  moved?: boolean
}

export type Analysis = {
  gw: number
  gh: number
  /** How far the model's picture is shifted against the photo, in photo pixels. */
  shift: [number, number]
  tone: Tone
  /** Change strength per grid cell after lining up and tone matching. */
  diff: Float32Array
  /** Region id per grid cell, 0 where nothing changed. */
  labels: Int32Array
  regions: Region[]
  /** Share of the picture that changed at all. */
  changed: number
  /** Regions kept by default: the main change and anything of similar weight. */
  keep: number[]
}

export const GRID_W = 384

export function toGrid(img: Img, gw = GRID_W): Grid {
  const gh = Math.max(1, Math.round((gw * img.h) / img.w))
  const n = gw * gh
  const r = new Float32Array(n)
  const g = new Float32Array(n)
  const b = new Float32Array(n)
  const c = new Uint32Array(n)
  const d = img.data
  const xs = new Int32Array(img.w)
  for (let x = 0; x < img.w; x++) xs[x] = Math.min(gw - 1, Math.floor((x * gw) / img.w))
  for (let y = 0; y < img.h; y++) {
    const row = Math.min(gh - 1, Math.floor((y * gh) / img.h)) * gw
    let i = y * img.w * 4
    for (let x = 0; x < img.w; x++, i += 4) {
      const k = row + xs[x]
      r[k] += d[i]
      g[k] += d[i + 1]
      b[k] += d[i + 2]
      c[k]++
    }
  }
  for (let k = 0; k < n; k++) {
    const m = c[k] || 1
    r[k] /= m
    g[k] /= m
    b[k] /= m
  }
  return { w: gw, h: gh, r, g, b }
}

function blur3(src: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      tmp[i] = (src[y * w + Math.max(0, x - 1)] + src[i] + src[y * w + Math.min(w - 1, x + 1)]) / 3
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      out[i] = (tmp[Math.max(0, y - 1) * w + x] + tmp[i] + tmp[Math.min(h - 1, y + 1) * w + x]) / 3
    }
  return out
}

const luma = (g: Grid) => {
  const y = new Float32Array(g.w * g.h)
  for (let i = 0; i < y.length; i++) y[i] = 0.299 * g.r[i] + 0.587 * g.g[i] + 0.114 * g.b[i]
  return y
}

/** The whole-cell shift of `b` that lines it up best with `a` (the model's picture can sit a few pixels off). */
export function align(a: Grid, b: Grid, max = 5): [number, number] {
  const ya = luma(a)
  const yb = luma(b)
  const { w, h } = a
  let best: [number, number] = [0, 0]
  let bestCost = Infinity
  const m = max + 1
  for (let dy = -max; dy <= max; dy++)
    for (let dx = -max; dx <= max; dx++) {
      // The median-like cost (clipped differences) keeps a large repainted area from steering the shift.
      let cost = 0
      let n = 0
      for (let y = m; y < h - m; y += 2)
        for (let x = m; x < w - m; x += 2) {
          const v = Math.abs(ya[y * w + x] - yb[(y + dy) * w + x + dx])
          cost += v > 24 ? 24 : v
          n++
        }
      cost /= n || 1
      // Prefer no shift unless a shift is clearly better.
      cost += 0.02 * (Math.abs(dx) + Math.abs(dy))
      if (cost < bestCost) {
        bestCost = cost
        best = [dx, dy]
      }
    }
  return best
}

/** `b` moved by a whole-cell shift (edges repeat). */
function shifted(b: Grid, dx: number, dy: number): Grid {
  if (!dx && !dy) return b
  const { w, h } = b
  const out: Grid = { w, h, r: new Float32Array(w * h), g: new Float32Array(w * h), b: new Float32Array(w * h) }
  for (let y = 0; y < h; y++) {
    const sy = Math.min(h - 1, Math.max(0, y + dy))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(w - 1, Math.max(0, x + dx))
      const i = y * w + x
      const j = sy * w + sx
      out.r[i] = b.r[j]
      out.g[i] = b.g[j]
      out.b[i] = b.b[j]
    }
  }
  return out
}

/** Fit photo = gain x model + offset per channel on the cells that agree best (so a repainted area does not skew it). */
export function fitTone(a: Grid, b: Grid, only?: Uint8Array): Tone {
  const n = a.w * a.h
  const chan = [
    [a.r, b.r],
    [a.g, b.g],
    [a.b, b.b],
  ] as const
  let use = new Uint8Array(n).fill(1)
  if (only) use = only.slice()
  const tone: Tone = { gain: [1, 1, 1], offset: [0, 0, 0] }
  for (let pass = 0; pass < 3; pass++) {
    for (let c = 0; c < 3; c++) {
      const [pa, pb] = chan[c]
      let sx = 0
      let sy = 0
      let sxx = 0
      let sxy = 0
      let m = 0
      for (let i = 0; i < n; i++) {
        if (!use[i]) continue
        const x = pb[i]
        const y = pa[i]
        sx += x
        sy += y
        sxx += x * x
        sxy += x * y
        m++
      }
      if (m < 50) continue
      const den = m * sxx - sx * sx
      let gain = den > 1e-6 ? (m * sxy - sx * sy) / den : 1
      gain = Math.min(1.5, Math.max(0.67, gain))
      const offset = Math.min(48, Math.max(-48, (sy - gain * sx) / m))
      tone.gain[c] = gain
      tone.offset[c] = offset
    }
    // Keep the 60 percent of cells that agree best after the fit, and fit again on those.
    const res = new Float32Array(n)
    const list: number[] = []
    for (let i = 0; i < n; i++) {
      if (only && !only[i]) {
        res[i] = Infinity
        continue
      }
      let e = 0
      for (let c = 0; c < 3; c++) e += Math.abs(chan[c][0][i] - (tone.gain[c] * chan[c][1][i] + tone.offset[c]))
      res[i] = e
      list.push(e)
    }
    list.sort((p, q) => p - q)
    const cut = list[Math.floor(list.length * 0.6)] ?? Infinity
    for (let i = 0; i < n; i++) use[i] = res[i] <= cut ? 1 : 0
  }
  return tone
}

/** How strongly each cell changed (0..255-ish), after shift and tone match, ignoring fine texture. */
export function diffMap(a: Grid, b: Grid, tone: Tone): Float32Array {
  const n = a.w * a.h
  const dY = new Float32Array(n)
  const dCb = new Float32Array(n)
  const dCr = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const r = a.r[i] - (tone.gain[0] * b.r[i] + tone.offset[0])
    const g = a.g[i] - (tone.gain[1] * b.g[i] + tone.offset[1])
    const bl = a.b[i] - (tone.gain[2] * b.b[i] + tone.offset[2])
    dY[i] = 0.299 * r + 0.587 * g + 0.114 * bl
    dCb[i] = -0.169 * r - 0.331 * g + 0.5 * bl
    dCr[i] = 0.5 * r - 0.419 * g - 0.081 * bl
  }
  const y = blur3(blur3(dY, a.w, a.h), a.w, a.h)
  const cb = blur3(blur3(dCb, a.w, a.h), a.w, a.h)
  const cr = blur3(blur3(dCr, a.w, a.h), a.w, a.h)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.hypot(y[i], 1.6 * cb[i], 1.6 * cr[i])
  return out
}

export type RegionOpts = { hi?: number; lo?: number; minArea?: number }

/** Connected areas of real change: every cell over `lo` that touches a cell over `hi`. */
export function findRegions(diff: Float32Array, w: number, h: number, o: RegionOpts = {}): { labels: Int32Array; regions: Region[] } {
  const hi = o.hi ?? 34
  const lo = o.lo ?? 15
  const minArea = o.minArea ?? 0.0012
  const n = w * h
  // Close one-cell gaps so a cabinet with a pale edge is one region, not two.
  const on = new Uint8Array(n)
  for (let i = 0; i < n; i++) on[i] = diff[i] > lo ? 1 : 0
  const closed = erode(dilate(on, w, h, 1), w, h, 1)
  const labels = new Int32Array(n)
  const regions: Region[] = []
  const stack = new Int32Array(n)
  let next = 1
  for (let s = 0; s < n; s++) {
    if (!closed[s] || labels[s]) continue
    let top = 0
    stack[top++] = s
    labels[s] = next
    let count = 0
    let sum = 0
    let peak = 0
    let x0 = w
    let y0 = h
    let x1 = 0
    let y1 = 0
    let sxm = 0
    let sym = 0
    const cells: number[] = []
    while (top) {
      const i = stack[--top]
      cells.push(i)
      const x = i % w
      const y = (i - x) / w
      count++
      sum += diff[i]
      if (diff[i] > peak) peak = diff[i]
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      sxm += x
      sym += y
      if (x > 0 && closed[i - 1] && !labels[i - 1]) (labels[i - 1] = next), (stack[top++] = i - 1)
      if (x < w - 1 && closed[i + 1] && !labels[i + 1]) (labels[i + 1] = next), (stack[top++] = i + 1)
      if (y > 0 && closed[i - w] && !labels[i - w]) (labels[i - w] = next), (stack[top++] = i - w)
      if (y < h - 1 && closed[i + w] && !labels[i + w]) (labels[i + w] = next), (stack[top++] = i + w)
    }
    const area = count / n
    // Thin outlines come from edges that sit a pixel or two off, not from a repainted surface.
    let solid = 0
    for (const i of cells) {
      const x = i % w
      const y = (i - x) / w
      if (x > 1 && x < w - 2 && y > 1 && y < h - 2 && labels[i - 2] === next && labels[i + 2] === next && labels[i - 2 * w] === next && labels[i + 2 * w] === next) solid++
    }
    if (peak < hi || area < minArea || solid < count * 0.12) {
      for (const i of cells) labels[i] = -1
      continue
    }
    const strength = sum / count
    regions.push({ id: next, area, box: [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h], at: [(sxm / count + 0.5) / w, (sym / count + 0.5) / h], strength, score: area * strength })
    next++
  }
  for (let i = 0; i < n; i++) if (labels[i] < 0) labels[i] = 0
  regions.sort((p, q) => q.score - p.score)
  return { labels, regions }
}

function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  let cur = src
  for (let k = 0; k < r; k++) {
    const out = new Uint8Array(cur.length)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        out[i] = cur[i] || (x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1]) || (y > 0 && cur[i - w]) || (y < h - 1 && cur[i + w]) ? 1 : 0
      }
    cur = out
  }
  return cur
}

function erode(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  let cur = src
  for (let k = 0; k < r; k++) {
    const out = new Uint8Array(cur.length)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        out[i] = cur[i] && (x === 0 || cur[i - 1]) && (x === w - 1 || cur[i + 1]) && (y === 0 || cur[i - w]) && (y === h - 1 || cur[i + w]) ? 1 : 0
      }
    cur = out
  }
  return cur
}

/**
 * Compare the photo with the model's version of it. `edit` must already be the photo's size.
 * Regions kept by default are the biggest change and any other at least 15 percent as weighty; small
 * far-off changes (a sconce that lost its glow) are side effects and start put back.
 */
export function analyze(photo: Img, edit: Img, gw = GRID_W): Analysis {
  const a = toGrid(photo, gw)
  const b0 = toGrid(edit, gw)
  const [dx, dy] = align(a, b0)
  const b = shifted(b0, dx, dy)
  const tone = fitTone(a, b)
  const diff = diffMap(a, b, tone)
  const { labels, regions } = findRegions(diff, a.w, a.h)
  let changed = 0
  for (let i = 0; i < labels.length; i++) if (labels[i]) changed++
  markMoved(a, b, tone, labels, regions)
  const real = regions.filter((r) => !r.moved)
  const top = real[0] ?? regions[0]
  const keep = top ? real.filter((r) => r.score >= top.score * 0.5 || (r.strength >= top.strength * 0.6 && r.score >= top.score * 0.04)).map((r) => r.id) : []
  const cell = photo.w / a.w
  return { gw: a.w, gh: a.h, shift: [Math.round(dx * cell), Math.round(dy * cell)], tone, diff, labels, regions, changed: changed / labels.length, keep }
}

/**
 * A region is "moved" when nudging the model's picture a few cells makes most of its difference go
 * away: the surface is the same, it just sits somewhere slightly else. A repaint does not line up
 * however it is nudged.
 */
function markMoved(a: Grid, b: Grid, tone: Tone, labels: Int32Array, regions: Region[], reach = 4) {
  const { w, h } = a
  const ya = luma(a)
  const yb = new Float32Array(w * h)
  const ca = new Float32Array(w * h)
  const cb = new Float32Array(w * h)
  for (let i = 0; i < yb.length; i++) {
    const r = tone.gain[0] * b.r[i] + tone.offset[0]
    const g = tone.gain[1] * b.g[i] + tone.offset[1]
    const bl = tone.gain[2] * b.b[i] + tone.offset[2]
    yb[i] = 0.299 * r + 0.587 * g + 0.114 * bl
    cb[i] = r - bl
    ca[i] = a.r[i] - a.b[i]
  }
  const cells = new Map<number, number[]>()
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i]
    if (!id) continue
    let list = cells.get(id)
    if (!list) cells.set(id, (list = []))
    list.push(i)
  }
  for (const r of regions) {
    const list = cells.get(r.id) ?? []
    const step = Math.max(1, Math.floor(list.length / 1500))
    let zero = 0
    let best = Infinity
    for (let dy = -reach; dy <= reach; dy++)
      for (let dx = -reach; dx <= reach; dx++) {
        let cost = 0
        let n = 0
        for (let k = 0; k < list.length; k += step) {
          const i = list[k]
          const x = (i % w) + dx
          const y = Math.floor(i / w) + dy
          if (x < 0 || y < 0 || x >= w || y >= h) continue
          const j = y * w + x
          cost += Math.abs(ya[i] - yb[j]) + 0.8 * Math.abs(ca[i] - cb[j])
          n++
        }
        if (n < list.length / step / 2) continue
        cost /= n
        if (!dx && !dy) zero = cost
        if (cost < best) best = cost
      }
    r.moved = zero > 0 && best < zero * 0.55
  }
}

/** A soft 0..1 mask on the grid covering the regions to keep, grown a little so edges are not cut. */
export function regionMask(an: Pick<Analysis, 'gw' | 'gh' | 'labels'>, keep: number[], grow = 3, soften = 3): Float32Array {
  const set = new Set(keep)
  const on = new Uint8Array(an.gw * an.gh)
  for (let i = 0; i < on.length; i++) on[i] = set.has(an.labels[i]) ? 1 : 0
  return softMask(dilate(on, an.gw, an.gh, grow), an.gw, an.gh, soften)
}

export function softMask(on: Uint8Array, w: number, h: number, soften = 3): Float32Array {
  let m: Float32Array = new Float32Array(on.length)
  for (let i = 0; i < on.length; i++) m[i] = on[i]
  for (let k = 0; k < soften; k++) m = blur3(m, w, h)
  return m
}

/**
 * The photo with the model's pixels laid in through a soft mask. Where the mask is zero the result is
 * the photo's own bytes. `mask` is a grid of mw x mh covering the whole picture.
 */
export function composite(photo: Img, edit: Img, mask: Float32Array, mw: number, mh: number, tone: Tone = NO_TONE, shift: [number, number] = [0, 0]): Uint8ClampedArray {
  const { w, h } = photo
  const out = new Uint8ClampedArray(photo.data.length)
  out.set(photo.data)
  const src = edit.data
  const [sx, sy] = shift
  const fx = mw / w
  const fy = mh / h
  for (let y = 0; y < h; y++) {
    const gy = Math.max(0, Math.min(mh - 1.001, (y + 0.5) * fy - 0.5))
    const y0 = Math.floor(gy)
    const ty = gy - y0
    const ey = Math.min(h - 1, Math.max(0, y + sy))
    for (let x = 0; x < w; x++) {
      const gx = Math.max(0, Math.min(mw - 1.001, (x + 0.5) * fx - 0.5))
      const x0 = Math.floor(gx)
      const tx = gx - x0
      const i0 = y0 * mw + x0
      const a = (mask[i0] * (1 - tx) + mask[i0 + 1] * tx) * (1 - ty) + (mask[i0 + mw] * (1 - tx) + mask[i0 + mw + 1] * tx) * ty
      if (a <= 0.004) continue
      // Ease the edge so a half-covered cell is mostly one or the other.
      const t = a >= 0.996 ? 1 : a * a * (3 - 2 * a)
      const ex = Math.min(w - 1, Math.max(0, x + sx))
      const j = (ey * w + ex) * 4
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        const v = tone.gain[c] * src[j + c] + tone.offset[c]
        out[i + c] = out[i + c] * (1 - t) + v * t
      }
    }
  }
  return out
}

/** Share of pixels that differ at all between two same-size pictures (for tests and the "nothing else moved" line). */
export function differing(a: Img, b: { data: Uint8ClampedArray | Uint8Array }): number {
  let n = 0
  const p = a.data
  const q = b.data
  for (let i = 0; i < p.length; i += 4) if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2]) n++
  return n / (p.length / 4)
}

// ---------------------------------------------------------------- working sizes and crops

/** Working sizes: every side a multiple of 16 (so models return exactly this size), about 2 megapixels. */
export const SIZES: Record<string, [number, number]> = {
  '1:1': [1408, 1408],
  '4:3': [1600, 1200],
  '3:4': [1200, 1600],
  '3:2': [1728, 1152],
  '2:3': [1152, 1728],
  '16:9': [1792, 1008],
  '9:16': [1008, 1792],
  '5:4': [1600, 1280],
  '4:5': [1280, 1600],
}

export function nearestSize(w: number, h: number): { ratio: string; w: number; h: number } {
  let best = '4:3'
  let miss = Infinity
  for (const k of Object.keys(SIZES)) {
    const [a, b] = SIZES[k]
    const d = Math.abs(Math.log(a / b) - Math.log(w / h))
    if (d < miss) {
      miss = d
      best = k
    }
  }
  return { ratio: best, w: SIZES[best][0], h: SIZES[best][1] }
}

export type Crop = { x: number; y: number; w: number; h: number; ratio: string; outW: number; outH: number }

/**
 * The part of the picture to send for a brushed change: the brushed box with room around it, shaped to
 * a size models take, kept inside the picture. Returns null when the brush covers most of the picture.
 */
export function cropFor(mask: Float32Array, mw: number, mh: number, W: number, H: number, pad = 0.35): Crop | null {
  let x0 = mw
  let y0 = mh
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < mh; y++)
    for (let x = 0; x < mw; x++)
      if (mask[y * mw + x] > 0.05) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) return null
  let bx0 = (x0 / mw) * W
  let by0 = (y0 / mh) * H
  let bx1 = ((x1 + 1) / mw) * W
  let by1 = ((y1 + 1) / mh) * H
  const bw = bx1 - bx0
  const bh = by1 - by0
  if (bw * bh > 0.55 * W * H) return null
  // Room around the brush so the model sees what the change sits in; never less than a quarter of the picture's short side.
  const min = Math.min(W, H) * 0.3
  let cw = Math.max(bw * (1 + 2 * pad), min)
  let ch = Math.max(bh * (1 + 2 * pad), min)
  // Shape to the nearest size models take, growing (never shrinking) the box.
  const size = nearestSize(cw, ch)
  const ar = size.w / size.h
  if (cw / ch < ar) cw = ch * ar
  else ch = cw / ar
  if (cw > W || ch > H) return null
  const cx = (bx0 + bx1) / 2
  const cy = (by0 + by1) / 2
  const x = Math.round(Math.min(W - cw, Math.max(0, cx - cw / 2)))
  const y = Math.round(Math.min(H - ch, Math.max(0, cy - ch / 2)))
  bx0 = x
  by0 = y
  return { x, y, w: Math.round(cw), h: Math.round(ch), ratio: size.ratio, outW: size.w, outH: size.h }
}

/** Cut a rectangle out of a picture. */
export function cut(img: Img, c: { x: number; y: number; w: number; h: number }): Img {
  const out = new Uint8ClampedArray(c.w * c.h * 4)
  for (let y = 0; y < c.h; y++) {
    const s = ((c.y + y) * img.w + c.x) * 4
    out.set(img.data.subarray(s, s + c.w * 4), y * c.w * 4)
  }
  return { w: c.w, h: c.h, data: out }
}

/** The part of a whole-picture mask grid that covers a crop, as its own grid. */
export function cutMask(mask: Float32Array, mw: number, mh: number, W: number, H: number, c: Crop, gw = 192): { mask: Float32Array; w: number; h: number } {
  const gh = Math.max(1, Math.round((gw * c.h) / c.w))
  const out = new Float32Array(gw * gh)
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const px = c.x + ((x + 0.5) / gw) * c.w
      const py = c.y + ((y + 0.5) / gh) * c.h
      const mx = Math.min(mw - 1, Math.max(0, Math.floor((px / W) * mw)))
      const my = Math.min(mh - 1, Math.max(0, Math.floor((py / H) * mh)))
      out[y * gw + x] = mask[my * mw + mx]
    }
  return { mask: out, w: gw, h: gh }
}

/** Put an edited crop back into the whole picture through the brush mask; outside the brush nothing changes. */
export function pasteCrop(photo: Img, editedCrop: Img, c: Crop, mask: Float32Array, mw: number, mh: number): Uint8ClampedArray {
  const before = cut(photo, c)
  const local = cutMask(mask, mw, mh, photo.w, photo.h, c)
  // Tones are matched on the part of the crop outside the brush, where the two should be the same picture.
  const a = toGrid(before, 128)
  const b = toGrid(editedCrop, 128)
  const outside = new Uint8Array(a.w * a.h)
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      const lx = Math.min(local.w - 1, Math.floor(((x + 0.5) / a.w) * local.w))
      const ly = Math.min(local.h - 1, Math.floor(((y + 0.5) / a.h) * local.h))
      outside[y * a.w + x] = local.mask[ly * local.w + lx] < 0.02 ? 1 : 0
    }
  let free = 0
  for (let i = 0; i < outside.length; i++) free += outside[i]
  const tone = free > outside.length * 0.08 ? fitTone(a, b, outside) : NO_TONE
  const patched = composite(before, editedCrop, local.mask, local.w, local.h, tone)
  const out = new Uint8ClampedArray(photo.data.length)
  out.set(photo.data)
  for (let y = 0; y < c.h; y++) out.set(patched.subarray(y * c.w * 4, (y + 1) * c.w * 4), ((c.y + y) * photo.w + c.x) * 4)
  return out
}
