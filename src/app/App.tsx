import { RENDER_LABEL, RENDER_RUNS, renderNote } from '../ai/render'
import { addInspiration } from './inspiration'
import { classifyLink } from '../inspiration/pinterest'
import type { Source } from '../inspiration/ingest'
import { Choices } from './Choices'
import { plainError } from './errors'
import { suggestions } from './suggest'
import { ExportDialog, ShareDialog } from './Handoff'
import { openDialog, Palette, Settings, Shortcuts, useDialogs } from './Palette'
import { FirstRun, Tour } from './Tour'
import { Products } from './Products'
import { useEffect, useMemo, useRef, useState } from 'react'
import { finishFor, ROLES, swatches, type Theme } from '../lib/theme'
import type { Attachment, Message } from '../repo'
import { DB, LIVE_DB } from '../toolbelt'
import { Plan } from '../plan2d/Plan'
import { ContextPanel } from './Context'
import { cancelConfirm, redo, undo, useEditor } from './editor'
import { ImportFlow } from './Import'
import { startImport, useImport } from './importFlow'
import { Stage } from './Stage'
import { type Look, enterWalk, exitWalk, focusOn, goToVersion, isDeep, newSchemeFromCurrent, openScheme, send, stepVersion, uniqueSchemeName, uploadAttachment, uploadVideo, useStudio } from './store'

declare const __STUDIO_ASSET_BASE__: string

export function App() {
  const status = useStudio((s) => s.status)
  const error = useStudio((s) => s.error)
  const model = useStudio((s) => s.model)
  const firstRun = useStudio((s) => s.firstRun)
  const [drag, setDrag] = useState(false)
  const composer = useRef<ComposerApi>(null)
  // The import covers the studio; drop the 3D view meanwhile so the trace has the machine to itself.
  const importing = useImport((s) => s.stage !== 'idle')
  const view = useStudio((s) => s.view)
  const walking = useStudio((s) => !!s.walk)
  const [ctxOpen, setCtxOpen] = useState(() => {
    try {
      return localStorage.getItem('velda.ctx') !== 'closed'
    } catch {
      return true
    }
  })
  const showCtx = (open: boolean) => {
    setCtxOpen(open)
    try {
      localStorage.setItem('velda.ctx', open ? 'open' : 'closed')
    } catch {}
  }
  useGlobalKeys()

  return (
    <div
      className={`studio${drag ? ' is-dragging' : ''}${ctxOpen ? '' : ' ctx-closed'}`}
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
        const files = [...e.dataTransfer.files]
        const pdf = files.find((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name))
        if (pdf) void startImport(pdf)
        else if (files.length) composer.current?.add(files)
      }}
    >
      <Conversation composerRef={composer} />
      <main className={`stage-pane${view === 'plan' && !walking ? ' is-plan' : ''}`}>
        {!importing && <Stage />}
        {!importing && view === 'plan' && !walking && model && <Plan />}
        <TitleBlock />
        <div className="stage-foot">
          <div className="foot-left">
            <ViewSwitch />
            <LookMenu />
            <CaptureToggle />
          </div>
          <ThemeStrip />
        </div>
        <Versions />
        <WalkHud />
        {firstRun && !model && !importing && <FirstRun />}
        {!(firstRun && !model) && (status || error || !model) && (
          <div className="stage-veil" role="status">
            <p className={error ? 'veil-error' : ''}>{error ?? status ?? 'Loading'}</p>
          </div>
        )}
        {drag && <div className="drop-hint">Drop photos to show Velda, or a plan PDF to bring it in</div>}
        <EditorOverlay />
        <Palette />
        <Settings />
        <Shortcuts />
        <Tour prefill={(t) => composer.current?.prefill(t)} />
      </main>
      {ctxOpen ? (
        <ContextPanel onHide={() => showCtx(false)} />
      ) : (
        <button type="button" className="ctx-tab" onClick={() => showCtx(true)}>
          Selection
        </button>
      )}
      <ImportFlow />
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
  const [naming, setNaming] = useState<string | null>(null) // the new scheme's name while it is being typed

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
        {naming === null ? (
          <button type="button" className="link" onClick={() => setNaming(uniqueSchemeName(`${schemes.find((s) => s.id === schemeId)?.name ?? 'Scheme'} (copy)`))}>
            {copying ? 'Saving…' : 'Save as a new scheme'}
          </button>
        ) : (
          <form
            className="scheme-name"
            onSubmit={async (e) => {
              e.preventDefault()
              const name = naming.trim()
              if (!name) return
              setNaming(null)
              setCopying(true)
              await newSchemeFromCurrent(uniqueSchemeName(name))
              setCopying(false)
            }}
          >
            <label>
              <span className="sr-only">Name of the new scheme</span>
              <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNaming(null)} />
            </label>
            <button type="submit" className="btn small primary">
              Save
            </button>
            <button type="button" className="link small" onClick={() => setNaming(null)}>
              Cancel
            </button>
          </form>
        )}
        <BringInPlan />
        <HandoffButtons />
        <TestDataNote />
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

