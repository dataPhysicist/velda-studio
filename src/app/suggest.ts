// Suggested prompts (06 section 4): a few things to say, picked from where the person is. A check
// that needs fixing comes first, then what fits the room in focus, then a general one. Pure.
import type { Issue } from '../analysis/checks'
import type { Model, Room } from '../model/types'

const WET = /bath|powder|shower|wc/i
const KITCHEN = /kitchen/i
const BED = /bed(room)?\b/i
const LIVING = /living|family|great room|den/i

const RULE_WORDS: Record<string, string> = {
  'toilet-side': 'the toilet clearance',
  'toilet-front': 'the space in front of the toilet',
  'shower-size': 'the shower size',
  'shower-front': 'the space in front of the shower',
  'tub-front': 'the space beside the tub',
  'lavatory-front': 'the space in front of the sink',
  'kitchen-aisle': 'the kitchen aisle',
  'door-clash': 'the doors that hit each other',
  'door-hits': 'the door that hits a fixture',
  'items-overlap': 'the fixtures that run into each other',
  'hall-width': 'the narrow hall',
  'egress-door': 'the way out',
  'bedroom-egress': 'the bedroom window for escape',
}

export type SuggestInput = { model: Model | null; roomId: string | null; checks: Issue[]; asBuilt: boolean; recentInspiration?: string | null }

export function suggestions(s: SuggestInput, max = 4): string[] {
  const out: string[] = []
  const m = s.model
  if (!m) return []
  const room: Room | undefined = s.roomId ? m.rooms.find((r) => r.id === s.roomId) : undefined
  const the = (r: Room) => (/^(room|space|area)\b/i.test(r.name) ? r.name : `the ${r.name}`)
  // A check that needs fixing, in the room in focus first.
  const fixable = s.checks.filter((i) => i.severity !== 'note' && RULE_WORDS[i.rule])
  const issue = (room && fixable.find((i) => i.where.room === room.id)) || fixable[0]
  if (issue) {
    const r = issue.where.room ? m.rooms.find((x) => x.id === issue.where.room) : undefined
    out.push(`Fix ${RULE_WORDS[issue.rule]}${r ? ` in ${the(r)}` : ''}`)
  }
  if (s.recentInspiration && room) out.push(`Apply this look to ${the(room)}`)
  if (room) {
    if (WET.test(room.name)) out.push('Find me the best shower for this bathroom', `What would you change in ${the(room)}?`)
    else if (KITCHEN.test(room.name)) out.push('Move the sink to the island', 'Show me the kitchen in 3D', 'What layout fits this kitchen best?')
    else if (BED.test(room.name)) out.push(`Where does the bed go in ${the(room)}?`, `What would you change in ${the(room)}?`)
    else if (LIVING.test(room.name)) out.push(`Open ${the(room)} to the kitchen`, `What would you change in ${the(room)}?`)
    else out.push(`What would you change in ${the(room)}?`)
    out.push('Show this room realistically')
  } else {
    const bath = m.rooms.find((r) => /primary bath/i.test(r.name)) ?? m.rooms.find((r) => WET.test(r.name))
    const kitchen = m.rooms.find((r) => KITCHEN.test(r.name))
    if (bath) out.push(`What would you change in ${the(bath)}?`)
    if (kitchen) out.push('Show me the kitchen in 3D')
    out.push('What would you change first?')
  }
  if (s.asBuilt) out.push('Record a wall I measured with a tape')
  return [...new Set(out)].slice(0, max)
}
