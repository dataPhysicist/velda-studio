// The context panel, Selection tab (06 section 2): plain fields for whatever is selected, each number
// with its provenance in words. Editing a field is a hand edit (a version by the person, provenance
// "you set this"). With nothing selected it says what to do next, never an empty panel.
import { useEffect, useState } from 'react'
import { parseLength } from '../import/dims'
import { polygonArea, wallLength } from '../model/geom'
import type { Op } from '../model/ops'
import { type Badge, type Comment, type Item, type Model, type Opening, type OpeningKind, type Prov, type Room, type Wall, badgeOf, weakestBadge } from '../model/types'
import { formatFeetInches as fmt } from '../model/units'
import { roomAt, roomClearDims, leftOf, pointOn, thick } from '../plan2d/geometry'
import { ChecksPanel } from './Checks'
import { InspirationPanel } from './InspirationPanel'
import { clearSelection, handEdit, removeSelected, select, setTool, useEditor } from './editor'
import { useStudio } from './store'

const PROV_WORDS: Record<string, string> = {
  sheet_dim: 'measured from drawing',
  field: 'field measured',
  user: 'you set this',
  sheet_raster: 'traced',
  sheet_vector: 'traced',
  ai: 'set by Velda',
  derived: 'worked out',
  default: 'assumed',
}
const provWords = (p: Prov | undefined) => PROV_WORDS[p?.src ?? 'default'] ?? 'assumed'

function Badge({ prov, badge, text }: { prov?: Prov; badge?: Badge; text?: string }) {
  const b = badge ?? badgeOf(prov)
  return <span className={`badge b-${b}`}>{text ?? (prov ? provWords(prov) : b === 'measured' ? 'measured' : b)}</span>
}

function LengthField({ label, value, prov, badge, badgeText, onCommit, min = 0.5, hint }: { label: string; value: number; prov?: Prov; badge?: Badge; badgeText?: string; onCommit?: (v: number) => void; min?: number; hint?: string }) {
  const [text, setText] = useState(fmt(value))
  const [bad, setBad] = useState(false)
  useEffect(() => {
    setText(fmt(value))
    setBad(false)
  }, [value])
  const commit = () => {
    const v = parseLength(text)
    if (v === null || v < min) {
      setBad(true)
      return
    }
    setBad(false)
    if (Math.abs(v - value) >= 1 / 16) onCommit?.(Math.round(v * 8) / 8)
    else setText(fmt(value))
  }
  return (
    <label className="fld">
      <span className="fld-label">{label}</span>
      {onCommit ? (
        <input
          className={`fld-num${bad ? ' is-bad' : ''}`}
          value={text}
          aria-invalid={bad}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              setText(fmt(value))
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
      ) : (
        <span className="fld-num is-read">{fmt(value)}</span>
      )}
      <Badge prov={prov} badge={badge} text={badgeText} />
      {hint && <span className="fld-hint">{hint}</span>}
    </label>
  )
}

function TextField({ label, value, onCommit, id }: { label: string; value: string; onCommit: (v: string) => void; id?: string }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <label className="fld">
      <span className="fld-label">{label}</span>
      <input
        id={id}
        className="fld-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() && text.trim() !== value && onCommit(text.trim())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setText(value)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
    </label>
  )
}

function Choice<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div className="fld" role="group" aria-label={label}>
      <span className="fld-label">{label}</span>
      <div className="seg">
        {options.map(([v, words]) => (
          <button key={v} type="button" aria-pressed={v === value} onClick={() => v !== value && onPick(v)}>
            {words}
          </button>
        ))}
      </div>
    </div>
  )
}

const edit = (ops: Op[], summary: string) => void handEdit(ops, summary)

// ------------------------------------------------------------------ the panel

