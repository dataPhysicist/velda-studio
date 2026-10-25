// The PDF sheet set (08 section 3), made in the browser with jsPDF and svg2pdf.js from the same plan
// drawing the share viewer uses: a cover with the provenance legend, assumptions and open items; the
// plan of every level for every scheme at 1/4 in = 1 ft (1/8 in when a level does not fit); a
// demolition plan per level for a proposed scheme; the change log; the schedules; a mood board page
// per room. Every sheet carries the title block and "Design intent. Not for construction."
import { jsPDF } from 'jspdf'
import { svg2pdf } from 'svg2pdf.js'
import { ROLES, finishFor, paletteFor } from '../lib/theme'
import { polygonArea, polygonBounds } from '../model/geom'
import type { Inspiration, Model, Room } from '../model/types'
import { badgeOf } from '../model/types'
import { formatFeetInches } from '../model/units'
import type { Change } from './changes'
import type { CheckLine } from './checklist'
import { BADGE_COLOR, BADGE_WORD, planBounds, planSvg } from './plan-svg'
import { cellText, schedules, type Table } from './schedules'

export const INTENT = 'Design intent. Not for construction. Field verify all dimensions.'

export type SheetScheme = { name: string; version: string; date: string; model: Model; asBuilt: boolean }
export type SheetSetInput = {
  project: { name: string; address?: string }
  /** The schemes to draw, as-built first. */
  schemes: SheetScheme[]
  /** The change log of the proposed scheme against the as-built. */
  changes?: Change[]
  checklist?: CheckLine[]
  /** A picture as a data URL the PDF can embed, or null when it cannot be read (a web picture). */
  picture?: (card: Inspiration) => Promise<string | null>
  size?: 'tabloid' | 'arch-d'
}
export type SheetSetResult = { blob: Blob; sheets: { no: string; title: string }[]; bytes: number }

const PT = 72 // points per inch of paper
const SHORT = { measured: 'measured', traced: 'traced, no string', assumed: 'assumed (default)', velda: 'set by Velda', conflict: 'disagrees with drawing' }
const SCALES = [
  { label: '1/4" = 1\'-0"', k: 0.25 / 12 },
  { label: '1/8" = 1\'-0"', k: 0.125 / 12 },
  { label: '1/16" = 1\'-0"', k: 0.0625 / 12 },
]

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0) as [number, number, number]
}

/** Plain text jsPDF's standard fonts can show. */
const plain = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/·/g, '-')
    .replace(/[^\x20-\x7e -ÿ]/g, '')

