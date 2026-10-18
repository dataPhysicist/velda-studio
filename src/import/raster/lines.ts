// Thin straight lines in a binary plan raster. A wall face is a 1 to 3 px line; crossing it, a row
// (or column) sees a short dark run. Short runs that line up from row to row form a line chain.
// Pure functions on typed arrays: they run in the import worker and in vitest alike.

export type Mask = { width: number; height: number; data: Uint8Array } // 1 = dark

/** Otsu's threshold on a gray histogram (0 = black). */
export function otsu(gray: Uint8Array): number {
  const hist = new Float64Array(256)
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++
  const total = gray.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let wB = 0
  let sumB = 0
  let best = 0
  let bestT = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      bestT = t
    }
  }
  return bestT
}

/** Dark mask: 1 where gray is below the threshold. */
export function binarize(gray: { width: number; height: number; data: Uint8Array }, threshold: number): Mask {
  const out = new Uint8Array(gray.data.length)
  const g = gray.data
  for (let i = 0; i < g.length; i++) out[i] = g[i] < threshold ? 1 : 0
  return { width: gray.width, height: gray.height, data: out }
}

export function transpose(m: Mask): Mask {
  const { width: W, height: H, data } = m
  const out = new Uint8Array(data.length)
  // Blocked copy keeps it cache friendly on a 29 MP sheet.
  const B = 64
  for (let y0 = 0; y0 < H; y0 += B) {
    const y1 = Math.min(H, y0 + B)
    for (let x0 = 0; x0 < W; x0 += B) {
      const x1 = Math.min(W, x0 + B)
      for (let y = y0; y < y1; y++) {
        const row = y * W
        for (let x = x0; x < x1; x++) out[x * H + y] = data[row + x]
      }
    }
  }
  return { width: H, height: W, data: out }
}

/**
 * A straight line chain. For vertical chains `c` is the mean x and `t0..t1` the rows it spans; for
 * horizontal chains (found on the transposed mask) `c` is the mean y and `t0..t1` the columns.
 */
export type Chain = { c: number; t0: number; t1: number; n: number }

/**
 * Chains of short dark runs that stack along the second axis of the mask: vertical lines on the
 * mask as given, horizontal lines on its transpose.
 * maxRun: widest run that still counts as a thin line (px); maxGap: rows a chain may skip;
 * minLen: shortest chain kept (px).
 */
export function chains(m: Mask, opts: { maxRun?: number; maxGap?: number; minLen?: number; drift?: number } = {}): Chain[] {
  const maxRun = opts.maxRun ?? 4
  const maxGap = opts.maxGap ?? 3
  const minLen = opts.minLen ?? 30
  const drift = opts.drift ?? 1.25
  const { width: W, height: H, data } = m
  type Live = { sx: number; n: number; t0: number; last: number; slot: number }
  const live: Live[] = []
  const slot = new Int32Array(W).fill(-1) // column -> live chain index
  const done: Chain[] = []
  const close = (k: number) => {
    const ch = live[k]
    if (!ch) return
    if (ch.last - ch.t0 + 1 >= minLen) done.push({ c: ch.sx / ch.n, t0: ch.t0, t1: ch.last, n: ch.n })
    if (slot[ch.slot] === k) slot[ch.slot] = -1
    live[k] = undefined as unknown as Live
  }
  for (let y = 0; y < H; y++) {
    const row = y * W
    let x = 0
    while (x < W) {
      if (!data[row + x]) {
        x++
        continue
      }
      const s = x
      while (x < W && data[row + x]) x++
      const len = x - s
      if (len > maxRun) continue
      const c = (s + x - 1) / 2
      const xi = Math.round(c)
      // nearest live chain whose mean is within `drift` px and that saw a run recently
      let pick = -1
      let pickD = Infinity
      for (let col = xi - 2; col <= xi + 2; col++) {
        if (col < 0 || col >= W) continue
        const k = slot[col]
        if (k < 0 || !live[k]) continue
        const ch = live[k]
        if (y - ch.last > maxGap + 1) {
          close(k)
          continue
        }
        if (ch.last === y) continue // took a run in this row already
        const d = Math.abs(ch.sx / ch.n - c)
        if (d <= drift && d < pickD) {
          pick = k
          pickD = d
        }
      }
      const free = (col: number) => slot[col] < 0 || !live[slot[col]] || y - live[slot[col]].last > maxGap + 1
      if (pick >= 0) {
        const ch = live[pick]
        ch.sx += c
        ch.n++
        ch.last = y
        if (ch.slot !== xi && free(xi)) {
          if (slot[xi] >= 0 && live[slot[xi]]) close(slot[xi])
          if (slot[ch.slot] === pick) slot[ch.slot] = -1
          slot[xi] = pick
          ch.slot = xi
        }
      } else {
        if (!free(xi)) continue // two lines closer than the drift: keep the first
        if (slot[xi] >= 0 && live[slot[xi]]) close(slot[xi])
        live.push({ sx: c, n: 1, t0: y, last: y, slot: xi })
        slot[xi] = live.length - 1
      }
    }
  }
  for (let k = 0; k < live.length; k++) if (live[k]) close(k)
  return done
}
