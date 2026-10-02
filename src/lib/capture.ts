// Room capture: frames from a phone video, point clouds from MapAnything, and measuring the room.
// Approach after AWSM (Phygital AI): metric pose + depth evidence constrains an editable model;
// the agent observes the photos and measurements, edits the model, then checks renders against photos.

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export type Cloud = { pos: Float32Array; col: Uint8Array; count: number }

// ------------------------------------------------------------------ video frames

/** Pull up to `n` sharp, evenly spread frames out of a video, as JPEG blobs (long edge 1600). */
export async function videoFrames(file: File, n = 16, onProgress?: (k: number) => void): Promise<Blob[]> {
  const url = URL.createObjectURL(file)
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'
  v.src = url
  try {
    await new Promise<void>((ok, bad) => {
      v.onloadedmetadata = () => ok()
      v.onerror = () => bad(new Error('This video format cannot be read in the browser'))
    })
    const dur = v.duration
    if (!Number.isFinite(dur) || dur <= 0) throw new Error('The video has no length')
    const k = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(v.videoWidth * k)
    c.height = Math.round(v.videoHeight * k)
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    const small = document.createElement('canvas')
    small.width = 160
    small.height = Math.round((160 * c.height) / c.width)
    const sctx = small.getContext('2d', { willReadFrequently: true })!
    const seek = (t: number) =>
      new Promise<void>((ok) => {
        v.onseeked = () => ok()
        v.currentTime = Math.min(dur - 0.05, Math.max(0, t))
      })
    const out: Blob[] = []
    // Three candidates per slot; keep the sharpest (motion blur is the main failure in phone video).
    for (let i = 0; i < n; i++) {
      let best: { score: number; t: number } | null = null
      for (let j = 0; j < 3; j++) {
        const t = ((i + (j + 1) / 4) / n) * dur
        await seek(t)
        sctx.drawImage(v, 0, 0, small.width, small.height)
        const score = sharpness(sctx.getImageData(0, 0, small.width, small.height))
        if (!best || score > best.score) best = { score, t }
      }
      await seek(best!.t)
      ctx.drawImage(v, 0, 0, c.width, c.height)
      out.push(await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), 'image/jpeg', 0.9)))
      onProgress?.(i + 1)
    }
    return out
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Variance of the Laplacian on a grayscale image: higher is sharper. */
function sharpness(img: ImageData) {
  const { width: w, height: h, data } = img
  const g = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  let sum = 0
  let sum2 = 0
  let n = 0
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i]
      sum += l
      sum2 += l * l
      n++
    }
  const m = sum / n
  return sum2 / n - m * m
}

// ------------------------------------------------------------------ point clouds

export async function parseCloud(bytes: ArrayBuffer, nameHint = ''): Promise<Cloud> {
  const head = new TextDecoder().decode(new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength)))
  if (head.startsWith('ply')) return parsePly(bytes)
  if (head === 'glTF' || /\.glb$/i.test(nameHint)) return parseGlbCloud(bytes)
  throw new Error('Unknown point cloud format')
}