export function ContextPanel({ onHide }: { onHide: () => void }) {
  const model = useStudio((s) => s.model)
  const selection = useStudio((s) => s.selection)
  const roomId = useStudio((s) => s.roomId)
  const tool = useStudio((s) => s.tool)
  const comments = useStudio((s) => s.comments)
  const tab = useStudio((s) => s.ctxTab)
  const checks = useStudio((s) => s.checks)
  const dismissed = useStudio((s) => s.setAside.dismissed)
  const open = checks.filter((i) => !dismissed.includes(i.id))
  const shown = open.length
  const worst = open.some((i) => i.severity === 'blocks') ? 'blocks' : open.some((i) => i.severity === 'fix') ? 'fix' : 'note'
  let body: React.ReactNode = null
  if (!model) body = null
  else if (selection.length > 1) body = <Many model={model} />
  else if (selection.length === 1) {
    const { kind, id } = selection[0]
    if (kind === 'wall') body = model.walls.find((w) => w.id === id) && <WallFields model={model} w={model.walls.find((w) => w.id === id)!} />
    else if (kind === 'opening') body = model.openings.find((o) => o.id === id) && <OpeningFields model={model} o={model.openings.find((o) => o.id === id)!} />
    else if (kind === 'room') body = model.rooms.find((r) => r.id === id) && <RoomFields model={model} r={model.rooms.find((r) => r.id === id)!} />
    else if (kind === 'item') body = model.items.find((i) => i.id === id) && <ItemFields it={model.items.find((i) => i.id === id)!} />
    else if (kind === 'dimension') {
      const d = model.dimensions.find((x) => x.id === id)
      if (d)
        body = (
          <section>
            <h3 className="ctx-title">Measurement</h3>
            <LengthField label="Length" value={Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1])} badgeText={d.source === 'user' ? 'you measured this' : provWords({ src: d.source === 'field' ? 'field' : 'sheet_dim' })} badge="measured" />
            <p className="muted small">
              Across {fmt(Math.abs(d.b[0] - d.a[0]))}, down {fmt(Math.abs(d.b[1] - d.a[1]))}. Measurements stay on the plan until you remove them.
            </p>
            <div className="ctx-actions">
              <button type="button" className="btn" onClick={() => edit([{ op: 'delete', id: d.id }], 'Removed a measurement')}>
                Remove
              </button>
            </div>
          </section>
        )
    } else if (kind === 'stair') {
      const s = model.stairs.find((x) => x.id === id)
      if (s) body = <StairFields model={model} id={s.id} />
    } else if (kind === 'comment') {
      const c = comments.find((x) => x.id === id)
      if (c) body = <CommentFields c={c} />
    }
  }
  if (!body && model) {
    const room = roomId ? model.rooms.find((r) => r.id === roomId) : null
    body = room ? <RoomFields model={model} r={room} focusOnly /> : <Nothing />
  }
  return (
    <aside className="ctx" aria-label="Context">
      <header className="ctx-head">
        <div className="ctx-tabs" role="tablist" aria-label="Panel">
          <button type="button" role="tab" aria-selected={tab === 'selection'} onClick={() => useStudio.setState({ ctxTab: 'selection' })}>
            Selection
          </button>
          <button type="button" role="tab" aria-selected={tab === 'checks'} onClick={() => useStudio.setState({ ctxTab: 'checks' })}>
            Checks{shown ? <span className={`ctx-count${worst === 'blocks' ? ' is-code' : ''}`}>{shown}</span> : null}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'inspiration'} onClick={() => useStudio.setState({ ctxTab: 'inspiration' })}>
            Inspiration
          </button>
        </div>
        <button type="button" className="link" onClick={onHide}>
          Hide
        </button>
      </header>
      <div className="ctx-body" role="tabpanel">
        {tab === 'checks' ? (
          <ChecksPanel />
        ) : tab === 'inspiration' ? (
          <InspirationPanel />
        ) : (
          <>
            {tool === 'wall' && <NewWallThickness />}
            {body}
          </>
        )}
      </div>
    </aside>
  )
}

function Nothing() {
  const view = useStudio((s) => s.view)
  return (
    <section className="ctx-empty">
      <p>Click a room, wall, door, window or fixture to see its sizes and change them.</p>
      {view === 'plan' ? (
        <ul className="keys">
          <li>
            <kbd>V</kbd> select and drag
          </li>
          <li>
            <kbd>W</kbd> draw walls
          </li>
          <li>
            <kbd>O</kbd> add a door or window
          </li>
          <li>
            <kbd>M</kbd> measure
          </li>
          <li>
            <kbd>C</kbd> leave a note
          </li>
          <li>
            <kbd>F</kbd> fit the level
          </li>
        </ul>
      ) : (
        <p className="muted small">The plan view (press 1) has the tools for drawing walls and placing doors.</p>
      )}
    </section>
  )
}

