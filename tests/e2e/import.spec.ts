import { expect, test } from '@playwright/test'
import { checkA2Model, truth } from '../import/a2-checks'

// The gate's browser half (09 Phase 2): the A2 PDF goes in through the page's own upload, pdf.js on its
// inline worker, the trace worker and the Confirm screen with its defaults, and the saved scheme passes
// the same checks as the unit gate. Slow under SwiftShader on two cores; minutes on a laptop are seconds.
test('a plan PDF comes in through the Confirm screen and A2 passes every hard check', async ({ page }) => {
  test.setTimeout(15 * 60_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/')
  await page.waitForFunction(() => {
    const s = (window as any).__studio?.store?.getState?.()
    return !!s?.model && !s.status
  })
  await page.setInputFiles('[data-testid=plan-file]', 'scripts/fixtures/A2-asbuilt-level2.pdf')
  await expect(page.getByTestId('import-confirm')).toBeVisible({ timeout: 12 * 60_000 })

  // What the Confirm screen shows: at most 3 conflicts and 7 unresolved items, the level and scale read.
  const shown = await page.evaluate(async () => {
    const m = await (window as any).__studio.importFlow()
    const { result } = m.useImport.getState()
    return { report: result.report, level: result.model.levels[0].id, number: result.guess.number }
  })
  expect(shown.number).toBe('A2')
  expect(shown.level).toBe('L2')
  expect(shown.report.conflicts.length).toBeLessThanOrEqual(3)
  expect(shown.report.unresolved.length).toBeLessThanOrEqual(7)
  await expect(page.getByText('Level 2', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Looks right, build my house' }).click()
  await page.waitForFunction(() => {
    const s = (window as any).__studio.store.getState()
    return s.model?.sheets?.length === 1 && !s.status && s.schemes.some((x: any) => x.name === 'As-built')
  })
  const saved = await page.evaluate(async () => {
    const st = (window as any).__studio
    const s = st.store.getState()
    const versions = await st.repo.versions(s.schemeId)
    const raster = await st.repo.blobMeta(s.model.sheets[0].raster.blobId)
    return { model: s.model, versions: versions.map((v: any) => [v.summary, v.author]), raster }
  })
  expect(checkA2Model(saved.model)).toEqual([])
  expect(saved.versions).toEqual([[`Imported from A2 (${truth.source_pdf.issue})`, 'import']])
  expect(saved.model.levels[0].ceiling).toBe(108) // 9 ft, asked on the Confirm screen and approved
  expect(saved.model.levels[0].prov.ceiling.src).toBe('user')
  expect(saved.raster?.size).toBe(783147) // the plan picture is kept with the sheet for the underlay
  expect(errors).toEqual([])
})
