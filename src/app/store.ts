// App state and actions: schemes, versions, conversation, focus.
import { create } from 'zustand'
import { DEEP_MODEL, askVelda, buildPrompt, pickModel } from '../lib/agent'
import { compileScene } from '../lib/compile'
import { type StudioModel, clone, polygonBounds, sid } from '../lib/model'
import { applyOps } from '../lib/ops'
import type { Theme } from '../lib/theme'
import { IN } from '../lib/units'
import type { Attachment, Message, Repo, Scheme, Version } from '../repo'
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
  model: StudioModel | null
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
}

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
}))

const set = useStudio.setState
const get = useStudio.getState

// ------------------------------------------------------------------ scene + focus

function render(model: StudioModel) {
  showScene(compileScene(model))
  set((s) => ({ model, sceneKey: s.sceneKey + 1 }))
  void import('./actions').then((m) => m.loadAssets(model)).catch(() => {})
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
  const top = lv ? elev + model.ceiling : levels.length ? levels[levels.length - 1].elev + model.ceiling : model.ceiling
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
    const model = headId ? await repo.model(headId) : null
    const messages = await repo.messages(scheme.id)
    await repo.setSetting('last_scheme', scheme.id)
    set({ schemes, schemeId: scheme.id, versions, headId: headId ?? null, messages, status: null })
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

export async function commitVersion(model: StudioModel, summary: string, source: string): Promise<Version> {
  const { repo, schemeId, versions, schemes } = get()
  if (!repo || !schemeId) throw new Error('No scheme open')
  const v: Version = { id: sid('v'), scheme_id: schemeId, seq: (versions[versions.length - 1]?.seq ?? 0) + 1, summary, source }
  await repo.addVersion(v, model)
  const scheme = schemes.find((s) => s.id === schemeId)!
  await repo.saveScheme({ ...scheme, head_version: v.id })
  set({
    versions: [...versions, { ...v, created_at: new Date().toISOString() }],
    headId: v.id,
    schemes: schemes.map((s) => (s.id === schemeId ? { ...s, head_version: v.id } : s)),
  })
  render(model)
  return v
}

export async function goToVersion(id: string) {
  const { repo, schemeId, schemes } = get()
  if (!repo || !schemeId) return
  const model = await repo.model(id)
  if (!model) return
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
  const scheme: Scheme = { id, name, head_version: null, sort: (schemes[schemes.length - 1]?.sort ?? 0) + 1 }
  await repo.saveScheme(scheme)
  const v: Version = { id: sid('v'), scheme_id: id, seq: 1, summary: `Copied from ${schemes.find((s) => s.id === get().schemeId)?.name ?? 'scheme'}`, source: 'copy' }
  await repo.addVersion(v, clone(model))
  await repo.saveScheme({ ...scheme, head_version: v.id })
  await openScheme(id)
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

export async function send(text: string, attachments: Attachment[] = []) {
  const { sdk, model, thinking } = get()
  const body = text.trim()
  if ((!body && !attachments.length) || thinking || !model) return
  const history = get().messages
  await addMessage({ role: 'user', body: body || '(photo)', attachments })
  if (!sdk) {
    await addMessage({ role: 'assistant', body: 'Velda needs Toolbelt to answer. Open this page inside Toolbelt.' })
    return
  }
  const room = get().roomId ? model.rooms.find((r) => r.id === get().roomId) : null
  const modelName = pickModel(body, attachments)
  set({ thinking: { model: modelName, started: Date.now() } })
  try {
    const prompt = buildPrompt({
      model,
      text: body || 'See the attached photos.',
      attachments,
      history,
      focus: { roomId: room?.id ?? null, roomName: room?.name ?? null, level: room?.level ?? get().levelId },
    })
    const ans = await askVelda(sdk, prompt, modelName)
    let versionId: string | null = null
    let note = ''
    const { splitOps, runActions } = await import('./actions')
    const { model: modelOps, actions } = splitOps(ans.ops)
    if (modelOps.length) {
      const res = applyOps(get().model!, modelOps)
      if (res.applied) {
        const v = await commitVersion(res.model, ans.summary || 'Change from Velda', 'chat')
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
        if (!res.applied) note = "\n\nI couldn't apply that change to the model. Try describing it another way."
      }
    }
    await addMessage({
      role: 'assistant',
      body: (ans.reply || (ans.question ? '' : 'Done.')) + (ans.question ? `${ans.reply ? '\n\n' : ''}${ans.question.text}` : '') + note,
      version_id: versionId,
      chips: ans.question?.options ?? [],
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
      const res = applyOps(get().model!, modelOps)
      if (res.applied) versionId = (await commitVersion(res.model, ans.summary || `${opts.room.name} as captured`, 'capture')).id
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
      const res = applyOps(get().model!, modelOps)
      if (res.applied) {
        const v = await commitVersion(res.model, ans.summary || `${opts.room.name} checked against photos`, 'verify')
        await addMessage({ role: 'assistant', body: ans.reply || 'I compared the model with your photos and fixed what was off.', version_id: v.id })
      }
    }
  } catch (e) {
    console.warn('[studio] verify skipped', e)
  } finally {
    set({ activity: null })
  }
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
