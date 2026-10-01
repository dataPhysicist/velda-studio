// Startup: connect to Toolbelt, open storage, import from Velda 3D on first run, open a scheme.
import { designsUnlimitedThemes, importFromVelda3D } from '../lib/import'
import { modelFromVelda3D } from '../lib/model'
import { sid } from '../lib/model'
import { DuckRepo, MemoryRepo, type Repo } from '../repo'
import { useViewer } from '@pascal-app/viewer'
import { connect } from '../toolbelt'
import { focusOn, openScheme, useStudio } from './store'

declare const __STUDIO_ASSET_BASE__: string

export async function boot() {
  const set = useStudio.setState
  const sdk = await connect()
  const repo: Repo = sdk ? new DuckRepo(sdk) : new MemoryRepo()
  set({ sdk, repo, status: sdk ? 'Connecting to your workspace' : 'Opening a local preview' })
  ;(window as any).__studio = { sdk, repo, store: useStudio, focusOn, viewer: useViewer }
  try {
    await repo.init()
    let schemes = await repo.schemes()
    if (!schemes.length) {
      set({ status: 'Bringing in your Velda 3D schemes' })
      const { schemes: imported, themes } = sdk ? await importFromVelda3D(sdk, __STUDIO_ASSET_BASE__) : await localFixture()
      for (const t of themes) await repo.saveTheme(t)
      let sort = 0
      for (const s of imported) {
        const v = { id: sid('v'), scheme_id: s.id, seq: 1, summary: 'Imported from Velda 3D', source: 'import' }
        await repo.addVersion(v, s.model)
        await repo.saveScheme({ id: s.id, name: s.name, head_version: v.id, sort: sort++ })
      }
      schemes = await repo.schemes()
    }
    set({ library: await repo.themes() })
    const last = await repo.setting('last_scheme')
    const first = schemes.find((s) => s.id === last) ?? schemes.find((s) => s.id === 'n8-kitchen') ?? schemes[0]
    await openScheme(first.id)
  } catch (e) {
    console.error('[studio] boot failed', e)
    set({ status: null, error: `Velda Studio could not start: ${(e as Error).message || e}` })
  }
}

/** Local preview without Toolbelt: a slice of the real plans so the page can be checked offline. */
async function localFixture() {
  const [a2, a4] = await Promise.all([import('../../scripts/fixtures/geo_A2.json'), import('../../scripts/fixtures/geo_A4.json')])
  const scene = {
    levels: [
      { id: 'L1', name: 'Level 1', elev: 0, height: 114 },
      { id: 'L2', name: 'Level 2', elev: 126, height: 114 },
    ],
    sheets: {
      A2: { dx: -3.1, dy: -126, level: 'L2', title: 'A2' },
      A4: { dx: 10.3, dy: -21.8, level: 'L1', title: 'A4' },
    },
  }
  const items = [
    { id: 'n8-island', level: 'L1', type: 'island', label: 'Island 8x5', x: 319, y: 294.2, rot: 0, w: 96, d: 60, h: 36 },
    { id: 'n8-sink', level: 'L1', type: 'sink', label: 'Main sink (on island)', x: 319, y: 306, rot: 180, w: 33, d: 22, h: 36 },
    { id: 'n8-counter-sink', level: 'L1', type: 'base_cabinet', label: 'Sink wall counter', x: 282.9, y: 204.4, rot: 0, w: 180.3, d: 24.7, h: 36 },
    { id: 'n8-range', level: 'L1', type: 'range', label: 'Gas range', x: 206.3, y: 296.2, rot: 90, w: 30, d: 26, h: 36.5 },
    { id: 'n8-fridge', level: 'L1', type: 'fridge', label: 'Refrigerator column', x: 240, y: 417.2, rot: 180, w: 32, d: 26, h: 84 },
    { id: 'n8-freezer', level: 'L1', type: 'fridge', label: 'Freezer column', x: 274, y: 417.2, rot: 180, w: 32, d: 26, h: 84 },
    { id: 'n8-oven', level: 'L1', type: 'oven', label: 'Double oven', x: 206.3, y: 343.2, rot: 90, w: 30, d: 26, h: 84 },
    { id: 'nb-vanity-top', level: 'L2', type: 'vanity', label: 'Vanity (top wall)', x: 664, y: 171, rot: 0, w: 84.6, d: 23.7, h: 34 },
    { id: 'nb-tub', level: 'L2', type: 'corner_tub', label: 'Jetted corner tub', x: 739, y: 197, rot: 90, w: 72.3, d: 72.9, h: 22 },
    { id: 'du-wc', level: 'L2', type: 'toilet', label: 'Toilet (WC)', x: 757.5, y: 335.4, rot: -90, w: 20, d: 28, h: 30 },
  ]
  const themes = designsUnlimitedThemes(__STUDIO_ASSET_BASE__)
  const model = modelFromVelda3D({
    scene,
    geos: [
      { sheet: 'A4', level: 'L1', geo: (a4 as any).default ?? a4 },
      { sheet: 'A2', level: 'L2', geo: (a2 as any).default ?? a2 },
    ],
    items,
    ceiling: 114,
    theme: null,
    themes: Object.fromEntries(themes.map((t) => [t.id, t])),
  })
  for (const r of model.rooms) {
    if (/^kitchen/i.test(r.name)) r.theme = 'theme-du-kitchen'
    if (/primary bath/i.test(r.name)) r.theme = 'theme-du-bath'
  }
  return { schemes: [{ id: 'n8-kitchen', name: 'Local preview', model }], themes }
}
