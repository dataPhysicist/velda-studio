// Velda: turns what the person says (and any photos) into a reply plus model operations.
import type { Attachment, Message } from '../repo'
import type { ToolbeltSDK } from '../toolbelt'
import type { StudioModel } from './model'
import type { Op } from './ops'
import { describeModel } from './summary'
import { LIBRARY_FINISHES, ROLES } from './theme'

export type AgentAnswer = {
  reply: string
  summary: string
  ops: Op[]
  question: { text: string; options: string[] } | null
}

export const FAST_MODEL = 'claude-sonnet-4-6'
export const DEEP_MODEL = 'claude-opus-5-5'

const DEEP = /\b(layouts?|options?|ideas?|design|redesign|rethink|what do you think|suggest|improve|better|critique|review|why|should|compare|plan for|inspiration|style|vibe|feel)\b/i

export function pickModel(text: string, attachments: Attachment[]) {
  return attachments.length || DEEP.test(text) || text.length > 280 ? DEEP_MODEL : FAST_MODEL
}

const CATALOG_HINT =
  'bathtub, shower-square, shower-angle, toilet, bathroom-sink, fridge, stove, hood, kitchen-counter, dining-table, dining-chair, sofa, livingroom-chair, coffee-table, double-bed, single-bed, bedside-table, dresser, closet, bookshelf, desk, office-chair, floor-lamp, ceiling-lamp, rectangular-carpet, round-carpet, indoor-plant, washing-machine, piano, television, round-mirror'

