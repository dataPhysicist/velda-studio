// What the Rooms page needs from the outside world: a database, a place for pictures, Velda, and an
// image model. Inside Toolbelt these are the bridge; with no bridge (the local preview and the browser
// tests) they are in memory with stand-ins, so the whole page can be used and tested offline.
import { runReplicate, outputUrls } from '../lib/replicate'
import { DEEP_MODEL, FAST_MODEL } from '../lib/agent'
import { connect, DB, type ToolbeltSDK } from '../toolbelt'

export type ModelRun = { url: string; seconds: number; id?: string; via: 'direct' | 'velda' | 'local' }

export interface Backend {
  kind: 'toolbelt' | 'local'
  /** The database this page saves to. */
  db: string
  sql(query: string): Promise<any[]>
  putImage(path: string, blob: Blob): Promise<void>
  /** A picture as a data URL the page can draw and read. */
  getImage(path: string): Promise<string | null>
  /** A link an image model can fetch. */
  link(path: string): Promise<string>
  /** Ask Velda. With `image` (a stored picture) she looks at it. */
  ask(prompt: string, deep: boolean, image?: string | null): Promise<string>
  runModel(model: string, version: string, input: Record<string, unknown>): Promise<ModelRun>
}

const toB64 = (blob: Blob) =>
  new Promise<string>((ok, bad) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result).split(',')[1] ?? '')
    r.onerror = () => bad(r.error)
    r.readAsDataURL(blob)
  })

const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms))

export class ToolbeltBackend implements Backend {
  kind = 'toolbelt' as const
  db = DB
  /** Whether the page may call the image model itself (fast), or has to ask Velda to (slower). Unknown until tried. */
  private direct: boolean | null = null
  constructor(readonly sdk: ToolbeltSDK) {}
  sql(query: string) {
    return this.sdk.sql(query, this.db)
  }
  async putImage(path: string, blob: Blob) {
    await this.sdk.upload(path, await toB64(blob), blob.type || 'image/jpeg')
  }
  getImage(path: string) {
    return this.sdk.readImage(path)
  }
  link(path: string) {
    return /^https?:/.test(path) ? Promise.resolve(path) : this.sdk.signedUrl(path, 3600)
  }
  /**
   * Velda's answers come from Claude run as a model the page calls itself, because that is the one
   * way she can be shown a picture (a sub-chat's file tool hands the model a link, not the pixels),
   * and it is quicker. If the page may not run models, a sub-chat answers without seeing the photo.
   */
  async ask(prompt: string, deep: boolean, image?: string | null) {
    if (this.direct !== false) {
      try {
        const input: Record<string, unknown> = { prompt, effort: deep ? 'medium' : 'low', max_tokens: 8192 }
        if (image) {
          input.image = await this.link(image)
          input.max_image_resolution = 1.5
        }
        const p = await this.runDirect(SEER.model, SEER.version, input)
        this.direct = true
        const text = Array.isArray(p.output) ? p.output.join('') : String(p.output ?? '')
        if (text.trim()) return text
      } catch (e) {
        console.warn('[rooms] Velda could not answer as a model run; asking through a sub-chat', e)
        if (!(e instanceof ModelFailed)) this.direct = false
      }
    }
    const blind = image ? `${prompt}\n\n(The photo could not be attached this time. Answer from the floor plan facts alone, and say in your first sentence that you could not see the photo.)` : prompt
    return this.sdk.ask(blind, deep ? DEEP_MODEL : FAST_MODEL, deep ? 120 : 90)
  }
  async runModel(model: string, version: string, input: Record<string, unknown>): Promise<ModelRun> {
    const t0 = Date.now()
    if (this.direct !== false) {
      try {
        const p = await this.runDirect(model, version, input)
        this.direct = true
        const url = outputUrls(p.output)[0]
        if (!url) throw new ModelFailed('no picture came back')
        return { url, id: p.id, seconds: (Date.now() - t0) / 1000, via: 'direct' }
      } catch (e) {
        // A model that ran and failed is a real answer; only a bridge that will not run the tool sends us to Velda.
        if (e instanceof ModelFailed) throw e
        console.warn('[rooms] the page could not run the image model itself; asking Velda to', e)
        this.direct = false
      }
    }
    const res = await runReplicate(this.sdk, model, input, { timeoutSeconds: 240 })
    const url = outputUrls(res.output)[0]
    if (!url) throw new Error('no picture came back')
    return { url, seconds: (Date.now() - t0) / 1000, id: res.id, via: 'velda' }
  }
  private async runDirect(model: string, version: string, input: Record<string, unknown>) {
    const owner = model.split('/')[0]
    const made = unwrap(await this.sdk.runToolParsed('replicate-create-prediction', { collectionSlug: owner, modelId: model, version, input: JSON.stringify(input) }))
    const id = made?.id
    if (!id) throw new Error(`the image model did not start (${JSON.stringify(made).slice(0, 200)})`)
    let p = made
    const until = Date.now() + 200_000
    while (!['succeeded', 'failed', 'canceled'].includes(p?.status)) {
      if (Date.now() > until) throw new ModelFailed('the picture took too long')
      await wait(1400)
      p = unwrap(await this.sdk.runToolParsed('replicate-get-prediction', { predictionId: id })) ?? p
    }
    if (p.status !== 'succeeded') throw new ModelFailed(String(p.error || `the model ${p.status}`))
    return p as { id: string; output: unknown }
  }
}

