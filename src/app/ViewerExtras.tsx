// Inside the viewer: snapshots of the current view (for photoreal renders and checks) and the
// captured point clouds drawn in place.
import { createSnapshotPipeline, type SnapshotPipeline, useSceneAtmosphere } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useStudio } from './store'

let pipelineRef: { current: SnapshotPipeline | null; camera: THREE.PerspectiveCamera | null; get: (() => any) | null } = {
  current: null,
  camera: null,
  get: null,
}

/** PNG/WebP of what the viewer shows now (optionally from another camera pose), at w x h. */
export async function snapshotView(w = 1536, h = 1024, pose?: { position: number[]; quaternion: number[]; fov: number }): Promise<Blob> {
  const p = pipelineRef.current
  const cam = pipelineRef.camera
  const three = pipelineRef.get?.()
  if (!p || !cam || !three) throw new Error('The 3D view is not ready for a snapshot yet')
  const main = three.camera as THREE.PerspectiveCamera
  const { width, height } = three.gl.domElement
  cam.position.copy(main.position)
  cam.quaternion.copy(main.quaternion)
  cam.fov = main.fov
  cam.near = main.near
  cam.far = main.far
  cam.aspect = width / height
  if (pose) {
    cam.position.fromArray(pose.position)
    cam.quaternion.fromArray(pose.quaternion)
    const aspect = width / height
    const out = w / h
    const cropH = aspect < out ? Math.round(width / out) : height
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(pose.fov) / 2) * (height / cropH)))
  }
  cam.zoom = 1
  cam.updateProjectionMatrix()
  cam.updateMatrixWorld()
  const res = await p.capture({ captureMode: 'standard', standardSize: { w, h } })
  return res.blob
}

export function Snapshotter() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const get = useThree((s) => s.get)
  const atmosphere = useSceneAtmosphere()
  useEffect(() => {
    let alive = true
    const cam = new THREE.PerspectiveCamera(60, 1.5, 0.05, 1000)
    pipelineRef.camera = cam
    pipelineRef.get = get
    createSnapshotPipeline({ renderer: gl as any, scene, camera: cam, atmosphere })
      .then((p) => {
        if (!alive) return p?.dispose()
        pipelineRef.current = p
      })
      .catch((e) => console.warn('[studio] snapshot pipeline unavailable', e))
    return () => {
      alive = false
      pipelineRef.current?.dispose()
      pipelineRef.current = null
    }
  }, [gl, scene, atmosphere, get])
  return null
}

/** Captured rooms as colored points, placed by each capture's transform. */
export function CaptureLayer() {
  const clouds = useStudio((s) => s.clouds)
  const show = useStudio((s) => s.showCaptures)
  const levelId = useStudio((s) => s.walk?.levelId ?? s.levelId)
  const visible = useMemo(() => clouds.filter((c) => !levelId || c.level === levelId), [clouds, levelId])
  if (!show || !visible.length) return null
  return (
    <group>
      {visible.map((c) => (
        <CloudPoints key={c.id} cloud={c} />
      ))}
    </group>
  )
}

function CloudPoints({ cloud }: { cloud: { id: string; pos: Float32Array; col: Uint8Array; transform: number[] } }) {
  const ref = useRef<THREE.Points>(null)
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(cloud.pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(cloud.col, 3, true))
    return g
  }, [cloud])
  const mat = useMemo(() => new THREE.PointsMaterial({ size: 0.012, vertexColors: true, sizeAttenuation: true }), [])
  const matrix = useMemo(() => new THREE.Matrix4().fromArray(cloud.transform), [cloud.transform])
  useEffect(() => () => geom.dispose(), [geom])
  return <points ref={ref} geometry={geom} material={mat} matrix={matrix} matrixAutoUpdate={false} frustumCulled={false} />
}
