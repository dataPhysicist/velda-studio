// Editing by hand: every change is a model op applied as the person ('user') and saved as a version,
// so undo and redo are steps through versions, and the plan, 3D and Velda all see the same history.
import { create } from 'zustand'
import { type Op, applyOps, mayCarryLoad } from '../model/ops'
import { pointInPolygon, poleOfInaccessibility, wallLength } from '../model/geom'
import type { Model, Room, Wall } from '../model/types'
import { leftOf, pointOn, roomAt, thick } from '../plan2d/geometry'
import { type SelKind, type Tool, commitVersion, isAsBuilt, newSchemeFromCurrent, nextVersionLabel, stepVersion, uniqueSchemeName, useStudio } from './store'

export type Choice = { label: string; run: () => void; primary?: boolean }
/** Messages and the two confirms the editor shows: changing the as-built record, and the engineer warning. */
type EditorUi = {
  notice: string | null
  confirm: { title: string; body: string; choices: Choice[] } | null
  busy: boolean
  /** Thickness for walls drawn with the Wall tool (06: 4 1/2 in interior by default). */
  wallT: number
}

/** Ops that record reality (or file ideas against it) rather than change the design: allowed on the as-built without asking (07 section 9). */
const RECORDS = new Set(['dimension', 'note', 'field_dimension', 'add_inspiration', 'update_inspiration', 'remove_inspiration'])
/** Schemes where the person already said yes to changing the as-built record this session. */
const asBuiltOk = new Set<string>()
export const useEditor = create<EditorUi>(() => ({ notice: null, confirm: null, busy: false, wallT: 4.5 }))

const studio = () => useStudio.getState()

export function select(kind: SelKind, id: string, add = false) {
  const cur = studio().selection
  const sel = { kind, id }
  if (add) {
    const has = cur.some((s) => s.kind === kind && s.id === id)
    useStudio.setState({ selection: has ? cur.filter((s) => !(s.kind === kind && s.id === id)) : [...cur, sel] })
  } else useStudio.setState({ selection: [sel] })
}
export const clearSelection = () => useStudio.setState({ selection: [] })
export const setTool = (tool: Tool) => useStudio.setState({ tool, selection: tool === 'select' ? studio().selection : [] })

let timer: ReturnType<typeof setTimeout> | null = null
export function notify(text: string) {
  useEditor.setState({ notice: text })
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => useEditor.setState({ notice: null }), 6000)
}

/**
 * Apply ops as the person and save a version. Returns what was skipped so a tool can say why.
 * Walls that may carry load ask first when removed or moved more than 6 in (06: small nudges do not).
 */
