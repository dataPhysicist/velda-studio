// The 2D plan: the model drawn as a drafting sheet, edited with five tools (06 section 2). Every
// gesture ends in model ops saved as a version by the person; while dragging, a preview model shows
// the result live (connected walls stretch, rooms re-derive, the two affected room sizes update).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { deriveRooms, moveWall } from '../model/derive'
import { dist, pointInPolygon, wallLength } from '../model/geom'
import type { Comment, Item, Model, Opening, Vec, Wall } from '../model/types'
import { formatFeetInches } from '../model/units'
import { parseLength } from '../import/dims'
import { newId, type Op } from '../model/ops'
import { clearSelection, handEdit, notify, removeSelected, select, setTool, useEditor } from '../app/editor'
import { type Tool, useStudio } from '../app/store'
import { CARD_MIME, fileUnder } from '../app/inspiration'
import {
  across,
  along,
  dimBadge,
  leftOf,
  levelOverall,
  openingShape,
  pointOn,
  pts,
  roomAt,
  roomClearDims,
  roomLabel,
  thick,
  unit,
  wallPoly,
} from './geometry'
import { useUnderlay } from './underlay'

type View = { x: number; y: number; w: number; h: number }
type Drag =
  | { kind: 'pan'; start: Vec; view: View; client: Vec }
  | { kind: 'wall'; id: string; start: Vec; base: Model; delta: number; typed: string }
  | { kind: 'opening'; id: string; start: Vec; base: Model; at0: number; at: number }
  | { kind: 'edge'; id: string; which: 'a' | 'b'; base: Model; at: number; w: number }
  | { kind: 'item'; id: string; start: Vec; base: Model; x: number; y: number; group: string[]; copy: boolean }
  | { kind: 'joint'; at: Vec; base: Model; to: Vec }
  | { kind: 'place'; wall: string; s0: number; s1: number }

const fmt = formatFeetInches
const r1 = (v: number) => Math.round(v)
const r8 = (v: number) => Math.round(v * 8) / 8
const near = (p: Vec, q: Vec, d: number) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= d

export function Plan() {
  const model = useStudio((s) => s.model)
  return model ? <PlanView model={model} /> : null
}

