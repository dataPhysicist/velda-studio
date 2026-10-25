// The chooser for Velda's design options (07 section 7): one card per option scheme with a small plan
// of the room, and a button that opens that scheme.
import { useEffect, useState } from 'react'
import { isV1 } from '../model/migrate'
import { pointInPolygon, polygonBounds } from '../model/geom'
import type { Model, Vec } from '../model/types'
import { wallPoly } from '../plan2d/geometry'
import type { MessageMeta } from '../repo'
import { openScheme, useStudio } from './store'

type Choice = NonNullable<MessageMeta['choices']>[number]

export function Choices({ choices }: { choices: Choice[] }) {
  const schemeId = useStudio((s) => s.schemeId)
  return (
    <div className="choices" role="group" aria-label="Design options">
      {choices.map((c) => (
        <div key={c.scheme_id} className={`choice${c.scheme_id === schemeId ? ' is-open' : ''}`}>
          <ChoiceThumb c={c} />
          <div className="choice-label">{c.label}</div>
          <button type="button" disabled={c.scheme_id === schemeId} onClick={() => openScheme(c.scheme_id)}>
            {c.scheme_id === schemeId ? 'Showing' : 'Open this one'}
          </button>
        </div>
      ))}
    </div>
  )
}

const cache = new Map<string, Model>()

function ChoiceThumb({ c }: { c: Choice }) {
  const repo = useStudio((s) => s.repo)
  const schemes = useStudio((s) => s.schemes)
  const head = schemes.find((s) => s.id === c.scheme_id)?.head_version ?? null
  const [model, setModel] = useState<Model | null>(head ? (cache.get(head) ?? null) : null)
  useEffect(() => {
    if (!repo || !head || model) return
    repo
      .model(head)
      .then((m) => {
        if (m && !isV1(m)) {
          cache.set(head, m as Model)
          setModel(m as Model)
        }
      })
      .catch(() => {})
  }, [repo, head])
  if (!model) return <div className="choice-thumb is-empty" aria-hidden="true" />
  return <PlanThumb model={model} level={c.level ?? null} roomId={c.room ?? null} />
}

/** A small, static plan: walls, items and the room in question, framed on that room (or the level). */
export function PlanThumb({ model, level, roomId }: { model: Model; level: string | null; roomId: string | null }) {
  const room = roomId ? model.rooms.find((r) => r.id === roomId) : null
  const lv = room?.level ?? level ?? model.levels[0]?.id
  const walls = model.walls.filter((w) => w.level === lv)
  const pts: Vec[] = room ? room.polygon : walls.flatMap((w) => [w.a, w.b])
  if (!pts.length) return <div className="choice-thumb is-empty" aria-hidden="true" />
  const b = polygonBounds(pts)
  const pad = room ? 18 : 12
  const vb = [b.x0 - pad, b.y0 - pad, b.x1 - b.x0 + 2 * pad, b.y1 - b.y0 + 2 * pad]
  const poly = (p: Vec[]) => p.map((v) => v.join(',')).join(' ')
  const items = model.items.filter((it) => it.level === lv && (!room || pointInPolygon([it.x, it.y], room.polygon)))
  return (
    <svg className="choice-thumb" viewBox={vb.join(' ')} role="img" aria-label={`Plan of ${room?.name ?? 'the level'}`}>
      {room && <polygon points={poly(room.polygon)} className="t-room" />}
      {walls.map((w) => (
        <polygon key={w.id} points={poly(wallPoly(w))} className="t-wall" />
      ))}
      {model.openings
        .filter((o) => walls.some((w) => w.id === o.wall))
        .map((o) => {
          const w = walls.find((x) => x.id === o.wall)!
          const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1
          const u = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L]
          const a: Vec = [w.a[0] + u[0] * (o.at - o.w / 2), w.a[1] + u[1] * (o.at - o.w / 2)]
          const e: Vec = [w.a[0] + u[0] * (o.at + o.w / 2), w.a[1] + u[1] * (o.at + o.w / 2)]
          return <line key={o.id} x1={a[0]} y1={a[1]} x2={e[0]} y2={e[1]} className={`t-open is-${o.kind}`} strokeWidth={w.t + 1} />
        })}
      {items.map((it) => (
        <rect key={it.id} x={-it.w / 2} y={-it.d / 2} width={it.w} height={it.d} className="t-item" transform={`translate(${it.x} ${it.y}) rotate(${-it.rot})`} />
      ))}
    </svg>
  )
}
