// What the Rooms page keeps: photos of rooms, every version of each photo, and the questions saved
// for the designer. In Toolbelt these are tables in the same database as the Studio's floor plans
// (names start with rp_; the Studio never reads them). Pictures themselves live in Velda storage.
import { lit } from '../toolbelt'
import type { Backend } from './backend'

export type Idea = { title: string; why: string; prompt: string; scale?: 'tweak' | 'refresh' | 'remodel' }
export type Notice = { title: string; body: string; ask?: string }
/** What Velda made of a photo: what it shows, ideas to try, and what a designer would point out. */
export type Study = { sees?: string; ideas: Idea[]; notices: Notice[]; at: string }

export type Photo = {
  id: string
  room_id: string
  room_name: string
  level: string
  w: number
  h: number
  ratio: string
  /** The version shown on the room's card. */
  head: string | null
  study: Study | null
  created_at?: string
}

export type VersionMeta = {
  kind: 'photo' | 'change' | 'idea' | 'plan'
  engine?: string
  seconds?: number
  /** 'spot' when only a brushed area changed, 'kept' when the rest of the picture was put back, 'whole' when the model's whole picture was kept. */
  mode?: 'spot' | 'kept' | 'whole'
  /** Share of the picture that differs from the version it came from, 0..1. */
  touched?: number
}

export type Version = {
  id: string
  photo_id: string
  parent_id: string | null
  seq: number
  label: string
  words: string
  path: string
  thumb: string
  meta: VersionMeta
  fav: boolean
  created_at?: string
}

export type Saved = {
  id: string
  room_id: string
  room_name: string
  source: 'plan' | 'list' | 'velda' | 'answer' | 'mine'
  title: string
  body: string
  ask: string
  done: boolean
  created_at?: string
}

export interface Store {
  init(): Promise<void>
  photos(): Promise<Photo[]>
  savePhoto(p: Photo): Promise<void>
  deletePhoto(id: string): Promise<void>
  /** Every version of every photo, without the pictures. */
  versions(): Promise<Version[]>
  saveVersion(v: Version): Promise<void>
  deleteVersion(id: string): Promise<void>
  saved(): Promise<Saved[]>
  saveSaved(s: Saved): Promise<void>
  deleteSaved(id: string): Promise<void>
}

const json = (v: unknown) => lit(JSON.stringify(v ?? null))
const parse = <T,>(v: unknown, fallback: T): T => {
  if (v == null || v === '') return fallback
  if (typeof v !== 'string') return v as T
  try {
    return JSON.parse(v) ?? fallback
  } catch {
    return fallback
  }
}