function PlanView({ model }: { model: Model }) {
  const schemeId = useStudio((s) => s.schemeId)
  const levelSel = useStudio((s) => s.levelId)
  const roomId = useStudio((s) => s.roomId)
  const tool = useStudio((s) => s.tool)
  const selection = useStudio((s) => s.selection)
  const level = levelSel ?? model.levels.slice().sort((a, b) => a.elev - b.elev)[0]?.id ?? 'L1'
  const [preview, setPreview] = useState<Model | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [cursor, setCursor] = useState<{ p: Vec; client: Vec } | null>(null)
  const [drawing, setDrawing] = useState<Vec[]>([]) // wall tool
  const [measure, setMeasure] = useState<Vec | null>(null) // measure tool first point
  const [commentAt, setCommentAt] = useState<{ p: Vec; left: number; top: number } | null>(null)
  const [readout, setReadout] = useState<string | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const space = useRef(false)
  const [tbTop, setTbTop] = useState(150)
  const m = preview ?? model
  const underlay = useUnderlay(model, level)
  const [opacity, setOpacity] = useState<number | null>(null)

  // ---- view: fit the level on load and when the level changes
  /** A view showing these bounds inside the free part of the canvas (the tool strip sits on top, the view switch at the bottom). */
  const fitTo = (b: { x0: number; y0: number; x1: number; y1: number }): View => {
    const r = svg.current?.getBoundingClientRect()
    const W = r?.width || 900
    const H = r?.height || 600
    const pad = { t: 86, r: 28, b: 76, l: 50 }
    const s = Math.max((b.x1 - b.x0) / Math.max(100, W - pad.l - pad.r), (b.y1 - b.y0) / Math.max(100, H - pad.t - pad.b), 0.05)
    const cx = (b.x0 + b.x1) / 2
    const cy = (b.y0 + b.y1) / 2
    return { x: cx - (pad.l + (W - pad.l - pad.r) / 2) * s, y: cy - (pad.t + (H - pad.t - pad.b) / 2) * s, w: W * s, h: H * s }
  }
  const fit = useCallback((): View => fitTo(levelOverall(model, level) ?? { x0: 0, y0: 0, x1: 800, y1: 600 }), [model, level])
  const [view, setView] = useState<View>(fit)
  const fitKey = `${level}|${schemeId}|${tbTop}`
  // biome-ignore lint: refit only when the level changes
  useEffect(() => setView(fit()), [fitKey])

  /** A view that shows these points with a margin (double-click a room to frame it). */
  const frame = (poly: Vec[]): View => {
    const xs = poly.map((p) => p[0])
    const ys = poly.map((p) => p[1])
    const mg = 36
    return fitTo({ x0: Math.min(...xs) - mg, y0: Math.min(...ys) - mg, x1: Math.max(...xs) + mg, y1: Math.max(...ys) + mg })
  }
  // A check clicked in the Checks panel (or anything else) asks the plan to frame some points.
  const frameReq = useStudio((s) => s.frameReq)
  // biome-ignore lint: frame once per request
  useEffect(() => {
    if (frameReq && frameReq.level === level) setView(frame(frameReq.pts))
  }, [frameReq?.key, level])
  const toPlan = useCallback((client: { clientX: number; clientY: number }): Vec => {
    const el = svg.current
    const ctm = el?.getScreenCTM()
    if (!el || !ctm) return [0, 0]
    const p = new DOMPoint(client.clientX, client.clientY).matrixTransform(ctm.inverse())
    return [p.x, p.y]
  }, [])
  /** Plan inches per screen pixel at the current zoom (for tolerances that should feel the same at any zoom). */
  const perPx = useCallback(() => {
    const el = svg.current
    if (!el) return 1
    const r = el.getBoundingClientRect()
    return Math.max(view.w / r.width, view.h / r.height)
  }, [view])

  const walls = m.walls.filter((w) => w.level === level)
  const wallById = new Map(m.walls.map((w) => [w.id, w]))
  const openings = m.openings.filter((o) => wallById.get(o.wall)?.level === level)
  const rooms = m.rooms.filter((r) => r.level === level)
  const items = m.items.filter((i) => i.level === level).sort((a, b) => b.w * b.d - a.w * a.d) // small fixtures draw on top of counters
  const isSel = (kind: string, id: string) => selection.some((s) => s.kind === kind && s.id === id)
  const selRoomId = selection.find((s) => s.kind === 'room')?.id ?? roomId
  const selRoom = rooms.find((r) => r.id === selRoomId)
  const selWall = selection.length === 1 && selection[0].kind === 'wall' ? wallById.get(selection[0].id) : undefined
  const selOpening = selection.length === 1 && selection[0].kind === 'opening' ? m.openings.find((o) => o.id === selection[0].id) : undefined
  const edited = model.walls.some((w) => w.prov.a.src === 'user' || w.prov.a.src === 'ai')
  const shownOpacity = opacity ?? (edited ? 0 : 0.35)

  // ---------------------------------------------------------------- snapping
  const snapPoint = (p: Vec, from?: Vec, orth = true, onWalls = false): Vec => {
    const tol = 8 * perPx()
    // wall ends and joints first
    for (const w of walls) for (const e of [w.a, w.b]) if (near(p, e, tol)) return [e[0], e[1]]
    const q = snapGrid(p, from, orth)
    if (!onWalls) return q
    // Inside a wall's body: land on its centerline (so a new wall tees in), along the line being drawn.
    const host = walls.find((w) => Math.abs(across(w, q)) <= thick(w) / 2 + 2 * perPx() && along(w, q) > 1 && along(w, q) < wallLength(w) - 1)
    if (!host) return q
    const n = leftOf(host)
    const off = across(host, q)
    if (from) {
      const d: Vec = [q[0] - from[0], q[1] - from[1]]
      const dn = d[0] * n[0] + d[1] * n[1]
      if (Math.abs(dn) > 1e-6) {
        const k = off / dn
        return [r8(q[0] - d[0] * k), r8(q[1] - d[1] * k)]
      }
    }
    return [r8(q[0] - n[0] * off), r8(q[1] - n[1] * off)]
  }
  const snapGrid = (p: Vec, from?: Vec, orth = true): Vec => {
    let q: Vec = [Math.round(p[0]), Math.round(p[1])]
    if (from && orth) {
      const dx = q[0] - from[0]
      const dy = q[1] - from[1]
      const ang = Math.atan2(dy, dx)
      const step = Math.PI / 4
      const snapped = Math.round(ang / step) * step
      if (Math.abs(snapped - ang) < 0.12) {
        const len = Math.hypot(dx, dy)
        q = [Math.round(from[0] + Math.cos(snapped) * len), Math.round(from[1] + Math.sin(snapped) * len)]
      }
    }
    return q
  }
  /** Wall move delta snapped to 1 in, or to a nearby parallel face within 6 screen px. */
  const snapWallDelta = (w: Wall, d: number): number => {
    const tol = 6 * perPx()
    const n = leftOf(w)
    const half = thick(w) / 2
    let best = Math.round(d)
    let bestErr = tol
    for (const o of walls) {
      if (o.id === w.id) continue
      const ou = unit(o)
      if (Math.abs(ou[0] * n[0] + ou[1] * n[1]) > 0.02) continue // must be parallel
      const oc = across(w, o.a)
      for (const face of [oc - thick(o) / 2, oc + thick(o) / 2])
        for (const mine of [-half, half]) {
          const want = face - mine
          if (Math.abs(want - d) < bestErr) {
            bestErr = Math.abs(want - d)
            best = r8(want)
          }
        }
    }
    return best
  }

  // ---------------------------------------------------------------- live readouts
  /** Rooms touching a wall's faces: their size across the wall before and after. */
  const sideRooms = (base: Model, w: Wall) => {
    const n = leftOf(w)
    const mid = pointOn(w, wallLength(w) / 2)
    const probe = (k: number): Vec => [mid[0] + n[0] * (thick(w) / 2 + 6) * k, mid[1] + n[1] * (thick(w) / 2 + 6) * k]
    return [1, -1].map((k) => roomAt(base, w.level, probe(k))).filter(Boolean) as NonNullable<ReturnType<typeof roomAt>>[]
  }
  const extentAcross = (poly: Vec[], n: Vec) => {
    const v = poly.map((p) => p[0] * n[0] + p[1] * n[1])
    return Math.max(...v) - Math.min(...v)
  }

  // ---------------------------------------------------------------- pointer handling
  const targetOf = (e: React.PointerEvent | React.MouseEvent) => {
    const el = (e.target as Element).closest('[data-k]') as HTMLElement | SVGElement | null
    if (!el) return null
    return { kind: el.getAttribute('data-k')!, id: el.getAttribute('data-id')!, which: el.getAttribute('data-which') }
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = toPlan(e)
    if (e.button === 1 || e.button === 2) {
      setDrag({ kind: 'pan', start: p, view, client: [e.clientX, e.clientY] })
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      return
    }
    const t = targetOf(e)
    if (tool === 'select' || space.current) {
      if (space.current || !t || t.kind === 'room' || t.kind === 'roomname') {
        if (!space.current) {
          const r = t && (t.kind === 'room' || t.kind === 'roomname') ? m.rooms.find((x) => x.id === t.id) : roomAt(m, level, p)
          if (r) {
            select('room', r.id, e.shiftKey)
            useStudio.setState({ roomId: r.id })
          } else clearSelection()
        }
        setDrag({ kind: 'pan', start: p, view, client: [e.clientX, e.clientY] })
      } else if (t.kind === 'wall') {
        select('wall', t.id, e.shiftKey)
        setDrag({ kind: 'wall', id: t.id, start: p, base: m, delta: 0, typed: '' })
      } else if (t.kind === 'opening') {
        select('opening', t.id, e.shiftKey)
        const o = m.openings.find((x) => x.id === t.id)!
        setDrag({ kind: 'opening', id: t.id, start: p, base: m, at0: o.at, at: o.at })
      } else if (t.kind === 'edge') {
        const o = m.openings.find((x) => x.id === t.id)!
        setDrag({ kind: 'edge', id: t.id, which: t.which === 'a' ? 'a' : 'b', base: m, at: o.at, w: o.w })
      } else if (t.kind === 'item') {
        const already = selection.some((s) => s.kind === 'item' && s.id === t.id)
        if (!already || e.shiftKey) select('item', t.id, e.shiftKey)
        const it = m.items.find((x) => x.id === t.id)!
        // Dragging one of several selected items moves them together.
        const group = already && !e.shiftKey ? selection.filter((s) => s.kind === 'item' && s.id !== t.id).map((s) => s.id) : []
        setDrag({ kind: 'item', id: t.id, start: p, base: m, x: it.x, y: it.y, group, copy: e.altKey })
      } else if (t.kind === 'joint') {
        const [x, y] = t.id.split(',').map(Number)
        setDrag({ kind: 'joint', at: [x, y], base: m, to: [x, y] })
      } else if (t.kind === 'dimension' || t.kind === 'stair' || t.kind === 'comment') {
        select(t.kind, t.id, e.shiftKey)
      }
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      return
    }
    if (tool === 'wall') {
      const q = snapPoint(p, drawing[drawing.length - 1], true, true)
      if (drawing.length && near(q, drawing[drawing.length - 1], 0.5)) return
      setDrawing([...drawing, q])
      return
    }
    if (tool === 'opening') {
      const w = wallUnder(p)
      if (!w) return
      const s = Math.round(along(w, p))
      setDrag({ kind: 'place', wall: w.id, s0: s, s1: s })
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      return
    }
    if (tool === 'measure') {
      const q = snapPoint(p, undefined, false)
      if (!measure) setMeasure(q)
      else {
        const b: Vec = e.shiftKey ? (Math.abs(q[0] - measure[0]) > Math.abs(q[1] - measure[1]) ? [q[0], measure[1]] : [measure[0], q[1]]) : q
        setMeasure(null)
        if (!near(measure, b, 1)) void handEdit([{ op: 'dimension', a: measure, b, level }], `Measured ${fmt(dist(measure, b))}`)
      }
      return
    }
    if (tool === 'comment') {
      const r = (e.currentTarget as Element).getBoundingClientRect()
      setCommentAt({ p, left: e.clientX - r.left, top: e.clientY - r.top })
    }
  }

  const wallUnder = (p: Vec): Wall | undefined => {
    const tol = 6 * perPx()
    let best: { w: Wall; d: number } | undefined
    for (const w of walls) {
      const s = along(w, p)
      if (s < 0 || s > wallLength(w)) continue
      const d = Math.abs(across(w, p)) - thick(w) / 2
      if (d <= tol && (!best || d < best.d)) best = { w, d }
    }
    return best?.w
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = toPlan(e)
    setCursor({ p, client: [e.clientX, e.clientY] })
    if (!drag) return
    if (drag.kind === 'pan') {
      const k = perPx()
      setView({ ...drag.view, x: drag.view.x - (e.clientX - drag.client[0]) * k, y: drag.view.y - (e.clientY - drag.client[1]) * k })
      return
    }
    if (drag.kind === 'wall') {
      const w = drag.base.walls.find((x) => x.id === drag.id)!
      const n = leftOf(w)
      const raw = (p[0] - drag.start[0]) * n[0] + (p[1] - drag.start[1]) * n[1]
      if (Math.abs(raw) < 0.5 * perPx() * 3 && drag.delta === 0) return // a click, not a drag yet
      const d = snapWallDelta(w, raw)
      const res = moveWall(drag.base, drag.id, d, { src: 'user' })
      if (!res.ok) {
        setReadout((res as { reason: string }).reason)
        return
      }
      const next = deriveRooms(res.model)
      setPreview(next)
      setDrag({ ...drag, delta: d })
      const before = sideRooms(drag.base, w).sort((a, b) => (a.id === roomId ? -1 : b.id === roomId ? 1 : 0))
      setReadout(
        [`Moved ${fmt(Math.abs(d))}`, ...before.map((r) => {
          const after = next.rooms.find((x) => x.id === r.id)
          return `${r.name} ${fmt(extentAcross(r.polygon, n))} → ${after ? fmt(extentAcross(after.polygon, n)) : '?'}`
        })].join('   '),
      )
      return
    }
    if (drag.kind === 'opening') {
      const o = drag.base.openings.find((x) => x.id === drag.id)!
      const w = wallById.get(o.wall)!
      const L = wallLength(w)
      const at = Math.max(o.w / 2, Math.min(L - o.w / 2, Math.round(drag.at0 + along(w, p) - along(w, drag.start))))
      setPreview(withOpening(drag.base, drag.id, { at }))
      setDrag({ ...drag, at })
      setReadout(`${fmt(at - o.w / 2)} from one end · ${fmt(L - at - o.w / 2)} from the other`)
      return
    }
    if (drag.kind === 'edge') {
      const o = drag.base.openings.find((x) => x.id === drag.id)!
      const w = wallById.get(o.wall)!
      const s = along(w, p)
      const fixed = drag.which === 'a' ? o.at + o.w / 2 : o.at - o.w / 2
      const width = Math.max(12, Math.round(Math.abs(fixed - s) / 2) * 2)
      const at = drag.which === 'a' ? fixed - width / 2 : fixed + width / 2
      if (at - width / 2 < 0 || at + width / 2 > wallLength(w)) return
      setPreview(withOpening(drag.base, drag.id, { at, w: width }))
      setDrag({ ...drag, at, w: width })
      setReadout(`${fmt(width)} wide`)
      return
    }
    if (drag.kind === 'item') {
      const it = drag.base.items.find((x) => x.id === drag.id)!
      let x = Math.round(it.x + p[0] - drag.start[0])
      let y = Math.round(it.y + p[1] - drag.start[1])
      ;[x, y] = snapItemToWalls(drag.base, it, x, y, 4 * perPx() + 2)
      let next = withItem(drag.base, drag.id, { x, y })
      for (const g of drag.group) {
        const o = drag.base.items.find((q) => q.id === g)
        if (o) next = withItem(next, g, { x: o.x + x - it.x, y: o.y + y - it.y })
      }
      setPreview(next)
      setDrag({ ...drag, x, y })
      setReadout(null)
      return
    }
    if (drag.kind === 'joint') {
      const to = snapPoint(p, drag.at)
      setDrag({ ...drag, to })
      const moved = structuredClone(drag.base)
      for (const w of moved.walls) for (const k of ['a', 'b'] as const) if (near(w[k], drag.at, 0.5)) w[k] = [to[0], to[1]]
      setPreview(deriveRooms(moved))
      return
    }
    if (drag.kind === 'place') {
      const w = wallById.get(drag.wall)!
      setDrag({ ...drag, s1: Math.round(along(w, p)) })
    }
  }

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag
    setDrag(null)
    setReadout(null)
    if (!d) return
    const done = () => setPreview(null)
    if (d.kind === 'wall') {
      if (Math.abs(d.delta) < 0.0625) return done()
      const w = d.base.walls.find((x) => x.id === d.id)!
      const n = leftOf(w)
      void handEdit([{ op: 'move', id: d.id, dx: r8(n[0] * d.delta), dy: r8(n[1] * d.delta) }], `Moved a wall ${fmt(Math.abs(d.delta))}`).finally(done)
    } else if (d.kind === 'opening') {
      if (Math.abs(d.at - d.at0) < 0.5) return done()
      const o = d.base.openings.find((x) => x.id === d.id)!
      void handEdit([{ op: 'update_opening', id: d.id, at: d.at }], `Moved ${noun(o)} ${fmt(Math.abs(d.at - d.at0))}`).finally(done)
    } else if (d.kind === 'edge') {
      const o = d.base.openings.find((x) => x.id === d.id)!
      if (Math.abs(d.w - o.w) < 0.5) return done()
      void handEdit([{ op: 'update_opening', id: d.id, at: d.at, w: d.w }], `Made ${noun(o)} ${fmt(d.w)} wide`).finally(done)
    } else if (d.kind === 'item') {
      const it = d.base.items.find((x) => x.id === d.id)!
      if (it.x === d.x && it.y === d.y) return done()
      const dx = d.x - it.x
      const dy = d.y - it.y
      if (d.copy) {
        // Alt-drag leaves the original and places a copy where the drag ends.
        const its = [it, ...d.group.map((g) => d.base.items.find((q) => q.id === g)).filter(Boolean)] as Item[]
        void duplicate(its, dx, dy).finally(done)
        return
      }
      const ops: Op[] = [{ op: 'move', id: d.id, x: d.x, y: d.y }, ...d.group.map((g) => ({ op: 'move', id: g, dx, dy }))]
      void handEdit(ops, d.group.length ? `Moved ${d.group.length + 1} things ${fmt(Math.hypot(dx, dy))}` : `Moved the ${it.label.toLowerCase()} ${fmt(Math.hypot(dx, dy))}`).finally(done)
    } else if (d.kind === 'joint') {
      if (near(d.at, d.to, 0.25)) return done()
      void handEdit([{ op: 'move_joint', at: d.at, to: d.to }], 'Moved a corner').finally(done)
    } else if (d.kind === 'place') {
      const w = wallById.get(d.wall)!
      const wide = Math.abs(d.s1 - d.s0) >= 12
      const kind = w.exterior && !e.altKey ? 'window' : 'door'
      const width = wide ? Math.round(Math.abs(d.s1 - d.s0) / 2) * 2 : kind === 'window' ? useEditor.getState().windowW : useEditor.getState().doorW
      const at = wide ? (d.s0 + d.s1) / 2 : d.s0
      const before = new Set(model.openings.map((o) => o.id))
      void handEdit([{ op: 'add_opening', wall: d.wall, kind, at, w: width }], `Added a ${fmt(width)} ${kind}`).then(() => {
        const o = useStudio.getState().model?.openings.find((x) => !before.has(x.id))
        if (o) select('opening', o.id)
        setTool('select')
      })
    } else done()
  }

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const p = toPlan(e)
    const f = Math.exp(e.deltaY * 0.0015)
    const w = Math.min(4000, Math.max(30, view.w * f))
    const h = (w / view.w) * view.h
    setView({ x: p[0] - ((p[0] - view.x) * w) / view.w, y: p[1] - ((p[1] - view.y) * h) / view.h, w, h })
  }

  const finishWall = useCallback(() => {
    const pts = drawing
    setDrawing([])
    if (pts.length < 2) return
    const ops: Op[] = []
    const t = useEditor.getState().wallT
    // Ends that land on the body of a wall split it there, so the new wall tees in.
    for (const p of [pts[0], pts[pts.length - 1]]) {
      const host = model.walls.find((w) => w.level === level && Math.abs(across(w, p)) <= 0.25 && along(w, p) > 1 && along(w, p) < wallLength(w) - 1)
      if (host) ops.push({ op: 'split_wall', id: host.id, at: p })
    }
    for (let i = 1; i < pts.length; i++) ops.push({ op: 'add_wall', a: pts[i - 1], b: pts[i], t, level })
    void handEdit(ops, `Added ${pts.length - 1 === 1 ? 'a wall' : `${pts.length - 1} walls`}`)
  }, [drawing, model, level])

  // For browser tests and the console: plan inches to page pixels, and framing a room.
  useEffect(() => {
    ;(window as unknown as { __plan: unknown }).__plan = {
      toScreen: (p: Vec) => {
        const ctm = svg.current?.getScreenCTM()
        if (!ctm) return null
        const q = new DOMPoint(p[0], p[1]).matrixTransform(ctm)
        return [q.x, q.y]
      },
      frameRoom: (id: string) => {
        const r = useStudio.getState().model?.rooms.find((x) => x.id === id)
        if (r) setView(frame(r.polygon))
      },
      fit: () => setView(fit()),
      /** Center the view on a plan point at a zoom in screen pixels per inch. */
      look: (c: Vec, pxPerIn: number) => {
        const r = svg.current?.getBoundingClientRect()
        if (!r) return
        const w = r.width / pxPerIn
        const h = r.height / pxPerIn
        setView({ x: c[0] - w / 2, y: c[1] - h / 2, w, h })
      },
    }
  })
  // The title block sits over the top of the stage; the plan starts below it.
  useEffect(() => {
    const tb = document.querySelector('.stage-pane .title-block') as HTMLElement | null
    if (!tb) return
    const ro = new ResizeObserver(() => setTbTop(Math.ceil(tb.getBoundingClientRect().height)))
    ro.observe(tb)
    return () => ro.disconnect()
  }, [])
  // The plan always shows one level: the lowest when the whole house is picked.
  useEffect(() => {
    if (!levelSel && model.levels.length) useStudio.setState({ levelId: level })
  }, [levelSel, model, level])
  useEffect(() => {
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') space.current = false
    }
    window.addEventListener('keyup', up)
    return () => window.removeEventListener('keyup', up)
  }, [])

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (useEditor.getState().confirm) return
      const mod = e.metaKey || e.ctrlKey
      const st = useStudio.getState()
      const cur = st.model
      if (!cur) return
      // typing a size while dragging a wall sets that room's size exactly
      if (drag?.kind === 'wall' && /^[\d'" -/]$/.test(e.key)) {
        e.stopImmediatePropagation() // "1" and "3" here are a size, not the view keys
        setDrag({ ...drag, typed: drag.typed + e.key })
        setReadout(`Type the size, then Enter: ${drag.typed + e.key}`)
        e.preventDefault()
        return
      }
      if (drag?.kind === 'wall' && e.key === 'Enter' && drag.typed) {
        e.preventDefault()
        typedWallSize(drag)
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        // Duplicate the selected fixtures, a foot over and down.
        e.preventDefault()
        const its = st.selection.filter((x) => x.kind === 'item').map((x) => cur.items.find((i) => i.id === x.id)).filter(Boolean) as Item[]
        if (its.length) void duplicate(its, 12, 12)
        return
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        useStudio.setState({
          selection: [...cur.walls.filter((w) => w.level === level).map((w) => ({ kind: 'wall' as const, id: w.id })), ...cur.items.filter((i) => i.level === level).map((i) => ({ kind: 'item' as const, id: i.id }))],
        })
        return
      }
      if (mod) return
      const keyTool: Record<string, Tool> = { v: 'select', w: 'wall', o: 'opening', m: 'measure', c: 'comment' }
      if (keyTool[e.key.toLowerCase()] && !e.altKey) {
        setTool(keyTool[e.key.toLowerCase()])
        setDrawing([])
        setMeasure(null)
        return
      }
      if (e.key === 'Escape') {
        if (drawing.length) setDrawing(drawing.slice(0, -1))
        else if (measure) setMeasure(null)
        else if (st.tool !== 'select') setTool('select')
        else clearSelection()
        return
      }
      if (e.key === 'Enter' && st.tool === 'wall') {
        finishWall()
        return
      }
      if (e.key.toLowerCase() === 'f') {
        setView(fit())
        return
      }
      const sel = st.selection
      const flipping = sel.length === 1 && sel[0].kind === 'opening'
      if (e.key === ' ' && !flipping) {
        space.current = true
        e.preventDefault()
        return
      }
      if (!sel.length) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        void removeSelected(sel, sel.length > 1 ? `Removed ${sel.length} things` : `Removed ${describe(cur, sel[0].kind, sel[0].id)}`)
        return
      }
      const itemsSel = sel.filter((x) => x.kind === 'item').map((x) => cur.items.find((i) => i.id === x.id)).filter(Boolean) as Item[]
      if ((e.key === 'r' || e.key === 'R') && itemsSel.length > 1) {
        // A quarter turn of the group about its middle: positions turn with the fronts (rot + 90 turns +y to +x).
        const cx = itemsSel.reduce((a, i) => a + i.x, 0) / itemsSel.length
        const cy = itemsSel.reduce((a, i) => a + i.y, 0) / itemsSel.length
        const ops = itemsSel.map((i) => ({ op: 'move', id: i.id, x: r8(cx + (i.y - cy)), y: r8(cy - (i.x - cx)), rot: (i.rot + 90) % 360 }))
        void handEdit(ops, `Turned ${itemsSel.length} things a quarter turn`)
        return
      }
      const one = sel.length === 1 ? sel[0] : null
      if (!one) return
      if (e.key === ' ' && one.kind === 'opening') {
        if (e.repeat) return
        e.preventDefault()
        const o = cur.openings.find((x) => x.id === one.id)
        if (!o || o.kind !== 'door') return
        const sw = o.swing ?? { hinge: 'a', side: 'left' }
        const next = e.shiftKey ? { ...sw, side: sw.side === 'left' ? 'right' : 'left' } : { ...sw, hinge: sw.hinge === 'a' ? 'b' : 'a' }
        void handEdit([{ op: 'update_opening', id: o.id, swing: next }], e.shiftKey ? 'Flipped the door to swing the other way' : 'Moved the door hinge to the other side')
        return
      }
      if ((e.key === 'r' || e.key === 'R') && one.kind === 'item') {
        const it = cur.items.find((x) => x.id === one.id)
        if (!it) return
        void handEdit([{ op: 'update_item', id: it.id, rot: (it.rot + (e.shiftKey ? 15 : 90)) % 360 }], `Turned the ${it.label.toLowerCase()}`)
        return
      }
      const arrow: Record<string, Vec> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
      const v = arrow[e.key]
      if (v) {
        e.preventDefault()
        const step = e.shiftKey ? 12 : e.altKey ? 0.125 : 1
        const dx = v[0] * step
        const dy = v[1] * step
        if (one.kind === 'item' || one.kind === 'wall') void handEdit([{ op: 'move', id: one.id, dx, dy }], `Nudged ${describe(cur, one.kind, one.id)} ${fmt(step)}`)
        else if (one.kind === 'opening') {
          const o = cur.openings.find((x) => x.id === one.id)
          const w = o && cur.walls.find((x) => x.id === o.wall)
          if (!o || !w) return
          const u = unit(w)
          const dat = dx * u[0] + dy * u[1]
          if (Math.abs(dat) > 0.01) void handEdit([{ op: 'update_opening', id: o.id, at: o.at + dat }], `Nudged ${noun(o)} ${fmt(step)}`)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const typedWallSize = (d: Extract<Drag, { kind: 'wall' }>) => {
    const w = d.base.walls.find((x) => x.id === d.id)!
    const want = parseLength(d.typed)
    const sides = sideRooms(d.base, w)
    const room = sides.find((r) => r.id === roomId) ?? sides[0]
    if (want === null || !room) {
      notify(`Could not read “${d.typed}” as a size. Try 13'-2" or 158.`)
      setDrag(null)
      setPreview(null)
      return
    }
    const n = leftOf(w)
    const now = extentAcross(room.polygon, n)
    // which way grows this room: the room sits on the side opposite the probe sign
    const mid = pointOn(w, wallLength(w) / 2)
    const c = room.polygon.reduce<Vec>((s, q) => [s[0] + q[0] / room.polygon.length, s[1] + q[1] / room.polygon.length], [0, 0])
    const roomSide = Math.sign((c[0] - mid[0]) * n[0] + (c[1] - mid[1]) * n[1]) || 1
    const delta = -roomSide * (want - now)
    setDrag(null)
    void handEdit([{ op: 'move', id: d.id, dx: r8(n[0] * delta), dy: r8(n[1] * delta) }], `Made ${room.name} ${fmt(want)}`).finally(() => setPreview(null))
  }

  // ---------------------------------------------------------------- render
  // The rooms, walls, openings and stairs do not change with the zoom, so a pan or zoom reuses them
  // and only the text sized for the screen is drawn again (03 section 7: 60 fps with 200 walls).
  const selKey = selection.map((x) => `${x.kind}:${x.id}`).join(',')
  // biome-ignore lint: the layer follows the model, the level and the selected room
  const roomLayer = useMemo(
    () => (
      <g className="rooms">
        {rooms.map((r) =>
          r.polygon.length >= 3 ? (
            <polygon key={r.id} points={pts(r.polygon)} data-k="room" data-id={r.id} className={`room${r.id === selRoomId ? ' is-sel' : ''}${r.flags.includes('needs_confirming') ? ' is-confirm' : ''}`} />
          ) : null,
        )}
      </g>
    ),
    [m, level, selRoomId],
  )
  // biome-ignore lint: the layer follows the model, the level and the selection
  const buildLayer = useMemo(
    () => (
      <>
        <g className="walls">
          {walls.map((w) => (
            <polygon
              key={w.id}
              points={pts(wallPoly(w))}
              data-k="wall"
              data-id={w.id}
              className={`wall${w.exterior ? ' is-ext' : ''}${w.demolish ? ' is-demolish' : ''}${isSel('wall', w.id) ? ' is-sel' : ''}${w.kind !== 'wall' ? ` kind-${w.kind}` : ''}`}
            />
          ))}
        </g>
        <g className="openings">
          {openings.map((o) => (
            <OpeningShapeView key={o.id} o={o} w={wallById.get(o.wall)!} sel={isSel('opening', o.id)} />
          ))}
        </g>
        <g className="stairs">
          {m.stairs
            .filter((s) => s.level === level || s.toLevel === level)
            .map((s) => (
              <polygon key={s.id} points={pts(s.polygon)} data-k="stair" data-id={s.id} className={`stair${isSel('stair', s.id) ? ' is-sel' : ''}`} />
            ))}
        </g>
      </>
    ),
    [m, level, selKey],
  )
  // Where each room's name sits (the point farthest from its walls) does not change with the zoom either.
  // biome-ignore lint: follows the model and the level
  const labels = useMemo(() => new Map(rooms.filter((r) => r.polygon.length >= 3).map((r) => [r.id, roomLabel(r)])), [m, level])
  const k = perPx()
  const ghost = tool === 'opening' && cursor && !drag ? ghostOpening(wallUnder(cursor.p), cursor.p) : null
  const overall = levelOverall(m, level)
  return (
    <div className={`plan tool-${tool}${drag?.kind === 'pan' ? ' is-panning' : ''}`} data-testid="plan" style={{ top: tbTop }}>
      <ToolStrip tool={tool} onPick={(t) => {
        setTool(t)
        setDrawing([])
        setMeasure(null)
      }} />
      <svg
        ref={svg}
        className="plan-svg"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={(e) => {
          if (tool === 'wall') return finishWall()
          if (tool !== 'select') return
          // Pointer capture retargets the click to the svg, so look at what is under the pointer.
          const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-k]')
          const kind = el?.getAttribute('data-k')
          const id = el?.getAttribute('data-id')
          if (kind === 'roomname' && id) {
            select('room', id)
            useStudio.setState({ roomId: id })
            requestAnimationFrame(() => {
              const input = document.getElementById('ctx-room-name') as HTMLInputElement | null
              input?.focus()
              input?.select()
            })
            return
          }
          const r = kind === 'room' && id ? m.rooms.find((x) => x.id === id) : roomAt(m, level, toPlan(e))
          if (r) setView(frame(r.polygon))
        }}
        onWheel={onWheel}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(CARD_MIME)) e.preventDefault()
        }}
        onDrop={(e) => {
          // An inspiration card dropped on a room is filed under it.
          const id = e.dataTransfer.getData(CARD_MIME)
          if (!id) return
          e.preventDefault()
          const room = roomAt(model, level, toPlan(e))
          if (room) void fileUnder(id, room.id)
          else notify('Drop the card inside a room to file it there.')
        }}
        onContextMenu={(e) => e.preventDefault()}
        role="application"
        aria-label={`Plan of ${model.levels.find((l) => l.id === level)?.name ?? level}`}
      >
        <defs>
          <pattern id="hatch-red" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" className="hatch-bg" />
            <line x1="0" y1="0" x2="0" y2="4" className="hatch-line" />
          </pattern>
        </defs>
        {underlay && shownOpacity > 0 && (
          <image href={underlay.url} x={0} y={0} width={underlay.w} height={underlay.h} opacity={shownOpacity} preserveAspectRatio="none" transform={underlay.transform} className="underlay" />
        )}
        {roomLayer}
        <g className="items">
          {items.map((it) => (
            <ItemShape key={it.id} it={it} sel={isSel('item', it.id)} k={k} />
          ))}
        </g>
        {buildLayer}
        {/* the person's own measurements, and any drawn dimension in conflict */}
        <g className="dims">
          {m.dimensions
            .filter((d) => d.level === level && (d.source === 'user' || d.source === 'field' || d.status === 'conflict'))
            .map((d) => {
              const mid: Vec = [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2]
              const vertical = Math.abs(d.b[1] - d.a[1]) > Math.abs(d.b[0] - d.a[0])
              const badge = dimBadge(m, d)
              return (
                <g key={d.id} data-k="dimension" data-id={d.id} className={`dim b-${badge}${isSel('dimension', d.id) ? ' is-sel' : ''}`}>
                  <line x1={d.a[0]} y1={d.a[1]} x2={d.b[0]} y2={d.b[1]} />
                  <text x={mid[0]} y={mid[1] - 2.5 * k} transform={vertical ? `rotate(-90 ${mid[0]} ${mid[1]})` : undefined} style={{ fontSize: 11 * k }}>
                    {d.text}
                  </text>
                </g>
              )
            })}
        </g>
        {selRoom && (
          <g className="clear-dims" aria-hidden="true">
            {roomClearDims(m, selRoom).map((c, i) => (
              <text key={i} x={c.at[0]} y={c.at[1]} className={`cd b-${c.badge}`} transform={c.vertical ? `rotate(-90 ${c.at[0]} ${c.at[1]})` : undefined} style={{ fontSize: 12 * k }}>
                {c.text}
              </text>
            ))}
          </g>
        )}
        {overall && (
          <g className="overall" aria-hidden="true">
            <line x1={overall.x0} y1={overall.y0 - 14 * k} x2={overall.x1} y2={overall.y0 - 14 * k} />
            <text x={(overall.x0 + overall.x1) / 2} y={overall.y0 - 18 * k} style={{ fontSize: 11 * k }}>
              {fmt(overall.x1 - overall.x0)}
            </text>
            <line x1={overall.x0 - 14 * k} y1={overall.y0} x2={overall.x0 - 14 * k} y2={overall.y1} />
            <text x={overall.x0 - 18 * k} y={(overall.y0 + overall.y1) / 2} transform={`rotate(-90 ${overall.x0 - 18 * k} ${(overall.y0 + overall.y1) / 2})`} style={{ fontSize: 11 * k }}>
              {fmt(overall.y1 - overall.y0)}
            </text>
          </g>
        )}
        <g className="room-names">
          {rooms.map((r) => {
            if (r.polygon.length < 3) return null
            const l0 = labels.get(r.id) ?? roomLabel(r)
            const l = { ...l0, at: clearOfItems(l0.at, r.polygon, items, l0.name.length * 7.5 * k, 30 * k) }
            return (
              <text key={r.id} x={l.at[0]} y={l.at[1]} data-k="roomname" data-id={r.id} className={`room-name${r.id === selRoomId ? ' is-sel' : ''}`} style={{ fontSize: 13 * k }}>
                <tspan x={l.at[0]}>{l.name}</tspan>
                <tspan x={l.at[0]} dy={15 * k} className="room-area" style={{ fontSize: 11 * k }}>
                  {l.area}
                </tspan>
              </text>
            )
          })}
        </g>
        {/* handles */}
        {selWall && tool === 'select' && (
          <g className="handles">
            {[selWall.a, selWall.b].map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={5 * k} data-k="joint" data-id={`${p[0]},${p[1]}`} className="handle" />
            ))}
          </g>
        )}
        {selOpening && tool === 'select' && wallById.get(selOpening.wall) && (
          <g className="handles">
            {(['a', 'b'] as const).map((which) => {
              const w = wallById.get(selOpening.wall)!
              const p = pointOn(w, selOpening.at + (which === 'a' ? -1 : 1) * (selOpening.w / 2))
              return <rect key={which} x={p[0] - 4 * k} y={p[1] - 4 * k} width={8 * k} height={8 * k} data-k="edge" data-id={selOpening.id} data-which={which} className="handle" />
            })}
          </g>
        )}
        {ghost && <OpeningShapeView o={ghost.o} w={ghost.w} sel={false} ghost />}
        {drag?.kind === 'place' && (() => {
          const w = wallById.get(drag.wall)!
          return <line x1={pointOn(w, drag.s0)[0]} y1={pointOn(w, drag.s0)[1]} x2={pointOn(w, drag.s1)[0]} y2={pointOn(w, drag.s1)[1]} className="placing" />
        })()}
        {tool === 'wall' && drawing.length > 0 && (
          <polyline points={pts([...drawing, ...(cursor ? [snapPoint(cursor.p, drawing[drawing.length - 1], true, true)] : [])])} className="drawing" style={{ strokeWidth: useEditor.getState().wallT }} />
        )}
        {tool === 'measure' && measure && cursor && <line x1={measure[0]} y1={measure[1]} x2={snapPoint(cursor.p, undefined, false)[0]} y2={snapPoint(cursor.p, undefined, false)[1]} className="measuring" />}
        <CommentPins level={level} k={k} />
      </svg>
      {readout && cursor && (
        <div className="readout" style={{ left: cursor.client[0] - (svg.current?.getBoundingClientRect().left ?? 0) + 16, top: cursor.client[1] - (svg.current?.getBoundingClientRect().top ?? 0) + 16 }} role="status">
          {readout}
        </div>
      )}
      {tool === 'wall' && drawing.length > 0 && cursor && (
        <div className="readout" style={{ left: cursor.client[0] - (svg.current?.getBoundingClientRect().left ?? 0) + 16, top: cursor.client[1] - (svg.current?.getBoundingClientRect().top ?? 0) + 16 }}>
          {fmt(dist(drawing[drawing.length - 1], snapPoint(cursor.p, drawing[drawing.length - 1], true, true)))} · Enter or double-click to finish
        </div>
      )}
      {commentAt && <CommentBox at={commentAt.p} left={commentAt.left} top={commentAt.top} level={level} onDone={() => setCommentAt(null)} />}
      <div className="plan-foot">
        {underlay && (
          <label className="underlay-ctl">
            <span>Drawing underneath</span>
            <input type="range" min={0} max={0.8} step={0.05} value={shownOpacity} onChange={(e) => setOpacity(Number(e.target.value))} />
          </label>
        )}
        {cursor && (
          <span className="coords">
            x {fmt(cursor.p[0])} y {fmt(cursor.p[1])}
          </span>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ pieces

const TOOLS: { id: Tool; name: string; key: string; hint: string; icon: React.ReactNode }[] = [
  {
    id: 'select',
    name: 'Select',
    key: 'V',
    hint: '',
    icon: <path d="M5 3l10 6.5-4.4 1.1L13 15.5l-2 1-2.4-4.9L5 14.5z" />,
  },
  {
    id: 'wall',
    name: 'Wall',
    key: 'W',
    hint: 'Click to start a wall and again at each corner. Enter or double-click finishes, Esc takes back the last corner.',
    icon: <path d="M3 13h9V5h5v3h-2v7H3z" />,
  },
  {
    id: 'opening',
    name: 'Opening',
    key: 'O',
    hint: 'Click a wall for a door, or a window on an outside wall (their usual widths are in Settings). Drag along the wall to set the width. Alt-click puts a door in an outside wall.',
    icon: (
      <>
        <path d="M3 16h3M14 16h3M6 16V5" className="ic-line" />
        <path d="M6 5a11 11 0 0 1 11 11" className="ic-arc" />
      </>
    ),
  },
  {
    id: 'measure',
    name: 'Measure',
    key: 'M',
    hint: 'Click two points to leave a measurement on the plan. Hold Shift to keep it straight.',
    icon: <path d="M2.5 12.5l10-10 5 5-10 10zM6 9l1.5 1.5M8.5 6.5l1.5 1.5M11 4l1.5 1.5" className="ic-line" />,
  },
  {
    id: 'comment',
    name: 'Comment',
    key: 'C',
    hint: 'Click where the note belongs, type it, and pin it.',
    icon: <path d="M3 4h14v9H9l-4 3.5V13H3z" className="ic-line" />,
  },
]

function ToolStrip({ tool, onPick }: { tool: Tool; onPick: (t: Tool) => void }) {
  const hint = TOOLS.find((t) => t.id === tool)?.hint
  return (
    <div className="tool-wrap">
      <div className="tool-strip" role="toolbar" aria-label="Plan tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tool === t.id}
            title={`${t.name} (${t.key})`}
            data-tool={t.id}
            onClick={(e) => {
              onPick(t.id)
              e.currentTarget.blur() // Space flips doors; it must not press this button again
            }}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              {t.icon}
            </svg>
            <span>{t.name}</span>
          </button>
        ))}
      </div>
      {hint && <p className="tool-hint">{hint}</p>}
    </div>
  )
}

