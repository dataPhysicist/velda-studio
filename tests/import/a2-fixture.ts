// Load the A2 fixture once per test file: the recorded adapter output, the plan JPEG decoded with
// jpeg-js (Node), the raster trace and the full sheet import.
import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { importSheet, readSheet } from '../../src/import'
import { traceWalls } from '../../src/import/raster/trace'
import type { Gray, PageData } from '../../src/import/types'

const root = new URL('../../scripts/fixtures/', import.meta.url)
export { truth } from './a2-checks'
export const capture = JSON.parse(readFileSync(new URL('A2-asbuilt-level2.adapter.json', root), 'utf8'))
export const page: PageData = capture.pages[0]

export function decodePlan(): Gray {
  const img = jpeg.decode(readFileSync(new URL('A2-asbuilt-level2.plan.jpg', root)), { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 1024 })
  const n = img.width * img.height
  const ch = img.data.length / n
  const data = new Uint8Array(n)
  for (let i = 0, j = 0; i < n; i++, j += ch) data[i] = ch >= 3 ? (img.data[j] * 299 + img.data[j + 1] * 587 + img.data[j + 2] * 114) / 1000 : img.data[j]
  return { width: img.width, height: img.height, data }
}

let cached: ReturnType<typeof run> | null = null
function run() {
  const gray = decodePlan()
  const sheet = readSheet(page)
  const trace = traceWalls(gray, sheet.pxPerInch!)
  const result = importSheet(page, trace, { file: 'A2-asbuilt-level2.pdf' })
  return { gray, sheet, trace, result }
}
export function a2() {
  cached ??= run()
  return cached
}
