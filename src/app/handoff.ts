// Export and Share (08): the package a designer or contractor gets, and read-only share links.
// Everything is made here in the browser from the model; links point at a file in Velda storage.
import JSZip from 'jszip'
import { changeLog, changesCsv, changesMd } from '../export/changes'
import { type CheckLine, checklist, checklistMd } from '../export/checklist'
import { toDxf } from '../export/dxf'
import { buildSheetSet, INTENT } from '../export/pdf-sheets'
import { schedules, toCsv } from '../export/schedules'
import { viewerHtml } from '../export/viewer-html'
import type { Inspiration, Model } from '../model/types'
import type { Scheme, Version } from '../repo'
import type { ViewerData, ViewerScheme } from '../viewer/data'
import { useStudio } from './store'

const get = useStudio.getState
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'scheme'
const today = () => new Date().toISOString().slice(0, 10)

export type PartKey = 'sheets' | 'dxf' | 'json' | 'glb' | 'schedules' | 'changes' | 'inspiration'
export const PARTS: { key: PartKey; label: string; note: string }[] = [
  { key: 'sheets', label: 'PDF sheet set', note: 'cover, plans, demolition, changes, schedules, mood boards' },
  { key: 'dxf', label: 'DXF for CAD', note: 'R12, inches, one file per scheme' },
  { key: 'json', label: 'Model data', note: 'every wall, opening and fixture in decimal inches, a .json file for other software' },
  { key: 'glb', label: '3D model (GLB)', note: 'meters, y up, each piece named' },
  { key: 'schedules', label: 'Schedules (CSV)', note: 'rooms, doors, windows, fixtures' },
  { key: 'changes', label: 'Change log', note: 'against the as-built, in sentences' },
  { key: 'inspiration', label: 'Inspiration', note: 'stored pictures and a list with links' },
]

export type Context = {
  scheme: Scheme
  version: Version | null
  model: Model
  asBuilt: { scheme: Scheme; model: Model } | null
  isAsBuilt: boolean
  checklist: CheckLine[]
}

/** The as-built this scheme was drawn from: of the as-built schemes, the one sharing the most walls. */
export async function asBuiltFor(model: Model): Promise<{ scheme: Scheme; model: Model } | null> {
  const { repo, schemes } = get()
  if (!repo) return null
  const ids = new Set(model.walls.map((w) => w.id))
  let best: { scheme: Scheme; model: Model; n: number } | null = null
  for (const s of schemes.filter((x) => x.role === 'asbuilt' && x.head_version)) {
    const m = (await repo.model(s.head_version!).catch(() => null)) as Model | null
    if (!m || (m as any).v !== 2) continue
    const n = m.walls.filter((w) => ids.has(w.id)).length
    if (!best || n > best.n) best = { scheme: s, model: m, n }
  }
  return best && best.n > 0 ? { scheme: best.scheme, model: best.model } : null
}

/** What the Export and Share dialogs need about the open scheme. */
export async function context(): Promise<Context | null> {
  const { repo, schemes, schemeId, model, versions, headId, setAside } = get()
  const scheme = schemes.find((s) => s.id === schemeId)
  if (!repo || !scheme || !model) return null
  const isAsBuilt = scheme.role === 'asbuilt'
  const asBuilt = isAsBuilt ? { scheme, model } : await asBuiltFor(model)
  // Changes to the as-built after it was imported, other than recorded field measurements and notes.
  const abVersions = asBuilt ? await repo.versions(asBuilt.scheme.id).catch(() => [] as Version[]) : []
  const edits = abVersions.filter((v) => v.seq > 1 && !/^(field|migration)$/.test(v.source) && v.author !== 'migration' && !/inspiration|note|field/i.test(v.summary)).map((v) => v.summary)
  const aside = new Set([...setAside.acked, ...setAside.dismissed])
  return {
    scheme,
    version: versions.find((v) => v.id === headId) ?? null,
    model,
    asBuilt,
    isAsBuilt,
    checklist: checklist({ model, asBuilt: asBuilt?.model ?? null, aside, asBuiltEdits: edits, isAsBuilt }),
  }
}

