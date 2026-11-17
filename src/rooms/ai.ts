// Asking for a change to a photo, and asking Velda what she would do with the room.
//
// A change goes to an image model with the room's real facts from the floor plan, and comes back
// through compose.ts, so only what was asked for changes. A brushed change sends just that part of the
// picture, and nothing outside the brush can change at all.
import { firstJson } from '../lib/agent'
import type { Backend } from './backend'
import { ModelFailed } from './backend'
import type { Idea, Notice, Study } from './db'
import { type Analysis, analyze, composite, cropFor, cut, type Img, NO_TONE, pasteCrop, regionMask } from './photo/compose'
import { jpegAt, pixels } from './photo/canvas'

/** Image models, in the order they are tried. Versions are the ones checked on 2026-11-17. */
export const ENGINES = [
  {
    id: 'flux2',
    name: 'FLUX.2 pro',
    model: 'black-forest-labs/flux-2-pro',
    version: 'ccb5e33141097816e6fab8c895e702fe4c619e4e07500885b71214e9f6382a5c',
    input: (prompt: string, images: string[], w: number, h: number) => ({ prompt, input_images: images.slice(0, 8), aspect_ratio: 'custom', width: w, height: h, output_format: 'jpg', output_quality: 92 }),
  },
  {
    id: 'banana',
    name: 'Nano Banana 2',
    model: 'google/nano-banana-2',
    version: 'd1be8b5fc0931a253d417e12a484ac01ee9ccbc6daffd4792151377d5e5ff55f',
    input: (prompt: string, images: string[], _w: number, _h: number, ratio: string) => ({ prompt, image_input: images.slice(0, 8), aspect_ratio: ratio, resolution: '2K', output_format: 'jpg' }),
  },
] as const

export type EngineId = (typeof ENGINES)[number]['id']

/** Requests that are about the whole picture (light, mood, a full restyle), where putting "the rest" back would undo them. */
const WHOLE =
  /\b(whole|entire|everything|all of it|throughout|restyle|re-?style|makeover|make ?over|redesign|re-?imagine|transform|brighter|darker|lighter and|light and airy|airy|moody|cozy|cosy|warmer|cooler|evening|night|dusk|daylight|sunlight|sunny|declutter|tidy|clean up|empty|stage|staging|furnish|modern|farmhouse|coastal|traditional|transitional|scandinavian|mid.?century|rustic|minimal|industrial|bohemian|boho|art deco|spa.?like|our plan|the plan|the design)\b/i

export const looksWhole = (words: string) => WHOLE.test(words)

export type EditContext = {
  room: string
  /** The room in words from the plan (roomFacts). */
  facts: string
  /** The style direction on file, when the request leans on it. */
  style?: string
}

export function editPrompt(words: string, cx: EditContext, o: { part: boolean; refs: number; whole: boolean }): string {
  const lines: string[] = []
  lines.push(
    o.part
      ? `Image 1 is part of a real photo of the ${cx.room} in a house. Edit it.`
      : `Image 1 is a real photo of the ${cx.room} in a house. Edit it.`,
  )
  lines.push(`Change only this: ${words.trim().replace(/\s+/g, ' ')}`)
  if (o.refs) lines.push(`${o.refs === 1 ? 'Image 2 is' : `Images 2 to ${o.refs + 1} are`} a reference for the look: take the material, color and style from ${o.refs === 1 ? 'it' : 'them'}, not the layout or the room.`)
  lines.push(
    o.whole
      ? 'Keep the same room: the same camera position, lens and framing, and every wall, window, door and ceiling where it is. Keep the proportions of the room true.'
      : 'Keep everything else exactly as it is in image 1: the same camera position, lens and framing, the same lighting and shadows, and every other object, surface, color and reflection. Do not move, add, remove or restyle anything that was not asked for.',
  )
  if (cx.facts && !o.part) lines.push(`For true proportions, from the measured floor plan: ${cx.facts.replace(/\n/g, ' ')}`)
  if (cx.style && (o.whole || /style|theme|direction|our (colors|palette|look)|match/i.test(words))) lines.push(`The owners' style direction: ${cx.style.replace(/\n/g, ' ')}`)
  lines.push('Photorealistic, the same photo quality as image 1. No people, no text, no watermark.')
  return lines.join('\n')
}

export type EditRequest = {
  base: Img
  /** Where the base picture is stored. */
  basePath: string
  ratio: string
  words: string
  cx: EditContext
  /** A brushed area: a 0..1 grid over the whole picture. */
  brush?: { mask: Float32Array; w: number; h: number } | null
  /** Stored pictures to use as a look reference. */
  refs?: string[]
  engine?: EngineId
  /** A folder in storage for the files this request makes. */
  tmp: string
}

