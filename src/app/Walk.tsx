// First-person walkthrough: eye height, mouse look, WASD/arrows, smooth acceleration, wall collision.
// Collision uses the Studio model's walls (in plan inches) minus door and opening spans, so you can
// walk through doorways but not through walls or glass.
import { useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Euler, Vector3 } from 'three'
import { type StudioModel, pointInPolygon, polygonBounds, wallLength } from '../lib/model'
import { IN } from '../lib/units'
import { useStudio } from './store'

type Seg = { ax: number; az: number; bx: number; bz: number; r: number }

const EYE = 63 * IN // 5'-3"
const RADIUS = 0.22 // body radius in meters
const WALK = 1.5 // m/s
const RUN = 3.2
const ACCEL = 9 // how quickly velocity reaches the target (1/s)
const LOOK = 0.0024 // radians per pixel

/** Solid wall pieces on a level, in meters (x, z), with doors and openings cut out. */
export function collisionSegments(model: StudioModel, levelId: string): Seg[] {
  const segs: Seg[] = []
  for (const w of model.walls) {
    if (w.level !== levelId) continue
    const len = wallLength(w)
    if (len < 1) continue
    const ux = (w.b[0] - w.a[0]) / len
    const uy = (w.b[1] - w.a[1]) / len
    const gaps = w.openings
      .filter((o) => o.kind !== 'window' || (o.sill ?? 36) < 12)
      .map((o) => [o.at - o.w / 2, o.at + o.w / 2] as [number, number])
      .sort((p, q) => p[0] - q[0])
    let s = 0
    const push = (from: number, to: number) => {
      if (to - from < 0.5) return
      segs.push({
        ax: (w.a[0] + ux * from) * IN,
        az: (w.a[1] + uy * from) * IN,
        bx: (w.a[0] + ux * to) * IN,
        bz: (w.a[1] + uy * to) * IN,
        r: (w.t / 2) * IN,
      })
    }
    for (const [g0, g1] of gaps) {
      push(s, Math.max(s, g0))
      s = Math.max(s, g1)
    }
    push(s, len)
  }
  // Tall fixtures block too (cabinets, tubs, showers, glass), as their footprint edges.
  for (const it of model.items) {
    if (it.level !== levelId || it.h < 20 || (it.z ?? 0) > 40 || it.kind === 'wall_cabinet' || it.kind === 'beam' || it.kind === 'hood') continue
    const yaw = (it.rot * Math.PI) / 180
    const ax = [Math.cos(yaw), -Math.sin(yaw)]
    const fr = [Math.sin(yaw), Math.cos(yaw)]
    const hw = it.w / 2
    const hd = Math.max(it.d, 1) / 2
    const corners = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ].map(([u, v]) => [(it.x + ax[0] * u + fr[0] * v) * IN, (it.y + ax[1] * u + fr[1] * v) * IN])
    for (let i = 0; i < 4; i++) {
      const p = corners[i]
      const q = corners[(i + 1) % 4]
      segs.push({ ax: p[0], az: p[1], bx: q[0], bz: q[1], r: 0.01 })
    }
  }
  return segs
}

/** Push a point out of every segment it is closer to than radius + half thickness. */
function resolve(p: Vector3, segs: Seg[]) {
  for (let pass = 0; pass < 3; pass++) {
    for (const s of segs) {
      const dx = s.bx - s.ax
      const dz = s.bz - s.az
      const l2 = dx * dx + dz * dz || 1e-9
      let t = ((p.x - s.ax) * dx + (p.z - s.az) * dz) / l2
      t = Math.max(0, Math.min(1, t))
      const cx = s.ax + dx * t
      const cz = s.az + dz * t
      const ox = p.x - cx
      const oz = p.z - cz
      const d = Math.hypot(ox, oz)
      const min = s.r + RADIUS
      if (d < min) {
        if (d < 1e-6) {
          p.x += (-dz / Math.sqrt(l2)) * min
          p.z += (dx / Math.sqrt(l2)) * min
        } else {
          p.x += (ox / d) * (min - d)
          p.z += (oz / d) * (min - d)
        }
      }
    }
  }
}

