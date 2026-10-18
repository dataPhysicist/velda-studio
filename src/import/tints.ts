// Legend tints (05 section 3.7): transparent filled shapes drawn over the plan. The legend says what
// each hue means; each tint in the plan takes the meaning of the legend swatch nearest in hue.
import type { Vec } from '../model/types'
import { type SheetFrame, boxToSheet } from './labels'
import type { Box, Fill, TextSpan } from './types'

export type TintKind = 'demolish' | 'confirm' | 'other'
export type TintRect = { kind: TintKind; rect: Box; color: string; alpha: number }
export type LegendKey = { kind: TintKind; text: string; color: string; hue: number }

const LEGEND: { kind: TintKind; re: RegExp }[] = [
  { kind: 'demolish', re: /\b(TO\s+BE\s+)?(DEMOLISH(ED)?|REMOVED?|DEMO)\b/i },
  { kind: 'confirm', re: /\b(NEEDS?\s+)?(CONFIRM(ING|ATION)?|VERIFY|FIELD\s+VERIFY)\b/i },
]

export function hueOf(hex: string): number {
  const v = Number.parseInt(hex.replace('#', ''), 16)
  const r = ((v >> 16) & 255) / 255
  const g = ((v >> 8) & 255) / 255
  const b = (v & 255) / 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  if (d < 1e-6) return -1 // grey: no hue
  let h: number
  if (mx === r) h = ((g - b) / d) % 6
  else if (mx === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return (h * 60 + 360) % 360
}
const hueDist = (a: number, b: number) => {
  if (a < 0 || b < 0) return a === b ? 0 : 180
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

const dist = (b: Box, p: Vec) => Math.hypot(Math.max(b[0] - p[0], 0, p[0] - b[2]), Math.max(b[1] - p[1], 0, p[1] - b[3]))
const contains = (b: Box, c: Box) => c[0] >= b[0] - 0.5 && c[2] <= b[2] + 0.5 && c[1] >= b[1] - 0.5 && c[3] <= b[3] + 0.5

/**
 * Read the legend keys (text with a transparent swatch within 20 pt) and classify every other
 * transparent fill inside the plan rectangle. Rectangles come back in sheet inches.
 */
export function readTints(fills: Fill[], text: TextSpan[], planRect: Box | null, frame: SheetFrame): { keys: LegendKey[]; tints: TintRect[] } {
  const clear = fills.filter((f) => f.alpha < 0.999)
  const keys: LegendKey[] = []
  const swatches = new Set<Fill>()
  for (const t of text) {
    const hit = LEGEND.find((l) => l.re.test(t.str))
    if (!hit) continue
    const c: Vec = [(t.bbox[0] + t.bbox[2]) / 2, (t.bbox[1] + t.bbox[3]) / 2]
    const sw = clear
      .filter((f) => !planRect || !contains(planRect, f.bbox))
      .map((f) => ({ f, d: dist(f.bbox, c) }))
      .filter((x) => x.d <= 20)
      .sort((a, b) => a.d - b.d)[0]
    if (!sw) continue
    swatches.add(sw.f)
    if (!keys.some((k) => k.kind === hit.kind)) keys.push({ kind: hit.kind, text: t.str.trim(), color: sw.f.color, hue: hueOf(sw.f.color) })
  }
  const tints: TintRect[] = []
  for (const f of clear) {
    if (swatches.has(f)) continue
    if (planRect && !contains(planRect, f.bbox)) continue
    const h = hueOf(f.color)
    let kind: TintKind = 'other'
    let best = 40 // degrees: farther than this from every key is not a legend color
    for (const k of keys) {
      const d = hueDist(h, k.hue)
      if (d < best) {
        best = d
        kind = k.kind
      }
    }
    tints.push({ kind, rect: boxToSheet(frame, f.bbox), color: f.color, alpha: f.alpha })
  }
  return { keys, tints }
}
