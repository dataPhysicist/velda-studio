// Room labels and appliance tags inside the plan (05 section 3.7), and the page-to-sheet frame.
import type { ItemKind, Vec } from '../model/types'
import type { Box, TextSpan } from './types'

/**
 * Sheet frame: real inches from the top-left of the plan raster, x right, y down. Page points map
 * through the drawing scale; raster pixels through the raster's px per real inch.
 */
export type SheetFrame = { x0: number; y0: number; ptPerInch: number }
export const toSheet = (f: SheetFrame, p: Vec): Vec => [(p[0] - f.x0) / f.ptPerInch, (p[1] - f.y0) / f.ptPerInch]
export const boxToSheet = (f: SheetFrame, b: Box): Box => {
  const a = toSheet(f, [b[0], b[1]])
  const c = toSheet(f, [b[2], b[3]])
  return [a[0], a[1], c[0], c[1]]
}

export type PlanLabel = {
  text: string
  /** Center of the label, sheet inches. */
  at: Vec
  kind: 'room' | 'appliance'
  item?: { kind: ItemKind; w: number; d: number; h: number }
}

// Appliance tags drawn as letters in a box. Sizes are defaults until the trace or a person says.
const TAGS: Record<string, { kind: ItemKind; w: number; d: number; h: number }> = {
  W: { kind: 'washer', w: 27, d: 30, h: 38 },
  D: { kind: 'dryer', w: 27, d: 30, h: 38 },
  'W/D': { kind: 'washer', w: 27, d: 30, h: 38 },
  REF: { kind: 'fridge', w: 36, d: 30, h: 70 },
  FRIG: { kind: 'fridge', w: 36, d: 30, h: 70 },
  DW: { kind: 'dishwasher', w: 24, d: 24, h: 34 },
  WH: { kind: 'water_heater', w: 24, d: 24, h: 60 },
  'W.H.': { kind: 'water_heater', w: 24, d: 24, h: 60 },
}

const center = (s: TextSpan): Vec => [(s.bbox[0] + s.bbox[2]) / 2, (s.bbox[1] + s.bbox[3]) / 2]

/**
 * Join labels set on two lines ("JACK & JILL" over "SHOWER"): same direction and size, the second
 * baseline within 1.6 line heights below the first, overlapping horizontally.
 */
export function joinStacked(spans: TextSpan[]): TextSpan[] {
  const sorted = [...spans].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])
  const used = new Set<TextSpan>()
  const out: TextSpan[] = []
  for (const s of sorted) {
    if (used.has(s)) continue
    let cur = s
    used.add(s)
    for (;;) {
      const next = sorted.find(
        (t) =>
          !used.has(t) &&
          Math.abs(t.size - cur.size) < 0.5 &&
          t.dir[0] === cur.dir[0] &&
          t.dir[1] === cur.dir[1] &&
          t.at[1] > cur.at[1] &&
          t.at[1] - cur.at[1] <= cur.size * 1.6 &&
          Math.min(t.bbox[2], cur.bbox[2]) - Math.max(t.bbox[0], cur.bbox[0]) > 0 &&
          !(t.str.trim() in TAGS) &&
          !(cur.str.trim() in TAGS),
      )
      if (!next) break
      used.add(next)
      cur = {
        ...cur,
        str: `${cur.str.trim()} ${next.str.trim()}`,
        at: next.at,
        bbox: [Math.min(cur.bbox[0], next.bbox[0]), Math.min(cur.bbox[1], next.bbox[1]), Math.max(cur.bbox[2], next.bbox[2]), Math.max(cur.bbox[3], next.bbox[3])],
      }
    }
    out.push(cur)
  }
  return out
}

export function readLabels(spans: TextSpan[], frame: SheetFrame): PlanLabel[] {
  return joinStacked(spans).map((s) => {
    const text = s.str.trim().replace(/\s+/g, ' ')
    const tag = TAGS[text]
    return { text, at: toSheet(frame, center(s)), kind: tag ? 'appliance' : 'room', ...(tag ? { item: tag } : {}) }
  })
}

/** "GUEST BATHROOM 2" -> "Guest Bathroom 2", "I.T. CLST" -> "I.T. Clst", "W.I.C." stays. */
export function roomName(label: string): string {
  return label
    .split(' ')
    .map((w) => (/^[A-Z]\.([A-Z]\.?)+$/.test(w) || /^[A-Z]{1,2}$/.test(w) || /\d/.test(w) || w === '&' ? w : w[0] + w.slice(1).toLowerCase()))
    .join(' ')
}
