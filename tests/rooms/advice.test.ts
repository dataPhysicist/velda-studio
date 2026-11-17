import { describe, expect, it } from 'vitest'
import { editPrompt, labelFor, looksWhole, parseStudy, studyPrompt } from '../../src/rooms/ai'
import { kindOf } from '../../src/rooms/house'
import { ADVICE, adviceFor } from '../../src/rooms/review'

describe("the designer's notes", () => {
  it('raise the hidden work when a walk-in shower is asked for', () => {
    const { raised, standing } = adviceFor('bath', 'replace the tub with a curbless walk-in shower')
    const ids = raised.map((a) => a.id)
    expect(ids).toContain('bath-shower-water')
    expect(ids).toContain('bath-curbless')
    expect(ids).toContain('bath-glass')
    expect(raised.find((a) => a.id === 'bath-curbless')!.ask).toBe('engineer')
    expect(standing.map((a) => a.id)).toContain('bath-fan')
  })
  it('say nothing situational until something is asked', () => {
    expect(adviceFor('bath', '').raised).toEqual([])
    expect(adviceFor('bath', '').standing.length).toBeGreaterThan(3)
  })
  it('raise the island services and the wall for a kitchen', () => {
    const ids = adviceFor('kitchen', 'move the sink to the island and take out the wall to the dining room').raised.map((a) => a.id)
    expect(ids).toContain('kit-island-services')
    expect(ids).toContain('any-wall')
    expect(ids).toContain('any-permit')
  })
  it('keep bath notes out of bedrooms', () => {
    const all = adviceFor('bedroom', 'shower tub toilet vanity')
    expect([...all.raised, ...all.standing].some((a) => a.id.startsWith('bath-'))).toBe(false)
  })
  it('are written plainly: unique, short, no em dashes, someone to ask', () => {
    expect(new Set(ADVICE.map((a) => a.id)).size).toBe(ADVICE.length)
    for (const a of ADVICE) {
      expect(a.title.length, a.id).toBeLessThanOrEqual(60)
      expect(a.body.length, a.id).toBeLessThanOrEqual(420)
      expect(/[—–]/.test(a.title + a.body), a.id).toBe(false)
      expect(a.ask, a.id).toBeTruthy()
    }
  })
  it('know a room by its name', () => {
    expect(kindOf('Primary Bathroom')).toBe('bath')
    expect(kindOf('Jack & Jill Shower')).toBe('bath')
    expect(kindOf('Kitchen Nook')).toBe('kitchen')
    expect(kindOf('W.I.C.')).toBe('closet')
    expect(kindOf('Guest Bedroom 2')).toBe('bedroom')
    expect(kindOf('Laundry Room')).toBe('laundry')
  })
})

describe('asking for a change', () => {
  const cx = { room: 'Primary Bathroom', facts: "The Primary Bathroom (Level 2): 13'-1\" by 12'-8\", about 125 square feet, ceiling 9'-0\".", style: 'DU Primary Bath: herringbone floor.' }
  it('tells the model to change one thing and leave the rest, with the room\'s real size', () => {
    const p = editPrompt('paint the vanity navy', cx, { part: false, refs: 0, whole: false })
    expect(p).toContain('Change only this: paint the vanity navy')
    expect(p).toContain('Keep everything else exactly as it is')
    expect(p).toContain("13'-1\" by 12'-8\"")
    expect(p).not.toContain('herringbone')
  })
  it('brings the style direction in for a whole new look, and keeps the room itself', () => {
    const p = editPrompt('make it a spa-like retreat', cx, { part: false, refs: 1, whole: true })
    expect(p).toContain('herringbone')
    expect(p).toContain('Image 2 is a reference for the look')
    expect(p).toContain('every wall, window, door and ceiling where it is')
  })
  it('tells a whole-room request from a single change', () => {
    for (const w of ['make it modern farmhouse', 'brighter and airy', 'declutter the counters', 'show the whole room in a coastal style']) expect(looksWhole(w), w).toBe(true)
    for (const w of ['paint the vanity navy', 'brass faucets', 'swap the mirror for a round one', 'herringbone oak floor']) expect(looksWhole(w), w).toBe(false)
  })
  it('names a version from the request', () => {
    expect(labelFor('paint the vanity navy')).toBe('Paint the vanity navy')
    expect(labelFor('can you replace the tub with a curbless walk-in shower with a bench').length).toBeLessThanOrEqual(34)
  })
})

describe("Velda's look at a photo", () => {
  it('asks for ideas and notices with the plan facts, and reads the answer even with inch marks and a code fence', () => {
    const prompt = studyPrompt({ path: 'velda-rooms/p1/v1.jpg', room: 'Primary Bathroom', facts: 'about 125 square feet', style: '', planned: ['N8 bath: the tub becomes a shower'], findings: [], asked: [] })
    expect(prompt).toContain('read_storage_file')
    expect(prompt).toContain('velda-rooms/p1/v1.jpg')
    expect(prompt).toContain('about 125 square feet')
    expect(prompt).toContain('the tub becomes a shower')
    const s = parseStudy('```json\n{"sees": "A bath with a 6\'-0" vanity.", "ideas": [{"title": "Navy vanity", "why": "Grounds the room — nicely.", "prompt": "Paint the vanity navy.", "scale": "tweak"}, {"title": "", "prompt": ""}], "notices": [{"title": "Register under the vanity", "body": "The floor register sits where a wider vanity would go.", "ask": "Contractor"}]}\n```')!
    expect(s.ideas.length).toBe(1)
    expect(s.ideas[0].why).not.toMatch(/—/)
    expect(s.sees).toContain('6\'-0"')
    expect(s.notices[0].ask).toBe('contractor')
    expect(parseStudy('I could not open the file.')).toBeNull()
  })
})
