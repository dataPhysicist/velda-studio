// Things Velda can start that take longer than a model edit: measuring a room from photos or video,
// photoreal renders, and turning a product photo into a 3D model. Each posts its own message.
import { analyzeRoom, captureTransform, packCloud, parseCloud, planImage, thin, unpackCloud } from '../lib/capture'
import { polygonBounds } from '../model/geom'
import { type Op, newId as sid } from '../model/ops'
import { opKind } from '../model/table'
import type { Model as StudioModel } from '../model/types'
import { assetRegistry } from '../view3d/compile'
import { MODELS, outputUrls, runReplicate } from '../lib/replicate'
import type { Attachment, Capture } from '../repo'
import { describeCamera, nearestRatio, type Quality, RENDER_RUNS, renderPrompt } from '../ai/render'
import { snapshotView, viewPose } from './ViewerExtras'
import { addMessage, commitVersion, rerender, useStudio } from './store'

const get = useStudio.getState
const set = useStudio.setState
/** Model ops go to applyOps, actions run after the reply, turn ops (analyze, propose, research) are the page's. */
export function splitOps(ops: Op[]) {
  return {
    model: ops.filter((o) => opKind(o.op) === 'model'),
    actions: ops.filter((o) => opKind(o.op) === 'action'),
    turn: ops.filter((o) => opKind(o.op) === 'turn'),
  }
}

export async function runActions(actions: Op[]) {
  for (const a of actions) {
    try {
      if (a.op === 'capture') await captureRoom(a)
      else if (a.op === 'capture_align') await alignCapture(a)
      else if (a.op === 'render') await renderRealistic(a)
      else if (a.op === 'make_3d') await make3d(a)
    } catch (e) {
      console.error('[studio] action failed', a, e)
      await addMessage({ role: 'assistant', body: `${actionLabel(a)} did not finish: ${(e as Error).message}` })
    } finally {
      set({ activity: null })
    }
  }
}

function actionLabel(a: Op) {
  return a.op === 'capture' ? 'Measuring the room' : a.op === 'render' ? 'The realistic render' : a.op === 'make_3d' ? 'The 3D model' : 'Lining up the capture'
}

function activity(text: string) {
  set({ activity: { text, started: get().activity?.started ?? Date.now() } })
}

async function upload(path: string, blob: Blob) {
  const sdk = get().sdk
  if (!sdk) return path
  const b64 = await new Promise<string>((ok, bad) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result).split(',')[1] ?? '')
    r.onerror = bad
    r.readAsDataURL(blob)
  })
  await sdk.upload(path, b64, blob.type || 'application/octet-stream')
  return path
}

async function link(pathOrUrl: string) {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl
  return get().sdk!.signedUrl(pathOrUrl)
}

function findRoom(model: StudioModel, key: any) {
  const k = String(key ?? '').toLowerCase()
  return (
    model.rooms.find((r) => r.id === key) ??
    model.rooms.find((r) => r.name.toLowerCase() === k) ??
    model.rooms.find((r) => r.name.toLowerCase().includes(k)) ??
    (get().roomId ? model.rooms.find((r) => r.id === get().roomId) : null) ??
    null
  )
}

// ------------------------------------------------------------------ capture (photos or video -> measured room)

