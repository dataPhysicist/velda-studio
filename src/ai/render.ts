// Realistic renders (07 section 8): the app writes the image prompt from the room, the theme (colors
// by role, materials, lighting, what to avoid), the inspiration pictures and the camera framing of
// the current 3D view. Velda adds only N8's own words. Renders are mood, not dimensions.
import type { Theme } from '../lib/theme'
import { MODELS } from '../lib/replicate'
import { pointInPolygon, polygonBounds } from '../model/geom'
import { roomEdges } from '../model/place'
import type { Model, Room, Vec } from '../model/types'
import { IN, formatFeetInches } from '../model/units'
import { itemWall, sideWord } from './summary'

export const RENDER_LABEL = 'Mood, not dimensions'

export type Quality = 'standard' | 'best'

/**
 * The Replicate model, output size and an estimate of one image's cost. The estimates are Google's
 * list prices for these models (Gemini API, standard tier, 2026); Replicate's own price page could
 * not be read from the build sandbox, so they are unverified against an invoice.
 */
export const RENDER_RUNS: Record<Quality, { model: string; resolution: string; usd: number; label: string }> = {
  standard: { model: MODELS.photoreal, resolution: '1K', usd: 0.067, label: 'Standard' },
  best: { model: MODELS.photorealBest, resolution: '2K', usd: 0.134, label: 'Best quality' },
}

