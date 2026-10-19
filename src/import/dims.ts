// Dimension strings as drawn on a plan sheet: 19'-8", 8'-1/4", 3'-9 3/4", 2'-0", 12", 1/2".
// Pure functions, no pdf.js: the adapter hands text spans in, these turn them into inches.
// See docs: 05-plan-import-spec section 3.3.
import type { Vec } from '../model/types'
import type { Box, Seg, TextSpan } from './types'

export type Orientation = 'h' | 'v' | 'diag'

// Feet and inches with optional fraction:  19'-8"  8'-1/4"  3'-9 3/4"  18'-5 1/2"  2'-0"
const FEET = /^(\d+)\s*'\s*-?\s*(?:(\d+)(?:\s+(\d+)\s*\/\s*(\d+))?|(\d+)\s*\/\s*(\d+))?\s*"$/
// Inches only:  12"  9 1/2"  1/2"
const INCHES = /^(?:(\d+)(?:\s+(\d+)\s*\/\s*(\d+))?|(\d+)\s*\/\s*(\d+))\s*"$/

/** Normalize the quote and dash characters PDF producers use for feet and inches. */
export function normalizeDimText(text: string): string {
  return text
    .trim()
    .replace(/[′’‘`´]/g, "'") // prime, curly single quotes
    .replace(/[″”“]|''/g, '"') // double prime, curly double quotes, two singles
    .replace(/[‐-―−]/g, '-') // hyphens, en and em dash, minus sign
    .replace(/\s+/g, ' ')
}

/** Inches for a dimension string, or null when the text is not one. */
export function parseDimension(text: string): number | null {
  const t = normalizeDimText(text)
  let m = FEET.exec(t)
  if (m) {
    const [, ft, inch, n1, d1, n2, d2] = m
    let v = Number(ft) * 12
    if (inch !== undefined) v += Number(inch)
    if (n1 !== undefined && d1 !== undefined) v += frac(n1, d1)
    if (n2 !== undefined && d2 !== undefined) v += frac(n2, d2)
    return Number.isFinite(v) ? v : null
  }
  m = INCHES.exec(t)
  if (m) {
    const [, inch, n1, d1, n2, d2] = m
    let v = 0
    if (inch !== undefined) v += Number(inch)
    if (n1 !== undefined && d1 !== undefined) v += frac(n1, d1)
    if (n2 !== undefined && d2 !== undefined) v += frac(n2, d2)
    return v > 0 && Number.isFinite(v) ? v : null
  }
  return null
}

/** A length a person typed: 13'-2", 13' 2", 4', 158, 158", 4 1/2. Bare numbers are inches. */
export function parseLength(text: string): number | null {
  const t = normalizeDimText(text)
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t)
  if (/^\d+ \d+\/\d+$/.test(t)) {
    const [w, f] = t.split(' ')
    const [n, d] = f.split('/').map(Number)
    return d ? Number(w) + n / d : null
  }
  const spaced = t.replace(/^(\d+)'\s+(\d)/, "$1'-$2") // 13' 2" reads like 13'-2"
  return parseDimension(spaced) ?? parseDimension(`${spaced}"`)
}

function frac(n: string, d: string) {
  const den = Number(d)
  return den > 0 ? Number(n) / den : NaN
}

/**
 * Text direction to orientation. Producers rotate some strings slightly (A2 has a 2'-8" at about
 * 0.8 degrees), so allow a few degrees before calling a string diagonal.
 */
export function orientationOf(dir: [number, number], tolDeg = 3): Orientation {
  const ang = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI
  const a = ((ang % 180) + 180) % 180 // 0..180
  if (a <= tolDeg || a >= 180 - tolDeg) return 'h'
  if (Math.abs(a - 90) <= tolDeg) return 'v'
  return 'diag'
}

export { formatFeetInches } from '../model/units'

// ------------------------------------------------------------------ strings on a page, pairing, scale


export type DimLine = { a: Vec; b: Vec; seg: number; ratio: number; dist: number }
export type DimRead = {
  id: string
  text: string
  inches: number
  orient: Orientation
  dir: Vec
  center: Vec
  bbox: Box
  /** The vector dimension line this string labels, once paired (page pt). */
  line?: DimLine
}

const hyp = (v: Vec) => Math.hypot(v[0], v[1])

/**
 * Join spans that continue one dimension string ("18'-5" then "1/2\"" on the same baseline, under
 * 6 pt apart). Other spans pass through unchanged.
 */
export function mergeDimSpans(spans: TextSpan[]): TextSpan[] {
  const out: TextSpan[] = []
  const used = new Set<number>()
  for (let i = 0; i < spans.length; i++) {
    if (used.has(i)) continue
    let s = spans[i]
    for (let guard = 0; guard < 3; guard++) {
      if (parseDimension(s.str) !== null) break
      const end: Vec = [s.at[0] + s.dir[0] * s.width, s.at[1] + s.dir[1] * s.width]
      let found = -1
      for (let j = 0; j < spans.length; j++) {
        if (j === i || used.has(j)) continue
        const t = spans[j]
        if (Math.abs(t.dir[0] - s.dir[0]) > 0.02 || Math.abs(t.dir[1] - s.dir[1]) > 0.02) continue
        const d: Vec = [t.at[0] - end[0], t.at[1] - end[1]]
        const along = d[0] * s.dir[0] + d[1] * s.dir[1]
        const across = Math.abs(-d[0] * s.dir[1] + d[1] * s.dir[0])
        if (along > -1 && along < 6 && across < 1) {
          const joined = `${s.str}${along > 0.8 ? ' ' : ''}${t.str}`
          if (parseDimension(joined) !== null || /^\d+'?-?\s*\d*$/.test(normalizeDimText(joined))) {
            found = j
            break
          }
        }
      }
      if (found < 0) break
      const t = spans[found]
      used.add(found)
      const gap = (t.at[0] - s.at[0]) * s.dir[0] + (t.at[1] - s.at[1]) * s.dir[1] - s.width
      s = {
        ...s,
        str: `${s.str}${gap > 0.8 ? ' ' : ''}${t.str}`,
        width: s.width + Math.max(0, gap) + t.width,
        bbox: [Math.min(s.bbox[0], t.bbox[0]), Math.min(s.bbox[1], t.bbox[1]), Math.max(s.bbox[2], t.bbox[2]), Math.max(s.bbox[3], t.bbox[3])],
      }
    }
    out.push(s)
  }
  return out
}

/** Every span that parses as a dimension, with its center and orientation. */
export function readDimensions(spans: TextSpan[]): DimRead[] {
  const out: DimRead[] = []
  for (const s of mergeDimSpans(spans)) {
    const inches = parseDimension(s.str)
    if (inches === null) continue
    out.push({
      id: `d${out.length}`,
      text: normalizeDimText(s.str),
      inches,
      orient: orientationOf(s.dir),
      dir: s.dir,
      center: [(s.bbox[0] + s.bbox[2]) / 2, (s.bbox[1] + s.bbox[3]) / 2],
      bbox: s.bbox,
    })
  }
  return out
}

type Cand = { seg: number; len: number; ratio: number; dist: number; a: Vec; b: Vec }

/** Straight segments parallel to the string, within 20 pt of its center and spanning it. */
function candidates(d: DimRead, segs: Seg[], maxDist = 20, tolDeg = 3): Cand[] {
  const out: Cand[] = []
  const sinTol = Math.sin((tolDeg * Math.PI) / 180)
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    if (s.curve) continue
    const v: Vec = [s.b[0] - s.a[0], s.b[1] - s.a[1]]
    const len = hyp(v)
    if (len < 3) continue
    const u: Vec = [v[0] / len, v[1] / len]
    // parallel to the text direction (either way round)
    if (Math.abs(u[0] * d.dir[1] - u[1] * d.dir[0]) > sinTol) continue
    const w: Vec = [d.center[0] - s.a[0], d.center[1] - s.a[1]]
    const along = w[0] * u[0] + w[1] * u[1]
    if (along < -0.5 || along > len + 0.5) continue
    const dist = Math.abs(w[0] * u[1] - w[1] * u[0])
    if (dist > maxDist) continue
    out.push({ seg: i, len, ratio: len / d.inches, dist, a: s.a, b: s.b })
  }
  return out
}

/** The ratio (pt per real inch) most strings agree on within 1 percent. */
function modeRatio(all: number[]): number | null {
  if (!all.length) return null
  const sorted = [...all].sort((a, b) => a - b)
  let best = 0
  let bestN = 0
  for (const r of sorted) {
    let n = 0
    for (const q of sorted) if (Math.abs(q / r - 1) <= 0.01) n++
    if (n > bestN) {
      bestN = n
      best = r
    }
  }
  const support = sorted.filter((q) => Math.abs(q / best - 1) <= 0.01)
  return support[Math.floor(support.length / 2)]
}

export type ScaleRead = {
  ptPerInch: number | null
  pairs: number
  /** Ratio of each paired string, for the report. */
  spread: { min: number; max: number }
}

/**
 * Pair each string with its dimension line and read the drawing scale from the pairs (05 section
 * 3.3). Pairing: the parallel line nearest the text that spans its center and whose length is
 * closest to inches times the common ratio; equal lengths go to the line nearest the text.
 */
export function pairDimensions(dims: DimRead[], segs: Seg[]): { dims: DimRead[]; scale: ScaleRead } {
  const cands = dims.map((d) => candidates(d, segs))
  const mode = modeRatio(cands.flatMap((c) => c.map((x) => x.ratio)))
  const out = dims.map((d) => ({ ...d, line: undefined as DimLine | undefined }))
  if (mode === null) return { dims: out, scale: { ptPerInch: null, pairs: 0, spread: { min: 0, max: 0 } } }
  out.forEach((d, i) => {
    let best: Cand | null = null
    let bestErr = Infinity
    for (const c of cands[i]) {
      const err = Math.abs(c.len - d.inches * mode)
      if (err < bestErr - 0.05 || (Math.abs(err - bestErr) <= 0.05 && best && c.dist < best.dist)) {
        best = c
        bestErr = err
      }
    }
    // Accept when the line's length is the string's value within 1 in at the common ratio.
    if (best && bestErr / mode <= 1 && Math.abs(best.ratio / mode - 1) <= 0.02) {
      d.line = { a: best.a, b: best.b, seg: best.seg, ratio: best.ratio, dist: best.dist }
    }
  })
  const ratios = out.filter((d) => d.line && Math.abs(d.line.ratio / mode - 1) <= 0.01).map((d) => d.line!.ratio).sort((a, b) => a - b)
  const median = ratios.length ? (ratios.length % 2 ? ratios[(ratios.length - 1) / 2] : (ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2) : mode
  return {
    dims: out,
    scale: { ptPerInch: median, pairs: out.filter((d) => d.line).length, spread: { min: ratios[0] ?? median, max: ratios[ratios.length - 1] ?? median } },
  }
}

/** Scale written on the sheet ("Scale: 1/4\"", "1/8\" = 1'-0\"") as pt per real inch, or null. */
export function titleBlockScale(spans: TextSpan[]): { ptPerInch: number; text: string } | null {
  for (const s of spans) {
    const t = normalizeDimText(s.str)
    const m = /scale\s*:?\s*(\d+(?:\s*\/\s*\d+)?)\s*"?\s*(?:=\s*1\s*'\s*-?\s*0?\s*"?)?/i.exec(t)
    if (!m) continue
    const [n, dd] = m[1].split('/').map((x) => Number(x.trim()))
    const paperInPerFoot = dd ? n / dd : n
    if (!(paperInPerFoot > 0 && paperInPerFoot <= 3)) continue
    // paper inches per real foot -> pt per real inch: (paperIn * 72) / 12
    return { ptPerInch: (paperInPerFoot * 72) / 12, text: `${m[1].replace(/\s+/g, '')}" = 1'-0"` }
  }
  return null
}
