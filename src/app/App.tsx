import { useEffect, useMemo, useRef, useState } from 'react'
import { finishFor, ROLES, swatches, type Theme } from '../lib/theme'
import type { Attachment, Message } from '../repo'
import { Stage } from './Stage'
import { focusOn, goToVersion, isDeep, newSchemeFromCurrent, openScheme, send, stepVersion, uploadAttachment, useStudio } from './store'

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
          <ViewSwitch />
          <ThemeStrip />
        </div>
        <Versions />
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
        <button type="button" aria-pressed={!levelId && !roomId} onClick={() => focusOn({ levelId: null, roomId: null })}>
          Whole house
        </button>
        {model?.levels.map((l) => (
          <button key={l.id} type="button" aria-pressed={levelId === l.id && !roomId} onClick={() => focusOn({ levelId: l.id, roomId: null })}>
            {l.name}
          </button>
        ))}
      </nav>
      <nav className="rooms" aria-label="Room">
        {rooms.map((r) => (
          <button key={r.id} type="button" aria-pressed={roomId === r.id} onClick={() => focusOn({ roomId: roomId === r.id ? null : r.id })}>
            {r.name}
          </button>
        ))}
      </nav>
    </header>
  )
}

function ViewSwitch() {
  const view = useStudio((s) => s.view)
  return (
    <div className="view-switch" role="group" aria-label="View">
      <button type="button" aria-pressed={view === '3d'} onClick={() => focusOn({ view: '3d' })}>
        3D
      </button>
      <button type="button" aria-pressed={view === 'plan'} onClick={() => focusOn({ view: 'plan' })}>
        Plan
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
  'Cream perimeter cabinets with a walnut island',
  'Add a 6 foot arched opening to the deck',
  'What would you change in this room?',
]

function Conversation({ composerRef }: { composerRef: React.RefObject<ComposerApi | null> }) {
  const messages = useStudio((s) => s.messages)
  const thinking = useStudio((s) => s.thinking)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, thinking])
  const last = messages[messages.length - 1]
  return (
    <aside className="talk" aria-label="Conversation with Velda">
      <div className="talk-scroll">
        {!messages.length && <Welcome />}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} live={m === last && !thinking} />
        ))}
        {thinking && <Thinking />}
        <div ref={end} />
      </div>
      <Composer ref={composerRef} />
    </aside>
  )
}

function Welcome() {
  return (
    <div className="welcome">
      <p className="welcome-lead">Describe a change, or add a photo you like.</p>
      <p className="muted">Velda updates the model and keeps every version, so you can always go back.</p>
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
  return (
    <div className={`bubble ${m.role}`}>
      {!!m.attachments?.length && (
        <div className="att-row">
          {m.attachments.map((a) => (
            <AttachmentThumb key={a.path} a={a} />
          ))}
        </div>
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
            <button key={c} type="button" onClick={() => send(c)}>
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
      if (f.size > 25e6) continue
      const key = `${f.name}-${f.size}-${Math.random()}`
      const preview = /^image\//.test(f.type) ? URL.createObjectURL(f) : undefined
      setAtts((a) => [...a, { key, path: '', name: f.name, type: f.type, preview, uploading: true }])
      uploadAttachment(f)
        .then((att) => setAtts((a) => a.map((x) => (x.key === key ? { ...att, key, preview: preview ?? att.preview } : x))))
        .catch(() => setAtts((a) => a.filter((x) => x.key !== key)))
    }
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
        placeholder="Describe a change…"
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
          Add photos
        </button>
        <input
          ref={file}
          type="file"
          accept="image/*,application/pdf"
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
