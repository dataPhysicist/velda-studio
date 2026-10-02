import { useEffect, useMemo, useRef, useState } from 'react'
import { finishFor, ROLES, swatches, type Theme } from '../lib/theme'
import type { Attachment, Message } from '../repo'
import { Stage } from './Stage'
import { enterWalk, exitWalk, focusOn, goToVersion, isDeep, newSchemeFromCurrent, openScheme, send, stepVersion, uploadAttachment, uploadVideo, useStudio } from './store'

declare const __STUDIO_ASSET_BASE__: string

export function App() {
  const status = useStudio((s) => s.status)
  const error = useStudio((s) => s.error)
  const model = useStudio((s) => s.model)
  const [drag, setDrag] = useState(false)
  const composer = useRef<ComposerApi>(null)

  return (
    <div
      className={`studio${drag ? ' is-dragging' : ''}`}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes('Files')) {
          e.preventDefault()
          setDrag(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDrag(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        if (e.dataTransfer.files.length) composer.current?.add([...e.dataTransfer.files])
      }}
    >
      <main className="stage-pane">
        <Stage />
        <TitleBlock />
        <div className="stage-foot">
          <div className="foot-left">
            <ViewSwitch />
            <CaptureToggle />
          </div>
          <ThemeStrip />
        </div>
        <Versions />
        <WalkHud />
        {(status || error || !model) && (
          <div className="stage-veil" role="status">
            <p className={error ? 'veil-error' : ''}>{error ?? status ?? 'Loading'}</p>
          </div>
        )}
        {drag && <div className="drop-hint">Drop photos to show Velda</div>}
      </main>
      <Conversation composerRef={composer} />
    </div>
  )
}

// ------------------------------------------------------------------ title block: scheme, levels, rooms

