// The operations table: one definition that both writes the OPERATIONS section of Velda's prompt and
// checks the shape of every op before applyOps runs it, so the prompt and the validator never drift
// (07 sections 3 and 4). The rules about what an op may do to the model live in ops.ts.
import { LAYOUTS } from './arrange'
import { ITEM_KINDS } from './types'

export type FieldType = 'id' | 'ids' | 'number' | 'string' | 'bool' | 'point' | 'enum' | 'object' | 'array' | 'any' | 'number|point' | 'string|object'
export type Field = { name: string; type: FieldType; required?: boolean; values?: readonly string[]; ph?: string; /** Accepted but not offered in the prompt. */ quiet?: boolean }
export type OpDef = {
  op: string
  /** model: applyOps changes the model. action: a longer job after the reply. turn: the page handles it around the call. */
  kind: 'model' | 'action' | 'turn'
  fields: Field[]
  doc: string
  /** At least one of these fields must be given. */
  oneOf?: string[]
  /** Hand-edit and legacy ops the app uses that Velda is not told about. */
  hidden?: boolean
}

const f = (name: string, type: FieldType, ph?: string, extra: Partial<Field> = {}): Field => ({ name, type, ...(ph ? { ph } : {}), ...extra })
const req = (name: string, type: FieldType, ph?: string, extra: Partial<Field> = {}): Field => f(name, type, ph, { ...extra, required: true })
const en = (name: string, values: readonly string[], required = false): Field => ({ name, type: 'enum', values, required })

const STYLES = ['swing', 'pocket', 'sliding', 'french', 'bifold', 'barn', 'fixed', 'casement', 'double_hung', 'slider', 'cased'] as const
const OPENING_FIELDS = [
  f('at', 'number', 'IN from wall start to center'),
  f('x', 'number'),
  f('y', 'number'),
  f('w', 'number', 'IN'),
  f('h', 'number', 'IN head height'),
  f('sill', 'number', 'IN'),
  en('shape', ['rectangle', 'arch']),
  en('style', STYLES),
  en('hinge', ['a', 'b']),
  en('side', ['left', 'right']),
  f('into', 'id', 'ROOM'),
]
const ITEM_FIELDS = [f('x', 'number'), f('y', 'number'), f('rot', 'number', 'DEG'), f('w', 'number'), f('d', 'number'), f('h', 'number'), f('z', 'number')]