/** Copies of fixtures moved by dx, dy; the copies end up selected. */
async function duplicate(its: Item[], dx: number, dy: number) {
  const ids = its.map(() => newId('i'))
  const ops: Op[] = its.map((it, i) => {
    const { id: _id, prov: _p, anchor: _a, ...rest } = it
    return { op: 'add_item', ...rest, id: ids[i], x: it.x + dx, y: it.y + dy }
  })
  await handEdit(ops, its.length === 1 ? `Copied the ${its[0].label.toLowerCase()}` : `Copied ${its.length} things`)
  const have = new Set(useStudio.getState().model?.items.map((i) => i.id))
  useStudio.setState({ selection: ids.filter((id) => have.has(id)).map((id) => ({ kind: 'item' as const, id })) })
}

const noun = (o: Opening) => (o.kind === 'window' ? 'the window' : o.kind === 'opening' ? 'the opening' : 'the door')

function describe(m: Model, kind: string, id: string) {
  if (kind === 'wall') return 'a wall'
  if (kind === 'opening') {
    const o = m.openings.find((x) => x.id === id)
    return o ? noun(o) : 'an opening'
  }
  if (kind === 'item') return `the ${(m.items.find((x) => x.id === id)?.label ?? 'item').toLowerCase()}`
  if (kind === 'dimension') return 'a measurement'
  return 'it'
}

