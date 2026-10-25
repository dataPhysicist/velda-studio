// App state and actions: schemes, versions, conversation, focus.
import { create } from 'zustand'
import { type Issue, runChecks } from '../analysis/checks'
import { DEEP_MODEL, askVelda, buildPrompt, pickModel } from '../lib/agent'
import type { Theme } from '../lib/theme'
import { polygonBounds } from '../model/geom'
import { isV1, migrateV1 } from '../model/migrate'
import { type Op, applyOps, newId as sid } from '../model/ops'
import type { Author, Comment, Inspiration, Model } from '../model/types'
import { IN } from '../model/units'
import { compileScene } from '../view3d/compile'
import handChecked from '../../scripts/plan-openings/level2-asbuilt-walls.json'
import type { Attachment, Message, MessageMeta, Repo, Scheme, StoredModel, Version } from '../repo'
import type { ToolbeltSDK } from '../toolbelt'
import { useViewer } from '@pascal-app/viewer'
import { type Focus, showScene } from './scene'
import { walkStart } from './Walk'

type State = {
  sdk: ToolbeltSDK | null
  repo: Repo | null
  status: string | null // boot / import progress, shown over the stage
  error: string | null
  schemes: Scheme[]
  schemeId: string | null
  versions: Version[]
  headId: string | null
  model: Model | null
  library: Theme[]
  messages: Message[]
  thinking: { model: string; started: number } | null
  levelId: string | null // model level id, null = whole house
  roomId: string | null
  view: '3d' | 'plan'
  focus: Focus | null
  sceneKey: number
  walk: { key: number; levelId: string; x: number; y: number; z: number; yaw: number } | null
  exitWalk: () => void
  activity: { text: string; started: number } | null // long jobs: capture, renders, 3D models
  clouds: { id: string; level: string; pos: Float32Array; col: Uint8Array; transform: number[] }[]
  showCaptures: boolean
  /** What is selected, shared by the plan, the 3D view and the context panel. */
  selection: { kind: SelKind; id: string }[]
  tool: Tool
  /** Comment pins on the current scheme (the Comment tool). */
  comments: Comment[]
  /** How the 3D view shows the house (06 section 3). */
  look: Look
  /** The checker's issues for the model on screen (07 section 5), worked out on every version. */
  checks: Issue[]
  /** Issue ids set aside in this scheme: dismissed (a note or should-fix) or acknowledged (structure). */
  setAside: { dismissed: string[]; acked: string[] }
  /** Which tab the right-hand panel shows. */
  ctxTab: 'selection' | 'checks' | 'inspiration'
  /** A request for the plan to frame some points on a level (a check clicked in the panel). */
  frameReq: { level: string; pts: [number, number][]; key: number } | null
}

export type Look = {
  walls: 'cutaway' | 'up' | 'translucent' | 'down' // cut away, full, see-through, none
  levels: 'auto' | 'stacked' | 'solo' | 'exploded' // auto: the picked level alone, else all stacked
  light: 'studio' | 'morning' | 'afternoon'
}

export type SelKind = 'wall' | 'opening' | 'room' | 'item' | 'stair' | 'dimension' | 'comment'
export type Tool = 'select' | 'wall' | 'opening' | 'measure' | 'comment'

export const useStudio = create<State>(() => ({
  sdk: null,
  repo: null,
  status: 'Opening Velda Studio',
  error: null,
  schemes: [],
  schemeId: null,
  versions: [],
  headId: null,
  model: null,
  library: [],
  messages: [],
  thinking: null,
  levelId: null,
  roomId: null,
  view: '3d',
  focus: null,
  sceneKey: 0,
  walk: null,
  exitWalk: () => exitWalk(),
  activity: null,
  clouds: [],
  showCaptures: true,
  selection: [],
  tool: 'select',
  comments: [],
  look: { walls: 'cutaway', levels: 'auto', light: 'studio' },
  checks: [],
  setAside: { dismissed: [], acked: [] },
  ctxTab: 'selection',
  frameReq: null,
}))

const set = useStudio.setState
const get = useStudio.getState

// ------------------------------------------------------------------ scene + focus

const clone = <T,>(v: T): T => structuredClone(v)

function render(model: Model) {
  showScene(compileScene(model))
  set((s) => ({ model, sceneKey: s.sceneKey + 1 }))
  void refreshChecks()
  void import('./actions').then((m) => m.loadAssets(model)).catch(() => {})
}

