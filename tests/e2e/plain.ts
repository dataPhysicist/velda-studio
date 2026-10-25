import { expect, type Page } from '@playwright/test'

// 02 success criterion 6: nothing in the app needs knowing what a "node", a "scheme version" or
// "Replicate" is. This reads everything a person can see or hear (text, tooltips, labels a screen
// reader speaks, placeholders) and flags the machine words, raw values and leaks that would trip a
// stranger: field names, "undefined", metric units, em dashes (N8's writing rules).

const WORDS: [RegExp, string][] = [
  [/\bnodes?\b/i, 'node'],
  [/scheme versions?/i, 'scheme version'],
  [/\breplicate\b/i, 'Replicate'],
  [/\bpredictions?\b/i, 'prediction'],
  [/\bJSON\b/, 'JSON'],
  [/\bduckdb\b/i, 'DuckDB'],
  [/\bSQL\b/, 'SQL'],
  [/\bAPI\b/, 'API'],
  [/\bops?\b/i, 'op'],
  [/\bschema\b/i, 'schema'],
  [/\b(undefined|NaN)\b|\[object Object\]|\bnull\b/, 'a raw value'],
  [/\b[a-z]+_[a-z_]+\b/, 'a field name'],
  [/\b\d+(\.\d+)?\s?(mm|cm)\b/, 'metric units'],
  [/—/, 'an em dash'],
  [/\d{4}-\d\d-\d\dT\d\d:/, 'a raw timestamp'],
]

/** Everything visible or spoken on the page right now, one entry per source. */
export async function seen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [document.body.innerText]
    for (const el of document.querySelectorAll('[title],[aria-label],[placeholder],[alt]')) {
      const box = (el as HTMLElement).getBoundingClientRect?.()
      if (box && box.width === 0 && box.height === 0 && !(el as HTMLElement).closest('svg')) continue
      for (const a of ['title', 'aria-label', 'placeholder', 'alt']) {
        const v = el.getAttribute(a)
        if (v) out.push(v)
      }
    }
    for (const t of document.querySelectorAll('svg title')) out.push(t.textContent ?? '')
    return out
  })
}

/** The jargon found on the page, each with a little of the text around it. */
export async function jargon(page: Page, where: string): Promise<string[]> {
  const found: string[] = []
  for (const text of await seen(page)) {
    for (const [re, name] of WORDS) {
      const m = re.exec(text)
      if (m) found.push(`${where}: ${name} in "${text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, ' ')}"`)
    }
  }
  return found
}

export async function expectPlain(page: Page, where: string) {
  expect(await jargon(page, where)).toEqual([])
}