/** A good place to stand: the center of the focused room (or the largest room on the level). */
export function walkStart(model: StudioModel, roomId: string | null, levelId: string | null) {
  const levels = [...model.levels].sort((a, b) => a.elev - b.elev)
  let room = roomId ? model.rooms.find((r) => r.id === roomId) : null
  const lvId = room?.level ?? levelId ?? levels[0].id
  if (!room) {
    const rooms = model.rooms.filter((r) => r.level === lvId)
    room = rooms.sort((a, b) => {
      const ba = polygonBounds(a.polygon)
      const bb = polygonBounds(b.polygon)
      return (bb.x1 - bb.x0) * (bb.y1 - bb.y0) - (ba.x1 - ba.x0) * (ba.y1 - ba.y0)
    })[0]
  }
  const lv = levels.find((l) => l.id === lvId) ?? levels[0]
  if (!room) return { levelId: lv.id, x: 0, z: 0, y: lv.elev * IN, yaw: 0 }
  const b = polygonBounds(room.polygon)
  let cx = (b.x0 + b.x1) / 2
  let cy = (b.y0 + b.y1) / 2
  if (!pointInPolygon([cx, cy], room.polygon)) {
    // Concave room: step toward the first vertex until inside.
    const [vx, vy] = room.polygon[0]
    for (let k = 0.1; k <= 0.9; k += 0.1) {
      const px = cx + (vx - cx) * k
      const py = cy + (vy - cy) * k
      if (pointInPolygon([px, py], room.polygon)) {
        cx = px
        cy = py
        break
      }
    }
  }
  // Stand near one end and look down the long axis.
  const wide = b.x1 - b.x0 >= b.y1 - b.y0
  const back = wide ? (b.x1 - b.x0) * 0.3 : (b.y1 - b.y0) * 0.3
  const sx = wide ? cx - back : cx
  const sy = wide ? cy : cy + back
  const inside = pointInPolygon([sx, sy], room.polygon)
  return {
    levelId: lv.id,
    x: (inside ? sx : cx) * IN,
    z: (inside ? sy : cy) * IN,
    y: lv.elev * IN,
    yaw: wide ? -Math.PI / 2 : 0, // three.js: yaw 0 looks toward -z (up the sheet)
  }
}