function withOpening(m: Model, id: string, patch: Partial<Opening>): Model {
  return { ...m, openings: m.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)) }
}
function withItem(m: Model, id: string, patch: Partial<Item>): Model {
  return { ...m, items: m.items.map((o) => (o.id === id ? { ...o, ...patch } : o)) }
}

/** Footprint box of an item on the plan (rotated to the nearest axis). */
function itemBox(it: Item) {
  const yaw = (it.rot * Math.PI) / 180
  const hx = Math.abs(Math.cos(yaw)) * (it.w / 2) + Math.abs(Math.sin(yaw)) * (it.d / 2)
  const hy = Math.abs(Math.sin(yaw)) * (it.w / 2) + Math.abs(Math.cos(yaw)) * (it.d / 2)
  return { x0: it.x - hx, y0: it.y - hy, x1: it.x + hx, y1: it.y + hy }
}

/** Move a room's name off a fixture it would sit on (an island in the middle of a kitchen). */
function clearOfItems(at: Vec, poly: Vec[], items: Item[], w: number, h: number): Vec {
  const boxes = items.map(itemBox)
  const hits = (p: Vec) => boxes.some((b) => p[0] + w / 2 > b.x0 && p[0] - w / 2 < b.x1 && p[1] + h * 0.6 > b.y0 && p[1] - h * 0.4 < b.y1)
  if (!hits(at)) return at
  const b = boxes.find((x) => at[0] + w / 2 > x.x0 && at[0] - w / 2 < x.x1 && at[1] + h * 0.6 > x.y0 && at[1] - h * 0.4 < x.y1)!
  const tries: Vec[] = [
    [at[0], b.y0 - h * 0.7],
    [at[0], b.y1 + h * 0.5],
    [b.x0 - w / 2 - 4, at[1]],
    [b.x1 + w / 2 + 4, at[1]],
  ]
  return tries.find((p) => pointInPolygon(p, poly) && !hits(p)) ?? at
}

