import { describe, expect, it } from 'vitest'
import { runChecks } from '../../src/analysis/checks'
import { traceWalls } from '../../src/import/raster/trace'
import { readSheet } from '../../src/import'
import { migrateV1 } from '../../src/model/migrate'
import { applyOps } from '../../src/model/ops'
import { roomClearDims } from '../../src/plan2d/geometry'
import { planSvg } from '../../src/export/plan-svg'
import { compileScene } from '../../src/view3d/compile'
import { a2, decodePlan, page } from '../import/a2-fixture'
import { v03Kitchen } from '../model/fixtures'

// 03 section 7, the budgets that can be timed in Node (the build sandbox has two slow cores, so these
// are upper bounds for a laptop): the A2 trace under 5 s, dimension recompute under 16 ms, the 3D
// compile of one level under 100 ms per edit. Numbers go to the build log.

function time(f: () => void, n = 20) {
  f() // warm up
  const t = performance.now()
  for (let i = 0; i < n; i++) f()
  return (performance.now() - t) / n
}

describe('performance budgets', () => {
  it('traces the 29 MP A2 plan under 5 s', () => {
    const gray = decodePlan()
    const sheet = readSheet(page)
    const t = performance.now()
    traceWalls(gray, sheet.pxPerInch!)
    const ms = performance.now() - t
    console.log(`[perf] A2 trace ${Math.round(ms)} ms (${((gray.width * gray.height) / 1e6).toFixed(1)} MP)`)
    expect(ms).toBeLessThan(5000)
  }, 60_000)

  it('recomputes every room\'s clear dimensions under 16 ms, and compiles a level for 3D under 100 ms per edit', () => {
    const house = migrateV1(v03Kitchen(), { now: '2026-10-25T00:00:00Z' }).model
    const m = a2().result.model
    for (const [name, model] of [['whole migrated house', house], ['A2 level 2', m]] as const) {
      const dims = time(() => model.rooms.forEach((r) => roomClearDims(model, r)))
      const compile = time(() => compileScene(model), 10)
      const checks = time(() => runChecks(model), 5)
      const svg = time(() => planSvg(model, { level: model.levels[0].id }), 10)
      console.log(`[perf] ${name}: ${model.walls.length} walls, ${model.rooms.length} rooms; clear dims ${dims.toFixed(1)} ms, 3D compile ${compile.toFixed(1)} ms, checks ${checks.toFixed(1)} ms, plan drawing ${svg.toFixed(1)} ms`)
      expect(dims).toBeLessThan(16)
      expect(compile).toBeLessThan(100)
    }
    // An edit: move a wall and compile again.
    const w = m.walls.find((x) => !x.exterior)!
    const edit = time(() => compileScene(applyOps(m, [{ op: 'move', id: w.id, dx: 1, dy: 0 }], { author: 'user' }).model), 10)
    console.log(`[perf] A2 edit plus 3D compile ${edit.toFixed(1)} ms`)
    expect(edit).toBeLessThan(100)
  }, 120_000)
})
