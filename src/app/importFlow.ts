// The plan import as the person goes through it: upload, the page strip (what each page is), one
// Confirm screen per floor plan, then a new scheme. Heavy steps run in workers; this file only
// sequences them and keeps what the screens show.
import { create } from 'zustand'
import { importSheet, readSheet, type SheetImport } from '../import'
import { applyIntake, defaultIntake, type Intake } from '../import/intake'
import { type PdfRead, planJpeg, readPdf, renderPlanRect, traceInWorker } from '../import/pdf-adapter'
import type { TraceResult } from '../import/raster/trace'
import { deriveRooms, updateDimensionStatus } from '../model/derive'
import type { Model, OpeningKind } from '../model/types'
import { createScheme, focusOn, useStudio } from './store'

export type PageChoice = { role: 'asbuilt' | 'proposed' | 'reference' | 'skip'; level: string | null }
type Fix = { kind: 'remove_wall'; id: string } | { kind: 'remove_opening'; id: string } | { kind: 'opening_kind'; id: string; to: OpeningKind }

type St = {
  stage: 'idle' | 'reading' | 'pages' | 'tracing' | 'confirm' | 'saving' | 'error'
  message: string
  read: PdfRead | null
  sheets: ReturnType<typeof readSheet>[]
  choices: PageChoice[]
  queue: number[]
  current: number | null
  trace: TraceResult | null
  jpeg: Uint8Array | null
  rasterUrl: string | null
  result: SheetImport | null
  answers: Intake | null
  ignore: string[]
  fixes: Fix[]
  error: string | null
  made: { scheme: string; sheet: string }[]
}

const initial: St = {
  stage: 'idle',
  message: '',
  read: null,
  sheets: [],
  choices: [],
  queue: [],
  current: null,
  trace: null,
  jpeg: null,
  rasterUrl: null,
  result: null,
  answers: null,
  ignore: [],
  fixes: [],
  error: null,
  made: [],
}

export const useImport = create<St>(() => initial)
const set = useImport.setState
const get = useImport.getState

const fail = (e: unknown) => set({ stage: 'error', error: String((e as Error)?.message || e) })

export function cancelImport() {
  const { rasterUrl } = get()
  if (rasterUrl) URL.revokeObjectURL(rasterUrl)
  set(initial)
}

export async function startImport(file: File) {
  cancelImport()
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
    set({ stage: 'error', error: `${file.name} is not a PDF. Bring in the plan set as a PDF; photos and images of plans come in a later build.` })
    return
  }
  set({ stage: 'reading', message: `Opening ${file.name}` })
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const read = await readPdf(file.name, bytes, (done, total) => set({ message: `Reading page ${done} of ${total}` }))
    const sheets = read.pages.map((p) => readSheet(p))
    const choices: PageChoice[] = sheets.map((s) => ({ role: s.guess.isPlan ? (s.guess.role === 'reference' ? 'asbuilt' : s.guess.role) : 'reference', level: s.guess.level }))
    set({ read, sheets, choices, stage: 'pages', message: '' })
    // One floor plan and nothing to decide: go straight to its Confirm screen.
    if (sheets.length === 1 && sheets[0].guess.isPlan) await confirmPages()
  } catch (e) {
    fail(e)
  }
}

export function setChoice(i: number, c: PageChoice, rebuildNow = false) {
  set({ choices: get().choices.map((x, j) => (j === i ? c : x)) })
  if (rebuildNow && get().current === i) {
    rebuild()
    const r = get().result
    const a = get().answers
    if (r && a) set({ answers: { ...a, ceilings: Object.fromEntries(r.model.levels.map((l) => [l.id, a.ceilings[l.id] ?? Object.values(a.ceilings)[0] ?? 108])) } })
  }
}

/** Floor plans in order: as-builts first (they fix the house frame), then proposed sheets. */
export async function confirmPages() {
  const { choices } = get()
  const plans = choices.map((c, i) => ({ c, i })).filter(({ c }) => c.role === 'asbuilt' || c.role === 'proposed')
  const queue = [...plans.filter((p) => p.c.role === 'asbuilt'), ...plans.filter((p) => p.c.role === 'proposed')].map((p) => p.i)
  if (!queue.length) {
    set({ stage: 'error', error: 'None of the pages is marked as a floor plan. Mark at least one page as a level to bring it in.' })
    return
  }
  set({ queue })
  await nextSheet()
}

