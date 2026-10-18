// Turn one pdf.js page into PageData: text spans, stroked segments, filled shapes and image
// placements, all in page points with y down. Works with the browser build (inline worker) and the
// Node legacy build (scripts/capture-fixture.ts), so it only touches the public page API.
//
// pdf.js 6 operator encoding (pinned 6.4.299): constructPath args are [paintOp, [pathData], minMax],
// pathData codes 0 moveTo, 1 lineTo, 2 curveTo (6 numbers), 3 quadraticCurveTo (4), 4 closePath;
// coordinates are in user space, so the current transform is tracked here.
import type { Vec } from '../model/types'
import type { Box, Fill, ImagePaint, PageData, Seg, TextSpan } from './types'

type M = [number, number, number, number, number, number]
type PdfPage = {
  pageNumber: number
  rotate: number
  getViewport(o: { scale: number }): { width: number; height: number; transform: number[] }
  getTextContent(): Promise<{ items: any[] }>
  getOperatorList(): Promise<{ fnArray: ArrayLike<number>; argsArray: any[] }>
}

const ID: M = [1, 0, 0, 1, 0, 0]
/** Apply `first`, then `then`. */
export const compose = (first: M, then: M): M => [
  first[0] * then[0] + first[1] * then[2],
  first[0] * then[1] + first[1] * then[3],
  first[2] * then[0] + first[3] * then[2],
  first[2] * then[1] + first[3] * then[3],
  first[4] * then[0] + first[5] * then[2] + then[4],
  first[4] * then[1] + first[5] * then[3] + then[5],
]
export const apply = (m: M, p: Vec): Vec => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]
const r3 = (v: number) => Math.round(v * 1000) / 1000
const rp = (p: Vec): Vec => [r3(p[0]), r3(p[1])]

const STROKE = new Set([20, 21, 24, 25, 26, 27])
const FILL = new Set([22, 23, 24, 25, 26, 27])
const CLOSE_STROKE = new Set([21, 26, 27])

function hex(v: unknown): string {
  if (typeof v === 'string') return v.startsWith('#') ? v.toLowerCase() : v
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const a = Array.from(v as ArrayLike<number>)
    const to = (x: number) => Math.round(Math.max(0, Math.min(1, x > 1 ? x / 255 : x)) * 255).toString(16).padStart(2, '0')
    if (a.length === 1) return `#${to(a[0]).repeat(3)}`
    if (a.length === 4) {
      const [c, m, y, k] = a
      return `#${to((1 - c) * (1 - k))}${to((1 - m) * (1 - k))}${to((1 - y) * (1 - k))}`
    }
    if (a.length >= 3) return `#${to(a[0])}${to(a[1])}${to(a[2])}`
  }
  return '#000000'
}

function cubic(p0: Vec, p1: Vec, p2: Vec, p3: Vec, n = 8): Vec[] {
  const out: Vec[] = []
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ])
  }
  return out
}

type Sub = { pts: Vec[]; curve: boolean[]; closed: boolean }

/** Read path data into subpaths of page points (curves flattened, each point flagged). */
function subpaths(data: ArrayLike<number>, m: M): Sub[] {
  const subs: Sub[] = []
  let cur: Sub | null = null
  let last: Vec = [0, 0]
  const T = (x: number, y: number) => apply(m, [x, y])
  let i = 0
  while (i < data.length) {
    const code = data[i++]
    if (code === 0) {
      last = [data[i++], data[i++]]
      cur = { pts: [T(...last)], curve: [false], closed: false }
      subs.push(cur)
    } else if (code === 1) {
      last = [data[i++], data[i++]]
      if (!cur) subs.push((cur = { pts: [], curve: [], closed: false }))
      cur.pts.push(T(...last))
      cur.curve.push(false)
    } else if (code === 2 || code === 3) {
      const p0 = last
      let p1: Vec, p2: Vec, p3: Vec
      if (code === 2) {
        p1 = [data[i++], data[i++]]
        p2 = [data[i++], data[i++]]
        p3 = [data[i++], data[i++]]
      } else {
        const q: Vec = [data[i++], data[i++]]
        p3 = [data[i++], data[i++]]
        p1 = [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])]
        p2 = [p3[0] + (2 / 3) * (q[0] - p3[0]), p3[1] + (2 / 3) * (q[1] - p3[1])]
      }
      if (!cur) subs.push((cur = { pts: [T(...p0)], curve: [false], closed: false }))
      for (const p of cubic(p0, p1, p2, p3)) {
        cur.pts.push(T(...p))
        cur.curve.push(true)
      }
      last = p3
    } else if (code === 4) {
      if (cur) cur.closed = true
    } else {
      break // unknown code: stop rather than misread the rest
    }
  }
  return subs
}

function bboxOf(points: Vec[]): Box {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of points) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return [r3(x0), r3(y0), r3(x1), r3(y1)]
}

/** Scale of a transform along x and y (for stroke widths). */
const scaleOf = (m: M) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))

