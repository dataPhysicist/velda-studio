// Rooms: every room of the house from the floor plans, each with its photos. Pick a room, add a
// photo, say what you would like to see.
import { ArrowLeft, Camera, ClipboardList, Copy, Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { Saved } from '../db'
import { type House, type RoomInfo, roomSvg, sizeWords } from '../house'
import { ASK_WORDS } from '../review'
import { addPhoto, go, openPhoto, OTHER, removePhoto, roomInfo, setDone, useRooms } from '../store'
import { DesignerEye, Ideas } from './Panels'
import { Stage } from './Stage'

const ft = (v: number | null) => (v ? `${Math.floor(v / 12)}'-${Math.round(v % 12)}"` : '')

function PickPhoto({ roomId, children, className }: { roomId: string; children: React.ReactNode; className?: string }) {
  const input = useRef<HTMLInputElement>(null)
  const busy = useRooms((s) => !!s.busy)
  return (
    <>
      <button className={className ?? 'btn primary'} onClick={() => input.current?.click()} disabled={busy}>
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        data-add-photo={roomId}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void addPhoto(f, roomId)
          e.target.value = ''
        }}
      />
    </>
  )
}

function RoomCard({ room, house }: { room: RoomInfo; house: House }) {
  const photos = useRooms((s) => s.photos)
  const versions = useRooms((s) => s.versions)
  const mine = photos.filter((p) => p.room_id === room.id)
  const head = mine.length ? versions.find((v) => v.id === mine[mine.length - 1].head) : null
  const changes = versions.filter((v) => v.meta.kind !== 'photo' && mine.some((p) => p.id === v.photo_id)).length
  const svg = useMemo(() => (room.id === OTHER.id ? '' : roomSvg(house.asBuilt, room.id)), [house, room.id])
  const [over, setOver] = useState(false)
  return (
    <button
      className={`room-card${head ? ' has-photo' : ''}${over ? ' over' : ''}${room.minor ? ' minor' : ''}`}
      onClick={() => go('room', room.id)}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/'))
        if (f) void addPhoto(f, room.id)
      }}
    >
      <span className="room-pic">{head ? <img src={head.thumb} alt="" /> : svg ? <span className="room-plan" dangerouslySetInnerHTML={{ __html: svg }} /> : <Camera size={28} />}</span>
      <span className="room-name">{room.name}</span>
      <span className="room-meta">
        {room.w ? sizeWords(room) : 'Outside, or anything not on the plan'}
        {mine.length ? ` · ${mine.length === 1 ? '1 photo' : `${mine.length} photos`}${changes ? `, ${changes === 1 ? '1 version' : `${changes} versions`}` : ''}` : ''}
      </span>
    </button>
  )
}

function Home({ house }: { house: House }) {
  const [more, setMore] = useState(false)
  const levels = [...new Set(house.rooms.map((r) => r.level))]
  return (
    <main className="home">
      <p className="lede">Pick a room, add a photo of it, and say what you would like to see. Each room knows its real size from your floor plans.</p>
      {levels.map((lv) => {
        const rooms = house.rooms.filter((r) => r.level === lv)
        const main = rooms.filter((r) => !r.minor)
        const minor = rooms.filter((r) => r.minor)
        return (
          <section key={lv} aria-label={rooms[0]?.levelName}>
            <h2 className="level">{rooms[0]?.levelName}</h2>
            <div className="grid">
              {main.map((r) => (
                <RoomCard key={r.id} room={r} house={house} />
              ))}
              {more && minor.map((r) => <RoomCard key={r.id} room={r} house={house} />)}
            </div>
          </section>
        )
      })}
      <section aria-label="More">
        <div className="grid">
          <RoomCard room={OTHER} house={house} />
        </div>
        {house.rooms.some((r) => r.minor) && (
          <button className="link" onClick={() => setMore(!more)}>
            {more ? 'Hide closets and small rooms' : 'Show closets and small rooms'}
          </button>
        )}
      </section>
    </main>
  )
}

