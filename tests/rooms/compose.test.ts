import { describe, expect, it } from 'vitest'
import { analyze, composite, cropFor, differing, type Img, nearestSize, pasteCrop, regionMask, SIZES, softMask } from '../../src/rooms/photo/compose'

// A "photo": smooth gradients with a little grain, so there is texture to line up on.
function photo(w = 600, h = 450): Img {
  const data = new Uint8ClampedArray(w * h * 4)
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 10
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = 4 * (y * w + x)
      const floor = y > h * 0.62
      data[i] = (floor ? 150 : 220) + 20 * Math.sin(x / 40) + rnd()
      data[i + 1] = (floor ? 130 : 212) + 16 * Math.cos(y / 30) + rnd()
      data[i + 2] = (floor ? 105 : 198) + 12 * Math.sin((x + y) / 50) + rnd()
      data[i + 3] = 255
    }
  return { w, h, data }
}
const copy = (p: Img): Img => ({ w: p.w, h: p.h, data: new Uint8ClampedArray(p.data) })
/** What a model does to the whole picture whether asked or not: slightly brighter and flatter. */
function drift(p: Img, gain = 1.05, offset = 5): Img {
  const out = copy(p)
  for (let i = 0; i < out.data.length; i += 4) for (let c = 0; c < 3; c++) out.data[i + c] = out.data[i + c] * gain + offset
  return out
}
function paint(p: Img, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = 4 * (y * p.w + x)
      p.data[i] = rgb[0]
      p.data[i + 1] = rgb[1]
      p.data[i + 2] = rgb[2]
    }
}
const same = (a: Img, b: Uint8ClampedArray, x: number, y: number) => {
  const i = 4 * (y * a.w + x)
  return a.data[i] === b[i] && a.data[i + 1] === b[i + 1] && a.data[i + 2] === b[i + 2]
}

describe('keeping a photo edit to what was asked for', () => {
  it('finds the one repainted area although every pixel of the model picture drifted, and puts the rest back exactly', () => {
    const p = photo()
    const edit = drift(p)
    paint(edit, 220, 180, 380, 300, [24, 44, 96])
    expect(differing(p, edit)).toBeGreaterThan(0.95)
    const an = analyze(p, edit)
    expect(an.keep.length).toBe(1)
    const r = an.regions.find((x) => x.id === an.keep[0])!
    expect(r.box[0]).toBeGreaterThan(0.3)
    expect(r.box[2]).toBeLessThan(0.7)
    expect(Math.abs(an.tone.gain[0] - 1 / 1.05)).toBeLessThan(0.03)
    const out = composite(p, edit, regionMask(an, an.keep), an.gw, an.gh, an.tone, an.shift)
    // Outside the area: the photo's own bytes.
    for (const [x, y] of [[10, 10], [590, 440], [100, 225], [500, 225], [300, 60], [300, 420]]) expect(same(p, out, x, y)).toBe(true)
    // Inside: the new color.
    const mid = 4 * (240 * p.w + 300)
    expect(out[mid + 2]).toBeGreaterThan(out[mid] + 30)
    const share = differing(p, { data: out })
    expect(share).toBeGreaterThan(0.06)
    expect(share).toBeLessThan(0.14)
  })

  it('treats a small weaker change far from the main one as a side effect, and lets it be kept on request', () => {
    const p = photo()
    const edit = drift(p)
    paint(edit, 200, 170, 400, 310, [24, 44, 96])
    // A light the model dimmed: small and much weaker than the repaint.
    for (let y = 40; y < 70; y++)
      for (let x = 500; x < 540; x++) {
        const i = 4 * (y * p.w + x)
        for (let c = 0; c < 3; c++) edit.data[i + c] = edit.data[i + c] - 45
      }
    const an = analyze(p, edit)
    expect(an.regions.length).toBe(2)
    expect(an.keep.length).toBe(1)
    const side = an.regions.find((r) => !an.keep.includes(r.id))!
    expect(side.at[0]).toBeGreaterThan(0.8)
    const out = composite(p, edit, regionMask(an, an.keep), an.gw, an.gh, an.tone, an.shift)
    expect(same(p, out, 520, 55)).toBe(true)
    const both = composite(p, edit, regionMask(an, an.regions.map((r) => r.id)), an.gw, an.gh, an.tone, an.shift)
    expect(same(p, both, 520, 55)).toBe(false)
  })

  it('keeps two changes of the same kind (both sconces)', () => {
    const p = photo()
    const edit = drift(p)
    paint(edit, 120, 80, 170, 150, [190, 150, 60])
    paint(edit, 430, 80, 480, 150, [190, 150, 60])
    const an = analyze(p, edit)
    expect(an.keep.length).toBe(2)
  })

  it('knows a nudged object from a repainted one', () => {
    const p = photo()
    paint(p, 60, 300, 150, 400, [40, 36, 34])
    const edit = drift(p)
    // The dark cabinet sits 7 pixels to the right in the model picture; nothing was repainted there.
    paint(edit, 60, 300, 67, 400, [150, 130, 105])
    paint(edit, 150, 300, 157, 400, [40, 36, 34])
    paint(edit, 300, 120, 420, 220, [24, 44, 96])
    const an = analyze(p, edit)
    const kept = an.regions.filter((r) => an.keep.includes(r.id))
    expect(kept.length).toBe(1)
    expect(kept[0].at[0]).toBeGreaterThan(0.45)
    for (const r of an.regions) if (r.at[0] < 0.3) expect(r.moved || !an.keep.includes(r.id)).toBe(true)
  })

  it('reports nothing to keep when the model changed nothing but tone', () => {
    const p = photo()
    const an = analyze(p, drift(p, 1.08, -6))
    expect(an.regions.length).toBe(0)
    expect(an.changed).toBe(0)
  })
})

