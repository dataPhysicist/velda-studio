// The Rooms page's state and everything a person can do on it.
import { create } from 'zustand'
import { plainError } from '../app/errors'
import { ask as askVelda, type EditResult, type EngineId, finish, labelFor, runEdit, study as studyPhoto } from './ai'
import { type Backend, openBackend } from './backend'
import { DuckStore, MemoryStore, newId, type Photo, type Saved, type Store, type Version, type VersionMeta } from './db'
import { type House, loadHouse, onPlans, planFindings, plannedChanges, roomFacts, type RoomInfo, styleWords, themeOf } from './house'
import { differing, type Img } from './photo/compose'
import { jpegOf, pixels, prepare, thumbOfImg, urlOf } from './photo/canvas'

export const OTHER: RoomInfo = { id: 'other', name: 'Other photos', level: '', levelName: '', kind: 'other', w: 0, d: 0, sf: 0, ceiling: null, minor: false }

export type Pending = {
  result: EditResult
  base: Img
  baseVersion: string
  words: string
  label: string
  kind: VersionMeta['kind']
  /** Changed areas being kept (the rest are put back). */
  keep: number[]
  /** Put back everything outside the kept areas. */
  protect: boolean
  /** The picture as it would be saved. */
  preview: string
  final: Img
  brush: Brush | null
  refs: string[]
}

export type Brush = { mask: Float32Array; w: number; h: number }

type State = {
  status: string | null
  error: string | null
  be: Backend | null
  db: Store | null
  house: House | null
  /** Bumps when the saved designs finish loading. */
  plansAt: number
  page: 'home' | 'room' | 'questions'
  roomId: string | null
  photoId: string | null
  versionId: string | null
  photos: Photo[]
  versions: Version[]
  saved: Saved[]
  images: Record<string, string>
  busy: { text: string; started: number } | null
  pending: Pending | null
  toast: string | null
  studying: Record<string, boolean>
  asking: boolean
  /** Everything typed about each room this visit (so the designer's notes follow the conversation). */
  said: Record<string, string>
  engine: EngineId | null
}

export const useRooms = create<State>(() => ({
  status: 'Opening your rooms',
  error: null,
  be: null,
  db: null,
  house: null,
  plansAt: 0,
  page: 'home',
  roomId: null,
  photoId: null,
  versionId: null,
  photos: [],
  versions: [],
  saved: [],
  images: {},
  busy: null,
  pending: null,
  toast: null,
  studying: {},
  asking: false,
  said: {},
  engine: null,
}))

const get = useRooms.getState
const set = useRooms.setState
const pix = new Map<string, Img>()

export function roomInfo(id: string | null): RoomInfo | null {
  if (!id) return null
  if (id === OTHER.id) return OTHER
  return get().house?.rooms.find((r) => r.id === id) ?? null
}

function toast(text: string) {
  set({ toast: text })
  setTimeout(() => get().toast === text && set({ toast: null }), 6000)
}

function fail(what: string, e: unknown) {
  console.error('[rooms]', what, e)
  set({ busy: null })
  toast(`${what}: ${plainError(e)}.`)
}

export async function boot() {
  try {
    const be = await openBackend()
    set({ be, status: be.kind === 'toolbelt' ? 'Reading your floor plans' : 'Opening a local preview' })
    const db: Store = be.kind === 'toolbelt' ? new DuckStore(be) : new MemoryStore()
    onPlans(() => set({ plansAt: Date.now() }))
    const [house] = await Promise.all([loadHouse(be), db.init()])
    const [photos, versions, saved] = await Promise.all([db.photos(), db.versions(), db.saved()])
    set({ db, house, photos, versions, saved, status: null })
    ;(window as any).__rooms = { store: useRooms, be, db, actions: { addPhoto, change, keep, discard, go, look, question } }
  } catch (e) {
    console.error('[rooms] could not start', e)
    set({ status: null, error: `Rooms could not open: ${plainError(e)}. Reload the page to try again.` })
  }
}

export function go(page: State['page'], roomId: string | null = null) {
  if (get().pending && !confirmLeave()) return
  const photo = roomId ? get().photos.filter((p) => p.room_id === roomId).pop() : null
  set({ page, roomId, photoId: photo?.id ?? null, versionId: null, pending: null })
  if (photo) void openPhoto(photo.id)
  window.scrollTo(0, 0)
}

function confirmLeave() {
  // The change under review is not saved yet; leaving drops it, as Discard would.
  return true
}

export const versionsOf = (photoId: string) => get().versions.filter((v) => v.photo_id === photoId)

