import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyTags, boardTags, ingest, tagPrompt } from '../../src/inspiration/ingest'
import { boardPinsUrl, pinInfoUrl } from '../../src/inspiration/pinterest'
import { deriveRooms } from '../../src/model/derive'
import { applyOps } from '../../src/model/ops'
import type { Inspiration } from '../../src/model/types'
import { twoRooms } from '../model/fixtures'

const fx = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'))
const BOARD = 'https://uk.pinterest.com/someone/marble-shower-tray-finish-anti-slip/'
const PIN = 'https://www.pinterest.com/pin/93309023521348330/'

/** A stand-in for Velda: answers each tagging request from what the prompt lists. */
function fakeSdk(asked: string[]) {
  return {
    ask: async (prompt: string) => {
      asked.push(prompt)
      const n = (prompt.match(/^\d+\. /gm) ?? []).length
      const items = Array.from({ length: n }, (_, k) => ({
        i: k + 1,
        title: `Marble shower ${k + 1}`,
        style: ['spa', k % 2 ? 'warm minimal' : 'spa'],
        materials: ['honed Carrara marble'],
        fixtures: ['linear drain'],
        palette: [{ hex: '#f2f3f3', name: 'marble white' }, { hex: '#123456', name: 'a made-up blue' }],
        notes: 'Stone floor that runs into the shower.',
      }))
      const measured = Array.from({ length: n }, (_, k) => ({ i: k + 1, palette: [{ hex: '#F2F3F3', share: 0.5 }, { hex: '#dcdedf', share: 0.4 }] }))
      return JSON.stringify({ items, measured })
    },
  } as any
}

describe('inspiration ingest', () => {
  it('makes a board card and one card per picture, tags them through Velda, and keeps only measured colors', async () => {
    const asked: string[] = []
    const json = async (u: string) => (u === boardPinsUrl('someone', 'marble-shower-tray-finish-anti-slip') ? fx('pinterest-board.json') : u === pinInfoUrl('93309023521348330') ? fx('pinterest-pin.json') : null)
    const progress: string[] = []
    const r = await ingest([{ url: BOARD }, { url: PIN }], ['r1'], { sdk: fakeSdk(asked), upload: async () => {}, progress: (t) => progress.push(t), getJson: json, now: () => '2026-10-25T00:00:00Z' })
    const board = r.entries.find((e) => e.kind === 'board')!
    const pins = r.entries.filter((e) => e.kind === 'pin')
    expect(board.title).toBe('marble Shower Tray finish anti-slip')
    expect(pins).toHaveLength(10) // 9 from the board (one picture was pinned twice) and the single pin
    expect(pins.filter((p) => p.parent === board.id)).toHaveLength(9)
    expect(r.entries.every((e) => e.rooms[0] === 'r1')).toBe(true)
    // Ten pictures: two Velda calls of at most eight, each with the sandbox code for its pictures.
    expect(asked).toHaveLength(2)
    expect(asked[0]).toContain('const quantize = ')
    expect(asked[0]).toContain('https://i.pinimg.com/236x/')
    expect(progress.some((t) => /pictures 1 to 8 of 10/.test(t))).toBe(true)
    // Tags land; the made-up blue is dropped because nothing measured it.
    expect(pins[0].tags.palette).toEqual([{ hex: '#f2f3f3', name: 'marble white' }])
    expect(pins[0].sampled).toEqual([{ hex: '#f2f3f3', share: 0.5 }, { hex: '#dcdedf', share: 0.4 }])
    expect(pins[0].title).toBe('Marble shower 1')
    expect(board.tags.materials).toEqual(['honed carrara marble'])
    expect(board.tags.style[0]).toBe('spa')
    expect(r.said.some((s) => /has 10 pins/.test(s))).toBe(false) // all 10 came back (9 after the duplicate)
  })

  it('says plainly when a board gives back almost nothing, and keeps Pinterest\'s color when a picture cannot be measured', async () => {
    const small = fx('pinterest-board.json')
    small.data.pins = small.data.pins.slice(0, 2)
    const r = await ingest([{ url: BOARD }], [], { sdk: null, upload: async () => {}, progress: () => {}, getJson: async () => small })
    expect(r.said[0]).toMatch(/only 2 pictures .* may be private/)
    expect(r.entries.filter((e) => e.kind === 'pin')[0].sampled).toEqual([{ hex: '#988f8c', share: 1 }])
  })

  it('asks Velda to read any other page, and turns a pin.it link into advice', async () => {
    const r = await ingest([{ url: 'https://www.example-tile.com/carrara-hex' }, { url: 'https://pin.it/abc' }], [], { sdk: null, upload: async () => {}, progress: () => {} })
    expect(r.entries).toHaveLength(1)
    expect(r.entries[0]).toMatchObject({ kind: 'url', url: 'https://www.example-tile.com/carrara-hex', source: 'example-tile.com' })
    expect(tagPrompt(r.entries)).toContain('a web page: https://www.example-tile.com/carrara-hex (read it with crawling')
    expect(r.said[0]).toMatch(/full link/)
  })

  it('points Velda at stored pictures by path and lists their measured colors', () => {
    const e: Inspiration = { id: 'a', kind: 'image', image: 'velda-studio/inspiration/a.jpg', title: 'bath', sampled: [{ hex: '#ffffff', share: 0.6 }], tags: { style: [], palette: [], materials: [], fixtures: [] }, rooms: [], addedBy: 'user', createdAt: '' }
    const p = tagPrompt([e])
    expect(p).toContain('read_storage_file, fileName "velda-studio/inspiration/a.jpg"')
    expect(p).toContain('measured colors #ffffff 60%')
    expect(p).not.toContain('execute_code exactly') // nothing to measure remotely
    applyTags([e], { items: [{ i: 1, palette: [{ hex: '#fefefe', name: 'white' }, { hex: '#000000' }], style: ['bright'] }] })
    expect(e.tags.palette).toEqual([{ hex: '#fefefe', name: 'white' }]) // within a hair of a measured color
  })

  it('keeps the words a board\'s pins share most', () => {
    const t = (style: string[], hex: string): Inspiration => ({ id: hex, kind: 'pin', tags: { style, materials: [], fixtures: [], palette: [{ hex }] }, rooms: [], addedBy: 'user', createdAt: '' })
    const b = boardTags([t(['Spa', 'modern'], '#111111'), t(['spa'], '#111111'), t(['rustic'], '#222222')])
    expect(b.style[0]).toBe('spa')
    expect(b.palette[0].hex).toBe('#111111')
  })

  it('adds, retitles, files and removes cards through ops (a board takes its pins)', async () => {
    const r = await ingest([{ url: BOARD }], [], { sdk: null, upload: async () => {}, progress: () => {}, getJson: async () => fx('pinterest-board.json') })
    let m = deriveRooms(twoRooms())
    m = applyOps(m, [{ op: 'add_inspiration', entries: r.entries }], { author: 'user' }).model
    expect(m.inspiration).toHaveLength(10)
    const pin = m.inspiration.find((e) => e.kind === 'pin')!
    m = applyOps(m, [{ op: 'update_inspiration', id: pin.id, add_room: 'Den', title: 'Linear drain detail' }], { author: 'ai' }).model
    expect(m.inspiration.find((e) => e.id === pin.id)).toMatchObject({ rooms: ['r1'], title: 'Linear drain detail' })
    const board = m.inspiration.find((e) => e.kind === 'board')!
    m = applyOps(m, [{ op: 'remove_inspiration', id: board.id }], { author: 'user' }).model
    expect(m.inspiration).toEqual([])
  })
})