export function parsePly(buf: ArrayBuffer): Cloud {
  const bytes = new Uint8Array(buf)
  const end = findHeaderEnd(bytes)
  const header = new TextDecoder().decode(bytes.subarray(0, end))
  const lines = header.split(/\r?\n/)
  const format = (lines.find((l) => l.startsWith('format')) ?? '').split(/\s+/)[1]
  let count = 0
  const props: { name: string; type: string }[] = []
  let inVertex = false
  for (const l of lines) {
    const p = l.trim().split(/\s+/)
    if (p[0] === 'element') {
      inVertex = p[1] === 'vertex'
      if (inVertex) count = parseInt(p[2], 10)
    } else if (p[0] === 'property' && inVertex && p[1] !== 'list') props.push({ type: p[1], name: p[2] })
  }
  const pos = new Float32Array(count * 3)
  const col = new Uint8Array(count * 3).fill(200)
  const idx = (n: string) => props.findIndex((p) => p.name === n)
  const ix = idx('x')
  const iy = idx('y')
  const iz = idx('z')
  const ir = ['red', 'r', 'diffuse_red'].map(idx).find((i) => i >= 0) ?? -1
  const ig = ['green', 'g', 'diffuse_green'].map(idx).find((i) => i >= 0) ?? -1
  const ib = ['blue', 'b', 'diffuse_blue'].map(idx).find((i) => i >= 0) ?? -1
  // 3D Gaussian splat PLYs carry color as spherical-harmonic DC terms.
  const dc = [idx('f_dc_0'), idx('f_dc_1'), idx('f_dc_2')]
  const colorIsFloat = ir >= 0 && /float|double/.test(props[ir].type)
  const toByte = (v: number, isFloat: boolean) => (isFloat ? Math.max(0, Math.min(255, Math.round(v * (v <= 1.001 ? 255 : 1)))) : v)
  if (format === 'ascii') {
    const body = new TextDecoder().decode(bytes.subarray(end)).trim().split(/\r?\n/)
    for (let i = 0; i < count && i < body.length; i++) {
      const v = body[i].trim().split(/\s+/).map(Number)
      pos[i * 3] = v[ix]
      pos[i * 3 + 1] = v[iy]
      pos[i * 3 + 2] = v[iz]
      if (ir >= 0) {
        col[i * 3] = toByte(v[ir], colorIsFloat)
        col[i * 3 + 1] = toByte(v[ig], colorIsFloat)
        col[i * 3 + 2] = toByte(v[ib], colorIsFloat)
      }
    }
    return { pos, col, count }
  }
  const little = format !== 'binary_big_endian'
  const size: Record<string, number> = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 }
  const offs: number[] = []
  let stride = 0
  for (const p of props) {
    offs.push(stride)
    stride += size[p.type] ?? 4
  }
  const dv = new DataView(buf, end)
  const read = (o: number, t: string) => {
    switch (t) {
      case 'float':
      case 'float32':
        return dv.getFloat32(o, little)
      case 'double':
      case 'float64':
        return dv.getFloat64(o, little)
      case 'uchar':
      case 'uint8':
        return dv.getUint8(o)
      case 'char':
      case 'int8':
        return dv.getInt8(o)
      case 'ushort':
      case 'uint16':
        return dv.getUint16(o, little)
      case 'short':
      case 'int16':
        return dv.getInt16(o, little)
      case 'uint':
      case 'uint32':
        return dv.getUint32(o, little)
      default:
        return dv.getInt32(o, little)
    }
  }
  const n = Math.min(count, Math.floor(dv.byteLength / stride))
  for (let i = 0; i < n; i++) {
    const b = i * stride
    pos[i * 3] = read(b + offs[ix], props[ix].type)
    pos[i * 3 + 1] = read(b + offs[iy], props[iy].type)
    pos[i * 3 + 2] = read(b + offs[iz], props[iz].type)
    if (ir >= 0) {
      col[i * 3] = toByte(read(b + offs[ir], props[ir].type), colorIsFloat)
      col[i * 3 + 1] = toByte(read(b + offs[ig], props[ig].type), colorIsFloat)
      col[i * 3 + 2] = toByte(read(b + offs[ib], props[ib].type), colorIsFloat)
    } else if (dc[0] >= 0) {
      for (let c = 0; c < 3; c++) col[i * 3 + c] = Math.max(0, Math.min(255, Math.round((0.5 + 0.2820948 * read(b + offs[dc[c]], props[dc[c]].type)) * 255)))
    }
  }
  return { pos: pos.subarray(0, n * 3), col: col.subarray(0, n * 3), count: n }
}

function findHeaderEnd(bytes: Uint8Array) {
  const marker = 'end_header'
  for (let i = 0; i < Math.min(bytes.length, 65536); i++) {
    let ok = true
    for (let j = 0; j < marker.length; j++) if (bytes[i + j] !== marker.charCodeAt(j)) { ok = false; break }
    if (ok) {
      let k = i + marker.length
      if (bytes[k] === 13) k++
      if (bytes[k] === 10) k++
      return k
    }
  }
  throw new Error('Not a PLY file')
}

