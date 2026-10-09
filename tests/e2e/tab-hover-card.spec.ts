import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('whole-tab hover cards slide immediately between neighboring tabs', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await orcaPage.evaluate(() => {
    const s = window.__store?.getState()
    const worktreeId = s?.activeWorktreeId
    if (!s || !worktreeId) {
      throw new Error('Missing workspace')
    }
    const first = s.tabsByWorktree[worktreeId]?.[0]
    if (!first) {
      throw new Error('Missing terminal tab')
    }
    s.setTabCustomTitle(first.id, 'Build and test the hover cards')
    const second = s.createTab(worktreeId)
    s.setTabCustomTitle(second.id, 'Review changes')
  })
  const first = orcaPage.locator('[data-testid="sortable-tab"]').first()
  const second = orcaPage.locator('[data-testid="sortable-tab"]').nth(1)
  const firstBox = await first.boundingBox()
  const secondBox = await second.boundingBox()
  if (!firstBox || !secondBox) {
    throw new Error('Missing tab bounds')
  }
  const card = orcaPage.locator('[data-tab-hover-card]')

  // The left padding and icon used to sit outside the terminal title's trigger.
  await orcaPage.mouse.move(firstBox.x + 3, firstBox.y + firstBox.height / 2)
  await orcaPage.waitForTimeout(200)
  await expect(card).toHaveCount(0)
  await expect(card).toHaveText('Build and test the hover cards')
  await expect(card.locator('[data-shell-icon]')).toHaveCount(1)
  await orcaPage.waitForTimeout(200)

  const recording = orcaPage.evaluate(async () => {
    const frames: { title: string; left: number; sliding: boolean }[] = []
    const started = performance.now()
    do {
      const element = document.querySelector('[data-tab-hover-card]')
      frames.push({
        title: element?.textContent ?? '',
        left: element?.getBoundingClientRect().left ?? -1,
        sliding:
          element
            ?.getAnimations()
            .some((animation) =>
              animation.effect?.getKeyframes().some((frame) => frame.translate !== undefined)
            ) ?? false
      })
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    } while (performance.now() - started < 350)
    return frames
  })
  await orcaPage.mouse.move(secondBox.x + 3, secondBox.y + secondBox.height / 2)
  const frames = await recording
  const firstTargetFrame = frames.findIndex((frame) => frame.title === 'Review changes')
  expect(firstTargetFrame).toBeGreaterThan(0)
  expect(
    frames
      .slice(0, firstTargetFrame)
      .every((frame) => frame.title === 'Build and test the hover cards')
  ).toBe(true)
  expect(frames.slice(firstTargetFrame).every((frame) => frame.title === 'Review changes')).toBe(
    true
  )
  expect(frames.some((frame) => frame.sliding)).toBe(true)
  expect(frames[firstTargetFrame]?.left).toBeLessThan(secondBox.x - 10)
  await expect(card).toHaveText('Review changes')
  await orcaPage.waitForTimeout(500)

  await orcaPage.emulateMedia({ reducedMotion: 'reduce' })
  await orcaPage.mouse.move(firstBox.x + 3, firstBox.y + firstBox.height / 2)
  await expect(card).toHaveText('Build and test the hover cards')
  expect(await card.evaluate((element) => element.getAnimations().length)).toBe(0)
  await first.click({ position: { x: 3, y: firstBox.height / 2 } })
  await expect(card).toHaveCount(0)

  await orcaPage.mouse.move(firstBox.x + 3, firstBox.y + firstBox.height + 100)
  await orcaPage.waitForTimeout(400)
  await orcaPage.mouse.move(secondBox.x + 3, secondBox.y + secondBox.height / 2)
  await orcaPage.waitForTimeout(200)
  await expect(card).toHaveCount(0)
  await expect(card).toHaveText('Review changes')
  await orcaPage.waitForTimeout(500)
})