async function captureRoom(a: Op) {
  const { sdk, repo, model } = get()
  if (!sdk || !repo || !model) throw new Error('needs Toolbelt')
  const room = findRoom(model, a.room)
  if (!room) throw new Error('I could not tell which room these photos show')
  const media: string[] = (Array.isArray(a.media) ? a.media : []).filter((p: any) => typeof p === 'string')
  if (media.length < 2) throw new Error('send at least 2 photos (8 to 20 from different spots works best), or a short video')
  const id = sid('cap')
  activity(`Measuring the ${room.name.toLowerCase()} from ${media.length} photos`)
  const urls = await Promise.all(media.slice(0, 24).map(link))
  // Schema checked 2026-10-02: field `inputs` (image URLs), output {point_cloud: GLB, mesh: GLB, data: [JSON per frame]}.
  const res = await runReplicate(sdk, MODELS.reconstruct, { inputs: urls, return_pcd: true, return_mesh: false }, {
    timeoutSeconds: 600, // cold starts take about 3 to 4 minutes
    note: 'The images are frames of one indoor room. Use these exact field names.',
  })
  activity('Reading the 3D points')
  let cloud = null as Awaited<ReturnType<typeof parseCloud>> | null
  const pc = res.output && typeof res.output === 'object' && typeof res.output.point_cloud === 'string' ? [res.output.point_cloud] : []
  for (const u of pc.length ? pc : outputUrls(res.output)) {
    if (/\.(json|txt|npz|npy|png|jpg|jpeg|mp4)(\?|$)/i.test(u)) continue
    try {
      const buf = await (await fetch(u)).arrayBuffer()
      const c = await parseCloud(buf, u)
      if (!cloud || c.count > cloud.count) cloud = c
    } catch (e) {
      console.warn('[studio] not a point cloud', u, e)
    }
  }
  if (!cloud || cloud.count < 1000) throw new Error('the reconstruction came back without a usable point cloud')
  cloud = thin(cloud, 220000)
  const analysis = analyzeRoom(cloud)
  const lv = model.levels.find((l) => l.id === room.level) ?? model.levels[0]
  const b = polygonBounds(room.polygon)
  const mw = b.x1 - b.x0
  const md = b.y1 - b.y0
  const straight = Math.abs(analysis.widthIn - mw) + Math.abs(analysis.depthIn - md)
  const turned = Math.abs(analysis.widthIn - md) + Math.abs(analysis.depthIn - mw)
  const quarter = straight <= turned ? 0 : 1
  const transform = captureTransform(analysis, b, lv.elev, quarter)
  activity('Drawing a plan of what was captured')
  const plan = await planImage(cloud, analysis, room.name)
  const planPath = await upload(`velda-studio/captures/${id}-plan.png`, plan)
  await repo.saveBlob({ id: `${id}-points`, kind: 'points', name: `${room.name} capture`, size: 0, meta: {} }, packCloud(cloud))
  const cap: Capture = {
    id,
    room_id: room.id,
    level: room.level,
    name: room.name,
    status: 'measured',
    media,
    blob_id: `${id}-points`,
    analysis: { ...analysis, plan: planPath, quarter },
    transform,
  }
  await repo.saveCapture(cap)
  set((s) => ({ clouds: [...s.clouds.filter((c) => c.id !== id), { id, level: room.level, pos: cloud!.pos, col: cloud!.col, transform }], showCaptures: true }))
  // Observe, build, verify (after AWSM): Velda compares photos and measurements with the model and edits it.
  activity('Velda is comparing the photos with the model')
  const { observeAndBuild } = await import('./store')
  await observeAndBuild({ capture: cap, planPath, room })
}

async function alignCapture(a: Op) {
  const { repo, model } = get()
  if (!repo || !model) return
  const caps = await repo.captures()
  const cap = caps.find((c) => c.id === a.id) ?? caps.filter((c) => !a.room || c.room_id === findRoom(model, a.room)?.id).pop()
  if (!cap?.analysis) throw new Error('there is no capture to line up')
  const room = model.rooms.find((r) => r.id === cap.room_id)
  if (!room) throw new Error('the captured room is no longer in this scheme')
  const lv = model.levels.find((l) => l.id === room.level) ?? model.levels[0]
  const quarter = Number(a.quarter ?? a.rotation / 90) || 0
  const transform = captureTransform(cap.analysis as any, polygonBounds(room.polygon), lv.elev, quarter)
  await repo.saveCapture({ ...cap, transform, analysis: { ...cap.analysis, quarter } })
  set((s) => ({ clouds: s.clouds.map((c) => (c.id === cap.id ? { ...c, transform } : c)) }))
}

export async function loadCaptures() {
  const { repo } = get()
  if (!repo) return
  const caps = await repo.captures().catch(() => [])
  const clouds = []
  for (const c of caps) {
    if (!c.blob_id || !c.transform) continue
    const bytes = await repo.blobBytes(c.blob_id).catch(() => null)
    if (!bytes) continue
    const cl = unpackCloud(bytes)
    clouds.push({ id: c.id, level: c.level, pos: cl.pos, col: cl.col, transform: c.transform })
  }
  set({ clouds })
}

// ------------------------------------------------------------------ realistic renders

