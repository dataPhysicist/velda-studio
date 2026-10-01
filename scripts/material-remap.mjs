// Pascal 1.0.3's material library points at *_512.ktx2 textures, but many of the bundled assets are
// JPG/WebP with other names. Build a table from each missing URL to the file that does exist.
import fs from 'node:fs'
import path from 'node:path'
import { MATERIAL_CATALOG } from '@pascal-app/core'
const root = path.resolve('assets')
const out = {}
let ok = 0, fixed = 0, dropped = 0
const kinds = {
  albedoMap: [/basecolor/i, /diffuse/i, /albedo/i, /color/i],
  aoMap: [/_ao[._]/i, /-ao\./i, /ambientocclusion/i, /occlusion/i],
  normalMap: [/normal/i],
  roughnessMap: [/roughness/i],
  metalnessMap: [/metallic/i, /metalness/i],
  displacementMap: [/height/i, /displacement/i],
}
for (const item of MATERIAL_CATALOG) {
  const maps = item.preset?.maps ?? {}
  for (const [key, url] of Object.entries(maps)) {
    if (typeof url !== 'string') continue
    const abs = path.join(root, url)
    if (fs.existsSync(abs)) { ok++; continue }
    const dir = path.dirname(abs)
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(jpg|jpeg|png|webp|ktx2)$/i.test(f) && !/thumb/i.test(f)) : []
    const pats = kinds[key] ?? []
    let hit = null
    for (const p of pats) { hit = files.find((f) => p.test(f)); if (hit) break }
    if (hit) { out[url] = path.posix.join(path.posix.dirname(url), hit); fixed++ }
    else { out[url] = null; dropped++ }
  }
}
fs.writeFileSync('scripts/material-remap.json', JSON.stringify(out, null, 0))
console.log({ ok, fixed, dropped })
