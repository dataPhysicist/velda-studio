import { readFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import JSZip from 'jszip'

// 09 Phase 8, the page side: Export builds the package from a proposed scheme and its as-built (every
// part non-zero, the checklist as README.md), and Share makes a read-only link (the page uploaded to
// storage with the schemes inside, a signed link, listed, turned off). Toolbelt is a stand-in here.

const SHOTS = process.env.BUILDLOG ? 'docs/buildlog' : 'test-results'
const st = (page: Page) => page.evaluate(() => (window as any).__studio.store.getState())

test('handoff: the export package has every part, and a share link can be made and turned off', async ({ page }) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/')
  await page.waitForFunction(() => {
    const s = (window as any).__studio?.store?.getState?.()
    return !!s?.model && !s.status && !s.error
  })
  // The local preview's scheme stands in for the as-built; a stand-in for Toolbelt storage.
  await page.evaluate(async () => {
    const w = window as any
    const { repo, store } = w.__studio
    const s = store.getState().schemes[0]
    await repo.saveScheme({ ...s, name: 'As-built', role: 'asbuilt' })
    store.setState({ schemes: await repo.schemes() })
    w.__uploads = {}
    w.__tools = []
    store.setState({
      sdk: {
        upload: async (path: string, b64: string) => ((w.__uploads[path] = b64), path),
        signedUrl: async (path: string, exp: number) => `https://storage.example/${path}?expires=${exp}`,
        readImage: async () => null,
        runToolParsed: async (tool: string, args: any) => (w.__tools.push({ tool, args }), tool === 'manage_shared_artifacts' ? { url: `https://storage.example/${args.fileName}?signed=1`, expiresIn: args.expiresIn } : { success: true }),
        ask: async () => '{}',
      },
    })
  })
  // A proposed scheme with one change.
  await page.getByRole('button', { name: 'Save as a new scheme' }).click()
  await page.getByRole('textbox', { name: 'Name of the new scheme' }).fill('Option 1')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .poll(async () => {
      const s = await st(page)
      return s.schemes.find((x: any) => x.id === s.schemeId)?.name
    })
    .toBe('Option 1')
  await page.evaluate(async () => {
    const { handEdit } = await (window as any).__studio.editor()
    const m = (window as any).__studio.store.getState().model
    const r = m.rooms.find((x: any) => x.name === 'Kitchen')
    const xs = r.polygon.map((p: number[]) => p[0])
    const ys = r.polygon.map((p: number[]) => p[1])
    await handEdit([{ op: 'add_item', id: 'tbl', kind: 'table', label: 'Breakfast table', x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, w: 48, d: 36, level: r.level }], 'Breakfast table')
  })

  // Export.
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const dlg = page.getByRole('dialog', { name: 'Export' })
  await expect(dlg).toContainText('Option 1, compared with As-built')
  await expect(dlg.locator('.handoff-check > li')).not.toHaveCount(0)
  await dlg.getByRole('button', { name: 'Build package' }).click()
  const zipLink = dlg.getByRole('link', { name: /^Download .*\.zip$/ })
  await expect(zipLink).toBeVisible({ timeout: 180_000 })
  await page.screenshot({ path: `${SHOTS}/phase8-export.jpg`, type: 'jpeg', quality: 80 })
  const b64 = await page.evaluate(async (href) => {
    const buf = new Uint8Array(await (await fetch(href)).arrayBuffer())
    let s = ''
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    return btoa(s)
  }, (await zipLink.getAttribute('href'))!)
  const zip = await JSZip.loadAsync(Buffer.from(b64, 'base64'))
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir)
  expect(names).toEqual(
    expect.arrayContaining([
      'README.md',
      'dxf/as-built.dxf',
      'dxf/option-1.dxf',
      'model.json',
      'as-built.json',
      'model.glb',
      'schedules/rooms.csv',
      'schedules/doors.csv',
      'schedules/windows.csv',
      'schedules/items.csv',
      'changes.md',
      'changes.csv',
      'inspiration/index.md',
    ]),
  )
  expect(names.some((n) => /-option-1-sheets\.pdf$/.test(n))).toBe(true)
  for (const n of names) expect((await zip.file(n)!.async('uint8array')).length, n).toBeGreaterThan(0)
  const glb = await zip.file('model.glb')!.async('uint8array')
  expect(Buffer.from(glb.subarray(0, 4)).toString()).toBe('glTF')
  const pdf = await zip.file(names.find((n) => n.endsWith('.pdf'))!)!.async('uint8array')
  expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-')
  const readme = await zip.file('README.md')!.async('string')
  expect(readme).toContain('**Design intent. Not for construction. Field verify all dimensions.**')
  expect(readme).toContain('## Handoff checklist')
  expect(readme).toMatch(/- \[[ x]\] Every level has a confirmed ceiling height/)
  expect(await zip.file('changes.md')!.async('string')).toContain('Add Breakfast table (4\'-0" by 3\'-0") in Kitchen.')
  expect(await zip.file('dxf/option-1.dxf')!.async('string')).toContain('AC1009')
  await dlg.getByRole('button', { name: 'Close' }).click()

  // Share.
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const sh = page.getByRole('dialog', { name: 'Share a read-only link' })
  await expect(sh).toContainText('Anyone with the link sees Option 1 and As-built for comparison')
  await sh.getByRole('combobox').selectOption('365')
  await sh.getByRole('button', { name: 'Make a link' }).click()
  await expect(sh.getByRole('textbox', { name: 'Share link' })).toHaveValue(/^https:\/\/storage\.example\/velda-studio\/shares\/sh\w+\.html\?signed=1$/)
  const tools = await page.evaluate(() => (window as any).__tools)
  expect(tools[0]).toMatchObject({ tool: 'manage_shared_artifacts', args: { action: 'create_link', expiresIn: 365 * 86400 } })
  const html = await page.evaluate(() => {
    const w = window as any
    const k = Object.keys(w.__uploads).find((p) => p.startsWith('velda-studio/shares/'))!
    return decodeURIComponent(escape(atob(w.__uploads[k])))
  })
  expect(html).toContain('<script type="importmap">')
  expect(html).toContain('https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js')
  expect(html).toMatch(/<script type="module" src="[^"]*\/viewer\.js"><\/script>/)
  const data = JSON.parse(/<script id="velda-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1].replace(/<\\\//g, '</'))
  expect(data.schemes.map((s: any) => s.name)).toEqual(['As-built', 'Option 1'])
  expect(data.schemes[1].model.items.some((i: any) => i.id === 'tbl')).toBe(true)
  await expect(sh.locator('.share-list li')).toHaveCount(1)
  await page.screenshot({ path: `${SHOTS}/phase8-share.jpg`, type: 'jpeg', quality: 80 })
  await sh.getByRole('button', { name: 'Turn off' }).click()
  await expect(sh.locator('.share-list li')).toContainText('turned off')
  expect((await page.evaluate(() => (window as any).__tools)).at(-1)).toMatchObject({ tool: 'delete_storage_file' })
  expect(errors).toEqual([])
  void readFileSync
})
