// Platform checks for the signed-in Toolbelt page (spec 03 section 4, Phase 0).
//
// The app runs in a cross-origin iframe inside Toolbelt, so these checks run from inside the app and
// write their results to the database, where they can be read back without scripting the page. They
// run once when the settings row platform_check = 'run' exists in the database this build uses.
import type { Repo } from '../repo'
import { DB, lit, type ToolbeltSDK } from '../toolbelt'

declare const __STUDIO_VERSION__: string

type Result = { name: string; ok: boolean; ms: number; detail: unknown }

const FIXTURE_BASE = 'https://raw.githubusercontent.com/dataPhysicist/velda-studio/main/scripts/fixtures'

export async function maybeRunPlatformCheck(sdk: ToolbeltSDK, repo: Repo, opts: { force?: boolean } = {}) {
  if (!opts.force && (await repo.setting('platform_check').catch(() => null)) !== 'run') return null
  await repo.setSetting('platform_check', 'running')
  const runId = `pc_${Date.now().toString(36)}`
  await sdk.sql(
    `CREATE TABLE IF NOT EXISTS platform_checks (run_id VARCHAR, name VARCHAR, ok BOOLEAN, ms INTEGER, detail VARCHAR, build VARCHAR, created_at TIMESTAMP DEFAULT now())`,
    DB,
  )
  const results: Result[] = []
  const run = async (name: string, fn: () => Promise<unknown>) => {
    const t0 = performance.now()
    let r: Result
    try {
      r = { name, ok: true, ms: 0, detail: await fn() }
    } catch (e) {
      r = { name, ok: false, ms: 0, detail: String((e as Error)?.message || e).slice(0, 2000) }
    }
    r.ms = Math.round(performance.now() - t0)
    results.push(r)
    console.info('[studio] platform check', r)
    await sdk
      .sql(
        `INSERT INTO platform_checks (run_id, name, ok, ms, detail, build) VALUES (${lit(runId)}, ${lit(name)}, ${r.ok}, ${r.ms}, ${lit(JSON.stringify(r.detail))}, ${lit(__STUDIO_VERSION__)})`,
        DB,
      )
      .catch((e) => console.warn('[studio] could not record check', name, e))
  }

  await run('database', async () => {
    const tables = await sdk.sql(`SELECT table_name FROM information_schema.tables ORDER BY table_name`, DB)
    return { database: DB, tables: tables.map((t: any) => t.table_name), workspaceId: sdk.workspaceId ? 'present' : 'missing' }
  })

  await run('tool_list', async () => {
    const names = await sdk.listToolNames()
    const want = ['create_sub_chat', 'toolbelt_search_chats', 'toolbelt_get_chat', 'toolbelt_delete_chat', 'upload_file_to_storage', 'read_storage_file', 'crawling', 'web_search_exa', 'manage_shared_artifacts']
    return { count: names.length, has: Object.fromEntries(want.map((w) => [w, names.some((n) => n === w || n.endsWith(`_${w}`))])) }
  })

  await run('inline_worker', () => pingWorker())

  await run('pdfjs_inline_worker_reads_A2', async () => {
    const bytes = new Uint8Array(await (await fetch(`${FIXTURE_BASE}/A2-asbuilt-level2.pdf`, { cache: 'no-store' })).arrayBuffer())
    return pdfSummary(bytes)
  })

  await run('blob_parts_round_trip_A2_plan_jpeg', async () => {
    const bytes = new Uint8Array(await (await fetch(`${FIXTURE_BASE}/A2-asbuilt-level2.plan.jpg`, { cache: 'no-store' })).arrayBuffer())
    const id = `${runId}-a2-plan`
    const t0 = performance.now()
    await repo.saveBlob({ id, kind: 'points', name: 'platform check A2 plan JPEG', size: bytes.length, meta: { check: true } }, bytes)
    const tw = performance.now() - t0
    const back = await repo.blobBytes(id)
    const tr = performance.now() - t0 - tw
    const same = !!back && back.length === bytes.length && (await sha256(back)) === (await sha256(bytes))
    await sdk.sql(`DELETE FROM blob_parts WHERE blob_id = ${lit(id)}`, DB)
    await sdk.sql(`DELETE FROM blobs WHERE id = ${lit(id)}`, DB)
    if (!same) throw new Error(`bytes differ after the round trip (${back?.length ?? 0} of ${bytes.length})`)
    return { bytes: bytes.length, parts: Math.ceil(bytes.length / (512 * 1024)), writeMs: Math.round(tw), readMs: Math.round(tr) }
  })

  await run('subchat_relay', async () => {
    const t0 = performance.now()
    const reply = await sdk.ask('This is an automated connection check from Velda Studio. Reply with the single word pong and nothing else.', 'claude-sonnet-4-6', 90)
    return { seconds: Math.round((performance.now() - t0) / 100) / 10, reply: reply.trim().slice(0, 60) }
  })

  await repo.setSetting('platform_check', `done ${runId}`)
  return { runId, results }
}

/** Start a worker bundled into studio.js (Vite ?worker&inline, so it is a blob URL, not a CDN URL). */
export async function pingWorker() {
  const { default: PingWorker } = await import('./ping.worker?worker&inline')
  const w = new PingWorker()
  try {
    const reply = await new Promise<any>((ok, bad) => {
      const t = setTimeout(() => bad(new Error('worker did not answer in 5 s')), 5000)
      w.onmessage = (e) => (clearTimeout(t), ok(e.data))
      w.onerror = (e) => (clearTimeout(t), bad(new Error(e.message || 'worker error')))
      w.postMessage(1000)
    })
    if (reply?.sum !== 499500) throw new Error(`wrong answer ${JSON.stringify(reply)}`)
    return { sum: reply.sum }
  } finally {
    w.terminate()
  }
}

/** Open a PDF with pdf.js running on its own inline worker and count what page 1 holds. */
export async function pdfSummary(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist')
  const { default: PdfWorker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline')
  const port = new PdfWorker()
  pdfjs.GlobalWorkerOptions.workerPort = port
  try {
    const task = pdfjs.getDocument({ data: bytes })
    const doc = await task.promise
    const page = await doc.getPage(1)
    const text = await page.getTextContent()
    const ops = await page.getOperatorList()
    const OPS = pdfjs.OPS as Record<string, number>
    const count = (code: number) => ops.fnArray.filter((f) => f === code).length
    // Image paints with their pixel size. On a Designs Unlimited sheet each JPEG is drawn through a soft
    // mask whose own image is painted too, so the plan size appears twice; the adapter takes the JPEG.
    const images = ops.fnArray.flatMap((f, i) => (f === OPS.paintImageXObject ? [[ops.argsArray[i]?.[1], ops.argsArray[i]?.[2]]] : []))
    const vp = page.getViewport({ scale: 1 })
    const pages = doc.numPages
    await task.destroy()
    return {
      pdfjs: pdfjs.version,
      pages,
      pageSizePt: [Math.round(vp.width), Math.round(vp.height)],
      textItems: text.items.filter((i: any) => 'str' in i && i.str.trim()).length,
      ops: ops.fnArray.length,
      paintImageXObject: count(OPS.paintImageXObject),
      images,
      constructPath: count(OPS.constructPath),
      setGState: count(OPS.setGState),
    }
  } finally {
    port.terminate()
  }
}

async function sha256(b: Uint8Array) {
  const h = await crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
