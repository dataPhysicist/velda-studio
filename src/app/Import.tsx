// The plan import screens: progress, the page strip, and the Confirm screen (05 sections 5, 6, 8).
// The sheet sits on the left with the trace drawn over it, so a person checks the reading against
// the drawing itself: ink where a dimension string governs, amber where only the trace does.
import { useMemo, useRef, useState } from 'react'
import { splitAtJunctions } from '../import'
import { EXTERIOR_LABEL, type ExteriorBuild, type Intake } from '../import/intake'
import { bindCoordinate } from '../model/derive'
import { pointInPolygon, polygonArea, wallLength } from '../model/geom'
import type { Dimension, Model, Opening, Vec, Wall } from '../model/types'
import { formatFeetInches } from '../model/units'
import { approve, cancelImport, confirmPages, fix, overrule, setAnswers, setChoice, useImport } from './importFlow'

export function ImportFlow() {
  const stage = useImport((s) => s.stage)
  if (stage === 'idle') return null
  return (
    <div className="import" role="dialog" aria-modal="true" aria-label="Bring in a plan">
      {stage === 'pages' ? <PageStrip /> : stage === 'confirm' ? <Confirm /> : stage === 'error' ? <ImportError /> : <Working />}
    </div>
  )
}

function Working() {
  const message = useImport((s) => s.message)
  const stage = useImport((s) => s.stage)
  return (
    <div className="imp-working" role="status">
      <p className="imp-working-head">{stage === 'saving' ? 'Building your house' : 'Reading your plan'}</p>
      <p className="muted">{message}</p>
      {stage !== 'saving' && (
        <button type="button" className="link" onClick={cancelImport}>
          Stop
        </button>
      )}
    </div>
  )
}

