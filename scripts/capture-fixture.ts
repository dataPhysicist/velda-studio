// Record what the adapter reads from a plan PDF, so the import unit tests run on plain data without
// pdf.js. Usage: npx tsx scripts/capture-fixture.ts [pdf] [out.json]
// Defaults to the A2 fixture. Uses the pdf.js legacy build in Node (same version as the browser).
import { readFileSync, writeFileSync } from 'node:fs'
import { findImageStreams, jpegFor } from '../src/import/pdf-images'
import { readPage } from '../src/import/pdf-read'

const pdfPath = process.argv[2] ?? 'scripts/fixtures/A2-asbuilt-level2.pdf'
const outPath = process.argv[3] ?? pdfPath.replace(/\.pdf$/i, '.adapter.json')

const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
const bytes = new Uint8Array(readFileSync(pdfPath))
const doc = await pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise
const pages = []
for (let p = 1; p <= doc.numPages; p++) pages.push(await readPage(await doc.getPage(p), pdfjs.OPS))
const streams = findImageStreams(bytes)
const capture = {
  source: pdfPath.split('/').pop(),
  pdfjs: pdfjs.version,
  captured: new Date().toISOString().slice(0, 10),
  pages,
  imageStreams: streams.map(({ obj, width, height, filter, bits, colorSpace, smask }) => ({ obj, width, height, filter, bits, colorSpace, smask })),
}
writeFileSync(outPath, JSON.stringify(capture))
const p1 = pages[0]
const plan = [...p1.images].filter((i) => !i.mask).sort((a, b) => b.px[0] * b.px[1] - a.px[0] * a.px[1])[0]
const jpg = plan ? jpegFor(bytes, plan.px, streams) : null
console.log(
  JSON.stringify({
    out: outPath,
    pages: pages.length,
    text: p1.text.length,
    segs: p1.segs.length,
    curves: p1.segs.filter((s) => s.curve).length,
    fills: p1.fills.length,
    images: p1.images.map((i) => [i.id, i.px.join('x'), i.mask, i.rect.map((v) => Math.round(v * 10) / 10)]),
    planJpegBytes: jpg?.length ?? null,
  }),
)