/** Run the checker on the model on screen (against the as-built head, for moves like a toilet's drain). */
export async function refreshChecks() {
  const model = get().model
  if (!model) return
  const reference = await asBuiltModel().catch(() => null)
  if (get().model !== model) return // a newer version is already on screen
  set({ checks: runChecks(model, { asBuilt: reference }) })
}

/** Ask the plan to frame these points (switching to the plan and that level). */
export function frameOn(level: string, pts: [number, number][]) {
  if (!pts.length) return
  set((s) => ({ view: 'plan', levelId: level, frameReq: { level, pts, key: (s.frameReq?.key ?? 0) + 1 } }))
}

/** Set an issue aside in this scheme (kept in the database so it stays set aside). */
export async function setIssueAside(id: string, how: 'dismissed' | 'acked', on = true) {
  const { repo, schemeId, setAside } = get()
  const next = { ...setAside, [how]: on ? [...new Set([...setAside[how], id])] : setAside[how].filter((x) => x !== id) }
  set({ setAside: next })
  if (repo && schemeId) await repo.setSetting(`checks_aside:${schemeId}`, JSON.stringify(next)).catch(() => {})
}

/** Recompile the current model (after generated 3D models finish loading). */
export function rerender() {
  const m = get().model
  if (m) showScene(compileScene(m))
}

export function computeFocus(): Focus | null {
  const { model, levelId, roomId, view } = get()
  if (!model) return null
  const levels = [...model.levels].sort((a, b) => a.elev - b.elev)
  const room = roomId ? model.rooms.find((r) => r.id === roomId) : null
  const lvId = room?.level ?? levelId
  const lv = levels.find((l) => l.id === lvId) ?? null
  const elev = lv ? lv.elev : 0
  let pts: [number, number][] = []
  if (room) pts = room.polygon
  else {
    const walls = model.walls.filter((w) => !lv || w.level === lv.id)
    for (const w of walls) pts.push(w.a, w.b)
  }
  if (!pts.length) return null
  const b = polygonBounds(pts)
  const topLevel = levels[levels.length - 1]
  const top = lv ? elev + lv.ceiling : topLevel ? topLevel.elev + topLevel.ceiling : 108
  return {
    key: `${roomId ?? ''}|${lvId ?? ''}|${view}|${Date.now()}`,
    levelId: lv ? `level_${lv.id}` : null,
    box: [b.x0 * IN, elev * IN, b.y0 * IN, b.x1 * IN, (lv ? elev + 36 : top * 0.5) * IN, b.y1 * IN],
    view,
  }
}

export function enterWalk() {
  const { model, roomId, levelId } = get()
  if (!model) return
  const start = walkStart(model, roomId, levelId)
  set({ walk: { key: Date.now(), ...start }, levelId: start.levelId })
  const v = useViewer.getState()
  v.setLevelMode('solo')
  v.setSelection({ levelId: `level_${start.levelId}` as any, selectedIds: [] })
}

export function exitWalk() {
  if (!get().walk) return
  set({ walk: null })
  set({ focus: computeFocus() })
}

export function focusOn(opts: { levelId?: string | null; roomId?: string | null; view?: '3d' | 'plan' }) {
  set({
    ...(opts.levelId !== undefined ? { levelId: opts.levelId } : {}),
    ...(opts.roomId !== undefined ? { roomId: opts.roomId } : {}),
    ...(opts.view ? { view: opts.view } : {}),
  })
  if (opts.roomId) {
    const r = get().model?.rooms.find((x) => x.id === opts.roomId)
    if (r) set({ levelId: r.level })
  }
  set({ focus: computeFocus() })
}

// ------------------------------------------------------------------ schemes and versions

