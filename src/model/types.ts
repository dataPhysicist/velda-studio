// Scene model v2: the single source of truth. Plain JSON, inches, plan frame (x right, y down the
// sheet). Every number a person might rely on carries where it came from (Prov). The Pascal scene,
// the 2D plan, exports and Velda's prompt are all compiled from this. Spec: 04-scene-model-v2.
import type { Theme } from '../lib/theme'

export type Vec = [number, number]

export type ProvSrc = 'sheet_dim' | 'sheet_vector' | 'sheet_raster' | 'field' | 'user' | 'default' | 'ai' | 'derived'
export type Prov = {
  src: ProvSrc
  conf?: number // 0..1, only meaningful for sheet_raster and ai; never shown to a person
  note?: string // "from string 19'-8\" on A2", "N8 measured 2026-10-20"
}

export type Project = {
  name: string
  address?: string
  north: number | null // degrees clockwise from sheet up; null until a person sets it
  front: 'top' | 'right' | 'bottom' | 'left' | null // which plan edge faces the street
  era?: string
  remodelRooms: string[] // room ids
}

export type Level = {
  id: string // "L1", "L2", "B1"
  name: string
  elev: number // house-frame z of finished floor
  ceiling: number // default floor to ceiling
  floorThickness: number // structure to the level above
  sheetIds: string[]
  prov: { ceiling: Prov; floorThickness: Prov }
}

export type Tint = { kind: 'demolish' | 'confirm' | 'other'; polygon: Vec[] }

export type Sheet = {
  id: string // "A2"
  file: string // Velda storage path of the PDF or image
  page: number // 1-based
  title: string
  role: 'asbuilt' | 'proposed' | 'reference'
  level: string | null
  scale: { ptPerInch: number; text: string }
  raster: { blobId: string; px: [number, number]; pxPerInch: number }
  toHouse: [number, number, number, number, number, number] // affine sheet-raster-inches -> house frame, [a b c d e f]
  tints: Tint[]
}

export type WallKind = 'wall' | 'glass' | 'half' | 'rail'
export type Bearing = 'yes' | 'no' | 'unknown'

export type Wall = {
  id: string
  level: string
  a: Vec
  b: Vec // centerline endpoints
  t: number // thickness, normalized; tMeasured keeps the traced value
  tMeasured?: number
  h?: number // overrides the level ceiling
  kind: WallKind
  exterior: boolean
  bearing: Bearing // software may set 'yes', never 'no'; only a person sets 'no'
  demolish?: boolean // marked to be demolished on the sheet
  prov: { a: Prov; b: Prov; t: Prov }
}

export type OpeningKind = 'door' | 'window' | 'opening' | 'garage'
export type OpeningStyle =
  | 'swing'
  | 'pocket'
  | 'sliding'
  | 'french'
  | 'bifold'
  | 'barn'
  | 'fixed'
  | 'casement'
  | 'double_hung'
  | 'slider'
  | 'cased'

export type Swing = { hinge: 'a' | 'b'; side: 'left' | 'right' } // hinge: end of the wall it is nearer; side: which side of a->b the leaf swings into

export type Opening = {
  id: string
  wall: string
  kind: OpeningKind
  at: number // wall start to opening center, along the centerline
  w: number // clear width for doors, unit width for windows
  h: number // head height above the floor (door default 80)
  sill?: number // windows: floor to bottom of glass
  style: OpeningStyle
  swing?: Swing
  panels?: number
  shape?: 'rectangle' | 'arch'
  label?: string
  prov: { at: Prov; w: Prov; h: Prov; sill?: Prov; swing?: Prov }
}

export type RoomFlag = 'needs_confirming' | 'to_be_demolished' | 'wet' | 'needs_name' | 'open_outline'

export type Room = {
  id: string
  level: string
  name: string
  polygon: Vec[] // interior face polygon, derived from the wall graph unless explicit
  explicit?: boolean
  ceiling?: number
  theme?: string | null
  flags: RoomFlag[]
  labelAt?: Vec
  prov: Prov
}

export const ITEM_KINDS = [
  'base_cabinet',
  'island',
  'vanity',
  'sink',
  'range',
  'cooktop',
  'dishwasher',
  'fridge',
  'oven_tower',
  'tall_cabinet',
  'wall_cabinet',
  'hood',
  'tub',
  'shower',
  'toilet',
  'bench',
  'glass',
  'beam',
  'item',
  'stove',
  'washer',
  'dryer',
  'water_heater',
  'hvac',
  'closet_rod',
  'shelf',
  'bed',
  'table',
  'sofa',
  'chair',
  'desk',
  'rug',
  'lamp',
  'plant',
  'mirror',
] as const
export type ItemKind = (typeof ITEM_KINDS)[number]

