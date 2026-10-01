import './studio.css'
import { loadPlugin, MATERIAL_CATALOG } from '@pascal-app/core'
import remap from '../scripts/material-remap.json'
import { builtinPlugin } from '@pascal-app/nodes'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { boot } from './app/boot'

declare const __STUDIO_VERSION__: string

console.info(`[studio] v${__STUDIO_VERSION__}`)

// Point Pascal's material library at the texture files that actually ship with the assets.
for (const item of MATERIAL_CATALOG as any[]) {
  const maps = item?.preset?.maps
  if (!maps) continue
  for (const [key, url] of Object.entries(maps)) {
    if (typeof url !== 'string' || !(url in remap)) continue
    const to = (remap as Record<string, string | null>)[url]
    if (to) maps[key] = to
    else delete maps[key]
  }
}
loadPlugin(builtinPlugin).then(() => {
  createRoot(document.getElementById('root')!).render(<App />)
  void boot()
})