async function image(path: string): Promise<string> {
  const have = get().images[path]
  if (have) return have
  const url = await get().be!.getImage(path)
  if (!url) throw new Error('that picture is no longer in storage')
  set((s) => ({ images: { ...s.images, [path]: url } }))
  return url
}

async function basePixels(v: Version, photo: Photo): Promise<Img> {
  const have = pix.get(v.id)
  if (have) return have
  const img = await pixels(await image(v.path), photo.w, photo.h)
  pix.set(v.id, img)
  // Pixels are large; keep the few most recent.
  for (const k of [...pix.keys()].slice(0, -4)) pix.delete(k)
  return img
}

export async function openPhoto(photoId: string, versionId?: string) {
  const photo = get().photos.find((p) => p.id === photoId)
  if (!photo) return
  const list = versionsOf(photoId)
  const v = list.find((x) => x.id === (versionId ?? photo.head)) ?? list[list.length - 1]
  set({ photoId, versionId: v?.id ?? null, pending: null })
  if (v) await image(v.path).catch((e) => fail('The photo did not load', e))
  if (!photo.study && !get().studying[photoId]) void look(photoId)
}

export async function openVersion(id: string) {
  const v = get().versions.find((x) => x.id === id)
  if (!v) return
  set({ versionId: id, pending: null })
  await image(v.path).catch((e) => fail('The photo did not load', e))
}

export async function addPhoto(file: Blob, roomId: string) {
  const { be, db } = get()
  const room = roomInfo(roomId)
  if (!be || !db || !room) return
  set({ busy: { text: 'Adding your photo', started: Date.now() } })
  try {
    const p = await prepare(file)
    const photoId = newId('p')
    const vid = newId('v')
    const path = `velda-rooms/${photoId}/${vid}.jpg`
    await be.putImage(path, p.blob)
    const photo: Photo = { id: photoId, room_id: room.id, room_name: room.name, level: room.level, w: p.w, h: p.h, ratio: p.ratio, head: vid, study: null }
    const version: Version = { id: vid, photo_id: photoId, parent_id: null, seq: 0, label: 'Your photo', words: '', path, thumb: p.thumb, meta: { kind: 'photo' }, fav: false }
    await db.savePhoto(photo)
    await db.saveVersion(version)
    pix.set(vid, p.img)
    set((s) => ({
      photos: [...s.photos, photo],
      versions: [...s.versions, version],
      images: { ...s.images, [path]: urlOf(p.img) },
      page: 'room',
      roomId: room.id,
      photoId,
      versionId: vid,
      pending: null,
      busy: null,
    }))
    void look(photoId)
  } catch (e) {
    fail('The photo was not added', e)
  }
}

function contextFor(roomId: string) {
  const h = get().house
  const room = roomInfo(roomId)
  const onPlan = h && room && room.id !== OTHER.id
  return {
    room: room?.id === OTHER.id ? 'house' : (room?.name ?? 'room'),
    facts: onPlan ? roomFacts(h.asBuilt, room.id) : '',
    style: onPlan ? styleWords(themeOf(h.asBuilt, room.id)) : '',
    planned: onPlan ? plannedChanges(h, room.id).flatMap((p) => p.lines.map((l) => `${p.plan}: ${l}`)) : [],
    findings: onPlan ? planFindings(h, room.id).map((f) => f.body) : [],
  }
}

export type ChangeOpts = { brush?: Brush | null; refs?: Blob[]; kind?: VersionMeta['kind']; label?: string }

/** Ask for a change to the picture being looked at. The result waits for Keep or Discard. */
export async function change(words: string, o: ChangeOpts = {}) {
  const { be, photoId, versionId } = get()
  const photo = get().photos.find((p) => p.id === photoId)
  const v = get().versions.find((x) => x.id === versionId)
  if (!be || !photo || !v || !words.trim() || get().busy) return
  const started = Date.now()
  const status = (text: string) => set({ busy: { text, started } })
  status('Getting your photo ready')
  set((s) => ({ pending: null, said: { ...s.said, [photo.room_id]: `${s.said[photo.room_id] ?? ''} ${words}` } }))
  try {
    const base = await basePixels(v, photo)
    const tmp = `velda-rooms/tmp/${newId('t')}`
    const refs: string[] = []
    for (const [i, f] of (o.refs ?? []).slice(0, 3).entries()) {
      const r = await prepare(f)
      const path = `${tmp}-ref${i}.jpg`
      await be.putImage(path, r.blob)
      refs.push(path)
    }
    const cx = contextFor(photo.room_id)
    const result = await runEdit(be, { base, basePath: v.path, ratio: photo.ratio, words, cx, brush: o.brush ?? null, refs, engine: get().engine ?? undefined, tmp }, status)
    const an = result.analysis
    // A request about the whole picture, or a change that came back touching most of it, is kept whole.
    const protect = result.kind === 'full' && !result.whole && !!an && an.regions.length > 0 && an.changed < 0.6
    const keepIds = an?.keep ?? []
    const final = finish(base, result, keepIds, protect)
    set({
      busy: null,
      pending: { result, base, baseVersion: v.id, words, label: o.label ?? labelFor(words), kind: o.kind ?? 'change', keep: keepIds, protect, preview: urlOf(final), final, brush: o.brush ?? null, refs },
    })
  } catch (e) {
    fail('That change did not work', e)
  }
}