export async function openScheme(id: string) {
  const { repo } = get()
  if (!repo) return
  set({ status: 'Loading scheme', error: null })
  try {
    const schemes = await repo.schemes()
    const scheme = schemes.find((s) => s.id === id) ?? schemes[0]
    if (!scheme) throw new Error('No schemes yet')
    const versions = await repo.versions(scheme.id)
    const headId = scheme.head_version && versions.some((v) => v.id === scheme.head_version) ? scheme.head_version : versions[versions.length - 1]?.id
    const stored = headId ? await repo.model(headId) : null
    const messages = await repo.messages(scheme.id)
    const comments = await repo.comments(scheme.id).catch(() => [])
    const aside = await repo.setting(`checks_aside:${scheme.id}`).catch(() => null)
    set({ setAside: (() => { try { return { dismissed: [], acked: [], ...JSON.parse(aside ?? '{}') } } catch { return { dismissed: [], acked: [] } } })() })
    await repo.setSetting('last_scheme', scheme.id)
    set({ schemes, schemeId: scheme.id, versions, headId: headId ?? null, messages, comments, selection: [], status: null })
    let model = stored && !isV1(stored) ? (stored as Model) : null
    if (stored && isV1(stored)) {
      // First open of a v0.3 scheme: migrate once and save it as a new version; the old one stays.
      set({ status: 'Updating this scheme to the new model' })
      const { model: migrated, report } = migrateV1(stored, { handChecked: handCheckedWalls() })
      console.info('[studio] migrated scheme', scheme.id, report)
      if (scheme.role == null && /^as-built/i.test(scheme.name)) await repo.saveScheme({ ...scheme, role: 'asbuilt' })
      await commitVersion(migrated, 'Updated to the new model (every wall and opening kept)', 'migration', { author: 'migration', parentId: headId ?? null, renderNow: false })
      set({ status: null, schemes: await repo.schemes() })
      model = migrated
    }
    if (model) {
      render(model)
      // Keep the current room if the new scheme has one with the same name.
      const prev = get().roomId
      const prevName = prev ? get().model?.rooms.find((r) => r.id === prev)?.name : null
      const same = prevName ? model.rooms.find((r) => r.name === prevName) : null
      focusOn({ roomId: same?.id ?? null, levelId: same ? same.level : get().levelId })
    }
  } catch (e) {
    set({ status: null, error: String((e as Error).message || e) })
  }
}

export async function commitVersion(
  model: Model,
  summary: string,
  source: string,
  opts: { author?: Author; ops?: Op[]; parentId?: string | null; renderNow?: boolean } = {},
): Promise<Version> {
  const { repo, schemeId, versions, schemes, headId } = get()
  if (!repo || !schemeId) throw new Error('No scheme open')
  const seq = (versions[versions.length - 1]?.seq ?? 0) + 1
  const v: Version = {
    id: sid('v'),
    scheme_id: schemeId,
    seq,
    summary,
    source,
    parent_id: opts.parentId !== undefined ? opts.parentId : headId,
    author: opts.author ?? (source === 'chat' ? 'ai' : 'user'),
    ops_json: opts.ops?.length ? JSON.stringify(opts.ops) : null,
    label: `v${seq} ${summary}`,
  }
  await repo.addVersion(v, model)
  const scheme = schemes.find((s) => s.id === schemeId)!
  await repo.saveScheme({ ...scheme, head_version: v.id })
  set({
    versions: [...versions, { ...v, created_at: new Date().toISOString() }],
    headId: v.id,
    schemes: schemes.map((s) => (s.id === schemeId ? { ...s, head_version: v.id } : s)),
  })
  if (opts.renderNow !== false) render(model)
  return v
}

/** The next version's label, so edits can carry it in their provenance before the version exists. */
export function nextVersionLabel(summary: string) {
  const { versions } = get()
  return `v${(versions[versions.length - 1]?.seq ?? 0) + 1} ${summary}`
}

function handCheckedWalls() {
  return (handChecked as unknown as { id: string; level: string; a: [number, number]; b: [number, number] }[]).map((w) => ({ id: w.id, level: w.level, a: w.a, b: w.b }))
}

/** A stored row as a v2 model (older rows are migrated in memory for viewing). */
export function asModel(stored: StoredModel): Model {
  return isV1(stored) ? migrateV1(stored, { handChecked: handCheckedWalls() }).model : (stored as Model)
}

export async function goToVersion(id: string) {
  const { repo, schemeId, schemes } = get()
  if (!repo || !schemeId) return
  const stored = await repo.model(id)
  if (!stored) return
  const model = asModel(stored)
  const scheme = schemes.find((s) => s.id === schemeId)!
  await repo.saveScheme({ ...scheme, head_version: id })
  set({ headId: id, schemes: schemes.map((s) => (s.id === schemeId ? { ...s, head_version: id } : s)) })
  render(model)
}

export function stepVersion(delta: -1 | 1) {
  const { versions, headId } = get()
  const i = versions.findIndex((v) => v.id === headId)
  const j = i + delta
  if (i < 0 || j < 0 || j >= versions.length) return
  void goToVersion(versions[j].id)
}

