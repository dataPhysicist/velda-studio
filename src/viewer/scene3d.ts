// The share viewer's 3D: a light model built straight from model v2 with three.js (loaded from
// jsDelivr), not the studio's Pascal scene, so the viewer stays small. Walls are boxes split around
// their openings (a sill below a window, a header above doors and windows), floors are the room
// outlines, fixtures are boxes at their size. Cut away lowers the walls to 3'-6" so rooms read from above.
import type * as THREE_NS from 'three'
import type { Theme } from '../lib/theme'
import type { Model } from '../model/types'

type THREE = typeof THREE_NS
const IN = 0.0254

export type SceneOpts = { level: string | null; cut: boolean }

function themeColor(m: Model, role: string, fallback: string, roomTheme?: string | null): string {
  const t: Theme | undefined = (roomTheme && m.themes[roomTheme]) || (m.theme ? m.themes[m.theme] : undefined)
  const f = (t?.data as any)?.finishes?.[role]
  if (f?.color) return f.color
  const p = t?.data.palette?.find((x) => (x.role ?? '').toLowerCase() === role)
  return p?.hex ?? fallback
}

export function buildScene(T: THREE, m: Model, o: SceneOpts): { group: THREE_NS.Group; center: THREE_NS.Vector3; size: number; meshes: number } {
  const g = new T.Group()
  const levels = [...m.levels].sort((a, b) => a.elev - b.elev)
  const shown = o.level ? levels.filter((l) => l.id === o.level) : levels
  const wallMat = new T.MeshStandardMaterial({ color: themeColor(m, 'walls', '#efebe4'), roughness: 0.9 })
  const extMat = new T.MeshStandardMaterial({ color: '#d9d4cb', roughness: 0.95 })
  const glassMat = new T.MeshStandardMaterial({ color: '#9cc3cf', transparent: true, opacity: 0.35, roughness: 0.1 })
  const itemMat = new T.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 })
  const darkMat = new T.MeshStandardMaterial({ color: '#4a5257', roughness: 0.7 })
  let meshes = 0
  const box = (w: number, h: number, d: number, mat: THREE_NS.Material, x: number, y: number, z: number, rotY: number) => {
    if (w <= 0.001 || h <= 0.001 || d <= 0.001) return
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), mat)
    mesh.position.set(x, y, z)
    mesh.rotation.y = rotY
    mesh.castShadow = true
    mesh.receiveShadow = true
    g.add(mesh)
    meshes++
  }
  const bounds = new T.Box3()
  for (const lv of shown) {
    const y0 = lv.elev * IN
    // Floors.
    for (const r of m.rooms.filter((x) => x.level === lv.id && x.polygon.length >= 3)) {
      const shape = new T.Shape(r.polygon.map(([x, y]) => new T.Vector2(x * IN, -y * IN)))
      const geo = new T.ShapeGeometry(shape)
      geo.rotateX(-Math.PI / 2)
      const mesh = new T.Mesh(geo, new T.MeshStandardMaterial({ color: themeColor(m, 'floors', '#d8ccb6', r.theme), roughness: 0.8, side: T.DoubleSide }))
      mesh.position.y = y0 + 0.002
      mesh.receiveShadow = true
      g.add(mesh)
      meshes++
    }
    // Walls, split around openings.
    for (const w of m.walls.filter((x) => x.level === lv.id)) {
      const dx = w.b[0] - w.a[0]
      const dy = w.b[1] - w.a[1]
      const L = Math.hypot(dx, dy)
      if (L < 0.5) continue
      const H = w.kind === 'half' ? 42 : (w.h ?? lv.ceiling)
      const top = o.cut ? Math.min(H, 42) : w.kind === 'rail' ? 36 : H
      const t = Math.max(w.kind === 'rail' ? 2 : 0.5, w.t)
      const u = [dx / L, dy / L]
      const rot = -Math.atan2(dy, dx)
      const mat = w.kind === 'glass' ? glassMat : w.exterior ? extMat : wallMat
      const at = (s: number, z0: number, z1: number) => {
        const cx = w.a[0] + u[0] * s
        const cy = w.a[1] + u[1] * s
        return [cx * IN, y0 + ((z0 + z1) / 2) * IN, cy * IN] as const
      }
      const piece = (s0: number, s1: number, z0: number, z1: number) => {
        const z1c = Math.min(z1, top)
        if (z1c <= z0 || s1 - s0 < 0.1) return
        const [x, y, z] = at((s0 + s1) / 2, z0, z1c)
        box((s1 - s0) * IN, (z1c - z0) * IN, t * IN, mat, x, y, z, rot)
      }
      const ops = m.openings.filter((x) => x.wall === w.id).sort((a, b) => a.at - b.at)
      let s = 0
      for (const op of ops) {
        const a = Math.max(0, op.at - op.w / 2)
        const b = Math.min(L, op.at + op.w / 2)
        piece(s, a, 0, H)
        const sill = op.kind === 'window' ? (op.sill ?? 36) : 0
        piece(a, b, 0, sill)
        piece(a, b, Math.min(op.h, H), H)
        if (op.kind === 'window' && !o.cut) {
          const [x, y, z] = at((a + b) / 2, sill, Math.min(op.h, H))
          box((b - a) * IN, (Math.min(op.h, H) - sill) * IN, 0.4 * IN, glassMat, x, y, z, rot)
        }
        s = Math.max(s, b)
      }
      piece(s, L, 0, H)
      bounds.expandByPoint(new T.Vector3(w.a[0] * IN, y0, w.a[1] * IN))
      bounds.expandByPoint(new T.Vector3(w.b[0] * IN, y0 + H * IN, w.b[1] * IN))
    }
    // Fixtures.
    for (const it of m.items.filter((x) => x.level === lv.id)) {
      const h = Math.max(1, it.h)
      const z = it.z ?? 0
      const mat = ['range', 'fridge', 'dishwasher', 'oven_tower', 'washer', 'dryer'].includes(it.kind) ? darkMat : itemMat
      box(it.w * IN, (o.cut ? Math.min(h, Math.max(1, 42 - z)) : h) * IN, it.d * IN, mat, it.x * IN, y0 + (z + (o.cut ? Math.min(h, Math.max(1, 42 - z)) : h) / 2) * IN, it.y * IN, (it.rot * Math.PI) / 180)
    }
  }
  const center = new T.Vector3()
  const sz = new T.Vector3()
  if (bounds.isEmpty()) bounds.set(new T.Vector3(0, 0, 0), new T.Vector3(10, 3, 10))
  bounds.getCenter(center)
  bounds.getSize(sz)
  return { group: g, center, size: Math.max(sz.x, sz.z, 4), meshes }
}