function refresh(p: Pending, keep: number[], protect: boolean) {
  const final = finish(p.base, p.result, keep, protect)
  set({ pending: { ...p, keep, protect, final, preview: urlOf(final) } })
}

/** Keep or put back one changed area of the picture under review. */
export function toggleArea(id: number) {
  const p = get().pending
  if (!p) return
  refresh(p, p.keep.includes(id) ? p.keep.filter((k) => k !== id) : [...p.keep, id], true)
}

export function setProtect(on: boolean) {
  const p = get().pending
  if (p) refresh(p, p.keep, on)
}

export async function keep() {
  const { be, db, pending: p, photoId } = get()
  const photo = get().photos.find((x) => x.id === photoId)
  if (!be || !db || !p || !photo) return
  set({ busy: { text: 'Saving', started: Date.now() } })
  try {
    const vid = newId('v')
    const path = `velda-rooms/${photo.id}/${vid}.jpg`
    await be.putImage(path, await jpegOf(p.final))
    const seq = Math.max(0, ...versionsOf(photo.id).map((x) => x.seq)) + 1
    const mode = p.result.kind === 'spot' ? 'spot' : p.protect ? 'kept' : 'whole'
    const version: Version = {
      id: vid,
      photo_id: photo.id,
      parent_id: p.baseVersion,
      seq,
      label: p.label,
      words: p.words,
      path,
      thumb: thumbOfImg(p.final),
      meta: { kind: p.kind, engine: p.result.engine, seconds: Math.round(p.result.seconds), mode, touched: Math.round(differing(p.base, p.final) * 1000) / 1000 },
      fav: false,
    }
    await db.saveVersion(version)
    const next = { ...photo, head: vid }
    await db.savePhoto(next)
    pix.set(vid, p.final)
    set((s) => ({
      versions: [...s.versions, version],
      photos: s.photos.map((x) => (x.id === photo.id ? next : x)),
      images: { ...s.images, [path]: p.preview },
      versionId: vid,
      pending: null,
      busy: null,
    }))
  } catch (e) {
    fail('The picture was not saved', e)
  }
}

export function discard() {
  set({ pending: null })
}

/** The same request again from the same picture (models give a different take each time). */
export async function again() {
  const p = get().pending
  if (!p) return
  await openVersion(p.baseVersion)
  await change(p.words, { brush: p.brush, kind: p.kind, label: p.label })
}

export async function star(id: string) {
  const v = get().versions.find((x) => x.id === id)
  if (!v || !get().db) return
  const next = { ...v, fav: !v.fav }
  set((s) => ({ versions: s.versions.map((x) => (x.id === id ? next : x)) }))
  await get().db!.saveVersion(next).catch((e) => fail('That was not saved', e))
}

export async function removeVersion(id: string) {
  const { db, photos } = get()
  const v = get().versions.find((x) => x.id === id)
  if (!db || !v || v.meta.kind === 'photo') return
  const photo = photos.find((p) => p.id === v.photo_id)!
  const left = versionsOf(v.photo_id).filter((x) => x.id !== id)
  const head = photo.head === id ? left[left.length - 1].id : photo.head
  try {
    await db.deleteVersion(id)
    if (head !== photo.head) await db.savePhoto({ ...photo, head })
    set((s) => ({ versions: s.versions.filter((x) => x.id !== id), photos: s.photos.map((p) => (p.id === photo.id ? { ...p, head } : p)) }))
    if (get().versionId === id) await openVersion(left[left.length - 1].id)
  } catch (e) {
    fail('That was not removed', e)
  }
}