export async function newSchemeFromCurrent(name: string) {
  const { repo, model, schemes } = get()
  if (!repo || !model) return
  const id = sid('s')
  const scheme: Scheme = { id, name, head_version: null, sort: (schemes[schemes.length - 1]?.sort ?? 0) + 1, role: 'proposed' }
  await repo.saveScheme(scheme)
  const summary = `Copied from ${schemes.find((s) => s.id === get().schemeId)?.name ?? 'scheme'}`
  const v: Version = { id: sid('v'), scheme_id: id, seq: 1, summary, source: 'copy', parent_id: get().headId, author: 'user', label: `v1 ${summary}` }
  await repo.addVersion(v, clone(model))
  await repo.saveScheme({ ...scheme, head_version: v.id })
  await openScheme(id)
}

/** A new scheme from a model made elsewhere (a plan import); opens it. */
export async function createScheme(opts: { name: string; role: 'asbuilt' | 'proposed'; model: Model; summary: string; author: Author; source: string }) {
  const { repo, schemes } = get()
  if (!repo) throw new Error('No database')
  const id = sid('s')
  const scheme: Scheme = { id, name: uniqueSchemeName(opts.name), head_version: null, sort: (schemes[schemes.length - 1]?.sort ?? 0) + 1, role: opts.role }
  await repo.saveScheme(scheme)
  const v: Version = { id: sid('v'), scheme_id: id, seq: 1, summary: opts.summary, source: opts.source, parent_id: null, author: opts.author, label: `v1 ${opts.summary}` }
  await repo.addVersion(v, opts.model)
  await repo.saveScheme({ ...scheme, head_version: v.id })
  set({ schemes: await repo.schemes() })
  await openScheme(id)
  return { scheme: { ...scheme, head_version: v.id }, version: v }
}

// ------------------------------------------------------------------ conversation

export async function addMessage(m: Omit<Message, 'id' | 'scheme_id'>) {
  const { repo, schemeId } = get()
  if (!repo || !schemeId) return null
  const msg: Message = { id: sid('m'), scheme_id: schemeId, ...m, created_at: new Date().toISOString() }
  set((s) => ({ messages: [...s.messages, msg] }))
  await repo.addMessage(msg).catch((e) => console.error('[studio] message save failed', e))
  return msg
}

export async function uploadAttachment(file: File): Promise<Attachment> {
  const { sdk, schemeId } = get()
  const isImage = /^image\//.test(file.type)
  const blob = isImage ? await shrinkImage(file, 2000) : file
  const preview = isImage ? URL.createObjectURL(blob) : undefined
  const ext = isImage ? 'jpg' : (file.name.split('.').pop() || 'bin').toLowerCase()
  const safe = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 40) || 'file'
  const path = `velda-studio/uploads/${schemeId ?? 'scheme'}/${Date.now().toString(36)}-${safe}.${ext}`
  if (sdk) await sdk.upload(path, await toBase64(blob), isImage ? 'image/jpeg' : file.type || 'application/octet-stream')
  return { path, name: file.name, type: isImage ? 'image/jpeg' : file.type || 'file', preview }
}

/** A video becomes about 16 sharp frames uploaded as photos (the video itself is too big to keep). */
export async function uploadVideo(file: File, progress: (label: string) => void): Promise<Attachment[]> {
  const { videoFrames } = await import('../lib/capture')
  const frames = await videoFrames(file, 16, (k) => progress(`${file.name}: frame ${k} of 16`))
  const out: Attachment[] = []
  const base = file.name.replace(/\.[^.]+$/, '')
  for (let i = 0; i < frames.length; i++) {
    progress(`${file.name}: uploading ${i + 1} of ${frames.length}`)
    const f = new File([frames[i]], `${base}-frame-${String(i + 1).padStart(2, '0')}.jpg`, { type: 'image/jpeg' })
    out.push(await uploadAttachment(f))
  }
  return out
}

/** Ops the app could not apply last turn; Velda hears about them next turn so it never claims them. */
let skippedLastTurn: string[] = []
let asBuiltCache: { id: string; model: Model } | null = null

/** The head of the as-built scheme (for checks that compare with the house as it is, like toilet drains). */
async function asBuiltModel(): Promise<Model | null> {
  const { repo, schemes } = get()
  const s = schemes.find((x) => x.role === 'asbuilt' || (x.role == null && /^as-built/i.test(x.name)))
  if (!repo || !s?.head_version) return null
  if (asBuiltCache?.id === s.head_version) return asBuiltCache.model
  const stored = await repo.model(s.head_version).catch(() => null)
  const model = stored && !isV1(stored) ? (stored as Model) : null
  if (model) asBuiltCache = { id: s.head_version, model }
  return model
}