/** Snap an item so its back (or a side) sits flush on a nearby wall face. */
function snapItemToWalls(m: Model, it: Item, x: number, y: number, tol: number): [number, number] {
  const yaw = (it.rot * Math.PI) / 180
  // footprint half extents along x and y of the plan
  const hx = Math.abs(Math.cos(yaw)) * (it.w / 2) + Math.abs(Math.sin(yaw)) * (it.d / 2)
  const hy = Math.abs(Math.sin(yaw)) * (it.w / 2) + Math.abs(Math.cos(yaw)) * (it.d / 2)
  let sx = x
  let sy = y
  let bx = tol
  let by = tol
  for (const w of m.walls) {
    if (w.level !== it.level) continue
    const horizontal = Math.abs(w.a[1] - w.b[1]) < 0.01
    const vertical = Math.abs(w.a[0] - w.b[0]) < 0.01
    const t = thick(w) / 2
    if (horizontal) {
      const lo = Math.min(w.a[0], w.b[0])
      const hi = Math.max(w.a[0], w.b[0])
      if (x < lo - hx || x > hi + hx) continue
      for (const face of [w.a[1] - t, w.a[1] + t])
        for (const edge of [y - hy, y + hy]) {
          const d = face - edge
          if (Math.abs(d) < by) {
            by = Math.abs(d)
            sy = y + d
          }
        }
    } else if (vertical) {
      const lo = Math.min(w.a[1], w.b[1])
      const hi = Math.max(w.a[1], w.b[1])
      if (y < lo - hy || y > hi + hy) continue
      for (const face of [w.a[0] - t, w.a[0] + t])
        for (const edge of [x - hx, x + hx]) {
          const d = face - edge
          if (Math.abs(d) < bx) {
            bx = Math.abs(d)
            sx = x + d
          }
        }
    }
  }
  return [Math.round(sx * 8) / 8, Math.round(sy * 8) / 8]
}

