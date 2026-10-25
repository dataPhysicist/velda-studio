import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { toDxf } from '../../src/export/dxf'
import { a2 } from '../import/a2-fixture'

// 09 Phase 8: the R12 DXF passes ezdxf's audit with zero errors (local Python in the build
// environment, not Velda's sandbox), and walls land at the house frame coordinates, y up.
describe('DXF R12', () => {
  it('passes ezdxf audit with zero errors and puts walls where the model has them', () => {
    const m = a2().result.model
    const dxf = toDxf(m, { scheme: 'As-built', version: 'v1', date: '2026-10-25' })
    expect(dxf).toContain('AC1009')
    expect(dxf).not.toMatch(/\r\n {2}0\r\n(LWPOLYLINE|DIMENSION|INSERT)\r\n/) // entity types R12 readers may not take
    const dir = mkdtempSync(path.join(tmpdir(), 'dxf-'))
    const file = path.join(dir, 'a2.dxf')
    writeFileSync(file, dxf)
    const w = m.walls.find((x) => x.exterior)!
    const script = `
import sys, json, ezdxf
doc = ezdxf.readfile(sys.argv[1])
a = doc.audit()
msp = doc.modelspace()
layers = sorted(l.dxf.name for l in doc.layers)
lines = [e for e in msp.query('LINE') if e.dxf.layer.endswith('-A-WALL-CNTR')]
ax, ay = float(sys.argv[2]), float(sys.argv[3])
hit = any(abs(e.dxf.start.x - ax) < 0.01 and abs(e.dxf.start.y - ay) < 0.01 for e in lines)
print(json.dumps({"version": doc.dxfversion, "errors": len(a.errors), "fixes": len(a.fixes), "layers": layers, "polylines": len(msp.query('POLYLINE')), "arcs": len(msp.query('ARC')), "texts": len(msp.query('TEXT')), "hit": hit}))
`
    const out = JSON.parse(execFileSync('python3', ['-I', '-c', script, file, String(w.a[0]), String(-w.a[1])], { encoding: 'utf8' }))
    expect(out.version).toBe('AC1009')
    expect(out.errors).toBe(0)
    expect(out.layers).toEqual(expect.arrayContaining(['0', 'L2-A-WALL', 'L2-A-WALL-CNTR', 'L2-A-DOOR', 'L2-A-GLAZ', 'L2-A-FLOR-IDEN', 'L2-A-ANNO-DIMS']))
    expect(out.polylines).toBeGreaterThan(70)
    expect(out.arcs).toBeGreaterThan(10)
    expect(out.texts).toBeGreaterThan(30)
    expect(out.hit).toBe(true)
  }, 60_000)
})
