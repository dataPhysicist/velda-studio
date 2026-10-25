import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { quantize, remotePaletteScript } from '../../src/inspiration/palette'
import { boardPinsUrl, classifyLink, parseBoardPins, parsePinInfo, pinInfoUrl, readPinterest } from '../../src/inspiration/pinterest'

const fx = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'))

describe('Pinterest links', () => {
  it('tells pins, short links, boards and other pages apart', () => {
    expect(classifyLink('https://www.pinterest.com/pin/93309023521348330/')).toEqual({ kind: 'pin', id: '93309023521348330' })
    expect(classifyLink('https://www.pinterest.com/pin/mixed-marble--93309023521348330/')).toEqual({ kind: 'pin', id: '93309023521348330' })
    expect(classifyLink('https://uk.pinterest.com/pin/142496775704914509')).toEqual({ kind: 'pin', id: '142496775704914509' })
    expect(classifyLink('https://pin.it/3xYzAbC')).toEqual({ kind: 'pin_short', url: 'https://pin.it/3xYzAbC' })
    expect(classifyLink('https://uk.pinterest.com/someone/marble-shower-tray-finish-anti-slip/')).toEqual({ kind: 'board', user: 'someone', board: 'marble-shower-tray-finish-anti-slip' })
    expect(classifyLink('https://www.pinterest.com/ideas/marble-walk-in-shower-ideas/943134054659/').kind).toBe('url')
    expect(classifyLink('https://www.houzz.com/photos/query/Primary').kind).toBe('url')
    expect(classifyLink('https://i.pinimg.com/564x/17/7c/fc/177c.jpg')).toEqual({ kind: 'image', url: 'https://i.pinimg.com/564x/17/7c/fc/177c.jpg' })
    expect(classifyLink('https://example.com/photos/bath.webp?w=800').kind).toBe('image')
  })

  it('reads one pin: its big picture, a clean title, the source site and its color', () => {
    const pin = parsePinInfo(fx('pinterest-pin.json'))!
    expect(pin).toMatchObject({
      id: '93309023521348330',
      image: 'https://i.pinimg.com/564x/17/7c/fc/177cfc11d0dc563fcf6f576f2531de20.jpg',
      thumb: 'https://i.pinimg.com/236x/17/7c/fc/177cfc11d0dc563fcf6f576f2531de20.jpg',
      source: 'decorpad.com',
      link: 'https://www.decorpad.com/amp/photo.htm?photoId=164461',
      color: '#dadad9',
    })
    expect(pin.title).toBe('From decorpad.com') // the pin has no description
  })

  it('reads a board: its name and each picture once, with entities decoded', () => {
    const b = parseBoardPins(fx('pinterest-board.json'))!
    expect(b.board).toMatchObject({ id: '42713965155033852', name: 'marble Shower Tray finish anti-slip', count: 10 })
    expect(b.pins).toHaveLength(9) // one picture was pinned twice
    expect(b.pins.map((p) => p.source)).toContain('mandarinstone.com')
    expect(b.pins.find((p) => p.source === 'mandarinstone.com')!.title).toBe('Calacatta Honed Marble Shower Tray - £395')
    expect(b.pins[0].title.endsWith('...')).toBe(true)
    expect(b.pins.find((p) => p.source === 'salvatori.it')!.title).toBe('prodotti | salvatori | stone innovation')
    expect(b.pins.every((p) => /^https:\/\/i\.pinimg\.com\/564x\//.test(p.image) || /^https:\/\/i\.pinimg\.com\/564x\//.test(p.image))).toBe(true)
  })

  it('asks the widget endpoints and reports a private or missing board in plain words', async () => {
    const asked: string[] = []
    const got = await readPinterest({ kind: 'board', user: 'u', board: 'b' }, async (u) => (asked.push(u), fx('pinterest-board.json')))
    expect(asked).toEqual([boardPinsUrl('u', 'b')])
    expect(got.pins).toHaveLength(9)
    await expect(readPinterest({ kind: 'pin', id: '1' }, async (u) => (asked.push(u), { status: 'failure', data: [] }))).rejects.toThrow(/private or removed/)
    expect(asked.at(-1)).toBe(pinInfoUrl('1'))
    await expect(readPinterest({ kind: 'board', user: 'u', board: 'x' }, async () => ({ status: 'failure', data: null }))).rejects.toThrow(/may be private/)
  })
})

describe('palettes are sampled', () => {
  // A synthetic picture: 60 percent warm white, 30 percent walnut, 10 percent brass, with some noise.
  function picture() {
    const px: number[] = []
    const add = (n: number, c: [number, number, number]) => {
      for (let i = 0; i < n; i++) px.push(c[0] + ((i * 7) % 5) - 2, c[1] + ((i * 3) % 5) - 2, c[2] + ((i * 11) % 5) - 2, 255)
    }
    add(6000, [240, 236, 228])
    add(3000, [92, 64, 44])
    add(1000, [181, 148, 82])
    return px
  }

  it('finds the main colors with their true shares, biggest first', () => {
    const p = quantize(picture(), 4, 5)
    expect(p[0].share).toBeGreaterThan(0.55)
    const near = (hex: string, c: number[]) => {
      const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      return Math.hypot(v[0] - c[0], v[1] - c[1], v[2] - c[2]) < 8
    }
    expect(near(p[0].hex, [240, 236, 228])).toBe(true)
    expect(p.some((s) => near(s.hex, [92, 64, 44]) && Math.abs(s.share - 0.3) < 0.05)).toBe(true)
    expect(p.some((s) => near(s.hex, [181, 148, 82]))).toBe(true)
    expect(p.length).toBeLessThanOrEqual(5)
  })

  it('skips see-through pixels and handles an empty picture', () => {
    expect(quantize([0, 0, 0, 0, 10, 10, 10, 0], 4)).toEqual([])
  })

  it('ships the same quantizer to Velda\'s sandbox for pictures the page cannot read', () => {
    const s = remotePaletteScript(['https://i.pinimg.com/564x/a.jpg'])
    expect(s).toContain("import jpeg from 'npm:jpeg-js@0.4.4'")
    expect(s).toContain('const quantize = function quantize(')
    expect(s).toContain('"https://i.pinimg.com/564x/a.jpg"')
    expect(s).toContain('/tmp/output/contact-sheet.jpg')
    // The shipped function works on its own (no outside names).
    const body = s.slice(s.indexOf('const quantize = ') + 'const quantize = '.length, s.indexOf('\nconst urls = '))
    const fn = new Function(`return (${body})`)() as typeof quantize
    expect(fn(picture(), 4, 3)[0].share).toBeGreaterThan(0.55)
  })
})