function ghostOpening(w: Wall | undefined, p: Vec): { o: Opening; w: Wall } | null {
  if (!w) return null
  const kind = w.exterior ? 'window' : 'door'
  const width = kind === 'window' ? useEditor.getState().windowW : useEditor.getState().doorW
  const L = wallLength(w)
  if (L < width) return null
  const at = Math.max(width / 2, Math.min(L - width / 2, Math.round(along(w, p))))
  return { w, o: { id: 'ghost', wall: w.id, kind, at, w: width, h: 80, style: kind === 'window' ? 'double_hung' : 'swing', ...(kind === 'door' ? { swing: { hinge: 'a', side: 'left' } } : {}), prov: { at: { src: 'user' }, w: { src: 'user' }, h: { src: 'default' } } } }
}

function OpeningShapeView({ o, w, sel, ghost }: { o: Opening; w: Wall; sel: boolean; ghost?: boolean }) {
  if (!w) return null
  const s = openingShape(o, w)
  return (
    <g data-k={ghost ? undefined : 'opening'} data-id={ghost ? undefined : o.id} className={`op op-${o.kind} st-${o.style}${sel ? ' is-sel' : ''}${ghost ? ' is-ghost' : ''}`}>
      <polygon points={pts(s.gap)} className="op-gap" />
      {s.lines.map(([p, q], i) => (
        <line key={i} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} />
      ))}
      {s.dashed?.map(([p, q], i) => (
        <line key={`d${i}`} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} className="op-jamb" />
      ))}
      {s.arc && <path d={s.arc} className="op-arc" />}
    </g>
  )
}

