import { useScene } from '@pascal-app/core'

export type Focus = {
  key: string
  levelId: string | null // Pascal level node id; null = whole house
  box: [number, number, number, number, number, number] // meters: minX, minY, minZ, maxX, maxY, maxZ
  view: '3d' | 'plan'
}

/** Replace the scene shown in the viewer. */
export function showScene(compiled: { nodes: Record<string, any>; rootNodeIds: string[]; materials: Record<string, any> }) {
  useScene.getState().setScene(compiled.nodes as any, compiled.rootNodeIds as any, { materials: compiled.materials as any })
}
