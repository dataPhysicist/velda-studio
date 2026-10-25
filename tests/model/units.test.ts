import { describe, expect, it } from 'vitest'
import { clipWords, productName } from '../../src/model/units'

describe('short names', () => {
  it('clips at a word break, never mid-word', () => {
    expect(clipWords('Royal Bath ERASTONE 72 x 42 low-profile stone shower base, offset drain', 60)).toBe('Royal Bath ERASTONE 72 x 42 low-profile stone shower base')
    expect(clipWords('Placed Royal Bath ERASTONE 72 x 42 low-profile stone', 40)).toBe('Placed Royal Bath ERASTONE 72 x 42')
    expect(clipWords('short', 40)).toBe('short')
  })

  it('names a product by the part before its comma, dash or bar', () => {
    expect(productName('Royal Bath ERASTONE 72 x 42 low-profile stone shower base, offset drain, Class 3 anti-slip')).toBe('Royal Bath ERASTONE 72 x 42 low-profile stone')
    expect(productName('Calacatta Honed Marble Shower Tray - £395')).toBe('Calacatta Honed Marble Shower Tray')
    expect(productName('Schluter Kerdi-Shower-LT 36 x 72 Perimeter Linear Drain Shower Tray (KSLT915/1830S)')).toBe('Schluter Kerdi-Shower-LT 36 x 72 Perimeter')
  })
})
