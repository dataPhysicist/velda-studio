// Colors sampled from a picture, not guessed (07 section 6): a median-cut quantizer over the pixels.
// The function is self-contained (no imports, no outside names) because the same source also runs in
// Velda's code sandbox on pictures the page cannot read (Pinterest and product images).

export type Swatch = { hex: string; share: number }

/** The k main colors of an RGBA or RGB pixel buffer, biggest share first. */
export function quantize(data: ArrayLike<number>, channels: number, k = 5): Swatch[] {
  const px: number[][] = []
  const n = Math.floor(data.length / channels)
  const step = Math.max(1, Math.floor(n / 40000))
  for (let i = 0; i < n; i += step) {
    const o = i * channels
    if (channels === 4 && data[o + 3] < 128) continue
    px.push([data[o], data[o + 1], data[o + 2]])
  }
  if (!px.length) return []
  // Median cut: split the box with the widest channel range at its median until there are k boxes.
  let boxes: number[][][] = [px]
  const range = (b: number[][], c: number) => {
    let lo = 255
    let hi = 0
    for (const p of b) {
      if (p[c] < lo) lo = p[c]
      if (p[c] > hi) hi = p[c]
    }
    return hi - lo
  }
  while (boxes.length < k) {
    let pick = -1
    let widest = -1
    let chan = 0
    boxes.forEach((b, i) => {
      if (b.length < 2) return
      for (let c = 0; c < 3; c++) {
        const r = range(b, c) * Math.sqrt(b.length)
        if (r > widest) {
          widest = r
          pick = i
          chan = c
        }
      }
    })
    if (pick < 0 || widest <= 0) break
    const b = boxes[pick].slice().sort((p, q) => p[chan] - q[chan])
    const mid = Math.floor(b.length / 2)
    boxes = [...boxes.slice(0, pick), b.slice(0, mid), b.slice(mid), ...boxes.slice(pick + 1)]
  }
  // Median cut gives boxes of equal size; a few rounds of nearest-center assignment (k-means) give
  // each color its true share of the picture and a truer center.
  let centers = boxes.map((b) => {
    const s = [0, 0, 0]
    for (const p of b) for (let c = 0; c < 3; c++) s[c] += p[c]
    return s.map((v) => v / b.length)
  })
  let counts: number[] = centers.map(() => 0)
  for (let round = 0; round < 4; round++) {
    const sums = centers.map(() => [0, 0, 0])
    counts = centers.map(() => 0)
    for (const p of px) {
      let best = 0
      let bd = Infinity
      for (let j = 0; j < centers.length; j++) {
        const d = (p[0] - centers[j][0]) ** 2 + (p[1] - centers[j][1]) ** 2 + (p[2] - centers[j][2]) ** 2
        if (d < bd) {
          bd = d
          best = j
        }
      }
      counts[best]++
      for (let c = 0; c < 3; c++) sums[best][c] += p[c]
    }
    centers = centers.map((ctr, j) => (counts[j] ? sums[j].map((v) => v / counts[j]) : ctr))
  }
  const hex = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  const out = centers
    .map((ctr, j) => ({ hex: `#${hex(ctr[0])}${hex(ctr[1])}${hex(ctr[2])}`, share: counts[j] / px.length }))
    .filter((s) => s.share > 0)
  // Near-identical colors merge (a white wall split in two is still one white).
  const merged: Swatch[] = []
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  for (const sw of out.sort((a, b) => b.share - a.share)) {
    const same = merged.find((m) => {
      const a = rgb(m.hex)
      const c = rgb(sw.hex)
      return Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]) < 12
    })
    if (same) same.share += sw.share
    else merged.push({ ...sw })
  }
  return merged.map((m) => ({ hex: m.hex, share: Math.round(m.share * 1000) / 1000 }))
}

/** The palette of a picture the page holds (a dropped file or a blob), read through a small canvas. */
export async function paletteOfBlob(blob: Blob, k = 5): Promise<Swatch[]> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = bad
      i.src = url
    })
    const s = Math.min(1, 160 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.naturalWidth * s))
    c.height = Math.max(1, Math.round(img.naturalHeight * s))
    const g = c.getContext('2d', { willReadFrequently: true })!
    g.drawImage(img, 0, 0, c.width, c.height)
    return quantize(g.getImageData(0, 0, c.width, c.height).data, 4, k)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Code for Velda's sandbox: fetch pictures by URL, sample each one's palette with the same quantizer,
 * and save a contact sheet (up to 8 thumbnails) Velda can look at. Prints one JSON line.
 */
export function remotePaletteScript(urls: string[]): string {
  return `import jpeg from 'npm:jpeg-js@0.4.4'
const quantize = ${quantize.toString()}
const urls = ${JSON.stringify(urls)}
const out = []
const thumbs = []
for (const u of urls) {
  try {
    const r = await fetch(u)
    const im = jpeg.decode(new Uint8Array(await r.arrayBuffer()), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256 })
    out.push({ url: u, palette: quantize(im.data, 4, 5) })
    thumbs.push(im)
  } catch (e) {
    out.push({ url: u, error: String(e).slice(0, 120) })
  }
}
// Contact sheet: 4 across, 236 px cells, numbered in reading order like the list.
const cell = 236, cols = 4, rows = Math.ceil(thumbs.length / cols) || 1
const W = cell * cols, H = cell * rows, sheet = new Uint8Array(W * H * 4).fill(255)
thumbs.forEach((im, t) => {
  const s = Math.min(cell / im.width, cell / im.height), ox = (t % cols) * cell, oy = Math.floor(t / cols) * cell
  for (let y = 0; y < Math.floor(im.height * s); y++) for (let x = 0; x < Math.floor(im.width * s); x++) {
    const sx = Math.floor(x / s), sy = Math.floor(y / s), si = (sy * im.width + sx) * 4, di = ((oy + y) * W + ox + x) * 4
    sheet[di] = im.data[si]; sheet[di + 1] = im.data[si + 1]; sheet[di + 2] = im.data[si + 2]
  }
})
if (thumbs.length) { await Deno.mkdir('/tmp/output', { recursive: true }); await Deno.writeFile('/tmp/output/contact-sheet.jpg', jpeg.encode({ data: sheet, width: W, height: H }, 80).data) }
console.log(JSON.stringify(out))
`
}
