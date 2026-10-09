import type { JSHandle, Page } from '@playwright/test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

type CardFrame = { title: string; left: number; count: number; sliding: boolean }
type CardRecording = { stop: () => CardFrame[] }

function startCardRecording(page: Page): Promise<JSHandle<CardRecording>> {
  return page.evaluateHandle(() => {
    const frames: CardFrame[] = []
    const started = performance.now()
    let nextSample = 0
    const record = (): void => {
      const cards = document.querySelectorAll('[data-tab-hover-card]')
      const element = cards[0]
      frames.push({
        title: element?.querySelector('[data-tab-hover-card-title]')?.textContent?.trim() ?? '',
        left: element?.getBoundingClientRect().left ?? -1,
        count: cards.length,
        sliding:
          element
            ?.getAnimations()
            .some((animation) =>
              animation.effect?.getKeyframes().some((frame) => frame.translate !== undefined)
            ) ?? false
      })
      if (performance.now() - started < 10_000) {
        // Hidden Linux windows can suspend animation frames even with throttling disabled.
        nextSample = window.setTimeout(record, 16)
      }
    }
    record()
    return {
      stop: () => {
        window.clearTimeout(nextSample)
        return frames
      }
    }
  })
}

async function stopCardRecording(recording: JSHandle<CardRecording>): Promise<CardFrame[]> {
  const frames = await recording.evaluate((recording) => recording.stop())
  await recording.dispose()
  return frames
}

test('whole-tab hover cards slide immediately between neighboring tabs', async ({
  electronApp,
  orcaPage
}) => {
  // Keep the recorder's timer running while the test window stays hidden.
  const window = await electronApp.browserWindow(orcaPage)
  await window.evaluate((window) => window.webContents.setBackgroundThrottling(false))
  await window.dispose()
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
  const cardTitle = card.locator('[data-tab-hover-card-title]')

  // The left padding and icon used to sit outside the terminal title's trigger.
  await orcaPage.mouse.move(firstBox.x + 3, firstBox.y + firstBox.height / 2)
  await orcaPage.waitForTimeout(200)
  await expect(card).toHaveCount(0)
  await expect(cardTitle).toHaveText('Build and test the hover cards')
  const program = card.locator('[data-tab-hover-card-program]')
  await expect(program.locator('[data-shell-icon]')).toHaveCount(1)
  await expect(program).toHaveText('Terminal')
  const titleBox = await cardTitle.boundingBox()
  const programBox = await program.boundingBox()
  expect(programBox?.y).toBeGreaterThan((titleBox?.y ?? 0) + (titleBox?.height ?? 0))
  await orcaPage.waitForTimeout(200)

  const recording = await startCardRecording(orcaPage)
  await orcaPage.mouse.move(secondBox.x + 3, secondBox.y + secondBox.height / 2)
  await expect(cardTitle).toHaveText('Review changes', { timeout: 150 })
  await orcaPage.waitForTimeout(200)
  const frames = await stopCardRecording(recording)
  const firstTargetFrame = frames.findIndex((frame) => frame.title === 'Review changes')
  expect(firstTargetFrame, JSON.stringify(frames)).toBeGreaterThan(0)
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
  await expect(cardTitle).toHaveText('Review changes')
  await orcaPage.waitForTimeout(500)

  await orcaPage.mouse.move(firstBox.x + 3, firstBox.y + firstBox.height / 2)
  await expect(cardTitle).toHaveText('Build and test the hover cards', { timeout: 150 })
  await orcaPage.waitForTimeout(600)
  await orcaPage.mouse.move(secondBox.x + 3, secondBox.y + secondBox.height / 2)
  await expect(cardTitle).toHaveText('Review changes', { timeout: 150 })

  const reversalRecording = await startCardRecording(orcaPage)
  for (let index = 0; index < 12; index += 1) {
    const target = index % 2 === 0 ? firstBox : secondBox
    const title = index % 2 === 0 ? 'Build and test the hover cards' : 'Review changes'
    await orcaPage.mouse.move(target.x + 3, target.y + target.height / 2)
    await expect(cardTitle).toHaveText(title, { timeout: 150 })
    await orcaPage.waitForTimeout(30)
    await expect(card).toHaveCount(1)
  }
  const reversalFrames = await stopCardRecording(reversalRecording)
  expect(reversalFrames.every((frame) => frame.count === 1)).toBe(true)
  for (const title of ['Build and test the hover cards', 'Review changes']) {
    expect(reversalFrames.some((frame) => frame.title === title && frame.sliding)).toBe(true)
  }

  await first.locator('[data-tab-close-button]').hover()
  await orcaPage.waitForTimeout(100)
  await expect(cardTitle).toHaveText('Build and test the hover cards')
  await expect(orcaPage.locator('[data-tab-hover-card], [data-tab-close-tooltip]')).toHaveCount(1)
  await orcaPage.waitForTimeout(500)
  await expect(cardTitle).toHaveText('Build and test the hover cards')
  await expect(orcaPage.locator('[data-tab-hover-card], [data-tab-close-tooltip]')).toHaveCount(1)
  await expect(orcaPage.locator('[data-tab-close-tooltip]')).toBeVisible()
  await expect(card).toHaveCount(0)
  await orcaPage.mouse.move(secondBox.x + 3, secondBox.y + secondBox.height / 2)
  await expect(cardTitle).toHaveText('Review changes')

  await orcaPage.emulateMedia({ reducedMotion: 'reduce' })
  await orcaPage.mouse.move(firstBox.x + 3, firstBox.y + firstBox.height / 2)
  await expect(cardTitle).toHaveText('Build and test the hover cards')
  expect(await card.evaluate((element) => element.getAnimations().length)).toBe(0)
  await first.locator('[data-tab-close-button]').focus()
  await expect(orcaPage.locator('[data-tab-close-tooltip]')).toBeVisible()
  await expect(card).toHaveCount(0)
  await first.focus()
  await expect(cardTitle).toHaveText('Build and test the hover cards')
  await expect(orcaPage.locator('[data-tab-close-tooltip]')).toHaveCount(0)
  await first.press('Escape')
  await expect(card).toHaveCount(0)

  await first.click({ position: { x: 3, y: firstBox.height / 2 } })
  await expect(card).toHaveCount(0)

  await orcaPage.mouse.move(firstBox.x + 3, firstBox.y + firstBox.height + 100)
  await orcaPage.waitForTimeout(400)
  await orcaPage.mouse.move(secondBox.x + 3, secondBox.y + secondBox.height / 2)
  await orcaPage.waitForTimeout(200)
  await expect(card).toHaveCount(0)
  await expect(cardTitle).toHaveText('Review changes')
  await orcaPage.waitForTimeout(500)
})