/** A stored picture as a data URL the PDF and the share page can embed; null for a web picture. */
export async function readable(card: Inspiration, max = 900, quality = 0.82): Promise<string | null> {
  const sdk = get().sdk
  const path = card.image && !/^https?:|^data:|^blob:/.test(card.image) ? card.image : card.thumb && !/^https?:/.test(card.thumb) ? card.thumb : null
  if (!path) return null
  const src = sdk ? await sdk.readImage(path).catch(() => null) : null
  if (!src) return null
  return shrink(src, max, quality)
}

async function shrink(src: string, max: number, quality: number): Promise<string | null> {
  const img = new Image()
  img.src = src
  try {
    await img.decode()
  } catch {
    return null
  }
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(img.naturalWidth * s))
  c.height = Math.max(1, Math.round(img.naturalHeight * s))
  const g = c.getContext('2d')
  if (!g) return null
  g.fillStyle = '#fff'
  g.fillRect(0, 0, c.width, c.height)
  g.drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', quality)
}

const dataUrlBlob = (u: string) => {
  const [head, b64] = u.split(',')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream' })
}

export type Built = { path: string; blob: Blob }

/** Every selected part, as files with their paths in the package. */
export async function buildParts(c: Context, sel: Set<PartKey>, opts: { size?: 'tabloid' | 'arch-d'; progress?: (t: string) => void } = {}): Promise<Built[]> {
  const out: Built[] = []
  const say = opts.progress ?? (() => {})
  const project = { name: c.model.project.name, address: c.model.project.address }
  const versionLabel = c.version?.label ?? (c.version ? `v${c.version.seq} ${c.version.summary}` : 'current')
  const date = (c.version?.created_at ?? new Date().toISOString()).slice(0, 10)
  const log = c.asBuilt && !c.isAsBuilt ? changeLog(c.asBuilt.model, c.model) : null
  const schemesForSheets = [
    ...(c.asBuilt && !c.isAsBuilt ? [{ name: c.asBuilt.scheme.name, version: 'head', date, model: c.asBuilt.model, asBuilt: true }] : []),
    { name: c.scheme.name, version: versionLabel, date, model: c.model, asBuilt: c.isAsBuilt },
  ]
  if (sel.has('sheets')) {
    say('Drawing the sheet set')
    const r = await buildSheetSet({ project, schemes: schemesForSheets, changes: log ?? undefined, checklist: c.checklist, picture: (card) => readable(card), size: opts.size })
    out.push({ path: `${slug(project.name)}-${slug(c.scheme.name)}-sheets.pdf`, blob: r.blob })
  }
  if (sel.has('dxf')) {
    say('Writing the DXF files')
    for (const s of schemesForSheets) out.push({ path: `dxf/${slug(s.name)}.dxf`, blob: new Blob([toDxf(s.model, { scheme: s.name, version: s.version, date })], { type: 'application/dxf' }) })
  }
  if (sel.has('json')) {
    out.push({ path: 'model.json', blob: new Blob([JSON.stringify(c.model, null, 1)], { type: 'application/json' }) })
    if (c.asBuilt && !c.isAsBuilt) out.push({ path: 'as-built.json', blob: new Blob([JSON.stringify(c.asBuilt.model, null, 1)], { type: 'application/json' }) })
    // What every field means and its type (08 section 5), for the software that reads model.json.
    const { default: schema } = await import('../../schema/model-v2.schema.json')
    out.push({ path: 'model-v2.schema.json', blob: new Blob([JSON.stringify(schema, null, 1)], { type: 'application/schema+json' }) })
  }
  if (sel.has('glb')) {
    say('Building the 3D model')
    const { toGlb } = await import('../export/glb')
    out.push({ path: 'model.glb', blob: new Blob([await toGlb(c.model)], { type: 'model/gltf-binary' }) })
  }
  if (sel.has('schedules')) for (const t of schedules(c.model)) out.push({ path: `schedules/${t.name}.csv`, blob: new Blob([toCsv(t)], { type: 'text/csv' }) })
  if (sel.has('changes') && log) {
    out.push({ path: 'changes.md', blob: new Blob([changesMd(c.asBuilt!.scheme.name, c.scheme.name, log)], { type: 'text/markdown' }) })
    out.push({ path: 'changes.csv', blob: new Blob([changesCsv(log)], { type: 'text/csv' }) })
  }
  if (sel.has('inspiration')) {
    say('Collecting the inspiration')
    const lines = [`# Inspiration for ${c.scheme.name}`, '']
    let k = 0
    for (const card of c.model.inspiration) {
      const rooms = card.rooms.map((id) => c.model.rooms.find((r) => r.id === id)?.name).filter(Boolean).join(', ')
      const data = card.kind !== 'board' ? await readable(card, 1600, 0.88) : null
      const file = data ? `inspiration/${String(++k).padStart(2, '0')}-${slug(card.title ?? card.kind)}.jpg` : null
      if (data && file) out.push({ path: file, blob: dataUrlBlob(data) })
      const link = card.url ?? (card.image && /^https?:/.test(card.image) ? card.image : '')
      const colors = (card.tags.palette.length ? card.tags.palette : (card.sampled ?? [])).map((p) => p.hex).join(' ')
      lines.push(`- **${card.title ?? card.kind}**${rooms ? ` (${rooms})` : ''}${file ? `: ${file.replace('inspiration/', '')}` : ''}${link ? ` [${card.source ?? 'link'}](${link})` : ''}${colors ? `; colors ${colors}` : ''}`)
    }
    if (!c.model.inspiration.length) lines.push('No inspiration yet.')
    out.push({ path: 'inspiration/index.md', blob: new Blob([lines.join('\n') + '\n'], { type: 'text/markdown' }) })
  }
  // README with what is inside and the handoff checklist.
  const readme = [
    `# ${project.name}${project.address ? `, ${project.address}` : ''}`,
    '',
    `Scheme: ${c.scheme.name}${c.isAsBuilt ? ' (as-built)' : ''}, ${versionLabel}, ${date}${c.asBuilt && !c.isAsBuilt ? `. Compared with ${c.asBuilt.scheme.name}.` : '.'}`,
    '',
    `**${INTENT}**`,
    '',
    '## What is inside',
    '',
    ...out.map((f) => `- ${f.path} (${size(f.blob.size)})`),
    '',
    '## Handoff checklist',
    '',
    checklistMd(c.checklist),
    '',
    'Made with Velda Studio. Sizes are in feet and inches on the sheets and in decimal inches in the data files.',
    '',
  ].join('\n')
  out.unshift({ path: 'README.md', blob: new Blob([readme], { type: 'text/markdown' }) })
  return out
}

