import './globals.css'
import { loadPlugin } from '@pascal-app/core'
import { Editor, ItemsPanel, useScene } from '@pascal-app/editor'
import { builtinPlugin } from '@pascal-app/nodes'
import { Hammer, Layers, Package, Settings } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BuildTab } from '@/components/build-tab'
import { CommunityViewerToolbarLeft, CommunityViewerToolbarRight } from '@/components/viewer-toolbar'
import { connect, ensureSchema, loadScene, saveScene, type ToolbeltSDK } from './toolbelt'

declare const __STUDIO_ASSET_BASE__: string
declare const __STUDIO_VERSION__: string

const PROJECT_ID = new URLSearchParams(location.search).get('project') || 'default'

const icon = (name: string) => (
  <img alt="" className="h-8 w-8 object-contain" src={`${__STUDIO_ASSET_BASE__}/icons/${name}.webp`} />
)
const Items = () => <ItemsPanel showSourceFilter={false} showTagFilters={false} />
const Empty = () => null

const SIDEBAR_TABS = [
  { id: 'site', label: 'Scene', component: Empty, mobileDefaultSnap: 0.5, mobileIcon: <Layers className="h-5 w-5" />, icon: icon('scene') },
  { id: 'build', label: 'Build', component: BuildTab, mobileDefaultSnap: 0.5, mobileIcon: <Hammer className="h-5 w-5" />, icon: icon('build') },
  { id: 'items', label: 'Items', component: Items, mobileDefaultSnap: 0.5, mobileIcon: <Package className="h-5 w-5" />, icon: icon('couch') },
  { id: 'settings', label: 'Settings', component: Empty, mobileDefaultSnap: 0.5, mobileIcon: <Settings className="h-5 w-5" />, icon: icon('settings') },
] as any

type Boot = { sdk: ToolbeltSDK | null }

function App() {
  const [boot, setBoot] = useState<Boot | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      await loadPlugin(builtinPlugin)
      const sdk = await connect()
      if (sdk) await ensureSchema(sdk).catch((e) => console.error('[studio] schema setup failed', e))
      // Small handle for diagnostics and for agent-driven edits.
      ;(window as any).__studio = { version: __STUDIO_VERSION__, bridge: !!sdk, project: PROJECT_ID, sdk, useScene, saves: 0, lastSaveError: null }
      console.info(`[studio] v${__STUDIO_VERSION__} bridge=${sdk ? 'toolbelt' : 'none (browser storage)'} project=${PROJECT_ID}`)
      if (alive) setBoot({ sdk })
    })().catch((e) => console.error('[studio] boot failed', e))
    return () => {
      alive = false
    }
  }, [])

  // Inside Toolbelt the scene lives in workspace DuckDB; elsewhere the editor uses browser storage.
  const persistence = useMemo(() => {
    const sdk = boot?.sdk
    if (!sdk) return {}
    return {
      onLoad: () => loadScene(sdk, PROJECT_ID),
      onSave: async (scene: unknown) => {
        const st = (window as any).__studio
        try {
          await saveScene(sdk, PROJECT_ID, PROJECT_ID, scene)
          st.saves++
          st.lastSaveError = null
        } catch (e) {
          st.lastSaveError = String(e)
          console.error('[studio] save failed', e)
          throw e
        }
      },
    }
  }, [boot])

  if (!boot) return null
  return (
    <div className="relative h-screen w-screen font-sans" data-studio-version={__STUDIO_VERSION__}>
      <Editor
        layoutVersion="v2"
        projectId={PROJECT_ID}
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={<CommunityViewerToolbarLeft />}
        viewerToolbarRight={<CommunityViewerToolbarRight />}
        {...(persistence as any)}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
