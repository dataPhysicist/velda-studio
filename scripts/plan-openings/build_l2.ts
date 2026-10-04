import { modelFromVelda3D } from '/home/claude/velda-studio/src/lib/model'
import { readFileSync, writeFileSync } from 'fs'
const a2 = JSON.parse(readFileSync('/home/claude/velda-studio/scripts/fixtures/geo_A2.json', 'utf8'))
const dx = Number(process.argv[2] ?? 0)
const scene = { levels: [{ id: 'L2', name: 'Level 2', elev: 126, height: 114 }], sheets: { A2: { dx, dy: -126, level: 'L2', title: 'A2' } } }
const m = modelFromVelda3D({ scene, geos: [{ sheet: 'A2', level: 'L2', geo: a2 }], items: [], ceiling: 114, theme: null, themes: {} } as any)
writeFileSync(process.argv[3], JSON.stringify(m))
console.log(m.walls.length, JSON.stringify(m.walls[0]), m.rooms.length)