async function renderRealistic(a: Op) {
  const { sdk, model } = get()
  if (!sdk || !model) throw new Error('needs Toolbelt')
  const id = sid('r')
  const room = findRoom(model, a.room) ?? (get().roomId ? (model.rooms.find((r) => r.id === get().roomId) ?? null) : null)
  const theme = (room?.theme && model.themes[room.theme]) || (model.theme ? model.themes[model.theme] : null)
  const quality: Quality = a.quality === 'best' ? 'best' : 'standard'
  const photo = !!a.from && a.from !== 'view'
  activity(photo ? 'Painting the new design into your photo' : 'Rendering this view realistically')
  const started = Date.now()
  // The camera in words, from the 3D view as it is now (a photo keeps its own camera).
  const pose = photo ? null : viewPose()
  const camera = pose ? describeCamera(model, room?.level ?? get().levelId, pose) : null
  // The render keeps the shape of the view (or the photo), asked for outright.
  const shape = nearestRatio(photo ? ((await photoAspect(String(a.from))) ?? 1.5) : (pose?.aspect ?? 1.5))
  let sourcePath: string
  let designPath: string | null = null
  if (photo) {
    sourcePath = String(a.from)
    // A view of the design from the 3D model helps hold the layout; the photo holds the camera.
    designPath = await upload(`velda-studio/renders/${id}-design.png`, await snapshotView(shape.w, shape.h)).catch(() => null)
  } else {
    sourcePath = await upload(`velda-studio/renders/${id}-view.png`, await snapshotView(shape.w, shape.h))
  }
  // Style references (07 section 8): the room's inspiration pictures first, then the theme's, then any
  // Velda named; six at most.
  const refs: string[] = []
  const refNames: string[] = []
  const add = async (p: string | undefined, name?: string) => {
    if (!p || refs.length >= 6) return
    const u = /^https?:/.test(p) ? p : await link(p).catch(() => '')
    if (u && !refs.includes(u)) {
      refs.push(u)
      refNames.push(name ?? p.split('/').pop() ?? p)
    }
  }
  // The room's cards that share the most colors with its theme come first: those are the ones the
  // theme was made from.
  const themeHex = new Set((theme?.data.palette ?? []).map((p) => p.hex.toLowerCase()))
  const shared = (c: (typeof model.inspiration)[number]) => new Set([...c.tags.palette, ...(c.sampled ?? [])].map((p) => p.hex.toLowerCase()).filter((h) => themeHex.has(h))).size
  const cards = room
    ? model.inspiration
        .filter((c) => c.kind !== 'board' && c.rooms.includes(room.id) && c.image)
        .map((c, i) => ({ c, i, n: shared(c) }))
        .sort((x, y) => y.n - x.n || x.i - y.i)
        .map((x) => x.c)
    : []
  for (const c of cards.slice(0, 4)) await add(c.image, c.title)
  for (const im of (theme?.data.images ?? []).slice(0, 2)) await add(im.url ?? im.path, im.name)
  for (const r of Array.isArray(a.refs) ? a.refs : []) await add(String(r))
  const images = [await link(sourcePath), ...(designPath ? [await link(designPath)] : []), ...refs]
  const prompt = renderPrompt({ model, room, theme, photo, design: !!designPath, refs: refs.length, camera, words: typeof a.prompt === 'string' ? a.prompt : null })
  const run = RENDER_RUNS[quality]
  const res = await runReplicate(sdk, run.model, {
    prompt,
    image_input: images,
    aspect_ratio: shape.ratio,
    resolution: run.resolution,
    output_format: 'jpg',
  })
  const url = outputUrls(res.output)[0]
  if (!url) throw new Error('no image came back')
  const blob = await (await fetch(url)).blob()
  const outPath = await upload(`velda-studio/renders/${id}.jpg`, blob)
  const seconds = (Date.now() - started) / 1000
  const before: Attachment = { path: sourcePath, name: photo ? 'Your photo' : 'Model view', type: 'image/png', role: 'before' }
  const after: Attachment = { path: outPath, name: 'Realistic render', type: 'image/jpeg', role: 'after', preview: URL.createObjectURL(blob) }
  await addMessage({
    role: 'assistant',
    body: photo ? 'Here is your room with the new design. Drag across the picture to compare it with your photo.' : 'Here is that view rendered realistically. Drag across it to compare with the model.',
    attachments: [before, after],
    meta: {
      render: {
        quality,
        model: run.model,
        resolution: run.resolution,
        ratio: shape.ratio,
        usd: run.usd,
        seconds: Math.round(seconds),
        ...(res.predict_time ? { predict: Math.round(res.predict_time) } : {}),
        ...(res.id ? { prediction: res.id } : {}),
        room: room?.id ?? null,
        from: photo ? String(a.from) : 'view',
        words: typeof a.prompt === 'string' ? a.prompt : '',
        refs: refNames,
        camera,
        prompt,
      },
    },
  })
}

/** Width over height of a stored photo, or null when it cannot be read. */
async function photoAspect(path: string): Promise<number | null> {
  try {
    const src = /^https?:/.test(path) ? path : await get().sdk!.readImage(path)
    if (!src) return null
    const img = new Image()
    img.src = src
    await img.decode()
    return img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : null
  } catch {
    return null
  }
}