function Room({ house, room }: { house: House; room: RoomInfo }) {
  const photos = useRooms((s) => s.photos)
  const versions = useRooms((s) => s.versions)
  const photoId = useRooms((s) => s.photoId)
  const mine = photos.filter((p) => p.room_id === room.id)
  const photo = mine.find((p) => p.id === photoId) ?? null
  const [draft, setDraft] = useState('')
  const svg = useMemo(() => (room.id === OTHER.id ? '' : roomSvg(house.asBuilt, room.id)), [house, room.id])
  const [over, setOver] = useState(false)
  const [sure, setSure] = useState(false)
  return (
    <main
      className={`room${over ? ' over' : ''}`}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/'))
        if (f) void addPhoto(f, room.id)
      }}
    >
      <header className="room-head">
        <div>
          <h1>{room.name}</h1>
          {room.w > 0 && (
            <p className="muted">
              {sizeWords(room)} · {room.sf} square feet{room.ceiling ? ` · ${ft(room.ceiling)} ceiling` : ''} · {room.levelName} <span className="from">from your floor plan</span>
            </p>
          )}
        </div>
        {svg && <span className="head-plan" dangerouslySetInnerHTML={{ __html: svg }} />}
      </header>

      {mine.length > 0 && (
        <div className="photos" role="tablist" aria-label="Photos of this room">
          {mine.map((p, i) => {
            const head = versions.find((v) => v.id === p.head)
            return (
              <button key={p.id} role="tab" aria-selected={p.id === photo?.id} className="photo-tab" onClick={() => void openPhoto(p.id)}>
                {head && <img src={head.thumb} alt="" />}
                <span>Photo {i + 1}</span>
              </button>
            )
          })}
          <PickPhoto roomId={room.id} className="photo-tab add">
            <Plus size={18} />
            <span>Add a photo</span>
          </PickPhoto>
          {photo &&
            (sure ? (
              <span className="sure">
                Remove this photo and all its versions?{' '}
                <button className="link danger" onClick={() => (setSure(false), void removePhoto(photo.id))}>
                  Yes, remove it
                </button>{' '}
                <button className="link" onClick={() => setSure(false)}>
                  Keep it
                </button>
              </span>
            ) : (
              <button className="link danger" onClick={() => setSure(true)}>
                <Trash2 size={14} /> Remove this photo
              </button>
            ))}
        </div>
      )}

      {photo ? (
        <div className="work">
          <Stage photo={photo} draft={draft} setDraft={setDraft} />
          <aside className="side">
            <Ideas photo={photo} house={house} room={room} />
            <DesignerEye photo={photo} house={house} room={room} typing={draft} />
          </aside>
        </div>
      ) : (
        <div className="work">
          <div className="empty">
            <Camera size={34} />
            <h2>Add a photo of this room</h2>
            <p className="muted">Stand in a doorway or a corner, hold the phone level, and turn the lights on. You can add more than one.</p>
            <PickPhoto roomId={room.id}>Take or choose a photo</PickPhoto>
            <p className="muted small">On a computer you can also drop a picture anywhere on this page.</p>
          </div>
          <aside className="side">
            <DesignerEye photo={null} house={house} room={room} typing="" />
          </aside>
        </div>
      )}
    </main>
  )
}

function Questions() {
  const saved = useRooms((s) => s.saved)
  const [copied, setCopied] = useState(false)
  const by = useMemo(() => {
    const m = new Map<string, Saved[]>()
    for (const s of saved) m.set(s.room_name, [...(m.get(s.room_name) ?? []), s])
    return [...m.entries()]
  }, [saved])
  const text = () =>
    by
      .map(([room, list]) => `${room}\n${list.map((s) => `- ${s.done ? '[done] ' : ''}${s.title}: ${s.body}${ASK_WORDS[s.ask] ? ` (${ASK_WORDS[s.ask]})` : ''}`).join('\n')}`)
      .join('\n\n')
  return (
    <main className="questions">
      <header className="room-head">
        <div>
          <h1>Questions for the designer</h1>
          <p className="muted">Everything you saved, room by room. Tick them off as they get answered.</p>
        </div>
      </header>
      {!saved.length && <p className="muted">Nothing saved yet. In any room, tap the bookmark on a note in "The designer's eye" to put it here.</p>}
      {saved.length > 0 && (
        <p>
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard?.writeText(text()).then(() => (setCopied(true), setTimeout(() => setCopied(false), 2500)))
            }}
          >
            <Copy size={15} /> {copied ? 'Copied' : 'Copy the list'}
          </button>{' '}
          <button className="btn quiet" onClick={() => window.print()}>
            Print
          </button>
        </p>
      )}
      {by.map(([room, list]) => (
        <section key={room} className="panel">
          <h2>{room}</h2>
          {list.map((s) => (
            <label key={s.id} className={`q${s.done ? ' done' : ''}`}>
              <input type="checkbox" checked={s.done} onChange={(e) => void setDone(s.id, e.target.checked)} />
              <span>
                <strong>{s.title}</strong>
                <span>{s.body}</span>
                {ASK_WORDS[s.ask] && <span className="who">{ASK_WORDS[s.ask]}</span>}
              </span>
            </label>
          ))}
        </section>
      ))}
    </main>
  )
}

export function App() {
  const status = useRooms((s) => s.status)
  const error = useRooms((s) => s.error)
  const house = useRooms((s) => s.house)
  const page = useRooms((s) => s.page)
  const roomId = useRooms((s) => s.roomId)
  const toast = useRooms((s) => s.toast)
  const open = useRooms((s) => s.saved.filter((x) => !x.done).length)
  const local = useRooms((s) => s.be?.kind === 'local')
  if (error) return <div className="splash error">{error}</div>
  if (status || !house) return <div className="splash">{status ?? 'Opening'}</div>
  const room = roomInfo(roomId)
  return (
    <div className="rooms">
      <header className="top">
        {page === 'home' ? (
          <span className="wordmark">
            Rooms <span className="muted">· {house.name}</span>
          </span>
        ) : (
          <button className="back" onClick={() => go('home')}>
            <ArrowLeft size={18} /> All rooms
          </button>
        )}
        {local && <span className="test-data">Local preview: changes are stand-ins and nothing is saved</span>}
        <button className="btn quiet qbtn" onClick={() => go('questions')} aria-current={page === 'questions'}>
          <ClipboardList size={17} /> Questions{open ? ` (${open})` : ''}
        </button>
      </header>
      {page === 'home' && <Home house={house} />}
      {page === 'room' && room && <Room key={room.id} house={house} room={room} />}
      {page === 'questions' && <Questions />}
      {toast && (
        <div className="toast" role="alert">
          {toast}
        </div>
      )}
      <footer className="foot muted small">Pictures show the mood, not exact sizes or colors. Sizes come from your floor plans in Velda Studio.</footer>
    </div>
  )
}
