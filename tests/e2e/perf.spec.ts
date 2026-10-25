import { expect, test } from '@playwright/test'

// 03 section 7: the plan pans and zooms at 60 fps with 200 walls. Timed here in headless Chromium on
// the build sandbox's two cores with software rendering and the dev build of React, so the numbers are
// upper bounds for a laptop. The level is padded to 200 walls with copies of its own walls, shifted
// clear of the house. Besides the frame times, Chrome's own counters give the script time a step costs.

test('perf: the plan pans and zooms with 200 walls on a level', async ({ page }) => {
  test.setTimeout(300_000)
  await page.goto('/')
  await page.waitForFunction(() => {
    const s = (window as any).__studio?.store?.getState?.()
    return !!s?.model && !s.status && !s.error
  })
  await page.getByRole('navigation', { name: 'Level' }).getByRole('button', { name: 'Level 1' }).click()
  const walls = await page.evaluate(() => {
    const st = (window as any).__studio.store
    const m = structuredClone(st.getState().model)
    const base = m.walls.filter((w: any) => w.level === 'L1')
    let k = 1
    while (m.walls.filter((w: any) => w.level === 'L1').length < 200) {
      for (const w of base) {
        if (m.walls.filter((x: any) => x.level === 'L1').length >= 200) break
        m.walls.push({ ...structuredClone(w), id: `${w.id}-copy${k}`, a: [w.a[0] + 900 * k, w.a[1]], b: [w.b[0] + 900 * k, w.b[1]] })
      }
      k++
    }
    st.setState({ model: m })
    return m.walls.filter((w: any) => w.level === 'L1').length
  })
  expect(walls).toBe(200)
  await page.keyboard.press('1')
  const svg = page.locator('svg.plan-svg')
  await expect(svg).toBeVisible()
  await page.keyboard.press('f')
  await page.waitForTimeout(3000) // let the 3D scene finish taking in the new walls
  const box = (await svg.boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const script = async () => (await cdp.send('Performance.getMetrics')).metrics.find((x) => x.name === 'ScriptDuration')!.value * 1000
  // Frame times, recorded in the page while something happens.
  const startFrames = () =>
    page.evaluate(() => {
      const w = window as any
      w.__frames = []
      let last = performance.now()
      const tick = (t: number) => {
        w.__frames.push(t - last)
        last = t
        if (w.__frames) w.__raf = requestAnimationFrame(tick)
      }
      w.__raf = requestAnimationFrame(tick)
    })
  const stopFrames = () =>
    page.evaluate(() => {
      const w = window as any
      cancelAnimationFrame(w.__raf)
      const f = (w.__frames as number[]).slice(1).sort((a, b) => a - b)
      w.__frames = null
      return { mean: f.reduce((a, b) => a + b, 0) / f.length, p95: f[Math.floor(f.length * 0.95)] }
    })

  await startFrames()
  await page.waitForTimeout(1000)
  const idle = await stopFrames()

  // Zoom: 60 wheel steps, one a frame.
  let s0 = await script()
  await startFrames()
  await page.evaluate(
    async ({ cx, cy }) => {
      const el = document.querySelector('svg.plan-svg')!
      const frame = () => new Promise<number>((r) => requestAnimationFrame(r))
      for (let i = 0; i < 60; i++) {
        el.dispatchEvent(new WheelEvent('wheel', { deltaY: i < 30 ? -40 : 40, clientX: cx, clientY: cy, bubbles: true, cancelable: true }))
        await frame()
      }
    },
    { cx, cy },
  )
  const zoom = await stopFrames()
  const zoomScript = ((await script()) - s0) / 60

  // Pan: a middle-button drag through 60 points.
  await page.mouse.move(cx, cy)
  s0 = await script()
  await startFrames()
  await page.mouse.down({ button: 'middle' })
  for (let i = 0; i < 60; i++) await page.mouse.move(cx + Math.sin(i / 6) * 200, cy + Math.cos(i / 6) * 120)
  await page.mouse.up({ button: 'middle' })
  const pan = await stopFrames()
  const panScript = ((await script()) - s0) / 62

  const fps = (ms: number) => Math.round(1000 / ms)
  console.log(
    `[perf] plan with 200 walls: idle frame ${idle.mean.toFixed(1)} ms; zoom ${zoom.mean.toFixed(1)} ms a frame (${fps(zoom.mean)} fps, 95th ${zoom.p95.toFixed(1)} ms), script ${zoomScript.toFixed(1)} ms a step; pan ${pan.mean.toFixed(1)} ms a frame (${fps(pan.mean)} fps, 95th ${pan.p95.toFixed(1)} ms), script ${panScript.toFixed(1)} ms a step`,
  )
  // Ceilings for the software-rendered sandbox; the budget is 16.7 ms a frame on a laptop.
  expect(zoom.mean).toBeLessThan(50)
  expect(zoomScript).toBeLessThan(16.7)
  expect(panScript).toBeLessThan(16.7)
})
