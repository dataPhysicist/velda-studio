// The command palette (Cmd-K or Ctrl-K, 06 section 11): every action by name, the rooms, levels and
// schemes to go to, and anything else typed goes to Velda. Plus the Settings dialog and the keyboard
// shortcuts list.
import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { finishFor, ROLES } from '../lib/theme'
import { redo, undo, useEditor, handEdit } from './editor'
import { enterWalk, exitWalk, focusOn, openScheme, send, setPrefs, useStudio } from './store'

export type DialogName = 'share' | 'export' | 'settings' | 'shortcuts' | 'palette'
export const useDialogs = create<{ open: DialogName | null }>(() => ({ open: null }))
export const openDialog = (open: DialogName | null) => useDialogs.setState({ open })

type Cmd = { id: string; label: string; hint?: string; group: string; run: () => void }

function commands(): Cmd[] {
  const s = useStudio.getState()
  const out: Cmd[] = []
  const view = (v: 'plan' | '3d') => () => (exitWalk(), focusOn({ view: v }))
  out.push({ id: 'v-plan', label: 'Plan view', hint: '1', group: 'View', run: view('plan') })
  out.push({ id: 'v-3d', label: '3D view', hint: '2', group: 'View', run: view('3d') })
  out.push({ id: 'v-walk', label: 'Walk through', hint: '3', group: 'View', run: () => enterWalk() })
  const tools: [string, string, string][] = [
    ['select', 'Select tool', 'V'],
    ['wall', 'Wall tool', 'W'],
    ['opening', 'Door and window tool', 'O'],
    ['measure', 'Measure tool', 'M'],
    ['comment', 'Comment tool', 'C'],
  ]
  for (const [t, label, k] of tools) out.push({ id: `t-${t}`, label, hint: k, group: 'Tools', run: () => (exitWalk(), focusOn({ view: 'plan' }), useStudio.setState({ tool: t as any })) })
  out.push({ id: 'undo', label: 'Undo', hint: 'Cmd-Z', group: 'Edit', run: () => void undo() })
  out.push({ id: 'redo', label: 'Redo', hint: 'Shift-Cmd-Z', group: 'Edit', run: () => void redo() })
  out.push({ id: 'checks', label: 'Show the checks', group: 'Panels', run: () => useStudio.setState({ ctxTab: 'checks' }) })
  out.push({ id: 'insp', label: 'Show the inspiration', group: 'Panels', run: () => useStudio.setState({ ctxTab: 'inspiration' }) })
  out.push({ id: 'share', label: 'Share a read-only link', group: 'Share', run: () => openDialog('share') })
  out.push({ id: 'export', label: 'Export the handoff package', hint: 'PDF, DXF, GLB, schedules', group: 'Share', run: () => openDialog('export') })
  out.push({ id: 'import', label: 'Bring in a plan (PDF)', group: 'Plans', run: () => (document.querySelector('[data-testid="plan-file"]') as HTMLInputElement | null)?.click() })
  out.push({ id: 'settings', label: 'Settings', group: 'Help', run: () => openDialog('settings') })
  out.push({ id: 'tour', label: 'Take the tour', group: 'Help', run: () => useStudio.setState({ tour: 0 }) })
  out.push({ id: 'keys', label: 'Keyboard shortcuts', hint: '?', group: 'Help', run: () => openDialog('shortcuts') })
  const m = s.model
  if (m) {
    out.push({ id: 'whole', label: 'Go to the whole house', group: 'Go to', run: () => focusOn({ levelId: null, roomId: null }) })
    for (const l of m.levels) out.push({ id: `l-${l.id}`, label: `Go to ${l.name}`, group: 'Go to', run: () => focusOn({ levelId: l.id, roomId: null }) })
    for (const r of [...m.rooms].sort((a, b) => a.name.localeCompare(b.name))) {
      const lv = m.levels.find((l) => l.id === r.level)?.name
      out.push({ id: `r-${r.id}`, label: `Go to ${r.name}`, hint: lv, group: 'Go to', run: () => focusOn({ levelId: r.level, roomId: r.id }) })
    }
  }
  for (const x of s.schemes) if (x.id !== s.schemeId) out.push({ id: `s-${x.id}`, label: `Open ${x.name}`, hint: x.role === 'asbuilt' ? 'as-built' : 'scheme', group: 'Schemes', run: () => void openScheme(x.id) })
  return out
}

