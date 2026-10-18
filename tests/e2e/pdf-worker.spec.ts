import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const truth = JSON.parse(readFileSync(new URL('../../scripts/fixtures/A2-asbuilt-level2.ground-truth.json', import.meta.url), 'utf8'))

// The import pipeline needs workers that start from inside studio.js (the Toolbelt page loads it
// from jsDelivr, so a worker file URL would be cross-origin). This proves both workers start in a page
// and that pdf.js reads the real A2 sheet the way the ground truth describes it.
test('pdf.js on its bundled worker reads the A2 sheet inside the page', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!(window as any).__studio?.platform)
  const result = await page.evaluate(async () => {
    const m = await (window as any).__studio.platform()
    const ping = await m.pingWorker()
    const bytes = new Uint8Array(await (await fetch('/scripts/fixtures/A2-asbuilt-level2.pdf')).arrayBuffer())
    return { ping, pdf: await m.pdfSummary(bytes) }
  })
  expect(result.ping.sum).toBe(499500)
  expect(result.pdf.pdfjs).toBe('6.4.299')
  expect(result.pdf.pages).toBe(1)
  expect(result.pdf.pageSizePt).toEqual(truth.source_pdf.page_size_pt)
  expect(result.pdf.textItems).toBe(147)
  // Two JPEGs (logo 800 x 800, plan 5063 x 5760), each drawn through a soft mask whose own image of
  // the same size is painted as well: four paints, two sizes.
  expect(result.pdf.paintImageXObject).toBe(4)
  expect([...result.pdf.images].sort()).toEqual([[5063, 5760], [5063, 5760], [800, 800], [800, 800]])
})