export async function handEdit(ops: Op[], summary: string, opts: { confirmed?: boolean; asBuiltOk?: boolean } = {}): Promise<{ applied: number; skipped: string[] }> {
  const model = studio().model
  const none = { applied: 0, skipped: [] as string[] }
  if (!model || !ops.length) return none
  const schemeId = studio().schemeId ?? ''
  if (!opts.asBuiltOk && isAsBuilt() && !asBuiltOk.has(schemeId) && ops.some((o) => !RECORDS.has(o.op))) {
    // 07 section 9: a person editing the as-built by hand is asked once.
    return new Promise((resolve) => {
      const done = (r: typeof none) => {
        useEditor.setState({ confirm: null })
        resolve(r)
      }
      useEditor.setState({
        confirm: {
          title: 'This is the as-built',
          body: 'You are changing the record of the house as it is today. To try a design, make a new scheme for it and keep this record as it is.',
          choices: [
            {
              label: 'Make a new scheme',
              primary: true,
              run: () => {
                useEditor.setState({ confirm: null, busy: true })
                void newSchemeFromCurrent(uniqueSchemeName('Option 1'))
                  .then(() => handEdit(ops, summary, { ...opts, asBuiltOk: true }))
                  .then(resolve, () => resolve(none))
                  .finally(() => useEditor.setState({ busy: false }))
              },
            },
            {
              label: 'Change the as-built',
              run: () => {
                asBuiltOk.add(schemeId)
                useEditor.setState({ confirm: null })
                void handEdit(ops, summary, { ...opts, asBuiltOk: true }).then(resolve)
              },
            },
            { label: 'Cancel', run: () => done(none) },
          ],
        },
      })
    })
  }
  if (!opts.confirmed) {
    const caution = structuralCaution(model, ops)
    if (caution) {
      return new Promise((resolve) => {
        useEditor.setState({
          confirm: {
            title: 'This wall may carry load',
            body: `${caution} The plan will keep a note that an engineer has to confirm it; you cannot remove that note.`,
            choices: [
              {
                label: summary.startsWith('Removed') ? 'Remove it' : summary.startsWith('Added') ? 'Add it' : summary.startsWith('Made') ? 'Widen it' : 'Move it',
                primary: true,
                run: () => {
                  useEditor.setState({ confirm: null })
                  void handEdit(ops, summary, { ...opts, confirmed: true }).then(resolve)
                },
              },
              {
                label: 'Cancel',
                run: () => {
                  useEditor.setState({ confirm: null })
                  resolve(none)
                },
              },
            ],
          },
        })
      })
    }
  }
  useEditor.setState({ busy: true })
  try {
    const res = applyOps(model, ops, { author: 'user', versionLabel: nextVersionLabel(summary), focusLevel: studio().levelId })
    if (res.applied) await commitVersion(res.model, summary, 'hand', { author: 'user', ops })
    if (res.skipped.length) notify(`${res.applied ? 'Done, except: ' : 'Not changed: '}${res.skipped.map((x) => plain(x.replace(/^[a-z_]+ [\w-]*: /, ''))).join('; ')}`)
    else {
      // The engineer notes are already said in the confirm; the rest, in plain words.
      const said = res.notes.filter((n) => !/^Engineer to confirm/.test(n)).map(plain)
      if (said.length) notify(said.join(' '))
    }
    // Keep the selection on things that still exist.
    const m = studio().model
    if (m) useStudio.setState({ selection: studio().selection.filter((s) => exists(m, s.kind, s.id)) })
    return { applied: res.applied, skipped: res.skipped }
  } finally {
    useEditor.setState({ busy: false })
  }
}

/** Esc or a click outside: the last choice (always Cancel) runs, so a waiting edit settles. */
/** Op notes name walls and openings by id; a person reads "the wall", "the window". */
export function plain(text: string) {
  return text
    .replace(/\b(wall|window|door|opening|garage|item|room) [A-Za-z][\w-]*\d[\w-]*/g, 'the $1')
    .replace(/\bthe the\b/g, 'the')
    .replace(/^the /, 'The ')
}

export function cancelConfirm() {
  const c = useEditor.getState().confirm
  if (c) c.choices[c.choices.length - 1].run()
}

function exists(m: Model, kind: SelKind, id: string) {
  switch (kind) {
    case 'wall':
      return m.walls.some((x) => x.id === id)
    case 'opening':
      return m.openings.some((x) => x.id === id)
    case 'room':
      return m.rooms.some((x) => x.id === id)
    case 'item':
      return m.items.some((x) => x.id === id)
    case 'stair':
      return m.stairs.some((x) => x.id === id)
    case 'dimension':
      return m.dimensions.some((x) => x.id === id)
    default:
      return true
  }
}

/**
 * The engineer warning text when an op set removes, opens, or moves more than 6 in a wall that may
 * carry load (06 section 2; small nudges do not ask). The ops leave the locked note either way.
 */
