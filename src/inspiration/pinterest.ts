// Pinterest links (07 section 6). A pin or a public board is read from Pinterest's public embed
// widget endpoints (widgets.pinterest.com/v3/pidgets), which answer the page directly with the
// pin's picture, description, source site and dominant color. No sign-in, no OAuth (not in 1.0).

export type LinkKind = { kind: 'pin'; id: string } | { kind: 'pin_short'; url: string } | { kind: 'board'; user: string; board: string } | { kind: 'image'; url: string } | { kind: 'url'; url: string }

const PIN_HOST = /^(?:[a-z]{2,3}\.)?pinterest\.(?:com|co\.uk|ca|com\.au|de|fr|es|it|jp|ie|nz|at|ch|pt|se|dk|cl|com\.mx)$/i
const NOT_BOARD = new Set(['pin', 'ideas', 'search', 'today', 'explore', 'business', 'settings', 'categories', 'topics', 'shopping', 'videos', 'news_hub', 'login', 'password'])

/** What a pasted link is: a pin, a short pin link, a board, or any other page. */
export function classifyLink(raw: string): LinkKind {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return { kind: 'url', url: raw.trim() }
  }
  if (/^pin\.it$/i.test(u.hostname)) return { kind: 'pin_short', url: u.href }
  // A picture itself (dragging an image out of another browser tab drops its address).
  if (/\.(jpe?g|png|webp|gif|avif)$/i.test(u.pathname) || /^i\.pinimg\.com$/i.test(u.hostname)) return { kind: 'image', url: u.href }
  if (!PIN_HOST.test(u.hostname)) return { kind: 'url', url: u.href }
  const parts = u.pathname.split('/').filter(Boolean)
  if (parts[0] === 'pin' && parts[1]) {
    // /pin/1234/ or /pin/some-title--1234/
    const id = /(\d{6,})\/?$/.exec(parts[1])?.[1]
    if (id) return { kind: 'pin', id }
  }
  if (parts.length >= 2 && !NOT_BOARD.has(parts[0]) && !NOT_BOARD.has(parts[1]) && !/^_/.test(parts[1])) return { kind: 'board', user: parts[0], board: parts[1] }
  return { kind: 'url', url: u.href }
}

export const pinInfoUrl = (id: string) => `https://widgets.pinterest.com/v3/pidgets/pins/info/?pin_ids=${encodeURIComponent(id)}`
export const boardPinsUrl = (user: string, board: string) => `https://widgets.pinterest.com/v3/pidgets/boards/${encodeURIComponent(user)}/${encodeURIComponent(board)}/pins/`

/** One pin as the app keeps it. */
export type PinData = { id: string; url: string; image: string; thumb: string; title: string; source: string; link: string | null; color: string | null }

const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()

/** At most n characters, cut at a word with "..." when it is longer. */
const clip = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, t.lastIndexOf(' ', n - 3) > n / 2 ? t.lastIndexOf(' ', n - 3) : n - 3).replace(/[\s,;:.]+$/, '')}...`)

function pinOf(p: any): PinData | null {
  if (!p || p.is_video) return null
  const big = p.images?.['564x'] ?? p.images?.['736x'] ?? p.images?.orig ?? p.images?.['237x']
  const small = p.images?.['237x'] ?? p.images?.['236x'] ?? big
  if (!big?.url) return null
  const text = decode(String(p.description ?? p.title ?? '')).replace(/^\|\s*/, '')
  return {
    id: String(p.id),
    url: `https://www.pinterest.com/pin/${p.id}/`,
    image: big.url,
    thumb: small.url,
    title: clip(text, 120) || (p.domain ? `From ${p.domain}` : 'Pinterest pin'),
    source: String(p.domain ?? 'pinterest.com'),
    link: p.link ? decode(String(p.link)) : null,
    color: /^#[0-9a-f]{6}$/i.test(p.dominant_color ?? '') ? String(p.dominant_color).toLowerCase() : null,
  }
}

/** A pin from the pins/info endpoint. */
export function parsePinInfo(json: any): PinData | null {
  return pinOf(Array.isArray(json?.data) ? json.data[0] : null)
}

/** A board and its pins from the boards/.../pins endpoint; the same picture pinned twice counts once. */
export function parseBoardPins(json: any): { board: { id: string; name: string; url: string; count: number; returned: number }; pins: PinData[] } | null {
  const d = json?.data
  if (!d?.board) return null
  const seen = new Set<string>()
  const pins: PinData[] = []
  for (const p of d.pins ?? []) {
    const pin = pinOf(p)
    if (!pin || seen.has(pin.image)) continue
    seen.add(pin.image)
    pins.push(pin)
  }
  return {
    board: { id: String(d.board.id), name: decode(String(d.board.name ?? 'Pinterest board')), url: `https://www.pinterest.com${d.board.url ?? '/'}`, count: Number(d.board.pin_count ?? pins.length), returned: (d.pins ?? []).length },
    pins,
  }
}

/** Read a pin or a board through the widget endpoints (the page's fetch, or a stand-in in tests). */
export async function readPinterest(link: Extract<LinkKind, { kind: 'pin' | 'board' }>, get: (url: string) => Promise<any> = (u) => fetch(u).then((r) => r.json())) {
  if (link.kind === 'pin') {
    const pin = parsePinInfo(await get(pinInfoUrl(link.id)))
    if (!pin) throw new Error('Pinterest did not return that pin (it may be private or removed)')
    return { board: null, pins: [pin] }
  }
  const b = parseBoardPins(await get(boardPinsUrl(link.user, link.board)))
  if (!b) throw new Error('Pinterest did not return that board (it may be private, or the link is not a board)')
  return b
}
