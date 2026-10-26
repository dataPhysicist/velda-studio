import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { formatFeetInches } from '../../src/model/units'
import { jargon } from './plain'
import jpeg from 'jpeg-js'
import { THREE_VERSION, viewerHtml } from '../../src/export/viewer-html'
import type { ViewerData } from '../../src/viewer/data'
import { a2 } from '../import/a2-fixture'

// 09 Phase 8: the share viewer's HTML loads standalone with no network calls except jsDelivr (three.js
// and dist/viewer.js), and the viewer.js entry builds under 2 MB. It shows the plan with room names and
// dimensions, the comment pins with their threads, the scheme switcher, the mood board and the 3D view.

const SHOTS = process.env.BUILDLOG ? 'docs/buildlog' : 'test-results'
const OUT = 'test-results/viewer-dist'
const VIEWER = `https://cdn.jsdelivr.net/gh/dataPhysicist/velda-studio@0000000000000000000000000000000000000000/dist/viewer.js`

test('viewer: the share page works on its own, from jsDelivr only', async ({ page }) => {
  test.setTimeout(300_000)
  execFileSync('npx', ['vite', 'build', '--config', 'vite.viewer.config.ts', '--logLevel', 'error'], { env: { ...process.env, VIEWER_OUT: OUT }, stdio: 'pipe' })
  const bundle = path.join(OUT, 'viewer.js')
  expect(statSync(bundle).size).toBeLessThan(2 * 1024 * 1024)

  const base = a2().result.model
  const proposed = structuredClone(base)
  const bath = proposed.rooms.find((r) => r.name === 'Primary Bathroom')!
  proposed.themes = { t1: { id: 't1', name: 'Warm Oak and Honed Marble', data: { description: 'White oak and honed marble.', palette: [{ name: 'Warm White', hex: '#e5dfdb', role: 'walls' }, { name: 'Oak', hex: '#584937', role: 'cabinets' }], materials: [{ category: 'Vanity', choice: 'Rift-cut white oak' }] } } }
  bath.theme = 't1'
  const px = jpeg.encode({ data: Buffer.alloc(32 * 24 * 4, 180), width: 32, height: 24 }, 70).data
  proposed.inspiration = [
    { id: 'c1', kind: 'image', image: 'velda-studio/uploads/a.jpg', title: 'Oak vanity', tags: { style: [], materials: [], fixtures: [], palette: [{ hex: '#584937' }] }, rooms: [bath.id], addedBy: 'user', createdAt: '' },
    { id: 'c2', kind: 'pin', image: 'https://i.pinimg.com/564x/aa/bb/cc/x.jpg', url: 'https://www.pinterest.com/pin/1/', source: 'pinterest.com', title: 'Marble tray', tags: { style: [], materials: [], fixtures: [], palette: [{ hex: '#e2e3e4' }, { hex: '#c3c5c6' }] }, rooms: [bath.id], addedBy: 'user', createdAt: '' },
  ] as any
  const bedroom = base.rooms.find((r) => r.name === 'Primary Bedroom')!
  const data: ViewerData = {
    v: 1,
    project: { name: '5008 Velda Dairy', address: '5008 Velda Dairy Rd' },
    created: '2026-10-25T21:00:00Z',
    intent: 'Design intent. Not for construction. Field verify all dimensions.',
    thumbs: { c1: `data:image/jpeg;base64,${Buffer.from(px).toString('base64')}` },
    schemes: [
      { id: 's0', name: 'As-built', version: 'v1 Imported from A2', date: '2026-10-25', asBuilt: true, model: base, comments: [] },
      {
        id: 's1',
        name: 'Warm oak bath',
        version: 'v3 Double vanity',
        date: '2026-10-25',
        asBuilt: false,
        model: proposed,
        comments: [
          { id: 'k1', scheme_id: 's1', level: bedroom.level, at: bedroom.polygon[0].map((v, i) => v + (i ? 40 : 40)) as [number, number], body: 'Can the bed wall take a 6 ft headboard?', author: 'you', resolved: false, created_at: '2026-10-25 20:00:00', replies: [{ body: 'Yes: 12\'-0" clear between the windows.', author: 'Designer', created_at: '2026-10-25 21:00:00' }] },
        ],
      },
    ],
  }
  const html = viewerHtml(data, { viewerUrl: VIEWER })
  expect(Buffer.byteLength(html)).toBeLessThan(2 * 1024 * 1024)

  const others: string[] = []
  const cdn: string[] = []
  await page.route('**/*', async (r) => {
    const u = r.request().url()
    if (u === 'https://share.test/v.html') return r.fulfill({ body: html, contentType: 'text/html' })
    if (u === VIEWER) return (cdn.push(u), r.fulfill({ body: readFileSync(bundle), contentType: 'text/javascript' }))
    const three = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/`
    if (u.startsWith(three)) {
      cdn.push(u)
      const rel = u.slice(three.length)
      return r.fulfill({ body: readFileSync(path.join('node_modules/three', rel)), contentType: 'text/javascript' })
    }
    others.push(u)
    return r.abort()
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('https://share.test/v.html')

  // The proposed scheme opens first, on its plan.
  await expect(page.locator('.vw-plan svg')).toBeVisible()
  await expect(page.locator('.vw-plan svg')).toContainText('Primary Bedroom')
  await expect(page.locator('.vw-plan svg')).toContainText('19\'-8"')
  await expect(page.getByRole('combobox', { name: 'Scheme' })).toHaveValue('1')
  // A comment pin and its thread.
  await expect(page.locator('.vw-pin')).toHaveCount(1)
  await page.locator('.vw-pin').click()
  await expect(page.locator('.vw-comment.is-on')).toContainText('Can the bed wall take a 6 ft headboard?')
  await expect(page.locator('.vw-comment.is-on .vw-reply')).toContainText('12\'-0" clear between the windows.')
  await expect(page.locator('.vw-comment.is-on .vw-meta').first()).toContainText('the owner')
  await page.screenshot({ path: `${SHOTS}/phase8-viewer-plan.jpg`, type: 'jpeg', quality: 80 })
  // The mood board: theme swatches, a stored picture as a thumbnail, a web picture as its colors and link.
  await page.getByRole('tab', { name: 'Mood boards' }).click()
  const mood = page.locator('.vw-mood', { hasText: 'Primary Bathroom' })
  await expect(mood).toContainText('Warm Oak and Honed Marble')
  await expect(mood.locator('.vw-pics img')).toHaveCount(1)
  await expect(mood.locator('.vw-chips span')).toHaveCount(2)
  await expect(mood.getByRole('link', { name: 'pinterest.com' })).toHaveAttribute('href', 'https://www.pinterest.com/pin/1/')
  // Sizes: the level's rooms, doors, windows and fixtures, each with its size (02 success criterion 4).
  await page.getByRole('tab', { name: 'Sizes' }).click()
  const panel = page.locator('.vw-panel')
  await expect(panel.locator('table').first()).toContainText('Primary Bedroom')
  for (const title of ['Rooms', 'Doors and openings', 'Windows', 'Fixtures and products']) await expect(panel.getByRole('heading', { name: title })).toBeVisible()
  const fx = proposed.items.find((i) => i.level === bedroom.level)!
  await expect(panel.locator('table').last()).toContainText(formatFeetInches(fx.w))
  expect(await jargon(page, 'the share page')).toEqual([])
  await page.screenshot({ path: `${SHOTS}/phase9-viewer-sizes.jpg`, type: 'jpeg', quality: 80 })
  // 3D, cut away and full.
  await page.getByRole('button', { name: '3D' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__viewer.meshes as number), { timeout: 60_000 }).toBeGreaterThan(80)
  await expect(page.locator('.vw-3d canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Walls cut away' }).click()
  await expect(page.getByRole('button', { name: 'Walls full height' })).toBeVisible()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOTS}/phase8-viewer-3d.jpg`, type: 'jpeg', quality: 80 })
  // The as-built.
  await page.getByRole('combobox', { name: 'Scheme' }).selectOption('0')
  await page.getByRole('button', { name: 'Plan' }).click()
  await expect(page.locator('.vw-pin')).toHaveCount(0)

  expect(others).toEqual([]) // nothing but jsDelivr
  expect(cdn.some((u) => u.endsWith('/build/three.module.js'))).toBe(true)
  expect(cdn.some((u) => u.endsWith('/examples/jsm/controls/OrbitControls.js'))).toBe(true)
  expect(errors).toEqual([])
})