export type Anchor = { wall: string; at: number; side: 'left' | 'right' }

export type Item = {
  id: string
  level: string
  kind: ItemKind
  label: string
  x: number
  y: number
  rot: number // degrees; 0 = front faces down the sheet (+y), 90 = faces right (+x)
  w: number // along the front
  d: number
  h: number
  z?: number
  anchor?: Anchor // stays glued to the wall when the wall moves
  catalog?: string
  color?: string
  product?: { url?: string; image?: string; vendor?: string; sku?: string; price?: number; glbBlobId?: string }
  props?: Record<string, unknown>
  demolish?: boolean
  prov: Prov
}

export type Stair = {
  id: string
  level: string // the level the stair rises from
  toLevel: string
  polygon: Vec[]
  up: Vec // unit vector, direction of travel going up
  risers?: number
  prov: Prov
}

export type DimBind = { kind: 'wall_face' | 'wall_center' | 'opening_edge'; id: string; which: 'a' | 'b' | 'left' | 'right' }

export type Dimension = {
  id: string
  level: string
  a: Vec
  b: Vec // the two extension-line positions, house frame
  value: number // inches, as read or entered
  text: string // as drawn
  source: 'sheet' | 'field' | 'user' | 'auto'
  status: 'ok' | 'conflict' | 'unresolved'
  binds: DimBind[] // one per end once bound; empty while unresolved
}

export type Inspiration = {
  id: string
  kind: 'image' | 'pin' | 'board' | 'product' | 'url' | 'color'
  url?: string // the page it came from (pin, board, product)
  image?: string // Velda storage path, or the picture's own URL for pins and products
  thumb?: string // a small version for cards, when the source has one
  title?: string
  source?: string // the site it came from ("pinterest.com", "decorpad.com", "your photo")
  parent?: string // the board a pin came in with
  sampled?: { hex: string; share: number }[] // colors measured from the picture (07 section 6)
  tags: { style: string[]; palette: { hex: string; name?: string }[]; materials: string[]; fixtures: string[]; notes?: string }
  rooms: string[]
  addedBy: 'user' | 'ai'
  createdAt: string
}

export type Note = { id: string; text: string; at?: { level: string; p: Vec }; author: 'user' | 'ai'; createdAt: string; locked?: boolean }

export type Model = {
  v: 2
  units: 'in'
  project: Project
  levels: Level[]
  sheets: Sheet[]
  walls: Wall[]
  openings: Opening[]
  rooms: Room[]
  items: Item[]
  stairs: Stair[]
  dimensions: Dimension[]
  inspiration: Inspiration[]
  theme: string | null
  themes: Record<string, Theme>
  notes: Note[]
  meta: { createdFrom?: string; migratedFrom?: 1 }
}

/** Comments live in DB tables (comments, comment_replies), not in the model, so versions do not snapshot conversations. */
export type Comment = {
  id: string
  scheme_id: string
  level: string
  at: Vec
  target?: string
  body: string
  author: string
  resolved: boolean
  created_at: string
}

export type Author = 'user' | 'ai' | 'import' | 'migration'

/** The four badges a person sees. `conf` is never shown. */
export type Badge = 'measured' | 'traced' | 'assumed' | 'velda'

export function badgeOf(p: Prov | undefined): Badge {
  switch (p?.src) {
    case 'sheet_dim':
    case 'field':
    case 'user':
      return 'measured'
    case 'sheet_raster':
    case 'sheet_vector':
      return 'traced'
    case 'ai':
      return 'velda'
    default:
      return 'assumed'
  }
}

const BADGE_RANK: Record<Badge, number> = { measured: 3, traced: 2, velda: 1, assumed: 0 }
/** Derived numbers (room sizes, areas) carry the weakest badge of what they come from. */
export function weakestBadge(badges: Badge[]): Badge {
  return badges.reduce<Badge>((w, b) => (BADGE_RANK[b] < BADGE_RANK[w] ? b : w), 'measured')
}

export function emptyModel(name: string): Model {
  return {
    v: 2,
    units: 'in',
    project: { name, north: null, front: null, remodelRooms: [] },
    levels: [],
    sheets: [],
    walls: [],
    openings: [],
    rooms: [],
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
