import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatFeetInches, orientationOf, parseDimension, parseLength } from '../../src/import/dims'

const truth = JSON.parse(readFileSync(new URL('../../scripts/fixtures/A2-asbuilt-level2.ground-truth.json', import.meta.url), 'utf8'))
const items: { text: string; inches: number }[] = truth.dimension_strings.items

describe('dimension strings on the A2 sheet', () => {
  it('reads every one of the 98 strings to the inches the ground truth records', () => {
    expect(items).toHaveLength(98)
    const misses = items.filter((d) => parseDimension(d.text) !== d.inches)
    expect(misses).toEqual([])
    expect(items.length).toBeGreaterThanOrEqual(truth.hard_checks.dimension_strings_parsed_min)
  })

  it('reads the forms a plan uses and the quote marks PDFs use for them', () => {
    expect(parseDimension(`19'-8"`)).toBe(236)
    expect(parseDimension(`8'-1/4"`)).toBe(96.25)
    expect(parseDimension(`3'-9 3/4"`)).toBe(45.75)
    expect(parseDimension(`18'-5 1/2"`)).toBe(221.5)
    expect(parseDimension(`2'-0"`)).toBe(24)
    expect(parseDimension(`12"`)).toBe(12)
    expect(parseDimension(`9 1/2"`)).toBe(9.5)
    expect(parseDimension(`1/2"`)).toBe(0.5)
    expect(parseDimension(`19′-8″`)).toBe(236)
    expect(parseDimension(`19’–8”`)).toBe(236)
  })

  it('refuses text that is not a dimension', () => {
    for (const t of ['PRIMARY BEDROOM', 'A 2', 'Scale: 1/4"', '7.2.26', 'W', `19'-8`, '', '0"']) expect(parseDimension(t)).toBeNull()
  })

  it('treats slightly rotated text as horizontal or vertical, not diagonal', () => {
    expect(orientationOf([1, 0])).toBe('h')
    expect(orientationOf([0.999891996383667, -0.014697008766233921])).toBe('h') // the 2'-8" at the guest bedroom 2 door
    expect(orientationOf([0, -1])).toBe('v')
    expect(orientationOf([0.7071, -0.7071])).toBe('diag')
  })

  it('writes inches back as feet and inches', () => {
    expect(formatFeetInches(236)).toBe(`19'-8"`)
    expect(formatFeetInches(96.25)).toBe(`8'-0 1/4"`)
    expect(formatFeetInches(45.75)).toBe(`3'-9 3/4"`)
    expect(formatFeetInches(11.99)).toBe(`1'-0"`)
  })
})

describe('lengths a person types', () => {
  it('reads feet and inches the ways people write them, and bare numbers as inches', () => {
    const cases: [string, number | null][] = [
      [`4'`, 48],
      [`13'-2"`, 158],
      [`13' 2"`, 158],
      [`13' 2`, 158],
      ['158', 158],
      ['4 1/2', 4.5],
      [`4'-6"`, 54],
      ['36"', 36],
      ['four feet', null],
    ]
    for (const [text, inches] of cases) expect(parseLength(text), text).toBe(inches)
  })
})