export async function readPage(page: PdfPage, OPS: Record<string, number>): Promise<PageData> {
  const vp = page.getViewport({ scale: 1 })
  const view = vp.transform as M // PDF user space -> page pt, y down
  const names: Record<number, string> = {}
  for (const [k, v] of Object.entries(OPS)) names[v] = k

  // --- text
  const tc = await page.getTextContent()
  const text: TextSpan[] = []
  for (const it of tc.items) {
    if (!('str' in it) || !it.str || !it.str.trim()) continue
    const t = it.transform as M
    const m = compose(t, view) // glyph space -> page
    const origin = apply(m, [0, 0])
    const along = apply(m, [1, 0])
    const up = apply(m, [0, 1])
    const ax: Vec = [along[0] - origin[0], along[1] - origin[1]]
    const ux: Vec = [up[0] - origin[0], up[1] - origin[1]]
    const size = Math.hypot(...ux) || it.height || 1
    const len = Math.hypot(...ax) || 1
    const dir: Vec = [ax[0] / len, ax[1] / len]
    const upDir: Vec = [ux[0] / (Math.hypot(...ux) || 1), ux[1] / (Math.hypot(...ux) || 1)]
    const width = (it.width as number) ?? 0
    // pdf.js reports width in page units along the text direction already scaled by the font size.
    const corners: Vec[] = [
      origin,
      [origin[0] + dir[0] * width, origin[1] + dir[1] * width],
      [origin[0] + dir[0] * width + upDir[0] * size, origin[1] + dir[1] * width + upDir[1] * size],
      [origin[0] + upDir[0] * size, origin[1] + upDir[1] * size],
    ]
    text.push({
      str: it.str,
      at: rp(origin),
      dir: [r3(dir[0]), r3(dir[1])],
      size: r3(size),
      width: r3(width),
      bbox: bboxOf(corners),
      font: String(it.fontName ?? ''),
    })
  }

  // --- operators
  const ops = await page.getOperatorList()
  type G = { ctm: M; fill: string; stroke: string; ca: number; CA: number; lw: number }
  let g: G = { ctm: ID, fill: '#000000', stroke: '#000000', ca: 1, CA: 1, lw: 1 }
  const stack: G[] = []
  const groups: boolean[] = [] // per open group: is it a soft-mask group
  let maskDepth = 0
  const segs: Seg[] = []
  const fills: Fill[] = []
  const images: ImagePaint[] = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    const op = names[ops.fnArray[i]]
    const a = ops.argsArray[i]
    switch (op) {
      case 'save':
        stack.push({ ...g })
        break
      case 'restore':
        g = stack.pop() ?? g
        break
      case 'transform':
        g.ctm = compose(Array.from(a) as M, g.ctm)
        break
      case 'paintFormXObjectBegin':
        stack.push({ ...g })
        if (a?.[0]) g.ctm = compose(Array.from(a[0]) as M, g.ctm)
        break
      case 'paintFormXObjectEnd':
        g = stack.pop() ?? g
        break
      case 'beginGroup': {
        const isMask = !!a?.[0]?.smask
        groups.push(isMask)
        if (isMask) maskDepth++
        break
      }
      case 'endGroup':
        if (groups.pop()) maskDepth--
        break
      case 'setLineWidth':
        g.lw = a[0]
        break
      case 'setStrokeRGBColor':
      case 'setStrokeGray':
      case 'setStrokeCMYKColor':
        g.stroke = hex(a.length === 1 ? a[0] : a)
        break
      case 'setFillRGBColor':
      case 'setFillGray':
      case 'setFillCMYKColor':
        g.fill = hex(a.length === 1 ? a[0] : a)
        break
      case 'setGState':
        for (const [k, v] of a[0] ?? []) {
          if (k === 'ca') g.ca = Number(v)
          else if (k === 'CA') g.CA = Number(v)
          else if (k === 'LW') g.lw = Number(v)
        }
        break
      case 'constructPath': {
        const paint = a[0] as number
        const data = a[1]?.[0]
        if (!data || paint === 28) break
        const m = compose(g.ctm, view)
        const subs = subpaths(data, m)
        if (STROKE.has(paint)) {
          const w = r3(g.lw * scaleOf(m) || 0)
          for (const s of subs) {
            for (let k = 1; k < s.pts.length; k++) {
              segs.push({ a: rp(s.pts[k - 1]), b: rp(s.pts[k]), w, color: g.stroke, alpha: g.CA, ...(s.curve[k] ? { curve: true } : {}) })
            }
            if ((s.closed || CLOSE_STROKE.has(paint)) && s.pts.length > 2) {
              const p = s.pts[s.pts.length - 1]
              const q = s.pts[0]
              if (p[0] !== q[0] || p[1] !== q[1]) segs.push({ a: rp(p), b: rp(q), w, color: g.stroke, alpha: g.CA })
            }
          }
        }
        if (FILL.has(paint) && maskDepth === 0) {
          const polys = subs.filter((s) => s.pts.length >= 3).map((s) => s.pts.map(rp))
          if (polys.length) fills.push({ polys, bbox: bboxOf(polys.flat()), color: g.fill, alpha: g.ca })
        }
        break
      }
      case 'paintImageXObject':
      case 'paintInlineImageXObject':
      case 'paintImageMaskXObject': {
        const m = compose(g.ctm, view)
        const corners = [apply(m, [0, 0]), apply(m, [1, 0]), apply(m, [1, 1]), apply(m, [0, 1])]
        const id = typeof a?.[0] === 'string' ? a[0] : `inline_${i}`
        const w = Number(a?.[1] ?? a?.[0]?.width ?? 0)
        const h = Number(a?.[2] ?? a?.[0]?.height ?? 0)
        images.push({ id, px: [w, h], rect: bboxOf(corners), mask: maskDepth > 0 || op === 'paintImageMaskXObject' })
        break
      }
    }
  }
  return {
    page: page.pageNumber,
    size: [r3(vp.width), r3(vp.height)],
    rotation: page.rotate ?? 0,
    text,
    segs,
    fills,
    images,
  }
}
