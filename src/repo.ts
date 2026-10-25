// Persistence: schemes, versions (each holds a full model), messages, comments, saved themes.
// Inside Toolbelt this is workspace DuckDB (velda_studio_dev.duckdb until 1.0); outside it, memory (local dev).

import type { StudioModel } from './lib/model'
import type { Theme } from './lib/theme'
import type { Author, Comment, Model } from './model/types'
import { DB, lit, type ToolbeltSDK } from './toolbelt'

/** Model rows this build writes. A build refuses to open a database written by a newer schema. */
export const SCHEMA_VERSION = 2

/** A version row holds either a v0.3 model (migrated on first open) or a v2 model. */
export type StoredModel = Model | StudioModel

export type Scheme = { id: string; name: string; head_version: string | null; sort: number; role?: 'asbuilt' | 'proposed' | null; created_at?: string }
export type Version = {
  id: string
  scheme_id: string
  seq: number
  summary: string
  source: string
  parent_id?: string | null
  author?: Author | null
  ops_json?: string | null
  label?: string | null
  created_at?: string
}
export type Attachment = { path: string; name: string; type: string; preview?: string; role?: 'before' | 'after' }
export type Message = {
  id: string
  scheme_id: string
  role: 'user' | 'assistant' | 'system'
  body: string
  attachments?: Attachment[]
  version_id?: string | null
  chips?: string[]
  /** Design options Velda proposed (each its own scheme), what it searched for, and so on. */
  meta?: MessageMeta
  created_at?: string
}

export type MessageMeta = {
  choices?: { label: string; scheme_id: string; room?: string | null; level?: string | null }[]
  research?: string[]
  /** Products Velda found (research results), each placeable in the room the talk was about. */
  products?: { title: string; url: string; type?: string; w?: number; d?: number; price?: string; image?: string; room?: string | null }[]
  /** A realistic render: how it was made (quality, model, size, estimated cost, time) and the prompt the app wrote. */
  render?: {
    quality: 'standard' | 'best'
    model: string
    resolution: string
    usd: number
    seconds: number
    predict?: number
    prediction?: string
    room: string | null
    from: string
    words: string
    refs: string[]
    camera: string | null
    prompt: string
  }
}

export interface Repo {
  kind: 'duckdb' | 'memory'
  init(): Promise<void>
  schemes(): Promise<Scheme[]>
  saveScheme(s: Scheme): Promise<void>
  deleteScheme(id: string): Promise<void>
  versions(schemeId: string): Promise<Version[]>
  model(versionId: string): Promise<StoredModel | null>
  addVersion(v: Version, model: Model): Promise<void>
  comments(schemeId: string): Promise<Comment[]>
  saveComment(c: Comment): Promise<void>
  messages(schemeId: string): Promise<Message[]>
  addMessage(m: Message): Promise<void>
  themes(): Promise<Theme[]>
  saveTheme(t: Theme): Promise<void>
  setting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>
  saveBlob(b: BlobMeta, bytes: Uint8Array): Promise<void>
  blobMeta(id: string): Promise<BlobMeta | null>
  blobBytes(id: string): Promise<Uint8Array | null>
  captures(): Promise<Capture[]>
  saveCapture(c: Capture): Promise<void>
}

/** Binary assets kept in DuckDB (generated 3D models, captured point clouds), base64 in 512 KB parts. */
export type BlobMeta = { id: string; kind: 'glb' | 'points' | 'pdf' | 'plan'; name: string; size: number; meta: Record<string, unknown> }
/** A room captured from photos or video: where its point cloud sits in the plan and what was measured. */
export type Capture = {
  id: string
  room_id: string
  level: string
  name: string
  status: string
  media: string[] // storage paths of the frames used
  blob_id: string | null // point cloud
  analysis: Record<string, unknown> | null
  transform: number[] | null // 4x4 column-major, capture meters -> model meters
  created_at?: string
}

const CHUNK = 512 * 1024
export function toB64(bytes: Uint8Array) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
export function fromB64(b64: string) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const json = (v: unknown) => lit(JSON.stringify(v ?? null))
const parse = <T,>(v: unknown, fallback: T): T => {
  if (v == null || v === '') return fallback
  if (typeof v !== 'string') return v as T
  try {
    return JSON.parse(v)
  } catch {
    return fallback
  }
}

