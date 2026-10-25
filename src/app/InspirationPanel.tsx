// The Inspiration tab (06 section 6): cards with picture, title, source, tags and rooms; filters by
// room and tag; drag a card onto a room in the plan to file it there; pick some and make a theme
// from them; open the mood board. Pictures and Pinterest links can be dropped or pasted right here.
import { useEffect, useMemo, useState } from 'react'
import { classifyLink } from '../inspiration/pinterest'
import type { Source } from '../inspiration/ingest'
import type { Inspiration, Model } from '../model/types'
import { handEdit } from './editor'
import { CARD_MIME, addInspiration, pictureUrl, themeFrom } from './inspiration'
import { MoodBoard } from './MoodBoard'
import { useStudio } from './store'


export function InspirationPanel() {
  const model = useStudio((s) => s.model)
  const focus = useStudio((s) => s.roomId)
  const busy = useStudio((s) => !!s.activity || !!s.thinking)
  const [room, setRoom] = useState<string>(focus ?? 'all')
  const [tag, setTag] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [board, setBoard] = useState(false)
  const [link, setLink] = useState('')
  const [over, setOver] = useState(false)
  useEffect(() => setRoom(focus ?? 'all'), [focus])
  const all = model?.inspiration ?? []
  const shown = useMemo(
    () => [...all].sort((a, b) => Number(b.kind === 'board') - Number(a.kind === 'board')).filter((c) => (room === 'all' ? true : room === 'none' ? !c.rooms.length : c.rooms.includes(room))).filter((c) => !tag || tagsOf(c).includes(tag)),
    [all, room, tag],
  )
  const topTags = useMemo(() => {
    const n = new Map<string, number>()
    for (const c of all.filter((c) => room === 'all' || c.rooms.includes(room))) for (const t of new Set(tagsOf(c))) n.set(t, (n.get(t) ?? 0) + 1)
    return [...n.entries()].filter(([, k]) => k > 1).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t)
  }, [all, room])
  if (!model) return null
  const target = room !== 'all' && room !== 'none' ? room : focus
  const take = (sources: Source[]) => sources.length && void addInspiration(sources, target ? [target] : [])
  const roomsWith = model.rooms.filter((r) => all.some((c) => c.rooms.includes(r.id)) || r.id === focus)

  return (
    <section className="insp">
      <div
        className={`insp-drop${over ? ' is-over' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('text/plain')) {
            e.preventDefault()
            setOver(true)
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const files = [...e.dataTransfer.files].filter((f) => /^image\//.test(f.type))
          const urls = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).match(/https?:\/\/\S+/g) ?? []
          take([...files.map((file) => ({ file })), ...urls.map((url) => ({ url }))])
        }}
      >
        <p>
          Drop pictures here, or paste a Pinterest pin, a board or any page.
          {target ? ` They go to the ${model.rooms.find((r) => r.id === target)?.name}.` : ' Pick a room below to file them there.'}
        </p>
        <form
          className="insp-link"
          onSubmit={(e) => {
            e.preventDefault()
            const urls = link.match(/https?:\/\/\S+/g) ?? []
            if (!urls.length) return
            setLink('')
            take(urls.map((url) => ({ url })))
          }}
        >
          <label>
            <span className="sr-only">Link</span>
            <input
              value={link}
              placeholder="https://pinterest.com/…"
              onChange={(e) => setLink(e.target.value)}
              onPaste={(e) => {
                const files = [...e.clipboardData.files].filter((f) => /^image\//.test(f.type))
                if (files.length) {
                  e.preventDefault()
                  take(files.map((file) => ({ file })))
                }
              }}
            />
          </label>
          <button type="submit" className="btn small" disabled={busy || !/https?:\/\//.test(link)}>
            Add
          </button>
        </form>
        {/https?:\/\//.test(link) && <p className="muted small">{linkWords(link)}</p>}
      </div>

      <div className="insp-filters">
        <label>
          <span className="sr-only">Room</span>
          <select value={room} onChange={(e) => setRoom(e.target.value)}>
            <option value="all">Every room ({all.filter((c) => c.kind !== 'board').length})</option>
            {roomsWith.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({all.filter((c) => c.kind !== 'board' && c.rooms.includes(r.id)).length})
              </option>
            ))}
            <option value="none">Not filed yet</option>
          </select>
        </label>
        {room !== 'all' && room !== 'none' && (
          <button type="button" className="link small" onClick={() => setBoard(true)}>
            Mood board
          </button>
        )}
      </div>
      {!!topTags.length && (
        <div className="insp-tags" role="group" aria-label="Tags">
          {topTags.map((t) => (
            <button key={t} type="button" aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>
              {t}
            </button>
          ))}
        </div>
      )}

      {!!picked.length && (
        <div className="insp-picked">
          <span>{picked.length} picked</span>
          <button type="button" className="btn small primary" disabled={busy} onClick={() => void themeFrom(all.filter((c) => picked.includes(c.id)), target ?? null).then(() => setPicked([]))}>
            Make a theme from these
          </button>
          <button type="button" className="link small" onClick={() => setPicked([])}>
            Clear
          </button>
        </div>
      )}

      {shown.length ? (
        <ul className="insp-grid">
          {shown.map((c) => (
            <Card key={c.id} c={c} model={model} picked={picked.includes(c.id)} onPick={(on) => setPicked((p) => (on ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
          ))}
        </ul>
      ) : (
        <p className="muted">{all.length ? 'Nothing here with that room or tag.' : 'No inspiration yet. Drop a few pictures of rooms you like, or paste a Pinterest board, and Velda will tag them.'}</p>
      )}
      {board && target && <MoodBoard roomId={target} onClose={() => setBoard(false)} />}
    </section>
  )
}

const tagsOf = (c: Inspiration) => [...c.tags.style, ...c.tags.materials, ...c.tags.fixtures].map((t) => t.toLowerCase())

function linkWords(link: string) {
  const k = classifyLink((link.match(/https?:\/\/\S+/) ?? [''])[0]).kind
  return k === 'image' ? 'A picture: it is added and tagged.' : k === 'pin' ? 'A Pinterest pin: its picture is added and tagged.' : k === 'board' ? 'A Pinterest board: every picture Pinterest shares from it is added and tagged.' : k === 'pin_short' ? 'A short pin.it link: open it in Pinterest and paste the full pin link instead.' : 'A web page: Velda reads it and adds its main picture.'
}

function Card({ c, model, picked, onPick }: { c: Inspiration; model: Model; picked: boolean; onPick: (on: boolean) => void }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void pictureUrl(c.thumb ?? c.image).then((u) => live && setSrc(u))
    return () => {
      live = false
    }
  }, [c.thumb, c.image])
  const pins = c.kind === 'board' ? model.inspiration.filter((p) => p.parent === c.id).length : 0
  const rooms = c.rooms.map((id) => model.rooms.find((r) => r.id === id)?.name).filter(Boolean)
  return (
    <li
      className={`insp-card${picked ? ' is-picked' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(CARD_MIME, c.id)
        e.dataTransfer.effectAllowed = 'link'
      }}
      title="Drag onto a room in the plan to file it there"
    >
      <label className="insp-pick">
        <input type="checkbox" aria-label={`Pick ${c.title ?? "this card"}`} checked={picked} onChange={(e) => onPick(e.target.checked)} />
        <span className="sr-only">Pick {c.title}</span>
      </label>
      {src ? <img src={src} alt={c.title ?? ''} loading="lazy" /> : <div className="insp-noimg" aria-hidden="true" />}
      <div className="insp-body">
        <div className="insp-title">{c.title ?? 'Untitled'}</div>
        <div className="insp-src">
          {c.url ? (
            <a href={c.url} target="_blank" rel="noreferrer">
              {c.source ?? 'link'}
            </a>
          ) : (
            (c.source ?? 'your picture')
          )}
          {pins ? ` · ${pins} pins` : ''}
        </div>
        {!!c.tags.palette.length && (
          <div className="insp-swatches" aria-label="Colors">
            {c.tags.palette.slice(0, 5).map((p) => (
              <span key={p.hex} style={{ background: p.hex }} title={`${p.name ?? ''} ${p.hex}`.trim()} />
            ))}
          </div>
        )}
        {!!tagsOf(c).length && <div className="insp-words">{[...c.tags.style, ...c.tags.materials, ...c.tags.fixtures].slice(0, 4).join(' · ')}</div>}
        <div className="insp-rooms">
          {rooms.length ? rooms.join(', ') : <span className="muted">not filed</span>}
          <button type="button" className="link small" aria-label={`Remove ${c.title ?? 'card'}`} onClick={() => void handEdit([{ op: 'remove_inspiration', id: c.id }], `Removed inspiration "${c.title ?? c.kind}"`)}>
            Remove
          </button>
        </div>
      </div>
    </li>
  )
}