const ft = (v: number) => formatFeetInches(v).replace(/^0'-/, '')

/** Aspect ratios the render models take. */
export const RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const

/**
 * The supported ratio nearest a view or photo, and a snapshot size in it (long side 1536). Asking for
 * the ratio outright keeps the render framed like the view: with "match_input_image" the model went
 * by a portrait reference picture and reframed a landscape view (Phase 6 run).
 */
export function nearestRatio(aspect: number): { ratio: (typeof RATIOS)[number]; w: number; h: number } {
  let best: (typeof RATIOS)[number] = '3:2'
  let miss = Infinity
  for (const r of RATIOS) {
    const [a, b] = r.split(':').map(Number)
    const d = Math.abs(Math.log(a / b) - Math.log(aspect))
    if (d < miss) {
      miss = d
      best = r
    }
  }
  const [a, b] = best.split(':').map(Number)
  const long = 1536
  const w = a >= b ? long : Math.round((long * a) / b / 8) * 8
  const h = a >= b ? Math.round((long * b) / a / 8) * 8 : long
  return { ratio: best, w, h }
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export type Pose = { position: number[]; direction: number[]; fov: number; aspect: number }

/** The current 3D view in words: where the camera is, how it looks, and what it looks toward. */
export function describeCamera(m: Model, levelId: string | null, pose: Pose, preferRoom?: string | null): string {
  const lv = m.levels.find((l) => l.id === levelId) ?? m.levels[0]
  const elev = lv?.elev ?? 0
  const p: Vec = [pose.position[0] / IN, pose.position[2] / IN]
  const h = pose.position[1] / IN - elev
  const [dx, dy, dz] = pose.direction
  const flat = Math.hypot(dx, dz)
  const down = Math.round((Math.atan2(-dy, flat) * 180) / Math.PI)
  const across = Math.round((2 * Math.atan(Math.tan((pose.fov * Math.PI) / 360) * pose.aspect) * 180) / Math.PI)
  const rooms = m.rooms.filter((r) => r.level === lv?.id && r.polygon.length >= 3)
  const at = (q: Vec) => rooms.find((r) => pointInPolygon(q, r.polygon)) ?? null
  const inside = at(p)
  const ceiling = inside?.ceiling ?? lv?.ceiling ?? 108
  const look = Math.abs(down) <= 8 ? 'looking straight ahead' : down > 0 ? `looking down ${down} degrees` : `looking up ${-down} degrees`
  const dir: Vec | null = flat > 0.1 ? [dx / flat, dz / flat] : null
  let where: string
  let from: Vec = p
  let room: Room | null = inside
  if (inside && h > 0 && h < ceiling) where = `inside the ${inside.name}, ${ft(h)} above the floor`
  else {
    // From above (the cut-away view): the room is the one the middle of the view lands on.
    const t = dy < -0.05 ? h / -dy : 0
    from = [p[0] + dx * t, p[1] + dz * t]
    room = at(from) ?? inside
    // The room the render is for wins when it is in the picture (the middle of the view can land on
    // the closet next to it, or the camera can still be gliding there).
    const want = preferRoom ? rooms.find((r) => r.id === preferRoom) : undefined
    if (want && want !== room && inView(want, p, h, pose)) {
      room = want
      const b = polygonBounds(want.polygon)
      from = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]
    }
    where = room ? `above the ${room.name}, with the ceiling and near walls cut away` : 'above the house'
  }
  const toward = room && dir ? facing(m, room, from, dir) : ''
  return `Camera: ${where}, ${look}${toward ? `, toward ${toward}` : ''}; the lens takes in about ${across} degrees across.`
}

/** Whether the middle of a room's floor is inside the camera's picture. */
function inView(r: Room, p: Vec, h: number, pose: Pose): boolean {
  const b = polygonBounds(r.polygon)
  const v = [(b.x0 + b.x1) / 2 - p[0], -h, (b.y0 + b.y1) / 2 - p[1]]
  const [dx, dy, dz] = pose.direction
  const cos = (v[0] * dx + v[1] * dy + v[2] * dz) / (Math.hypot(v[0], v[1], v[2]) * Math.hypot(dx, dy, dz) || 1)
  return cos >= Math.cos(((pose.fov / 2) * Math.PI) / 180)
}

/** The wall a line of sight from `o` meets first, with what is on it ("the top wall, with the vanity and a window"). */
function facing(m: Model, room: Room, o: Vec, d: Vec): string {
  let best: { t: number; e: ReturnType<typeof roomEdges>[number] } | null = null
  for (const e of roomEdges(m, room)) {
    const ex = e.b[0] - e.a[0]
    const ey = e.b[1] - e.a[1]
    const den = d[0] * ey - d[1] * ex
    if (Math.abs(den) < 1e-9) continue
    const qx = e.a[0] - o[0]
    const qy = e.a[1] - o[1]
    const t = (qx * ey - qy * ex) / den
    const u = (qx * d[1] - qy * d[0]) / den
    if (t > 0 && u >= -0.01 && u <= 1.01 && (!best || t < best.t)) best = { t, e }
  }
  if (!best) return ''
  const e = best.e
  const things = m.items.filter((it) => it.level === room.level && itemWall(m, it)?.edge.wall?.id === e.wall?.id && e.wall).map((it) => it.label || it.kind.replace(/_/g, ' '))
  const windows = e.openings.filter(({ o }) => o.kind === 'window').length
  const doors = e.openings.filter(({ o }) => o.kind !== 'window').length
  const on = [...new Set(things.map((t) => t.split(/,\s/)[0]))].slice(0, 3)
  if (windows) on.push(windows === 1 ? 'a window' : plural(windows, 'window'))
  if (doors) on.push(doors === 1 ? 'a door' : plural(doors, 'door'))
  const side = sideWord(e)
  return `the ${side === 'angled' ? 'angled' : side} wall${on.length ? `, with ${list(on)}` : ''}`
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

export type RenderInput = {
  model: Model
  room: Room | null
  theme: Theme | null
  /** Image 1 is N8's photo (true) or the 3D model view (false). */
  photo: boolean
  /** A view of the 3D design comes second (photo renders). */
  design: boolean
  /** How many inspiration pictures follow as references. */
  refs: number
  camera: string | null
  /** Only N8's own words about the picture, passed on by Velda. */
  words?: string | null
}

/** The image prompt, written by the app. */
export function renderPrompt(r: RenderInput): string {
  const lines: string[] = []
  lines.push(
    r.photo
      ? 'Image 1 is a real photo of this room as it is today. Produce a photorealistic photo of the SAME room from the EXACT same camera position, lens and framing, remodeled. Keep the walls, ceiling, window and door openings where they are in image 1 unless the design says otherwise.'
      : 'Image 1 is a simple 3D model view of a remodel design. Produce a photorealistic interior photograph from the EXACT same camera position and framing, keeping every wall, opening, cabinet, fixture and object where image 1 shows it, with the same proportions.',
  )
  if (r.design) lines.push('Image 2 is the 3D design of the remodel; follow its layout and fixtures.')
  if (r.refs) lines.push(`The last ${r.refs === 1 ? 'image is' : `${r.refs} images are`} inspiration N8 chose for this room: take materials, colors and mood from them only; do not copy their layout.`)
  if (r.room) {
    const b = polygonBounds(r.room.polygon)
    const ceiling = r.room.ceiling ?? r.model.levels.find((l) => l.id === r.room!.level)?.ceiling
    lines.push(`The room: the ${r.room.name}, ${ft(b.x1 - b.x0)} by ${ft(b.y1 - b.y0)}${ceiling ? `, ceiling ${ft(ceiling)}` : ''}.`)
    const items = r.model.items.filter((it) => it.level === r.room!.level && pointInPolygon([it.x, it.y], r.room!.polygon) && it.w >= 6)
    if (items.length) {
      const said = items.slice(0, 10).map((it) => {
        const w = itemWall(r.model, it)
        const name = (it.label || it.kind.replace(/_/g, ' ')).split(/,\s/)[0]
        return `${name} (${ft(it.w)} by ${ft(it.d)})${w?.edge.wall ? ` against the ${sideWord(w.edge)} wall` : ''}`
      })
      lines.push(`In it, where image 1 shows them: ${said.join('; ')}.`)
    }
  }
  if (r.camera) lines.push(r.camera)
  const t = r.theme
  if (t) {
    const d = t.data ?? ({} as Theme['data'])
    lines.push(`Design theme "${t.name}"${d.description ? `: ${d.description}` : '.'}`)
    if (d.palette?.length) lines.push(`Colors: ${d.palette.map((p) => `${p.role ? `${p.role} ` : ''}${p.name} ${p.hex}${p.use ? ` (${p.use})` : ''}`).join('; ')}.`)
    if (d.materials?.length) lines.push(`Materials: ${d.materials.map((x) => `${x.category}: ${x.choice}`).join('; ')}.`)
    const light = lightingWords(d.lighting)
    if (light) lines.push(`Lighting: ${light}.`)
    const avoid = [...(d.avoid ?? []), ...(typeof (d.lighting as any)?.avoid === 'string' ? [(d.lighting as any).avoid] : [])]
    if (avoid.length) lines.push(`Do not show: ${avoid.join('; ')}.`)
  }
  if (r.words?.trim()) lines.push(`N8 asked for: ${r.words.trim()}`)
  lines.push('Realistic materials and soft shadows, professional interior photography, straight verticals. No people, no text, no watermark.')
  return lines.join('\n')
}

/** A theme's lighting as words, whatever keys Velda used ("daytime_cct": "2200K to 2700K"). */
function lightingWords(l: unknown): string {
  if (!l || typeof l !== 'object') return typeof l === 'string' ? l : ''
  return Object.entries(l as Record<string, unknown>)
    .filter(([k, v]) => k !== 'avoid' && typeof v === 'string' && v.trim())
    .map(([k, v]) => (k === 'rules' || k === 'principle' ? String(v) : `${k.replace(/_/g, ' ').replace(/\bcct\b/i, 'color temperature')} ${v}`))
    .join('; ')
}

/** What one render cost and took, for the line under it. */
export function renderNote(q: Quality, seconds: number | null): string {
  const run = RENDER_RUNS[q]
  return [`${run.label}, ${run.resolution}`, `about $${run.usd.toFixed(2)}`, seconds ? `${Math.round(seconds)} s` : ''].filter(Boolean).join(' · ')
}