export class DuckStore implements Store {
  constructor(private be: Backend) {}
  private q(sql: string) {
    return this.be.sql(sql)
  }
  async init() {
    await this.q(
      `CREATE TABLE IF NOT EXISTS rp_photos (id VARCHAR PRIMARY KEY, room_id VARCHAR, room_name VARCHAR, level VARCHAR, w INTEGER, h INTEGER, ratio VARCHAR, head VARCHAR, study VARCHAR, deleted BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT now())`,
    )
    await this.q(
      `CREATE TABLE IF NOT EXISTS rp_versions (id VARCHAR PRIMARY KEY, photo_id VARCHAR, parent_id VARCHAR, seq INTEGER, label VARCHAR, words VARCHAR, path VARCHAR, thumb VARCHAR, meta VARCHAR, fav BOOLEAN DEFAULT false, deleted BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT now())`,
    )
    await this.q(
      `CREATE TABLE IF NOT EXISTS rp_saved (id VARCHAR PRIMARY KEY, room_id VARCHAR, room_name VARCHAR, source VARCHAR, title VARCHAR, body VARCHAR, ask VARCHAR, done BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT now())`,
    )
  }
  async photos() {
    const rows = await this.q(`SELECT id, room_id, room_name, level, w, h, ratio, head, study, CAST(created_at AS VARCHAR) created_at FROM rp_photos WHERE NOT deleted ORDER BY created_at`)
    return rows.map((r) => ({ ...r, w: Number(r.w), h: Number(r.h), study: parse<Study | null>(r.study, null) })) as Photo[]
  }
  async savePhoto(p: Photo) {
    await this.q(
      `INSERT INTO rp_photos (id, room_id, room_name, level, w, h, ratio, head, study) VALUES (${lit(p.id)}, ${lit(p.room_id)}, ${lit(p.room_name)}, ${lit(p.level)}, ${p.w}, ${p.h}, ${lit(p.ratio)}, ${lit(p.head)}, ${p.study ? json(p.study) : 'NULL'})
       ON CONFLICT (id) DO UPDATE SET room_id = excluded.room_id, room_name = excluded.room_name, level = excluded.level, head = excluded.head, study = excluded.study`,
    )
  }
  async deletePhoto(id: string) {
    await this.q(`UPDATE rp_photos SET deleted = true WHERE id = ${lit(id)}`)
  }
  async versions() {
    const rows = await this.q(
      `SELECT id, photo_id, parent_id, seq, label, words, path, thumb, meta, fav, CAST(created_at AS VARCHAR) created_at FROM rp_versions WHERE NOT deleted ORDER BY photo_id, seq`,
    )
    return rows.map((r) => ({ ...r, seq: Number(r.seq), fav: !!r.fav, meta: parse<VersionMeta>(r.meta, { kind: 'change' }) })) as Version[]
  }
  async saveVersion(v: Version) {
    await this.q(
      `INSERT INTO rp_versions (id, photo_id, parent_id, seq, label, words, path, thumb, meta, fav) VALUES (${lit(v.id)}, ${lit(v.photo_id)}, ${lit(v.parent_id)}, ${v.seq}, ${lit(v.label)}, ${lit(v.words)}, ${lit(v.path)}, ${lit(v.thumb)}, ${json(v.meta)}, ${v.fav ? 'true' : 'false'})
       ON CONFLICT (id) DO UPDATE SET label = excluded.label, fav = excluded.fav, meta = excluded.meta`,
    )
  }
  async deleteVersion(id: string) {
    await this.q(`UPDATE rp_versions SET deleted = true WHERE id = ${lit(id)}`)
  }
  async saved() {
    const rows = await this.q(`SELECT id, room_id, room_name, source, title, body, ask, done, CAST(created_at AS VARCHAR) created_at FROM rp_saved ORDER BY created_at`)
    return rows.map((r) => ({ ...r, done: !!r.done })) as Saved[]
  }
  async saveSaved(s: Saved) {
    await this.q(
      `INSERT INTO rp_saved (id, room_id, room_name, source, title, body, ask, done) VALUES (${lit(s.id)}, ${lit(s.room_id)}, ${lit(s.room_name)}, ${lit(s.source)}, ${lit(s.title)}, ${lit(s.body)}, ${lit(s.ask)}, ${s.done ? 'true' : 'false'})
       ON CONFLICT (id) DO UPDATE SET title = excluded.title, body = excluded.body, ask = excluded.ask, done = excluded.done`,
    )
  }
  async deleteSaved(id: string) {
    await this.q(`DELETE FROM rp_saved WHERE id = ${lit(id)}`)
  }
}

export class MemoryStore implements Store {
  p: Photo[] = []
  v: Version[] = []
  s: Saved[] = []
  async init() {}
  async photos() {
    return this.p
  }
  async savePhoto(p: Photo) {
    this.p = [...this.p.filter((x) => x.id !== p.id), { ...p, created_at: p.created_at ?? new Date().toISOString() }]
  }
  async deletePhoto(id: string) {
    this.p = this.p.filter((x) => x.id !== id)
  }
  async versions() {
    return [...this.v].sort((a, b) => a.seq - b.seq)
  }
  async saveVersion(v: Version) {
    this.v = [...this.v.filter((x) => x.id !== v.id), { ...v, created_at: v.created_at ?? new Date().toISOString() }]
  }
  async deleteVersion(id: string) {
    this.v = this.v.filter((x) => x.id !== id)
  }
  async saved() {
    return this.s
  }
  async saveSaved(s: Saved) {
    this.s = [...this.s.filter((x) => x.id !== s.id), { ...s, created_at: s.created_at ?? new Date().toISOString() }]
  }
  async deleteSaved(id: string) {
    this.s = this.s.filter((x) => x.id !== id)
  }
}

export const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