function ImportError() {
  const error = useImport((s) => s.error)
  return (
    <div className="imp-working" role="alert">
      <p className="imp-working-head">The plan did not come in</p>
      <p>{error}</p>
      <button type="button" className="btn" onClick={cancelImport}>
        Go back
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ page strip

const LEVELS = ['B1', 'L1', 'L2', 'L3']
const levelName = (id: string | null) => (id === 'B1' ? 'Basement' : id ? `Level ${id.replace(/\D/g, '')}` : 'Level ?')

function PageStrip() {
  const read = useImport((s) => s.read)!
  const sheets = useImport((s) => s.sheets)
  const choices = useImport((s) => s.choices)
  return (
    <div className="imp-pages">
      <header className="imp-bar">
        <h2 className="imp-title">{read.name}</h2>
        <p className="muted">
          {read.pages.length} {read.pages.length === 1 ? 'page' : 'pages'}. Say what each page is; floor plans become levels, the rest stay with the house as reference sheets.
        </p>
      </header>
      <ol className="imp-strip">
        {read.pages.map((p, i) => {
          const c = choices[i]
          const g = sheets[i].guess
          return (
            <li key={p.page} className={c.role === 'skip' ? 'is-skipped' : ''}>
              <img src={read.thumbs[i]} alt={`Page ${p.page}`} />
              <p className="imp-page-name">
                {g.number ?? `Page ${p.page}`} <span className="muted">{g.title || 'No title found'}</span>
              </p>
              <div className="chips" role="group" aria-label={`What page ${p.page} is`}>
                {LEVELS.map((lv) => (
                  <button key={lv} type="button" aria-pressed={c.role === 'asbuilt' && c.level === lv} onClick={() => setChoice(i, { role: 'asbuilt', level: lv })}>
                    {levelName(lv)} as-built
                  </button>
                ))}
                {LEVELS.map((lv) => (
                  <button key={`p${lv}`} type="button" aria-pressed={c.role === 'proposed' && c.level === lv} onClick={() => setChoice(i, { role: 'proposed', level: lv })}>
                    {levelName(lv)} proposed
                  </button>
                ))}
                <button type="button" aria-pressed={c.role === 'reference'} onClick={() => setChoice(i, { role: 'reference', level: null })}>
                  Reference
                </button>
                <button type="button" aria-pressed={c.role === 'skip'} onClick={() => setChoice(i, { role: 'skip', level: null })}>
                  Skip
                </button>
              </div>
            </li>
          )
        })}
      </ol>
      <footer className="imp-foot">
        <button type="button" className="btn" onClick={cancelImport}>
          Go back
        </button>
        <button type="button" className="btn primary" onClick={() => void confirmPages()}>
          Read the floor plans
        </button>
      </footer>
    </div>
  )
}

// ------------------------------------------------------------------ confirm

const sentence = (t: string) => (t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t).replace(/\blevel (\d)/i, 'level $1')

const plain = (scaleText: string) => {
  const m = /^(\d+(?:\/\d+)?)"\s*=\s*1'-0"$/.exec(scaleText)
  return m ? `${m[1]} in = 1 ft` : scaleText
}

function Confirm() {
  const result = useImport((s) => s.result)!
  const answers = useImport((s) => s.answers)!
  const queue = useImport((s) => s.queue)
  const [hover, setHover] = useState<string | null>(null)
  const [answered, setAnswered] = useState<null | 'yes' | 'fix'>(null)
  const m = result.model
  const lv = m.levels[0]
  const sheet = m.sheets[0]
  const report = result.report
  const segments = useMemo(() => countSegments(m), [m])
  const sample = useMemo(() => sampleRoom(m), [m])
  const flagged = report.flags.find((f) => f.kind === 'needs_confirming')?.rooms ?? []
  const demolish = report.flags.find((f) => f.kind === 'demolish')?.rooms ?? []
  const stair = m.stairs[0]
  const stairWord = stair ? (stair.toLevel === lv.id ? ' and a stair going down' : ' and a stair going up') : ''
  const c = report.counts

  return (
    <div className="imp-confirm" data-testid="import-confirm">
      <header className="imp-bar">
        <h2 className="imp-title">
          {sheet.id} <span className="muted">{sentence(sheet.title)}</span>
        </h2>
        <p className="muted small">Check what we read against the drawing. Click a wall or opening on the sheet to fix it here.</p>
      </header>
      <section className="imp-sheet" aria-label="The sheet with what we traced">
        <SheetView model={m} hover={hover} />
      </section>
      <section className="imp-read" aria-label="What we read">
        <h3>What we read</h3>
        <p className="lede">
          This is <b>{lv.name}</b>, drawn {sheet.role === 'proposed' ? 'as a proposed design' : 'as it is today (as-built)'}, at <b>{plain(sheet.scale.text)}</b>.
          {sample && (
            <>
              {' '}
              The {sample.room.toLowerCase()} reads <b>{sample.text}</b> {sample.axis === 'x' ? 'wide' : 'deep'}.{answered === null && ' Does that match?'}
            </>
          )}
        </p>
        {answered === null && (
          <p className="chips">
            <button type="button" onClick={() => setAnswered('yes')}>
              Yes
            </button>
            <button type="button" onClick={() => setAnswered('fix')}>
              Fix
            </button>
          </p>
        )}
        {answered === 'fix' && <FixSheet />}
        <p>
          We found <b>{segments} walls</b>, <b>{c.doors} doors</b>, <b>{c.windows} windows</b>, <b>{c.openings} open passages</b> and <b>{c.rooms} rooms</b>
          {stairWord}.
        </p>
        <Conflicts />
        {flagged.length > 0 && (
          <p>
            <b>
              {flagged.length} {flagged.length === 1 ? 'room is' : 'rooms are'} marked “dimensions need confirming”
            </b>{' '}
            on the drawing: {flagged.join(', ')}. They keep that flag until someone measures them.
          </p>
        )}
        {demolish.length > 0 && (
          <p>
            Items marked to be demolished on the drawing: <b>{demolish.join(', ')}</b>.
          </p>
        )}
        <p>
          <b>We assumed</b> {formatFeetInches(answers.windowSill === 'varies' ? 36 : answers.windowSill)} window sills, {formatFeetInches(answers.windowHead === 'varies' ? 84 : answers.windowHead)} window heads,{' '}
          {formatFeetInches(answers.doorHeight)} doors and {formatFeetInches(answers.floorThickness === 'unknown' ? 12 : answers.floorThickness)} of floor structure. Change any of these on the right.
        </p>
        <Unplaced onHover={setHover} />
        {report.unnamedRooms.length > 0 && (
          <p className="muted">
            {report.unnamedRooms.length === 1 ? 'One small space has' : `${report.unnamedRooms.length} small spaces have`} no name on the drawing; we called{' '}
            {report.unnamedRooms.length === 1 ? 'it' : 'them'} {report.unnamedRooms.join(' and ')}. Name them later in the plan.
          </p>
        )}
        {report.fixtureStrings.length > 0 && (
          <p className="muted">
            {report.fixtureStrings.length} dimensions measure fixtures and cabinets rather than walls; they stay on the plan for reference.
          </p>
        )}
      </section>
      <section className="imp-ask" aria-label="A few questions">
        <h3>A few questions</h3>
        <Questions answers={answers} model={m} />
      </section>
      <footer className="imp-foot">
        <button type="button" className="btn" onClick={cancelImport}>
          Go back
        </button>
        <span className="muted small">{queue.length ? `${queue.length} more ${queue.length === 1 ? 'sheet' : 'sheets'} after this one` : ''}</span>
        <button type="button" className="btn primary" onClick={() => void approve()}>
          Looks right, build my house
        </button>
      </footer>
    </div>
  )
}

/** Change what the sheet is (level, as-built or proposed). A wrong size means a wrong scale: say so. */
function FixSheet() {
  const current = useImport((s) => s.current)!
  const choice = useImport((s) => s.choices[s.current ?? 0])
  return (
    <div className="imp-fix">
      <div className="chips" role="group" aria-label="Level">
        {LEVELS.map((lv) => (
          <button key={lv} type="button" aria-pressed={choice.level === lv} onClick={() => setChoice(current, { ...choice, level: lv }, true)}>
            {levelName(lv)}
          </button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="As built or proposed">
        <button type="button" aria-pressed={choice.role === 'asbuilt'} onClick={() => setChoice(current, { ...choice, role: 'asbuilt' }, true)}>
          As it is today
        </button>
        <button type="button" aria-pressed={choice.role === 'proposed'} onClick={() => setChoice(current, { ...choice, role: 'proposed' }, true)}>
          A proposed design
        </button>
      </div>
      <p className="muted small">If a room size is wrong, the drawing's scale is being misread. Note the right size in the last question and we will check it with you before anything is built on it.</p>
    </div>
  )
}

function Conflicts() {
  const result = useImport((s) => s.result)!
  const ignore = useImport((s) => s.ignore)
  const [open, setOpen] = useState(false)
  const conflicts = result.report.conflicts
  const overruled = result.dims.filter((d) => ignore.includes(d.id))
  if (!conflicts.length && !overruled.length) return <p>Every dimension on the drawing that we could match to walls agrees with the trace.</p>
  return (
    <div>
      <p>
        <button type="button" className="disclose" aria-expanded={open} onClick={() => setOpen(!open)}>
          <b>
            {conflicts.length} {conflicts.length === 1 ? 'dimension' : 'dimensions'} on the drawing {conflicts.length === 1 ? "doesn't" : "don't"} match what we traced
          </b>
        </button>
      </p>
      {open && (
        <ul className="imp-list">
          {conflicts.map((c) => {
            const d = result.dims.find((x) => x.text === c.dimension)
            return (
              <li key={`${c.dimension}${c.where.join()}`}>
                Drawn {c.dimension}, traced {formatFeetInches(c.traced)}.{' '}
                {d && (
                  <button type="button" className="link" onClick={() => overrule(d.id, true)}>
                    Use traced
                  </button>
                )}
              </li>
            )
          })}
          {overruled.map((d) => (
            <li key={d.id}>
              {d.text}: using the trace.{' '}
              <button type="button" className="link" onClick={() => overrule(d.id, false)}>
                Use drawn
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Unplaced({ onHover }: { onHover: (id: string | null) => void }) {
  const result = useImport((s) => s.result)!
  const [open, setOpen] = useState(false)
  const items = result.report.unresolved
  if (!items.length) return null
  return (
    <div>
      <p>
        <button type="button" className="disclose" aria-expanded={open} onClick={() => setOpen(!open)}>
          <b>
            {items.length} {items.length === 1 ? 'thing' : 'things'} we could not place
          </b>
        </button>
      </p>
      {open && (
        <ul className="imp-list" onMouseLeave={() => onHover(null)}>
          {items.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Questions({ answers, model }: { answers: Intake; model: Model }) {
  const ftIn = (v: number) => formatFeetInches(v)
  const named = model.rooms.filter((r) => !r.flags.includes('needs_name'))
  return (
    <form className="imp-q" onSubmit={(e) => e.preventDefault()}>
      {model.levels.map((lv) => (
        <label key={lv.id} title="Sets the wall height, window proportions and the 3D view.">
          <span>Ceiling height, {lv.name}</span>
          <select value={answers.ceilings[lv.id]} onChange={(e) => setAnswers({ ceilings: { ...answers.ceilings, [lv.id]: Number(e.target.value) } })}>
            {[96, 102, 108, 114, 120, 126, 132, 144].map((v) => (
              <option key={v} value={v}>
                {ftIn(v)}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label title="Where the level above sits in 3D, and how long the stair is.">
        <span>Floor structure between levels</span>
        <select value={String(answers.floorThickness)} onChange={(e) => setAnswers({ floorThickness: e.target.value === 'unknown' ? 'unknown' : Number(e.target.value) })}>
          {[10, 12, 14, 16].map((v) => (
            <option key={v} value={v}>
              {ftIn(v)}
            </option>
          ))}
          <option value="unknown">I don't know</option>
        </select>
      </label>
      <label title="Wall thickness where the trace is unsure, and which walls may carry load.">
        <span>Outside walls are built of</span>
        <select value={answers.exterior} onChange={(e) => setAnswers({ exterior: e.target.value as ExteriorBuild })}>
          {(Object.keys(EXTERIOR_LABEL) as ExteriorBuild[]).map((k) => (
            <option key={k} value={k}>
              {EXTERIOR_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Window heads</span>
        <select value={String(answers.windowHead)} onChange={(e) => setAnswers({ windowHead: e.target.value === 'varies' ? 'varies' : Number(e.target.value) })}>
          {[80, 84, 90, 96].map((v) => (
            <option key={v} value={v}>
              {ftIn(v)}
            </option>
          ))}
          <option value="varies">They vary; I'll set them later</option>
        </select>
      </label>
      <label>
        <span>Window sills</span>
        <select value={String(answers.windowSill)} onChange={(e) => setAnswers({ windowSill: e.target.value === 'varies' ? 'varies' : Number(e.target.value) })}>
          {[18, 24, 30, 36, 42].map((v) => (
            <option key={v} value={v}>
              {ftIn(v)}
            </option>
          ))}
          <option value="varies">They vary; I'll set them later</option>
        </select>
      </label>
      <label>
        <span>Doors</span>
        <select value={answers.doorHeight} onChange={(e) => setAnswers({ doorHeight: Number(e.target.value) })}>
          <option value={80}>6'-8" tall</option>
          <option value={96}>8'-0" tall</option>
        </select>
      </label>
      <fieldset title='So "front" and "back" mean the same thing to you and to Velda, and the sun is right in renders.'>
        <legend>Which side faces the street?</legend>
        <div className="chips">
          {(['top', 'right', 'bottom', 'left'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={answers.front === s} onClick={() => setAnswers({ front: answers.front === s ? null : s })}>
              {s[0].toUpperCase() + s.slice(1)} of the sheet
            </button>
          ))}
        </div>
      </fieldset>
      <label title="Sets sensible guesses: plaster or drywall, how the framing was done.">
        <span>Year built, or roughly when (optional)</span>
        <input type="text" value={answers.era} placeholder="1987, or late 80s" onChange={(e) => setAnswers({ era: e.target.value })} />
      </label>
      <fieldset>
        <legend>Rooms you are thinking of remodeling (optional)</legend>
        <div className="chips">
          {named.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={answers.remodelRooms.includes(r.id)}
              onClick={() => setAnswers({ remodelRooms: answers.remodelRooms.includes(r.id) ? answers.remodelRooms.filter((x) => x !== r.id) : [...answers.remodelRooms, r.id] })}
            >
              {r.name}
            </button>
          ))}
        </div>
      </fieldset>
      <label>
        <span>Anything else we should know about this plan?</span>
        <textarea rows={3} value={answers.notes} onChange={(e) => setAnswers({ notes: e.target.value })} />
      </label>
    </form>
  )
}

// ------------------------------------------------------------------ the sheet with the trace over it

const unit = (w: Wall): Vec => {
  const L = wallLength(w) || 1
  return [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L]
}
const at = (w: Wall, s: number): Vec => {
  const u = unit(w)
  return [w.a[0] + u[0] * s, w.a[1] + u[1] * s]
}
const left = (w: Wall): Vec => {
  const u = unit(w)
  return [u[1], -u[0]]
}
const pts = (p: Vec[]) => p.map((q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`).join(' ')

function wallPoly(w: Wall): Vec[] {
  const n = left(w)
  const h = (w.tMeasured ?? w.t) / 2
  return [
    [w.a[0] + n[0] * h, w.a[1] + n[1] * h],
    [w.b[0] + n[0] * h, w.b[1] + n[1] * h],
    [w.b[0] - n[0] * h, w.b[1] - n[1] * h],
    [w.a[0] - n[0] * h, w.a[1] - n[1] * h],
  ]
}

function OpeningMark({ o, w, selected }: { o: Opening; w: Wall; selected: boolean }) {
  const t = (w.tMeasured ?? w.t) / 2 + 0.6
  const n = left(w)
  const u = unit(w)
  const s0 = o.at - o.w / 2
  const s1 = o.at + o.w / 2
  const p0 = at(w, s0)
  const p1 = at(w, s1)
  const off = (p: Vec, k: number): Vec => [p[0] + n[0] * k, p[1] + n[1] * k]
  const gap = [off(p0, t), off(p1, t), off(p1, -t), off(p0, -t)]
  const cls = `op op-${o.kind}${selected ? ' is-selected' : ''}`
  if (o.kind === 'window')
    return (
      <g className={cls}>
        <polygon points={pts(gap)} className="op-gap" />
        {[-0.3, 0, 0.3].map((k) => (
          <line key={k} x1={off(p0, k * 2 * t)[0]} y1={off(p0, k * 2 * t)[1]} x2={off(p1, k * 2 * t)[0]} y2={off(p1, k * 2 * t)[1]} />
        ))}
      </g>
    )
  if (o.kind === 'door' && o.swing) {
    const hinge = o.swing.hinge === 'a' ? p0 : p1
    const toward: Vec = o.swing.hinge === 'a' ? u : [-u[0], -u[1]]
    const side = o.swing.side === 'left' ? 1 : -1
    const face = off(hinge, side * (t - 0.6))
    const leafEnd: Vec = [face[0] + n[0] * side * o.w, face[1] + n[1] * side * o.w]
    const jamb: Vec = [face[0] + toward[0] * o.w, face[1] + toward[1] * o.w]
    // arc from the leaf's end to the far jamb, centered on the hinge
    const sweep = side * (toward[0] * n[1] - toward[1] * n[0]) > 0 ? 0 : 1
    return (
      <g className={cls}>
        <polygon points={pts(gap)} className="op-gap" />
        <line x1={face[0]} y1={face[1]} x2={leafEnd[0]} y2={leafEnd[1]} />
        <path d={`M ${leafEnd[0]} ${leafEnd[1]} A ${o.w} ${o.w} 0 0 ${sweep} ${jamb[0]} ${jamb[1]}`} className="op-arc" />
      </g>
    )
  }
  return (
    <g className={cls}>
      <polygon points={pts(gap)} className="op-gap" />
      <line x1={off(p0, t)[0]} y1={off(p0, t)[1]} x2={off(p0, -t)[0]} y2={off(p0, -t)[1]} className="op-jamb" />
      <line x1={off(p1, t)[0]} y1={off(p1, t)[1]} x2={off(p1, -t)[0]} y2={off(p1, -t)[1]} className="op-jamb" />
    </g>
  )
}

function SheetView({ model, hover }: { model: Model; hover: string | null }) {
  const rasterUrl = useImport((s) => s.rasterUrl)
  const trace = useImport((s) => s.trace)
  const result = useImport((s) => s.result)!
  const sheet = model.sheets[0]
  const sx = trace?.pxPerInch.x ?? 6.25
  const sy = trace?.pxPerInch.y ?? 6.25
  const W = sheet.raster.px[0] / sx || 800
  const H = sheet.raster.px[1] / sy || 600
  const [view, setView] = useState(() => {
    // open on the drawing, not the whole sheet: the walls' extent with a margin
    if (!model.walls.length) return { x: 0, y: 0, w: W, h: H }
    const xs = model.walls.flatMap((w) => [w.a[0], w.b[0]])
    const ys = model.walls.flatMap((w) => [w.a[1], w.b[1]])
    const x0 = Math.min(...xs)
    const y0 = Math.min(...ys)
    const w = Math.max(...xs) - x0
    const h = Math.max(...ys) - y0
    const m = Math.max(w, h) * 0.06
    return { x: x0 - m, y: y0 - m, w: w + 2 * m, h: h + 2 * m }
  })
  const [sel, setSel] = useState<{ kind: 'wall' | 'opening'; id: string } | null>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const toSheet = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect()
    const k = Math.max(view.w / r.width, view.h / r.height)
    const ox = view.x + (view.w - r.width * k) / 2
    const oy = view.y + (view.h - r.height * k) / 2
    return { x: ox + (e.clientX - r.left) * k, y: oy + (e.clientY - r.top) * k, k }
  }
  const wallsById = new Map(model.walls.map((w) => [w.id, w]))
  const selWall = sel?.kind === 'wall' ? wallsById.get(sel.id) : null
  const selOpening = sel?.kind === 'opening' ? model.openings.find((o) => o.id === sel.id) : null
  return (
    <div className="sheet-view">
      <svg
        ref={svg}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        onWheel={(e) => {
          const p = toSheet(e)
          const f = Math.exp(e.deltaY * 0.0015)
          const w = Math.min(W * 1.5, Math.max(40, view.w * f))
          const h = (w / view.w) * view.h
          setView({ x: p.x - ((p.x - view.x) * w) / view.w, y: p.y - ((p.y - view.y) * h) / view.h, w, h })
        }}
        onPointerDown={(e) => {
          if ((e.target as Element).closest('.hit')) return
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const r = svg.current!.getBoundingClientRect()
          const k = Math.max(view.w / r.width, view.h / r.height)
          setView({ ...view, x: d.vx - (e.clientX - d.x) * k, y: d.vy - (e.clientY - d.y) * k })
        }}
        onPointerUp={() => (drag.current = null)}
        role="img"
        aria-label="The plan sheet with the traced walls, doors and windows drawn over it"
      >
        {rasterUrl && <image href={rasterUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="none" className="sheet-raster" />}
        {result.tints.map((t, i) => (
          <rect key={i} x={t.rect[0]} y={t.rect[1]} width={t.rect[2] - t.rect[0]} height={t.rect[3] - t.rect[1]} className={`tint tint-${t.kind}`} />
        ))}
        {model.rooms.map((r) => (
          <polygon key={r.id} points={pts(r.polygon)} className={`room${r.flags.includes('needs_confirming') ? ' is-confirm' : ''}`} />
        ))}
        {model.walls.map((w) => (
          <polygon
            key={w.id}
            points={pts(wallPoly(w))}
            className={`hit wall src-${w.prov.a.src}${w.demolish ? ' is-demolish' : ''}${sel?.id === w.id || hover === w.id ? ' is-selected' : ''}`}
            onClick={() => setSel({ kind: 'wall', id: w.id })}
          >
            <title>{`Wall ${formatFeetInches(wallLength(w))} long, ${formatFeetInches(w.tMeasured ?? w.t)} thick${w.prov.a.src === 'sheet_dim' ? `, set by the drawing's ${w.prov.a.note?.replace(/^string /, '').replace(/ on .*/, '')}` : ', traced'}`}</title>
          </polygon>
        ))}
        {model.openings.map((o) => {
          const w = wallsById.get(o.wall)
          if (!w) return null
          return (
            <g key={o.id} className="hit" onClick={() => setSel({ kind: 'opening', id: o.id })}>
              <OpeningMark o={o} w={w} selected={sel?.id === o.id} />
              <title>{`${o.kind === 'opening' ? 'Open passage' : o.kind === 'window' ? 'Window' : 'Door'}, ${formatFeetInches(o.w)} wide`}</title>
            </g>
          )
        })}
        {model.stairs.map((s) => (
          <polygon key={s.id} points={pts(s.polygon)} className="stair" />
        ))}
        {model.dimensions.map((d) => (
          <DimMark key={d.id} d={d} />
        ))}
        {model.rooms.map((r) =>
          r.labelAt ? (
            <text key={r.id} x={r.labelAt[0]} y={r.labelAt[1]} className="room-name">
              {r.name}
            </text>
          ) : null,
        )}
      </svg>
      <div className="sheet-key" aria-hidden="true">
        <span className="k k-dim">Wall set by a drawn dimension</span>
        <span className="k k-raster">Wall traced only</span>
        <span className="k k-conflict">Does not match its dimension</span>
      </div>
      {(selWall || selOpening) && (
        <div className="sheet-pop" role="dialog" aria-label="Fix this">
          {selWall && (
            <>
              <p>
                Wall, {formatFeetInches(wallLength(selWall))} long, {formatFeetInches(selWall.tMeasured ?? selWall.t)} thick.
              </p>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  fix({ kind: 'remove_wall', id: selWall.id })
                  setSel(null)
                }}
              >
                This is not a wall
              </button>
            </>
          )}
          {selOpening && (
            <>
              <p>
                {selOpening.kind === 'opening' ? 'Open passage' : selOpening.kind === 'window' ? 'Window' : 'Door'}, {formatFeetInches(selOpening.w)} wide.
              </p>
              <div className="chips">
                {(['door', 'window', 'opening'] as const)
                  .filter((k) => k !== selOpening.kind)
                  .map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        fix({ kind: 'opening_kind', id: selOpening.id, to: k })
                        setSel(null)
                      }}
                    >
                      This is {k === 'opening' ? 'an open passage' : `a ${k}`}
                    </button>
                  ))}
                <button
                  type="button"
                  onClick={() => {
                    fix({ kind: 'remove_opening', id: selOpening.id })
                    setSel(null)
                  }}
                >
                  There is nothing here
                </button>
              </div>
            </>
          )}
          <button type="button" className="link" onClick={() => setSel(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  )
}

function DimMark({ d }: { d: Dimension }) {
  const mid: Vec = [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2]
  const vertical = Math.abs(d.b[1] - d.a[1]) > Math.abs(d.b[0] - d.a[0])
  return (
    <g className={`dim dim-${d.status}`}>
      <line x1={d.a[0]} y1={d.a[1]} x2={d.b[0]} y2={d.b[1]} />
      <text x={mid[0]} y={mid[1] - 1.5} transform={vertical ? `rotate(-90 ${mid[0]} ${mid[1]})` : undefined}>
        {d.text}
      </text>
    </g>
  )
}

// ------------------------------------------------------------------ helpers

/** Walls as a person counts them: one per run between junctions (same rule as the import check). */
function countSegments(m: Model) {
  const centers = new Map(
    m.openings.map((o) => {
      const w = m.walls.find((x) => x.id === o.wall)!
      return [o.id, at(w, o.at)] as [string, Vec]
    }),
  )
  return splitAtJunctions(m.walls, m.openings, centers).walls.length
}

/** The biggest room with a drawn clear dimension bound to two of its wall faces: the sanity question. */
function sampleRoom(m: Model): { room: string; text: string; axis: 'x' | 'y' } | null {
  const rooms = [...m.rooms].filter((r) => !r.flags.includes('needs_name')).sort((p, q) => polygonArea(q.polygon) - polygonArea(p.polygon))
  for (const r of rooms)
    for (const d of m.dimensions) {
      if (d.status !== 'ok' || d.binds.length !== 2 || d.binds.some((b) => b.kind !== 'wall_face')) continue
      const mid: Vec = [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2]
      if (!pointInPolygon(mid, r.polygon)) continue
      const a = bindCoordinate(m, d, 0)
      const b = bindCoordinate(m, d, 1)
      if (a === null || b === null) continue
      return { room: r.name, text: d.text, axis: Math.abs(d.b[0] - d.a[0]) > Math.abs(d.b[1] - d.a[1]) ? 'x' : 'y' }
    }
  return null
}
