// Compile a Studio model (inches, plan coordinates) into a Pascal scene graph (meters).
// Node ids are derived from model ids so the camera, selection and versions stay stable.

import {
  BuildingNode,
  CabinetModuleNode,
  CabinetNode,
  DoorNode,
  ItemNode,
  LevelNode,
  SiteNode,
  SlabNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core'
import catalog from '../../scripts/catalog.json'
import { type StudioItem, type StudioModel, type StudioRoom, type StudioWall, pointInPolygon, wallLength } from './model'
import { type Role, type Theme, finishFor, slug } from './theme'
import { IN } from './units'

type AnyNode = Record<string, any>
export type CompiledScene = {
  nodes: Record<string, AnyNode>
  rootNodeIds: string[]
  materials: Record<string, AnyNode>
}

const CATALOG: Record<string, any> = Object.fromEntries((catalog as any[]).map((c) => [c.id, c]))
const P = (x: number, y: number): [number, number] => [x * IN, y * IN]
const RAD = Math.PI / 180

const ROUGH: Record<Role, [number, number]> = {
  walls: [0.92, 0],
  trim: [0.6, 0],
  cabinets: [0.55, 0],
  island: [0.55, 0],
  counters: [0.28, 0],
  floors: [0.6, 0],
  accent: [0.6, 0],
  metal: [0.3, 0.85],
}

export function compileScene(model: StudioModel): CompiledScene {
  const themes: Record<string, Theme> = model.themes ?? {}
  const nodes: Record<string, AnyNode> = {}
  const materials: Record<string, AnyNode> = {}
  const add = (n: AnyNode, parent?: AnyNode) => {
    nodes[n.id] = n
    if (parent) {
      n.parentId = parent.id
      parent.children = [...(parent.children ?? []), n.id]
    }
    return n
  }
  const houseTheme = model.theme ? themes[model.theme] : null
  // Room outlines from the plans are approximate, so an item just outside a themed room's outline
  // (but within its bounds) still takes that room's theme.
  const themeOf = (level: string, x: number, y: number): Theme | null => {
    const room = model.rooms.find((r) => r.level === level && pointInPolygon([x, y], r.polygon))
    if (room?.theme && themes[room.theme]) return themes[room.theme]
    const near = model.rooms.find((r) => {
      if (r.level !== level || !r.theme || !themes[r.theme]) return false
      const xs = r.polygon.map((p) => p[0])
      const ys = r.polygon.map((p) => p[1])
      return x >= Math.min(...xs) - 30 && x <= Math.max(...xs) + 30 && y >= Math.min(...ys) - 30 && y <= Math.max(...ys) + 30
    })
    return (near?.theme && themes[near.theme]) || houseTheme
  }
  const ref = (theme: Theme | null, role: Role): string => {
    const f = finishFor(theme, role)
    if (f.library) return `library:${f.library}`
    const id = `mat_${slug(theme?.id ?? 'default')}_${role}`
    if (!materials[id]) {
      const [roughness, metalness] = ROUGH[role]
      materials[id] = {
        id,
        name: `${theme?.name ?? 'Default'} ${role}`,
        material: { preset: 'custom', properties: { color: f.color, roughness, metalness, opacity: 1, transparent: false, side: 'front' } },
      }
    }
    return `scene:${id}`
  }

  const site = add(SiteNode.parse({ id: 'site_velda', name: 'Site', children: [] }))
  site.children = []
  const building = add(BuildingNode.parse({ id: 'building_house', name: 'House', children: [] }), site)
  const levels = [...model.levels].sort((a, b) => a.elev - b.elev)
  const levelNodes: Record<string, AnyNode> = {}
  levels.forEach((l, i) => {
    const next = levels[i + 1]
    const height = (next ? next.elev - l.elev : model.ceiling + 12) * IN
    levelNodes[l.id] = add(
      LevelNode.parse({ id: `level_${l.id}`, name: l.name, level: i, height, children: [], metadata: { sid: l.id } }),
      building,
    )
  })
  const levelOf = (id: string) => levelNodes[id] ?? levelNodes[levels[0].id]

  // Rooms: zone (name, outline) and a floor slab finished per theme.
  for (const r of model.rooms) {
    const lv = levelOf(r.level)
    const poly = r.polygon.map(([x, y]) => P(x, y))
    const c = centroid(r)
    const th = (r.theme && themes[r.theme]) || houseTheme
    add(
      ZoneNode.parse({
        id: `zone_${r.id}`,
        name: r.name,
        polygon: poly,
        color: '#c8b8a0',
        spaceRole: 'room',
        ceilingHeight: model.ceiling * IN,
        metadata: { sid: r.id, label: r.name },
      }),
      lv,
    )
    add(
      SlabNode.parse({
        id: `slab_${r.id}`,
        name: `${r.name} floor`,
        polygon: poly,
        elevation: 0.012,
        thickness: 0.012,
        slots: { surface: ref(th, 'floors') },
        metadata: { sid: r.id, label: `${r.name} floor`, roomFloor: true, cx: c[0], cy: c[1] },
      }),
      lv,
    )
  }

  // Walls with their doors and windows.
  for (const w of model.walls) {
    const lv = levelOf(w.level)
    const len = wallLength(w)
    if (len < 1) continue
    const height = (w.h ?? model.ceiling) * IN
    const glass = w.kind === 'glass'
    // Which side faces a room: lets the viewer's cut-away hide walls between you and the room.
    const ux = (w.b[0] - w.a[0]) / len
    const uy = (w.b[1] - w.a[1]) / len
    const mx = (w.a[0] + w.b[0]) / 2
    const my = (w.a[1] + w.b[1]) / 2
    const off = w.t / 2 + 8
    const side = (sx: number, sy: number) =>
      model.rooms.some((r) => r.level === w.level && pointInPolygon([mx + sx * off, my + sy * off], r.polygon)) ? 'interior' : 'exterior'
    const frontSide = side(-uy, ux)
    const backSide = side(uy, -ux)
    const wallRef = glass ? 'library:preset-glass' : ref(houseTheme, 'walls')
    const wall = add(
      WallNode.parse({
        id: `wall_${w.id}`,
        name: glass ? 'Glass partition' : 'Wall',
        start: P(w.a[0], w.a[1]),
        end: P(w.b[0], w.b[1]),
        thickness: Math.max(0.5, w.t) * IN,
        height,
        children: [],
        slots: { interior: wallRef, exterior: wallRef },
        frontSide,
        backSide,
        metadata: { sid: w.id },
      }),
      lv,
    )
    for (const o of w.openings) {
      const width = Math.min(o.w, len - 1) * IN
      const at = Math.min(Math.max(o.at, o.w / 2), len - o.w / 2) * IN
      if (o.kind === 'window') {
        const h = Math.min(o.h, (w.h ?? model.ceiling) - (o.sill ?? 36) - 2) * IN
        add(
          WindowNode.parse({
            id: `window_${o.id}`,
            name: 'Window',
            wallId: wall.id,
            position: [at, (o.sill ?? 36) * IN + h / 2, 0],
            width,
            height: h,
            metadata: { sid: o.id, wall: w.id },
          }),
          wall,
        )
      } else {
        const h = Math.min(o.h, (w.h ?? model.ceiling) - 2) * IN
        add(
          DoorNode.parse({
            id: `door_${o.id}`,
            name: o.kind === 'opening' ? 'Opening' : 'Door',
            wallId: wall.id,
            position: [at, h / 2, 0],
            width,
            height: h,
            openingKind: o.kind === 'opening' ? 'opening' : 'door',
            openingShape: o.shape === 'arch' ? 'arch' : 'rectangle',
            ...(o.style === 'french' || (o.style !== 'pocket' && o.w >= 60) ? { leafCount: 2 } : {}),
            metadata: { sid: o.id, wall: w.id },
          }),
          wall,
        )
      }
    }
  }

  // Items: cabinet runs with their appliances, then stand-alone fixtures.
  const runKinds = new Set(['base_cabinet', 'island', 'vanity'])
  const inRun = new Set(['sink', 'range', 'cooktop', 'dishwasher'])
  const runs = model.items.filter((i) => runKinds.has(i.kind))
  const used = new Set<string>()
  for (const run of runs) {
    const inside = model.items.filter((a) => inRun.has(a.kind) && a.level === run.level && !used.has(a.id) && contains(run, a))
    inside.forEach((a) => used.add(a.id))
    buildRun(run, inside)
  }
  for (const it of model.items) {
    if (runKinds.has(it.kind) || used.has(it.id)) continue
    if (inRun.has(it.kind) || ['fridge', 'oven_tower', 'tall_cabinet', 'wall_cabinet'].includes(it.kind)) buildRun(it, [])
    else buildFixture(it)
  }

  return { nodes, rootNodeIds: [site.id], materials }

  // ---------------------------------------------------------------- runs

  function buildRun(it: StudioItem, appliances: StudioItem[]) {
    const lv = levelOf(it.level)
    const th = themeOf(it.level, it.x, it.y)
    const yaw = it.rot * RAD
    const tall = ['fridge', 'oven_tower', 'tall_cabinet'].includes(it.kind)
    const wallTier = it.kind === 'wall_cabinet'
    const island = it.kind === 'island'
    const plinth = wallTier ? 0 : 0.1
    const counter = tall || wallTier ? 0 : 0.03
    const back = island ? 0.3 : 0
    let depth = it.d * IN - back
    depth = Math.min(1.2, Math.max(0.3, depth))
    const carcass = Math.min(2.4, Math.max(0.4, it.h * IN - plinth - counter))
    // Island seating overhang sits behind the carcass: shift the carcass toward the front.
    const front: [number, number] = [Math.sin(yaw), Math.cos(yaw)]
    const cx = it.x * IN + (front[0] * back) / 2
    const cz = it.y * IN + (front[1] * back) / 2
    const lift = (it.z ?? (wallTier ? 54 : 0)) * IN
    const isRunCab = (k: string) => k === 'base_cabinet' || k === 'island' || k === 'vanity'
    const roleFront: Role = island ? 'island' : 'cabinets'
    const slots = {
      front: ref(th, roleFront),
      carcass: ref(th, roleFront),
      plinth: ref(th, roleFront),
      countertop: ref(th, 'counters'),
      hardware: ref(th, 'metal'),
    }
    const runId = `cabinet_${it.id}`
    const runNode = add(
      CabinetNode.parse({
        id: runId,
        name: it.label,
        position: [cx, lift, cz],
        rotation: yaw,
        width: Math.min(3, Math.max(0.05, it.w * IN)),
        depth,
        carcassHeight: carcass,
        plinthHeight: plinth || 0.1,
        showPlinth: !wallTier,
        withCountertop: counter > 0,
        countertopThickness: counter || 0.02,
        countertopOverhang: 0.02,
        countertopBackOverhang: back,
        withFinishedBack: island,
        withFinishedEnds: island,
        frontStyle: 'shaker',
        handleStyle: 'bar',
        runTier: wallTier ? 'wall' : tall ? 'tall' : 'base',
        slots,
        children: [],
        metadata: { sid: it.id, label: it.label, kind: it.kind },
      }),
      lv,
    )
    // Module layout along the run (local x), left to right.
    const half = it.w / 2
    const segs: { s: number; e: number; kind: string; item?: StudioItem }[] = []
    if (!isRunCab(it.kind)) segs.push({ s: -half, e: half, kind: it.kind, item: it })
    else {
      const xa: [number, number] = [Math.cos(yaw), -Math.sin(yaw)]
      const placed = appliances
        .map((a) => ({ a, u: (a.x - it.x) * xa[0] + (a.y - it.y) * xa[1] }))
        .sort((p, q) => p.u - q.u)
      let cur = -half
      for (const { a, u } of placed) {
        const s = Math.max(cur, u - a.w / 2)
        const e = Math.min(half, u + a.w / 2)
        if (e - s < 6) continue
        if (s - cur >= 0.5) segs.push({ s: cur, e: s, kind: it.kind === 'vanity' ? 'vanity_fill' : 'base' })
        segs.push({ s, e, kind: a.kind, item: a })
        cur = e
      }
      if (half - cur >= 0.5) segs.push({ s: cur, e: half, kind: it.kind === 'vanity' && !placed.length ? 'vanity' : it.kind === 'vanity' ? 'vanity_fill' : 'base' })
    }
    // Split long filler stretches into cabinet-sized boxes; fold slivers into a neighbour.
    const mods: { s: number; e: number; kind: string; item?: StudioItem }[] = []
    for (const g of segs) {
      const len = g.e - g.s
      if ((g.kind === 'base' || g.kind === 'vanity_fill') && len > 36) {
        const n = Math.ceil(len / 36)
        for (let k = 0; k < n; k++) mods.push({ ...g, s: g.s + (len * k) / n, e: g.s + (len * (k + 1)) / n })
      } else if (len < 4 && mods.length) mods[mods.length - 1].e = g.e
      else mods.push(g)
    }
    const baseY = runNode.showPlinth ? runNode.plinthHeight : 0
    mods.forEach((g, k) => {
      const width = (g.e - g.s) * IN
      const localX = ((g.s + g.e) / 2) * IN
      const stack = stackFor(g.kind, g.item ?? it, carcass, `${it.id}-${k}`)
      add(
        CabinetModuleNode.parse({
          id: `cabinet-module_${it.id}_${k}`,
          name: g.item && g.item !== it ? g.item.label : it.label,
          position: [localX, baseY, 0],
          width: Math.max(0.05, width),
          depth,
          carcassHeight: carcass,
          plinthHeight: runNode.plinthHeight,
          toeKickDepth: 0.075,
          countertopThickness: 0,
          countertopOverhang: 0.02,
          showPlinth: false,
          withCountertop: false,
          cabinetType: tall ? 'tall' : 'base',
          frontStyle: 'shaker',
          handleStyle: 'bar',
          stack,
          slots,
          children: [],
          metadata: { sid: g.item?.id ?? it.id, label: g.item?.label ?? it.label, kind: g.kind },
        }),
        runNode,
      )
    })
  }

  // ---------------------------------------------------------------- fixtures

  function buildFixture(it: StudioItem) {
    const lv = levelOf(it.level)
    const th = themeOf(it.level, it.x, it.y)
    const yaw = it.rot * RAD
    if (it.kind === 'glass' || it.kind === 'bench' || it.kind === 'beam') {
      // Thin or boxy built-ins are drawn as short walls: a straight box along the item's width.
      const dir: [number, number] = [Math.cos(yaw), -Math.sin(yaw)]
      const a: [number, number] = [it.x - (dir[0] * it.w) / 2, it.y - (dir[1] * it.w) / 2]
      const b: [number, number] = [it.x + (dir[0] * it.w) / 2, it.y + (dir[1] * it.w) / 2]
      const mat =
        it.kind === 'glass' ? 'library:preset-glass' : it.kind === 'beam' ? ref(th, 'accent') : ref(th, 'counters')
      add(
        WallNode.parse({
          id: `wall_item_${it.id}`,
          name: it.label,
          start: P(a[0], a[1]),
          end: P(b[0], b[1]),
          thickness: Math.max(0.75, it.d) * IN,
          height: it.h * IN,
          ...(it.kind === 'beam' ? { supportOffset: (it.z ?? model.ceiling - it.h) * IN } : {}),
          children: [],
          slots: { interior: mat, exterior: mat },
          metadata: { sid: it.id, label: it.label, kind: it.kind },
        }),
        lv,
      )
      return
    }
    const catId =
      it.catalog && CATALOG[it.catalog]
        ? it.catalog
        : ({ tub: 'bathtub', shower: 'shower-square', toilet: 'toilet', hood: 'hood' } as Record<string, string>)[it.kind] ??
          'kitchen-cabinet'
    const asset = { ...CATALOG[catId] }
    delete asset.attachTo
    const [dw, dh, dd] = asset.dimensions as [number, number, number]
    add(
      ItemNode.parse({
        id: `item_${it.id}`,
        name: it.label,
        position: [it.x * IN, (it.z ?? (it.kind === 'hood' ? 66 : 0)) * IN, it.y * IN],
        rotation: [0, yaw, 0],
        scale: [(it.w * IN) / dw, (it.h * IN) / dh, (it.d * IN) / dd],
        asset: { ...asset, thumbnail: asset.thumbnail ?? `/items/${catId}/thumbnail.webp` },
        children: [],
        metadata: { sid: it.id, label: it.label, kind: it.kind },
      }),
      lv,
    )
  }
}

// ---------------------------------------------------------------- helpers

function contains(run: StudioItem, a: StudioItem) {
  const yaw = run.rot * RAD
  const xa = [Math.cos(yaw), -Math.sin(yaw)]
  const fr = [Math.sin(yaw), Math.cos(yaw)]
  const dx = a.x - run.x
  const dy = a.y - run.y
  const u = dx * xa[0] + dy * xa[1]
  const v = dx * fr[0] + dy * fr[1]
  return Math.abs(u) <= run.w / 2 + 1 && Math.abs(v) <= run.d / 2 + 6
}

function centroid(r: StudioRoom): [number, number] {
  const n = r.polygon.length
  return [r.polygon.reduce((s, p) => s + p[0], 0) / n, r.polygon.reduce((s, p) => s + p[1], 0) / n]
}

function stackFor(kind: string, it: StudioItem, carcass: number, key: string): any[] {
  const id = (n: number) => `cc_${key}_${n}`
  switch (kind) {
    case 'sink':
      return [
        { id: id(0), type: 'door', doorType: 'double', shelfCount: 1 },
        { id: id(1), type: 'sink', sinkLayout: it.w >= 36 ? 'double' : 'single' },
      ]
    case 'vanity': {
      const sinks = Number((it.props as any)?.sinks ?? (it.w >= 60 ? 2 : 1))
      return [
        { id: id(0), type: 'door', doorType: 'double', shelfCount: 1 },
        { id: id(1), type: 'sink', sinkLayout: sinks >= 2 ? 'double' : 'single' },
      ]
    }
    case 'range':
    case 'cooktop':
      return [
        kind === 'range'
          ? { id: id(0), type: 'oven', height: Math.min(0.595, carcass - 0.12) }
          : { id: id(0), type: 'drawer', drawerCount: 2 },
        {
          id: id(1),
          type: 'cooktop-gas',
          height: 0.08,
          cooktopLayout: it.w >= 34 ? 'gas-6burner' : 'gas-4burner',
          cooktopBurnersOn: false,
          cooktopActiveBurners: [],
          cooktopKnobProgress: [],
          cooktopShowGrate: true,
        },
      ]
    case 'dishwasher':
      return [{ id: id(0), type: 'dishwasher', height: Math.min(0.72, carcass) }]
    case 'fridge':
      return [{ id: id(0), type: it.w >= 34 ? 'fridge-double' : 'fridge-single', height: Math.min(2.4, carcass) }]
    case 'oven_tower':
      return [
        { id: id(0), type: 'drawer', height: 0.3, drawerCount: 2 },
        { id: id(1), type: 'oven', height: 0.595 },
        { id: id(2), type: 'oven', height: 0.595 },
        { id: id(3), type: 'door', doorType: 'double', shelfCount: 1 },
      ]
    case 'tall_cabinet':
      return [{ id: id(0), type: 'door', doorType: 'double', shelfCount: 4 }]
    case 'wall_cabinet':
      return [{ id: id(0), type: 'door', doorType: it.w >= 24 ? 'double' : 'single-left', shelfCount: 1 }]
    case 'vanity_fill':
      return [{ id: id(0), type: 'drawer', drawerCount: 3 }]
    default:
      return [
        { id: id(0), type: 'door', doorType: it.w >= 24 ? 'double' : 'single-left', shelfCount: 1 },
        { id: id(1), type: 'drawer', height: 0.16, drawerCount: 1 },
      ]
  }
}

export type { StudioWall }