export function size(n: number) {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`
}

export async function zipParts(c: Context, files: Built[]): Promise<{ name: string; blob: Blob }> {
  const zip = new JSZip()
  for (const f of files) zip.file(f.path, f.blob)
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  return { name: `${slug(c.model.project.name)}-${slug(c.scheme.name)}-${today()}.zip`, blob }
}

// ------------------------------------------------------------------ share links

export type ShareRecord = { id: string; path: string; url: string; schemes: string[]; names: string[]; created: string; expires: string; bytes: number; comments?: boolean; stopped?: boolean }

/** dist/viewer.js next to the studio bundle (jsDelivr at the release commit). */
export function viewerUrl(): string {
  if (import.meta.env.DEV) return `${location.origin}/dist/viewer.js`
  return new URL('./viewer.js', import.meta.url).href
}

export async function shares(): Promise<ShareRecord[]> {
  const raw = await get().repo?.setting('shares').catch(() => null)
  try {
    return JSON.parse(raw ?? '[]')
  } catch {
    return []
  }
}

async function saveShares(list: ShareRecord[]) {
  await get().repo?.setSetting('shares', JSON.stringify(list))
}

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** The share page for these schemes (the as-built goes with a proposed scheme so the reader sees the change). */
export async function sharePage(c: Context, opts: { comments?: boolean } = {}): Promise<{ html: string; data: ViewerData }> {
  const repo = get().repo!
  const list = [...(c.asBuilt && !c.isAsBuilt ? [c.asBuilt] : []), { scheme: c.scheme, model: c.model }]
  const schemes: ViewerScheme[] = []
  const thumbs: Record<string, string> = {}
  for (const s of list) {
    const comments = opts.comments === false ? [] : await repo.comments(s.scheme.id).catch(() => [])
    const replies = await repo.replies(comments.map((x) => x.id)).catch(() => [])
    schemes.push({
      id: s.scheme.id,
      name: s.scheme.name,
      version: s.scheme.id === c.scheme.id ? (c.version?.label ?? 'current') : 'head',
      date: today(),
      asBuilt: s.scheme.role === 'asbuilt',
      model: s.model,
      comments: comments.map((x) => ({ ...x, replies: replies.filter((r) => r.comment_id === x.id).map(({ comment_id, ...r }) => r) })),
    })
    // Small thumbnails (under 40 KB each) of the stored pictures; web pictures go as their colors and links.
    for (const card of s.model.inspiration.filter((x) => x.kind !== 'board').slice(0, 24))
      if (!thumbs[card.id]) {
        const t = await readable(card, 360, 0.7)
        if (t && t.length < 54000) thumbs[card.id] = t
      }
  }
  const data: ViewerData = { v: 1, project: { name: c.model.project.name, address: c.model.project.address }, created: new Date().toISOString(), intent: INTENT, schemes, thumbs }
  return { html: viewerHtml(data, { viewerUrl: viewerUrl() }), data }
}

/** Make (or update) a share link: the page goes to Velda storage and the link is signed for `days`. */
export async function share(c: Context, days: number, existing?: ShareRecord, opts: { comments?: boolean } = {}): Promise<ShareRecord> {
  const sdk = get().sdk
  if (!sdk) throw new Error('Sharing needs Toolbelt')
  const comments = opts.comments ?? existing?.comments ?? true
  const { html } = await sharePage(c, { comments })
  const id = existing?.id ?? `sh${Date.now().toString(36)}`
  const path = existing?.path ?? `velda-studio/shares/${id}.html`
  await sdk.upload(path, b64(html), 'text/html')
  let url = existing?.url ?? ''
  const expiresIn = Math.round(days * 86400)
  if (!existing) {
    const r = await sdk.runToolParsed('manage_shared_artifacts', { action: 'create_link', fileName: path, expiresIn }).catch(() => null)
    url = typeof r?.url === 'string' ? r.url : await sdk.signedUrl(path, expiresIn)
  }
  const rec: ShareRecord = {
    id,
    path,
    url,
    schemes: [...(c.asBuilt && !c.isAsBuilt ? [c.asBuilt.scheme.id] : []), c.scheme.id],
    names: [...(c.asBuilt && !c.isAsBuilt ? [c.asBuilt.scheme.name] : []), c.scheme.name],
    created: existing?.created ?? new Date().toISOString(),
    expires: existing?.expires ?? new Date(Date.now() + expiresIn * 1000).toISOString(),
    bytes: new TextEncoder().encode(html).length,
    comments,
  }
  const all = (await shares()).filter((x) => x.id !== id)
  await saveShares([rec, ...all])
  return rec
}

/** Stop a link: the file behind it is removed (or, if that is refused, replaced with a short notice). */
export async function stopShare(rec: ShareRecord): Promise<void> {
  const sdk = get().sdk
  if (!sdk) return
  const removed = await sdk
    .runToolParsed('delete_storage_file', { fileName: rec.path })
    .then((r: any) => r?.success !== false)
    .catch(() => false)
  if (!removed) await sdk.upload(rec.path, b64('<!doctype html><meta charset="utf-8"><title>Link turned off</title><p style="font:16px sans-serif;padding:40px">This share link was turned off.</p>'), 'text/html')
  await saveShares((await shares()).map((x) => (x.id === rec.id ? { ...x, stopped: true } : x)))
}