/** Every word typed appears in the label, in any order. */
const match = (label: string, q: string) => q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => label.toLowerCase().includes(w))

export function Palette() {
  const open = useDialogs((s) => s.open === 'palette')
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useMemo(() => (open ? commands() : []), [open])
  const shown = useMemo(() => {
    const hits = q.trim() ? list.filter((c) => match(c.label, q)) : list.filter((c) => c.group !== 'Go to' || /whole|Level/.test(c.label))
    const ask: Cmd[] = q.trim() ? [{ id: 'ask', label: `Ask Velda: "${q.trim()}"`, group: 'Velda', run: () => void send(q.trim()) }] : []
    return [...hits.slice(0, 12), ...ask]
  }, [list, q])
  useEffect(() => {
    if (open) {
      setQ('')
      setI(0)
      requestAnimationFrame(() => input.current?.focus())
    }
  }, [open])
  useEffect(() => setI(0), [q])
  if (!open) return null
  const run = (c: Cmd | undefined) => {
    if (!c) return
    openDialog(null)
    c.run()
  }
  return (
    <div className="confirm-veil palette-veil" onPointerDown={(e) => e.target === e.currentTarget && openDialog(null)}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          ref={input}
          value={q}
          placeholder="Type an action, a room, or something to ask Velda"
          aria-label="Command"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={shown[i] ? `pc-${shown[i].id}` : undefined}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setI((x) => Math.min(shown.length - 1, x + 1)))
            else if (e.key === 'ArrowUp') (e.preventDefault(), setI((x) => Math.max(0, x - 1)))
            else if (e.key === 'Enter') (e.preventDefault(), run(shown[i]))
            else if (e.key === 'Escape') openDialog(null)
          }}
        />
        <ul id="palette-list" role="listbox">
          {shown.map((c, k) => (
            <li key={c.id} id={`pc-${c.id}`} role="option" aria-selected={k === i} className={k === i ? 'is-on' : ''} onPointerMove={() => setI(k)} onClick={() => run(c)}>
              <span>{c.label}</span>
              <span className="muted small">{c.hint ?? c.group}</span>
            </li>
          ))}
          {!shown.length && <li className="muted">Nothing matches.</li>}
        </ul>
      </div>
    </div>
  )
}