/** Words in a fixture's own name that say what it is, by kind ("Sink wall counter" is a counter). */
const FAMILY: Record<string, string[]> = {
  base_cabinet: ['counter', 'cabinets', 'cabinet', 'base'],
  fridge: ['refrigerator', 'fridge', 'freezer'],
  sink: ['sink'],
  range: ['range', 'stove'],
  stove: ['range', 'stove'],
  oven_tower: ['oven', 'ovens'],
  island: ['island'],
  vanity: ['vanity'],
  tub: ['tub', 'bath'],
  toilet: ['toilet', 'wc'],
}
const VOCAB = new Set(['counter', 'cabinet', 'cabinets', 'pantry', 'island', 'vanity', 'sink', 'range', 'stove', 'cooktop', 'oven', 'ovens', 'dishwasher', 'refrigerator', 'fridge', 'freezer', 'tub', 'shower', 'toilet', 'washer', 'dryer', 'bed', 'table', 'sofa', 'desk', 'chair', 'bench'])

/** One word for a fixture when its full name does not fit on the plan. */
const KIND_WORD: Record<string, string> = {
  base_cabinet: 'Counter',
  island: 'Island',
  vanity: 'Vanity',
  sink: 'Sink',
  range: 'Range',
  cooktop: 'Cooktop',
  dishwasher: 'DW',
  fridge: 'Fridge',
  oven_tower: 'Oven',
  tall_cabinet: 'Tall',
  wall_cabinet: 'Upper',
  tub: 'Tub',
  shower: 'Shower',
  toilet: 'WC',
  washer: 'W',
  dryer: 'D',
  water_heater: 'WH',
  bed: 'Bed',
  table: 'Table',
  sofa: 'Sofa',
  desk: 'Desk',
}