function NewWallThickness() {
  const t = useEditor((s) => s.wallT)
  return (
    <section className="ctx-tool">
      <h3 className="ctx-title">New walls</h3>
      <Choice
        label="Thickness"
        value={String(t)}
        options={[
          ['3.5', '3 1/2"'],
          ['4.5', '4 1/2"'],
          ['6', '6"'],
        ]}
        onPick={(v) => useEditor.setState({ wallT: Number(v) })}
      />
      <p className="muted small">4 1/2" is a standard interior wall; use 6" for a wall that closes the outside or holds plumbing.</p>
    </section>
  )
}

function Many({ model }: { model: Model }) {
  const selection = useStudio((s) => s.selection)
  const removable = selection.filter((s) => s.kind === 'wall' || s.kind === 'opening' || s.kind === 'item' || s.kind === 'dimension')
  const items = selection.filter((s) => s.kind === 'item')
  return (
    <section>
      <h3 className="ctx-title">{selection.length} things selected</h3>
      <p className="muted small">Drag any of them to move them together. {items.length > 1 ? 'R turns the group a quarter turn.' : ''} Shift-click to add or drop one.</p>
      <div className="ctx-actions">
        {!!removable.length && (
          <button type="button" className="btn" onClick={() => void removeSelected(removable, `Removed ${removable.length} things`)}>
            Remove {removable.length}
          </button>
        )}
        <button type="button" className="link" onClick={clearSelection}>
          Clear
        </button>
      </div>
      {void model}
    </section>
  )
}

// ------------------------------------------------------------------ rooms