export async function buildSheetSet(input: SheetSetInput): Promise<SheetSetResult> {
  const big = input.size === 'arch-d'
  const W = (big ? 36 : 17) * PT
  const H = (big ? 24 : 11) * PT
  const M = 0.5 * PT
  const TB = 0.85 * PT // title block height
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [W, H], compress: true })
  doc.setProperties({ title: `${input.project.name} sheet set`, subject: INTENT, creator: 'Velda Studio' })
  const sheets: { no: string; title: string }[] = []
  let first = true
  const page = (no: string, title: string, scheme: SheetScheme | null, scale?: string) => {
    if (!first) doc.addPage([W, H], 'landscape')
    first = false
    sheets.push({ no, title })
    // Border and title block along the bottom.
    doc.setDrawColor(35, 40, 44)
    doc.setLineWidth(0.8)
    doc.rect(M, M, W - 2 * M, H - 2 * M)
    doc.line(M, H - M - TB, W - M, H - M - TB)
    const y = H - M - TB
    const col = (W - 2 * M) / 4
    for (let i = 1; i < 4; i++) doc.line(M + col * i, y, M + col * i, H - M)
    doc.setTextColor(35, 40, 44)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text(plain(input.project.name), M + 10, y + 20)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    if (input.project.address) doc.text(plain(input.project.address), M + 10, y + 34)
    doc.text('Velda Studio', M + 10, y + TB - 10)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text(plain(title), M + col + 10, y + 20, { maxWidth: col - 20 })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    if (scheme) doc.text(plain(`${scheme.name}${scheme.asBuilt && !/as-built/i.test(scheme.name) ? ' (as-built)' : ''}`), M + col + 10, y + 36, { maxWidth: col - 20 })
    if (scheme) doc.text(plain(`${scheme.version}, ${scheme.date}`), M + col + 10, y + 49, { maxWidth: col - 20 })
    doc.text(scale ? `Scale ${scale} on ${big ? '36 x 24' : '17 x 11'}` : big ? '36 x 24' : '17 x 11', M + 2 * col + 10, y + 20)
    doc.setFont('helvetica', 'bold')
    doc.text(plain(INTENT), M + 2 * col + 10, y + 36, { maxWidth: col - 20 })
    doc.setFontSize(22)
    doc.text(no, W - M - 12, y + TB / 2 + 8, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    return { x: M + 12, y: M + 12, w: W - 2 * M - 24, h: H - 2 * M - TB - 24 }
  }
  const legend = (x: number, y: number, short = false) => {
    doc.setFontSize(8)
    let yy = y
    for (const b of ['measured', 'traced', 'assumed', 'velda', 'conflict'] as const) {
      doc.setFillColor(...hexRgb(BADGE_COLOR[b]))
      doc.rect(x, yy - 6, 7, 7, 'F')
      doc.setTextColor(35, 40, 44)
      doc.text(plain(short ? SHORT[b] : BADGE_WORD[b]), x + 11, yy)
      yy += 11
    }
    return yy
  }

  // 1. Cover.
  {
    const a = page('G-0', 'Cover and notes', null)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(28)
    doc.text(plain(input.project.name), a.x, a.y + 26)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(12)
    let y = a.y + 48
    if (input.project.address) (doc.text(plain(input.project.address), a.x, y), (y += 18))
    doc.setFont('helvetica', 'bold')
    doc.text(plain(INTENT), a.x, y)
    y += 26
    doc.setFontSize(11)
    doc.text('Schemes in this set', a.x, y)
    doc.setFont('helvetica', 'normal')
    y += 15
    for (const s of input.schemes) (doc.text(plain(`${s.name}${s.asBuilt ? ', the house as it is today' : ''}: ${s.version}, ${s.date}`), a.x + 8, y), (y += 14))
    y += 12
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Where each number came from (colors on the plans)', a.x, y)
    doc.setFont('helvetica', 'normal')
    y = legend(a.x + 8, y + 15) + 10
    // Assumptions.
    const m = input.schemes[input.schemes.length - 1].model
    const assumed: string[] = []
    for (const l of m.levels) {
      if (l.prov.ceiling.src === 'default') assumed.push(`${l.name}: ceiling ${formatFeetInches(l.ceiling)} assumed`)
      if (m.levels.length > 1 && l.prov.floorThickness.src === 'default') assumed.push(`${l.name}: floor structure ${formatFeetInches(l.floorThickness)} assumed`)
      const wins = m.openings.filter((o) => o.kind === 'window' && m.walls.find((w) => w.id === o.wall)?.level === l.id && (badgeOf(o.prov.h) === 'assumed' || badgeOf(o.prov.sill) === 'assumed'))
      if (wins.length) assumed.push(`${l.name}: ${wins.length} window${wins.length === 1 ? '' : 's'} with assumed head or sill (default head 7'-0", sill 3'-0")`)
      const traced = m.walls.filter((w) => w.level === l.id && (badgeOf(w.prov.a) === 'traced' || badgeOf(w.prov.b) === 'traced'))
      if (traced.length) assumed.push(`${l.name}: ${traced.length} wall${traced.length === 1 ? '' : 's'} placed from the drawing's lines without a dimension string`)
      const confirm = m.rooms.filter((r) => r.level === l.id && r.flags.includes('needs_confirming'))
      if (confirm.length) assumed.push(`${l.name}: the drawing asks to confirm ${confirm.map((r) => r.name).join(', ')}`)
    }
    const colX = a.x + a.w / 2
    let y2 = a.y + 100
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Assumed values', colX, y2)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    y2 += 14
    for (const t of assumed.length ? assumed : ['None.']) {
      const lines = doc.splitTextToSize(plain(`- ${t}`), a.w / 2 - 10)
      doc.text(lines, colX + 6, y2)
      y2 += lines.length * 11
    }
    y2 += 12
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Open items', colX, y2)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    y2 += 14
    const open = (input.checklist ?? []).filter((l) => !l.ok).flatMap((l) => (l.missing.length ? l.missing.slice(0, 6).map((x) => `${l.text.replace(/\.$/, '')}: ${x}`) : [l.text]))
    const eng = (input.changes ?? []).filter((c) => c.engineer).map((c) => `Engineer: ${c.text}`)
    for (const t of [...open, ...eng].slice(0, 30)) {
      const lines = doc.splitTextToSize(plain(`- ${t}`), a.w / 2 - 10)
      if (y2 + lines.length * 11 > a.y + a.h) break
      doc.text(lines, colX + 6, y2)
      y2 += lines.length * 11
    }
  }

  // 2 and 3. Plans per scheme and level, then demolition plans for the proposed scheme.
  const asBuilt = input.schemes.find((s) => s.asBuilt)?.model ?? null
  let n = 1
  const planPage = async (s: SheetScheme, levelId: string, base: Model | null) => {
    const lv = s.model.levels.find((l) => l.id === levelId)!
    const bb = planBounds(s.model, levelId, 54)
    const fit = (k: number) => (bb.x1 - bb.x0) * k * PT <= W - 2 * M - 24 - 170 && (bb.y1 - bb.y0) * k * PT <= H - 2 * M - TB - 24
    const sc = SCALES.find((x) => fit(x.k)) ?? SCALES[SCALES.length - 1]
    // Room names 7 pt on paper whatever the scale (the other text follows them).
    const d = planSvg(s.model, { level: levelId, base, text: 7 / (sc.k * PT) })
    const title = `${lv.name} ${base ? 'demolition and new work' : 'floor plan'}`
    const a = page(`A-${n++}`, title, s, sc.label)
    const wPt = d.w * sc.k * PT
    const hPt = d.h * sc.k * PT
    const el = new DOMParser().parseFromString(d.svg, 'image/svg+xml').documentElement
    const holder = document.createElement('div')
    holder.style.cssText = 'position:fixed;left:-99999px;top:0;width:10px;height:10px;overflow:hidden'
    holder.appendChild(el)
    document.body.appendChild(holder)
    try {
      await svg2pdf(el, doc, { x: a.x, y: a.y, width: wPt, height: hPt })
    } finally {
      holder.remove()
    }
    // Legend at the right.
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('Dimensions', W - M - 150, a.y + 10)
    doc.setFont('helvetica', 'normal')
    let yy = legend(W - M - 150, a.y + 24, true) + 6
    doc.setFontSize(8)
    doc.setTextColor(120, 128, 133)
    doc.text(doc.splitTextToSize('Grey strings are the drawing\'s own dimensions that still hold. Room sizes are clear, wall face to wall face.', 136), W - M - 150, yy)
    if (base) {
      yy += 40
      doc.setTextColor(154, 59, 46)
      doc.text(doc.splitTextToSize('Red dashed: walls removed. Red outline: new walls. Red arrow: a wall moved, with how far.', 136), W - M - 150, yy)
    }
    doc.setTextColor(35, 40, 44)
  }
  for (const s of input.schemes) for (const lv of s.model.levels) if (s.model.walls.some((w) => w.level === lv.id)) await planPage(s, lv.id, null)
  const proposed = input.schemes.find((s) => !s.asBuilt)
  if (proposed && asBuilt) for (const lv of proposed.model.levels) if (proposed.model.walls.some((w) => w.level === lv.id)) await planPage(proposed, lv.id, asBuilt)

  // Change log.
  if (proposed && input.changes) {
    let a = page(`A-${n++}`, 'Changes from the as-built', proposed)
    let y = a.y + 14
    doc.setFontSize(10)
    for (const c of input.changes.length ? input.changes : [{ text: 'No changes from the as-built.', level: '', kind: 'level', ids: [] } as Change]) {
      const lines = doc.splitTextToSize(plain(`${c.level ? `${c.level}: ` : ''}${c.text}`), a.w)
      if (y + lines.length * 13 > a.y + a.h) {
        a = page(`A-${n++}`, 'Changes from the as-built (continued)', proposed)
        y = a.y + 14
        doc.setFontSize(10)
      }
      doc.setTextColor(...(c.engineer ? ([154, 59, 46] as [number, number, number]) : ([35, 40, 44] as [number, number, number])))
      doc.text(lines, a.x, y)
      y += lines.length * 13 + 3
    }
    doc.setTextColor(35, 40, 44)
  }

  // 4. Schedules, for the last scheme in the set.
  const main = input.schemes[input.schemes.length - 1]
  for (const t of schedules(main.model)) await tablePages(t)
  async function tablePages(t: Table) {
    let a = page(`S-${n++}`, `${t.title} schedule`, main)
    const font = 8
    doc.setFontSize(font)
    // Column widths from content, capped, then scaled to the page.
    const want = t.cols.map((c) => Math.min(220, Math.max(doc.getTextWidth(c.label) + 10, ...t.rows.slice(0, 200).map((r) => doc.getTextWidth(plain(cellText(t, c, r))) + 10))))
    const total = want.reduce((x, y) => x + y, 0)
    const widths = want.map((w) => (w / total) * Math.min(a.w, Math.max(total, a.w * 0.6)))
    const header = (y: number) => {
      doc.setFont('helvetica', 'bold')
      let x = a.x
      t.cols.forEach((c, i) => (doc.text(plain(c.label), x + 2, y), (x += widths[i])))
      doc.setFont('helvetica', 'normal')
      doc.setDrawColor(160, 168, 172)
      doc.line(a.x, y + 4, a.x + widths.reduce((p, q) => p + q, 0), y + 4)
      return y + 14
    }
    let y = header(a.y + 10)
    if (!t.rows.length) doc.text('None.', a.x + 2, y)
    for (const r of t.rows) {
      const cells = t.cols.map((c, i) => doc.splitTextToSize(plain(cellText(t, c, r)), widths[i] - 6) as string[])
      const h = Math.max(1, ...cells.map((c) => c.length)) * (font + 2) + 2
      if (y + h > a.y + a.h) {
        a = page(`S-${n++}`, `${t.title} schedule (continued)`, main)
        doc.setFontSize(font)
        y = header(a.y + 10)
      }
      let x = a.x
      cells.forEach((c, i) => (doc.text(c, x + 2, y), (x += widths[i])))
      y += h
    }
  }

  // 5. Mood boards: a page for each room with a theme of its own or inspiration.
  const rooms = main.model.rooms.filter((r) => r.polygon.length >= 3 && (r.theme || main.model.inspiration.some((c) => c.rooms.includes(r.id))))
  for (const r of rooms) await moodPage(main.model, r)
  async function moodPage(m: Model, r: Room) {
    const a = page(`I-${n++}`, `${r.name} mood board`, main)
    const theme = (r.theme && m.themes[r.theme]) || (m.theme ? m.themes[m.theme] : null)
    const b = polygonBounds(r.polygon)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(18)
    doc.text(plain(r.name), a.x, a.y + 16)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(plain(`${formatFeetInches(b.x1 - b.x0)} x ${formatFeetInches(b.y1 - b.y0)}, ${Math.round(polygonArea(r.polygon) / 144)} sf`), a.x, a.y + 32)
    let y = a.y + 52
    const left = a.w * 0.36
    if (theme) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      doc.text(plain(theme.name), a.x, y)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      y += 14
      if (theme.data.description) {
        const lines = doc.splitTextToSize(plain(theme.data.description), left - 10)
        doc.text(lines, a.x, y)
        y += lines.length * 11 + 6
      }
      const shown = new Set<string>()
      const swatch = (hex: string, role: string, name: string) => {
        doc.setFillColor(...hexRgb(hex))
        doc.setDrawColor(200, 200, 200)
        doc.rect(a.x, y - 9, 22, 14, 'FD')
        doc.text(plain(`${role}: ${name} ${hex}`), a.x + 28, y)
        y += 18
      }
      for (const role of ROLES) {
        const p = paletteFor(theme, role)
        const f = finishFor(theme, role)
        if (!p && !theme.data.finishes?.[role]) continue
        const hex = f.color ?? p?.hex ?? '#dddddd'
        shown.add(`${p?.role}-${p?.hex}`)
        swatch(hex, role, p?.name ?? f.note ?? f.library ?? '')
      }
      for (const p of theme.data.palette ?? []) if (!shown.has(`${p.role}-${p.hex}`) && p !== paletteFor(theme, (p.role ?? '').toLowerCase() as any)) swatch(p.hex, p.role ?? 'color', p.name)
      y += 4
      for (const mt of theme.data.materials ?? []) {
        const lines = doc.splitTextToSize(plain(`${mt.category}: ${mt.choice}`), left - 10)
        if (y + lines.length * 11 > a.y + a.h) break
        doc.text(lines, a.x, y)
        y += lines.length * 11 + 2
      }
      if (theme.data.avoid?.length && y < a.y + a.h - 30) {
        const lines = doc.splitTextToSize(plain(`Avoid: ${theme.data.avoid.join('; ')}`), left - 10)
        doc.setTextColor(120, 128, 133)
        doc.text(lines.slice(0, 6), a.x, y + 6)
        doc.setTextColor(35, 40, 44)
      }
    }
    // Pictures in a grid on the right; a web picture the page cannot read shows its colors and link.
    const cards = m.inspiration.filter((c) => c.rooms.includes(r.id) && c.kind !== 'board').slice(0, 12)
    const gx = a.x + left + 10
    const gw = a.w - left - 10
    const cols = 4
    const cw = gw / cols - 8
    const ch = (a.h - 20) / 3 - 26
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i]
      const x = gx + (i % cols) * (cw + 8)
      const yy = a.y + Math.floor(i / cols) * (ch + 26)
      const data = input.picture ? await input.picture(c).catch(() => null) : null
      if (data) {
        const img = await fitImage(data, cw, ch)
        if (img) doc.addImage(img.url, 'JPEG', x + (cw - img.w) / 2, yy + (ch - img.h) / 2, img.w, img.h)
      } else {
        doc.setDrawColor(210, 214, 216)
        doc.rect(x, yy, cw, ch)
        const sw = (c.tags.palette.length ? c.tags.palette : (c.sampled ?? [])).slice(0, 5)
        sw.forEach((s, k) => (doc.setFillColor(...hexRgb(s.hex)), doc.rect(x + 6 + k * ((cw - 12) / 5), yy + 6, (cw - 12) / 5 - 2, ch * 0.45, 'F')))
        doc.setFontSize(7)
        doc.setTextColor(120, 128, 133)
        doc.text(doc.splitTextToSize('Web picture: open the link to see it.', cw - 12), x + 6, yy + ch * 0.45 + 18)
        doc.setTextColor(35, 40, 44)
      }
      doc.setFontSize(7.5)
      doc.text(doc.splitTextToSize(plain(c.title ?? c.kind), cw).slice(0, 2), x, yy + ch + 10)
      const link = c.url ?? (c.image && /^https?:/.test(c.image) ? c.image : '')
      if (link) {
        doc.setTextColor(46, 107, 98)
        doc.textWithLink(plain(c.source ?? 'link').slice(0, 40), x, yy + ch + 20, { url: link })
        doc.setTextColor(35, 40, 44)
      }
    }
  }

  const blob = doc.output('blob')
  return { blob, sheets, bytes: blob.size }
}

/** A picture scaled into a box as a JPEG data URL (jsPDF takes JPEG and PNG; this also covers WebP). */
async function fitImage(src: string, w: number, h: number): Promise<{ url: string; w: number; h: number } | null> {
  const img = new Image()
  img.src = src
  try {
    await img.decode()
  } catch {
    return null
  }
  const s = Math.min(w / img.naturalWidth, h / img.naturalHeight)
  const cw = Math.max(1, Math.round(img.naturalWidth * s * 2))
  const chh = Math.max(1, Math.round(img.naturalHeight * s * 2))
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = chh
  const g = canvas.getContext('2d')
  if (!g) return null
  g.fillStyle = '#fff'
  g.fillRect(0, 0, cw, chh)
  g.drawImage(img, 0, 0, cw, chh)
  try {
    return { url: canvas.toDataURL('image/jpeg', 0.82), w: img.naturalWidth * s, h: img.naturalHeight * s }
  } catch {
    return null // a picture from another site the page may show but not read
  }
}