/** Share a read-only link, or build the package for a designer or contractor; Settings. */
function HandoffButtons() {
  const open = useDialogs((s) => s.open)
  return (
    <>
      <button type="button" className="link" data-share onClick={() => openDialog('share')}>
        Share
      </button>
      <button type="button" className="link" onClick={() => openDialog('export')}>
        Export
      </button>
      <button type="button" className="link" onClick={() => openDialog('settings')} title="Settings (Cmd-K for every action)">
        Settings
      </button>
      {open === 'share' && <ShareDialog onClose={() => openDialog(null)} />}
      {open === 'export' && <ExportDialog onClose={() => openDialog(null)} />}
    </>
  )
}

/** Upload a plan set (PDF): opens the page strip, then the Confirm screen for each floor plan. */
function BringInPlan() {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className="link" onClick={() => input.current?.click()}>
        Bring in a plan
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        aria-label="Plan PDF"
        data-testid="plan-file"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void startImport(f)
        }}
      />
    </>
  )
}

/** Development builds save to a separate test database; say so, so nobody mistakes it for the real schemes. */
function TestDataNote() {
  const inToolbelt = useStudio((s) => !!s.sdk)
  if (!inToolbelt || DB === LIVE_DB) return null
  return (
    <span className="test-data" title={`This build saves to ${DB}. Your real schemes are not changed.`}>
      Test copy: your real schemes are not changed
    </span>
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
      <button type="button" aria-pressed={!walking && view === 'plan'} title="Plan (1)" onClick={() => showView('plan')}>
        Plan
      </button>
      <button type="button" aria-pressed={!walking && view === '3d'} title="3D (2)" onClick={() => showView('3d')}>
        3D
      </button>
      <button type="button" aria-pressed={walking} title="Walk through (3)" onClick={() => (walking ? exitWalk() : enterWalk())}>
        Walk through
      </button>
    </div>
  )
}

const WALLS: [Look['walls'], string][] = [
  ['cutaway', 'Cut away'],
  ['up', 'Full'],
  ['translucent', 'See-through'],
  ['down', 'Off'],
]
const LEVELS: [Look['levels'], string][] = [
  ['auto', 'The one picked'],
  ['stacked', 'All'],
  ['exploded', 'Spread apart'],
]
const LIGHTS: [Look['light'], string][] = [
  ['studio', 'Even'],
  ['morning', 'Morning sun'],
  ['afternoon', 'Afternoon sun'],
]

/** How the 3D view shows the house: walls, floors, light (06 section 3). Words, not icons. */
function LookMenu() {
  const view = useStudio((s) => s.view)
  const walking = useStudio((s) => !!s.walk)
  const look = useStudio((s) => s.look)
  const [open, setOpen] = useState(false)
  if (view !== '3d' || walking) return null
  const setLook = (patch: Partial<Look>) => useStudio.setState({ look: { ...look, ...patch } })
  const group = <K extends keyof Look>(key: K, label: string, options: [Look[K], string][]) => (
    <div className="look-row" role="group" aria-label={label}>
      <span className="look-label">{label}</span>
      <span className="seg">
        {options.map(([v, words]) => (
          <button key={v} type="button" aria-pressed={look[key] === v} onClick={() => setLook({ [key]: v } as Partial<Look>)}>
            {words}
          </button>
        ))}
      </span>
    </div>
  )
  return (
    <div className="look">
      <button type="button" className="toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        Walls: {WALLS.find(([v]) => v === look.walls)?.[1]}
      </button>
      {open && (
        <div className="look-pop" role="dialog" aria-label="How the 3D view shows the house">
          {group('walls', 'Walls', WALLS)}
          {group('levels', 'Floors', LEVELS)}
          {group('light', 'Light', LIGHTS)}
          {look.light !== 'studio' && <p className="muted small">Sun on an equinox day; north is {useStudio.getState().model?.project.north == null ? 'taken as the top of the plan until you set it' : 'as you set it'}.</p>}
        </div>
      )}
    </div>
  )
}

