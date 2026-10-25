import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrateV1 } from '../../src/model/migrate'
import { applyOps } from '../../src/model/ops'
import { a2 } from '../import/a2-fixture'
import { v03Kitchen } from '../model/fixtures'

// 08 section 5: model.json goes out with schema/model-v2.schema.json. Every model the app makes fits
// it: the A2 import, a migrated v0.3 house, and a scheme after hand edits (checked with Python's
// jsonschema, Draft 7, like the DXF and PDF checks).
describe('model schema', () => {
  it('fits the A2 import, the migrated house and an edited scheme', () => {
    const imported = a2().result.model
    const room = imported.rooms.find((r) => r.name === 'Primary Bathroom')!
    const wall = imported.walls.find((w) => !w.exterior)!
    const edited = applyOps(
      imported,
      [
        { op: 'move', id: wall.id, dx: 3, dy: 0 },
        { op: 'add_item', id: 'van', kind: 'vanity', label: 'Double vanity', x: room.polygon[0][0] + 40, y: room.polygon[0][1] + 20, w: 72, d: 22, level: room.level },
      ],
      { author: 'user' },
    ).model
    const house = migrateV1(v03Kitchen(), { now: '2026-10-25T00:00:00Z' }).model
    const dir = mkdtempSync(path.join(tmpdir(), 'schema-'))
    const files = Object.entries({ imported, edited, house }).map(([k, m]) => {
      const f = path.join(dir, `${k}.json`)
      writeFileSync(f, JSON.stringify(m))
      return f
    })
    const script = `
import sys, json, jsonschema
v = jsonschema.Draft7Validator(json.load(open(sys.argv[1])))
out = {}
for f in sys.argv[2:]:
    out[f.split('/')[-1]] = [f"{'/'.join(map(str, e.absolute_path))}: {e.message[:120]}" for e in list(v.iter_errors(json.load(open(f))))[:5]]
print(json.dumps(out))
`
    const out = JSON.parse(execFileSync('python3', ['-I', '-c', script, path.resolve('schema/model-v2.schema.json'), ...files], { encoding: 'utf8' }))
    expect(out).toEqual({ 'imported.json': [], 'edited.json': [], 'house.json': [] })
  }, 60_000)
})
