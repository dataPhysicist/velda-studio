// Persistence: schemes, versions (each holds a full Studio model), messages, saved themes.
// Inside Toolbelt this is workspace DuckDB (velda_studio.duckdb); outside it, memory (local dev).

import type { StudioModel } from './lib/model'
import type { Theme } from './lib/theme'
import { DB, lit, type ToolbeltSDK } from './toolbelt'

export type Scheme = { id: string; name: string; head_version: string | null; sort: number; created_at?: string }
export type Version = { id: string; scheme_id: string; seq: number; summary: string; source: string; created_at?: string }
export type Attachment = { path: string; name: string; type: string; preview?: string }
export type Message = {
  id: string
  scheme_id: string
  role: 'user' | 'assistant' | 'system'
  body: string
  attachments?: Attachment[]
  version_id?: string | null
  chips?: string[]
  created_at?: string
}

export interface Repo {
  kind: 'duckdb' | 'memory'
  init(): Promise<void>
  schemes(): Promise<Scheme[]>
  saveScheme(s: Scheme): Promise<void>
  deleteScheme(id: string): Promise<void>
  versions(schemeId: string): Promise<Version[]>
  model(versionId: string): Promise<StudioModel | null>
  addVersion(v: Version, model: StudioModel): Promise<void>
  messages(schemeId: string): Promise<Message[]>
  addMessage(m: Message): Promise<void>
  themes(): Promise<Theme[]>
  saveTheme(t: Theme): Promise<void>
  setting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>
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
  }
  async schemes() {
    const rows = await this.q(`SELECT id, name, head_version, sort, CAST(created_at AS VARCHAR) created_at FROM schemes ORDER BY sort, created_at`)
    return rows.map((r) => ({ ...r, sort: Number(r.sort) })) as Scheme[]
  }
  async saveScheme(s: Scheme) {
    await this.q(
      `INSERT INTO schemes (id, name, head_version, sort) VALUES (${lit(s.id)}, ${lit(s.name)}, ${lit(s.head_version)}, ${Number(s.sort) || 0})
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, head_version = excluded.head_version, sort = excluded.sort`,
    )
  }
  async deleteScheme(id: string) {
    await this.q(`DELETE FROM schemes WHERE id = ${lit(id)}`)
  }
  async versions(schemeId: string) {
    const rows = await this.q(
      `SELECT id, scheme_id, seq, summary, source, CAST(created_at AS VARCHAR) created_at FROM versions WHERE scheme_id = ${lit(schemeId)} ORDER BY seq`,
    )
    return rows.map((r) => ({ ...r, seq: Number(r.seq) })) as Version[]
  }
  async model(versionId: string) {
    const rows = await this.q(`SELECT model FROM versions WHERE id = ${lit(versionId)}`)
    return rows.length ? parse<StudioModel | null>(rows[0].model, null) : null
  }
  async addVersion(v: Version, model: StudioModel) {
    await this.q(
      `INSERT INTO versions (id, scheme_id, seq, summary, source, model) VALUES (${lit(v.id)}, ${lit(v.scheme_id)}, ${v.seq}, ${lit(v.summary)}, ${lit(v.source)}, ${json(model)})`,
    )
  }
  async messages(schemeId: string) {
    const rows = await this.q(
      `SELECT id, scheme_id, role, body, attachments, version_id, chips, CAST(created_at AS VARCHAR) created_at FROM messages WHERE scheme_id = ${lit(schemeId)} ORDER BY created_at, id`,
    )
    return rows.map((r) => ({ ...r, attachments: parse(r.attachments, []), chips: parse(r.chips, []) })) as Message[]
  }
  async addMessage(m: Message) {
    await this.q(
      `INSERT INTO messages (id, scheme_id, role, body, attachments, version_id, chips) VALUES (${lit(m.id)}, ${lit(m.scheme_id)}, ${lit(m.role)}, ${lit(m.body)}, ${json(
        (m.attachments ?? []).map(({ preview, ...a }) => a),
      )}, ${lit(m.version_id ?? null)}, ${json(m.chips ?? [])})`,
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
  private v: (Version & { model: StudioModel })[] = []
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
  async addVersion(v: Version, model: StudioModel) {
    this.v.push({ ...v, created_at: new Date().toISOString(), model: JSON.parse(JSON.stringify(model)) })
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
}