function RoomFields({ model, r, focusOnly }: { model: Model; r: Room; focusOnly?: boolean }) {
  const level = model.levels.find((l) => l.id === r.level)
  const dims = roomClearDims(model, r)
  const area = Math.round(polygonArea(r.polygon) / 144)
  const xs = r.polygon.map((p) => p[0])
  const ys = r.polygon.map((p) => p[1])
  const w = Math.max(...xs) - Math.min(...xs)
  const d = Math.max(...ys) - Math.min(...ys)
  const sizeBadge = weakestBadge(dims.map((x) => x.badge))
  return (
    <section>
      <TextField id="ctx-room-name" label="Room" value={r.name} onCommit={(v) => edit([{ op: 'rename_room', id: r.id, name: v }], `Named the room ${v}`)} />
      <div className="fld">
        <span className="fld-label">Size</span>
        <span className="fld-num is-read">
          {fmt(w)} x {fmt(d)}
        </span>
        <Badge badge={sizeBadge} text={sizeBadge === 'measured' ? 'measured' : sizeBadge === 'traced' ? 'partly traced' : sizeBadge === 'velda' ? 'set by Velda' : 'partly assumed'} />
      </div>
      <div className="fld">
        <span className="fld-label">Area</span>
        <span className="fld-num is-read">{area} sf</span>
      </div>
      {level && (
        <LengthField
          label="Ceiling"
          value={r.ceiling ?? level.ceiling}
          prov={level.prov.ceiling}
          min={84}
          hint={`Whole ${level.name.toLowerCase()}`}
          onCommit={(v) => edit([{ op: 'set_level', id: level.id, ceiling: v }], `Set the ${level.name} ceiling to ${fmt(v)}`)}
        />
      )}
      {dims.length > 0 && (
        <details className="ctx-more" open={!focusOnly}>
          <summary>Clear dimensions, wall to wall</summary>
          <ul className="dimlist">
            {dims.map((c, i) => (
              <li key={i}>
                <span className="fld-num is-read">{c.text}</span> <Badge badge={c.badge} text={c.badge === 'measured' ? 'measured' : c.badge === 'traced' ? 'traced' : c.badge === 'velda' ? 'set by Velda' : 'assumed'} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {r.flags.includes('needs_confirming') && <p className="caution">The drawing marks this room as needing to be confirmed on site.</p>}
      {r.flags.includes('to_be_demolished') && <p className="caution">The drawing marks parts of this room to be demolished.</p>}
      {r.flags.includes('open_outline') && <p className="muted small">The walls around this room do not close yet, so its outline is drawn from the old model.</p>}
      {focusOnly && <p className="muted small">Velda's "here" means this room. Click a wall, door or fixture to change it.</p>}
    </section>
  )
}

// ------------------------------------------------------------------ walls

const ext = (w: Wall) => w.exterior

function WallFields({ model, w }: { model: Model; w: Wall }) {
  const level = model.levels.find((l) => l.id === w.level)
  const L = wallLength(w)
  const ops = model.openings.filter((o) => o.wall === w.id)
  const notes = model.notes.filter((n) => n.locked && n.text.includes(`wall ${w.id} `))
  const n = leftOf(w)
  const mid = pointOn(w, L / 2)
  const sides = [1, -1]
    .map((k) => roomAt(model, w.level, [mid[0] + n[0] * (thick(w) / 2 + 6) * k, mid[1] + n[1] * (thick(w) / 2 + 6) * k]))
    .filter(Boolean)
    .map((r) => r!.name)
  return (
    <section>
      <h3 className="ctx-title">{ext(w) ? 'Outside wall' : 'Wall'}</h3>
      <p className="muted small">{sides.length === 2 ? `Between ${sides[0]} and ${sides[1]}` : sides.length === 1 ? `Along ${sides[0]}` : 'Not next to a named room'}</p>
      <LengthField label="Length" value={L} badge={weakestBadge([badgeOf(w.prov.a), badgeOf(w.prov.b)])} badgeText={w.prov.a.src === w.prov.b.src ? provWords(w.prov.a) : 'mixed'} hint="Along the middle of the wall" />
      <LengthField label="Thickness" value={w.t} prov={w.prov.t} min={1} hint={w.tMeasured && Math.abs(w.tMeasured - w.t) > 0.2 ? `Drawn at ${fmt(w.tMeasured)}` : undefined} onCommit={(v) => edit([{ op: 'update_wall', id: w.id, t: v }], `Made a wall ${fmt(v)} thick`)} />
      {level && (
        <LengthField
          label="Height"
          value={w.h ?? level.ceiling}
          prov={w.h !== undefined ? { src: 'user' } : level.prov.ceiling}
          min={12}
          onCommit={(v) => edit([{ op: 'update_wall', id: w.id, h: v }], `Made a wall ${fmt(v)} high`)}
        />
      )}
      <Choice
        label="Kind"
        value={w.kind}
        options={[
          ['wall', 'Wall'],
          ['half', 'Half wall'],
          ['glass', 'Glass'],
          ['rail', 'Rail'],
        ]}
        onPick={(v) => edit([{ op: 'update_wall', id: w.id, kind: v }], `Made a wall a ${v === 'half' ? 'half wall' : v === 'wall' ? 'full wall' : `${v} wall`}`)}
      />
      {ext(w) ? (
        <p className="caution">Outside walls carry load. Moving, opening or removing one needs an engineer to confirm.</p>
      ) : (
        <Choice
          label="Carries load"
          value={w.bearing}
          options={[
            ['unknown', 'Not known'],
            ['yes', 'Yes'],
            ['no', 'No'],
          ]}
          onPick={(v) => edit([{ op: 'update_wall', id: w.id, bearing: v }], v === 'no' ? 'Marked a wall as carrying no load' : v === 'yes' ? 'Marked a wall as carrying load' : 'Marked a wall as not known to carry load')}
        />
      )}
      {!ext(w) && w.bearing === 'unknown' && <p className="muted small">Until someone who has seen the framing says otherwise, this wall is treated as carrying load.</p>}
      {notes.map((x) => (
        <p key={x.id} className="caution">
          {x.text.replace(`wall ${w.id} `, 'this wall ').replace(/^Engineer to confirm: /, 'Engineer to confirm: ')}
        </p>
      ))}
      {ops.length > 0 && (
        <div className="fld">
          <span className="fld-label">In this wall</span>
          <span className="chips">
            {ops.map((o) => (
              <button key={o.id} type="button" onClick={() => select('opening', o.id)}>
                {fmt(o.w)} {o.kind === 'opening' ? 'opening' : o.kind}
              </button>
            ))}
          </span>
        </div>
      )}
      <div className="ctx-actions">
        <button type="button" className="btn" onClick={() => void removeSelected([{ kind: 'wall', id: w.id }], 'Removed a wall')}>
          Remove wall
        </button>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ openings

/** Words for the two ends of a wall as seen on the plan. */
function endWords(w: Wall): [string, string] {
  const dx = w.b[0] - w.a[0]
  const dy = w.b[1] - w.a[1]
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['left', 'right'] : ['right', 'left']
  return dy >= 0 ? ['top', 'bottom'] : ['bottom', 'top']
}

const STYLES: Record<OpeningKind, [string, string][]> = {
  door: [
    ['swing', 'Swing'],
    ['french', 'Pair'],
    ['pocket', 'Pocket'],
    ['sliding', 'Sliding'],
    ['barn', 'Barn'],
    ['bifold', 'Bifold'],
  ],
  window: [
    ['double_hung', 'Double hung'],
    ['casement', 'Casement'],
    ['slider', 'Slider'],
    ['fixed', 'Fixed'],
  ],
  opening: [['cased', 'Cased']],
  garage: [['fixed', 'Overhead']],
}

function OpeningFields({ model, o }: { model: Model; o: Opening }) {
  const w = model.walls.find((x) => x.id === o.wall)
  if (!w) return null
  const L = wallLength(w)
  const [endA, endB] = endWords(w)
  const name = o.kind === 'opening' ? 'Opening' : o.kind === 'window' ? 'Window' : o.kind === 'garage' ? 'Garage door' : 'Door'
  const n = leftOf(w)
  const mid = pointOn(w, o.at)
  const sideRoom = (k: number) => roomAt(model, w.level, [mid[0] + n[0] * (thick(w) / 2 + 12) * k, mid[1] + n[1] * (thick(w) / 2 + 12) * k])?.name
  const into = o.swing ? sideRoom(o.swing.side === 'left' ? 1 : -1) : undefined
  const hingeEnd = o.swing ? (o.swing.hinge === 'a' ? endA : endB) : null
  const setKind = (k: OpeningKind) => {
    const patch: Op =
      k === 'window'
        ? { op: 'update_opening', id: o.id, kind: k, style: 'double_hung', sill: o.sill ?? 36, h: 84 }
        : k === 'opening'
          ? { op: 'update_opening', id: o.id, kind: k, style: 'cased', h: o.h }
          : { op: 'update_opening', id: o.id, kind: k, style: 'swing', h: 80, swing: o.swing ?? { hinge: 'a', side: 'left' } }
    edit([patch], `Made it ${k === 'opening' ? 'a cased opening' : `a ${k}`}`)
  }
  return (
    <section>
      <h3 className="ctx-title">{name}</h3>
      <Choice
        label="Kind"
        value={o.kind}
        options={[
          ['door', 'Door'],
          ['window', 'Window'],
          ['opening', 'Opening'],
        ]}
        onPick={setKind}
      />
      {STYLES[o.kind].length > 1 && (
        <Choice label="Style" value={o.style} options={STYLES[o.kind] as [Opening['style'], string][]} onPick={(v) => edit([{ op: 'update_opening', id: o.id, style: v, ...(o.kind === 'door' && (v === 'swing' || v === 'french') && !o.swing ? { swing: { hinge: 'a', side: 'left' } } : {}) }], `Made it a ${STYLES[o.kind].find(([k]) => k === v)?.[1].toLowerCase()} ${o.kind}`)} />
      )}
      <LengthField label="Width" value={o.w} prov={o.prov.w} min={12} onCommit={(v) => edit([{ op: 'update_opening', id: o.id, w: v }], `Made ${name.toLowerCase()} ${fmt(v)} wide`)} />
      <LengthField label={o.kind === 'window' ? 'Head height' : 'Height'} value={o.h} prov={o.prov.h} min={24} onCommit={(v) => edit([{ op: 'update_opening', id: o.id, h: v }], `Made ${name.toLowerCase()} ${fmt(v)} high`)} />
      {o.kind === 'window' && <LengthField label="Sill height" value={o.sill ?? 36} prov={o.prov.sill} min={0} onCommit={(v) => edit([{ op: 'update_opening', id: o.id, sill: v }], `Set the window sill to ${fmt(v)}`)} />}
      <LengthField label={`From ${endA} end`} value={o.at - o.w / 2} prov={o.prov.at} min={0} hint={`${fmt(L - o.at - o.w / 2)} from the ${endB} end`} onCommit={(v) => edit([{ op: 'update_opening', id: o.id, at: v + o.w / 2 }], `Moved ${name.toLowerCase()} to ${fmt(v)} from the ${endA} end`)} />
      {o.swing && (
        <div className="fld">
          <span className="fld-label">Swing</span>
          <span className="swing-words">
            Hinged at the {hingeEnd} end{into ? `, opens into ${into}` : ''}
          </span>
          <span className="seg">
            <button type="button" title="Space" onClick={() => edit([{ op: 'update_opening', id: o.id, swing: { ...o.swing!, hinge: o.swing!.hinge === 'a' ? 'b' : 'a' } }], 'Moved the door hinge to the other side')}>
              Flip hinge
            </button>
            <button type="button" title="Shift-Space" onClick={() => edit([{ op: 'update_opening', id: o.id, swing: { ...o.swing!, side: o.swing!.side === 'left' ? 'right' : 'left' } }], 'Flipped the door to swing the other way')}>
              Flip side
            </button>
          </span>
        </div>
      )}
      {(ext(w) || w.bearing !== 'no') && <p className="muted small">This wall may carry load, so a new or wider opening in it needs a header an engineer sizes.</p>}
      <div className="ctx-actions">
        <button type="button" className="btn" onClick={() => edit([{ op: 'delete', id: o.id }], `Removed the ${name.toLowerCase()}`)}>
          Remove {name.toLowerCase()}
        </button>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ items, stairs, comments

function ItemFields({ it }: { it: Item }) {
  const label = it.label
  return (
    <section>
      <TextField label="Name" value={label} onCommit={(v) => edit([{ op: 'update_item', id: it.id, label: v }], `Renamed the ${label.toLowerCase()} to ${v}`)} />
      <LengthField label="Width" value={it.w} prov={it.prov} min={1} onCommit={(v) => edit([{ op: 'resize', id: it.id, w: v }], `Made the ${label.toLowerCase()} ${fmt(v)} wide`)} />
      <LengthField label="Depth" value={it.d} prov={it.prov} min={1} onCommit={(v) => edit([{ op: 'resize', id: it.id, d: v }], `Made the ${label.toLowerCase()} ${fmt(v)} deep`)} />
      <LengthField label="Height" value={it.h} prov={it.prov} min={1} onCommit={(v) => edit([{ op: 'resize', id: it.id, h: v }], `Made the ${label.toLowerCase()} ${fmt(v)} high`)} />
      <Choice
        label="Faces"
        value={String(((Math.round(it.rot / 90) * 90) % 360 + 360) % 360)}
        options={[
          ['180', 'Up'],
          ['90', 'Right'],
          ['0', 'Down'],
          ['270', 'Left'],
        ]}
        onPick={(v) => edit([{ op: 'update_item', id: it.id, rot: Number(v) }], `Turned the ${label.toLowerCase()}`)}
      />
      {it.anchor && <p className="muted small">Fixed to its wall: it slides with the wall when the wall moves.</p>}
      <p className="muted small">Drag to move; its back snaps to a wall. R turns it a quarter turn, arrows nudge 1".</p>
      <div className="ctx-actions">
        <button type="button" className="btn" onClick={() => edit([{ op: 'delete', id: it.id }], `Removed the ${label.toLowerCase()}`)}>
          Remove
        </button>
      </div>
    </section>
  )
}

function StairFields({ model, id }: { model: Model; id: string }) {
  const s = model.stairs.find((x) => x.id === id)!
  const to = model.levels.find((l) => l.id === s.toLevel)?.name
  return (
    <section>
      <h3 className="ctx-title">Stair</h3>
      <p>
        {s.risers ? `${s.risers} risers` : 'Risers not counted'}
        {to && to !== model.levels.find((l) => l.id === s.level)?.name ? `, up to ${to}` : ''}.
      </p>
      <p className="muted small">Stairs come from the drawing. Changing them comes in a later build; tell Velda what you have in mind.</p>
    </section>
  )
}

function CommentFields({ c }: { c: Comment }) {
  const resolve = async () => {
    const st = useStudio.getState()
    if (!st.repo || !st.schemeId) return
    await st.repo.saveComment({ ...c, resolved: true })
    useStudio.setState({ comments: await st.repo.comments(st.schemeId) })
    clearSelection()
  }
  return (
    <section>
      <h3 className="ctx-title">Note</h3>
      <p className="note-body">{c.body}</p>
      <p className="muted small">
        {c.author === 'you' ? 'You' : c.author}, {new Date(c.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </p>
      <div className="ctx-actions">
        <button type="button" className="btn" onClick={() => void resolve()}>
          Mark done
        </button>
        <button type="button" className="link" onClick={() => setTool('comment')}>
          Add another
        </button>
      </div>
    </section>
  )
}
