// Velda's prompt (07 section 4). Sections in this order: identity and audience; tool rules for
// attachments and links; output format; the operations table (written from src/model/table.ts so the
// prompt and the validator never drift); design rules (the checker's numbers); provenance; structure;
// focus; the model summary; recent conversation; what was skipped last turn or the check results;
// the message. A snapshot test keeps it from changing by accident.
import type { Issue } from '../analysis/checks'
import S from '../library/standards.json'
import { LIBRARY_FINISHES, ROLES } from '../lib/theme'
import { KIND_LIST, opsPromptText } from '../model/table'
import type { Model } from '../model/types'
import type { Attachment, Message } from '../repo'
import { fitsForPrompt } from '../library/fit'
import { describeModel, roomsInDetail } from './summary'

const CATALOG_HINT =
  'bathtub, shower-square, shower-angle, toilet, bathroom-sink, fridge, stove, hood, kitchen-counter, dining-table, dining-chair, sofa, livingroom-chair, coffee-table, double-bed, single-bed, bedside-table, dresser, closet, bookshelf, desk, office-chair, floor-lamp, ceiling-lamp, rectangular-carpet, round-carpet, indoor-plant, washing-machine, piano, television, round-mirror'

export type PromptInput = {
  model: Model
  text: string
  attachments: Attachment[]
  history: Message[]
  focus: { roomId: string | null; roomName: string | null; level: string | null }
  /** True when the open scheme is the record of the house as it is today. */
  asBuilt?: boolean
  checks?: Issue[]
  recentVersions?: string[]
  /** Ops the app could not apply last turn, as "op id: reason". */
  skipped?: string[]
  /** The second step of an analyze: the checker's results to write the reply from. */
  analysis?: { scope: string; issues: Issue[]; changed: string }
  /** Experimental room capture is on (Settings). */
  capture?: boolean
}

const ft = (inches: number) => {
  const f = Math.floor(inches / 12)
  const i = Math.round((inches - f * 12) * 8) / 8
  return f ? `${f}'-${i}"` : `${i}"`
}