// ------------------------------------------------------------------ product photo -> 3D model

async function make3d(a: Op) {
  const { sdk, repo, model } = get()
  if (!sdk || !repo || !model) throw new Error('needs Toolbelt')
  const it = model.items.find((i) => i.id === a.id)
  if (!it) throw new Error(`no item ${a.id}`)
  const image = String(a.image ?? it.props?.image ?? '')
  if (!image) throw new Error('there is no product photo to model from')
  activity(`Building a 3D model of the ${it.label.toLowerCase()}`)
  // Default face_count (500k) makes ~35 MB GLBs; 60k keeps furniture crisp at a few MB.
  const res = await runReplicate(sdk, MODELS.to3d, { image: await link(image), face_count: 60000, generate_type: 'Normal' }, {
    timeoutSeconds: 480,
    note: 'Single product photo; we need a textured GLB mesh. Use these exact field names.',
  })
  const url = outputUrls(res.output).find((u) => /\.glb(\?|$)/i.test(u)) ?? outputUrls(res.output)[0]
  if (!url) throw new Error('no 3D file came back')
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
  const bounds = await glbBounds(bytes)
  const blobId = sid('glb')
  await repo.saveBlob({ id: blobId, kind: 'glb', name: it.label, size: bytes.length, meta: bounds }, bytes)
  registerGlb(blobId, bytes, bounds)
  const next = structuredClone(get().model!)
  const target = next.items.find((i) => i.id === it.id)
  if (!target) return
  target.kind = 'item'
  target.props = { ...(target.props ?? {}), asset: blobId }
  const v = await commitVersion(next, `3D model for ${it.label}`, 'make_3d')
  await addMessage({ role: 'assistant', body: `The ${it.label.toLowerCase()} is now a real 3D model in the room, at ${Math.round(it.w)}" wide.`, version_id: v.id })
}

/**
 * Size and floor offset of a GLB, read from its JSON (accessor min/max through the node transforms),
 * so Draco-compressed files measure without decoding.
 */
export async function glbBounds(bytes: Uint8Array) {
  const THREE = await import('three')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file')
  const jsonLen = dv.getUint32(12, true)
  const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)))
  const box = new THREE.Box3()
  const visit = (ni: number, parent: InstanceType<typeof THREE.Matrix4>) => {
    const n = gltf.nodes?.[ni] ?? {}
    const local = new THREE.Matrix4()
    if (n.matrix) local.fromArray(n.matrix)
    else
      local.compose(
        new THREE.Vector3(...(n.translation ?? [0, 0, 0])),
        new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
        new THREE.Vector3(...(n.scale ?? [1, 1, 1])),
      )
    const world = parent.clone().multiply(local)
    if (n.mesh !== undefined) {
      for (const prim of gltf.meshes?.[n.mesh]?.primitives ?? []) {
        const acc = gltf.accessors?.[prim.attributes?.POSITION]
        if (!acc?.min || !acc?.max) continue
        const [a, b] = [acc.min, acc.max]
        for (const x of [a[0], b[0]]) for (const y of [a[1], b[1]]) for (const z of [a[2], b[2]]) box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(world))
      }
    }
    for (const c of n.children ?? []) visit(c, world)
  }
  const scene = gltf.scenes?.[gltf.scene ?? 0]
  for (const ni of scene?.nodes ?? []) visit(ni, new THREE.Matrix4())
  if (box.isEmpty()) throw new Error('the 3D file has no geometry')
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  return {
    size: [size.x || 1, size.y || 1, size.z || 1] as [number, number, number],
    offset: [-center.x, -box.min.y, -center.z] as [number, number, number],
  }
}

export function registerGlb(id: string, bytes: Uint8Array, meta: { size: [number, number, number]; offset: [number, number, number] }) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'model/gltf-binary' }))
  assetRegistry[id] = { url, size: meta.size, offset: meta.offset }
}

/** Load generated models the current scheme uses, then redraw. */
export async function loadAssets(model: StudioModel) {
  const { repo } = get()
  if (!repo) return
  const ids = [...new Set(model.items.map((i) => i.props?.asset).filter((x): x is string => typeof x === 'string'))].filter((id) => !assetRegistry[id])
  if (!ids.length) return
  for (const id of ids) {
    const meta = await repo.blobMeta(id).catch(() => null)
    const bytes = meta ? await repo.blobBytes(id).catch(() => null) : null
    if (meta && bytes) registerGlb(id, bytes, meta.meta as any)
  }
  rerender()
}
