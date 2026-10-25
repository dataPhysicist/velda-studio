// First run (06 section 8): a welcome with one big drop zone and a sample plan, then a short tour
// that points at the real thing: click a room, say something to Velda, drag a wall, add a Pinterest
// link, share. Each step finishes when the person does it; every step can be skipped and the tour ended.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { startImport, useImport } from './importFlow'
import { openDialog, useDialogs } from './Palette'
import { setPrefs, useStudio } from './store'

/** The sample plan (the A2 sheet) next to the build: jsDelivr at the release commit, or the dev server. */
export function sampleUrl() {
  if (import.meta.env.DEV) return `${location.origin}/scripts/fixtures/A2-asbuilt-level2.pdf`
  return new URL('../scripts/fixtures/A2-asbuilt-level2.pdf', import.meta.url).href
}

export function FirstRun() {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const sample = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch(sampleUrl())
      if (!r.ok) throw new Error(`the sample could not be downloaded (${r.status})`)
      await startImport(new File([await r.blob()], 'A2-asbuilt-level2.pdf', { type: 'application/pdf' }))
    } catch (e) {
      setErr(String((e as Error).message || e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="first-run" role="region" aria-label="Welcome">
      <h1>Velda Studio</h1>
      <p className="first-lead">Your house, measured from its plans, to remodel by talking and by hand.</p>
      <button
        type="button"
        className={`first-drop${over ? ' is-over' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = [...e.dataTransfer.files].find((x) => /pdf$/i.test(x.type) || /\.pdf$/i.test(x.name))
          if (f) void startImport(f)
        }}
      >
        <strong>Drop your floor plan PDF.</strong>
        <span>We'll read it and ask a few questions.</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        aria-label="Floor plan PDF"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void startImport(f)
        }}
      />
      <p>
        No plan handy?{' '}
        <button type="button" className="link" disabled={busy} onClick={() => void sample()}>
          {busy ? 'Getting the sample...' : 'Try the sample plan'}
        </button>{' '}
        <span className="muted small">(the second floor of a real house)</span>
      </p>
      {err && <p className="veil-error">{err}. Drop a PDF of your own instead.</p>}
    </div>
  )
}

type Step = { title: string; body: string; anchor: string; done: (s: ReturnType<typeof useStudio.getState>, start: Snap) => boolean; enter?: () => void }
type Snap = { messages: number; versions: number; inspiration: number }

const STEPS: Step[] = [
  {
    title: 'Click a room',
    body: 'Click any room on the plan. Its size, ceiling and where each number came from show on the right.',
    anchor: '.plan-svg',
    enter: () => useStudio.setState({ view: 'plan' }),
    done: (s) => !!s.roomId,
  },
  {
    title: 'Tell Velda what to change',
    body: 'Say it the way you would to a designer. Press Enter to send this one, or type your own. Every change is a version you can undo.',
    anchor: '.composer textarea',
    done: (s, a) => s.messages.filter((m) => m.role === 'user').length > a.messages,
  },
  {
    title: 'Drag a wall',
    body: 'Drag a wall in the plan. Both rooms change size as you go, and you can type a size to set it exactly. Cmd-Z undoes it.',
    anchor: '.plan-svg',
    enter: () => useStudio.setState({ view: 'plan', tool: 'select' as any }),
    done: (s, a) => s.versions.length > a.versions && /wall/i.test(s.versions[s.versions.length - 1]?.summary ?? ''),
  },
  {
    title: 'Add inspiration',
    body: 'Paste a Pinterest pin or board, or drop pictures you like. Velda tags them and measures their colors, and can make a theme from them.',
    anchor: '.insp-link input',
    enter: () => useStudio.setState({ ctxTab: 'inspiration' }),
    done: (s, a) => (s.model?.inspiration.length ?? 0) > a.inspiration,
  },
  {
    title: 'Share it',
    body: 'Share makes a read-only link for anyone. Export builds the package for your designer or architect: sheets, CAD, 3D and schedules.',
    anchor: '.tb-row .link[data-share]',
    done: () => useDialogs.getState().open === 'share' || useDialogs.getState().open === 'export',
  },
]

export function Tour({ prefill }: { prefill: (text: string) => void }) {
  const step = useStudio((s) => s.tour)
  const firstRun = useStudio((s) => s.firstRun)
  const model = useStudio((s) => s.model)
  const tourDone = useStudio((s) => s.prefs.tourDone)
  const importing = useImport((s) => s.stage !== 'idle')
  const [rect, setRect] = useState<DOMRect | null>(null)
  const start = useRef<Snap>({ messages: 0, versions: 0, inspiration: 0 })
  // After the first plan comes in, the tour starts by itself (once).
  useEffect(() => {
    if (firstRun && model && !importing) {
      useStudio.setState({ firstRun: false, ...(tourDone ? {} : { tour: 0 }) })
    }
  }, [firstRun, model, importing])
  // Entering a step: note where things stand, set the scene, prefill the chat for step 2.
  useEffect(() => {
    if (step === null) return
    const s = useStudio.getState()
    start.current = { messages: s.messages.filter((m) => m.role === 'user').length, versions: s.versions.length, inspiration: s.model?.inspiration.length ?? 0 }
    STEPS[step]?.enter?.()
    if (step === 1) prefill('Move the sink to the island')
  }, [step])
  // Finish a step when the person does it.
  useEffect(() => {
    if (step === null) return
    const check = () => {
      const s = useStudio.getState()
      if (s.tour !== null && STEPS[s.tour]?.done(s, start.current)) next()
    }
    const un1 = useStudio.subscribe(check)
    const un2 = useDialogs.subscribe(check)
    return () => (un1(), un2())
  }, [step])
  // Follow the thing the step points at.
  useLayoutEffect(() => {
    if (step === null) return setRect(null)
    let raf = 0
    const tick = () => {
      const el = document.querySelector(STEPS[step].anchor)
      const r = el?.getBoundingClientRect() ?? null
      setRect((old) => (r && old && Math.abs(r.x - old.x) + Math.abs(r.y - old.y) + Math.abs(r.width - old.width) < 1 ? old : r))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [step])
  if (step === null || !model) return null
  const s = STEPS[step]
  const card = place(rect)
  return (
    <>
      {rect && <div className="tour-ring" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} aria-hidden="true" />}
      <div className="tour-card" role="dialog" aria-label="Tour" style={card}>
        <p className="tour-step">
          Step {step + 1} of {STEPS.length}
        </p>
        <h2>{s.title}</h2>
        <p>{s.body}</p>
        <div className="tour-row">
          <button type="button" className="btn small primary" onClick={next}>
            {step === STEPS.length - 1 ? 'Done' : 'Next'}
          </button>
          <button type="button" className="link small" onClick={end}>
            End the tour
          </button>
        </div>
      </div>
    </>
  )
}

function next() {
  const step = useStudio.getState().tour
  if (step === null) return
  if (step >= STEPS.length - 1) end()
  else useStudio.setState({ tour: step + 1 })
}

function end() {
  useStudio.setState({ tour: null })
  void setPrefs({ tourDone: true })
}

/** Put the card beside what it points at, inside the window. */
function place(r: DOMRect | null): React.CSSProperties {
  const W = 320
  if (!r) return { left: 24, bottom: 24, width: W }
  const vw = window.innerWidth
  const vh = window.innerHeight
  // A big target (the plan): sit inside its lower left corner.
  if (r.width > 500 && r.height > 300) return { left: Math.max(16, r.left + 16), top: Math.min(vh - 220, r.bottom - 220), width: W }
  const right = r.right + 16 + W < vw
  const left = right ? r.right + 16 : Math.max(16, r.left - W - 16)
  const top = Math.min(vh - 220, Math.max(16, r.top - 20))
  return { left, top, width: W }
}

export { openDialog }