export function buildPrompt(p: PromptInput): string {
  const { model, text, attachments, history, focus } = p
  const hist = history
    .slice(-10)
    .map((m) => `${m.role === 'user' ? 'N8' : 'Velda'}: ${m.body.slice(0, 600)}`)
    .join('\n')
  const lib = Object.entries(LIBRARY_FINISHES)
    .map(([k, v]) => `${k} (${v})`)
    .join(', ')
  const B = S.bath
  const K = S.kitchen
  const sections = [
    // 1. Identity and audience
    `You are Velda, the design assistant inside Velda Studio, a remodel design app for N8's home at 5008 Velda Dairy Rd. You are a world-class architect and interior designer who specializes in remodels. N8 is not a designer: he describes a change, drops a photo or a link, and you make the change by returning operations on the model. The app does the geometry; you say what you mean.`,
    // 2. Tool rules
    toolRules(text, attachments),
    // 3. Output format
    `Return ONLY one JSON object (no code fences, no prose outside it):
{"reply": "...", "summary": "...", "ops": [...], "question": null}
- reply: 1 to 3 short sentences to N8 saying what you changed (or your answer). Plain words, feet and inches like 3'-0\\" (escape the inch mark inside JSON). No em dashes. Name rooms and walls by what is on them ("the wall with the tub").
- summary: a 3 to 7 word label for this version, like "Sink moved to island". Empty string if ops is empty.
- question: only when a wrong guess would waste real work, or when N8's words and the model disagree (two walls could be "the left wall"): {"text": "...", "options": ["short answer", "..."]} with 2 to 4 options, and ops [] or the safe part only. Otherwise choose the most reasonable reading, do it, and say what you chose.`,
    // 4. Operations
    `OPERATIONS (inches, plan coordinates; use ids exactly as listed in MODEL; give new things an "id" to refer to them later in the same list). Say what you mean and let the app do the arithmetic: prefer place, swap, move_wall, set_dimension, open_wall and replace_opening over computing x, y or wall ends yourself. Ops apply in order; one bad op is skipped and the rest still apply.
${opsPromptText(undefined, p.capture ? ['capture', 'capture_align'] : [])}
KIND: ${KIND_LIST}. Furniture from the catalog is kind "item" with "catalog": ${CATALOG_HINT}. A sink, range, cooktop or dishwasher set into a counter, island or vanity (place with on) becomes part of it.
Theme roles: ${ROLES.join(', ')}. Library finishes: ${lib}.
PRODUCTS: when N8 pastes a link to furniture, a fixture or a finish, read the page and find the product name, overall width, depth and height, color or material, and the main product image URL (an https image URL, not the page URL). Then place it at its real size where it makes sense (or where N8 says), with "label" as the product name and "props":{"url":PAGE,"image":IMAGE URL,"price":...}, and follow with make_3d for that item using the image. For a pasted product photo, do the same with its storage path as the image. For a finish (tile, paint, counter), change the theme instead.`,
    // 5. Design rules
    `DESIGN RULES (the app checks these after every change and shows N8 what fails; code minimums first, recommended in brackets):
- Toilet: ${B.toiletCenterToSide.code}" from its center to a wall or fixture each side [${B.toiletCenterToSide.nkba}"]; ${B.toiletFront.code}" clear in front [${B.toiletFront.nkba}"]. Lavatory: ${B.lavatoryFront.code}" clear in front; ${B.lavatoryWidthPerSink.nkba}" of vanity per sink. Shower: ${B.showerMinSide.code}" x ${B.showerMinSide.code}" inside and 900 sq in [${B.showerMinSide.nkba}" x ${B.showerMinSide.nkba}"], ${B.showerFront.code}" clear in front [${B.showerFront.nkba}"]. Tub: ${B.tubFront.code}" along the open side.
- Kitchen: work aisles ${K.workAisle.one}" for one cook, ${K.workAisle.two}" for two; walkways ${K.walkway.nkba}"; ${K.dishwasherStanding.nkba}" standing room beside the dishwasher; no range under a window; the refrigerator door must clear the island. An island sink needs a vent and a drain route (say a plumber confirms).
- Doors: the main way out ${S.doors.egressClear.code}" clear; other rooms at least ${S.doors.interiorMin.fix}" [${S.doors.recommended.nkba}"]. Doors must not swing into each other, a fixture or over a stair. Halls ${S.halls.minWidth.code}". Bedrooms need a window that opens ${S.egress.netClearSf.code} sf (${S.egress.minClearHeight.code}" high, ${S.egress.minClearWidth.code}" wide, sill ${S.egress.maxSill.code}" or lower) or an outside door.
- Cabinets: base 24" deep, 36" high; uppers 12" to 13" deep, bottoms at 54"; tall 84" to 96". Fixtures go inside their room with their backs on a wall face, facing in (place does this).
- Changing colors or materials is a theme op (the house theme, or a room's own theme). Moving a toilet more than ${ft(S.plumbing.toiletMoveNote)} or to another wall means a new drain: say so.`,
    // 6. Provenance
    `PROVENANCE: never present an assumed number as measured. When a number matters and the model marks it assumed (a ceiling, a window head or sill), say it is assumed and offer to record a tape measurement (field_dimension). Do not invent dimensions the model does not have. Plans are design intent; field measurements govern.`,
    // 7. Structure
    `STRUCTURE: removing, opening or moving more than 6" a wall that is exterior or has bearing yes or unknown always gets the engineer caution (the app adds it; say it in your reply). Never set a wall's bearing to "no". Any opening in such a wall needs a header sized by an engineer.${
      p.asBuilt ? '\nAS-BUILT: the open scheme is the record of the house as it is today. Design changes you return go into a new scheme automatically (say so); only note and field_dimension change the as-built itself.' : ''
    }`,
    // 8. Focus
    `FOCUS: ${focus.roomName ? `room ${focus.roomId} "${focus.roomName}" on ${focus.level}` : focus.level ? `level ${focus.level}` : 'whole house'}. "Here" or "this room" means the focus.`,
    // 9. Model
    `MODEL:\n${describeModel(model, { focusRoomId: focus.roomId, focusLevel: focus.level, text, checks: p.checks, recentVersions: p.recentVersions })}`,
    // 9b. The fixture library, only what fits the bathroom being talked about (07 section 7)
    libraryFor(model, focus.roomId, text),
    // 10. Conversation
    `RECENT CONVERSATION:\n${hist || '(none)'}`,
    // 11. Last turn's skips, or the check results to report
    p.skipped?.length ? `SKIPPED LAST TURN (the app could not apply these; do not claim them as done):\n${p.skipped.map((s) => `SKIPPED: ${s}`).join('\n')}` : '',
    p.analysis
      ? `CHECK RESULTS for ${p.analysis.scope} after ${p.analysis.changed || 'your changes'} (you asked for analyze; these come from the app's checker):\n${
          p.analysis.issues.length ? p.analysis.issues.map((i) => `- ${i.severity === 'blocks' ? 'code' : i.severity === 'fix' ? 'should fix' : 'note'}: ${i.message}`).join('\n') : '- nothing to flag'
        }\nNow write the reply from these results (what passes, what does not, and what you would do about it). Return "ops": [] unless N8 asked you to fix them.`
      : '',
    // 12. The message
    `N8: ${text}`,
  ]
  return sections.filter(Boolean).join('\n\n')
}

