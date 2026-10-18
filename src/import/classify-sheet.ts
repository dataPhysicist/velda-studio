// What a sheet is, from its text (05 section 3.2): sheet number, title, level, as-built or proposed,
// scale, whether it is a floor plan at all, and the title block facts (firm, issue, client).
// A proposal only: the Confirm screen shows it and the person can change it.
import { parseDimension, titleBlockScale } from './dims'
import type { Box, ImagePaint, PageData, TextSpan } from './types'

export type SheetRole = 'asbuilt' | 'proposed' | 'reference'
export type Tier = 'A' | 'B' | 'C'

export type SheetGuess = {
  number: string | null // "A2"
  title: string // "AS BUILT LEVEL 2 FLOOR PLAN"
  level: string | null // "L2"
  levelName: string | null // "Level 2"
  role: SheetRole
  isPlan: boolean
  scaleText: { ptPerInch: number; text: string } | null
  firm: string | null
  issue: string | null
  client: string | null
  drawnBy: string | null
  tier: Tier
  /** The plan raster painted on the page (tiers A and C). */
  plan: ImagePaint | null
}

const WORDS = ['ONE', 'TWO', 'THREE', 'FOUR']
const ORD = ['FIRST', 'SECOND', 'THIRD', 'FOURTH']

/** Level id and name from free text: LEVEL 2, SECOND FLOOR, 2ND FLOOR, BASEMENT, L1. */
export function levelFrom(text: string): { id: string; name: string } | null {
  const t = text.toUpperCase()
  if (/\bBASEMENT\b/.test(t)) return { id: 'B1', name: 'Basement' }
  let m = /\bLEVEL\s*(\d+|ONE|TWO|THREE|FOUR)\b/.exec(t)
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORDS.indexOf(m[1]) + 1
    return { id: `L${n}`, name: `Level ${n}` }
  }
  m = /\b(FIRST|SECOND|THIRD|FOURTH|1ST|2ND|3RD|4TH)\s+FLOOR\b/.exec(t)
  if (m) {
    const n = ORD.includes(m[1]) ? ORD.indexOf(m[1]) + 1 : Number(m[1][0])
    return { id: `L${n}`, name: `Level ${n}` }
  }
  m = /\bL([1-4])\b/.exec(t)
  if (m) return { id: `L${m[1]}`, name: `Level ${m[1]}` }
  return null
}

const inside = (b: Box, r: Box, pad = 0) => b[0] >= r[0] - pad && b[2] <= r[2] + pad && b[1] >= r[1] - pad && b[3] <= r[3] + pad
const area = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])

/** Spans in reading order (top to bottom, then left to right). */
const reading = (spans: TextSpan[]) => [...spans].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])

/** The span right below one whose text matches `label` (title block "ISSUE" / "7.2.26"). */
function valueUnder(spans: TextSpan[], label: RegExp): string | null {
  const l = spans.find((s) => label.test(s.str.trim()))
  if (!l) return null
  const below = spans
    .filter((s) => s !== l && s.bbox[1] >= l.bbox[1] && s.bbox[1] - l.bbox[3] < l.size * 2 && Math.abs(s.bbox[0] - l.bbox[0]) < l.size * 2)
    .sort((a, b) => a.bbox[1] - b.bbox[1])
  return below[0]?.str.trim() ?? null
}

export function classifySheet(page: PageData, dimsParsed: number): SheetGuess {
  const spans = page.text
  // The plan raster: the largest picture (not a soft mask) covering a good part of the page.
  const pics = page.images.filter((i) => !i.mask).sort((a, b) => area(b.rect) - area(a.rect))
  const pageArea = page.size[0] * page.size[1]
  const plan = pics[0] && area(pics[0].rect) > pageArea * 0.15 ? pics[0] : null
  const inPlan = (s: TextSpan) => !!plan && inside(s.bbox, plan.rect, 2)
  const outside = spans.filter((s) => !inPlan(s))

  // Sheet number: the biggest short code like A2, A-2, A 2, A2.1
  const nums = outside
    .filter((s) => /^[A-Z]{1,2}\s?[-.]?\s?\d{1,2}(\.\d+)?$/.test(s.str.trim()))
    .sort((a, b) => b.size - a.size)
  const number = nums[0] ? nums[0].str.trim().replace(/[\s-]/g, '').replace(/^([A-Z]+)\.(\d)/, '$1$2') : null

  // Title: the large lines of the title block (not the number), in reading order.
  const big = outside.filter((s) => s !== nums[0] && s.size >= 16 && /[A-Z]{3}/.test(s.str))
  const maxSize = Math.max(0, ...big.map((s) => s.size))
  const titleSpans = reading(big.filter((s) => s.size >= maxSize * 0.8))
  let title = titleSpans.map((s) => s.str.trim()).join(' ')
  // Fall back to the drawing title under the plan ("A.2 AS-BUILT- LEVEL 2").
  const drawingTitle = outside.find((s) => /PLAN|LEVEL|FLOOR|AS[- ]?BUILT|EXISTING|PROPOSED/i.test(s.str) && s.size < 16)
  if (!title && drawingTitle) title = drawingTitle.str.trim()
  const all = `${title} ${outside.map((s) => s.str).join(' ')}`.toUpperCase()

  const lv = levelFrom(title) ?? levelFrom(all)
  const role: SheetRole = /AS[\s-]*BUILT|EXISTING|DEMO/.test(title.toUpperCase() || all)
    ? 'asbuilt'
    : /PROPOSED|\bNEW\b|OPTION/.test(title.toUpperCase() || all)
      ? 'proposed'
      : /AS[\s-]*BUILT|EXISTING/.test(all)
        ? 'asbuilt'
        : 'proposed'
  const notPlan = /ELEVATION|SECTION|ROOF PLAN|ELECTRICAL|FOUNDATION|SITE PLAN|DETAIL|FRAMING/.test(title.toUpperCase())
  const isPlan = !notPlan && (/PLAN|LEVEL|FLOOR/.test(title.toUpperCase()) || !!plan) && dimsParsed >= 3

  // Firm: the line above an address, P.O. box, phone or web address.
  const ordered = reading(outside)
  let firm: string | null = null
  for (let i = 1; i < ordered.length; i++) {
    if (/P\.?\s?O\.?\s+BOX|www\.|\(\d{3}\)|\d{3}[-.]\d{3}[-.]\d{4}/i.test(ordered[i].str)) {
      const prev = ordered[i - 1]
      if (/[A-Za-z]{3}/.test(prev.str) && !/www\./i.test(prev.str)) {
        firm = prev.str.trim()
        break
      }
    }
  }

  const vectorSegsInPlan = plan ? 0 : page.segs.length
  const tier: Tier = plan ? (dimsParsed >= 10 ? 'A' : 'C') : vectorSegsInPlan > 200 ? 'B' : 'C'

  return {
    number,
    title,
    level: lv?.id ?? null,
    levelName: lv?.name ?? null,
    role: isPlan ? role : 'reference',
    isPlan,
    scaleText: titleBlockScale(spans),
    firm,
    issue: valueUnder(outside, /^ISSUE$/i),
    client: valueUnder(outside, /^CLIENT$/i),
    drawnBy: valueUnder(outside, /^DRAWN\s+BY$/i),
    tier,
    plan,
  }
}

/** Uppercase text inside the plan that is not a dimension: room labels and appliance tags. */
export function planLabels(page: PageData, planRect: Box): TextSpan[] {
  return page.text.filter((s) => inside(s.bbox, planRect, 2) && parseDimension(s.str) === null && /[A-Z]/.test(s.str) && s.str === s.str.toUpperCase())
}
