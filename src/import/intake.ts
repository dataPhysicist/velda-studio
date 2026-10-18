// The intake questions (05 section 8): asked once on the Confirm screen, with defaults filled in.
// Approving the screen answers them, so every value set here becomes the person's ('user'); "I don't
// know" and "varies" keep the default and say so.
import { deriveRooms } from '../model/derive'
import type { Level, Model, Note, Prov } from '../model/types'

export type ExteriorBuild = '2x4' | '2x6' | 'cmu' | 'brick_veneer' | 'unknown'

export type Intake = {
  ceilings: Record<string, number> // per level id, inches
  floorThickness: number | 'unknown'
  exterior: ExteriorBuild
  windowHead: number | 'varies'
  windowSill: number | 'varies'
  doorHeight: number
  front: 'top' | 'right' | 'bottom' | 'left' | null
  era: string
  remodelRooms: string[] // room ids
  notes: string
}

export const EXTERIOR_LABEL: Record<ExteriorBuild, string> = {
  '2x4': '2x4 wood frame',
  '2x6': '2x6 wood frame',
  cmu: 'Concrete block',
  brick_veneer: 'Brick veneer on frame',
  unknown: "I don't know",
}

/** Defaults: 9 ft ceilings (N8's word for this house; the old data said 9 ft 6 in, so it is asked). */
export function defaultIntake(levels: Pick<Level, 'id'>[]): Intake {
  return {
    ceilings: Object.fromEntries(levels.map((l) => [l.id, 108])),
    floorThickness: 12,
    exterior: 'unknown',
    windowHead: 84,
    windowSill: 36,
    doorHeight: 80,
    front: null,
    era: '',
    remodelRooms: [],
    notes: '',
  }
}

const said = (what: string): Prov => ({ src: 'user', note: `${what} on the import screen` })

export function applyIntake(input: Model, a: Intake, now = new Date().toISOString()): Model {
  const m: Model = structuredClone(input)
  for (const lv of m.levels) {
    const c = a.ceilings[lv.id]
    if (c !== undefined) {
      lv.ceiling = c
      lv.prov.ceiling = said('ceiling height confirmed')
    }
    if (a.floorThickness === 'unknown') lv.prov.floorThickness = { src: 'default', note: 'not known; 12 in assumed' }
    else {
      lv.floorThickness = a.floorThickness
      lv.prov.floorThickness = said('floor structure confirmed')
    }
  }
  // Floors above sit on the ones below.
  const sorted = [...m.levels].sort((p, q) => p.elev - q.elev)
  for (let i = 1; i < sorted.length; i++) sorted[i].elev = sorted[i - 1].elev + sorted[i - 1].ceiling + sorted[i - 1].floorThickness
  for (const o of m.openings) {
    if (o.kind === 'window') {
      if (a.windowSill === 'varies') o.prov.sill = { src: 'default', note: 'sills vary; to be set per window' }
      else {
        o.sill = a.windowSill
        o.prov.sill = said('window sill confirmed')
      }
      if (a.windowHead === 'varies') o.prov.h = { src: 'default', note: 'heads vary; to be set per window' }
      else {
        o.h = a.windowHead
        o.prov.h = said('window head confirmed')
      }
    } else {
      o.h = a.doorHeight
      o.prov.h = said('door height confirmed')
    }
  }
  m.project = { ...m.project, front: a.front, era: a.era.trim() || undefined, remodelRooms: a.remodelRooms }
  const notes: Note[] = []
  if (a.exterior !== 'unknown') notes.push({ id: `n_ext_${Date.now().toString(36)}`, text: `Exterior walls: ${EXTERIOR_LABEL[a.exterior]} (from the import questions).`, author: 'user', createdAt: now } as Note)
  if (a.notes.trim()) notes.push({ id: `n_imp_${Date.now().toString(36)}`, text: a.notes.trim(), author: 'user', createdAt: now } as Note)
  m.notes = [...m.notes, ...notes]
  return deriveRooms(m)
}