async function parseGlbCloud(buf: ArrayBuffer): Promise<Cloud> {
  const gltf = await new GLTFLoader().parseAsync(buf, '')
  const ps: number[] = []
  const cs: number[] = []
  gltf.scene.updateMatrixWorld(true)
  gltf.scene.traverse((o: any) => {
    if (!o.geometry || !(o.isPoints || o.isMesh)) return
    // Camera frustum meshes in reconstruction GLBs are small line meshes; keep only point sets and big meshes.
    const g = o.geometry
    const p = g.attributes.position
    if (!p || (o.isMesh && p.count < 5000)) return
    const c = g.attributes.color
    const v = new (o.matrixWorld.constructor as any)()
    void v
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i)
      const y = p.getY(i)
      const z = p.getZ(i)
      const e = o.matrixWorld.elements
      ps.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14])
      if (c) {
        const scale = c.normalized || c.array instanceof Float32Array ? 255 : 1
        cs.push(c.getX(i) * scale, c.getY(i) * scale, c.getZ(i) * scale)
      } else cs.push(200, 200, 200)
    }
  })
  // GLB (glTF) is y-up; convert to the OpenCV-style y-down convention the PLYs use.
  for (let i = 0; i < ps.length; i += 3) {
    ps[i + 1] = -ps[i + 1]
    ps[i + 2] = -ps[i + 2]
  }
  return { pos: Float32Array.from(ps), col: Uint8Array.from(cs.map((v) => Math.max(0, Math.min(255, Math.round(v))))), count: ps.length / 3 }
}

/** Keep at most `max` points, evenly. */
export function thin(c: Cloud, max: number): Cloud {
  if (c.count <= max) return c
  const step = c.count / max
  const pos = new Float32Array(max * 3)
  const col = new Uint8Array(max * 3)
  for (let i = 0; i < max; i++) {
    const j = Math.floor(i * step)
    pos.set(c.pos.subarray(j * 3, j * 3 + 3), i * 3)
    col.set(c.col.subarray(j * 3, j * 3 + 3), i * 3)
  }
  return { pos, col, count: max }
}

export function packCloud(c: Cloud): Uint8Array {
  const out = new Uint8Array(4 + c.count * 15)
  new DataView(out.buffer).setUint32(0, c.count, true)
  out.set(new Uint8Array(c.pos.buffer, c.pos.byteOffset, c.count * 12), 4)
  out.set(c.col.subarray(0, c.count * 3), 4 + c.count * 12)
  return out
}
export function unpackCloud(b: Uint8Array): Cloud {
  const count = new DataView(b.buffer, b.byteOffset).getUint32(0, true)
  const pos = new Float32Array(count * 3)
  new Uint8Array(pos.buffer).set(b.subarray(4, 4 + count * 12))
  const col = b.slice(4 + count * 12, 4 + count * 15)
  return { pos, col, count }
}

// ------------------------------------------------------------------ measuring

type V3 = [number, number, number]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

export type RoomAnalysis = {
  points: number
  up: V3 // in capture coordinates
  axisX: V3 // first wall direction along the floor
  axisY: V3
  floor: number // height of the floor along `up`, meters
  ceiling: number | null // ceiling height above the floor, meters
  extentX: [number, number] // room wall-to-wall range along axisX (meters)
  extentY: [number, number]
  wallsX: number[] // positions of wall-like planes along axisX
  wallsY: number[]
  widthIn: number
  depthIn: number
  ceilingIn: number | null
  scaleNote: string
}

/**
 * Find the floor, the room's two wall directions and its wall-to-wall size. `upHint` is the capture's
 * approximate up direction (for a phone held upright, minus the first camera's y axis).
 */
