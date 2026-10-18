// Compact text description of the model for Velda's prompt. Inches, plan coordinates.
// (Phase 5 rewrites this per 07 section 2; this version is the v0.3 format on model v2.)
import { pointInPolygon, polygonArea, polygonBounds, wallLength } from '../model/geom'
import type { Model } from '../model/types'
import { formatFeetInches } from '../model/units'
import { themeBrief } from './theme'

const r = (v: number) => Math.round(v)

export function describeModel(model: Model, opts: { focusRoomId?: string | null; focusLevel?: string | null } = {}): string {
  const out: string[] = []
  out.push(`Units: inches. Plan: x grows to the right, y grows down the sheet. No compass directions are known unless stated.`)
  out.push(`Item rot: 0 = front faces +y (down the sheet), 90 = faces +x, 180 = faces -y, -90 = faces -x. Item x,y = center; w = width along its front, d = depth, h = height.`)
  out.push(`Window and door h = head height above the floor; sill = floor to the bottom of the glass.`)
  out.push('')
  out.push(`THEMES (house theme: ${model.theme ?? 'none'}):`)
  for (const t of Object.values(model.themes ?? {})) out.push(`- [${t.id}] ${themeBrief(t).replace(/\n/g, '\n    ')}`)
  const openingsByWall = new Map<string, Model['openings']>()
  for (const o of model.openings) openingsByWall.set(o.wall, [...(openingsByWall.get(o.wall) ?? []), o])
  for (const lv of model.levels) {
    if (opts.focusLevel && opts.focusLevel !== lv.id) {
      out.push('', `LEVEL ${lv.id} "${lv.name}": rooms ${model.rooms.filter((x) => x.level === lv.id).map((x) => x.name).join(', ')} (details omitted; ask to switch level)`)
      continue
    }
    const assumed = lv.prov.ceiling.src === 'default' ? ' (assumed, not confirmed)' : ''
    out.push('', `LEVEL ${lv.id} "${lv.name}" (floor at ${r(lv.elev)}", ceiling ${formatFeetInches(lv.ceiling)}${assumed})`)
    out.push('Rooms:')
    for (const room of model.rooms.filter((x) => x.level === lv.id)) {
      const b = polygonBounds(room.polygon)
      out.push(
        `- ${room.id} "${room.name}"${room.id === opts.focusRoomId ? ' <- FOCUSED' : ''}: ${r(polygonArea(room.polygon) / 144)} sf, x ${r(b.x0)}..${r(b.x1)}, y ${r(b.y0)}..${r(b.y1)}${room.theme ? `, theme ${room.theme}` : ''}${room.flags.length ? `, ${room.flags.join(', ').replace(/_/g, ' ')}` : ''}`,
      )
    }
    out.push('Walls (id: start -> end, thickness; openings at = inches from start to opening center):')
    for (const w of model.walls.filter((x) => x.level === lv.id)) {
      const ops = (openingsByWall.get(w.id) ?? []).map(
        (o) =>
          `${o.kind} ${o.id} at ${r(o.at)} w ${r(o.w)}${o.kind === 'window' ? ` sill ${o.sill ?? 36} head ${r(o.h)}` : ` h ${r(o.h)}`}${o.shape === 'arch' ? ' arched' : ''}${o.style && o.style !== 'swing' && o.style !== 'double_hung' ? ` ${o.style}` : ''}`,
      )
      out.push(
        `- ${w.id}: (${r(w.a[0])},${r(w.a[1])}) -> (${r(w.b[0])},${r(w.b[1])}) len ${r(wallLength(w))} t ${w.t}${w.kind !== 'wall' ? ` ${w.kind}` : ''}${w.exterior ? ' exterior' : ''}${w.bearing === 'yes' ? ' bearing' : ''}${w.h ? ` h ${w.h}` : ''}${ops.length ? ` | ${ops.join('; ')}` : ''}`,
      )
    }
    out.push('Items:')
    for (const it of model.items.filter((x) => x.level === lv.id)) {
      const room = model.rooms.find((x) => x.level === lv.id && pointInPolygon([it.x, it.y], x.polygon))
      out.push(
        `- ${it.id} ${it.kind} "${it.label}" at (${r(it.x)},${r(it.y)}) rot ${r(it.rot)} ${r(it.w)}w x ${r(it.d)}d x ${r(it.h)}h${it.z ? ` z ${r(it.z)}` : ''}${room ? ` in ${room.name}` : ''}${it.catalog ? ` model ${it.catalog}` : ''}`,
      )
    }
  }
  if (model.notes?.length) out.push('', 'NOTES:', ...model.notes.slice(-15).map((n) => `- ${n.locked ? '(cannot be removed) ' : ''}${n.text}`))
  return out.join('\n')
}
