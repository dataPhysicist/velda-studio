// Themes: a palette with roles, written direction, finishes and inspiration images.
// Compatible with Velda 3D's `themes.data`, plus optional `finishes` that pin a role to a
// specific library texture or color (set by Velda when you describe a material).

export const ROLES = ['walls', 'trim', 'cabinets', 'island', 'counters', 'floors', 'accent', 'metal'] as const
export type Role = (typeof ROLES)[number]

export type PaletteEntry = { name: string; hex: string; role?: string; use?: string }
export type Finish = { color?: string; library?: string; note?: string }
export type ThemeData = {
  description?: string
  scope?: string // e.g. "Kitchen" or "Primary bath"; informational
  palette: PaletteEntry[]
  materials?: { category: string; choice: string }[]
  lighting?: { cct?: string; rules?: string }
  avoid?: string[]
  images?: { path?: string; url?: string; name?: string; type?: string }[]
  finishes?: Partial<Record<Role, Finish>>
  source?: string
}
export type Theme = { id: string; name: string; data: ThemeData; updated_at?: string }

const DEFAULTS: Record<Role, Finish> = {
  walls: { color: '#f2eee6' },
  trim: { color: '#ece6da' },
  cabinets: { color: '#e8e2d6' },
  island: { color: '#e8e2d6' },
  counters: { color: '#efece6' },
  floors: { library: 'wood-woodfine22' },
  accent: { color: '#b38b6d' },
  metal: { color: '#8c8c8c' },
}

/** Finishes Velda may pin a role to (Pascal's built-in textured materials). */
export const LIBRARY_FINISHES: Record<string, string> = {
  'flooring-woodparquet76': 'herringbone, very light white oak',
  'wood-hungarianparquet10': 'herringbone, honey oak',
  'wood-hungarianparquet2': 'herringbone, dark red mahogany',
  'wood-woodparquet65': 'basketweave parquet, honey',
  'wood-squareparquet21': 'basketweave parquet, dark',
  'wood-woodparquet14': 'wide plank, pale whitewashed oak',
  'wood-woodfine2': 'plank, pale natural wood',
  'wood-woodfine22': 'plank, light oak',
  'wood-floorplank1': 'narrow strip, honey oak',
  'wood-woodplank19': 'plank, weathered grey-brown',
  'wood-woodplank48': 'plank, medium brown',
  'wood-woodenparquet11': 'plank, dark walnut',
  'wood-finewood27': 'smooth wood (butcher block)',
  'flooring-woodenceramic3': 'wood-look tile, medium',
  'flooring-woodenceramic2': 'wood-look tile, dark',
  'flooring-agedbrick': 'brick, pale tan and worn',
  'flooring-rusticbrick': 'brick, red with light mortar',
  'flooring-weatheredbrick': 'brick, dark red',
  'flooring-wallstone1': 'flagstone, honey sandstone',
  'flooring-statuarettowhite': 'marble, white Statuario',
  'flooring-tile79': 'marble, white with grey veining',
  'flooring-tile86': 'marble checkerboard, grey and black',
  'flooring-terrazzo19': 'encaustic cement tile, blue-green floral',
  'flooring-ceramic53': 'encaustic tile, black and white pattern',
  'flooring-tiles3': 'geometric tile, black and white triangles',
  'flooring-tile20': 'large square tile, cream',
  'flooring-lightceramic24': 'large square tile, light grey',
  'flooring-darkceramic22': 'large square tile, dark slate',
  'flooring-tile85a': 'slate, black',
  'concrete-polished': 'polished concrete',
  'concrete-plaster': 'painted plaster',
  'concrete-stucco': 'white stucco',
  'metal-brass': 'brass',
  'metal-chrome': 'chrome',
  'metal-polished': 'polished nickel / steel',
  'metal-steel': 'brushed steel',
  'metal-copper': 'copper',
}

export function paletteFor(theme: Theme | null | undefined, role: Role): PaletteEntry | undefined {
  return theme?.data?.palette?.find((p) => (p.role || '').toLowerCase() === role)
}

/** What a role should look like under a theme: a library texture or a color. */
export function finishFor(theme: Theme | null | undefined, role: Role): Finish {
  const pinned = theme?.data?.finishes?.[role]
  if (pinned?.library && LIBRARY_FINISHES[pinned.library]) return pinned
  if (pinned?.color) return pinned
  const pal = paletteFor(theme, role)
  if (pal?.hex) return { color: pal.hex }
  if (role === 'island') return finishFor(theme, 'cabinets')
  if (role === 'trim') {
    const walls = paletteFor(theme, 'walls')
    if (walls?.hex) return { color: walls.hex }
  }
  return DEFAULTS[role]
}

export function swatches(theme: Theme | null | undefined): string[] {
  return (theme?.data?.palette ?? []).map((p) => p.hex).filter(Boolean).slice(0, 6)
}

/** Short text for prompts. */
export function themeBrief(theme: Theme | null | undefined): string {
  if (!theme) return '(no theme)'
  const d = theme.data || ({} as ThemeData)
  const lines = [`${theme.name}${d.scope ? ` (${d.scope})` : ''}: ${d.description ?? ''}`.trim()]
  const roles = ROLES.map((r) => {
    const f = finishFor(theme, r)
    const p = paletteFor(theme, r)
    return `${r}=${f.library ? `${f.library} (${LIBRARY_FINISHES[f.library]})` : f.color}${p?.name ? ` "${p.name}"` : ''}`
  })
  lines.push('Roles: ' + roles.join(', '))
  if (d.materials?.length) lines.push('Materials: ' + d.materials.map((m) => `${m.category}: ${m.choice}`).join('; '))
  if (d.avoid?.length) lines.push('Avoid: ' + d.avoid.join('; '))
  if (d.lighting?.rules) lines.push('Lighting: ' + d.lighting.rules)
  return lines.join('\n')
}

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'theme'
}
