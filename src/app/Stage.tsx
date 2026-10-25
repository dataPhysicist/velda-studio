// The 3D view: Pascal's viewer with simple orbit controls, focused by room and level.
import { emitter, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer, Viewer } from '@pascal-app/viewer'
import { CameraControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Box3, Vector3 } from 'three'
import { sunDirection } from '../view3d/sun'
import { clearSelection, select } from './editor'
import { type SelKind, computeFocus, focusOn, useStudio } from './store'
import { WalkControls } from './Walk'
import { CaptureLayer, Snapshotter } from './ViewerExtras'

function Controls() {
  const ref = useRef<CameraControls>(null)
  const focus = useStudio((s) => s.focus)
  const invalidate = useThree((s) => s.invalidate)
  const getThree = useThree((s) => s.get)
  useEffect(() => {
    ;(window as any).__studioCam = () => ({ controls: ref.current, three: getThree() })
    // For browser tests: where a node is in the world, and where a world point is on the page.
    ;(window as any).__studio3d = {
      centerOf: (id: string) => {
        const o = sceneRegistry.nodes.get(id)
        if (!o) return null
        const c = new Box3().setFromObject(o).getCenter(new Vector3())
        return [c.x, c.y, c.z]
      },
      positionOf: (id: string) => {
        const o = sceneRegistry.nodes.get(id)
        if (!o) return null
        const v = o.getWorldPosition(new Vector3())
        return [v.x, v.y, v.z]
      },
      boxOf: (id: string) => {
        const o = sceneRegistry.nodes.get(id)
        if (!o) return null
        const b = new Box3().setFromObject(o)
        return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z]
      },
      toScreen: (p: [number, number, number]) => {
        const { camera, gl } = getThree()
        const v = new Vector3(...p).project(camera)
        const r = gl.domElement.getBoundingClientRect()
        return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]
      },
      lookAt: async (eye: [number, number, number], at: [number, number, number]) => {
        await ref.current?.setLookAt(eye[0], eye[1], eye[2], at[0], at[1], at[2], false)
        getThree().invalidate()
      },
    }
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
        : // Three-quarter view from the south-east at 35 degrees, looking down into the cut-away rooms.
          (() => {
            // Floors spread apart stand taller than the house: step back to keep them in view.
            const apart = useStudio.getState().look.levels === 'exploded' && !focus.levelId
            const d = (span * 1.15 + 2) * (apart ? 1.6 : 1)
            const el = (35 * Math.PI) / 180
            const h = Math.cos(el)
            return c.setLookAt(center.x + d * h * 0.59, center.y + d * Math.sin(el), center.z + d * h * 0.81, center.x, center.y, center.z, true)
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

/** The model object behind a clicked 3D node (nodes carry the model id as metadata.sid). */
export function selectionOf(node: { id: string; type: string; metadata?: Record<string, unknown> }): { kind: SelKind; id: string } | null {
  const sid = node.metadata?.sid
  if (typeof sid !== 'string') return null
  switch (node.type) {
    case 'wall':
      return { kind: node.id.startsWith('wall_item_') ? 'item' : 'wall', id: sid }
    case 'door':
    case 'window':
      return { kind: 'opening', id: sid }
    case 'zone':
    case 'slab':
    case 'ceiling':
      return { kind: 'room', id: sid }
    case 'item':
    case 'cabinet':
    case 'cabinet-module':
      return { kind: 'item', id: sid }
    case 'stair':
    case 'stair-segment':
      return { kind: 'stair', id: sid }
    default:
      return null
  }
}

/** The 3D nodes that show a selected model object (for the highlight). */
function nodeIdsOf(sel: { kind: SelKind; id: string }, nodes: Record<string, unknown>): string[] {
  const has = (id: string) => id in nodes
  const ids =
    sel.kind === 'wall'
      ? [`wall_${sel.id}`]
      : sel.kind === 'opening'
        ? [`door_${sel.id}`, `window_${sel.id}`]
        : sel.kind === 'item'
          ? [`item_${sel.id}`, `cabinet_${sel.id}`, `wall_item_${sel.id}`]
          : sel.kind === 'room'
            ? [`slab_${sel.id}`]
            : sel.kind === 'stair'
              ? [`stair_${sel.id}`]
              : []
  return ids.filter(has)
}

/** Clicks in 3D select the same things the plan does; the plan's selection lights up in 3D. */
function useSharedSelection(walking: boolean) {
  useEffect(() => {
    if (walking) return
    const seen = new WeakSet<object>()
    const onClick = (e: { node: { id: string; type: string; metadata?: Record<string, unknown> }; nativeEvent: { nativeEvent?: PointerEvent } }) => {
      // One pointer event reaches every node under the cursor, nearest first (each bubbling up to its
      // level, building and site): take the nearest one that is a wall, opening, room, fixture or stair.
      const dom = e.nativeEvent?.nativeEvent
      if (dom && seen.has(dom)) return
      const sel = selectionOf(e.node)
      if (!sel) return
      if (dom) seen.add(dom)
      select(sel.kind, sel.id, !!dom?.shiftKey)
      if (sel.kind === 'room') useStudio.setState({ roomId: sel.id })
    }
    const onDouble = (e: { node: { id: string; type: string; metadata?: Record<string, unknown> } }) => {
      const sel = selectionOf(e.node)
      if (sel?.kind === 'room') focusOn({ roomId: sel.id })
    }
    emitter.on('node:click' as never, onClick as never)
    emitter.on('node:double-click' as never, onDouble as never)
    return () => {
      emitter.off('node:click' as never, onClick as never)
      emitter.off('node:double-click' as never, onDouble as never)
    }
  }, [walking])
  const selection = useStudio((s) => s.selection)
  const nodes = useScene((s) => s.nodes)
  useEffect(() => {
    const ids = walking ? [] : selection.flatMap((s) => nodeIdsOf(s, nodes as Record<string, unknown>))
    useViewer.getState().setExternalSelectedIds(ids as never)
  }, [selection, nodes, walking])
}

/** A low sun for the morning and afternoon presets; the default keeps the viewer's studio light. */
function Sun() {
  const light = useStudio((s) => s.look.light)
  const north = useStudio((s) => s.model?.project.north ?? null)
  const invalidate = useThree((s) => s.invalidate)
  const dir = useMemo(() => (light === 'studio' ? null : sunDirection(light === 'morning' ? 10 : 16, north ?? 0)), [light, north])
  useEffect(() => {
    useViewer.getState().setSceneTheme(light === 'studio' ? 'studio' : 'overcast')
    invalidate()
  }, [light, invalidate])
  if (!dir) return null
  return <directionalLight position={[dir[0] * 40, dir[1] * 40, dir[2] * 40]} intensity={light === 'morning' ? 2.4 : 2.1} color={light === 'morning' ? '#fff3dc' : '#ffe2b8'} />
}

/**
 * Frame the view once a scheme's scene is first ready. On a real GPU the viewer sets up its renderer
 * and camera after the first focus has been applied, which left the camera at its default spot
 * (seen in the Toolbelt page); framing again when the scene is ready fixes that. Later edits in the
 * same scheme do not move the camera.
 */
let framedScheme: string | null = null
function frameWhenReady(ready: boolean) {
  const st = useStudio.getState()
  if (!ready || st.walk || !st.schemeId || framedScheme === st.schemeId) return
  framedScheme = st.schemeId
  useStudio.setState({ focus: computeFocus() })
}

function lowestLevelNode() {
  const m = useStudio.getState().model
  const lv = m?.levels.slice().sort((a, b) => a.elev - b.elev)[0]
  return lv ? `level_${lv.id}` : null
}

export function Stage() {
  const focus = useStudio((s) => s.focus)
  const sceneKey = useStudio((s) => s.sceneKey)
  const walking = useStudio((s) => !!s.walk)
  const look = useStudio((s) => s.look)
  useSharedSelection(walking)
  // The plan covers the 3D view; stop drawing it meanwhile (the scene still updates, so 3D is current
  // the moment it shows again).
  const covered = useStudio((s) => s.view === 'plan' && !s.walk)
  useEffect(() => {
    const v = useViewer.getState()
    v.setShowGrid(false)
    v.setShowZones(false)
    v.setUnit('imperial')
  }, [])
  useEffect(() => {
    if (!walking) useViewer.getState().setWallMode(look.walls)
  }, [look.walls, walking])
  const firstLevels = useRef(true)
  useEffect(() => {
    if (firstLevels.current) {
      firstLevels.current = false
      return
    }
    if (!useStudio.getState().walk) useStudio.setState({ focus: computeFocus() })
  }, [look.levels])
  useEffect(() => {
    if (useStudio.getState().walk) return
    const v = useViewer.getState()
    const mode = look.levels === 'auto' ? (focus?.levelId ? 'solo' : 'stacked') : look.levels
    v.setLevelMode(mode)
    v.setSelection({ levelId: (focus?.levelId ?? (mode === 'solo' ? lowestLevelNode() : null)) as any, selectedIds: [] })
  }, [focus?.levelId, look.levels])
  return (
    <div className="stage-canvas">
      <Viewer selectionManager="custom" renderContext="viewer" sceneReadyKey={sceneKey} maxFps={walking ? 60 : 50} renderPaused={covered} onSceneReadyChange={frameWhenReady}>
        {walking ? <WalkControls /> : <Controls />}
        <Sun />
        <Snapshotter />
        <CaptureLayer />
      </Viewer>
    </div>
  )
}