export function analyzeRoom(c: Cloud, upHint: V3 = [0, -1, 0]): RoomAnalysis {
  const N = c.count
  const P = (i: number): V3 => [c.pos[i * 3], c.pos[i * 3 + 1], c.pos[i * 3 + 2]]
  // RANSAC for near-horizontal planes; keep the lowest well-supported one as the floor.
  const sample = Math.min(N, 60000)
  const idx = new Uint32Array(sample)
  for (let i = 0; i < sample; i++) idx[i] = Math.floor((i * N) / sample)
  let rng = 12345
  const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  type Plane = { n: V3; d: number; inliers: number }
  const planes: Plane[] = []
  const tol = 0.025
  for (let it = 0; it < 1500; it++) {
    const a = P(idx[Math.floor(rand() * sample)])
    const b = P(idx[Math.floor(rand() * sample)])
    const d0 = P(idx[Math.floor(rand() * sample)])
    let n = norm(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [d0[0] - a[0], d0[1] - a[1], d0[2] - a[2]]))
    if (!Number.isFinite(n[0])) continue
    if (dot(n, upHint) < 0) n = [-n[0], -n[1], -n[2]]
    if (dot(n, upHint) < Math.cos((30 * Math.PI) / 180)) continue
    const d = dot(n, a)
    let inl = 0
    for (let k = 0; k < sample; k += 4) if (Math.abs(dot(n, P(idx[k])) - d) < tol) inl++
    planes.push({ n, d, inliers: inl })
  }
  planes.sort((p, q) => q.inliers - p.inliers)
  const best = planes[0]?.inliers ?? 0
  const strong = planes.filter((p) => p.inliers > best * 0.25)
  let up: V3 = norm(upHint)
  let floor = 0
  if (strong.length) {
    const lowest = strong.reduce((m, p) => (p.d < m.d ? p : m))
    up = lowest.n
    floor = lowest.d
  } else {
    const hs = Array.from(idx, (i) => dot(up, P(i))).sort((p, q) => p - q)
    floor = hs[Math.floor(hs.length * 0.02)]
  }
  // Ceiling: a strong horizontal plane well above the floor, if the capture saw one.
  const ceilingPlane = strong.filter((p) => p.d - floor > 1.9 && p.d - floor < 4.5).sort((p, q) => q.d - p.d)[0]
  const ceiling = ceilingPlane ? ceilingPlane.d - floor : null
  // Floor-plane basis.
  const ref: V3 = Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]
  const e1 = norm(cross(up, ref))
  const e2 = norm(cross(up, e1))
  // Points at wall height, projected onto the floor.
  const xs: number[] = []
  const ys: number[] = []
  for (let k = 0; k < sample; k++) {
    const p = P(idx[k])
    const h = dot(up, p) - floor
    if (h < 0.25 || h > 2.1) continue
    xs.push(dot(e1, p))
    ys.push(dot(e2, p))
  }
  // Wall directions: the rotation that makes the 1D histograms sharpest.
  const bin = 0.03
  let bestA = 0
  let bestS = -1
  for (let deg = 0; deg < 90; deg += 0.5) {
    const s = histSharpness(xs, ys, (deg * Math.PI) / 180, bin)
    if (s > bestS) {
      bestS = s
      bestA = deg
    }
  }
  const a = (bestA * Math.PI) / 180
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const axisX = norm([e1[0] * ca + e2[0] * sa, e1[1] * ca + e2[1] * sa, e1[2] * ca + e2[2] * sa])
  const axisY = norm(cross(up, axisX))
  const u: number[] = []
  const v: number[] = []
  for (let k = 0; k < xs.length; k++) {
    u.push(xs[k] * ca + ys[k] * sa)
    v.push(-xs[k] * sa + ys[k] * ca)
  }
  const wallsX = peaks(u, bin)
  const wallsY = peaks(v, bin)
  const extentX = extent(u, wallsX)
  const extentY = extent(v, wallsY)
  const M = 39.3701
  return {
    points: N,
    up,
    axisX,
    axisY,
    floor,
    ceiling,
    extentX,
    extentY,
    wallsX,
    wallsY,
    widthIn: Math.round((extentX[1] - extentX[0]) * M * 2) / 2,
    depthIn: Math.round((extentY[1] - extentY[0]) * M * 2) / 2,
    ceilingIn: ceiling ? Math.round(ceiling * M) : null,
    scaleNote: 'Metric scale from MapAnything; expect a few inches of error. A tape-measured check dimension will tighten it.',
  }
}