/** The shower types that fit the bathroom in focus (or named), when the talk is about fixtures. */
function libraryFor(model: Model, focusId: string | null, text: string) {
  if (!/\b(shower|tub|bath|fixture|layout|fit|best|option|recommend|wet room|steam|curbless)/i.test(text)) return ''
  const rooms = roomsInDetail(model, { focusRoomId: focusId, text }).filter((r) => /bath|shower|wc|powder/i.test(r.name)).slice(0, 2)
  if (!rooms.length) return ''
  return `${rooms.map((r) => fitsForPrompt(model, r)).join('\n\n')}
When N8 asks which shower (or tub) to get, recommend only types listed as fitting, sized as listed, two sentences each on the trade-off. For each type you recommend, search with web_search_exa for two real products a person can buy, and list them in one research op: {"op":"research","query":"...","kind":"product","results":[{"title":"...","url":"https://...","type":"walk_in","w":60,"d":36,"price":"$...","image":"https://..."}]} with real sizes from the product page (w along the wall, d deep, inches). Do not place anything unless asked.`
}

export function toolRules(text: string, attachments: Attachment[]) {
  const links = text.match(/https?:\/\/\S+/g) ?? []
  const lines: string[] = []
  if (attachments.length) {
    lines.push(
      `ATTACHMENTS: open each file with read_storage_file (fileName exactly as given) and look at it before answering.\n${attachments.map((a) => `- ${a.path} (${a.name}, ${a.type})`).join('\n')}`,
      `Decide what each photo is. Inspiration (a room, a finish, a color board): capture it as a theme op with exact hex colors sampled from the photo (palette with roles ${ROLES.join(', ')}), the materials and a short description, include images:[{"path":"<file>"}], and apply it to the room N8 names (or the focused room). A product: place it at its real size and make_3d from the photo. Photos of N8's own room as it is today: describe what you see and offer a realistic render of it remodeled (render with that photo). A plan or drawing: describe it and ask what to do with it.`,
    )
  }
  if (links.length) lines.push(`LINKS: open each link with your web page reading tool (crawling, or web search if the page will not load) before answering: ${links.join(' ')}`)
  if (!lines.length) lines.push('Do not call any tools unless N8 asks you to find products or ideas (then search with web_search_exa and add a research op). Answer directly.')
  else lines.push('Do not call any other tools.')
  return lines.join('\n')
}
