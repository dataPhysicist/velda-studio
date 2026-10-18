// Two-level check without the full DU set (09 Phase 2 DoD): the A2 import must land on the migrated
// v0.3 level 1 (in the A2 sheet frame since Phase 1) within 3 in on the exterior. The A1 + A2 DU-set
// check waits for the A1 sheet.
import { describe, expect, it } from 'vitest'
import { alignExteriors } from '../../src/import/align'
import { migrateV1 } from '../../src/model/migrate'
import { v03AsBuilt } from '../model/fixtures'
import { a2 } from './a2-fixture'

describe('levels line up', () => {
  it('the A2 import sits on the migrated v0.3 level 1 without a shift, sharing its exterior walls within 3 in', () => {
    const l1 = migrateV1(v03AsBuilt()).model.walls.filter((w) => w.level === 'L1')
    const l2 = a2().result.model.walls
    const fit = alignExteriors(l2, l1)
    process.stderr.write(`A2 on migrated L1: shift ${fit.dx}, ${fit.dy}; ${(fit.overlap * 100).toFixed(0)} percent of level 2 exterior within 3 in\n`)
    expect(Math.hypot(fit.dx, fit.dy)).toBeLessThanOrEqual(3)
    expect(fit.overlap).toBeGreaterThan(0.3) // level 2 is smaller than level 1; the shared walls are the main block
  })

  it('finds a shift it is given', () => {
    const l2 = a2().result.model.walls
    const moved = l2.map((w) => ({ ...w, a: [w.a[0] + 37, w.a[1] - 12] as [number, number], b: [w.b[0] + 37, w.b[1] - 12] as [number, number] }))
    const fit = alignExteriors(moved, l2)
    expect([fit.dx, fit.dy]).toEqual([-37, 12])
    expect(fit.overlap).toBeGreaterThan(0.99)
  })
})