function ItemShape({ it, sel, k }: { it: Item; sel: boolean; k: number }) {
  const yaw = (it.rot * Math.PI) / 180
  const screenW = (Math.abs(Math.cos(yaw)) * it.w + Math.abs(Math.sin(yaw)) * it.d) / k
  const screenH = (Math.abs(Math.sin(yaw)) * it.w + Math.abs(Math.cos(yaw)) * it.d) / k
  const fitsIn = (text: string, room: number, across: number) => room >= text.length * 5.4 + 6 && across >= 13
  const words = it.label.toLowerCase().match(/[a-z]+/g) ?? []
  const cap = (w: string | undefined) => (w ? w[0].toUpperCase() + w.slice(1) : undefined)
  const family = words.find((w) => (FAMILY[it.kind] ?? []).includes(w))
  const known = [...words].reverse().find((w) => VOCAB.has(w))
  const vertical = screenH > screenW * 1.4
  const label = [it.label, cap(family), cap(known), KIND_WORD[it.kind], cap(words[0])].find((t) => t && (vertical ? fitsIn(t, screenH, screenW) : fitsIn(t, screenW, screenH)))
  return (
    <g data-k="item" data-id={it.id} className={`item${sel ? ' is-sel' : ''}${it.demolish ? ' is-demolish' : ''}`} transform={`translate(${it.x} ${it.y}) rotate(${-it.rot})`}>
      <rect x={-it.w / 2} y={-it.d / 2} width={it.w} height={it.d} />
      {/* front edge marker: rot 0 faces +y */}
      <line x1={-it.w / 2 + 2} y1={it.d / 2 - 2} x2={it.w / 2 - 2} y2={it.d / 2 - 2} className="item-front" />
      <title>{it.label}</title>
      {label && (
        <text x={0} y={0} className="item-label" style={{ fontSize: 9.5 * k }} transform={`rotate(${it.rot + (vertical ? -90 : 0)})`}>
          {label}
        </text>
      )}
    </g>
  )
}

function CommentPins({ level, k }: { level: string; k: number }) {
  const comments = useStudio((s) => s.comments)
  const selection = useStudio((s) => s.selection)
  return (
    <g className="pins">
      {comments
        .filter((c) => c.level === level && !c.resolved)
        .map((c, i) => (
          <g key={c.id} data-k="comment" data-id={c.id} className={`pin${selection.some((s) => s.kind === 'comment' && s.id === c.id) ? ' is-sel' : ''}`} transform={`translate(${c.at[0]} ${c.at[1]})`}>
            <circle r={9 * k} />
            <text y={3.5 * k} style={{ fontSize: 10 * k }}>
              {i + 1}
            </text>
          </g>
        ))}
    </g>
  )
}

function CommentBox({ at, left, top, level, onDone }: { at: Vec; left: number; top: number; level: string; onDone: () => void }) {
  const [text, setText] = useState('')
  return (
    <form
      className="comment-box"
      style={{ left: left + 12, top: top + 12 }}
      onSubmit={async (e) => {
        e.preventDefault()
        if (text.trim()) await addComment(level, at, text.trim())
        onDone()
      }}
    >
      <textarea autoFocus rows={3} value={text} placeholder="Leave a note on the plan" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onDone()} />
      <div className="row">
        <button type="button" className="link" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn primary">
          Pin it
        </button>
      </div>
    </form>
  )
}

async function addComment(level: string, at: Vec, body: string) {
  const st = useStudio.getState()
  if (!st.repo || !st.schemeId) return
  const c: Comment = { id: `c${Date.now().toString(36)}`, scheme_id: st.schemeId, level, at: [Math.round(at[0]), Math.round(at[1])], body, author: 'you', resolved: false, created_at: new Date().toISOString() }
  await st.repo.saveComment(c)
  useStudio.setState({ comments: await st.repo.comments(st.schemeId) })
  select('comment', c.id)
}

export { pointInPolygon }
