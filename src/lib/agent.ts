// Velda: turns what the person says (and any photos) into a reply plus model operations.
import type { Attachment } from '../repo'
import type { ToolbeltSDK } from '../toolbelt'
import type { Op } from '../model/ops'

export { buildPrompt } from '../ai/prompt'

export type AgentAnswer = {
  reply: string
  summary: string
  ops: Op[]
  question: { text: string; options: string[] } | null
}

export const FAST_MODEL = 'claude-sonnet-4-6'
export const DEEP_MODEL = 'claude-opus-5-5'

// Design questions, options and anything visual go to the deeper model (07 section 1).
const DEEP =
  /\b(layouts?|options?|ideas?|design|redesign|rethink|what do you think|what if|suggest|improve|better|best|critique|review|why|should|compare|plan for|inspiration|style|vibe|feel|showers?|fits?|recommend\w*|pinterest|mood|palettes?)\b/i

export function pickModel(text: string, attachments: Attachment[]) {
  return attachments.length || /https?:\/\//.test(text) || DEEP.test(text) || text.length > 280 ? DEEP_MODEL : FAST_MODEL
}

/** The first JSON object in a model reply (code fences and unescaped inch marks repaired), or null. */
export function firstJson(raw: string): any {
  const s = repairQuotes(raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, ''))
  const start = s.indexOf('{')
  if (start < 0) return null
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
        const text = s.slice(start, i + 1)
        try {
          return JSON.parse(text)
        } catch {
          try {
            return JSON.parse(repairQuotes(text))
          } catch {
            return null
          }
        }
      }
    }
  }
  return null
}

/** Pull the first JSON object out of a model reply. */
export function parseAnswer(raw: string): AgentAnswer {
  const obj = firstJson(raw)
  if (!obj) return { reply: raw.trim() || 'I could not work that out. Try saying it another way.', summary: '', ops: [], question: null }
  const q = obj.question && typeof obj.question === 'object' && obj.question.text ? obj.question : null
  return {
    reply: String(obj.reply ?? '').trim(),
    summary: String(obj.summary ?? '').trim(),
    ops: Array.isArray(obj.ops) ? obj.ops.filter((o: any) => o && typeof o.op === 'string') : [],
    question: q ? { text: String(q.text), options: (Array.isArray(q.options) ? q.options : []).map(String).slice(0, 4) } : null,
  }
}

/**
 * Models sometimes write inch marks (6'-0") unescaped inside JSON strings. Treat a quote inside a
 * string as closing only when the next non-space character could follow a string value.
 */
export function repairQuotes(text: string): string {
  let out = ''
  let inStr = false
  let esc = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (!inStr) {
      if (ch === '"') inStr = true
      out += ch
      continue
    }
    if (esc) {
      esc = false
      out += ch
      continue
    }
    if (ch === '\\') {
      esc = true
      out += ch
      continue
    }
    if (ch === '"') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j++
      const next = text[j]
      if (next === undefined || next === ',' || next === '}' || next === ']' || next === ':') {
        inStr = false
        out += ch
      } else out += '\\"'
      continue
    }
    if (ch === '\n') {
      out += '\\n'
      continue
    }
    out += ch
  }
  return out
}

export async function askVelda(sdk: ToolbeltSDK, prompt: string, modelName: string): Promise<AgentAnswer> {
  const raw = await sdk.ask(prompt, modelName, modelName === DEEP_MODEL ? 120 : 75)
  return parseAnswer(raw)
}
