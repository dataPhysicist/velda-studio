// Turning a drop or a link into inspiration cards (07 section 6). The page does what it can itself:
// pictures you drop are stored under velda-studio/inspiration/ and their colors measured here;
// Pinterest pins and boards come from Pinterest's public widget endpoints. Velda then looks at the
// pictures (a contact sheet per 8) and tags them: title, style, materials, fixtures, and a palette
// picked from the measured colors, never guessed. Pictures the page cannot read (pins, products) are
// measured in Velda's code sandbox with the same quantizer.
import { DEEP_MODEL, firstJson } from '../lib/agent'
import { newId } from '../model/ops'
import type { Inspiration } from '../model/types'
import type { ToolbeltSDK } from '../toolbelt'
import { type Swatch, paletteOfBlob, remotePaletteScript } from './palette'
import { classifyLink, readPinterest } from './pinterest'

export type Source = { file: File } | { url: string } | { path: string; name?: string; blob?: Blob | null }
export type IngestDeps = {
  sdk: ToolbeltSDK | null
  /** Store a picture in Velda storage (base64), as the page's upload does. */
  upload: (path: string, blob: Blob) => Promise<void>
  progress: (text: string) => void
  /** Pinterest's widget endpoints (the page's fetch; a stand-in in tests). */
  getJson?: (url: string) => Promise<any>
  now?: () => string
}
export type IngestResult = { entries: Inspiration[]; said: string[] }

const empty = (): Inspiration['tags'] => ({ style: [], palette: [], materials: [], fixtures: [] })
const nameOf = (file: string) => file.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Picture'

/** Read every source into cards (not yet tagged), then have Velda tag them. */
export async function ingest(sources: Source[], rooms: string[], deps: IngestDeps): Promise<IngestResult> {
  const now = deps.now ?? (() => new Date().toISOString())
  const entries: Inspiration[] = []
  const said: string[] = []
  const pinColor = new Map<string, string>() // Pinterest's own dominant color, used only if the picture cannot be measured
  const base = (kind: Inspiration['kind'], extra: Partial<Inspiration>): Inspiration => ({ id: newId('insp'), kind, tags: empty(), rooms, addedBy: 'user', createdAt: now(), ...extra })
  let n = 0
  for (const src of sources) {
    n++
    if ('file' in src) {
      deps.progress(`Saving picture ${n} of ${sources.length}`)
      const blob = await shrink(src.file, 1600)
      const e = base('image', { title: nameOf(src.file.name), source: 'your picture' })
      e.image = `velda-studio/inspiration/${e.id}.jpg`
      await deps.upload(e.image, blob)
      e.sampled = await paletteOfBlob(blob).catch(() => [])
      entries.push(e)
    } else if ('path' in src) {
      const e = base('image', { image: src.path, title: nameOf(src.name ?? src.path.split('/').pop() ?? 'Picture'), source: 'your picture' })
      if (src.blob) e.sampled = await paletteOfBlob(src.blob).catch(() => [])
      entries.push(e)
    } else {
      const link = classifyLink(src.url)
      if (link.kind === 'pin' || link.kind === 'board') {
        deps.progress(link.kind === 'pin' ? 'Reading the pin from Pinterest' : 'Reading the board from Pinterest')
        try {
          const got = await readPinterest(link, deps.getJson)
          let parent: string | undefined
          if (got.board) {
            const b = base('board', { url: got.board.url, title: got.board.name, source: 'pinterest.com', image: got.pins[0]?.image, thumb: got.pins[0]?.thumb })
            parent = b.id
            entries.push(b)
            if (got.pins.length < 5)
              said.push(`Pinterest gave me only ${got.pins.length} picture${got.pins.length === 1 ? '' : 's'} from "${got.board.name}". The board may be private, or load more as you scroll; paste single pins or drop screenshots for the rest.`)
            else if (got.board.count > got.board.returned) said.push(`"${got.board.name}" has ${got.board.count} pins; Pinterest shares the first ${got.board.returned}.`)
          }
          for (const p of got.pins) {
            const e = base('pin', { url: p.url, image: p.image, thumb: p.thumb, title: p.title, source: p.source, ...(parent ? { parent } : {}) })
            if (p.color) pinColor.set(e.id, p.color)
            entries.push(e)
          }
        } catch (err) {
          said.push(`${(err as Error).message}.`)
        }
      } else if (link.kind === 'pin_short') {
        said.push(`Short pin.it links need opening in Pinterest first; paste the pin's full link (pinterest.com/pin/...) instead.`)
      } else {
        // Any other page: Velda reads it (largest picture and title, or the product's details).
        entries.push(base('url', { url: link.url, source: hostOf(link.url), title: hostOf(link.url) }))
      }
    }
  }
  const pictures = entries.filter((e) => e.kind !== 'board')
  if (pictures.length && deps.sdk) {
    for (let i = 0; i < pictures.length; i += 8) {
      const batch = pictures.slice(i, i + 8)
      deps.progress(`Velda is looking at ${pictures.length === 1 ? 'the picture' : `pictures ${i + 1} to ${i + batch.length} of ${pictures.length}`}`)
      try {
        const raw = await deps.sdk.ask(tagPrompt(batch), DEEP_MODEL, 240)
        applyTags(batch, firstJson(raw))
      } catch (err) {
        said.push(`Velda could not tag ${batch.length === 1 ? 'that picture' : 'some pictures'} (${(err as Error).message}); they are saved untagged.`)
      }
    }
    // A board takes the style and colors its pins share.
    for (const b of entries.filter((e) => e.kind === 'board')) b.tags = boardTags(entries.filter((e) => e.parent === b.id))
  }
  for (const e of entries) if (!e.sampled?.length && pinColor.has(e.id)) e.sampled = [{ hex: pinColor.get(e.id)!, share: 1 }]
  return { entries, said }
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return 'link'
  }
}