async function nextSheet() {
  const { queue, read, sheets, rasterUrl } = get()
  const i = queue[0]
  if (i === undefined || !read) return
  if (rasterUrl) URL.revokeObjectURL(rasterUrl)
  set({ stage: 'tracing', current: i, queue: queue.slice(1), message: 'Reading the plan picture', result: null, trace: null, jpeg: null, rasterUrl: null, ignore: [], fixes: [] })
  try {
    const sheet = sheets[i]
    const page = read.pages[i]
    let trace: TraceResult | null = null
    let jpeg: Uint8Array | null = null
    if (sheet.guess.plan && sheet.pxPerInch) {
      jpeg = planJpeg(read, sheet.guess.plan)
      const input = jpeg ? { jpeg } : { gray: await renderPlanRect(read, page.page, sheet.guess.plan) }
      trace = await traceInWorker(input, sheet.pxPerInch, (p) => set({ message: p.stage }))
    }
    set({ trace, jpeg, rasterUrl: jpeg ? URL.createObjectURL(new Blob([jpeg.slice()], { type: 'image/jpeg' })) : null })
    rebuild()
    const result = get().result!
    set({ stage: 'confirm', answers: defaultIntake(result.model.levels), message: '' })
  } catch (e) {
    fail(e)
  }
}

/** Run the import for the current page again with the person's overrules and fixes. */
export function rebuild() {
  const { read, current, trace, choices, ignore, fixes } = get()
  if (!read || current === null) return
  const c = choices[current]
  const result = importSheet(read.pages[current], trace, {
    file: read.name,
    level: c.level ?? undefined,
    role: c.role === 'proposed' ? 'proposed' : 'asbuilt',
    ignoreDims: ignore,
  })
  if (fixes.length) result.model = applyFixes(result.model, fixes)
  set({ result })
}

function applyFixes(input: Model, fixes: Fix[]): Model {
  let m = structuredClone(input)
  for (const f of fixes) {
    if (f.kind === 'remove_wall') {
      m.walls = m.walls.filter((w) => w.id !== f.id)
      m.openings = m.openings.filter((o) => o.wall !== f.id)
    } else if (f.kind === 'remove_opening') m.openings = m.openings.filter((o) => o.id !== f.id)
    else {
      const o = m.openings.find((x) => x.id === f.id)
      if (!o) continue
      o.kind = f.to
      if (f.to === 'window') {
        o.style = 'double_hung'
        o.sill = 36
        o.h = 84
        o.swing = undefined
        o.prov = { ...o.prov, sill: { src: 'default' }, h: { src: 'default' } }
      } else {
        o.style = f.to === 'opening' ? 'cased' : 'swing'
        o.sill = undefined
        o.h = 80
        if (f.to === 'door' && !o.swing) {
          o.swing = { hinge: 'a', side: 'left' }
          o.prov.swing = { src: 'default' }
        }
        if (f.to === 'opening') o.swing = undefined
      }
    }
  }
  m = deriveRooms(m)
  updateDimensionStatus(m)
  return m
}

export function fix(f: Fix) {
  set({ fixes: [...get().fixes, f] })
  rebuild()
}

export function overrule(dimId: string, useTraced: boolean) {
  const { ignore } = get()
  set({ ignore: useTraced ? [...new Set([...ignore, dimId])] : ignore.filter((x) => x !== dimId) })
  rebuild()
}

export function setAnswers(patch: Partial<Intake>) {
  const a = get().answers
  if (a) set({ answers: { ...a, ...patch } })
}

export async function approve() {
  const { result, answers, read, jpeg, current, made, trace } = get()
  const { repo } = useStudio.getState()
  if (!result || !answers || !read || current === null || !repo) return
  set({ stage: 'saving', message: 'Building your house' })
  try {
    const model = applyIntake(result.model, answers)
    const sheet = model.sheets[0]
    const stamp = Date.now().toString(36)
    const pdfId = `pdf_${stamp}`
    await repo.saveBlob({ id: pdfId, kind: 'pdf', name: read.name, size: read.bytes.length, meta: { pages: read.pages.length } }, read.bytes)
    sheet.file = `blob:${pdfId}`
    if (jpeg) {
      const rasterId = `plan_${sheet.id.toLowerCase()}_${stamp}`
      await repo.saveBlob({ id: rasterId, kind: 'plan', name: `${sheet.id} plan`, size: jpeg.length, meta: { px: sheet.raster.px, pxPerInch: trace?.pxPerInch } }, jpeg)
      sheet.raster.blobId = rasterId
    }
    const g = result.guess
    const summary = `Imported from ${sheet.id}${g.issue ? ` (${g.issue})` : ''}`
    const name = sheet.role === 'proposed' ? `Proposed ${model.levels[0].name}` : 'As-built'
    const { scheme } = await createScheme({ name, role: sheet.role === 'proposed' ? 'proposed' : 'asbuilt', model, summary, author: 'import', source: 'import' })
    // The studio opens on the plan of the new level, with the drawing underneath (06 section 8).
    focusOn({ view: 'plan', levelId: model.levels[0]?.id ?? null, roomId: null })
    set({ made: [...made, { scheme: scheme.name, sheet: sheet.id }] })
    if (get().queue.length) await nextSheet()
    else {
      const { rasterUrl } = get()
      if (rasterUrl) URL.revokeObjectURL(rasterUrl)
      set({ ...initial, made: get().made })
    }
  } catch (e) {
    fail(e)
  }
}