function showView(view: 'plan' | '3d') {
  exitWalk()
  focusOn({ view })
}

/** Keys that work in every view (06 section 11); the plan adds its own tool keys. */
function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useEditor.getState().confirm) {
        if (e.key === 'Escape') cancelConfirm()
        return
      }
      // Cmd-K or Ctrl-K opens the palette from anywhere, even while typing.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openDialog(useDialogs.getState().open === 'palette' ? null : 'palette')
        return
      }
      if (useDialogs.getState().open) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (useImport.getState().stage !== 'idle' || !useStudio.getState().model) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod || e.altKey) return
      if (e.key === '1') showView('plan')
      else if (e.key === '2') showView('3d')
      else if (e.key === '3') enterWalk()
      else if (e.key === '?') openDialog('shortcuts')
      else if (e.key === '/') {
        e.preventDefault()
        ;(document.querySelector('.composer textarea') as HTMLTextAreaElement | null)?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** The editor's two voices: a short notice after an edit, and the confirm before a risky one. */
function EditorOverlay() {
  const notice = useEditor((s) => s.notice)
  const confirm = useEditor((s) => s.confirm)
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (confirm) first.current?.focus()
  }, [confirm])
  return (
    <>
      {notice && !confirm && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {confirm && (
        <div className="confirm-veil" onPointerDown={(e) => e.target === e.currentTarget && cancelConfirm()}>
          <div className="confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
            <h2 id="confirm-title">{confirm.title}</h2>
            <p id="confirm-body">{confirm.body}</p>
            <div className="confirm-row">
              {confirm.choices.map((c, i) => (
                <button key={c.label} ref={i === 0 ? first : undefined} type="button" className={c.primary ? 'btn primary' : c.label === 'Cancel' ? 'link' : 'btn'} onClick={c.run}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
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

type ComposerApi = { add: (files: File[]) => void; prefill: (text: string) => void }

/** Things to say, from where the person is (06 section 4). */
function useSuggestions(max = 4) {
  const model = useStudio((s) => s.model)
  const roomId = useStudio((s) => s.roomId)
  const checks = useStudio((s) => s.checks)
  const asBuilt = useStudio((s) => s.schemes.find((x) => x.id === s.schemeId)?.role === 'asbuilt')
  const recent = useStudio((s) => {
    const last = s.messages[s.messages.length - 1]
    return last?.role === 'assistant' && /inspiration/i.test(last.body) && /^Added /.test(last.body) ? last.id : null
  })
  return useMemo(() => suggestions({ model, roomId, checks, asBuilt, recentInspiration: recent }, max), [model, roomId, checks, asBuilt, recent, max])
}

function Suggestions({ onPick }: { onPick: (t: string) => void }) {
  const list = useSuggestions(3)
  const messages = useStudio((s) => s.messages.length)
  if (!messages || !list.length) return null // the welcome shows them when the chat is empty
  return (
    <div className="chips suggest" aria-label="Suggestions">
      {list.map((t) => (
        <button key={t} type="button" onClick={() => onPick(t)}>
          {t}
        </button>
      ))}
    </div>
  )
}

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

function WelcomeChips() {
  const list = useSuggestions(4)
  return (
    <div className="chips">
      {list.map((t) => (
        <button key={t} type="button" onClick={() => send(t)}>
          {t}
        </button>
      ))}
    </div>
  )
}

function Welcome() {
  const model = useStudio((s) => s.model)
  if (!model)
    return (
      <div className="welcome">
        <p className="welcome-lead">Bring in your plan first, then talk to Velda about it.</p>
        <p className="muted small">Velda reads the plan's own dimensions, so every change starts from the house as drawn.</p>
      </div>
    )
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
          <strong>Add a photo</strong> of a room as it is today. Velda can show your own photo remodeled.
        </li>
      </ul>
      <p className="muted small">Every change is saved as a version, so you can always step back.</p>
      <WelcomeChips />
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
      {m.meta?.render && <RenderLine r={m.meta.render} live={live} />}
      <div className="bubble-body">{renderText(m.body)}</div>
      {!!m.meta?.choices?.length && <Choices choices={m.meta.choices} />}
      {!!m.meta?.products?.length && <Products items={m.meta.products} />}
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
      {after.role === 'after' && <span className="compare-label">{RENDER_LABEL}</span>}
      {b && (
        <a className="compare-open" href={b} target="_blank" rel="noreferrer" download="velda-render.jpg">
          Open full size
        </a>
      )}
    </div>
  )
}

/** Under a render: its quality, size, estimated cost and time, and a way to make it again at best quality. */
function RenderLine({ r, live }: { r: NonNullable<NonNullable<Message['meta']>['render']>; live: boolean }) {
  const busy = useStudio((s) => !!s.activity || !!s.thinking)
  const again = async () => {
    const { runActions } = await import('./actions')
    await runActions([{ op: 'render', from: r.from, ...(r.room ? { room: r.room } : {}), ...(r.words ? { prompt: r.words } : {}), quality: 'best' }])
  }
  return (
    <div className="render-line muted small">
      <span title={r.refs.length ? `Inspiration used:\n${r.refs.join('\n')}` : undefined}>
        {renderNote(r.quality, r.seconds)}
        {r.refs.length ? ` · ${r.refs.length === 1 ? '1 inspiration picture' : `${r.refs.length} inspiration pictures`}` : ''}
      </span>
      {live && r.quality === 'standard' && (
        <button type="button" className="link small" disabled={busy} onClick={() => void again()}>
          Again at best quality (about ${RENDER_RUNS.best.usd.toFixed(2)})
        </button>
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
        useEditor.setState({ notice: `That video could not be read (${plainError(e)}). Try a shorter clip, or a few photos instead.` })
      })
  }
  const prefill = (t: string) => {
    setText(t)
    requestAnimationFrame(() => input.current?.focus())
  }
  if (ref) (ref as any).current = { add, prefill }

  useEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(180, el.scrollHeight)}px`
  }, [text])

  const uploading = atts.some((a) => a.uploading)
  const busy = useStudio((s) => !!s.activity)
  const canSend = ready && !thinking && !busy && !uploading && (text.trim() || atts.length)
  // 06 section 4: the box says what it will do with pictures and Pinterest links before sending.
  const model = useStudio((s) => s.model)
  const focus = useStudio((s) => s.roomId)
  const pics = atts.filter((a) => /^image\//.test(a.type) && a.path)
  const pinLinks = (text.match(/https?:\/\/\S+/g) ?? []).filter((u) => ['pin', 'board'].includes(classifyLink(u).kind))
  const canInspire = !!(pics.length || pinLinks.length)
  const [inspire, setInspire] = useState(true)
  const [inspRoom, setInspRoom] = useState<string>('')
  useEffect(() => {
    if (!canInspire) {
      setInspire(true)
      setInspRoom('')
    }
  }, [canInspire])
  const room = inspRoom || focus || ''
  const submit = () => {
    if (!canSend) return
    const list = atts.map(({ key, uploading: _u, ...a }) => a)
    setText('')
    setAtts([])
    if (canInspire && inspire) {
      // Pictures and pins become inspiration; anything else said goes to Velda after.
      const rest = pinLinks.reduce((t, u) => t.replace(u, ''), text).trim()
      const others = list.filter((a) => !pics.some((p) => p.path === a.path))
      void (async () => {
        const sources: Source[] = []
        for (const p of pics) sources.push({ path: p.path, name: p.name, blob: p.preview ? await fetch(p.preview).then((r) => r.blob()).catch(() => null) : null })
        for (const url of pinLinks) sources.push({ url })
        await addInspiration(sources, room ? [room] : [], pics.map(({ key: _k, uploading: _u, ...a }) => a))
        if (rest || others.length) await send(rest, others)
      })()
      return
    }
    void send(text, list)
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {canInspire && (
        <div className="insp-line">
          <label>
            <input type="checkbox" checked={inspire} onChange={(e) => setInspire(e.target.checked)} />
            Add {[pics.length && `${pics.length === 1 ? 'the picture' : `${pics.length} pictures`}`, pinLinks.length && (pinLinks.length === 1 ? `the ${classifyLink(pinLinks[0]).kind}` : `${pinLinks.length} Pinterest links`)].filter(Boolean).join(' and ')} to inspiration for
          </label>
          <label>
            <span className="sr-only">Room</span>
            <select value={room} onChange={(e) => setInspRoom(e.target.value)} disabled={!inspire}>
              <option value="">the whole house</option>
              {model?.rooms
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </label>
          {!inspire && <span className="muted small">Velda will look at {pics.length ? 'them' : 'it'} in the chat instead.</span>}
        </div>
      )}
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
      {!text && !atts.length && !thinking && !busy && <Suggestions onPick={(t) => void send(t)} />}
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
          Add photos
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