/** Claude as a model the page can run with a picture attached (checked 2026-11-17: prompt, image, effort, max_tokens). */
const SEER = { model: 'anthropic/claude-opus-5.5', version: '9382e88533ac3d3b2e714c0cb634c75779ce84c9ab861cc6fc6d6b559ea36eca' }

/** The image model ran and said no (as opposed to the bridge refusing to run it). */
export class ModelFailed extends Error {}

/** Replicate tool answers arrive as {ret: {...}} or the prediction itself. */
function unwrap(r: any): any {
  if (r && typeof r === 'object' && r.ret && typeof r.ret === 'object') return r.ret
  return r
}

/** No Toolbelt: pictures in memory, canned answers, and a stand-in image model that repaints the middle of the picture. */
export class LocalBackend implements Backend {
  kind = 'local' as const
  db = 'memory'
  images = new Map<string, Blob>()
  /** Tests can replace these. */
  answer: (prompt: string) => string = localAnswer
  paint: (source: Blob, input: Record<string, unknown>) => Promise<Blob> = localPaint
  calls: { model: string; input: Record<string, unknown> }[] = []
  asked: string[] = []
  async sql(): Promise<any[]> {
    throw new Error('no database in the local preview')
  }
  async putImage(path: string, blob: Blob) {
    this.images.set(path, blob)
  }
  async getImage(path: string) {
    const b = this.images.get(path)
    return b ? `data:${b.type || 'image/jpeg'};base64,${await toB64(b)}` : null
  }
  async link(path: string) {
    return `local:${path}`
  }
  async ask(prompt: string) {
    this.asked.push(prompt)
    await wait(150)
    return this.answer(prompt)
  }
  async runModel(model: string, _version: string, input: Record<string, unknown>): Promise<ModelRun> {
    this.calls.push({ model, input })
    const first = String(((input.input_images ?? input.image_input) as string[] | undefined)?.[0] ?? input.input_image ?? '')
    const src = this.images.get(first.replace(/^local:/, ''))
    if (!src) throw new Error('the stand-in image model has no picture to work on')
    await wait(200)
    const out = await this.paint(src, input)
    return { url: URL.createObjectURL(out), seconds: 0.2, via: 'local' }
  }
}

/** The stand-in "model": a blue-green block over the middle third of the picture, and everything a touch brighter (the drift a real model adds). */
async function localPaint(source: Blob, input: Record<string, unknown>): Promise<Blob> {
  const bmp = await createImageBitmap(source)
  const w = Number(input.width) || bmp.width
  const h = Number(input.height) || bmp.height
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.filter = 'brightness(1.04)'
  g.drawImage(bmp, 0, 0, w, h)
  g.filter = 'none'
  g.fillStyle = '#1f6f78'
  g.fillRect(w * 0.34, h * 0.36, w * 0.32, h * 0.28)
  return new Promise((ok) => c.toBlob((b) => ok(b!), 'image/jpeg', 0.92))
}

function localAnswer(prompt: string): string {
  if (/"ideas"/.test(prompt))
    return JSON.stringify({
      sees: 'A room photographed from the doorway.',
      ideas: [
        { title: 'Warmer wall color', why: 'A soft warm white keeps the room bright and calmer than the current tone.', prompt: 'Repaint the walls a soft warm white.', scale: 'tweak' },
        { title: 'Brass hardware', why: 'Brass against painted wood reads richer than black.', prompt: 'Change the cabinet pulls and faucets to unlacquered brass.', scale: 'tweak' },
        { title: 'Herringbone floor', why: 'It matches the style direction on file for this house.', prompt: 'Replace the floor with light oak in a herringbone pattern.', scale: 'refresh' },
      ],
      notices: [{ title: 'Check the light at the mirror', body: 'Light from above alone shadows a face. Sconces at face height on both sides of the mirror fix that.', ask: 'electrician' }],
    })
  return JSON.stringify({ answer: 'That depends on what is behind the wall. A plumber can tell in a short visit.', ask: 'plumber' })
}

export async function openBackend(): Promise<Backend> {
  const sdk = await connect()
  return sdk ? new ToolbeltBackend(sdk) : new LocalBackend()
}
