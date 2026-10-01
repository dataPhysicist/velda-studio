// Toolbelt dashboard bridge (postMessage only) plus scene persistence in workspace DuckDB.
// When the page is opened outside Toolbelt (local dev), connect() resolves to null and the
// editor falls back to its own browser storage.

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void }

export class ToolbeltSDK {
  private requests = new Map<number, Pending>()
  private requestId = 0
  workspaceId = ''
  context: any = null

  constructor() {
    window.addEventListener('message', (event) => {
      const { type, payload, requestId } = event.data || {}
      if (!requestId || !this.requests.has(requestId)) return
      const { resolve, reject } = this.requests.get(requestId)!
      this.requests.delete(requestId)
      if (type === 'TOOLBELT_RESPONSE_ERROR') {
        const err: any = new Error(typeof payload === 'string' ? payload : payload?.message || 'Bridge error')
        if (event.data.error) {
          err.code = event.data.error.code
          err.status = event.data.error.status
        }
        reject(err)
      } else resolve(payload)
    })
  }

  sendRequest(type: string, payload: unknown = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId
      this.requests.set(id, { resolve, reject })
      window.parent.postMessage({ type, payload, requestId: id }, '*')
    })
  }

  async init() {
    this.context = await this.sendRequest('TOOLBELT_INIT')
    this.workspaceId = this.context?.workspaceId ?? ''
    return this.context
  }

  async listTools(): Promise<{ name: string }[]> {
    const payload = await this.sendRequest('TOOLBELT_LIST_TOOLS')
    return Array.isArray(payload) ? payload : Array.isArray(payload?.tools) ? payload.tools : []
  }

  runTool(tool: string, args: Record<string, unknown> = {}) {
    return this.sendRequest('TOOLBELT_RUN_TOOL', { tool, arguments: args })
  }

  async runToolParsed(tool: string, args: Record<string, unknown> = {}) {
    const result = await this.runTool(tool, args)
    const text = Array.isArray(result?.content) ? result.content.find((p: any) => p?.type === 'text')?.text : null
    if (typeof text !== 'string') return result
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  async sql(query: string, database = DB): Promise<any[]> {
    const raw = await this.sendRequest('TOOLBELT_EXECUTE_SQL', { query, parameters: [], database })
    if (Array.isArray(raw)) return raw
    const nested = raw?.rows ?? raw?.data?.rows
    return Array.isArray(nested) ? nested : []
  }
}

export const DB = 'velda_studio.duckdb'
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`

/** Resolves to a connected SDK inside Toolbelt, or null when there is no bridge. */
export async function connect(timeoutMs = 4000): Promise<ToolbeltSDK | null> {
  if (window.parent === window) return null
  const sdk = new ToolbeltSDK()
  const timeout = new Promise<null>((ok) => setTimeout(() => ok(null), timeoutMs))
  const ready = sdk.init().then(
    () => sdk,
    () => null,
  )
  return Promise.race([ready, timeout])
}

export async function ensureSchema(sdk: ToolbeltSDK) {
  await sdk.sql(
    `CREATE TABLE IF NOT EXISTS projects (id VARCHAR PRIMARY KEY, name VARCHAR, scene VARCHAR, updated_at TIMESTAMP DEFAULT now())`,
  )
}

export async function loadScene(sdk: ToolbeltSDK, projectId: string) {
  const rows = await sdk.sql(`SELECT scene FROM projects WHERE id = ${lit(projectId)}`)
  if (!rows.length || !rows[0].scene) return null
  return JSON.parse(rows[0].scene)
}

export async function saveScene(sdk: ToolbeltSDK, projectId: string, name: string, scene: unknown) {
  const json = lit(JSON.stringify(scene))
  await sdk.sql(
    `INSERT INTO projects (id, name, scene, updated_at) VALUES (${lit(projectId)}, ${lit(name)}, ${json}, now())
     ON CONFLICT (id) DO UPDATE SET scene = excluded.scene, updated_at = excluded.updated_at`,
  )
}