export class DuckRepo implements Repo {
  kind = 'duckdb' as const
  constructor(private sdk: ToolbeltSDK) {}
  private q(sql: string) {
    return this.sdk.sql(sql, DB)
  }
  async init() {
    await this.q(`CREATE TABLE IF NOT EXISTS schemes (id VARCHAR PRIMARY KEY, name VARCHAR, head_version VARCHAR, sort INTEGER, created_at TIMESTAMP DEFAULT now())`)
    await this.q(
      `CREATE TABLE IF NOT EXISTS versions (id VARCHAR PRIMARY KEY, scheme_id VARCHAR, seq INTEGER, summary VARCHAR, source VARCHAR, model VARCHAR, created_at TIMESTAMP DEFAULT now())`,
    )
    await this.q(
      `CREATE TABLE IF NOT EXISTS messages (id VARCHAR PRIMARY KEY, scheme_id VARCHAR, role VARCHAR, body VARCHAR, attachments VARCHAR, version_id VARCHAR, chips VARCHAR, created_at TIMESTAMP DEFAULT now())`,
    )
    await this.q(`CREATE TABLE IF NOT EXISTS themes (id VARCHAR PRIMARY KEY, name VARCHAR, data VARCHAR, updated_at TIMESTAMP DEFAULT now())`)
    await this.q(`CREATE TABLE IF NOT EXISTS settings (key VARCHAR PRIMARY KEY, value VARCHAR)`)
    await this.q(`CREATE TABLE IF NOT EXISTS blobs (id VARCHAR PRIMARY KEY, kind VARCHAR, name VARCHAR, size BIGINT, parts INTEGER, meta VARCHAR, created_at TIMESTAMP DEFAULT now())`)
    await this.q(`CREATE TABLE IF NOT EXISTS blob_parts (blob_id VARCHAR, seq INTEGER, data VARCHAR)`)
    await this.q(
      `CREATE TABLE IF NOT EXISTS captures (id VARCHAR PRIMARY KEY, room_id VARCHAR, level VARCHAR, name VARCHAR, status VARCHAR, media VARCHAR, blob_id VARCHAR, analysis VARCHAR, transform VARCHAR, created_at TIMESTAMP DEFAULT now())`,
    )
    // Model v2: who made each version, from what, and the operations that produced it.
    for (const col of ['parent_id', 'author', 'ops_json', 'label']) await this.q(`ALTER TABLE versions ADD COLUMN IF NOT EXISTS ${col} VARCHAR`)
    await this.q(`ALTER TABLE schemes ADD COLUMN IF NOT EXISTS role VARCHAR`)
    await this.q(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS meta VARCHAR`)
    await this.q(
      `CREATE TABLE IF NOT EXISTS comments (id VARCHAR PRIMARY KEY, scheme_id VARCHAR, level VARCHAR, at_x DOUBLE, at_y DOUBLE, target VARCHAR, body VARCHAR, author VARCHAR, resolved BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT now())`,
    )
    await this.q(`CREATE TABLE IF NOT EXISTS comment_replies (id VARCHAR PRIMARY KEY, comment_id VARCHAR, body VARCHAR, author VARCHAR, created_at TIMESTAMP DEFAULT now())`)
    await checkSchema(this)
  }
  async saveBlob(b: BlobMeta, bytes: Uint8Array) {
    await this.q(`DELETE FROM blob_parts WHERE blob_id = ${lit(b.id)}`)
    const parts = Math.ceil(bytes.length / CHUNK)
    for (let i = 0; i < parts; i++) {
      await this.q(`INSERT INTO blob_parts (blob_id, seq, data) VALUES (${lit(b.id)}, ${i}, '${toB64(bytes.subarray(i * CHUNK, (i + 1) * CHUNK))}')`)
    }
    await this.q(
      `INSERT INTO blobs (id, kind, name, size, parts, meta) VALUES (${lit(b.id)}, ${lit(b.kind)}, ${lit(b.name)}, ${bytes.length}, ${parts}, ${json(b.meta)})
       ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, name = excluded.name, size = excluded.size, parts = excluded.parts, meta = excluded.meta`,
    )
  }
  async blobMeta(id: string) {
    const rows = await this.q(`SELECT id, kind, name, size, meta FROM blobs WHERE id = ${lit(id)}`)
    return rows.length ? ({ ...rows[0], size: Number(rows[0].size), meta: parse(rows[0].meta, {}) } as BlobMeta) : null
  }
  async blobBytes(id: string) {
    const head = await this.q(`SELECT parts, size FROM blobs WHERE id = ${lit(id)}`)
    if (!head.length) return null
    const parts = Number(head[0].parts)
    const out = new Uint8Array(Number(head[0].size))
    let off = 0
    for (let i = 0; i < parts; i++) {
      const rows = await this.q(`SELECT data FROM blob_parts WHERE blob_id = ${lit(id)} AND seq = ${i}`)
      if (!rows.length) return null
      const b = fromB64(rows[0].data)
      out.set(b, off)
      off += b.length
    }
    return out
  }
  async captures() {
    const rows = await this.q(
      `SELECT id, room_id, level, name, status, media, blob_id, analysis, transform, CAST(created_at AS VARCHAR) created_at FROM captures ORDER BY created_at`,
    )
    return rows.map((r) => ({ ...r, media: parse(r.media, []), analysis: parse(r.analysis, null), transform: parse(r.transform, null) })) as Capture[]
  }
  async saveCapture(c: Capture) {
    await this.q(
      `INSERT INTO captures (id, room_id, level, name, status, media, blob_id, analysis, transform) VALUES (${lit(c.id)}, ${lit(c.room_id)}, ${lit(c.level)}, ${lit(c.name)}, ${lit(
        c.status,
      )}, ${json(c.media)}, ${lit(c.blob_id)}, ${json(c.analysis)}, ${json(c.transform)})
       ON CONFLICT (id) DO UPDATE SET room_id = excluded.room_id, level = excluded.level, name = excluded.name, status = excluded.status, media = excluded.media,
         blob_id = excluded.blob_id, analysis = excluded.analysis, transform = excluded.transform`,
    )
  }
  async schemes() {
    const rows = await this.q(`SELECT id, name, head_version, sort, role, CAST(created_at AS VARCHAR) created_at FROM schemes ORDER BY sort, created_at`)
    return rows.map((r) => ({ ...r, sort: Number(r.sort) })) as Scheme[]
  }
  async saveScheme(s: Scheme) {
    await this.q(
      `INSERT INTO schemes (id, name, head_version, sort, role) VALUES (${lit(s.id)}, ${lit(s.name)}, ${lit(s.head_version)}, ${Number(s.sort) || 0}, ${lit(s.role ?? null)})
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, head_version = excluded.head_version, sort = excluded.sort, role = excluded.role`,
    )
  }
  async deleteScheme(id: string) {
    await this.q(`DELETE FROM schemes WHERE id = ${lit(id)}`)
  }
  async versions(schemeId: string) {
    const rows = await this.q(
      `SELECT id, scheme_id, seq, summary, source, parent_id, author, label, CAST(created_at AS VARCHAR) created_at FROM versions WHERE scheme_id = ${lit(schemeId)} ORDER BY seq`,
    )
    return rows.map((r) => ({ ...r, seq: Number(r.seq) })) as Version[]
  }
  async model(versionId: string) {
    const rows = await this.q(`SELECT model FROM versions WHERE id = ${lit(versionId)}`)
    return rows.length ? parse<StoredModel | null>(rows[0].model, null) : null
  }
  async addVersion(v: Version, model: Model) {
    await this.q(
      `INSERT INTO versions (id, scheme_id, seq, summary, source, model, parent_id, author, ops_json, label) VALUES (${lit(v.id)}, ${lit(v.scheme_id)}, ${v.seq}, ${lit(v.summary)}, ${lit(v.source)}, ${json(model)}, ${lit(v.parent_id ?? null)}, ${lit(v.author ?? null)}, ${lit(v.ops_json ?? null)}, ${lit(v.label ?? null)})`,
    )
  }
  async comments(schemeId: string) {
    const rows = await this.q(
      `SELECT id, scheme_id, level, at_x, at_y, target, body, author, resolved, CAST(created_at AS VARCHAR) created_at FROM comments WHERE scheme_id = ${lit(schemeId)} ORDER BY created_at`,
    )
    return rows.map((r) => ({ id: r.id, scheme_id: r.scheme_id, level: r.level, at: [Number(r.at_x), Number(r.at_y)], target: r.target ?? undefined, body: r.body, author: r.author, resolved: !!r.resolved, created_at: r.created_at })) as Comment[]
  }
  async saveComment(c: Comment) {
    await this.q(
      `INSERT INTO comments (id, scheme_id, level, at_x, at_y, target, body, author, resolved) VALUES (${lit(c.id)}, ${lit(c.scheme_id)}, ${lit(c.level)}, ${Number(c.at[0])}, ${Number(c.at[1])}, ${lit(c.target ?? null)}, ${lit(c.body)}, ${lit(c.author)}, ${c.resolved ? 'true' : 'false'})
       ON CONFLICT (id) DO UPDATE SET body = excluded.body, resolved = excluded.resolved, target = excluded.target`,
    )
  }
  async messages(schemeId: string) {
    const rows = await this.q(
      `SELECT id, scheme_id, role, body, attachments, version_id, chips, meta, CAST(created_at AS VARCHAR) created_at FROM messages WHERE scheme_id = ${lit(schemeId)} ORDER BY created_at, id`,
    )
    return rows.map((r) => ({ ...r, attachments: parse(r.attachments, []), chips: parse(r.chips, []), meta: parse(r.meta, undefined) })) as Message[]
  }
  async addMessage(m: Message) {
    await this.q(
      `INSERT INTO messages (id, scheme_id, role, body, attachments, version_id, chips, meta) VALUES (${lit(m.id)}, ${lit(m.scheme_id)}, ${lit(m.role)}, ${lit(m.body)}, ${json(
        (m.attachments ?? []).map(({ preview, ...a }) => a),
      )}, ${lit(m.version_id ?? null)}, ${json(m.chips ?? [])}, ${m.meta ? json(m.meta) : 'NULL'})`,
    )
  }
  async themes() {
    const rows = await this.q(`SELECT id, name, data, CAST(updated_at AS VARCHAR) updated_at FROM themes ORDER BY name`)
    return rows.map((r) => ({ id: r.id, name: r.name, data: parse(r.data, { palette: [] }), updated_at: r.updated_at })) as Theme[]
  }
  async saveTheme(t: Theme) {
    await this.q(
      `INSERT INTO themes (id, name, data, updated_at) VALUES (${lit(t.id)}, ${lit(t.name)}, ${json(t.data)}, now())
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = now()`,
    )
  }
  async setting(key: string) {
    const rows = await this.q(`SELECT value FROM settings WHERE key = ${lit(key)}`)
    return rows.length ? (rows[0].value as string) : null
  }
  async setSetting(key: string, value: string) {
    await this.q(`INSERT INTO settings (key, value) VALUES (${lit(key)}, ${lit(value)}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
  }
}

export class MemoryRepo implements Repo {
  kind = 'memory' as const
  private s: Scheme[] = []
  private v: (Version & { model: StoredModel })[] = []
  private c: Comment[] = []
  private msgs: Message[] = []
  private t: Theme[] = []
  private kv = new Map<string, string>()
  async init() {}
  async schemes() {
    return [...this.s].sort((a, b) => a.sort - b.sort)
  }
  async saveScheme(s: Scheme) {
    this.s = [...this.s.filter((x) => x.id !== s.id), { ...s }]
  }
  async deleteScheme(id: string) {
    this.s = this.s.filter((x) => x.id !== id)
  }
  async versions(schemeId: string) {
    return this.v.filter((x) => x.scheme_id === schemeId).map(({ model, ...r }) => r)
  }
  async model(id: string) {
    const r = this.v.find((x) => x.id === id)
    return r ? JSON.parse(JSON.stringify(r.model)) : null
  }
  async addVersion(v: Version, model: StoredModel) {
    this.v.push({ ...v, created_at: new Date().toISOString(), model: JSON.parse(JSON.stringify(model)) })
  }
  async comments(schemeId: string) {
    return this.c.filter((x) => x.scheme_id === schemeId)
  }
  async saveComment(c: Comment) {
    this.c = [...this.c.filter((x) => x.id !== c.id), c]
  }
  async messages(schemeId: string) {
    return this.msgs.filter((m) => m.scheme_id === schemeId)
  }
  async addMessage(m: Message) {
    this.msgs.push({ ...m, created_at: new Date().toISOString() })
  }
  async themes() {
    return this.t
  }
  async saveTheme(t: Theme) {
    this.t = [...this.t.filter((x) => x.id !== t.id), t]
  }
  async setting(key: string) {
    return this.kv.get(key) ?? null
  }
  async setSetting(key: string, value: string) {
    this.kv.set(key, value)
  }
  private blobs = new Map<string, { meta: BlobMeta; bytes: Uint8Array }>()
  private caps: Capture[] = []
  async saveBlob(b: BlobMeta, bytes: Uint8Array) {
    this.blobs.set(b.id, { meta: b, bytes })
  }
  async blobMeta(id: string) {
    return this.blobs.get(id)?.meta ?? null
  }
  async blobBytes(id: string) {
    return this.blobs.get(id)?.bytes ?? null
  }
  async captures() {
    return this.caps
  }
  async saveCapture(c: Capture) {
    this.caps = [...this.caps.filter((x) => x.id !== c.id), { ...c, created_at: c.created_at ?? new Date().toISOString() }]
  }
}

/** Refuse to run against rows written by a newer build; record the schema this build writes. */
async function checkSchema(repo: Repo) {
  const found = Number((await repo.setting('schema_version')) ?? 0)
  if (found > SCHEMA_VERSION) throw new Error(`This page is older than your saved data (data version ${found}, page version ${SCHEMA_VERSION}). Reload the page to get the current build.`)
  if (found < SCHEMA_VERSION) await repo.setSetting('schema_version', String(SCHEMA_VERSION))
}
