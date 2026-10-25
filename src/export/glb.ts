// model.glb (08 section 5): the model in 3D, meters, y up, one node per level, wall, window glass,
// room floor and fixture, each named by its model id. Built with the share viewer's light builder so
// it does not depend on the studio's 3D view being open.
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { Model } from '../model/types'
import { buildScene } from '../viewer/scene3d'

export async function toGlb(m: Model): Promise<ArrayBuffer> {
  const built = buildScene(THREE, m, { level: null, cut: false })
  built.group.name = m.project.name
  const out = await new GLTFExporter().parseAsync(built.group, { binary: true })
  return out as ArrayBuffer
}
