// The handoff checklist (08 section 8): what a designer or contractor would otherwise have to ask
// about. Shown in the Export dialog and written as README.md in the package. It never blocks an
// export; each line says what is missing and points at the thing to fix.
import { type Issue, runChecks } from '../analysis/checks'
import { roomOf, roomsAcross } from '../analysis/space'
import { badgeOf, type Model } from '../model/types'
import { formatFeetInches } from '../model/units'

export type CheckLine = { ok: boolean; text: string; missing: string[]; fix?: { kind: 'level' | 'room' | 'opening' | 'dimension' | 'issue'; ids: string[] } }

export type ChecklistInput = {
  model: Model
  asBuilt: Model | null
  /** Ids of issues a person has set aside (engineer cautions acknowledged). */
  aside: Set<string>
  /** What changed on the as-built after it was imported (version summaries), if anything. */
  asBuiltEdits: string[]
  /** This scheme is the as-built itself. */
  isAsBuilt: boolean
}

export function checklist(c: ChecklistInput): CheckLine[] {
  const m = c.model
  const out: CheckLine[] = []
  const levelName = (id: string) => m.levels.find((l) => l.id === id)?.name ?? id
  // Ceilings and floor structure confirmed.
  const defaults = m.levels.filter((l) => l.prov.ceiling.src === 'default' || (m.levels.length > 1 && l.prov.floorThickness.src === 'default'))
  out.push({
    ok: !defaults.length,
    text: 'Every level has a confirmed ceiling height and floor thickness.',
    missing: defaults.map((l) => `${l.name}: ${l.prov.ceiling.src === 'default' ? `ceiling ${formatFeetInches(l.ceiling)} is assumed` : `floor structure ${formatFeetInches(l.floorThickness)} is assumed`}`),
    fix: defaults.length ? { kind: 'level', ids: defaults.map((l) => l.id) } : undefined,
  })
  // Dimensions in conflict.
  // On a proposed scheme, a drawn dimension the design changed on purpose (it holds on the as-built) is
  // a change, not a question; the change log has it. Only disagreements the as-built has too count here.
  const heldOnAsBuilt = new Set(!c.isAsBuilt && c.asBuilt ? c.asBuilt.dimensions.filter((d) => d.status === 'ok').map((d) => d.id) : [])
  const conflicts = m.dimensions.filter((d) => d.status === 'conflict' && !heldOnAsBuilt.has(d.id))
  const near = (level: string, a: [number, number], b: [number, number]) => roomOf(m, level, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])?.name
  out.push({
    ok: !conflicts.length,
    text: 'Every dimension on the drawing agrees with the walls.',
    missing: conflicts.map((d) => {
      const room = near(d.level, d.a, d.b)
      return `${levelName(d.level)}: the drawing says ${d.text}${room ? ` in the ${room}` : ''}, but the walls there do not match it`
    }),
    fix: conflicts.length ? { kind: 'dimension', ids: conflicts.map((d) => d.id) } : undefined,
  })
  // Window heights.
  const wallLevel = (id: string) => m.walls.find((w) => w.id === id)?.level ?? ''
  const windows = m.openings.filter((o) => o.kind === 'window' && (badgeOf(o.prov.h) === 'assumed' || badgeOf(o.prov.sill) === 'assumed'))
  out.push({
    ok: !windows.length,
    text: 'Every window has a measured head and sill.',
    missing: windows.length ? [`${windows.length} window${windows.length === 1 ? '' : 's'} on assumed heights (${[...new Set(windows.map((o) => levelName(wallLevel(o.wall))))].join(', ')}): field verify before ordering`] : [],
    fix: windows.length ? { kind: 'opening', ids: windows.map((o) => o.id) } : undefined,
  })
  // Door swings.
  const noSwing = m.openings.filter((o) => o.kind === 'door' && ['swing', 'french'].includes(o.style) && !o.swing)
  out.push({ ok: !noSwing.length, text: 'Every swinging door has a swing.', missing: noSwing.map((o) => {
      const rooms = roomsAcross(m, o).filter((r) => !!r).map((r) => r!.name)
      const where = rooms.length === 2 ? `between the ${rooms[0]} and the ${rooms[1]}` : rooms.length ? `into the ${rooms[0]}` : 'on an outside wall'
      return `The ${formatFeetInches(o.w)} door ${where} (${levelName(wallLevel(o.wall))})`
    }), fix: noSwing.length ? { kind: 'opening', ids: noSwing.map((o) => o.id) } : undefined })
  // Blocking checks.
  const issues: Issue[] = runChecks(m, { asBuilt: c.asBuilt })
  const blocks = issues.filter((i) => i.severity === 'blocks')
  out.push({ ok: !blocks.length, text: 'No open checks that fail code.', missing: blocks.map((i) => i.message), fix: blocks.length ? { kind: 'issue', ids: blocks.map((i) => i.id) } : undefined })
  // Structural cautions.
  const cautions = issues.filter((i) => i.rule === 'structure')
  const open = cautions.filter((i) => !c.aside.has(i.id))
  out.push({
    ok: !open.length,
    text: cautions.length ? `Structural cautions acknowledged (${cautions.length}).` : 'No structural cautions.',
    missing: open.map((i) => i.message),
    fix: open.length ? { kind: 'issue', ids: open.map((i) => i.id) } : undefined,
  })
  // Rooms being remodeled: named, themed, with inspiration.
  const remodel = m.project.remodelRooms.map((id) => m.rooms.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r)
  const themed = new Set(Object.keys(m.themes))
  if (!remodel.length)
    out.push({ ok: false, text: 'The rooms being remodeled are named and have a theme.', missing: ['No rooms are marked as being remodeled (the plan import asks; the Selection panel can mark one).'] })
  else {
    const bad = remodel.filter((r) => /^(room|space|area) ?\d*$/i.test(r.name) || !((r.theme && themed.has(r.theme)) || (m.theme && themed.has(m.theme))))
    out.push({ ok: !bad.length, text: 'The rooms being remodeled are named and have a theme.', missing: bad.map((r) => `${r.name}: ${/^(room|space|area) ?\d*$/i.test(r.name) ? 'needs a name' : 'no theme'}`), fix: bad.length ? { kind: 'room', ids: bad.map((r) => r.id) } : undefined })
    const bare = remodel.filter((r) => !m.inspiration.some((i) => i.rooms.includes(r.id)))
    out.push({ ok: !bare.length, text: 'Each room being remodeled has inspiration.', missing: bare.map((r) => `${r.name}: no inspiration yet`), fix: bare.length ? { kind: 'room', ids: bare.map((r) => r.id) } : undefined })
  }
  // The as-built record.
  out.push({
    ok: !c.asBuiltEdits.length,
    text: c.isAsBuilt ? 'This is the as-built record.' : 'The as-built is unchanged since it was imported.',
    missing: c.asBuiltEdits.map((s) => `Changed after import: ${s}`),
  })
  return out
}

export function checklistMd(lines: CheckLine[]): string {
  return lines
    .map((l) => [`- [${l.ok ? 'x' : ' '}] ${l.text}`, ...l.missing.slice(0, 12).map((x) => `  - ${x}`), ...(l.missing.length > 12 ? [`  - and ${l.missing.length - 12} more`] : [])].join('\n'))
    .join('\n')
}
