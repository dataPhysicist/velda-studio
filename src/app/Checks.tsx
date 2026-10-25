// The Checks tab (06 section 5): the checker's issues grouped by room, most serious first, each in
// one sentence. Clicking one frames it in the plan and selects what it is about; Fix applies the
// one-step fix as an ordinary hand edit (so it asks first where any edit would). Notes and
// should-fix items can be dismissed; engineer cautions can only be acknowledged, never hidden.
import { useMemo, useState } from 'react'
import type { Issue } from '../analysis/checks'
import { footprint } from '../analysis/space'
import { pointAt } from '../model/geom'
import type { Op } from '../model/ops'
import type { Model, Vec } from '../model/types'
import { handEdit, select } from './editor'
import { type SelKind, focusOn, frameOn, setIssueAside, useStudio } from './store'

const WORD: Record<Issue['severity'], string> = { blocks: 'Code', fix: 'Should fix', note: 'Note' }

export function ChecksPanel() {
  const model = useStudio((s) => s.model)
  const checks = useStudio((s) => s.checks)
  const aside = useStudio((s) => s.setAside)
  const levelId = useStudio((s) => s.levelId)
  const [showDismissed, setShowDismissed] = useState(false)
  const live = checks.filter((i) => !aside.dismissed.includes(i.id))
  const dismissed = checks.filter((i) => aside.dismissed.includes(i.id))
  const groups = useMemo(() => group(model, live, levelId), [model, live, levelId])
  if (!model) return null
  if (!checks.length)
    return (
      <section className="ctx-empty">
        <p>Nothing to flag. Every clearance, door, egress window and stair the checker knows passes on this scheme.</p>
        <p className="muted small">The checks run again after every change, by you or by Velda.</p>
      </section>
    )
  const count = (sev: Issue['severity']) => live.filter((i) => i.severity === sev).length
  return (
    <section className="checks">
      <p className="checks-sum">
        {[count('blocks') && `${count('blocks')} against code`, count('fix') && `${count('fix')} to fix`, count('note') && `${count('note')} ${count('note') === 1 ? 'note' : 'notes'}`].filter(Boolean).join(', ') || 'All set aside'}
      </p>
      {groups.map((g) => (
        <div key={g.key} className="checks-group">
          <h3 className="checks-room">{g.title}</h3>
          <ul>
            {g.issues.map((i) => (
              <IssueRow key={i.id} i={i} model={model} acked={aside.acked.includes(i.id)} />
            ))}
          </ul>
        </div>
      ))}
      {!!dismissed.length && (
        <div className="checks-group is-dismissed">
          <button type="button" className="link small" aria-expanded={showDismissed} onClick={() => setShowDismissed(!showDismissed)}>
            {showDismissed ? 'Hide' : 'Show'} {dismissed.length} dismissed
          </button>
          {showDismissed && (
            <ul>
              {dismissed.map((i) => (
                <li key={i.id} className={`issue sev-${i.severity} is-aside`}>
                  <span className="issue-msg">{i.message}</span>
                  <div className="issue-actions">
                    <button type="button" className="link small" onClick={() => setIssueAside(i.id, 'dismissed', false)}>
                      Bring back
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="muted small">Code is the Florida residential code (based on the 2021 IRC); should fix is the kitchen and bath guidelines (NKBA). The app flags; an engineer, plumber or the building department decides.</p>
    </section>
  )
}

function IssueRow({ i, model, acked }: { i: Issue; model: Model; acked: boolean }) {
  return (
    <li className={`issue sev-${i.severity}${i.locked ? ' is-locked' : ''}${acked ? ' is-acked' : ''}`}>
      <button type="button" className="issue-main" onClick={() => show(model, i)} title="Show it in the plan">
        <span className="issue-sev">{i.locked ? 'Engineer' : WORD[i.severity]}</span>
        <span className="issue-msg">{i.message}</span>
      </button>
      <div className="issue-actions">
        {i.fix && (
          <button type="button" className="btn small" onClick={() => void handEdit(i.fix as Op[], `Fix: ${i.fixLabel ?? 'from the checks'}`)}>
            {i.fixLabel ?? 'Fix'}
          </button>
        )}
        {i.locked ? (
          acked ? (
            <span className="muted small">Acknowledged; stays on the plan until an engineer signs off</span>
          ) : (
            <button type="button" className="link small" onClick={() => setIssueAside(i.id, 'acked')}>
              Acknowledge
            </button>
          )
        ) : (
          <button type="button" className="link small" onClick={() => setIssueAside(i.id, 'dismissed')}>
            Dismiss
          </button>
        )}
      </div>
    </li>
  )
}

/** Issues grouped by room, the current level's first, rooms with code problems first. */
function group(model: Model | null, issues: Issue[], levelId: string | null) {
  if (!model) return []
  const rank = { blocks: 0, fix: 1, note: 2 }
  const by = new Map<string, Issue[]>()
  for (const i of issues) {
    const key = i.where.room ?? `level:${i.where.level}`
    by.set(key, [...(by.get(key) ?? []), i])
  }
  return [...by.entries()]
    .map(([key, list]) => {
      const room = model.rooms.find((r) => r.id === key)
      const level = model.levels.find((l) => l.id === (room?.level ?? key.slice(6)))
      return {
        key,
        title: room ? `${room.name}${model.levels.length > 1 ? ` · ${level?.name ?? ''}` : ''}` : `${level?.name ?? 'House'}, not in a room`,
        level: level?.id,
        worst: Math.min(...list.map((i) => rank[i.severity])),
        issues: list.sort((a, b) => rank[a.severity] - rank[b.severity]),
      }
    })
    .sort((a, b) => Number(b.level === levelId) - Number(a.level === levelId) || a.worst - b.worst || a.title.localeCompare(b.title))
}

/** Frame what an issue is about in the plan and select it. */
function show(model: Model, i: Issue) {
  const pts: Vec[] = []
  let sel: { kind: SelKind; id: string } | null = null
  for (const id of i.where.ids) {
    const it = model.items.find((x) => x.id === id)
    const o = model.openings.find((x) => x.id === id)
    const w = model.walls.find((x) => x.id === id)
    const r = model.rooms.find((x) => x.id === id)
    const st = model.stairs.find((x) => x.id === id)
    const n = model.notes.find((x) => x.id === id)
    if (it) {
      pts.push(...footprint(it))
      sel ??= { kind: 'item', id }
    } else if (o) {
      const ow = model.walls.find((x) => x.id === o.wall)
      if (ow) pts.push(pointAt(ow, o.at - o.w / 2), pointAt(ow, o.at + o.w / 2))
      sel ??= { kind: 'opening', id }
    } else if (w) {
      pts.push(w.a, w.b)
      sel ??= { kind: 'wall', id }
    } else if (r) {
      pts.push(...r.polygon)
      sel ??= { kind: 'room', id }
    } else if (st) {
      pts.push(...st.polygon)
      sel ??= { kind: 'stair', id }
    } else if (n?.at) pts.push(n.at.p)
  }
  // Small things are framed with their room around them, so the plan reads.
  const room = i.where.room ? model.rooms.find((x) => x.id === i.where.room) : null
  if (room && pts.length < 12) pts.push(...room.polygon)
  // The issue's room becomes the focus (Velda's "here"), or its level when it is in no room.
  focusOn({ roomId: room?.id ?? null, levelId: i.where.level })
  if (sel) select(sel.kind, sel.id)
  frameOn(i.where.level, pts as [number, number][])
}