export async function removePhoto(id: string) {
  const { db } = get()
  if (!db) return
  try {
    await db.deletePhoto(id)
    const roomId = get().photos.find((p) => p.id === id)?.room_id ?? null
    set((s) => ({ photos: s.photos.filter((p) => p.id !== id), versions: s.versions.filter((v) => v.photo_id !== id), photoId: null, versionId: null, pending: null }))
    const other = get().photos.filter((p) => p.room_id === roomId).pop()
    if (other) await openPhoto(other.id)
  } catch (e) {
    fail('The photo was not removed', e)
  }
}

/** Velda studies the photo: ideas to try and what a designer would notice. Saved with the photo. */
export async function look(photoId: string, again = false) {
  const { be, db } = get()
  const photo = get().photos.find((p) => p.id === photoId)
  if (!be || !db || !photo || get().studying[photoId] || (photo.study && !again)) return
  const first = versionsOf(photoId)[0]
  if (!first) return
  set((s) => ({ studying: { ...s.studying, [photoId]: true } }))
  try {
    const cx = contextFor(photo.room_id)
    const asked = versionsOf(photoId).map((v) => v.words).filter(Boolean)
    const result = await studyPhoto(be, { path: first.path, room: cx.room, facts: cx.facts, style: cx.style, planned: cx.planned, findings: cx.findings, asked })
    const cur = get().photos.find((p) => p.id === photoId)
    if (cur) {
      const next = { ...cur, study: result }
      await db.savePhoto(next)
      set((s) => ({ photos: s.photos.map((p) => (p.id === photoId ? next : p)) }))
    }
  } catch (e) {
    console.warn('[rooms] Velda could not study the photo', e)
    if (again) toast(`Velda could not look at the photo: ${plainError(e)}.`)
  } finally {
    set((s) => ({ studying: { ...s.studying, [photoId]: false } }))
  }
}

/** Save a note to the questions list, or take it off. */
export async function saveNote(n: Omit<Saved, 'room_id' | 'room_name' | 'done' | 'created_at'>, roomId: string) {
  const { db } = get()
  const room = roomInfo(roomId)
  if (!db || !room) return
  const have = get().saved.find((s) => s.id === n.id)
  try {
    if (have) {
      await db.deleteSaved(n.id)
      set((s) => ({ saved: s.saved.filter((x) => x.id !== n.id) }))
    } else {
      const row: Saved = { ...n, room_id: room.id, room_name: room.name, done: false }
      await db.saveSaved(row)
      set((s) => ({ saved: [...s.saved, row] }))
    }
  } catch (e) {
    fail('That was not saved', e)
  }
}

export async function setDone(id: string, done: boolean) {
  const row = get().saved.find((s) => s.id === id)
  if (!row || !get().db) return
  const next = { ...row, done }
  set((s) => ({ saved: s.saved.map((x) => (x.id === id ? next : x)) }))
  await get().db!.saveSaved(next).catch((e) => fail('That was not saved', e))
}

/** Ask Velda a question about the room; the answer is kept in the questions list. */
export async function question(q: string, roomId: string) {
  const { be, db, photoId } = get()
  const room = roomInfo(roomId)
  if (!be || !db || !room || !q.trim() || get().asking) return
  set((s) => ({ asking: true, said: { ...s.said, [roomId]: `${s.said[roomId] ?? ''} ${q}` } }))
  try {
    const cx = contextFor(roomId)
    const photo = get().photos.find((p) => p.id === photoId && p.room_id === roomId)
    const first = photo ? versionsOf(photo.id)[0] : null
    const a = await askVelda(be, q, { path: first?.path ?? null, room: cx.room, facts: cx.facts, style: cx.style, planned: cx.planned, findings: cx.findings })
    const row: Saved = { id: newId('q'), room_id: room.id, room_name: room.name, source: 'answer', title: q.trim(), body: a.answer, ask: a.ask, done: false }
    await db.saveSaved(row)
    set((s) => ({ saved: [...s.saved, row] }))
  } catch (e) {
    fail('Velda could not answer', e)
  } finally {
    set({ asking: false })
  }
}

export function download(versionId: string) {
  const v = get().versions.find((x) => x.id === versionId)
  const url = v && get().images[v.path]
  if (!v || !url) return
  const a = document.createElement('a')
  a.href = url
  a.download = `${(roomInfo(get().roomId)?.name ?? 'room').replace(/[^\w]+/g, '-').toLowerCase()}-${v.label.replace(/[^\w]+/g, '-').toLowerCase()}.jpg`
  document.body.appendChild(a)
  a.click()
  a.remove()
}