/** Send a chat message. `forVelda` replaces the text in Velda's prompt only (ids she needs, words N8 does not). */
export async function send(text: string, attachments: Attachment[] = [], opts: { forVelda?: string } = {}) {
  const { sdk, model, thinking } = get()
  const shown = text.trim()
  const body = opts.forVelda?.trim() || shown
  if ((!body && !attachments.length) || thinking || !model) return
  const history = get().messages
  await addMessage({ role: 'user', body: shown || '(photo)', attachments })
  if (!sdk) {
    await addMessage({ role: 'assistant', body: 'Velda needs Toolbelt to answer. Open this page inside Toolbelt.' })
    return
  }
  const room = get().roomId ? model.rooms.find((r) => r.id === get().roomId) : null
  const modelName = pickModel(body, attachments)
  set({ thinking: { model: modelName, started: Date.now() } })
  try {
    const { runChecks, checksFor } = await import('../analysis/checks')
    const { plain } = await import('./editor')
    const asBuilt = isAsBuilt()
    const reference = await asBuiltModel()
    const focus = { roomId: room?.id ?? null, roomName: room?.name ?? null, level: room?.level ?? get().levelId }
    const promptFor = (m: Model, extra: Partial<Parameters<typeof buildPrompt>[0]> = {}) =>
      buildPrompt({
        model: m,
        text: body || 'See the attached photos.',
        attachments,
        history,
        focus,
        asBuilt: isAsBuilt(),
        checks: runChecks(m, { asBuilt: reference }),
        recentVersions: get().versions.slice(-5).map((v) => v.summary),
        skipped: skippedLastTurn,
        ...extra,
      })
    const ans = await askVelda(sdk, promptFor(model), modelName)
    skippedLastTurn = []
    let versionId: string | null = null
    let note = ''
    let reply = ans.reply
    let question = ans.question
    let meta: MessageMeta | undefined
    const { splitOps, runActions } = await import('./actions')
    const { model: modelOps, actions, turn } = splitOps(ans.ops)
    const research = turn.filter((o) => o.op === 'research' && o.query)
    if (research.length) meta = { research: research.map((o) => String(o.query)) }
    // Products Velda found become cards in the reply, each with a Place button.
    const products = research
      .flatMap((o) => (Array.isArray(o.results) ? o.results : []))
      .filter((p: any) => p && typeof p.title === 'string' && typeof p.url === 'string' && /^https?:\/\//.test(p.url))
      .slice(0, 12)
      .map((p: any) => ({
        title: String(p.title).slice(0, 120),
        url: String(p.url),
        ...(p.type ? { type: String(p.type) } : {}),
        ...(Number(p.w) > 0 ? { w: Number(p.w) } : {}),
        ...(Number(p.d) > 0 ? { d: Number(p.d) } : {}),
        ...(p.price ? { price: String(p.price) } : {}),
        ...(typeof p.image === 'string' && /^https:\/\//.test(p.image) ? { image: p.image } : {}),
        room: room?.id ?? null,
      }))
    if (products.length) meta = { ...meta, products }
    const unclear = (list: string[]) => list.map((x) => plain(x.replace(/^[a-z_0-9]+( [^:]*)?: /, ''))).join('; ')
    if (modelOps.length) {
      // Velda never edits the record of the house as it is today: design changes go to a new scheme.
      // The ops are tried first, so a request that changes nothing does not leave an empty copy.
      const records = modelOps.every((o) => ['note', 'field_dimension', 'update_inspiration', 'remove_inspiration'].includes(o.op))
      const branching = asBuilt && !records
      const summary = ans.summary || 'Change from Velda'
      // A product Velda placed from a link also becomes an inspiration card (07 section 6).
      const products = productCards(modelOps, get().model!)
      if (products.length) modelOps.push({ op: 'add_inspiration', entries: products })
      const res = applyOps(get().model!, modelOps, { author: 'ai', versionLabel: branching ? `v2 ${summary}` : nextVersionLabel(summary), focusLevel: room?.level ?? get().levelId })
      if (branching && res.applied) {
        // The as-built chat says where the change went; the new scheme's chat starts with the request.
        const name = uniqueSchemeName(ans.summary || 'Option 1')
        await addMessage({ role: 'assistant', body: `I made that in a new scheme, "${name}", so the as-built record stays as it is.` })
        await newSchemeFromCurrent(name)
        await addMessage({ role: 'user', body: shown || '(photo)', attachments })
        if (!/new scheme/i.test(reply)) note += `\n\nI made this change in a new scheme, "${name}", so your as-built record stays as it is.`
      }
      if (res.applied) {
        const v = await commitVersion(res.model, summary, 'chat', { author: 'ai', ops: [...modelOps, ...research] })
        versionId = v.id
        // Save any theme Velda created or changed to the library for reuse.
        for (const t of Object.values(res.model.themes)) {
          const before = model.themes?.[t.id]
          if (!before || JSON.stringify(before) !== JSON.stringify(t)) await get().repo?.saveTheme(t).catch(() => {})
        }
        set({ library: await get().repo!.themes().catch(() => get().library) })
      }
      if (res.skipped.length) {
        console.warn('[studio] skipped ops', res.skipped)
        skippedLastTurn = res.skipped
        if (res.applied) note += `\n\nI could not do all of it: ${unclear(res.skipped)}.`
        else {
          // Nothing changed, so Velda's reply (which describes the change) would not be true.
          reply = `I could not apply that to the model: ${unclear(res.skipped)}. Try saying it another way.`
          question = null
        }
      }
      const said = res.notes.filter((n) => !/^Engineer to confirm/.test(n) && !/^Kept |^Replaced /.test(n)).map(plain)
      if (res.applied && said.length) note += `\n\n${said.join(' ')}`
    }
    const propose = turn.find((o) => o.op === 'propose')
    if (propose) {
      const made = await proposeOptions(propose, room?.id ?? null)
      if (made.choices.length) meta = { ...meta, choices: made.choices }
      if (made.skipped.length) note += `\n\nSome of the options did not fully apply: ${unclear(made.skipped)}.`
    }
    const analyze = turn.find((o) => o.op === 'analyze')
    if (analyze) {
      // Two steps: the page ran Velda's ops; now the checker runs and Velda writes the reply from it.
      const now = get().model!
      const scopeRoom = analyze.scope && analyze.scope !== 'house' ? (now.rooms.find((r) => r.id === analyze.scope || r.name.toLowerCase() === String(analyze.scope).toLowerCase()) ?? null) : analyze.scope === 'house' ? null : room
      const issues = checksFor(now, scopeRoom?.id ?? null, { asBuilt: reference })
      set({ thinking: { model: modelName, started: Date.now() } })
      const ans2 = await askVelda(sdk, promptFor(now, { analysis: { scope: scopeRoom ? `the ${scopeRoom.name}` : 'the house', issues, changed: ans.summary } }), modelName)
      reply = ans2.reply || reply
      question = ans2.question ?? question
      const fixOps = splitOps(ans2.ops).model
      if (fixOps.length) {
        const res = applyOps(get().model!, fixOps, { author: 'ai', versionLabel: nextVersionLabel(ans2.summary || 'Fixes from the checks'), focusLevel: room?.level ?? get().levelId })
        if (res.applied) versionId = (await commitVersion(res.model, ans2.summary || 'Fixes from the checks', 'chat', { author: 'ai', ops: fixOps })).id
        if (res.skipped.length) skippedLastTurn = [...skippedLastTurn, ...res.skipped]
      }
    }
    await addMessage({
      role: 'assistant',
      body: (reply || (question ? '' : 'Done.')) + (question ? `${reply ? '\n\n' : ''}${question.text}` : '') + note,
      version_id: versionId,
      chips: question?.options ?? [],
      ...(meta ? { meta } : {}),
    })
    if (actions.length) {
      set({ thinking: null })
      await runActions(actions)
    }
  } catch (e) {
    await addMessage({ role: 'assistant', body: `Something went wrong reaching Velda: ${(e as Error).message}. Your model is unchanged.` })
  } finally {
    set({ thinking: null })
  }
}

/** Inspiration cards for products Velda placed from a link (props.url and props.image). */
function productCards(ops: Op[], model: Model): Inspiration[] {
  const out: Inspiration[] = []
  for (const o of ops) {
    const it = o.op === 'add_item' ? o : o.op === 'place' && o.item ? { ...o.item, room: o.room } : null
    const props = it?.props
    if (!props || typeof props.url !== 'string' || typeof props.image !== 'string' || !/^https?:/.test(props.image)) continue
    const room = it.room ? model.rooms.find((r) => r.id === it.room || r.name.toLowerCase() === String(it.room).toLowerCase()) : null
    let source = 'link'
    try {
      source = new URL(props.url).hostname.replace(/^www\./, '')
    } catch {}
    out.push({ id: sid('insp'), kind: 'product', url: props.url, image: props.image, title: String(it.label ?? 'Product'), source, tags: { style: [], palette: [], materials: [], fixtures: [String(it.kind ?? 'item').replace('_', ' ')] }, rooms: room ? [room.id] : [], addedBy: 'ai', createdAt: new Date().toISOString() })
  }
  return out
}

/** Velda's design options: one new scheme per option, branched from the head of this one. */
export async function proposeOptions(op: Op, roomId: string | null) {
  const { repo, model, headId, schemeId, schemes, levelId } = get()
  const choices: NonNullable<MessageMeta['choices']> = []
  const skipped: string[] = []
  if (!repo || !model) return { choices, skipped }
  const { opKind } = await import('../model/table')
  const level = roomId ? (model.rooms.find((r) => r.id === roomId)?.level ?? levelId) : levelId
  let sort = (schemes[schemes.length - 1]?.sort ?? 0) + 1
  const from = schemes.find((s) => s.id === schemeId)?.name ?? 'this scheme'
  for (const [i, opt] of (Array.isArray(op.options) ? op.options : []).slice(0, 3).entries()) {
    const label = String(opt?.label || `Option ${i + 1}`).slice(0, 60)
    const ops = (Array.isArray(opt?.ops) ? opt.ops : []).filter((o: Op) => o && opKind(o.op) === 'model')
    const res = applyOps(model, ops, { author: 'ai', versionLabel: `v1 ${label}`, focusLevel: level })
    skipped.push(...res.skipped.map((x) => `${label}: ${x}`))
    if (!res.applied) continue
    const id = sid('s')
    const name = uniqueSchemeName(label)
    const scheme: Scheme = { id, name, head_version: null, sort: sort++, role: 'proposed' }
    await repo.saveScheme(scheme)
    const v: Version = { id: sid('v'), scheme_id: id, seq: 1, summary: `${label} (from ${from})`, source: 'propose', parent_id: headId, author: 'ai', ops_json: JSON.stringify(ops), label: `v1 ${label}` }
    await repo.addVersion(v, res.model)
    await repo.saveScheme({ ...scheme, head_version: v.id })
    set({ schemes: [...get().schemes, { ...scheme, head_version: v.id }] })
    choices.push({ label, scheme_id: id, room: roomId, level })
  }
  return { choices, skipped }
}

/**
 * After a capture: Velda looks at the photos, the measured top-down plan and the model, and edits the
 * room to match (observe and build); then it looks at the rebuilt room from inside and fixes what
 * still differs (verify). After AWSM's observe, build, verify loop, with one revision.
 */
export async function observeAndBuild(opts: { capture: any; planPath: string; room: { id: string; name: string; level: string } }) {
  const { sdk } = get()
  const model = get().model
  if (!sdk || !model) return
  const an = opts.capture.analysis
  const frames = (opts.capture.media as string[]).filter((_, i, arr) => arr.length <= 8 || i % Math.ceil(arr.length / 8) === 0).slice(0, 8)
  const attachments: Attachment[] = [
    { path: opts.planPath, name: 'Measured top-down plan of the capture', type: 'image/png' },
    ...frames.map((p, i) => ({ path: p, name: `Photo ${i + 1} of the room`, type: 'image/jpeg' })),
  ]
  const text = `I just captured the ${opts.room.name} (room ${opts.room.id}) with photos. Measured from the 3D reconstruction: ${an.widthIn}" by ${an.depthIn}" wall to wall${
    an.ceilingIn ? `, ceiling ${an.ceilingIn}"` : ''
  }. The capture was lined up with the plan using a quarter turn of ${an.quarter} (its x axis along the plan's ${an.quarter % 2 ? 'y' : 'x'} axis).
OBSERVE: look at every photo and the top-down plan. List to yourself the walls, door and window openings, and every fixture you see (vanity and sinks, tub, shower and glass, toilet, linen, mirrors), with sizes from the measurements and the photos.
BUILD: return operations that make the ${opts.room.name} in the model match the room as it is today: move or resize its walls to the measured size, put openings where the photos show them, and add, move or resize fixtures. Use real sizes. Keep fixture ids when they are the same thing.
If the photos show the capture is turned the wrong way against the plan (for example the window is on the wrong side), also return {"op":"capture_align","quarter":0|1|2|3}.
In reply, tell N8 in two or three sentences what you measured and changed, and anything you could not see.`
  const room = model.rooms.find((r) => r.id === opts.room.id)
  set({ thinking: { model: DEEP_MODEL, started: Date.now() }, activity: null })
  try {
    const ans = await askVelda(sdk, buildPrompt({ model, text, attachments, history: [], focus: { roomId: room?.id ?? null, roomName: room?.name ?? null, level: room?.level ?? null } }), DEEP_MODEL)
    const { splitOps, runActions } = await import('./actions')
    const { model: modelOps, actions } = splitOps(ans.ops)
    let versionId: string | null = null
    if (modelOps.length) {
      const res = applyOps(get().model!, modelOps, { author: 'ai', versionLabel: nextVersionLabel(ans.summary || `${opts.room.name} as captured`) })
      if (res.applied) versionId = (await commitVersion(res.model, ans.summary || `${opts.room.name} as captured`, 'capture', { author: 'ai', ops: modelOps })).id
    }
    if (actions.length) await runActions(actions)
    await addMessage({ role: 'assistant', body: ans.reply || `I measured the ${opts.room.name.toLowerCase()} and updated the model.`, version_id: versionId, chips: ['Show my photo remodeled with the theme', 'Walk through it'] })
    if (versionId) await verifyCapture(opts, frames)
  } finally {
    set({ thinking: null })
  }
}

async function verifyCapture(opts: { room: { id: string; name: string; level: string } }, frames: string[]) {
  const { sdk, model } = get()
  if (!sdk || !model) return
  const { snapshotView } = await import('./ViewerExtras')
  const { walkStart } = await import('./Walk')
  set({ activity: { text: 'Checking the model against your photos', started: Date.now() } })
  try {
    // Two views from inside the room, looking down its length both ways.
    const s = walkStart(model, opts.room.id, opts.room.level)
    const views: Attachment[] = []
    for (const [k, yaw] of [s.yaw, s.yaw + Math.PI].entries()) {
      const q = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]
      const blob = await snapshotView(1280, 960, { position: [s.x, s.y + 1.6, s.z], quaternion: q, fov: 70 })
      const path = `velda-studio/captures/verify-${Date.now().toString(36)}-${k}.png`
      const b64 = await new Promise<string>((ok) => {
        const r = new FileReader()
        r.onload = () => ok(String(r.result).split(',')[1] ?? '')
        r.readAsDataURL(blob)
      })
      await sdk.upload(path, b64, 'image/png')
      views.push({ path, name: `Model view ${k + 1} from inside the ${opts.room.name}`, type: 'image/png' })
    }
    const text = `VERIFY: the first ${views.length} images are views of the rebuilt ${opts.room.name} from inside the model; the rest are N8's photos of the real room. Compare them. If walls, openings or fixtures are clearly in the wrong place, the wrong size or missing, return operations that fix only those. If it matches well enough, return no operations. Reply in one sentence.`
    const ans = await askVelda(
      sdk,
      buildPrompt({ model, text, attachments: [...views, ...frames.slice(0, 6).map((p, i) => ({ path: p, name: `Photo ${i + 1}`, type: 'image/jpeg' }))], history: [], focus: { roomId: opts.room.id, roomName: opts.room.name, level: opts.room.level } }),
      DEEP_MODEL,
    )
    const { splitOps } = await import('./actions')
    const { model: modelOps } = splitOps(ans.ops)
    if (modelOps.length) {
      const res = applyOps(get().model!, modelOps, { author: 'ai', versionLabel: nextVersionLabel(ans.summary || `${opts.room.name} checked against photos`) })
      if (res.applied) {
        const v = await commitVersion(res.model, ans.summary || `${opts.room.name} checked against photos`, 'verify', { author: 'ai', ops: modelOps })
        await addMessage({ role: 'assistant', body: ans.reply || 'I compared the model with your photos and fixed what was off.', version_id: v.id })
      }
    }
  } catch (e) {
    console.warn('[studio] verify skipped', e)
  } finally {
    set({ activity: null })
  }
}

/** The scheme that records the house as it is today. */
export function isAsBuilt() {
  const { schemes, schemeId } = get()
  const s = schemes.find((x) => x.id === schemeId)
  return !!s && (s.role === 'asbuilt' || (s.role == null && /^as-built/i.test(s.name)))
}

export function uniqueSchemeName(base: string) {
  const names = new Set(get().schemes.map((s) => s.name))
  if (!names.has(base)) return base
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`
}

export function isDeep(model: string) {
  return model === DEEP_MODEL
}

// ------------------------------------------------------------------ helpers

async function shrinkImage(file: File, max: number): Promise<Blob> {
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
    return await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), 'image/jpeg', 0.86))
  } finally {
    URL.revokeObjectURL(url)
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((ok, bad) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result).split(',')[1] ?? '')
    r.onerror = bad
    r.readAsDataURL(blob)
  })
}