function histSharpness(xs: number[], ys: number[], a: number, bin: number) {
  const c = Math.cos(a)
  const s = Math.sin(a)
  const hx = new Map<number, number>()
  const hy = new Map<number, number>()
  for (let i = 0; i < xs.length; i++) {
    const u = Math.round((xs[i] * c + ys[i] * s) / bin)
    const v = Math.round((-xs[i] * s + ys[i] * c) / bin)
    hx.set(u, (hx.get(u) ?? 0) + 1)
    hy.set(v, (hy.get(v) ?? 0) + 1)
  }
  let t = 0
  for (const n of hx.values()) t += n * n
  for (const n of hy.values()) t += n * n
  return t
}

/** Positions (meters) of histogram peaks that look like walls. */
function peaks(vals: number[], bin: number): number[] {
  if (!vals.length) return []
  const h = new Map<number, number>()
  for (const x of vals) {
    const b = Math.round(x / bin)
    h.set(b, (h.get(b) ?? 0) + 1)
  }
  const keys = [...h.keys()].sort((p, q) => p - q)
  const max = Math.max(...h.values())
  const out: number[] = []
  for (const k of keys) {
    const n = h.get(k)!
    if (n < max * 0.18) continue
    if ((h.get(k - 1) ?? 0) > n || (h.get(k + 1) ?? 0) > n) continue
    if (out.length && Math.abs(out[out.length - 1] - k * bin) < 0.15) continue
    out.push(k * bin)
  }
  return out
}

function extent(vals: number[], walls: number[]): [number, number] {
  const s = [...vals].sort((p, q) => p - q)
  const lo = s[Math.floor(s.length * 0.01)]
  const hi = s[Math.floor(s.length * 0.99)]
  // Snap to the outermost wall peaks near the data's ends.
  const a = walls.filter((w) => Math.abs(w - lo) < 0.35).sort((p, q) => p - q)[0] ?? lo
  const b = walls.filter((w) => Math.abs(w - hi) < 0.35).sort((p, q) => q - p)[0] ?? hi
  return [a, b]
}

