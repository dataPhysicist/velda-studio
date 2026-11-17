// Beside the photo: ideas to try, and the designer's eye (what the floor plan, Velda and a remodel
// designer's checklist say about this room).
import { Bookmark, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Photo } from '../db'
import { type House, planFindings, plannedChanges, type RoomInfo } from '../house'
import { adviceFor, ASK_WORDS } from '../review'
import { change, look, question, saveNote, useRooms } from '../store'

const SCALE: Record<string, string> = { tweak: 'A small change', refresh: 'A refresh', remodel: 'A remodel' }

export function Ideas({ photo, house, room }: { photo: Photo; house: House; room: RoomInfo }) {
  const studying = useRooms((s) => !!s.studying[photo.id])
  const busy = useRooms((s) => !!s.busy || !!s.pending)
  useRooms((s) => s.plansAt)
  const plans = useMemo(() => (room.id === 'other' ? [] : plannedChanges(house, room.id)), [house, room.id, house.plans.length])
  const ideas = photo.study?.ideas ?? []
  return (
    <section className="panel" aria-labelledby="ideas-h">
      <h2 id="ideas-h">
        <Sparkles size={17} /> Ideas for this room
      </h2>
      {photo.study?.sees && <p className="muted small">{photo.study.sees}</p>}
      {plans.map((p) => (
        <article key={p.plan} className="idea plan">
          <div>
            <span className="tag">From your floor plans</span>
            <h3>See "{p.plan}" in this photo</h3>
            <ul>
              {p.lines.slice(0, 4).map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
          <button className="btn" disabled={busy} onClick={() => void change(`Show this planned design in the photo. ${p.lines.join(' ')}`, { kind: 'plan', label: p.plan.length > 30 ? p.plan.slice(0, 29) + '…' : p.plan })}>
            Show it
          </button>
        </article>
      ))}
      {studying && !ideas.length && <p className="thinking">Velda is looking at your photo. Ideas appear here in about a minute; you can start making changes meanwhile.</p>}
      {ideas.map((i, k) => (
        <article key={k} className="idea">
          <div>
            {i.scale && <span className="tag">{SCALE[i.scale]}</span>}
            <h3>{i.title}</h3>
            <p>{i.why}</p>
          </div>
          <button className="btn" disabled={busy} onClick={() => void change(i.prompt, { kind: 'idea', label: i.title })}>
            Try it
          </button>
        </article>
      ))}
      {!studying && !ideas.length && !plans.length && <p className="muted">No ideas yet.</p>}
      {!studying && (
        <button className="link" onClick={() => void look(photo.id, true)}>
          {ideas.length ? 'Ask Velda for different ideas' : 'Ask Velda for ideas'}
        </button>
      )}
      {studying && ideas.length > 0 && <p className="thinking">Velda is thinking of different ideas.</p>}
    </section>
  )
}

type Note = { id: string; title: string; body: string; ask: string; source: 'plan' | 'list' | 'velda' | 'answer' }

function NoteCard({ n, roomId, from }: { n: Note; roomId: string; from?: string }) {
  const saved = useRooms((s) => s.saved.some((x) => x.id === n.id))
  return (
    <article className={`note${saved ? ' saved' : ''}`}>
      <div>
        <h3>{n.title}</h3>
        <p>{n.body}</p>
        <p className="note-foot">
          {ASK_WORDS[n.ask] && <span className="who">{ASK_WORDS[n.ask]}</span>}
          {from && <span className="muted small">From {from}</span>}
        </p>
      </div>
      <button className="save" aria-pressed={saved} onClick={() => void saveNote({ id: n.id, source: n.source, title: n.title, body: n.body, ask: n.ask }, roomId)} title={saved ? 'Take this off your questions list' : 'Add this to your questions list'}>
        <Bookmark size={17} fill={saved ? 'currentColor' : 'none'} />
        <span className="sr-only">{saved ? 'On your questions list' : 'Add to your questions list'}</span>
      </button>
    </article>
  )
}

export function DesignerEye({ photo, house, room, typing }: { photo: Photo | null; house: House; room: RoomInfo; typing: string }) {
  const said = useRooms((s) => s.said[room.id] ?? '')
  const versions = useRooms((s) => s.versions)
  const asking = useRooms((s) => s.asking)
  const savedAll = useRooms((s) => s.saved)
  const answers = useMemo(() => savedAll.filter((x) => x.room_id === room.id && x.source === 'answer'), [savedAll, room.id])
  const studying = useRooms((s) => (photo ? !!s.studying[photo.id] : false))
  useRooms((s) => s.plansAt)
  const [q, setQ] = useState('')
  const [all, setAll] = useState(false)
  const photos = useRooms((s) => s.photos)
  // Everything asked for in this room, saved or being typed, steers which notes come up.
  const talk = useMemo(() => {
    const ids = new Set(photos.filter((p) => p.room_id === room.id).map((p) => p.id))
    return [said, typing, ...versions.filter((v) => ids.has(v.photo_id)).map((v) => `${v.words} ${v.label}`)].join(' ')
  }, [said, typing, versions, photos, room.id])
  const plan = useMemo(() => (room.id === 'other' ? [] : planFindings(house, room.id)), [house, room.id, house.plans.length])
  const advice = useMemo(() => adviceFor(room.kind, talk), [room.kind, talk])
  const notices = photo?.study?.notices ?? []
  const standing = all ? advice.standing : advice.standing.slice(0, 3)
  return (
    <section className="panel" aria-labelledby="eye-h">
      <h2 id="eye-h">The designer's eye</h2>
      <p className="muted small">What an architect or designer would raise before this is built. Save any of them to your questions list.</p>

      <form
        className="ask-velda"
        onSubmit={(e) => {
          e.preventDefault()
          if (!q.trim()) return
          void question(q, room.id)
          setQ('')
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask Velda about this room" aria-label="Ask Velda about this room" disabled={asking} />
        <button className="btn" disabled={!q.trim() || asking}>
          Ask
        </button>
      </form>
      {asking && <p className="thinking">Velda is working on your question.</p>}
      {[...answers].reverse().map((a) => (
        <article key={a.id} className="note answer">
          <div>
            <h3>{a.title}</h3>
            <p>{a.body}</p>
            {ASK_WORDS[a.ask] && (
              <p className="note-foot">
                <span className="who">{ASK_WORDS[a.ask]}</span>
              </p>
            )}
          </div>
        </article>
      ))}

      {plan.length > 0 && (
        <>
          <h4>From your floor plan</h4>
          {plan.map((f) => (
            <NoteCard key={f.id} n={{ id: `plan:${room.id}:${f.id}`, title: f.title, body: f.body, ask: f.ask, source: 'plan' }} roomId={room.id} from={f.from} />
          ))}
        </>
      )}
      {(notices.length > 0 || studying) && (
        <>
          <h4>Velda noticed in your photo</h4>
          {studying && !notices.length && <p className="thinking">Velda is looking at your photo.</p>}
          {notices.map((n, i) => (
            <NoteCard key={i} n={{ id: `velda:${photo!.id}:${i}:${n.title}`, title: n.title, body: n.body, ask: n.ask ?? 'designer', source: 'velda' }} roomId={room.id} />
          ))}
        </>
      )}
      {advice.raised.length > 0 && (
        <>
          <h4>Because of what you asked for</h4>
          {advice.raised.map((a) => (
            <NoteCard key={a.id} n={{ id: `list:${room.id}:${a.id}`, title: a.title, body: a.body, ask: a.ask, source: 'list' }} roomId={room.id} />
          ))}
        </>
      )}
      {advice.standing.length > 0 && (
        <>
          <h4>Before you build</h4>
          {standing.map((a) => (
            <NoteCard key={a.id} n={{ id: `list:${room.id}:${a.id}`, title: a.title, body: a.body, ask: a.ask, source: 'list' }} roomId={room.id} />
          ))}
          {advice.standing.length > 3 && (
            <button className="link" onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show all ${advice.standing.length}`}
            </button>
          )}
        </>
      )}
    </section>
  )
}
