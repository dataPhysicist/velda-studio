// The 3D view: Pascal's viewer with simple orbit controls, focused by room and level.
import { useViewer, Viewer } from '@pascal-app/viewer'
import { CameraControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Box3, Vector3 } from 'three'
import { useStudio } from './store'

function Controls() {
  const ref = useRef<CameraControls>(null)
  const focus = useStudio((s) => s.focus)
  const invalidate = useThree((s) => s.invalidate)
  const getThree = useThree((s) => s.get)
  useEffect(() => {
    ;(window as any).__studioCam = () => ({ controls: ref.current, three: getThree() })
  }, [getThree])
  useEffect(() => {
    const c = ref.current
    if (!c || !focus) return
    const [x0, y0, z0, x1, y1, z1] = focus.box
    const box = new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1))
    const center = box.getCenter(new Vector3())
    const size = box.getSize(new Vector3())
    const span = Math.max(size.x, size.z, 2.5)
    let moving = true
    let raf = 0
    // The viewer renders on demand, so keep frames coming while the camera glides.
    const tick = () => {
      invalidate()
      if (moving) raf = requestAnimationFrame(tick)
    }
    tick()
    const done =
      focus.view === 'plan'
        ? c.setLookAt(center.x, center.y + span * 1.35, center.z + 0.001, center.x, center.y, center.z, true)
        : // Three-quarter view from the south-east, looking down into the cut-away rooms.
          (() => {
            const d = span * 1.05 + 2
            return c.setLookAt(center.x + d * 0.55, center.y + d * 0.85, center.z + d * 0.75, center.x, center.y, center.z, true)
          })()
    const stop = () => {
      moving = false
      invalidate()
    }
    Promise.resolve(done).then(stop, stop)
    const guard = setTimeout(stop, 2500)
    return () => {
      moving = false
      cancelAnimationFrame(raf)
      clearTimeout(guard)
    }
  }, [focus, invalidate])
  return <CameraControls ref={ref} makeDefault minDistance={0.8} maxDistance={80} dollyToCursor smoothTime={0.35} />
}

export function Stage() {
  const focus = useStudio((s) => s.focus)
  const sceneKey = useStudio((s) => s.sceneKey)
  useEffect(() => {
    const v = useViewer.getState()
    v.setWallMode('cutaway')
    v.setShowGrid(false)
    v.setShowZones(false)
    v.setUnit('imperial')
  }, [])
  useEffect(() => {
    const v = useViewer.getState()
    if (focus?.levelId) {
      v.setLevelMode('solo')
      v.setSelection({ levelId: focus.levelId as any, selectedIds: [] })
    } else {
      v.setLevelMode('stacked')
      v.setSelection({ levelId: null, selectedIds: [] })
    }
  }, [focus?.levelId])
  return (
    <div className="stage-canvas">
      <Viewer selectionManager="custom" renderContext="viewer" sceneReadyKey={sceneKey}>
        <Controls />
      </Viewer>
    </div>
  )
}

