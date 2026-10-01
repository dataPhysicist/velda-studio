// Compact text description of the model for Velda's prompt. Inches, plan coordinates.
import { type StudioModel, polygonArea, polygonBounds, roomAt, wallLength } from './model'
import { themeBrief } from './theme'

const r = (v: number) => Math.round(v)

export function describeModel(model: StudioModel, opts: { focusRoomId?: string | null; focusLevel?: string | null } = {}): string {
  const out: string[] = []
  out.push(`Ceiling height: ${model.ceiling}" on every level. Units: inches. Plan: x grows to the right, y grows down the sheet (south).`)
  out.push(`Item rot: 0 = front faces +y (down the sheet), 90 = faces +x, 180 = faces -y, -90 = faces -x. Item x,y = center; w = width along its front, d = depth, h = height.`)
  out.push('')
  out.push(`THEMES (house theme: ${model.theme ?? 'none'}):`)
  for (const t of Object.values(model.themes ?? {})) out.push(`- [${t.id}] ${themeBrief(t).replace(/\n/g, '\n    ')}`)
  for (const lv of model.levels) {
    if (opts.focusLevel && opts.focusLevel !== lv.id) {
      out.push('', `LEVEL ${lv.id} "${lv.name}": rooms ${model.rooms.filter((x) => x.level === lv.id).map((x) => x.name).join(', ')} (details omitted; ask to switch level)`)
      continue
    }
    out.push('', `LEVEL ${lv.id} "${lv.name}" (floor at ${lv.elev}")`)
    out.push('Rooms:')
    for (const room of model.rooms.filter((x) => x.level === lv.id)) {
      const b = polygonBounds(room.polygon)
      out.push(
        `- ${room.id} "${room.name}"${room.id === opts.focusRoomId ? ' <- FOCUSED' : ''}: ${r(polygonArea(room.polygon) / 144)} sf, x ${r(b.x0)}..${r(b.x1)}, y ${r(b.y0)}..${r(b.y1)}${room.theme ? `, theme ${room.theme}` : ''}`,
      )
    }
    out.push('Walls (id: start -> end, thickness; openings at = inches from start to opening center):')
    for (const w of model.walls.filter((x) => x.level === lv.id)) {
      const ops = w.openings.map((o) => `${o.kind} ${o.id} at ${r(o.at)} w ${r(o.w)}${o.kind === 'window' ? ` sill ${o.sill ?? 36} h ${o.h}` : ` h ${o.h}`}${o.shape === 'arch' ? ' arched' : ''}${o.style && o.style !== 'swing' ? ` ${o.style}` : ''}`)
      out.push(
        `- ${w.id}: (${r(w.a[0])},${r(w.a[1])}) -> (${r(w.b[0])},${r(w.b[1])}) len ${r(wallLength(w))} t ${w.t}${w.kind && w.kind !== 'wall' ? ` ${w.kind}` : ''}${w.h ? ` h ${w.h}` : ''}${ops.length ? ` | ${ops.join('; ')}` : ''}`,
      )
    }
    out.push('Items:')
    for (const it of model.items.filter((x) => x.level === lv.id)) {
      const room = roomAt(model, lv.id, [it.x, it.y])
      out.push(
        `- ${it.id} ${it.kind} "${it.label}" at (${r(it.x)},${r(it.y)}) rot ${r(it.rot)} ${r(it.w)}w x ${r(it.d)}d x ${r(it.h)}h${it.z ? ` z ${r(it.z)}` : ''}${room ? ` in ${room.name}` : ''}${it.catalog ? ` model ${it.catalog}` : ''}`,
      )
    }
  }
  if (model.notes?.length) out.push('', 'NOTES:', ...model.notes.map((n) => `- ${n}`))
  return out.join('\n')
}