export type EditResult = {
  /** 'spot': a brushed part was changed and laid back in. 'full': the whole picture came back and can be compared. */
  kind: 'spot' | 'full'
  /** The model's whole picture at the photo's size (for 'full'), or the finished picture (for 'spot'). */
  raw: Img
  analysis: Analysis | null
  engine: string
  seconds: number
  prompt: string
  whole: boolean
}

async function runWith(be: Backend, engine: EngineId | undefined, make: (e: (typeof ENGINES)[number]) => Record<string, unknown>) {
  const order = engine ? [...ENGINES.filter((e) => e.id === engine), ...ENGINES.filter((e) => e.id !== engine)] : [...ENGINES]
  let last: unknown
  for (const e of order) {
    try {
      const run = await be.runModel(e.model, e.version, make(e))
      return { run, engine: e }
    } catch (err) {
      last = err
      console.warn(`[rooms] ${e.name} did not make the picture`, err)
      // A refusal about the content is the answer; another model would be asked the same thing.
      if (err instanceof ModelFailed && /safety|sensitive|nsfw|policy/i.test(String(err.message))) break
    }
  }
  throw last instanceof Error ? last : new Error('the picture could not be made')
}

export async function runEdit(be: Backend, r: EditRequest, status: (t: string) => void): Promise<EditResult> {
  const { base } = r
  const refs = await Promise.all((r.refs ?? []).slice(0, 3).map((p) => be.link(p)))
  const crop = r.brush ? cropFor(r.brush.mask, r.brush.w, r.brush.h, base.w, base.h) : null

  if (r.brush && crop) {
    // Only the brushed part goes to the model, larger than life, and comes back through the brush.
    status('Sending just the part you marked')
    const part = cut(base, crop)
    const path = `${r.tmp}-part.jpg`
    await be.putImage(path, await jpegAt(part, crop.outW, crop.outH))
    const prompt = editPrompt(r.words, r.cx, { part: true, refs: refs.length, whole: false })
    const link = await be.link(path)
    status('Painting your change')
    const { run, engine } = await runWith(be, r.engine, (e) => e.input(prompt, [link, ...refs], crop.outW, crop.outH, crop.ratio))
    status('Fitting it back into your photo')
    const edited = await pixels(await fetchBlob(run.url), crop.w, crop.h)
    const out = pasteCrop(base, edited, crop, r.brush.mask, r.brush.w, r.brush.h)
    return { kind: 'spot', raw: { w: base.w, h: base.h, data: out }, analysis: null, engine: engine.name, seconds: run.seconds, prompt, whole: false }
  }

  const whole = !r.brush && looksWhole(r.words)
  const prompt = editPrompt(r.words, r.cx, { part: false, refs: refs.length, whole })
  const link = await be.link(r.basePath)
  status('Painting your change')
  const { run, engine } = await runWith(be, r.engine, (e) => e.input(prompt, [link, ...refs], base.w, base.h, r.ratio))
  status('Checking what changed')
  const raw = await pixels(await fetchBlob(run.url), base.w, base.h)
  if (r.brush) {
    // The brush covered most of the picture: the model saw all of it, and only the brushed area is kept.
    const an = analyze(base, raw)
    const out = composite(base, raw, r.brush.mask, r.brush.w, r.brush.h, an.tone, an.shift)
    return { kind: 'spot', raw: { w: base.w, h: base.h, data: out }, analysis: null, engine: engine.name, seconds: run.seconds, prompt, whole: false }
  }
  return { kind: 'full', raw, analysis: analyze(base, raw), engine: engine.name, seconds: run.seconds, prompt, whole }
}

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('the finished picture could not be downloaded')
  return res.blob()
}

/** The picture to show for a full result: the model's pixels only in the kept areas, or all of them. */
export function finish(base: Img, res: EditResult, keep: number[], protect: boolean): Img {
  if (res.kind === 'spot' || !res.analysis) return res.raw
  const an = res.analysis
  if (!protect) return res.raw
  const mask = regionMask(an, keep)
  return { w: base.w, h: base.h, data: composite(base, res.raw, mask, an.gw, an.gh, an.tone ?? NO_TONE, an.shift) }
}

// ---------------------------------------------------------------- Velda looks at the photo

export type StudyInput = { path: string; room: string; facts: string; style: string; planned: string[]; findings: string[]; asked: string[] }

