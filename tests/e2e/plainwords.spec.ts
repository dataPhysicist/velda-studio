import { expect, type Page, test } from '@playwright/test'
import { jargon } from './plain'

// 02 success criterion 6, everywhere a person goes without Velda: the welcome, the plan and 3D, every
// panel tab, a selected room, wall, door and fixture, the version strip, and every dialog. The import
// Confirm screen is read in firstrun.spec.ts.

const SHOTS = process.env.BUILDLOG ? 'docs/buildlog' : 'test-results'
const ready = (page: Page) =>
  page.waitForFunction(() => {
    const s = (window as any).__studio?.store?.getState?.()
    return !!s?.model && !s.status && !s.error
  })

test('plain words: no machine words anywhere a person looks', async ({ page }) => {
  test.setTimeout(300_000)
  const found: string[] = []
  const look = async (where: string) => found.push(...(await jargon(page, where)))

  await page.goto('/?fresh=1')
  await expect(page.getByRole('region', { name: 'Welcome' })).toBeVisible()
  await look('welcome')

  await page.goto('/')
  await ready(page)
  const view = (name: string) => page.getByRole('group', { name: 'View' }).getByRole('button', { name, exact: true }).click()
  await view('Plan')
  await look('whole house plan')
  await page.getByRole('navigation', { name: 'Level' }).getByRole('button', { name: 'Level 1' }).click()
  await page.getByRole('navigation', { name: 'Room' }).getByRole('button', { name: 'Kitchen', exact: true }).click()
  await look('a room selected')
  for (const tab of ['Checks', 'Inspiration']) {
    await page.getByRole('tablist', { name: 'Panel' }).getByRole('tab', { name: new RegExp(tab) }).click()
    await look(`the ${tab} tab`)
  }
  await page.getByRole('tablist', { name: 'Panel' }).getByRole('tab').first().click()
  // One of each kind of thing, selected.
  for (const kind of ['wall', 'opening', 'item', 'stair'] as const) {
    const id = await page.evaluate((kind) => {
      const { store } = (window as any).__studio
      const m = store.getState().model
      const list = { wall: m.walls, opening: m.openings, item: m.items, stair: m.stairs }[kind] as { id: string; level: string; wall?: string }[]
      const one = list[0]
      if (!one) return null
      store.setState({ selection: [{ kind, id: one.id }] })
      return one.id
    }, kind)
    if (id) await look(`${kind === 'wall' || kind === 'stair' ? 'a' : 'an'} ${kind} selected`)
  }
  await page.keyboard.press('Escape')

  // 3D and its options.
  await view('3D')
  await page.waitForTimeout(1500)
  await look('3D')
  await view('Plan')

  // The dialogs.
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await look('Share')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await look('Export')
  await page.keyboard.press('Escape')
  await page.locator('.plan-svg').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  await look('the command palette')
  await page.getByRole('combobox', { name: 'Command' }).fill('settings')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await look('Settings')
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click()
  await page.locator('.plan-svg').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  await look('Keyboard shortcuts')
  await page.screenshot({ path: `${SHOTS}/phase9-plain-words.jpg`, type: 'jpeg', quality: 80 })

  console.log(`[plain] ${found.length} finds\n${found.join('\n')}`)
  expect(found).toEqual([])
})
