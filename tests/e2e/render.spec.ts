import { expect, type Page, test } from '@playwright/test'
import jpeg from 'jpeg-js'

// 09 Phase 7, the page side: "render this" from the 3D view of the primary bath goes through the real
// send path and the render action. The image prompt is the app's (room, fixtures, theme, camera,
// inspiration), Velda's op carries only N8's words; the render shows "Mood, not dimensions" and a line
// with its quality, size, estimated cost and time; "Again at best quality" runs the Pro model at 2K.
// Velda and Replicate are stand-ins; the signed-in page runs the real ones (build log).

const SHOTS = process.env.BUILDLOG ? 'docs/buildlog' : 'test-results'
const st = (page: Page) => page.evaluate(() => (window as any).__studio.store.getState())

test('render: the app writes the prompt, the render is labeled, and best quality is one click', async ({ page }) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const fake = jpeg.encode({ data: Buffer.alloc(96 * 64 * 4, 200), width: 96, height: 64 }, 80).data
  await page.route('https://replicate.delivery/**', (r) => r.fulfill({ body: fake, contentType: 'image/jpeg' }))
  await page.goto('/')
  await page.waitForFunction(() => {
    const s = (window as any).__studio?.store?.getState?.()
    return !!s?.model && !s.status && !s.error
  })
  await page.evaluate(() => {
    const w = window as any
    w.__runs = []
    const stored = new Map<string, string>()
    w.__studio.store.setState({
      sdk: {
        ask: async (prompt: string) => {
          if (prompt.startsWith('Run one Replicate prediction')) {
            const model = /Model: (\S+)/.exec(prompt)![1]
            const input = JSON.parse(/Input \(JSON\): (.*)/.exec(prompt)![1])
            w.__runs.push({ model, input })
            return JSON.stringify({ status: 'succeeded', output: `https://replicate.delivery/fake/${w.__runs.length}.jpg`, error: null, id: `p${w.__runs.length}`, predict_time: 9.6 })
          }
          const bath = w.__studio.store.getState().model.rooms.find((r: any) => r.name === 'Primary Bathroom').id
          return JSON.stringify({ reply: 'Rendering the primary bath from this view.', summary: '', ops: [{ op: 'render', from: 'view', room: bath, prompt: 'soft morning light' }], question: null })
        },
        upload: async (path: string, b64: string, type: string) => stored.set(path, `data:${type};base64,${b64}`),
        signedUrl: async (path: string) => `https://storage.example/${path}`,
        readImage: async (path: string) => stored.get(path) ?? null,
      },
    })
  })
  await page.getByRole('navigation', { name: 'Level' }).getByRole('button', { name: 'Level 2' }).click()
  await page.getByRole('navigation', { name: 'Room' }).getByRole('button', { name: 'Primary Bathroom', exact: true }).click()
  await page.getByRole('button', { name: /^3D/ }).click()

  const box = page.locator('.composer textarea')
  await box.fill('Render the primary bath realistically from this view')
  await box.press('Enter')
  await expect.poll(async () => (await page.evaluate(() => (window as any).__runs.length)) as number, { timeout: 120_000 }).toBe(1)
  await expect.poll(async () => !!(await st(page)).messages.at(-1)?.meta?.render, { timeout: 60_000 }).toBe(true)

  // The prompt is the app's: room, camera, N8's words; Velda's op carried only his words.
  const run = (await page.evaluate(() => (window as any).__runs[0])) as { model: string; input: any }
  expect(run.model).toBe('google/nano-banana-2')
  expect(run.input.resolution).toBe('1K')
  expect(run.input.aspect_ratio).toMatch(/^\d+:\d+$/) // the view's own shape, not "match_input_image"
  expect(run.input.image_input[0]).toMatch(/^https:\/\/storage\.example\/velda-studio\/renders\/r\w+-view\.png$/)
  const p = run.input.prompt as string
  expect(p).toContain('Image 1 is a simple 3D model view')
  expect(p).toMatch(/The room: the Primary Bathroom, \d+'-[\d /]+" by \d+'-[\d /]+"/)
  expect(p).toMatch(/Camera: (inside|above) the Primary Bathroom/)
  expect(p.split('\n').at(-2)).toBe('N8 asked for: soft morning light')

  const m = (await st(page)).messages.at(-1)
  expect(m.meta.render).toMatchObject({ quality: 'standard', model: 'google/nano-banana-2', resolution: '1K', usd: 0.067, prediction: 'p1', predict: 10, words: 'soft morning light', from: 'view' })
  expect(m.meta.render.prompt).toBe(p)
  const bubble = page.locator('.bubble.has-compare').last()
  await expect(bubble.locator('.compare-label')).toHaveText('Mood, not dimensions')
  await expect(bubble.locator('.render-line')).toContainText(/^Standard, 1K · about \$0\.07 · \d+ s/)
  await bubble.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/phase7-render-labeled.jpg`, type: 'jpeg', quality: 80 })

  // Best quality is one click and says what it costs.
  await bubble.getByRole('button', { name: 'Again at best quality (about $0.13)' }).click()
  await expect.poll(async () => (await page.evaluate(() => (window as any).__runs.length)) as number, { timeout: 120_000 }).toBe(2)
  const best = (await page.evaluate(() => (window as any).__runs[1])) as { model: string; input: any }
  expect(best.model).toBe('google/nano-banana-pro')
  expect(best.input.resolution).toBe('2K')
  expect(best.input.prompt.split('\n').at(-2)).toBe('N8 asked for: soft morning light')
  await expect.poll(async () => (await st(page)).messages.at(-1)?.meta?.render?.quality, { timeout: 60_000 }).toBe('best')
  await expect(page.locator('.bubble.has-compare').last().locator('.render-line')).toContainText(/^Best quality, 2K · about \$0\.13/)
  await expect(page.locator('.bubble.has-compare').last().getByRole('button', { name: /Again at best quality/ })).toHaveCount(0)
  expect(errors).toEqual([])
})