export function structuralCaution(m: Model, ops: Op[]): string | null {
  for (const op of ops) {
    if (op.op === 'add_opening') {
      const w = m.walls.find((x) => x.id === op.wall)
      if (w && mayCarryLoad(w)) return `A new ${op.kind === 'window' ? 'window' : op.kind === 'opening' ? 'opening' : 'door'} in a wall that may carry load needs a header sized by an engineer.`
      continue
    }
    if (op.op === 'update_opening' && typeof op.w === 'number') {
      const o = m.openings.find((x) => x.id === op.id)
      const w = o && m.walls.find((x) => x.id === o.wall)
      if (o && w && op.w - o.w > 6 && mayCarryLoad(w)) return `Widening an opening in a wall that may carry load by ${(op.w - o.w).toFixed(0)} in needs an engineer to confirm the header.`
      continue
    }
    if (op.op === 'move_joint' && Array.isArray(op.at) && Array.isArray(op.to)) {
      const d = Math.hypot(op.to[0] - op.at[0], op.to[1] - op.at[1])
      const ws = m.walls.filter((w) => [w.a, w.b].some((e) => Math.hypot(e[0] - op.at[0], e[1] - op.at[1]) <= 0.5))
      if (d > 6 && ws.some(mayCarryLoad)) return `Moving the corner of a wall that may carry load ${d.toFixed(0)} in needs an engineer to confirm.`
      continue
    }
    const w = m.walls.find((x) => x.id === op.id)
    if (!w || !mayCarryLoad(w)) continue
    if (op.op === 'delete' || op.op === 'remove') return 'Removing a wall that may carry load needs an engineer to confirm.'
    if (op.op === 'move') {
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1
      const left = [(w.b[1] - w.a[1]) / L, -(w.b[0] - w.a[0]) / L]
      const across = Math.abs((op.dx ?? 0) * left[0] + (op.dy ?? 0) * left[1])
      if (across > 6) return `Moving a wall that may carry load ${across.toFixed(0)} in needs an engineer to confirm.`
    }
  }
  return null
}

/** The rooms on the two sides of a wall at its middle (none, one or two). */
export function roomsBeside(m: Model, w: Wall): Room[] {
  const n = leftOf(w)
  const mid = pointOn(w, wallLength(w) / 2)
  const at = (k: number) => roomAt(m, w.level, [mid[0] + n[0] * (thick(w) / 2 + 6) * k, mid[1] + n[1] * (thick(w) / 2 + 6) * k])
  return [at(1), at(-1)].filter((r): r is Room => !!r)
}

/**
 * Remove what is selected. A wall between two named rooms joins them into one: the person picks the
 * name that stays (06 section 2); an unnamed side just takes the other's name.
 */
export async function removeSelected(sel: { kind: SelKind; id: string }[], summary: string) {
  const m = studio().model
  if (!m) return
  const ops: Op[] = sel.filter((s) => s.kind !== 'room' && s.kind !== 'stair' && s.kind !== 'comment').map((s) => ({ op: 'delete', id: s.id }))
  if (!ops.length) {
    if (sel[0]?.kind === 'room') notify('Rooms come from their walls: remove a wall to join two rooms, or rename this one.')
    return
  }
  for (const s of sel) {
    if (s.kind !== 'wall') continue
    const w = m.walls.find((x) => x.id === s.id)
    const [a, b] = w ? roomsBeside(m, w) : []
    if (!a || !b || a.id === b.id || a.explicit || b.explicit) continue
    // Does taking the wall out actually join them? Try it with b's name gone.
    const trial = applyOps(m, [...ops, { op: 'merge_rooms', keep: a.id, drop: b.id }], { author: 'user' })
    const joined = trial.model.rooms.find((r) => r.id === a.id)
    if (!joined || !pointInPolygon(poleOfInaccessibility(b.polygon, 2), joined.polygon)) continue
    const unnamed = (r: Room) => r.flags.includes('needs_name')
    const run = (keep: Room, drop: Room) => handEdit([...ops, { op: 'merge_rooms', keep: keep.id, drop: drop.id }], `Removed the wall between ${a.name} and ${b.name}`)
    if (unnamed(b) && !unnamed(a)) return run(a, b)
    if (unnamed(a) && !unnamed(b)) return run(b, a)
    return new Promise<void>((resolve) => {
      const pick = (keep: Room, drop: Room) => () => {
        useEditor.setState({ confirm: null })
        void run(keep, drop).then(() => resolve())
      }
      useEditor.setState({
        confirm: {
          title: 'One room now',
          body: `Without this wall, ${a.name} and ${b.name} become one room. Which name should it keep?`,
          choices: [
            { label: a.name, run: pick(a, b), primary: true },
            { label: b.name, run: pick(b, a) },
            {
              label: 'Cancel',
              run: () => {
                useEditor.setState({ confirm: null })
                resolve()
              },
            },
          ],
        },
      })
    })
  }
  await handEdit(ops, summary)
}

export const undo = () => stepVersion(-1)
export const redo = () => stepVersion(1)
