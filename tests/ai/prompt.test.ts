import { describe, expect, it } from 'vitest'
import { runChecks } from '../../src/analysis/checks'
import { buildPrompt } from '../../src/ai/prompt'
import { describeModel, roomsInDetail } from '../../src/ai/summary'
import { DEEP_MODEL, FAST_MODEL, parseAnswer, pickModel } from '../../src/lib/agent'
import { deriveRooms } from '../../src/model/derive'
import { migrateV1 } from '../../src/model/migrate'
import { applyOps } from '../../src/model/ops'
import type { Model } from '../../src/model/types'
import type { Message } from '../../src/repo'
import { a2 } from '../import/a2-fixture'
import { twoRooms, v03Kitchen } from '../model/fixtures'

const P = { src: 'user' as const }
/** The two-room box as a small kitchen and office, with a window on the sink wall. */
function kitchen(): Model {
  const m = deriveRooms(twoRooms())
  m.rooms.find((r) => r.name === 'Den')!.name = 'Kitchen'
  m.openings.push({ id: 'w1', wall: 'top', kind: 'window', at: 60, w: 36, h: 84, sill: 42, style: 'double_hung', prov: { at: P, w: P, h: { src: 'default' }, sill: { src: 'default' } } })
  return applyOps(
    m,
    [
      { op: 'place', item: { id: 'base', kind: 'base_cabinet', w: 96, label: 'Sink run' }, room: 'Kitchen', against: 'top' },
      { op: 'place', item: { id: 'sink', kind: 'sink', label: 'Main sink' }, on: 'base' },
      { op: 'add_item', id: 'isl', kind: 'island', label: 'Island', x: 60, y: 72, w: 60, d: 30 },
      { op: 'place', item: { id: 'range', kind: 'range', label: 'Gas range' }, room: 'Kitchen', against: 'left' },
    ],
    { author: 'user' },
  ).model
}

const history: Message[] = [
  { id: 'm1', scheme_id: 's', role: 'user', body: 'Make the kitchen feel bigger' },
  { id: 'm2', scheme_id: 's', role: 'assistant', body: 'I moved the island 6" toward the office.' },
]

describe("Velda's prompt", () => {
  it('only changes on purpose (snapshot)', async () => {
    const m = kitchen()
    const prompt = buildPrompt({
      model: m,
      text: 'move the sink to the island',
      attachments: [],
      history,
      focus: { roomId: m.rooms.find((r) => r.name === 'Kitchen')!.id, roomName: 'Kitchen', level: 'L1' },
      checks: runChecks(m),
      recentVersions: ['v1 Imported', 'v2 Island moved'],
      skipped: ['open_wall top: wall is exterior; use a window or door'],
    })
    await expect(prompt).toMatchFileSnapshot('./__snapshots__/prompt.txt')
  })

  it('keeps its sections in the order the contract sets', () => {
    const m = kitchen()
    const prompt = buildPrompt({ model: m, text: 'what would you do here?', attachments: [], history, focus: { roomId: null, roomName: null, level: 'L1' }, skipped: ['x: y'], analysis: { scope: 'the Kitchen', issues: runChecks(m), changed: 'Sink moved' } })
    const order = ['You are Velda', 'Do not call any tools', 'Return ONLY one JSON object', 'OPERATIONS', 'DESIGN RULES', 'PROVENANCE', 'STRUCTURE', 'FOCUS', 'MODEL:', 'RECENT CONVERSATION', 'SKIPPED LAST TURN', 'CHECK RESULTS for the Kitchen', 'N8: what would you do here?']
    const at = order.map((s) => prompt.indexOf(s))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(prompt).not.toMatch(/—/) // no em dashes anywhere Velda reads
  })

  it('tells Velda the as-built is a record and design changes branch', () => {
    const p = buildPrompt({ model: kitchen(), text: 'hi', attachments: [], history: [], focus: { roomId: null, roomName: null, level: null }, asBuilt: true })
    expect(p).toContain('AS-BUILT: the open scheme is the record of the house as it is today')
  })
})

describe('what Velda sees of the model', () => {
  it('details the room the message is about, with walls as the room sees them and items by wall', () => {
    const m = kitchen()
    expect(roomsInDetail(m, { text: 'move the sink to the island' }).map((r) => r.name)).toEqual(['Kitchen'])
    const text = describeModel(m, { text: 'move the sink to the island', checks: runChecks(m) })
    expect(text).toMatch(/top top wall \(exterior, 6", bearing yes\) face \(3,3\)->\(118,3\)/)
    expect(text).toMatch(/w1 window double_hung 3'-0" at 60 from a \(60,0\), sill 42 head 84 \(heights assumed\)/)
    expect(text).toMatch(/d1 door swing 2'-6" at 50 from a \(120,50\), head 80, hinge a, swings into Office/)
    expect(text).toMatch(/sink sink "Main sink" 33w 22d 36h .*, set into base/)
    expect(text).toMatch(/range range "Gas range" .*, against left/)
    expect(text).toContain('North is not set')
  })

  it('stays under 6 KB for the whole house', () => {
    const house = migrateV1(v03Kitchen(), { now: '2026-10-25T00:00:00Z' }).model
    const kitchenRoom = house.rooms.find((r) => r.name === 'Kitchen')!
    const sizes = [
      describeModel(house, {}),
      describeModel(house, { focusRoomId: kitchenRoom.id, text: 'swap the range and the fridge tower, and add patio doors where the sink wall is', checks: runChecks(house) }),
      describeModel(a2().result.model, { text: 'what shower fits in the primary bathroom?' }),
    ].map((t) => new TextEncoder().encode(t).length)
    for (const n of sizes) expect(n).toBeLessThan(6144)
  }, 60_000)
})

describe('model choice and answers', () => {
  it('sends design questions and visual words to the deeper model, plain edits to the faster one', () => {
    for (const t of ['What shower fits here?', 'show me options for the bath', 'what if the island were longer', 'pull colors from this Pinterest board', 'recommend a palette', 'which layout is best'])
      expect(pickModel(t, [])).toBe(DEEP_MODEL)
    for (const t of ['move the sink to the island', 'swap the range and the fridge tower', 'make the door 32 in']) expect(pickModel(t, [])).toBe(FAST_MODEL)
  })

  it('still repairs unescaped inch marks in an answer', () => {
    const a = parseAnswer('{"reply": "Moved it 6" to the left.", "summary": "Sink moved", "ops": [{"op":"move","id":"sink","dx":-6}], "question": null}')
    expect(a.reply).toBe('Moved it 6" to the left.')
    expect(a.ops).toHaveLength(1)
  })
})
