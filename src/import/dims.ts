// Dimension strings as drawn on a plan sheet: 19'-8", 8'-1/4", 3'-9 3/4", 2'-0", 12", 1/2".
// Pure functions, no pdf.js: the adapter hands text spans in, these turn them into inches.
// See docs: 05-plan-import-spec section 3.3.

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

/** Feet and inches for display, to the nearest 1/8 in: 236 -> 19'-8", 96.25 -> 8'-0 1/4". */
export function formatFeetInches(inches: number): string {
  const sign = inches < 0 ? '-' : ''
  let eighths = Math.round(Math.abs(inches) * 8)
  const ft = Math.floor(eighths / 96)
  eighths -= ft * 96
  const whole = Math.floor(eighths / 8)
  let rem = eighths - whole * 8
  let fracText = ''
  if (rem) {
    let den = 8
    while (rem % 2 === 0) {
      rem /= 2
      den /= 2
    }
    fracText = ` ${rem}/${den}`
  }
  return `${sign}${ft}'-${whole}${fracText}"`
}