describe('a marked spot', () => {
  const W = 1600
  const H = 1200
  const brush = (x0: number, y0: number, x1: number, y1: number, mw = 160, mh = 120) => {
    const on = new Uint8Array(mw * mh)
    for (let y = Math.floor(y0 * mh); y < y1 * mh; y++) for (let x = Math.floor(x0 * mw); x < x1 * mw; x++) on[y * mw + x] = 1
    return { mask: softMask(on, mw, mh, 2), w: mw, h: mh }
  }

  it('cuts a part of the picture around the brush, in a size models take, inside the picture', () => {
    const b = brush(0.7, 0.1, 0.85, 0.3)
    const c = cropFor(b.mask, b.w, b.h, W, H)!
    expect(c).toBeTruthy()
    expect(c.x).toBeGreaterThanOrEqual(0)
    expect(c.y).toBeGreaterThanOrEqual(0)
    expect(c.x + c.w).toBeLessThanOrEqual(W)
    expect(c.y + c.h).toBeLessThanOrEqual(H)
    expect(c.x).toBeLessThanOrEqual(0.7 * W)
    expect(c.x + c.w).toBeGreaterThanOrEqual(0.85 * W)
    expect(c.outW % 16).toBe(0)
    expect(c.outH % 16).toBe(0)
    expect(Math.abs(c.w / c.h - c.outW / c.outH)).toBeLessThan(0.01)
    // The model sees the part larger than life.
    expect(c.outW).toBeGreaterThan(c.w)
  })

  it('sends the whole picture when the brush covers most of it', () => {
    const b = brush(0.05, 0.05, 0.95, 0.9)
    expect(cropFor(b.mask, b.w, b.h, W, H)).toBeNull()
  })

  it('changes nothing outside the brush, whatever the model did to the part', () => {
    const p = photo(800, 600)
    const b = brush(0.6, 0.2, 0.75, 0.4)
    const c = cropFor(b.mask, b.w, b.h, p.w, p.h)!
    // The "model" repaints the whole part it was sent.
    const part: Img = { w: c.w, h: c.h, data: new Uint8ClampedArray(c.w * c.h * 4).fill(255) }
    paint(part, 0, 0, c.w, c.h, [30, 90, 60])
    const out = pasteCrop(p, part, c, b.mask, b.w, b.h)
    let outside = 0
    let inside = 0
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const fx = x / p.w
        const fy = y / p.h
        const diff = !same(p, out, x, y)
        if (fx > 0.56 && fx < 0.79 && fy > 0.15 && fy < 0.45) inside += diff ? 1 : 0
        else outside += diff ? 1 : 0
      }
    expect(outside).toBe(0)
    expect(inside).toBeGreaterThan(0.6 * 0.15 * 0.2 * p.w * p.h)
  })
})

describe('working sizes', () => {
  it('are all multiples of 16 and about two megapixels', () => {
    for (const [k, [w, h]] of Object.entries(SIZES)) {
      expect(w % 16, k).toBe(0)
      expect(h % 16, k).toBe(0)
      expect(w * h).toBeGreaterThan(1.7e6)
      expect(w * h).toBeLessThan(2.2e6)
      const [a, b] = k.split(':').map(Number)
      expect(Math.abs(w / h - a / b)).toBeLessThan(0.001)
    }
  })
  it('match a phone photo to its shape', () => {
    expect(nearestSize(4032, 3024)).toEqual({ ratio: '4:3', w: 1600, h: 1200 })
    expect(nearestSize(3024, 4032).ratio).toBe('3:4')
    expect(nearestSize(1920, 1080).ratio).toBe('16:9')
    expect(nearestSize(1696, 2528).ratio).toBe('2:3')
  })
})
