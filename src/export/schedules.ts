// Schedules (08 sections 3 and 5): rooms, doors, windows and fixtures with products. One set of
// records feeds the CSV files (decimal inches) and the PDF tables (feet and inches). Every size says
// where it came from.
import { windowClear } from '../analysis/checks'
import { roomsAcross } from '../analysis/space'
import S from '../library/standards.json'
import { pointInPolygon, polygonArea, polygonBounds } from '../model/geom'
import { type Badge, type Model, badgeOf } from '../model/types'
import { formatFeetInches } from '../model/units'

export type Col = { key: string; label: string; ft?: boolean }
export type Table = { name: string; title: string; cols: Col[]; rows: Record<string, string | number>[] }

const r2 = (v: number) => Math.round(v * 100) / 100
const BADGE: Record<Badge, string> = { measured: 'measured', traced: 'traced', assumed: 'assumed', velda: 'Velda' }

/** The lowest level is the one at grade (egress allows 5.0 sf there). */
const groundLevel = (m: Model) => [...m.levels].sort((a, b) => a.elev - b.elev)[0]?.id

export function schedules(m: Model): Table[] {
  const levelName = (id: string) => m.levels.find((l) => l.id === id)?.name ?? id
  const rooms: Table = {
    name: 'rooms',
    title: 'Rooms',
    cols: [
      { key: 'level', label: 'Level' },
      { key: 'name', label: 'Room' },
      { key: 'width_in', label: 'Width', ft: true },
      { key: 'depth_in', label: 'Depth', ft: true },
      { key: 'area_sf', label: 'Area (sf)' },
      { key: 'ceiling_in', label: 'Ceiling', ft: true },
      { key: 'ceiling_source', label: 'Ceiling from' },
      { key: 'flags', label: 'Flags' },
      { key: 'theme', label: 'Theme' },
    ],
    rows: m.rooms
      .filter((r) => r.polygon.length >= 3)
      .map((r) => {
        const b = polygonBounds(r.polygon)
        const lv = m.levels.find((l) => l.id === r.level)
        return {
          level: levelName(r.level),
          name: r.name,
          width_in: r2(b.x1 - b.x0),
          depth_in: r2(b.y1 - b.y0),
          area_sf: Math.round(polygonArea(r.polygon) / 144),
          ceiling_in: r2(r.ceiling ?? lv?.ceiling ?? 0),
          ceiling_source: r.ceiling ? 'room' : lv ? BADGE[badgeOf(lv.prov.ceiling)] : '',
          flags: r.flags.map((f) => f.replace(/_/g, ' ')).join('; '),
          theme: r.theme ? (m.themes[r.theme]?.name ?? '') : '',
        }
      }),
  }
  const wallOf = (id: string) => m.walls.find((w) => w.id === id)
  const between = (o: (typeof m.openings)[number]) => {
    const [a, c] = roomsAcross(m, o)
    return [a?.name, c?.name].filter(Boolean).join(' / ') || 'outside'
  }
  const doors: Table = {
    name: 'doors',
    title: 'Doors and openings',
    cols: [
      { key: 'id', label: 'Id' },
      { key: 'level', label: 'Level' },
      { key: 'rooms', label: 'Between' },
      { key: 'width_in', label: 'Width', ft: true },
      { key: 'height_in', label: 'Height', ft: true },
      { key: 'style', label: 'Style' },
      { key: 'swing', label: 'Swing' },
      { key: 'source', label: 'Sizes from' },
    ],
    rows: m.openings
      .filter((o) => o.kind !== 'window')
      .map((o) => {
        const w = wallOf(o.wall)
        const [left, right] = roomsAcross(m, o)
        const into = o.swing ? (o.swing.side === 'left' ? left : right) : null
        return {
          id: o.id,
          level: w ? levelName(w.level) : '',
          rooms: between(o),
          width_in: r2(o.w),
          height_in: r2(o.h),
          style: o.kind === 'opening' ? 'cased opening' : o.kind === 'garage' ? 'garage' : o.style.replace(/_/g, ' '),
          swing: o.swing ? `into ${into?.name ?? 'outside'}, hinge at the ${o.swing.hinge === 'a' ? 'start' : 'end'} of the wall` : '',
          source: `${BADGE[badgeOf(o.prov.w)]} width, ${BADGE[badgeOf(o.prov.h)]} height`,
        }
      }),
  }
  const ground = groundLevel(m)
  const windows: Table = {
    name: 'windows',
    title: 'Windows',
    cols: [
      { key: 'id', label: 'Id' },
      { key: 'level', label: 'Level' },
      { key: 'room', label: 'Room' },
      { key: 'width_in', label: 'Width', ft: true },
      { key: 'head_in', label: 'Head', ft: true },
      { key: 'sill_in', label: 'Sill', ft: true },
      { key: 'style', label: 'Style' },
      { key: 'egress', label: 'Egress' },
      { key: 'source', label: 'Sizes from' },
    ],
    rows: m.openings
      .filter((o) => o.kind === 'window')
      .map((o) => {
        const w = wallOf(o.wall)
        const c = windowClear(o)
        const need = w?.level === ground ? S.egress.netClearSf.grade : S.egress.netClearSf.code
        const egress = c.sf >= need && c.h >= S.egress.minClearHeight.code && c.w >= S.egress.minClearWidth.code && (o.sill ?? 36) <= S.egress.maxSill.code
        const assumed = badgeOf(o.prov.h) === 'assumed' || badgeOf(o.prov.sill) === 'assumed'
        return {
          id: o.id,
          level: w ? levelName(w.level) : '',
          room: between(o).replace(/ \/ outside$|^outside \/ /, ''),
          width_in: r2(o.w),
          head_in: r2(o.h),
          sill_in: r2(o.sill ?? 36),
          style: o.style.replace(/_/g, ' '),
          egress: egress ? (assumed ? 'yes, on assumed heights' : 'yes') : assumed ? 'no, on assumed heights' : 'no',
          source: `${BADGE[badgeOf(o.prov.w)]} width, ${BADGE[badgeOf(o.prov.h)]} head, ${BADGE[badgeOf(o.prov.sill)]} sill`,
        }
      }),
  }
  const items: Table = {
    name: 'items',
    title: 'Fixtures and products',
    cols: [
      { key: 'level', label: 'Level' },
      { key: 'room', label: 'Room' },
      { key: 'item', label: 'Item' },
      { key: 'kind', label: 'Kind' },
      { key: 'width_in', label: 'Width', ft: true },
      { key: 'depth_in', label: 'Depth', ft: true },
      { key: 'height_in', label: 'Height', ft: true },
      { key: 'vendor', label: 'Vendor' },
      { key: 'price', label: 'Price' },
      { key: 'link', label: 'Link' },
    ],
    rows: m.items.map((it) => {
      const room = m.rooms.find((r) => r.level === it.level && r.polygon.length >= 3 && pointInPolygon([it.x, it.y], r.polygon))
      const url = it.product?.url ?? (typeof it.props?.url === 'string' ? it.props.url : '')
      const price = it.product?.price ?? (typeof it.props?.price === 'string' ? it.props.price : '')
      let vendor = it.product?.vendor ?? ''
      if (!vendor && url) {
        try {
          vendor = new URL(url).hostname.replace(/^www\./, '')
        } catch {}
      }
      return {
        level: levelName(it.level),
        room: room?.name ?? '',
        item: it.label || it.kind.replace(/_/g, ' '),
        kind: it.kind.replace(/_/g, ' '),
        width_in: r2(it.w),
        depth_in: r2(it.d),
        height_in: r2(it.h),
        vendor,
        price: price === '' ? '' : String(price),
        link: url,
      }
    }),
  }
  return [rooms, doors, windows, items]
}

/** A CSV file: header from the column keys, decimal inches, quoted where needed. */
export function toCsv(t: Table): string {
  const q = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [t.cols.map((c) => c.key).join(','), ...t.rows.map((r) => t.cols.map((c) => q(r[c.key])).join(','))].join('\n') + '\n'
}

/** A cell as the PDF shows it: feet and inches for sizes. */
export function cellText(t: Table, c: Col, r: Record<string, string | number>): string {
  const v = r[c.key]
  if (c.ft && typeof v === 'number') return v ? formatFeetInches(v) : ''
  return v === undefined || v === null ? '' : String(v)
}
