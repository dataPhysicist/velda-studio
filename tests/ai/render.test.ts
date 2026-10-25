import { describe, expect, it } from 'vitest'
import { describeCamera, nearestRatio, RENDER_RUNS, renderNote, renderPrompt } from '../../src/ai/render'
import { sideWord } from '../../src/ai/summary'
import type { Theme } from '../../src/lib/theme'
import { applyOps } from '../../src/model/ops'
import { roomEdges } from '../../src/model/place'
import { IN } from '../../src/model/units'
import { a2 } from '../import/a2-fixture'

/** The A2 primary bath with a double vanity on its top wall, as in the Phase 6 run. */
function bath() {
  let m = a2().result.model
  const room = m.rooms.find((r) => r.name === 'Primary Bathroom')!
  const top = roomEdges(m, room).find((e) => sideWord(e) === 'top' && e.wall)!
  m = applyOps(m, [{ op: 'place', item: { id: 'van', kind: 'vanity', label: 'Double vanity, rift-cut white oak', w: 72, d: 22 }, room: room.id, against: top.wall!.id }], { author: 'user' }).model
  return { m, room: m.rooms.find((r) => r.id === room.id)! }
}

const theme: Theme = {
  id: 't',
  name: 'Warm Oak and Honed Marble',
  data: {
    description: 'Warm minimal bath: white oak, honed Calacatta marble, matte black fixtures.',
    palette: [
      { hex: '#e5dfdb', name: 'Warm White', role: 'walls', use: 'Wall paint outside the wet zone' },
      { hex: '#584937', name: 'Weathered Oak Brown', role: 'cabinets' },
    ],
    materials: [{ category: 'Vanity', choice: 'Rift-cut white oak double vanity' }],
    lighting: { daytime_cct: '2200K to 2700K', fixtures: 'Matte black globe sconces', avoid: 'Fluorescent' } as any,
    avoid: ['Polished chrome'],
  },
}

describe('render prompt', () => {
  it('describes the camera inside the room at eye height, and what it looks toward', () => {
    const { m, room } = bath()
    const lv = m.levels.find((l) => l.id === room.level)!
    // Standing near the bottom wall, eye height 5'-3", looking up the sheet at the vanity wall.
    const pose = { position: [740 * IN, (lv.elev + 63) * IN, 420 * IN], direction: [0, 0, -1], fov: 50, aspect: 1.5 }
    const cam = describeCamera(m, room.level, pose)
    expect(cam).toMatch(/^Camera: inside the Primary Bathroom, 5'-3" above the floor, looking straight ahead, toward the top wall, with Double vanity/)
    expect(cam).toMatch(/the lens takes in about 7\d degrees across\.$/)
  })

  it('describes the cut-away view from above by the room the view lands on', () => {
    const { m, room } = bath()
    const lv = m.levels.find((l) => l.id === room.level)!
    const down = (35 * Math.PI) / 180
    // 30 ft up and back from the bath, looking down 35 degrees up the sheet.
    const h = 360
    const back = h / Math.tan(down)
    const pose = { position: [700 * IN, (lv.elev + h) * IN, (360 + back) * IN], direction: [0, -Math.sin(down), -Math.cos(down)], fov: 45, aspect: 1 }
    expect(describeCamera(m, room.level, pose)).toMatch(/^Camera: above the Primary Bathroom, with the ceiling and near walls cut away, looking down 35 degrees, toward the top wall/)
  })

  it('is written by the app from the room, the theme, the inspiration and the camera, with N8\'s words last', () => {
    const { m, room } = bath()
    const p = renderPrompt({ model: m, room, theme, photo: false, design: false, refs: 4, camera: 'Camera: inside the Primary Bathroom.', words: 'late afternoon light' })
    expect(p).toContain('Image 1 is a simple 3D model view')
    expect(p).toContain('The last 4 images are inspiration N8 chose for this room')
    expect(p).toMatch(/The room: the Primary Bathroom, 13'-1 ?1\/4" by 12'-9 ?1\/4", ceiling 9'-0"\./)
    expect(p).toContain('In it, where image 1 shows them: Double vanity (6\'-0" by 1\'-10") against the top wall.')
    expect(p).toContain('Colors: walls Warm White #e5dfdb (Wall paint outside the wet zone); cabinets Weathered Oak Brown #584937.')
    expect(p).toContain('Materials: Vanity: Rift-cut white oak double vanity.')
    expect(p).toContain('Lighting: daytime color temperature 2200K to 2700K; fixtures Matte black globe sconces.')
    expect(p).toContain('Do not show: Polished chrome; Fluorescent.')
    expect(p.split('\n').at(-2)).toBe('N8 asked for: late afternoon light')
    expect(p).not.toMatch(/—/)
  })

  it('a photo render keeps the photo\'s camera and follows the design view', () => {
    const { m, room } = bath()
    const p = renderPrompt({ model: m, room, theme: null, photo: true, design: true, refs: 1, camera: null })
    expect(p).toContain('Image 1 is a real photo of this room as it is today')
    expect(p).toContain('Image 2 is the 3D design of the remodel')
    expect(p).toContain('The last image is inspiration')
    expect(p).not.toContain('Camera:')
  })

  it('says what a render cost and took', () => {
    expect(RENDER_RUNS.best.usd).toBeGreaterThan(RENDER_RUNS.standard.usd)
    expect(renderNote('standard', 41.4)).toBe('Standard, 1K · about $0.07 · 41 s')
    expect(renderNote('best', null)).toBe('Best quality, 2K · about $0.13')
  })

  it('asks for the shape of the view outright, nearest of the ratios the model takes', () => {
    expect(nearestRatio(1.5)).toEqual({ ratio: '3:2', w: 1536, h: 1024 })
    expect(nearestRatio(0.95)).toEqual({ ratio: '1:1', w: 1536, h: 1536 })
    expect(nearestRatio(1.78).ratio).toBe('16:9')
    expect(nearestRatio(0.66)).toEqual({ ratio: '2:3', w: 1024, h: 1536 })
  })
})
