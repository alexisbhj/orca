/**
 * Invariant: a consented panel opens an https link only through the host bridge,
 * on the desktop showing Orca, while direct navigation stays blocked.
 * Oracle: main's shell.openExternal is replaced by a recorder, so nothing really opens.
 */

import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from './helpers/orca-app'
import {
  readPanelNavigationObserver,
  startPanelNavigationObserver,
  stopPanelNavigationObserver
} from './helpers/plugin-panel-navigation-observer'

test('opens a consented https link through the host and nothing else', async ({
  electronApp,
  orcaPage
}) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'orca-open-external-e2e-'))
  const pluginRoot = join(tempRoot, 'open-external')
  await cp(join(process.cwd(), 'examples', 'plugins', 'open-external'), pluginRoot, {
    recursive: true
  })
  const appUrl = orcaPage.url()
  await startPanelNavigationObserver(electronApp, appUrl)
  try {
    const title = await orcaPage.evaluate(async (pluginPath) => {
      const settings = await window.api.settings.set({
        pluginSystemEnabled: true
      })
      window.__store?.setState({ settings })
      await window.api.plugins.refresh()
      const installed = await window.api.plugins.install({
        kind: 'local-path',
        path: pluginPath
      })
      if (!installed.ok) {
        throw new Error(installed.error)
      }
      const listed = await window.api.plugins.refresh()
      const plugin = listed.find((entry) => entry.pluginKey === installed.pluginKey)
      if (!plugin?.consentFingerprint) {
        throw new Error('fixture is not reviewable')
      }
      const approved = await window.api.plugins.consent({
        pluginKey: plugin.pluginKey,
        reviewedFingerprint: plugin.consentFingerprint,
        decision: 'approve'
      })
      const panel = approved.find((entry) => entry.pluginKey === plugin.pluginKey)?.panels[0]
      if (!panel) {
        throw new Error('approved fixture has no panel')
      }
      const store = window.__store?.getState()
      if (store && !store.rightSidebarOpen) {
        store.toggleRightSidebar()
      }
      await window.api.plugins.refresh()
      return panel.title
    }, pluginRoot)
    const panelButton = orcaPage.getByRole('button', { name: title })
    await expect(panelButton).toBeVisible({ timeout: 15_000 })
    await panelButton.click()
    const frame = orcaPage.frameLocator(`iframe[title="${title}"]`)
    const status = frame.locator('#status')
    await expect(frame.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
      'content',
      /default-src 'none'.*connect-src 'none'|connect-src 'none'.*default-src 'none'/
    )

    // The panel can remount once while the install/consent refresh settles.
    await expect(async () => {
      await frame.getByRole('button', { name: 'Probe host support' }).click()
      await expect(status).toContainText('panel.openExternal.v1', {
        timeout: 1_000
      })
    }).toPass({ timeout: 15_000 })

    const frameNavigationsBefore = (await readPanelNavigationObserver(electronApp))
      .didFrameNavigations.length
    await frame.getByRole('link', { name: 'Direct link (blocked)' }).click()
    await frame.getByRole('button', { name: 'Try file:///etc/hosts' }).click()
    await expect(status).toContainText('invalid_params: url: only https: URLs are allowed')
    expect((await readPanelNavigationObserver(electronApp)).externalUrls).toEqual([])

    await frame.getByRole('button', { name: 'Open https://example.com/' }).click()
    await expect(status).toHaveText('{"opened":true}')
    const observation = await readPanelNavigationObserver(electronApp)
    expect(observation.externalUrls).toEqual(['https://example.com/'])
    expect(observation.didFrameNavigations).toHaveLength(frameNavigationsBefore)
    expect(orcaPage.url()).toBe(appUrl)
  } finally {
    await stopPanelNavigationObserver(electronApp).catch(() => undefined)
    await rm(tempRoot, { recursive: true, force: true })
  }
})