export const OP_TABLE: OpDef[] = [
  // Items
  {
    op: 'add_item',
    kind: 'model',
    fields: [f('id', 'id'), f('kind', 'string', 'KIND'), f('label', 'string'), f('level', 'id'), req('x', 'number'), req('y', 'number'), f('rot', 'number', 'DEG'), f('w', 'number'), f('d', 'number'), f('h', 'number'), f('z', 'number'), f('catalog', 'string'), f('props', 'object'), f('anchor', 'object', undefined, { quiet: true })],
    doc: 'adds an item where you give it; prefer place, which works out x, y and rot for you.',
  },
  {
    op: 'place',
    kind: 'model',
    fields: [f('id', 'id', 'ITEM'), f('item', 'object', '{add_item fields without x, y, rot}'), f('room', 'id', 'ROOM'), f('against', 'string', 'WALL|"longest"|"exterior"|"window"|"door"|"front"|"back"|"shared:ROOM"'), f('on', 'id', 'ITEM'), f('align', 'string|object', '"center"|"start"|"end"|{"from":"start"|"end","in":IN}'), f('offset', 'number', 'IN off the wall'), en('facing', ['out', 'back'])],
    oneOf: ['id', 'item'],
    doc: 'puts a new item (item) or an existing one (id) in a room with its back against a wall face, facing into the room, clear of doors and other items; or sets it into an island, counter or vanity with on. The app computes x, y and rot. "start" and "end" are the wall ends as listed for the room.',
  },
  { op: 'swap', kind: 'model', fields: [req('a', 'ids', 'ITEM|[ITEMS]'), req('b', 'ids', 'ITEM|[ITEMS]')], doc: 'two items, or two groups that stand together (a refrigerator tower of two columns), trade places: each one\'s back goes where the other\'s was, facing the way the other faced.' },
  { op: 'move', kind: 'model', fields: [req('id', 'id'), ...ITEM_FIELDS.slice(0, 3), f('dx', 'number'), f('dy', 'number'), f('level', 'id'), f('at', 'number'), f('dat', 'number')], doc: 'moves an item (x, y or dx, dy, rot), an opening along its wall (at or dat), or a wall sideways by dx, dy (prefer move_wall).' },
  { op: 'resize', kind: 'model', fields: [req('id', 'id', 'ITEM'), f('w', 'number'), f('d', 'number'), f('h', 'number'), f('z', 'number'), en('anchor', ['center', 'left', 'right'])], doc: 'changes an item\'s size; anchor keeps that end where it is.' },
  { op: 'update_item', kind: 'model', fields: [req('id', 'id', 'ITEM'), f('label', 'string'), f('kind', 'string', 'KIND'), f('catalog', 'string'), f('props', 'object'), ...ITEM_FIELDS], doc: 'changes an item\'s label, kind, model or props.' },
  { op: 'delete', kind: 'model', fields: [req('id', 'id')], doc: 'removes an item, wall, opening or measurement.' },
  {
    op: 'arrange',
    kind: 'model',
    fields: [req('room', 'id', 'ROOM'), en('layout', LAYOUTS, true)],
    doc: 'replaces the room\'s fixtures with a layout template sized to the room (kitchen galley, l, u, island; bath vanity_toilet_shower, double_vanity; bedroom bed_wall; laundry side_by_side) and says what it could not fit. Adjust the result with place, move or resize.',
  },
  // Walls
  {
    op: 'move_wall',
    kind: 'model',
    fields: [req('id', 'id', 'WALL'), f('by', 'number', 'IN'), f('toward', 'id', 'ROOM'), f('to', 'number', 'IN'), f('so_that', 'object', '{"room":ROOM,"clear":IN}')],
    oneOf: ['by', 'to', 'so_that'],
    doc: 'moves a wall sideways; the walls it meets stretch and rooms follow. by moves that far toward the room named in toward (negative moves away). to is the new x of an up-and-down wall or y of a side-to-side one. so_that makes that room\'s clear size across this wall equal clear.',
  },
  {
    op: 'set_dimension',
    kind: 'model',
    fields: [req('room', 'id', 'ROOM'), en('axis', ['x', 'y'], true), req('value', 'number', 'IN'), en('anchor', ['min', 'max', 'center'])],
    doc: 'makes a room\'s clear width (x, left to right) or depth (y, top to bottom) equal value by moving one wall; anchor keeps the left or top side (min, default), the right or bottom (max), or splits it (center).',
  },
  { op: 'add_wall', kind: 'model', fields: [f('id', 'id'), f('level', 'id'), req('a', 'point', '[x,y]'), req('b', 'point', '[x,y]'), f('t', 'number', 'IN'), f('h', 'number'), en('kind', ['wall', 'glass', 'half', 'rail'])], doc: 'a new wall from a to b (centerline; 4.5 thick unless t).' },
  { op: 'update_wall', kind: 'model', fields: [req('id', 'id', 'WALL'), f('a', 'point', '[x,y]'), f('b', 'point', '[x,y]'), f('t', 'number'), f('h', 'number'), en('kind', ['wall', 'glass', 'half', 'rail']), en('bearing', ['yes', 'no', 'unknown'])], doc: 'changes a wall\'s ends, thickness, height or kind. Never set bearing to "no".' },
  { op: 'split_wall', kind: 'model', fields: [req('id', 'id', 'WALL'), f('at', 'number|point', 'IN from wall start'), f('x', 'number'), f('y', 'number')], oneOf: ['at', 'x'], doc: 'makes two walls of one at that point.' },
  { op: 'join_walls', kind: 'model', fields: [req('a', 'id', 'WALL'), req('b', 'id', 'WALL')], doc: 'makes one wall of two that run in a straight line and touch.' },
  {
    op: 'open_wall',
    kind: 'model',
    fields: [req('id', 'id', 'WALL'), f('from', 'number', 'IN from wall start'), f('to', 'number', 'IN'), f('full', 'bool'), f('header', 'bool')],
    oneOf: ['full', 'from'],
    doc: 'opens a wall between two rooms with a cased opening (full: the whole wall; header false: to the ceiling). Not for outside walls (use a door or window).',
  },
  // Openings
  { op: 'add_opening', kind: 'model', fields: [req('wall', 'id', 'WALL'), f('id', 'id'), en('kind', ['door', 'window', 'opening', 'garage']), ...OPENING_FIELDS], doc: 'a door, window or cased opening in a wall (doors 80 head, windows 84 head and 36 sill unless given). Replaces what it overlaps. into names the room a door swings into.' },
  { op: 'update_opening', kind: 'model', fields: [req('id', 'id', 'OPENING'), en('kind', ['door', 'window', 'opening', 'garage']), ...OPENING_FIELDS, f('swing', 'object')], doc: 'changes an opening\'s place, size, heights or style.' },
  { op: 'replace_opening', kind: 'model', fields: [req('id', 'id', 'OPENING'), en('kind', ['door', 'window', 'opening'], true), en('style', STYLES), f('w', 'number', 'IN')], doc: 'turns a door into a cased opening, a window into a door and so on, in the same place (w widens it about its center).' },
  { op: 'set_swing', kind: 'model', fields: [req('id', 'id', 'DOOR'), en('hinge', ['a', 'b']), en('side', ['left', 'right']), f('into', 'id', 'ROOM')], oneOf: ['hinge', 'side', 'into'], doc: 'which end a door hinges at and which room it swings into.' },
  // Rooms, levels, records
  { op: 'rename_room', kind: 'model', fields: [req('id', 'id', 'ROOM'), req('name', 'string')], doc: 'renames a room.' },
  { op: 'room', kind: 'model', fields: [req('id', 'id', 'ROOM'), f('rename', 'string'), f('theme', 'any', 'THEME|null')], doc: 'renames a room or gives it its own theme (null: the house theme).' },
  { op: 'flag_room', kind: 'model', fields: [req('id', 'id', 'ROOM'), en('flag', ['needs_confirming', 'to_be_demolished', 'wet'], true), req('on', 'bool')], doc: 'marks a room as needing its numbers confirmed, to be demolished, or wet.' },
  { op: 'set_level', kind: 'model', fields: [f('id', 'id', 'LEVEL'), f('ceiling', 'number', 'IN'), f('floorThickness', 'number', 'IN')], oneOf: ['ceiling', 'floorThickness'], doc: 'a level\'s ceiling height or floor structure.' },
  { op: 'field_dimension', kind: 'model', fields: [req('a', 'point', '[x,y]'), req('b', 'point', '[x,y]'), req('value', 'number', 'IN'), f('text', 'string'), f('level', 'id')], doc: 'records a tape measurement between two wall faces; the model moves to match it (field measurements govern). Allowed on the as-built.' },
  { op: 'note', kind: 'model', fields: [req('text', 'string')], doc: 'a note on the plan. Allowed on the as-built.' },
  {
    op: 'theme',
    kind: 'model',
    fields: [f('id', 'id', 'THEME to edit (omit to create)'), f('name', 'string'), f('description', 'string'), f('scope', 'string'), f('palette', 'array', '[{"name","hex","role","use"}]'), f('materials', 'array', '[{"category","choice"}]'), f('avoid', 'array'), f('finishes', 'object', '{ROLE:{"color":"#hex"}|{"library":ID}}'), f('images', 'array', '[{"path"}]'), f('lighting', 'object'), f('apply_to', 'any', '"house"|ROOM|[...]')],
    doc: 'creates or edits a theme (colors and materials by role) and applies it.',
  },
  { op: 'house_theme', kind: 'model', fields: [req('theme', 'id', 'THEME')], doc: 'sets the theme for the whole house.' },
  // Page-level: run around the call
  { op: 'analyze', kind: 'turn', fields: [f('scope', 'id', 'ROOM|"house"')], doc: 'runs the clearance and code checks after your other ops; you get the results and write the reply from them in a second step.' },
  { op: 'propose', kind: 'turn', fields: [f('room', 'id', 'ROOM'), req('options', 'array', '[{"label":"...","ops":[...]}]')], doc: '2 or 3 design options; each becomes its own scheme branched from this one and N8 picks. Use for "what would you do here" and "show me options".' },
  { op: 'research', kind: 'turn', fields: [req('query', 'string'), en('kind', ['product', 'idea', 'code'])], doc: 'records what you searched the web for (search with web_search_exa before answering).' },
  // Longer jobs after the reply
  { op: 'render', kind: 'action', fields: [f('from', 'string', '"view"|photo path'), f('room', 'id', 'ROOM'), f('prompt', 'string'), f('refs', 'array', '[image paths or URLs]'), en('quality', ['standard', 'best'])], doc: 'a photorealistic image of the current 3D view ("view") or N8\'s own photo of the room remodeled.' },
  { op: 'make_3d', kind: 'action', fields: [req('id', 'id', 'ITEM'), f('image', 'string', 'image URL or path')], doc: 'builds a real 3D model of a product from its photo, in the item\'s place.' },
  // Hand edits and older ops the app still accepts
  { op: 'remove', kind: 'model', fields: [req('id', 'id')], doc: '', hidden: true },
  { op: 'ceiling', kind: 'model', fields: [req('h', 'number')], doc: '', hidden: true },
  { op: 'move_joint', kind: 'model', fields: [req('at', 'point'), req('to', 'point')], doc: '', hidden: true },
  { op: 'dimension', kind: 'model', fields: [req('a', 'point'), req('b', 'point'), f('value', 'number'), f('text', 'string'), f('level', 'id'), f('id', 'id')], doc: '', hidden: true },
  { op: 'merge_rooms', kind: 'model', fields: [req('keep', 'id'), req('drop', 'id'), f('name', 'string')], doc: '', hidden: true },
  { op: 'capture', kind: 'action', fields: [f('room', 'id'), f('media', 'array')], doc: '', hidden: true },
  { op: 'capture_align', kind: 'action', fields: [f('id', 'id'), f('room', 'id'), f('quarter', 'number'), f('rotation', 'number')], doc: '', hidden: true },
]

