// The page's side of inspiration (06 section 6): adding cards from a drop or a link (one version),
// showing their pictures, filing them under rooms, and asking Velda for a theme from a selection.
import { type Source, ingest } from '../inspiration/ingest'
import { classifyLink } from '../inspiration/pinterest'
import type { Inspiration } from '../model/types'
import type { Attachment } from '../repo'
import { handEdit } from './editor'
import { addMessage, send, useStudio } from './store'

/** The drag type of an inspiration card (dropped on a room in the plan). */
export const CARD_MIME = 'application/x-velda-inspiration'

const get = useStudio.getState
const set = useStudio.setState

/** Pictures dropped in the local preview (no Velda storage): shown from memory until reload. */
const localPictures = new Map<string, string>()

async function upload(path: string, blob: Blob) {
  const sdk = get().sdk
  if (!sdk) {
    localPictures.set(path, URL.createObjectURL(blob))
    return
  }
  const b64 = await new Promise<string>((ok, bad) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result).split(',')[1] ?? '')
    r.onerror = bad
    r.readAsDataURL(blob)
  })
  await sdk.upload(path, b64, blob.type || 'image/jpeg')
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Read pictures and links into inspiration cards for these rooms, tag them, and save one version. */
export async function addInspiration(sources: Source[], roomIds: string[], shown: Attachment[] = []) {
  const model = get().model
  if (!model || !sources.length) return null
  const rooms = roomIds.map((id) => model.rooms.find((r) => r.id === id)).filter(Boolean)
  const where = rooms.length ? `the ${rooms.map((r) => r!.name).join(' and the ')}` : 'the house'
  const started = Date.now()
  set({ activity: { text: 'Reading your inspiration', started } })
  await addMessage({ role: 'user', body: `Inspiration for ${where}: ${describe(sources)}`, attachments: shown })
  try {
    const r = await ingest(sources, roomIds, { sdk: get().sdk, upload, progress: (text) => set({ activity: { text, started } }) })
    const pics = r.entries.filter((e) => e.kind !== 'board')
    const boards = r.entries.filter((e) => e.kind === 'board')
    let versionId: string | null = null
    if (r.entries.length) {
      const summary = `Inspiration for ${rooms.length === 1 ? rooms[0]!.name : where.replace(/^the /, '')} (${plural(pics.length, 'picture')})`
      const res = await handEdit([{ op: 'add_inspiration', entries: r.entries }], summary)
      if (res.applied) versionId = get().headId
    }
    const common = threads(pics)
    await addMessage({
      role: 'assistant',
      body: [
        r.entries.length
          ? `Added ${[pics.length && plural(pics.length, 'picture'), boards.length && `from ${boards.map((b) => `the board "${b.title}"`).join(' and ')}`].filter(Boolean).join(' ')} to ${where}'s inspiration.${common ? ` What they share: ${common}.` : ''}`
          : "I couldn't add anything from that.",
        ...r.said,
        r.entries.length ? 'They are in the Inspiration tab. Pick a few there and choose "Make a theme from these", or ask me.' : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      version_id: versionId,
      chips: r.entries.length && rooms.length === 1 ? [`Make a theme for the ${rooms[0]!.name} from this inspiration`] : [],
    })
    return r
  } finally {
    set({ activity: null })
  }
}

function describe(sources: Source[]) {
  const picture = (s: Source) => 'file' in s || 'path' in s || ('url' in s && classifyLink(s.url).kind === 'image')
  const files = sources.filter(picture).length
  const links = sources.length - files
  return [files && plural(files, 'picture'), links && plural(links, 'link')].filter(Boolean).join(' and ')
}

/** The style words, materials and fixtures most of the cards share. */
export function threads(cards: Inspiration[]) {
  const count = new Map<string, number>()
  for (const c of cards) for (const w of new Set([...c.tags.style, ...c.tags.materials, ...c.tags.fixtures].map((x) => x.toLowerCase()))) count.set(w, (count.get(w) ?? 0) + 1)
  const need = Math.max(2, Math.ceil(cards.length / 3))
  return [...count.entries()]
    .filter(([, n]) => n >= need)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w)
    .join(', ')
}

const signed = new Map<string, { url: string; until: number }>()
/** A URL an <img> can show: the picture's own URL, a signed link to Velda storage, or a local copy. */
export async function pictureUrl(image: string | undefined): Promise<string | null> {
  if (!image) return null
  if (/^(https?:|blob:|data:)/.test(image)) return image
  if (localPictures.has(image)) return localPictures.get(image)!
  const hit = signed.get(image)
  if (hit && hit.until > Date.now()) return hit.url
  const sdk = get().sdk
  if (!sdk) return null
  const url = await sdk.signedUrl(image, 7200).catch(() => null)
  if (url) signed.set(image, { url, until: Date.now() + 6600_000 })
  return url
}

/** File a card under a room (a drag onto the plan, or the card's room list). */
export function fileUnder(id: string, roomId: string) {
  const room = get().model?.rooms.find((r) => r.id === roomId)
  return handEdit([{ op: 'update_inspiration', id, add_room: roomId }], `Inspiration filed under ${room?.name ?? 'a room'}`)
}

/** Ask Velda for a theme from the picked cards, applied to the room (one version, through the chat). */
export function themeFrom(cards: Inspiration[], roomId: string | null) {
  const room = roomId ? get().model?.rooms.find((r) => r.id === roomId) : null
  const where = room ? `the ${room.name}` : 'the house'
  const list = cards.map((c) => `${c.id} "${c.title ?? c.kind}"`).join(', ')
  const titles = cards.map((c) => `"${c.title ?? c.kind}"`).join(', ')
  if (room) useStudio.setState({ roomId: room.id })
  // N8 sees the titles; Velda also gets the card ids so she can find them in the model.
  return send(`Make a theme for ${where} from ${cards.length === 1 ? 'this inspiration card' : `these ${cards.length} inspiration cards`}: ${titles}.`, [], {
    forVelda: `Make a theme for ${where} from these inspiration cards: ${list}. Take its colors from their palettes (give each a role), name the materials, and apply it to ${where}.`,
  })
}
