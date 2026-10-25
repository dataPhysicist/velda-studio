import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { a2 } from '../import/a2-fixture'

// 09 Phase 8: the PDF sheet set, made in the page (jsPDF and svg2pdf.js) from the A2 as-built and a
// proposed scheme, has the expected pages and the primary bedroom's 19'-8" on the level 2 sheet
// (read back with PyMuPDF in the build environment).

test('sheets: the PDF set has a cover, plans, demolition, changes, schedules, and 19\'-8" on the L2 plan', async ({ page }) => {
  test.setTimeout(300_000)
  // The A2 as-built from the recorded import (Node); the rest happens in the page.
  const base = a2().result.model

  await page.goto('/')
  await page.waitForFunction(() => {
    const s = (window as any).__studio?.store?.getState?.()
    return !!s?.model && !s.status && !s.error
  })
  const out = await page.evaluate(
    async ({ base }) => {
      const w = window as any
      const x = await w.__studio.exports()
      const { applyOps, roomEdges } = await w.__studio.ops()
      // Option 1 moves the wall between the I.T. closet and the laundry below it 1'-0" into the closet.
      const it = base.rooms.find((r: any) => r.name === 'I.T. Clst')
      const laundry = base.rooms.find((r: any) => r.name === 'Laundry Room')
      const wall = roomEdges(base, it).find((e: any) => e.wall && roomEdges(base, laundry).some((f: any) => f.wall?.id === e.wall.id && f.inward[0] * e.inward[0] + f.inward[1] * e.inward[1] < -0.9)).wall
      const proposed = applyOps(base, [{ op: 'move_wall', id: wall.id, by: 12, toward: it.id }], { author: 'user' }).model
      const changes = x.changeLog(base, proposed)
      const lines = x.checklist({ model: proposed, asBuilt: base, aside: new Set(), asBuiltEdits: [], isAsBuilt: false })
      const res = await x.buildSheetSet({
        project: { name: '5008 Velda Dairy', address: '5008 Velda Dairy Rd' },
        schemes: [
          { name: 'As-built', version: 'v1 Imported from A2', date: '2026-10-25', model: base, asBuilt: true },
          { name: 'Option 1', version: 'v2 Laundry wall moved', date: '2026-10-25', model: proposed, asBuilt: false },
        ],
        changes,
        checklist: lines,
      })
      const buf = new Uint8Array(await res.blob.arrayBuffer())
      let s = ''
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      return { b64: btoa(s), sheets: res.sheets as { no: string; title: string }[] }
    },
    { base },
  )
  const file = 'test-results/sheet-set.pdf'
  writeFileSync(file, Buffer.from(out.b64, 'base64'))
  const titles = out.sheets.map((s) => s.title)
  expect(titles.slice(0, 4)).toEqual(['Cover and notes', 'Level 2 floor plan', 'Level 2 floor plan', 'Level 2 demolition and new work'])
  expect(titles).toContain('Changes from the as-built')
  expect(titles).toEqual(expect.arrayContaining(['Rooms schedule', 'Doors and openings schedule', 'Windows schedule', 'Fixtures and products schedule']))
  const read = JSON.parse(
    execFileSync(
      'python3',
      [
        '-I',
        '-c',
        `import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
print(json.dumps({"pages": d.page_count, "size": [d[0].rect.width, d[0].rect.height], "text": [p.get_text() for p in d]}))`,
        file,
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    ),
  )
  expect(read.pages).toBe(out.sheets.length)
  expect(read.size).toEqual([1224, 792]) // 17 x 11 landscape
  const l2 = read.text[1] as string
  expect(l2).toContain('Primary Bedroom')
  expect(l2).toContain('19\'-8"')
  expect(l2).toContain('Design intent. Not for construction. Field verify all dimensions.')
  expect(read.text[3]).toMatch(/moved 1'-0"/)
  expect(read.text.join('\n')).toContain('Laundry Room grows from')
})
