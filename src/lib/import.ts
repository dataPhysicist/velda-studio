// First run: bring every Velda 3D scheme, its plan geometry, fixtures and themes into Studio.
// Also seeds the two Designs Unlimited color-plan themes (7.6.26) as library themes.

import { type StudioModel, type Velda3DItem, type Velda3DScene, modelFromVelda3D } from './model'
import type { Geo } from './plan-walls'
import type { Theme } from './theme'
import { lit, type ToolbeltSDK, V3D_DB } from '../toolbelt'

declare const __STUDIO_ASSET_BASE__: string

export type ImportedScheme = { id: string; name: string; model: StudioModel }

export function designsUnlimitedThemes(assetBase: string): Theme[] {
  const img = (f: string, name: string) => ({ url: `${assetBase}/themes/${f}`, name })
  return [
    {
      id: 'theme-du-kitchen',
      name: 'DU Kitchen: Color Plan Direction',
      data: {
        scope: 'Kitchen',
        source: 'Designs Unlimited, McKervey Color Plan Direction 7.6.26',
        description:
          'Old-world farmhouse kitchen: brick or stone floor laid in herringbone or mixed stone, light stained wood cabinetry mixed with cream painted cabinets, minimal open shelving, a plaster or stone range hood, light countertops, bronze and darker accents in hardware, windows and lighting, rustic beams across the ceiling, arched windows and French doors.',
        palette: [
          { name: 'Stained walnut', hex: '#70553C', role: 'island', use: 'Island and stained cabinetry, beams' },
          { name: 'Soft white', hex: '#ECEEED', role: 'walls', use: 'Walls, plaster hood, light cabinetry' },
          { name: 'Warm clay', hex: '#BFA695', role: 'accent', use: 'Brick and stone floor tone, terracotta accents' },
          { name: 'Cream painted', hex: '#E9E2D2', role: 'cabinets', use: 'Painted perimeter cabinets' },
          { name: 'Light stone', hex: '#F1EEE7', role: 'counters', use: 'Light countertops' },
          { name: 'Oil-rubbed bronze', hex: '#4A3B2C', role: 'metal', use: 'Hardware, window frames, lighting' },
        ],
        materials: [
          { category: 'Flooring', choice: 'Brick or stone in an interesting installation: herringbone or mixed stone placement' },
          { category: 'Cabinetry', choice: 'Light wood stained cabinetry mixed with cream painted; minimal open cabinetry' },
          { category: 'Range hood', choice: 'Plaster or stone hood' },
          { category: 'Countertops', choice: 'Light countertop material' },
          { category: 'Hardware and fixtures', choice: 'Bronze and darker accents in hardware, windows and lighting' },
          { category: 'Ceiling', choice: 'Rustic beams running across the ceiling' },
          { category: 'Openings', choice: 'Arched windows and French doors' },
        ],
        finishes: { floors: { library: 'flooring-agedbrick', note: 'brick, herringbone' } },
        images: [img('du-kitchen-1.jpg', 'Kitchen inspiration (DU)'), img('du-kitchen-2.jpg', 'Arched hood and island (DU)')],
      },
    },
    {
      id: 'theme-du-bath',
      name: 'DU Primary Bath: Color Plan Direction',
      data: {
        scope: 'Primary bath',
        source: 'Designs Unlimited, McKervey Color Plan Direction 7.6.26',
        description:
          'Light, tailored primary bath: herringbone floor (neutral or wood look), stained cabinetry and millwork, deco tile inserts in the wet room, ornate trim and wall detailing, light countertops, silver hardware and plumbing.',
        palette: [
          { name: 'Stained millwork', hex: '#8E796A', role: 'cabinets', use: 'Vanity and millwork' },
          { name: 'Warm cream', hex: '#DFDAC9', role: 'walls', use: 'Walls, ornate trim' },
          { name: 'Dusty blue', hex: '#96A7B9', role: 'accent', use: 'Deco tile inserts in the wet room' },
          { name: 'Light marble', hex: '#F1EEE8', role: 'counters', use: 'Countertops' },
          { name: 'Polished nickel', hex: '#C9C7C1', role: 'metal', use: 'Hardware and plumbing' },
        ],
        materials: [
          { category: 'Flooring', choice: 'Herringbone installation, neutral or wood look' },
          { category: 'Cabinetry', choice: 'Stained cabinetry and millwork' },
          { category: 'Wet room', choice: 'Deco tile inserts in wet room areas' },
          { category: 'Trim', choice: 'Ornate trim and wall detailing' },
          { category: 'Countertops', choice: 'Light countertop material' },
          { category: 'Hardware and plumbing', choice: 'Silver hardware and plumbing' },
        ],
        finishes: { floors: { library: 'flooring-woodparquet76', note: 'light herringbone' }, metal: { library: 'metal-polished' } },
        images: [img('du-bath-1.jpg', 'Wet room with blue deco tile (DU)'), img('du-bath-2.jpg', 'Marble harlequin shower (DU)')],
      },
    },
  ]
}