function TitleBlock() {
  const schemes = useStudio((s) => s.schemes)
  const schemeId = useStudio((s) => s.schemeId)
  const model = useStudio((s) => s.model)
  const levelId = useStudio((s) => s.levelId)
  const roomId = useStudio((s) => s.roomId)
  const rooms = useMemo(() => {
    if (!model) return []
    const lv = levelId ?? null
    const list = model.rooms.filter((r) => !lv || r.level === lv)
    return [...list].sort((a, b) => a.name.localeCompare(b.name))
  }, [model, levelId])
  const room = model?.rooms.find((r) => r.id === roomId)
  const [copying, setCopying] = useState(false)

  return (
    <header className="title-block">
      <div className="tb-row">
        <span className="wordmark">Velda Studio</span>
        <label className="scheme-pick">
          <span className="sr-only">Scheme</span>
          <select value={schemeId ?? ''} onChange={(e) => openScheme(e.target.value)}>
            {schemes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="link"
          onClick={async () => {
            const name = window.prompt('Name the new scheme', `${schemes.find((s) => s.id === schemeId)?.name ?? 'Scheme'} (copy)`)
            if (!name) return
            setCopying(true)
            await newSchemeFromCurrent(name)
            setCopying(false)
          }}
        >
          {copying ? 'Saving…' : 'Save as a new scheme'}
        </button>
      </div>
      <h1 className="room-title">{room?.name ?? (levelId ? model?.levels.find((l) => l.id === levelId)?.name : 'Whole house')}</h1>
      <nav className="levels" aria-label="Level">
        <button
          type="button"
          aria-pressed={!levelId && !roomId}
          onClick={() => {
            exitWalk()
            focusOn({ levelId: null, roomId: null })
          }}
        >
          Whole house
        </button>
        {model?.levels.map((l) => (
          <button key={l.id} type="button" aria-pressed={levelId === l.id && !roomId} onClick={() => goTo({ levelId: l.id, roomId: null })}>
            {l.name}
          </button>
        ))}
      </nav>
      <nav className="rooms" aria-label="Room">
        {rooms.map((r) => (
          <button key={r.id} type="button" aria-pressed={roomId === r.id} onClick={() => goTo({ roomId: roomId === r.id && !useStudio.getState().walk ? null : r.id })}>
            {r.name}
          </button>
        ))}
      </nav>
    </header>
  )
}

/** Room and level picks: in walkthrough they move you there; otherwise they frame the view. */
function goTo(opts: { levelId?: string | null; roomId?: string | null }) {
  focusOn(opts)
  if (useStudio.getState().walk) enterWalk()
}

function ViewSwitch() {
  const view = useStudio((s) => s.view)
  const walking = useStudio((s) => !!s.walk)
  return (
    <div className="view-switch" role="group" aria-label="View">
      <button
        type="button"
        aria-pressed={!walking && view === '3d'}
        onClick={() => {
          exitWalk()
          focusOn({ view: '3d' })
        }}
      >
        3D
      </button>
      <button
        type="button"
        aria-pressed={!walking && view === 'plan'}
        onClick={() => {
          exitWalk()
          focusOn({ view: 'plan' })
        }}
      >
        Plan
      </button>
      <button type="button" aria-pressed={walking} onClick={() => (walking ? exitWalk() : enterWalk())}>
        Walk through
      </button>
    </div>
  )
}

function CaptureToggle() {
  const has = useStudio((s) => s.clouds.length > 0)
  const show = useStudio((s) => s.showCaptures)
  if (!has) return null
  return (
    <button type="button" className="toggle" aria-pressed={show} onClick={() => useStudio.setState({ showCaptures: !show })}>
      {show ? 'Hide captured room' : 'Show captured room'}
    </button>
  )
}

function WalkHud() {
  const walking = useStudio((s) => !!s.walk)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (!walking) return
    setSeen(false)
    const t = setTimeout(() => setSeen(true), 7000)
    return () => clearTimeout(t)
  }, [walking])
  if (!walking) return null
  return (
    <div className={`walk-hud${seen ? ' is-quiet' : ''}`} role="status">
      <p>
        Move with <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or the arrow keys, and drag to look around. Hold <kbd>Shift</kbd> to go faster. Double-click to steer with the mouse alone. Pick a room
        above to step into it.
      </p>
      <button type="button" className="link" onClick={exitWalk}>
        Leave walkthrough (Esc)
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ theme

function useActiveTheme(): { theme: Theme | null; where: string } {
  const model = useStudio((s) => s.model)
  const roomId = useStudio((s) => s.roomId)
  if (!model) return { theme: null, where: '' }
  const room = model.rooms.find((r) => r.id === roomId)
  const id = room?.theme ?? model.theme
  return { theme: id ? model.themes[id] ?? null : null, where: room?.theme ? room.name : 'the house' }
}

function ThemeStrip() {
  const { theme, where } = useActiveTheme()
  const [open, setOpen] = useState(false)
  if (!theme) return null
  return (
    <div className="theme-strip">
      <button type="button" className="theme-chip" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="sw-row">
          {swatches(theme).map((h) => (
            <span key={h} className="sw" style={{ background: h }} />
          ))}
        </span>
        <span className="theme-name">{theme.name}</span>
      </button>
      {open && <ThemeCard theme={theme} where={where} onClose={() => setOpen(false)} />}
    </div>
  )
}

function ThemeCard({ theme, where, onClose }: { theme: Theme; where: string; onClose: () => void }) {
  const d = theme.data
  return (
    <div className="theme-card" role="dialog" aria-label={theme.name}>
      <div className="tc-head">
        <div>
          <h2>{theme.name}</h2>
          <p className="muted">Theme for {where}</p>
        </div>
        <button type="button" className="link" onClick={onClose}>
          Close
        </button>
      </div>
      {d.description && <p>{d.description}</p>}
      <ul className="tc-roles">
        {ROLES.map((r) => {
          const f = finishFor(theme, r)
          const pal = d.palette.find((p) => p.role === r)
          return (
            <li key={r}>
              <span className="sw big" style={{ background: f.color ?? '#ccc' }} data-texture={f.library ? 'yes' : undefined} />
              <span>
                <strong>{r[0].toUpperCase() + r.slice(1)}</strong>
                <span className="muted"> {pal?.name ?? f.note ?? f.library ?? f.color}</span>
              </span>
            </li>
          )
        })}
      </ul>
      {!!d.images?.length && (
        <div className="tc-images">
          {d.images.slice(0, 4).map((im, i) => (
            <ThemeImage key={i} image={im} />
          ))}
        </div>
      )}
      <p className="muted small">To change it, tell Velda, for example "make the kitchen cabinets warmer" or "use a herringbone wood floor here".</p>
    </div>
  )
}

function ThemeImage({ image }: { image: { url?: string; path?: string; name?: string } }) {
  const sdk = useStudio((s) => s.sdk)
  const [src, setSrc] = useState<string | null>(image.url ?? null)
  useEffect(() => {
    if (!image.url && image.path && sdk) sdk.readImage(image.path).then(setSrc).catch(() => {})
  }, [image.url, image.path, sdk])
  return src ? <img src={src} alt={image.name ?? ''} loading="lazy" /> : <span className="img-ph" />
}

// ------------------------------------------------------------------ versions

function Versions() {
  const versions = useStudio((s) => s.versions)
  const headId = useStudio((s) => s.headId)
  const list = useRef<HTMLOListElement>(null)
  const i = versions.findIndex((v) => v.id === headId)
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [headId])
  if (!versions.length) return null
  return (
    <div className="versions">
      <button type="button" className="ver-step" disabled={i <= 0} onClick={() => stepVersion(-1)}>
        Undo
      </button>
      <ol ref={list}>
        {versions.map((v) => (
          <li key={v.id}>
            <button type="button" aria-current={v.id === headId} onClick={() => goToVersion(v.id)} title={v.created_at ?? ''}>
              <span className="ver-n">{v.seq}</span>
              {v.summary}
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="ver-step" disabled={i < 0 || i >= versions.length - 1} onClick={() => stepVersion(1)}>
        Redo
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ conversation

type ComposerApi = { add: (files: File[]) => void }

const STARTERS = [
  'Move the sink to the island',
  'Show this room realistically',
  'Add a 6 foot arched opening to the deck',
  'What would you change in this room?',
]

function Conversation({ composerRef }: { composerRef: React.RefObject<ComposerApi | null> }) {
  const messages = useStudio((s) => s.messages)
  const thinking = useStudio((s) => s.thinking)
  const activity = useStudio((s) => s.activity)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, thinking, activity])
  const last = messages[messages.length - 1]
  return (
    <aside className="talk" aria-label="Conversation with Velda">
      <div className="talk-scroll">
        {!messages.length && <Welcome />}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} live={m === last && !thinking} />
        ))}
        {thinking && <Thinking />}
        {!thinking && activity && <Activity />}
        <div ref={end} />
      </div>
      <Composer ref={composerRef} />
    </aside>
  )
}