export function studyPrompt(s: StudyInput): string {
  return `You are Velda, an architect and interior designer who specializes in remodels. A homeowner took a photo of a room in her house and wants ideas, and wants to hear what a designer or architect would notice that she and her husband may not have thought of.

Her photo of the room is attached. Look at it carefully before answering.

What the measured floor plan says about this room:
${s.facts || '(nothing on file)'}
${s.style ? `\nThe style direction on file for this room:\n${s.style}\n` : ''}${s.planned.length ? `\nChanges already drawn in their saved designs:\n${s.planned.map((l) => `- ${l}`).join('\n')}\n` : ''}${s.findings.length ? `\nWhat the plan checker already flags (do not repeat these):\n${s.findings.map((l) => `- ${l}`).join('\n')}\n` : ''}${s.asked.length ? `\nChanges she has already tried on this photo:\n${s.asked.map((l) => `- ${l}`).join('\n')}\n` : ''}
Reply with ONLY one JSON object, no other text:
{"sees": "one plain sentence saying what the photo shows",
 "ideas": [{"title": "at most 5 words", "why": "one sentence a homeowner would nod at", "prompt": "an instruction for a photo editor that changes only this one thing, naming the material, color and finish", "scale": "tweak" | "refresh" | "remodel"}],
 "notices": [{"title": "at most 6 words", "body": "one or two sentences: what you see in THIS photo that matters before they build, and what to do about it", "ask": "designer" | "architect" | "engineer" | "plumber" | "electrician" | "contractor"}]}

Rules:
- 6 ideas, smallest change first: at least two are tweaks (paint, hardware, lighting, mirror, textiles), at least one is a remodel-size idea. Each fits this room's real size and its style direction, and is different from the others and from what she already tried.
- 3 to 5 notices, only things specific to what is visible in the photo or on the plan (a register that a vanity would cover, a window inside the wet area, a switch a new door would hide, an outlet near water, light coming from only one side, a door swing). No generic advice.
- Plain words, feet and inches, no em dashes, no compass directions. Do not invent measurements: use the plan's numbers or say "measure this".`
}

const clean = (v: unknown, n = 400) => String(v ?? '').replace(/—|–/g, ', ').replace(/\s+/g, ' ').trim().slice(0, n)

export function parseStudy(raw: string): Study | null {
  const o = firstJson(raw)
  if (!o || typeof o !== 'object') return null
  const ideas: Idea[] = (Array.isArray(o.ideas) ? o.ideas : [])
    .map((i: any) => ({ title: clean(i?.title, 60), why: clean(i?.why, 240), prompt: clean(i?.prompt, 500), scale: ['tweak', 'refresh', 'remodel'].includes(i?.scale) ? i.scale : undefined }))
    .filter((i: Idea) => i.title && i.prompt)
    .slice(0, 8)
  const notices: Notice[] = (Array.isArray(o.notices) ? o.notices : [])
    .map((n: any) => ({ title: clean(n?.title, 70), body: clean(n?.body, 420), ask: clean(n?.ask, 20).toLowerCase() }))
    .filter((n: Notice) => n.title && n.body)
    .slice(0, 6)
  if (!ideas.length && !notices.length) return null
  return { sees: clean(o.sees, 240) || undefined, ideas, notices, at: new Date().toISOString() }
}

export async function study(be: Backend, s: StudyInput): Promise<Study> {
  const raw = await be.ask(studyPrompt(s), true, s.path)
  const out = parseStudy(raw)
  if (!out) throw new Error('Velda looked but did not send ideas back')
  return out
}

export function askPrompt(q: string, s: Omit<StudyInput, 'asked'> & { path: string | null }): string {
  return `You are Velda, an architect and interior designer who specializes in remodels, answering a homeowner's question about a room in her house.
${s.path ? '\nHer photo of the room is attached.\n' : ''}
What the measured floor plan says about this room:
${s.facts || '(nothing on file)'}
${s.style ? `\nThe style direction on file:\n${s.style}\n` : ''}${s.planned.length ? `\nChanges drawn in their saved designs:\n${s.planned.map((l) => `- ${l}`).join('\n')}\n` : ''}${s.findings.length ? `\nWhat the plan checker flags:\n${s.findings.map((l) => `- ${l}`).join('\n')}\n` : ''}
Her question: ${q.trim()}

Reply with ONLY one JSON object: {"answer": "2 to 4 plain sentences that answer the question directly, say what it depends on, and say what to check or measure", "ask": "designer" | "architect" | "engineer" | "plumber" | "electrician" | "contractor" | "none"}
Plain words, feet and inches, no em dashes. Never present a guess as a measurement. If it touches structure, plumbing routes or code, say who has to confirm it.`
}

export async function ask(be: Backend, q: string, s: Omit<StudyInput, 'asked'> & { path: string | null }): Promise<{ answer: string; ask: string }> {
  const raw = await be.ask(askPrompt(q, s), true, s.path)
  const o = firstJson(raw)
  const answer = clean(o?.answer ?? raw, 900)
  if (!answer) throw new Error('Velda did not answer')
  return { answer, ask: clean(o?.ask, 20).toLowerCase() || 'none' }
}

/** A short name for a change, for the strip under the photo ("Navy vanity"). */
export function labelFor(words: string): string {
  const w = words.trim().replace(/\s+/g, ' ').replace(/^(please|can you|could you|i want to|i'd like to|let's|lets)\s+/i, '')
  const s = w.charAt(0).toUpperCase() + w.slice(1)
  return s.length <= 34 ? s : s.slice(0, 33).replace(/\s+\S*$/, '') + '…'
}