const parseJson = <T,>(v: unknown, fb: T): T => {
  if (typeof v !== 'string') return (v as T) ?? fb
  try {
    return JSON.parse(v)
  } catch {
    return fb
  }
}

/** Read Velda 3D's data through the bridge and build one Studio scheme per Velda 3D scheme. */
export async function importFromVelda3D(sdk: ToolbeltSDK, assetBase: string): Promise<{ schemes: ImportedScheme[]; themes: Theme[] }> {
  const scene = parseJson<Velda3DScene>(await sdk.readText('apps/velda-3d/data/scene.json'), null as any)
  if (!scene?.sheets) throw new Error('Velda 3D plan data was not found')
  const geoCache: Record<string, Geo> = {}
  const geo = async (sheet: string) => {
    if (!geoCache[sheet]) {
      const g = parseJson<any>(await sdk.readText(`apps/velda-3d/data/geo_${sheet}.json`), null)
      geoCache[sheet] = { walls: g?.walls ?? [], windows: g?.windows ?? [], doors: g?.doors ?? [], rooms: g?.rooms ?? [] }
    }
    return geoCache[sheet]
  }
  const variants = await sdk.sql(`SELECT id, name, l1_sheet, l2_sheet, theme_id FROM variants ORDER BY created_at`, V3D_DB)
  const items = (await sdk.sql(`SELECT id, variant, level, type, label, x, y, rot, w, d, h, z, color, props FROM items`, V3D_DB)) as (Velda3DItem & {
    variant: string
  })[]
  const v3Themes = (await sdk.sql(`SELECT id, name, data FROM themes`, V3D_DB).catch(() => [])).map((t: any) => ({
    id: t.id,
    name: t.name,
    data: parseJson(t.data, { palette: [] }),
  })) as Theme[]
  const settings = await sdk.sql(`SELECT key, value FROM settings`, V3D_DB).catch(() => [])
  const ceiling = Number(settings.find((s: any) => s.key === 'ceiling_in')?.value) || 114
  const du = designsUnlimitedThemes(assetBase)
  const all = [...v3Themes, ...du]
  const byId = Object.fromEntries(all.map((t) => [t.id, t]))
  const house = v3Themes.find((t) => !/bath/i.test(t.name)) ?? v3Themes[0] ?? null

  const schemes: ImportedScheme[] = []
  for (const v of variants) {
    const geos = []
    if (v.l1_sheet) geos.push({ sheet: v.l1_sheet, level: 'L1', geo: await geo(v.l1_sheet) })
    if (v.l2_sheet) geos.push({ sheet: v.l2_sheet, level: 'L2', geo: await geo(v.l2_sheet) })
    const vt = v.theme_id ? byId[v.theme_id] : null
    // A bath theme assigned to a whole scheme in Velda 3D becomes the primary bath's room theme.
    const bathTheme = vt && /bath/i.test(vt.name) ? vt : null
    const houseTheme = bathTheme ? house : (vt ?? house)
    const themes: Record<string, Theme> = {}
    for (const t of all) themes[t.id] = t
    const model = modelFromVelda3D({
      scene,
      geos,
      items: items.filter((i) => i.variant === v.id),
      ceiling,
      theme: houseTheme?.id ?? null,
      themes,
    })
    for (const r of model.rooms) {
      if (bathTheme && /primary bath/i.test(r.name)) r.theme = bathTheme.id
      if (/^kitchen/i.test(r.name) && v.l1_sheet === 'A4') r.theme = 'theme-du-kitchen'
    }
    schemes.push({ id: v.id, name: v.name, model })
  }
  return { schemes, themes: all }
}

export { lit }
