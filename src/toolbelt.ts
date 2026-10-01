// Toolbelt dashboard bridge (postMessage only). Queries run one at a time with retries:
// overlapping queries on one workspace DuckDB file can lock it for minutes.

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; type: string }

export class ToolbeltSDK {
  private requests = new Map<number, Pending>()
  private requestId = 0
  private tools: string[] | null = null
  workspaceId = ''
  context: any = null

  constructor() {
    window.addEventListener('message', (event) => {
      const { type, payload, requestId } = event.data || {}
      if (!requestId || !this.requests.has(requestId)) return
      const pending = this.requests.get(requestId)!
      // Opened top-level with no Toolbelt shim, our own request comes straight back to us. Ignore it.
      if (type === pending.type) return
      const { resolve, reject } = pending
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
      this.requests.set(id, { resolve, reject, type })
      window.parent.postMessage({ type, payload, requestId: id }, '*')
    })
  }

  async init() {
    this.context = await this.sendRequest('TOOLBELT_INIT')
    this.workspaceId = this.context?.workspaceId ?? ''
    return this.context
  }

  /** Resolve a bare tool name (e.g. "create_sub_chat") to the exact name the bridge exposes. */
  async toolName(bare: string): Promise<string> {
    if (!this.tools) {
      const payload = await this.sendRequest('TOOLBELT_LIST_TOOLS')
      const list = Array.isArray(payload) ? payload : Array.isArray(payload?.tools) ? payload.tools : []
      this.tools = list.map((t: any) => t.name)
    }
    const tools = this.tools ?? []
    return tools.find((n) => n === bare) ?? tools.find((n) => n.endsWith('_' + bare) || n.endsWith('__' + bare)) ?? bare
  }

  async runTool(bare: string, args: Record<string, unknown> = {}) {
    return this.sendRequest('TOOLBELT_RUN_TOOL', { tool: await this.toolName(bare), arguments: args })
  }

  async runToolParsed(bare: string, args: Record<string, unknown> = {}) {
    const result = await this.runTool(bare, args)
    const text = Array.isArray(result?.content) ? result.content.find((p: any) => p?.type === 'text')?.text : null
    if (typeof text !== 'string') return result
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  private queue: Promise<unknown> = Promise.resolve()
  /** SELECT returns rows; writes return []. Serialized, with retries on lock errors. */
  sql(query: string, database = DB): Promise<any[]> {
    const run = async () => {
      let last: unknown
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const raw = await this.sendRequest('TOOLBELT_EXECUTE_SQL', { query, parameters: [], database })
          if (Array.isArray(raw)) return raw
          const nested = raw?.rows ?? raw?.data?.rows
          return Array.isArray(nested) ? nested : []
        } catch (e) {
          last = e
          const msg = String((e as Error)?.message || e)
          if (!/lock|no open database|busy|conflict|timeout/i.test(msg)) throw e
          await new Promise((ok) => setTimeout(ok, 600 * (attempt + 1)))
        }
      }
      throw last
    }
    const p = this.queue.then(run, run)
    this.queue = p.catch(() => undefined)
    return p
  }

  async readText(fileName: string): Promise<string> {
    const r = await this.runTool('read_storage_file', { fileName, raw: true })
    const text = Array.isArray(r?.content) ? r.content.find((p: any) => p?.type === 'text')?.text : null
    if (typeof text !== 'string') throw new Error(`Could not read ${fileName}`)
    return text
  }

  async upload(fileName: string, base64: string, contentType: string) {
    const r = await this.runToolParsed('upload_file_to_storage', { fileName, fileContent: base64, contentType, waitForUpload: true })
    if (r && r.success === false) throw new Error(r.error || `Upload failed for ${fileName}`)
    return fileName
  }

  async readImage(fileName: string): Promise<string | null> {
    const r = await this.runTool('read_storage_file', { fileName })
    const part = Array.isArray(r?.content) ? r.content.find((p: any) => p?.type === 'image' && p.data) : null
    return part ? `data:${part.mimeType || 'image/jpeg'};base64,${part.data}` : null
  }

  /** Ask Claude through a Velda sub-chat and wait for the answer text. */
  async ask(content: string, model: string, timeoutSeconds = 120): Promise<string> {
    const r = await this.runToolParsed('create_sub_chat', {
      content,
      targetAssistantId: this.workspaceId || undefined,
      provider: 'anthropic',
      model,
      waitForResponse: true,
      timeoutSeconds,
    })
    if (r && r.success === false) throw new Error(r.error || 'Velda could not start')
    const msg = r?.lastMessage ?? r?.result?.lastMessage ?? r?.subChat?.lastMessage ?? r?.response
    const text = typeof msg === 'string' ? msg : msg?.content ?? msg?.text
    if (typeof text === 'string' && text.trim()) return text
    if (r?.correlationId) return this.waitForDelegation(r.correlationId, timeoutSeconds)
    throw new Error('Velda did not answer')
  }

  private async waitForDelegation(correlationId: string, timeoutSeconds: number): Promise<string> {
    // The delegation's own status can lag behind the answer, so also read the callee chat directly.
    const t0 = Date.now()
    let chatId: string | null = null
    while (Date.now() - t0 < (timeoutSeconds + 60) * 1000) {
      await new Promise((ok) => setTimeout(ok, 1500))
      const st = await this.runToolParsed('manage_delegations', { action: 'status', correlationId }).catch(() => null)
      if (st?.responseContent) return String(st.responseContent)
      if (st?.status === 'failed' || st?.status === 'cancelled') throw new Error(st.errorMessage || st.progressNote || 'Velda stopped before answering')
      chatId = st?.calleeChatId ?? chatId
      if (chatId) {
        const chat = await this.runToolParsed('toolbelt', {
          action: 'get_chat',
          params: JSON.stringify({ chatId, assistantId: this.workspaceId }),
        }).catch(() => null)
        const msgs: any[] = Array.isArray(chat?.messages) ? chat.messages : []
        const last = msgs[msgs.length - 1]
        if (last?.role === 'assistant' && typeof last.content === 'string' && last.content.trim() && !chat?.isProcessing) return last.content
      }
    }
    throw new Error('Velda took too long to answer')
  }
}

export const DB = 'velda_studio.duckdb'
export const V3D_DB = 'velda3d.duckdb'
export const lit = (v: unknown) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

/**
 * Resolves to a connected SDK inside Toolbelt, or null when there is no bridge.
 * Iframed (in-app): the parent window answers. Top-level (preview or public URL): Toolbelt's
 * injected shim intercepts window.postMessage. With no bridge at all nothing answers, so time out.
 */
export async function connect(timeoutMs = window.parent === window ? 2500 : 6000): Promise<ToolbeltSDK | null> {
  const sdk = new ToolbeltSDK()
  const timeout = new Promise<null>((ok) => setTimeout(() => ok(null), timeoutMs))
  const ready = sdk.init().then(
    () => sdk,
    (e) => {
      console.warn('[studio] Toolbelt bridge init failed', e)
      return null
    },
  )
  return Promise.race([ready, timeout])
}
