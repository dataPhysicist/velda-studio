// Find image streams in a PDF's bytes without pdf.js. A DCTDecode stream is a complete JPEG, so the
// plan raster can be decoded at native resolution (and without the soft mask that lightens it on
// screen). Streams never live inside object streams, so a scan of the file body finds them all.
import type { PdfImageStream } from './types'

const latin1 = (b: Uint8Array) => {
  // TextDecoder('latin1') is windows-1252 in browsers, which maps 0x80-0x9f to other code points but
  // keeps one char per byte, so offsets still line up with byte offsets.
  return new TextDecoder('latin1').decode(b)
}

function num(dict: string, key: string): number | null {
  const m = new RegExp(`/${key}\\s+(\\d+)(?!\\s+\\d+\\s+R)`).exec(dict)
  return m ? Number(m[1]) : null
}
function ref(dict: string, key: string): number | null {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict)
  return m ? Number(m[1]) : null
}
function nameOrFirst(dict: string, key: string): string {
  const m = new RegExp(`/${key}\\s*(?:\\[\\s*)?/([A-Za-z0-9]+)`).exec(dict)
  return m ? m[1] : ''
}

/** Read the integer value of an indirect object (used for /Length 12 0 R). */
function indirectInt(text: string, obj: number): number | null {
  const m = new RegExp(`(?:^|[\\r\\n\\s])${obj}\\s+0\\s+obj\\s*(\\d+)\\s*endobj`).exec(text)
  return m ? Number(m[1]) : null
}

export function findImageStreams(bytes: Uint8Array): PdfImageStream[] {
  const text = latin1(bytes)
  const out: PdfImageStream[] = []
  const re = /\/Subtype\s*\/Image/g
  let m: RegExpExecArray | null
  const seen = new Set<number>()
  while ((m = re.exec(text))) {
    // The object header before the match, and the 'stream' keyword after the dictionary.
    const head = text.lastIndexOf(' obj', m.index)
    if (head < 0) continue
    const hm = /(\d+)\s+(\d+)\s+obj\s*$/.exec(text.slice(Math.max(0, head - 24), head + 4))
    if (!hm) continue
    const obj = Number(hm[1])
    if (seen.has(obj)) continue
    const streamAt = text.indexOf('stream', m.index)
    const endobjAt = text.indexOf('endobj', m.index)
    if (streamAt < 0 || (endobjAt >= 0 && endobjAt < streamAt)) continue
    const dict = text.slice(head, streamAt)
    let start = streamAt + 6
    if (text[start] === '\r') start++
    if (text[start] === '\n') start++
    let len = num(dict, 'Length')
    const lenRef = ref(dict, 'Length')
    if (len == null && lenRef != null) len = indirectInt(text, lenRef)
    let end: number
    if (len != null && text.startsWith('endstream', skipWs(text, start + len))) end = start + len
    else {
      const es = text.indexOf('endstream', start)
      if (es < 0) continue
      end = es
      while (end > start && (text[end - 1] === '\n' || text[end - 1] === '\r')) end--
    }
    seen.add(obj)
    out.push({
      obj,
      width: num(dict, 'Width') ?? 0,
      height: num(dict, 'Height') ?? 0,
      filter: nameOrFirst(dict, 'Filter'),
      bits: num(dict, 'BitsPerComponent') ?? 8,
      colorSpace: nameOrFirst(dict, 'ColorSpace') || (ref(dict, 'ColorSpace') != null ? 'indirect' : ''),
      smask: ref(dict, 'SMask'),
      start,
      end,
    })
  }
  return out
}

function skipWs(t: string, i: number) {
  while (i < t.length && (t[i] === '\r' || t[i] === '\n' || t[i] === ' ')) i++
  return i
}

/**
 * The JPEG for an image of the given pixel size, if the PDF stores one as DCTDecode. When two
 * streams match (a picture and its soft mask share a size), the DCT one is the picture.
 */
export function jpegFor(bytes: Uint8Array, px: [number, number], streams = findImageStreams(bytes)): Uint8Array | null {
  const hit = streams.find((s) => s.width === px[0] && s.height === px[1] && s.filter === 'DCTDecode')
  if (!hit) return null
  const jpg = bytes.subarray(hit.start, hit.end)
  return jpg[0] === 0xff && jpg[1] === 0xd8 ? jpg : null
}
