// Test models. The v0.3 as-built is rebuilt from the repo's own sources exactly the way v0.3 built
// it: level 1 from geo_A1 (house frame), level 2 from the hand-checked list written to version
// va2plan-asbuilt. The live As-built head has 108 walls and 51 openings; this reproduces that.
import { readFileSync } from 'node:fs'
import { type StudioModel, modelFromVelda3D } from '../../src/lib/model'
import type { Geo } from '../../src/lib/plan-walls'
import type { Model, Wall } from '../../src/model/types'

const json = (p: string) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'))

export const geoA1 = json('scripts/fixtures/geo_A1.json') as Geo
export const geoA2 = json('scripts/fixtures/geo_A2.json') as Geo
export const geoA4 = json('scripts/fixtures/geo_A4.json') as Geo
export const level2HandChecked = json('scripts/plan-openings/level2-asbuilt-walls.json') as StudioModel['walls']
export const truth = json('scripts/fixtures/A2-asbuilt-level2.ground-truth.json')

const scene = {
  levels: [
    { id: 'L1', name: 'Level 1', elev: 0, height: 114 },
    { id: 'L2', name: 'Level 2', elev: 126, height: 114 },
  ],
  sheets: {
    A1: { dx: 0, dy: 0, level: 'L1', title: 'A1 As-built Level 1' },
    A2: { dx: -3.1, dy: -126, level: 'L2', title: 'A2 As-built Level 2' },
    A4: { dx: 10.3, dy: -21.8, level: 'L1', title: 'A4 Design plan Level 1' },
  },
}

export function v03AsBuilt(): StudioModel {
  const m = modelFromVelda3D({
    scene,
    geos: [
      { sheet: 'A1', level: 'L1', geo: geoA1 },
      { sheet: 'A2', level: 'L2', geo: geoA2 },
    ],
    items: [],
    ceiling: 114,
    theme: null,
  })
  m.walls = [...m.walls.filter((w) => w.level === 'L1'), ...structuredClone(level2HandChecked)]
  return m
}

/** The local preview's scheme: proposed level 1 (A4) with N8's kitchen items, as-built level 2. */
export function v03Kitchen(): StudioModel {
  return modelFromVelda3D({
    scene,
    geos: [
      { sheet: 'A4', level: 'L1', geo: geoA4 },
      { sheet: 'A2', level: 'L2', geo: geoA2 },
    ],
    items: [
      { id: 'n8-island', level: 'L1', type: 'island', label: 'Island 8x5', x: 319, y: 294.2, rot: 0, w: 96, d: 60, h: 36 },
      { id: 'n8-sink', level: 'L1', type: 'sink', label: 'Main sink (on island)', x: 319, y: 306, rot: 180, w: 33, d: 22, h: 36 },
      { id: 'n8-range', level: 'L1', type: 'range', label: 'Gas range', x: 206.3, y: 296.2, rot: 90, w: 30, d: 26, h: 36.5 },
      { id: 'n8-fridge', level: 'L1', type: 'fridge', label: 'Refrigerator column', x: 240, y: 417.2, rot: 180, w: 32, d: 26, h: 84 },
    ],
    ceiling: 114,
    theme: null,
  })
}

const P = { src: 'user' as const }
export function wall(id: string, a: [number, number], b: [number, number], t = 4, extra: Partial<Wall> = {}): Wall {
  return { id, level: 'L1', a, b, t, kind: 'wall', exterior: false, bearing: 'unknown', prov: { a: P, b: P, t: P }, ...extra }
}

/** Two rooms side by side, 10'-0" by 8'-4" each, centerlines: a box split by a middle wall. */
export function twoRooms(): Model {
  return {
    v: 2,
    units: 'in',
    project: { name: 'Test', north: null, front: null, remodelRooms: [] },
    levels: [{ id: 'L1', name: 'Level 1', elev: 0, ceiling: 108, floorThickness: 12, sheetIds: [], prov: { ceiling: P, floorThickness: P } }],
    sheets: [],
    walls: [
      wall('top', [0, 0], [240, 0], 6, { exterior: true, bearing: 'yes' }),
      wall('right', [240, 0], [240, 100], 6, { exterior: true, bearing: 'yes' }),
      wall('bottom', [240, 100], [0, 100], 6, { exterior: true, bearing: 'yes' }),
      wall('left', [0, 100], [0, 0], 6, { exterior: true, bearing: 'yes' }),
      wall('mid', [120, 0], [120, 100], 4),
    ],
    openings: [{ id: 'd1', wall: 'mid', kind: 'door', at: 50, w: 30, h: 80, style: 'swing', swing: { hinge: 'a', side: 'left' }, prov: { at: P, w: P, h: P } }],
    rooms: [
      { id: 'r1', level: 'L1', name: 'Den', polygon: [], labelAt: [60, 50], flags: [], prov: { src: 'derived' } },
      { id: 'r2', level: 'L1', name: 'Office', polygon: [], labelAt: [180, 50], flags: [], prov: { src: 'derived' } },
    ],
    items: [],
    stairs: [],
    dimensions: [],
    inspiration: [],
    theme: null,
    themes: {},
    notes: [],
    meta: {},
  }
}