export const OPS = new Map(OP_TABLE.map((d) => [d.op, d]))
export const opKind = (op: string) => OPS.get(op)?.kind ?? 'model'

const isNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v))
const isPoint = (v: unknown) => Array.isArray(v) && v.length >= 2 && isNum(v[0]) && isNum(v[1])
const present = (v: unknown) => v !== undefined && v !== null && v !== ''

function typeOk(t: FieldType, v: unknown, values?: readonly string[]): boolean {
  switch (t) {
    case 'id':
      return typeof v === 'string' || typeof v === 'number'
    case 'ids':
      return typeof v === 'string' || typeof v === 'number' || (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' || typeof x === 'number'))
    case 'number':
      return isNum(v)
    case 'string':
      return typeof v === 'string'
    case 'bool':
      return typeof v === 'boolean' || v === 'true' || v === 'false'
    case 'point':
      return isPoint(v)
    case 'number|point':
      return isNum(v) || isPoint(v)
    case 'string|object':
      return typeof v === 'string' || (typeof v === 'object' && v !== null && !Array.isArray(v))
    case 'enum':
      return typeof v === 'string' && (!values || values.includes(v))
    case 'object':
      return typeof v === 'object' && v !== null && !Array.isArray(v)
    case 'array':
      return Array.isArray(v)
    default:
      return true
  }
}

const WORD: Record<FieldType, string> = {
  id: 'an id',
  ids: 'an id or a list of ids',
  number: 'a number of inches',
  string: 'text',
  bool: 'true or false',
  point: 'a point [x, y]',
  'number|point': 'inches or a point [x, y]',
  'string|object': 'a word or an object',
  enum: 'one of',
  object: 'an object',
  array: 'a list',
  any: 'a value',
}

/** Why an op's shape is wrong, in plain words, or null when it is fine. */
export function checkShape(op: unknown): string | null {
  if (!op || typeof op !== 'object' || typeof (op as any).op !== 'string') return 'not an operation'
  const o = op as Record<string, unknown>
  const def = OPS.get(o.op as string)
  if (!def) return `unknown operation "${o.op}"`
  for (const fd of def.fields) {
    const v = o[fd.name]
    if (!present(v)) {
      if (fd.required) return `needs ${fd.name}`
      continue
    }
    if (!typeOk(fd.type, v, fd.values)) return `${fd.name} should be ${WORD[fd.type]}${fd.values ? ` ${fd.values.join(', ')}` : ''}`
  }
  if (def.oneOf && !def.oneOf.some((k) => present(o[k]))) return `needs one of ${def.oneOf.join(', ')}`
  return null
}

/** The OPERATIONS section of Velda's prompt, one line per op, written from the table. */
export function opsPromptText(kinds: OpDef['kind'][] = ['model', 'turn', 'action']): string {
  const line = (d: OpDef) => {
    const parts = [`"op":"${d.op}"`, ...d.fields.filter((x) => !x.quiet).map(fieldText)]
    return `- {${parts.join(',')}} ${d.doc}`
  }
  return OP_TABLE.filter((d) => !d.hidden && kinds.includes(d.kind))
    .map(line)
    .join('\n')
}

function fieldText(fd: Field) {
  const ph =
    fd.ph ??
    (fd.type === 'enum'
      ? fd.values!.map((v) => `"${v}"`).join('|')
      : fd.type === 'number'
        ? 'n'
        : fd.type === 'bool'
          ? 'true|false'
          : fd.type === 'point'
            ? '[x,y]'
            : fd.type === 'string'
              ? '"..."'
              : fd.type === 'array'
                ? '[...]'
                : fd.type === 'object'
                  ? '{...}'
                  : fd.name.toUpperCase())
  return `"${fd.name}"${fd.required ? '' : '?'}:${ph}`
}

export const KIND_LIST = ITEM_KINDS.join(', ')