/** Top-down picture of the capture with a 1-foot grid and the measured size, for Velda to look at. */
export async function planImage(c: Cloud, a: RoomAnalysis, title: string): Promise<Blob> {
  const pad = 0.4
  const x0 = a.extentX[0] - pad
  const x1 = a.extentX[1] + pad
  const y0 = a.extentY[0] - pad
  const y1 = a.extentY[1] + pad
  const W = 1000
  const s = W / Math.max(x1 - x0, y1 - y0)
  const cw = Math.ceil((x1 - x0) * s)
  const ch = Math.ceil((y1 - y0) * s) + 60
  const cv = document.createElement('canvas')
  cv.width = cw
  cv.height = ch
  const g = cv.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, cw, ch)
  g.strokeStyle = '#e4e4e4'
  g.lineWidth = 1
  const ft = 0.3048
  for (let x = Math.ceil(x0 / ft) * ft; x < x1; x += ft) {
    g.beginPath()
    g.moveTo((x - x0) * s, 60)
    g.lineTo((x - x0) * s, ch)
    g.stroke()
  }
  for (let y = Math.ceil(y0 / ft) * ft; y < y1; y += ft) {
    g.beginPath()
    g.moveTo(0, 60 + (y - y0) * s)
    g.lineTo(cw, 60 + (y - y0) * s)
    g.stroke()
  }
  for (let i = 0; i < c.count; i += Math.max(1, Math.floor(c.count / 400000))) {
    const p: V3 = [c.pos[i * 3], c.pos[i * 3 + 1], c.pos[i * 3 + 2]]
    const h = dot(a.up, p) - a.floor
    if (h < 0.05 || h > 2.3) continue
    const u = dot(a.axisX, p)
    const v = dot(a.axisY, p)
    g.fillStyle = `rgba(${c.col[i * 3]},${c.col[i * 3 + 1]},${c.col[i * 3 + 2]},0.55)`
    g.fillRect((u - x0) * s, 60 + (v - y0) * s, 2, 2)
  }
  g.strokeStyle = '#c0392b'
  g.lineWidth = 2
  g.strokeRect((a.extentX[0] - x0) * s, 60 + (a.extentY[0] - y0) * s, (a.extentX[1] - a.extentX[0]) * s, (a.extentY[1] - a.extentY[0]) * s)
  g.fillStyle = '#222'
  g.font = '600 20px sans-serif'
  const fi = (inch: number) => `${Math.floor(inch / 12)}'-${Math.round(inch % 12)}"`
  g.fillText(`${title}: ${fi(a.widthIn)} along x (left-right) by ${fi(a.depthIn)} along y (top-bottom)${a.ceilingIn ? `, ceiling ${fi(a.ceilingIn)}` : ''}`, 12, 26)
  g.font = '14px sans-serif'
  g.fillText('Top-down view of the captured points between floor and 7\'-6". Grid = 1 foot. Red = measured wall-to-wall box.', 12, 48)
  return new Promise((ok) => cv.toBlob((b) => ok(b!), 'image/png'))
}

/**
 * Capture meters -> model meters (three.js world: x right, y up, z down the sheet).
 * rotation: quarter turns (0..3) of the capture's x axis relative to the plan's x axis.
 */
export function captureTransform(a: RoomAnalysis, room: { x0: number; y0: number; x1: number; y1: number }, levelElevIn: number, quarter: number): number[] {
  const IN = 0.0254
  // axisY = up x axisX is mirrored against the plan's z (x right, z down the sheet), so use its negative.
  const cxCap = (a.extentX[0] + a.extentX[1]) / 2
  const cyCap = -(a.extentY[0] + a.extentY[1]) / 2
  const cxModel = ((room.x0 + room.x1) / 2) * IN
  const czModel = ((room.y0 + room.y1) / 2) * IN
  const q = ((quarter % 4) + 4) % 4
  // Rotation of the capture's (axisX, axisY) onto the plan's (x, z).
  const R = [
    [1, 0, 0, 1],
    [0, -1, 1, 0],
    [-1, 0, 0, -1],
    [0, 1, -1, 0],
  ][q] // [a, b, c, d]: x' = a*u + b*v, z' = c*u + d*v
  // world = T + R2 * (u - cu, v - cv) with u = axisX·p, v = axisY·p, height = up·p - floor.
  const [ra, rb, rc, rd] = R
  const X: V3 = a.axisX
  const Y: V3 = [-a.axisY[0], -a.axisY[1], -a.axisY[2]]
  const U: V3 = a.up
  // Columns of the 3x3 linear part map p -> world.
  const row0: V3 = [ra * X[0] + rb * Y[0], ra * X[1] + rb * Y[1], ra * X[2] + rb * Y[2]]
  const row1: V3 = U
  const row2: V3 = [rc * X[0] + rd * Y[0], rc * X[1] + rd * Y[1], rc * X[2] + rd * Y[2]]
  const tx = cxModel - (ra * cxCap + rb * cyCap)
  const ty = levelElevIn * IN - a.floor
  const tz = czModel - (rc * cxCap + rd * cyCap)
  // Column-major 4x4.
  return [row0[0], row1[0], row2[0], 0, row0[1], row1[1], row2[1], 0, row0[2], row1[2], row2[2], 0, tx, ty, tz, 1]
}