export function WalkControls() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const model = useStudio((s) => s.model)
  const walk = useStudio((s) => s.walk)
  const keys = useRef<Record<string, boolean>>({})
  const vel = useRef(new Vector3())
  const look = useRef({ yaw: 0, pitch: -0.05, yawT: 0, pitchT: -0.05 })
  const pos = useRef(new Vector3())
  const segs = useMemo(() => (model && walk ? collisionSegments(model, walk.levelId) : []), [model, walk?.levelId])

  // Enter: place the camera.
  useEffect(() => {
    if (!walk) return
    pos.current.set(walk.x, walk.y + EYE, walk.z)
    look.current = { yaw: walk.yaw, pitch: -0.05, yawT: walk.yaw, pitchT: -0.05 }
    vel.current.set(0, 0, 0)
    const cam = camera as any
    const prevFov = cam.fov
    cam.fov = 72
    cam.near = 0.05
    cam.updateProjectionMatrix()
    camera.position.copy(pos.current)
    camera.quaternion.setFromEuler(new Euler(look.current.pitch, look.current.yaw, 0, 'YXZ'))
    invalidate()
    return () => {
      cam.fov = prevFov
      cam.near = 0.1
      cam.updateProjectionMatrix()
    }
  }, [walk?.key])

  // Input: keys anywhere except text boxes; drag to look (or pointer lock after a click with Shift).
  useEffect(() => {
    if (!walk) return
    const el = gl.domElement
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      return !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)
    }
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return
      if (e.key === 'Escape') {
        if (document.pointerLockElement) return
        useStudio.getState().exitWalk()
        return
      }
      keys.current[e.code] = true
      if (/^(Arrow|Key[WASDQE]|Space)/.test(e.code)) e.preventDefault()
    }
    const up = (e: KeyboardEvent) => {
      keys.current[e.code] = false
    }
    const blur = () => {
      keys.current = {}
    }
    let dragging = false
    let lx = 0
    let ly = 0
    const pd = (e: PointerEvent) => {
      dragging = true
      lx = e.clientX
      ly = e.clientY
      el.setPointerCapture?.(e.pointerId)
    }
    const pm = (e: PointerEvent) => {
      const locked = document.pointerLockElement === el
      if (!dragging && !locked) return
      const dx = locked ? e.movementX : e.clientX - lx
      const dy = locked ? e.movementY : e.clientY - ly
      lx = e.clientX
      ly = e.clientY
      look.current.yawT -= dx * LOOK
      look.current.pitchT = Math.max(-1.35, Math.min(1.35, look.current.pitchT - dy * LOOK))
    }
    const pu = (e: PointerEvent) => {
      dragging = false
      el.releasePointerCapture?.(e.pointerId)
    }
    const dbl = () => el.requestPointerLock?.()
    // Wheel steps forward/back, like a trackpad glide.
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const f = new Vector3(-Math.sin(look.current.yaw), 0, -Math.cos(look.current.yaw))
      vel.current.addScaledVector(f, -Math.sign(e.deltaY) * Math.min(1.2, Math.abs(e.deltaY) / 120))
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    el.addEventListener('pointerdown', pd)
    window.addEventListener('pointermove', pm)
    window.addEventListener('pointerup', pu)
    el.addEventListener('dblclick', dbl)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      el.removeEventListener('pointerdown', pd)
      window.removeEventListener('pointermove', pm)
      window.removeEventListener('pointerup', pu)
      el.removeEventListener('dblclick', dbl)
      el.removeEventListener('wheel', wheel)
      if (document.pointerLockElement === el) document.exitPointerLock()
    }
  }, [walk?.key, gl])

  useFrame((_, dtRaw) => {
    if (!walk) return
    const dt = Math.min(0.05, dtRaw)
    const k = keys.current
    const L = look.current
    // Keyboard turning for people who prefer it.
    if (k.KeyQ || k.ArrowLeft) L.yawT += 1.8 * dt
    if (k.KeyE || k.ArrowRight) L.yawT -= 1.8 * dt
    const smooth = 1 - Math.exp(-14 * dt)
    L.yaw += (L.yawT - L.yaw) * smooth
    L.pitch += (L.pitchT - L.pitch) * smooth
    const f = new Vector3(-Math.sin(L.yaw), 0, -Math.cos(L.yaw))
    const r = new Vector3(Math.cos(L.yaw), 0, -Math.sin(L.yaw))
    const want = new Vector3()
    if (k.KeyW || k.ArrowUp) want.add(f)
    if (k.KeyS || k.ArrowDown) want.sub(f)
    if (k.KeyD) want.add(r)
    if (k.KeyA) want.sub(r)
    const speed = k.ShiftLeft || k.ShiftRight ? RUN : WALK
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(speed)
    vel.current.lerp(want, 1 - Math.exp(-ACCEL * dt))
    const moving = vel.current.lengthSq() > 1e-5
    if (moving) {
      pos.current.addScaledVector(vel.current, dt)
      resolve(pos.current, segs)
    }
    camera.position.copy(pos.current)
    camera.quaternion.setFromEuler(new Euler(L.pitch, L.yaw, 0, 'YXZ'))
    const settling = moving || Math.abs(L.yawT - L.yaw) > 1e-4 || Math.abs(L.pitchT - L.pitch) > 1e-4
    if (settling || Object.values(k).some(Boolean)) invalidate()
  })

  useEffect(() => {
    if (!walk) return
    const v = useViewer.getState()
    const prev = v.wallMode
    v.setWallMode('up')
    return () => useViewer.getState().setWallMode(prev === 'up' ? 'cutaway' : prev)
  }, [walk?.key])

  return null
}