export function buildPrompt(opts: {
  model: StudioModel
  text: string
  attachments: Attachment[]
  history: Message[]
  focus: { roomId: string | null; roomName: string | null; level: string | null }
}): string {
  const { model, text, attachments, history, focus } = opts
  const hist = history
    .slice(-10)
    .map((m) => `${m.role === 'user' ? 'Person' : 'Velda'}: ${m.body.slice(0, 600)}`)
    .join('\n')
  const lib = Object.entries(LIBRARY_FINISHES)
    .map(([k, v]) => `${k} (${v})`)
    .join(', ')
  return `You are Velda, the design assistant inside Velda Studio, a 3D remodel design app for N8's home. You are a world-class architect and interior designer who specializes in remodels. N8 edits only by describing changes and uploading inspiration photos; you make the change by returning operations on the model.

${attachments.length ? `ATTACHMENTS: open each file with read_storage_file (fileName exactly as given) and look at it before answering. Do not call any other tools.\n${attachments.map((a) => `- ${a.path} (${a.name}, ${a.type})`).join('\n')}\nIf a photo is inspiration (a room, a finish, a color board): capture it as a theme op with exact hex colors sampled from the photo (palette with roles ${ROLES.join(', ')}), the materials and a short description, include images:[{"path":"<file>"}], and apply it to the room N8 names (or the focused room). If it is a product: add_item at its real size. If it is a plan or a photo of the existing room: describe what you see and ask what to do with it.` : 'Do not call any tools. Answer directly.'}

Return ONLY one JSON object (no code fences, no prose outside it):
{"reply": "...", "summary": "...", "ops": [...], "question": null}
- reply: 1 to 3 short sentences to N8 saying what you changed (or your answer). Plain words, feet and inches like 3'-0". No em dashes.
- summary: a 3 to 7 word label for this version, like "Sink moved to island". Empty string if ops is empty.
- question: only when a wrong guess would waste real work: {"text": "...", "options": ["short answer", "..."]} with 2 to 4 options, and ops [] or the safe part only. Otherwise choose the most reasonable reading, do it, and say what you chose.

OPERATIONS (inches, plan coordinates; ids exactly as listed; you may give new things an "id" to reference later in the same list):
- {"op":"move","id":ITEM,"x":?,"y":?,"dx":?,"dy":?,"rot":?,"level":?} also moves a wall by dx,dy, or an opening along its wall with "at"/"dat".
- {"op":"resize","id":ITEM,"w":?,"d":?,"h":?,"z":?,"anchor":"center"|"left"|"right"}
- {"op":"delete","id":ID} items, walls, openings or rooms.
- {"op":"add_item","id"?,"kind":KIND,"label":"...","level":"L1","x":..,"y":..,"rot":..,"w":..,"d":..,"h":..,"z"?,"catalog"?}
  KIND: base_cabinet, island, vanity (cabinet runs; a sink, range, cooktop or dishwasher placed inside a run's footprint becomes part of it), sink, range, cooktop, dishwasher, fridge, oven_tower, tall_cabinet, wall_cabinet (z = bottom height, default 54), hood, tub, shower, toilet, bench, glass (glass panel: w long, d thick, h tall), beam (ceiling beam: z = bottom height), item (furniture from the catalog: ${CATALOG_HINT}).
- {"op":"update_item","id":ITEM,"label"?,"kind"?,"catalog"?,"props"?}
- {"op":"add_wall","id"?,"level":"L1","a":[x,y],"b":[x,y],"t":4.5,"h"?,"kind"?:"glass"|"half"} / {"op":"update_wall","id":WALL,"a"?,"b"?,"t"?,"h"?,"kind"?}
- {"op":"add_opening","wall":WALL,"kind":"door"|"window"|"opening","at"?:inches from wall start to center OR "x","y" a point on the wall,"w":..,"h"?,"sill"?,"shape"?:"arch","style"?:"swing"|"pocket"|"sliding"|"french"} / {"op":"update_opening","id":OPENING,...}
- {"op":"room","id":ROOM,"rename"?:"...","theme"?:THEME|null}
- {"op":"theme","id"?:THEME to edit (omit to create),"name"?,"description"?,"scope"?,"palette"?:[{"name","hex","role","use"}],"materials"?:[{"category","choice"}],"avoid"?:[...],"finishes"?:{ROLE:{"color":"#hex"} or {"library":ID}},"images"?:[{"path"}],"apply_to"?:"house"|ROOM name or id|[...]}
  Roles: ${ROLES.join(', ')}. Library finishes: ${lib}.
- {"op":"house_theme","theme":THEME} / {"op":"ceiling","h":114} / {"op":"note","text":"..."}

DESIGN RULES: Put fixtures inside their room, backs against the wall face (wall centerline offset by t/2 + d/2), facing into the room. Base cabinets 24" deep x 36" high; tall 84" to 96"; uppers 12" to 13" deep with bottoms at 54". Kitchen aisles 42" (48" for two cooks); 36" clear in front of a toilet and 15" from its center to a side wall; 30" x 48" clear in front of fixtures. Changing colors or materials means a theme op (house theme or a room's theme); a room-specific look should get its own theme applied to that room. When you remove or widen an opening in a wall that may be load-bearing, say an engineer must confirm the header. Plans are design intent; field measurements govern.

FOCUS: ${focus.roomName ? `room ${focus.roomId} "${focus.roomName}" on ${focus.level}` : focus.level ? `level ${focus.level}` : 'whole house'}. "Here" or "this room" means the focus.

MODEL:
${describeModel(model, { focusRoomId: focus.roomId })}

RECENT CONVERSATION:
${hist || '(none)'}

N8: ${text}`
}

/** Pull the first JSON object out of a model reply. */
export function parseAnswer(raw: string): AgentAnswer {
  const s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '')
  let obj: any = null
  const start = s.indexOf('{')
  if (start >= 0) {
    let depth = 0
    let inStr = false
    let esc = false
    for (let i = start; i < s.length; i++) {
      const ch = s[i]
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          try {
            obj = JSON.parse(s.slice(start, i + 1))
          } catch {}
          break
        }
      }
    }
  }
  if (!obj) return { reply: raw.trim() || 'I could not work that out. Try saying it another way.', summary: '', ops: [], question: null }
  const q = obj.question && typeof obj.question === 'object' && obj.question.text ? obj.question : null
  return {
    reply: String(obj.reply ?? '').trim(),
    summary: String(obj.summary ?? '').trim(),
    ops: Array.isArray(obj.ops) ? obj.ops.filter((o: any) => o && typeof o.op === 'string') : [],
    question: q ? { text: String(q.text), options: (Array.isArray(q.options) ? q.options : []).map(String).slice(0, 4) } : null,
  }
}

export async function askVelda(sdk: ToolbeltSDK, prompt: string, modelName: string): Promise<AgentAnswer> {
  const raw = await sdk.ask(prompt, modelName, modelName === DEEP_MODEL ? 120 : 75)
  return parseAnswer(raw)
}