function Welcome() {
  return (
    <div className="welcome">
      <p className="welcome-lead">Describe a change, or show Velda what you mean.</p>
      <ul className="welcome-ways">
        <li>
          <strong>Paste or drop images</strong> of rooms, finishes or furniture you like. Velda turns them into a look for the room.
        </li>
        <li>
          <strong>Paste a link</strong> to a sofa, vanity, light or tile. Velda reads its size and builds it in the space as a 3D model.
        </li>
        <li>
          <strong>Add photos or a short video</strong> of a room as it is today, slowly walking it. Velda measures it, rebuilds it in the model, and can show your own photo remodeled.
        </li>
      </ul>
      <p className="muted small">Every change is saved as a version, so you can always step back.</p>
      <div className="chips">
        {STARTERS.map((s) => (
          <button key={s} type="button" onClick={() => send(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

function Bubble({ m, live }: { m: Message; live: boolean }) {
  const versions = useStudio((s) => s.versions)
  const headId = useStudio((s) => s.headId)
  const v = m.version_id ? versions.find((x) => x.id === m.version_id) : null
  const before = m.attachments?.find((a) => a.role === 'before')
  const after = m.attachments?.find((a) => a.role === 'after')
  const compare = after ? ([before ?? after, after] as const) : null
  return (
    <div className={`bubble ${m.role}${compare ? ' has-compare' : ''}`}>
      {compare ? (
        <Compare before={compare[0]} after={compare[1]} />
      ) : (
        !!m.attachments?.length && (
          <div className="att-row">
            {m.attachments.map((a) => (
              <AttachmentThumb key={a.path} a={a} />
            ))}
          </div>
        )
      )}
      <div className="bubble-body">{renderText(m.body)}</div>
      {v && (
        <button type="button" className="ver-link" aria-current={v.id === headId} onClick={() => goToVersion(v.id)}>
          {v.id === headId ? `Showing version ${v.seq}` : `Show version ${v.seq}`}
        </button>
      )}
      {live && !!m.chips?.length && (
        <div className="chips">
          {m.chips.map((c) => (
            <button key={c} type="button" onClick={() => (/^walk through/i.test(c) ? enterWalk() : send(c))}>
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AttachmentThumb({ a }: { a: Attachment }) {
  const sdk = useStudio((s) => s.sdk)
  const [src, setSrc] = useState<string | null>(a.preview ?? null)
  useEffect(() => {
    if (!src && /^image\//.test(a.type) && sdk) sdk.readImage(a.path).then(setSrc).catch(() => {})
  }, [a.path])
  return src ? <img className="att" src={src} alt={a.name} /> : <span className="att doc">{(a.name.split('.').pop() || 'file').slice(0, 4)}</span>
}

function useImage(a: Attachment | undefined) {
  const sdk = useStudio((s) => s.sdk)
  const [src, setSrc] = useState<string | null>(a?.preview ?? null)
  useEffect(() => {
    if (!a || src) return
    if (/^https?:/.test(a.path)) setSrc(a.path)
    else if (sdk) sdk.readImage(a.path).then(setSrc).catch(() => {})
  }, [a?.path, sdk])
  return src
}

/** Drag across to reveal the render over the original. */
function Compare({ before, after }: { before: Attachment; after: Attachment }) {
  const a = useImage(before)
  const b = useImage(after)
  const [x, setX] = useState(55)
  const box = useRef<HTMLDivElement>(null)
  const move = (clientX: number) => {
    const r = box.current?.getBoundingClientRect()
    if (r) setX(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)))
  }
  const same = before === after
  return (
    <div
      ref={box}
      className="compare"
      onPointerMove={(e) => e.buttons && move(e.clientX)}
      onPointerDown={(e) => move(e.clientX)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') setX((v) => Math.max(0, v - 5))
        if (e.key === 'ArrowRight') setX((v) => Math.min(100, v + 5))
      }}
      tabIndex={0}
      role="slider"
      aria-label="Compare before and after"
      aria-valuenow={Math.round(x)}
    >
      {b ? <img src={b} alt="Realistic render" /> : <span className="img-ph" />}
      {!same && a && (
        <div className="compare-before" style={{ clipPath: `inset(0 ${100 - x}% 0 0)` }}>
          <img src={a} alt={before.name} />
        </div>
      )}
      {!same && <span className="compare-bar" style={{ left: `${x}%` }} />}
      {!same && <span className="compare-tag left">{before.name}</span>}
      <span className="compare-tag right">{same ? after.name : 'New design'}</span>
      {b && (
        <a className="compare-open" href={b} target="_blank" rel="noreferrer" download="velda-render.jpg">
          Open full size
        </a>
      )}
    </div>
  )
}

function Activity() {
  const activity = useStudio((s) => s.activity)!
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = Math.round((now - activity.started) / 1000)
  return (
    <div className="bubble assistant thinking" role="status">
      <span className="dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {activity.text}
      {secs > 3 ? ` (${secs < 90 ? `${secs}s` : `${Math.floor(secs / 60)} min`})` : ''}
    </div>
  )
}

function Thinking() {
  const thinking = useStudio((s) => s.thinking)!
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = Math.round((now - thinking.started) / 1000)
  return (
    <div className="bubble assistant thinking" role="status">
      <span className="dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {isDeep(thinking.model) ? 'Thinking it through' : 'Working on it'}
      {secs > 3 ? ` (${secs}s)` : ''}
    </div>
  )
}

const HEX = /(#[0-9a-f]{6})\b/gi
function renderText(text: string) {
  return text.split('\n').map((line, i) => (
    <p key={i}>
      {line.split(/(\*\*[^*]+\*\*|#[0-9a-fA-F]{6}\b)/g).map((part, k) => {
        if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={k}>{part.slice(2, -2)}</strong>
        if (/^#[0-9a-f]{6}$/i.test(part))
          return (
            <span key={k} className="hex">
              <span className="sw" style={{ background: part }} />
              {part.toUpperCase()}
            </span>
          )
        return part
      })}
    </p>
  ))
}
void HEX

const Composer = ({ ref }: { ref: React.RefObject<ComposerApi | null> }) => {
  const [text, setText] = useState('')
  const [atts, setAtts] = useState<(Attachment & { uploading?: boolean; key: string })[]>([])
  const thinking = useStudio((s) => s.thinking)
  const ready = useStudio((s) => !!s.model)
  const input = useRef<HTMLTextAreaElement>(null)
  const file = useRef<HTMLInputElement>(null)

  const add = (files: File[]) => {
    for (const f of files) {
      if (/^video\//.test(f.type)) {
        addVideo(f)
        continue
      }
      if (f.size > 25e6) continue
      const key = `${f.name}-${f.size}-${Math.random()}`
      const preview = /^image\//.test(f.type) ? URL.createObjectURL(f) : undefined
      setAtts((a) => [...a, { key, path: '', name: f.name, type: f.type, preview, uploading: true }])
      uploadAttachment(f)
        .then((att) => setAtts((a) => a.map((x) => (x.key === key ? { ...att, key, preview: preview ?? att.preview } : x))))
        .catch(() => setAtts((a) => a.filter((x) => x.key !== key)))
    }
  }
  const addVideo = (f: File) => {
    const key = `${f.name}-${f.size}-${Math.random()}`
    setAtts((a) => [...a, { key, path: '', name: `${f.name}: reading frames`, type: 'video', uploading: true }])
    uploadVideo(f, (name) => setAtts((a) => a.map((x) => (x.key === key ? { ...x, name } : x))))
      .then((frames) =>
        setAtts((a) => [...a.filter((x) => x.key !== key), ...frames.map((fr, i) => ({ ...fr, key: `${key}-${i}` }))]),
      )
      .catch((e) => {
        setAtts((a) => a.filter((x) => x.key !== key))
        window.alert(`That video could not be read: ${(e as Error).message}`)
      })
  }
  if (ref) (ref as any).current = { add }

  useEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(180, el.scrollHeight)}px`
  }, [text])

  const uploading = atts.some((a) => a.uploading)
  const canSend = ready && !thinking && !uploading && (text.trim() || atts.length)
  const submit = () => {
    if (!canSend) return
    const body = text
    const list = atts.map(({ key, uploading: _u, ...a }) => a)
    setText('')
    setAtts([])
    void send(body, list)
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {!!atts.length && (
        <div className="att-row">
          {atts.map((a) => (
            <span key={a.key} className={`att-edit${a.uploading ? ' is-uploading' : ''}`}>
              {a.preview ? <img className="att" src={a.preview} alt={a.name} /> : <span className="att doc">{a.name.split('.').pop()}</span>}
              <button type="button" aria-label={`Remove ${a.name}`} onClick={() => setAtts((x) => x.filter((y) => y.key !== a.key))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={input}
        rows={1}
        value={text}
        placeholder="Describe a change, paste a photo, or paste a product link…"
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const files = [...e.clipboardData.files]
          if (files.length) {
            e.preventDefault()
            add(files)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div className="composer-row">
        <button type="button" className="link" onClick={() => file.current?.click()}>
          Add photos or video
        </button>
        <input
          ref={file}
          type="file"
          accept="image/*,video/*,application/pdf"
          multiple
          hidden
          onChange={(e) => {
            add([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
        <button type="submit" className="send" disabled={!canSend}>
          {uploading ? 'Uploading…' : 'Send'}
        </button>
      </div>
    </form>
  )
}