const KEYS: [string, string][] = [
  ['V, W, O, M, C', 'Select, Wall, Opening, Measure, Comment tools'],
  ['1, 2, 3', 'Plan, 3D, Walk through'],
  ['Cmd-K or Ctrl-K', 'Command palette: every action by name'],
  ['Cmd-Z, Shift-Cmd-Z', 'Undo, redo (versions of the model)'],
  ['Arrows (Shift, Alt)', 'Nudge 1 in (12 in, 1/8 in)'],
  ['R, Shift-R', 'Turn 90 degrees, 15 degrees'],
  ['Space, Shift-Space', 'Flip the door hinge, flip the side it swings into'],
  ['F', 'Fit the level; double-click a room to frame it'],
  ['Esc', 'Cancel, deselect'],
  ['/', 'Type to Velda'],
  ['?', 'This list'],
]

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])
  return (
    <div className="confirm-veil" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button type="button" className="link" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Shortcuts() {
  const open = useDialogs((s) => s.open === 'shortcuts')
  if (!open) return null
  return (
    <Dialog title="Keyboard shortcuts" onClose={() => openDialog(null)}>
      <table className="keys">
        <tbody>
          {KEYS.map(([k, what]) => (
            <tr key={k}>
              <th scope="row">
                <kbd>{k}</kbd>
              </th>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  )
}

export function Settings() {
  const open = useDialogs((s) => s.open === 'settings')
  const prefs = useStudio((s) => s.prefs)
  const library = useStudio((s) => s.library)
  const room = useStudio((s) => s.model?.rooms.find((r) => r.id === s.roomId) ?? null)
  const sdk = useStudio((s) => !!s.sdk)
  const wallT = useEditor((s) => s.wallT)
  if (!open) return null
  const build = (() => {
    const src = [...document.querySelectorAll('script[src]')].map((e) => (e as HTMLScriptElement).src).find((u) => /velda-studio@[0-9a-f]{40}/.test(u))
    return src ? /@([0-9a-f]{7})/.exec(src)![1] : 'local preview'
  })()
  const apply = (id: string, where: 'house' | string) => {
    const t = library.find((x) => x.id === id)
    if (!t) return
    openDialog(null)
    // A saved theme may not be in this scheme yet: the op carries all of it.
    const d = t.data
    void handEdit(
      [{ op: 'theme', id: t.id, name: t.name, description: d.description, palette: d.palette, materials: d.materials, avoid: d.avoid, lighting: d.lighting, finishes: d.finishes, apply_to: where }],
      where === 'house' ? `${t.name} for the whole house` : `${t.name} for ${room?.name ?? 'the room'}`,
    )
  }
  return (
    <Dialog title="Settings" onClose={() => openDialog(null)}>
      <div className="settings">
        <section>
          <h3>New doors, windows and walls</h3>
          <label>
            Doors{' '}
            <select value={prefs.doorW} onChange={(e) => void setPrefs({ doorW: Number(e.target.value) })}>
              {[28, 30, 32, 34, 36].map((w) => (
                <option key={w} value={w}>
                  {w}"
                </option>
              ))}
            </select>
          </label>
          <label>
            Windows{' '}
            <select value={prefs.windowW} onChange={(e) => void setPrefs({ windowW: Number(e.target.value) })}>
              {[24, 30, 36, 48, 60].map((w) => (
                <option key={w} value={w}>
                  {w}"
                </option>
              ))}
            </select>
          </label>
          <label>
            Walls{' '}
            <select value={wallT} onChange={(e) => void setPrefs({ wallT: Number(e.target.value) })}>
              {[3.5, 4.5, 6].map((t) => (
                <option key={t} value={t}>
                  {t}" thick
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">Used by the Opening and Wall tools. Velda asks or uses the drawing's sizes.</p>
        </section>
        <section>
          <h3>Saved themes</h3>
          {!library.length && <p className="muted small">No saved themes yet. Make one from inspiration (Inspiration tab, Make a theme from these) or ask Velda for a look.</p>}
          <ul className="settings-themes">
            {library.map((t) => (
              <li key={t.id}>
                <span className="theme-chips" aria-hidden="true">
                  {ROLES.slice(0, 6).map((r) => (
                    <span key={r} style={{ background: finishFor(t, r).color ?? '#ddd' }} />
                  ))}
                </span>
                <span>{t.name}</span>
                <span className="settings-theme-acts">
                  {room && (
                    <button type="button" className="link small" onClick={() => apply(t.id, room.id)}>
                      Use for {room.name}
                    </button>
                  )}
                  <button type="button" className="link small" onClick={() => apply(t.id, 'house')}>
                    Use for the house
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Experimental</h3>
          <label className="settings-switch">
            <input type="checkbox" checked={prefs.capture} onChange={(e) => void setPrefs({ capture: e.target.checked })} /> Room capture from photos or a short video
          </label>
          <p className="muted small">Not part of 1.0. When it is on, Velda may measure a room from photos you send and rebuild it; check what it changes.</p>
        </section>
        <section>
          <h3>Help</h3>
          <p>
            <button type="button" className="link" onClick={() => (openDialog(null), useStudio.setState({ tour: 0 }))}>
              Take the tour again
            </button>{' '}
            <button type="button" className="link" onClick={() => openDialog('shortcuts')}>
              Keyboard shortcuts
            </button>
          </p>
          <p className="muted small">
            Build {build}
            {sdk ? '' : ', not connected to Toolbelt (local preview)'}.
          </p>
        </section>
      </div>
    </Dialog>
  )
}