/** The tagging request: what each picture is, where to look at it, and the exact answer shape. */
export function tagPrompt(batch: Inspiration[]): string {
  const remote = batch.filter((e) => e.image && /^https?:/.test(e.image)).map((e) => e.thumb ?? e.image!)
  const lines = batch.map((e, i) => {
    const where = e.kind === 'url' ? `a web page: ${e.url} (read it with crawling; find its title and its largest picture's https URL)` : e.image && !/^https?:/.test(e.image) ? `stored picture: open it with read_storage_file, fileName "${e.image}"` : `picture ${remote.indexOf(e.thumb ?? e.image!) + 1} on the contact sheet (${e.image})`
    const known = [e.title && `title so far "${e.title}"`, e.source && `from ${e.source}`, e.sampled?.length && `measured colors ${e.sampled.map((s) => `${s.hex} ${Math.round(s.share * 100)}%`).join(', ')}`].filter(Boolean).join('; ')
    return `${i + 1}. ${where}${known ? `. ${known}` : ''}`
  })
  return `You are Velda, tagging inspiration N8 added for his remodel. Look at each picture and say what it shows, for a designer.

${remote.length ? `First run this code with execute_code exactly as written (JavaScript). It measures each web picture's main colors with the same method the app uses and shows you a contact sheet of them, 4 across, in this order. Use its output; do not change it.\n\n${remotePaletteScript(remote)}\n` : ''}PICTURES:
${lines.join('\n')}

Return ONLY one JSON object:
{"items": [{"i": 1, "title": "4 to 8 words", "style": ["..."], "materials": ["..."], "fixtures": ["..."], "palette": [{"hex": "#rrggbb", "name": "plain color name"}], "notes": "one sentence on what to take from it", "image": "https URL of the page's largest picture, only for a web page"}], "measured": [{"i": 1, "palette": [{"hex": "#rrggbb", "share": 0.4}]}]}
- palette: 3 to 5 colors, each hex copied from that picture's measured colors (the list above, or the code's output). Never make up a hex value.
- measured: copy the code's output for each web picture, in the same order (omit if there was no code to run).
- style words like "warm minimal", "spa", "transitional"; materials like "honed Carrara marble", "brushed nickel", "white oak"; fixtures like "curbless shower", "linear drain", "floating vanity".
No other text.`
}

/** Merge Velda's answer onto the cards; palette colors must be ones that were measured. */
export function applyTags(batch: Inspiration[], ans: any) {
  const items: any[] = Array.isArray(ans?.items) ? ans.items : []
  const measured: any[] = Array.isArray(ans?.measured) ? ans.measured : []
  const remote = batch.filter((e) => e.image && /^https?:/.test(e.image))
  measured.forEach((m: any, k: number) => {
    const e = remote[(Number(m?.i) || k + 1) - 1] ?? remote[k]
    const pal: Swatch[] = (Array.isArray(m?.palette) ? m.palette : []).filter((s: any) => /^#[0-9a-f]{6}$/i.test(s?.hex ?? '')).map((s: any) => ({ hex: String(s.hex).toLowerCase(), share: Number(s.share) || 0 }))
    if (e && pal.length && !e.sampled?.length) e.sampled = pal
  })
  for (const it of items) {
    const e = batch[(Number(it?.i) || 0) - 1]
    if (!e) continue
    const words = (v: any) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x: string) => x.trim()).slice(0, 8) : [])
    const close = (hex: string) => {
      const c = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16))
      return (e.sampled ?? []).some((s) => {
        const d = [1, 3, 5].map((k) => parseInt(s.hex.slice(k, k + 2), 16))
        return Math.hypot(c[0] - d[0], c[1] - d[1], c[2] - d[2]) < 10
      })
    }
    const palette = (Array.isArray(it.palette) ? it.palette : [])
      .filter((p: any) => /^#[0-9a-f]{6}$/i.test(p?.hex ?? ''))
      .map((p: any) => ({ hex: String(p.hex).toLowerCase(), ...(p.name ? { name: String(p.name) } : {}) }))
      .filter((p: { hex: string }) => close(p.hex)) // sampled, not guessed
    e.tags = { style: words(it.style), materials: words(it.materials), fixtures: words(it.fixtures), palette, ...(it.notes ? { notes: String(it.notes) } : {}) }
    if (typeof it.title === 'string' && it.title.trim()) e.title = it.title.trim().slice(0, 80)
    if (e.kind === 'url' && typeof it.image === 'string' && /^https:\/\//.test(it.image)) e.image = it.image
  }
}

/** What a board's pins have in common: the most frequent words and colors. */
export function boardTags(pins: Inspiration[]): Inspiration['tags'] {
  const top = (lists: string[][], n: number) => {
    const c = new Map<string, number>()
    for (const l of lists) for (const w of new Set(l.map((x) => x.toLowerCase()))) c.set(w, (c.get(w) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w)
  }
  const pal = new Map<string, { hex: string; name?: string; n: number }>()
  for (const p of pins) for (const s of p.tags.palette) pal.set(s.hex, { ...s, n: (pal.get(s.hex)?.n ?? 0) + 1 })
  return {
    style: top(pins.map((p) => p.tags.style), 5),
    materials: top(pins.map((p) => p.tags.materials), 6),
    fixtures: top(pins.map((p) => p.tags.fixtures), 6),
    palette: [...pal.values()].sort((a, b) => b.n - a.n).slice(0, 6).map(({ n, ...s }) => s),
  }
}

/** A picture no larger than max pixels on its long side, as JPEG. */
async function shrink(file: File, max: number): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = bad
      i.src = url
    })
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * k)
    c.height = Math.round(img.naturalHeight * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), 'image/jpeg', 0.88))
  } finally {
    URL.revokeObjectURL(url)
  }
}
