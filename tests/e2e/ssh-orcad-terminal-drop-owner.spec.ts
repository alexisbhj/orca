import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { startOrcadConvertHost } from './helpers/orcad-convert-host'
import { seedRelayEraProfile } from './helpers/orcad-upgrade-profile'
import { convertAndRetain, serverCall } from './helpers/orcad-convert-flow'
import { waitForSessionReady } from './helpers/store'
import { dismissTransientAnnouncement } from './helpers/ssh-config-host-picker'
import { openFileExplorer } from './helpers/file-explorer'
import { shellQuote } from './helpers/docker-ssh-relay-target'
import { toRuntimeExecutionHostId } from '../../src/shared/execution-host'
import { getWorktreeHostIdentity } from '../../src/shared/worktree/host-qualified-identity'

const TEMPLATE = process.env.ORCA_E2E_ORCAD_CONVERT_TEMPLATE
test.skip(!TEMPLATE || process.env.ORCA_E2E_SSH_DOCKER !== '1', 'Needs owned Docker host')
test.skip(process.platform === 'win32', 'Owned POSIX host collision fixture')

async function terminalText(page: Page, tabId: string) {
  return page.evaluate((id) => {
    const pane = window.__paneManagers?.get(id)?.getActivePane()
    if (!pane) {
      throw new Error('Missing actual floating pane')
    }
    const buffer = pane.terminal.buffer.active
    let text = ''
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i)
      if (line) {
        text += (line.isWrapped ? '' : '\n') + line.translateToString(true)
      }
    }
    return text.trimEnd()
  }, tabId)
}

async function focusTerminalTab(page: Page, tabId: string) {
  await page.evaluate((id) => {
    const pane = window.__paneManagers?.get(id)?.getActivePane()
    const textarea = pane?.container.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')
    if (!pane || !textarea) {
      throw new Error('No real floating input')
    }
    pane.terminal.focus()
    textarea.focus()
  }, tabId)
}

async function dropExplorerFile(page: Page, name: string, tabId: string) {
  const row = page.locator('[data-file-explorer-row]').filter({ hasText: name })
  await expect(row).toBeVisible()
  return row.evaluate((element, id) => {
    const pane = window.__paneManagers?.get(id)?.getActivePane()
    const surface = pane?.container.querySelector('.xterm')
    if (!pane || !surface) {
      throw new Error('Missing actual terminal drop surface')
    }
    const dataTransfer = new DataTransfer()
    element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
    const payload = Object.fromEntries(
      [...dataTransfer.types].map((type) => [type, dataTransfer.getData(type)])
    )
    surface.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
    element.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }))
    return payload
  }, tabId)
}

test('managed Files drag into a desktop terminal cannot name an unrelated desktop file', async ({
  testRepoPath
}, testInfo) => {
  test.setTimeout(4 * 60_000)
  const fileName = 'DROP_OWNER.txt'
  const filePath = path.join(testRepoPath, fileName)
  writeFileSync(filePath, '<html><body>DESKTOP_BROWSER_DROP_OWNER</body></html>')
  const host = startOrcadConvertHost('docker', testInfo)
  const session = createRestartSession(testInfo, { ORCA_ORCAD_TEMPLATE_PATH: TEMPLATE! })
  let app: ElectronApplication | null = null
  try {
    if (!host.exec) {
      throw new Error('Missing owned host control')
    }
    host.exec(
      `mkdir -p ${shellQuote(path.dirname(testRepoPath))} && git clone --quiet ${shellQuote(host.remoteRepoPath)} ${shellQuote(testRepoPath)} && printf '%s' '<html><body>REMOTE_BROWSER_DROP_OWNER</body></html>' > ${shellQuote(filePath)}`
    )
    host.exec(
      `printf '%s' REMOTE_DROP_READY > ${shellQuote(path.join(testRepoPath, 'REMOTE_DROP_READY.txt'))}`
    )
    host.exec(`mkdir -p ${shellQuote(path.join(testRepoPath, 'DROP_SOURCE_DIRECTORY'))}`)
    const first = await session.launch()
    app = first.app
    await waitForSessionReady(first.page)
    const nativeId = await first.page.evaluate(async (repoPath) => {
      const result = await window.api.repos.add({ path: repoPath })
      if ('error' in result) {
        throw new Error(result.error)
      }
      return `${result.repo.id}::${repoPath}`
    }, testRepoPath)
    await session.close(app)
    app = null
    const seeded = seedRelayEraProfile(session.userDataDir, host.input, {
      repoPath: testRepoPath,
      folderPath: host.remoteFolderPath
    })
    const launched = await session.launch()
    app = launched.app
    const page = launched.page
    await waitForSessionReady(page)
    await convertAndRetain(page, session.userDataDir, seeded)
    const environment = (await page.evaluate(() => window.api.runtimeEnvironments.list())).find(
      (entry) => entry.orcadDeployment?.sshTargetId === seeded.targetId
    )
    if (!environment) {
      throw new Error('Missing actual managed environment')
    }
    await dismissTransientAnnouncement(page)
    const nativeIdentity = getWorktreeHostIdentity({ id: nativeId, hostId: 'local' })
    await page.locator(`[data-worktree-host-identity="${nativeIdentity}"]:visible`).click()
    await openFileExplorer(page)
    const floatingId = await page.evaluate(() => {
      const store = window.__store
      const state = store?.getState()
      if (!store || !state?.settings) {
        throw new Error('Missing ready settings')
      }
      store.setState({ settings: { ...state.settings, floatingTerminalEnabled: true } })
      return store
        .getState()
        .createTab('global-floating-terminal', undefined, undefined, { activate: true }).id
    })
    await expect(page.locator('[data-floating-terminal-panel]')).toHaveCount(1)
    if ((await page.locator('[data-floating-terminal-panel][aria-hidden="false"]').count()) === 0) {
      await page.evaluate(() => window.dispatchEvent(new Event('orca-toggle-floating-terminal')))
    }
    await expect(
      page.locator(`[data-terminal-tab-id="${floatingId}"][data-terminal-layout-leaf-ids]:visible`)
    ).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(
          (id) => window.__paneManagers?.get(id)?.getActivePane()?.container.dataset.ptyId ?? null,
          floatingId
        )
      )
      .not.toBeNull()
    await focusTerminalTab(page, floatingId)
    await page.keyboard.insertText("printf '\\nNATIVE_DROP_READY\\n'")
    await page.keyboard.press('Enter')
    await expect.poll(() => terminalText(page, floatingId)).toMatch(/\nNATIVE_DROP_READY\s*\n/)
    await focusTerminalTab(page, floatingId)
    await page.keyboard.insertText('cat ')
    console.log('[native-actual-terminal-drag]', await dropExplorerFile(page, fileName, floatingId))
    await expect.poll(() => terminalText(page, floatingId)).toContain(filePath)
    await focusTerminalTab(page, floatingId)
    await page.keyboard.press('Enter')
    await expect.poll(() => terminalText(page, floatingId)).toContain('DESKTOP_BROWSER_DROP_OWNER')
    console.log('[native-positive-actual-terminal]', await terminalText(page, floatingId))
    const remoteIdentity = getWorktreeHostIdentity({
      id: seeded.worktreeId,
      hostId: toRuntimeExecutionHostId(environment.id)
    })
    await page.locator(`[data-worktree-host-identity="${remoteIdentity}"]:visible`).click()
    await openFileExplorer(page)
    await page.getByRole('button', { name: 'Refresh Explorer', exact: true }).click()
    await expect(
      page.locator('[data-file-explorer-row]').filter({ hasText: 'REMOTE_DROP_READY.txt' })
    ).toBeVisible()
    expect(
      await page.evaluate(() => window.__store?.getState().activeWorkspaceExecutionHostId)
    ).toBe(toRuntimeExecutionHostId(environment.id))
    console.log(
      '[independent-managed-source]',
      await serverCall(page, environment.id, 'files.read', {
        worktree: `id:${seeded.worktreeId}`,
        relativePath: fileName
      })
    )
    await focusTerminalTab(page, floatingId)
    await page.keyboard.insertText("printf '\\nREMOTE_DROP_RESULT\\n'; cat ")
    const remotePayload = await dropExplorerFile(page, fileName, floatingId)
    console.log('[managed-actual-terminal-drag-payload]', remotePayload)
    expect(
      JSON.parse(remotePayload['application/x-orca-workspace-file-source'] ?? '{}')
    ).toMatchObject({
      executionHostId: toRuntimeExecutionHostId(environment.id),
      workspaceId: seeded.worktreeId
    })
    await expect
      .poll(async () => {
        const refused = await page
          .getByText('Drop files from the same host as this terminal.', { exact: true })
          .count()
        const echo = (await terminalText(page, floatingId)).split('REMOTE_DROP_RESULT').at(-1) ?? ''
        return refused > 0 || echo.includes(filePath)
      })
      .toBe(true)
    const refused = page.getByText('Drop files from the same host as this terminal.', {
      exact: true
    })
    if (await refused.count()) {
      await page.keyboard.press('Control+c')
      await expect(refused).toBeVisible()
    } else {
      await page.keyboard.insertText("; printf '\\nREMOTE_DROP_COMPLETED\\n'")
      await page.keyboard.press('Enter')
      await expect
        .poll(() => terminalText(page, floatingId))
        .toMatch(/\nREMOTE_DROP_COMPLETED\s*\n/)
    }
    const content = await terminalText(page, floatingId)
    console.log('[managed-drop-actual-native-shell]', content)
    const refusalToast = page.locator('[data-sonner-toast]').filter({ has: refused })
    await expect(refusalToast).toHaveAttribute('data-mounted', 'true')
    await refusalToast.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished))
    })
    await page.screenshot({ path: testInfo.outputPath('managed-terminal-drop-owner.png') })
    expect(content.split('REMOTE_DROP_RESULT').at(-1)).not.toContain('DESKTOP_BROWSER_DROP_OWNER')
    await expect(refused).toBeVisible()
    console.log(
      '[files-before-positive-control]',
      await page.locator('[data-file-explorer-row]').allTextContents()
    )
    const priorManagedTabs = await page.evaluate(
      (worktreeId) =>
        (window.__store?.getState().tabsByWorktree[worktreeId] ?? []).map((tab) => tab.id),
      seeded.worktreeId
    )
    await page.evaluate(() => window.dispatchEvent(new Event('orca-toggle-floating-terminal')))
    await expect(page.locator('[data-floating-terminal-panel]')).toHaveAttribute(
      'aria-hidden',
      'true'
    )
    await page
      .locator('[data-file-explorer-row]')
      .filter({ hasText: 'DROP_SOURCE_DIRECTORY' })
      .click({ button: 'right' })
    const openInTerminal = page.getByRole('menuitem', { name: 'Open in Terminal', exact: true })
    await expect(openInTerminal).toBeVisible()
    await openInTerminal.press('Enter')
    const readNewManagedTab = () =>
      page.evaluate(
        ({ worktreeId, prior }) => {
          const state = window.__store?.getState()
          const id = state?.activeTabIdByWorktree[worktreeId]
          return id && !prior.includes(id) ? id : null
        },
        { worktreeId: seeded.worktreeId, prior: priorManagedTabs }
      )
    await expect.poll(readNewManagedTab).not.toBeNull()
    const managedTab = await readNewManagedTab()
    if (!managedTab) {
      throw new Error('No newly opened managed terminal')
    }
    await expect
      .poll(() =>
        page.evaluate(
          (id) => window.__paneManagers?.get(id)?.getActivePane()?.container.dataset.ptyId ?? null,
          managedTab
        )
      )
      .not.toBeNull()
    await expect.poll(() => terminalText(page, managedTab)).toMatch(/[$#]\s*$/)
    await focusTerminalTab(page, managedTab)
    await page.keyboard.insertText("printf '\\nMANAGED_DROP_READY\\n'")
    await page.keyboard.press('Enter')
    await expect.poll(() => terminalText(page, managedTab)).toMatch(/\nMANAGED_DROP_READY\s*\n/)
    await focusTerminalTab(page, managedTab)
    await page.keyboard.insertText('cat ')
    console.log('[managed-positive-drag]', await dropExplorerFile(page, fileName, managedTab))
    await expect.poll(() => terminalText(page, managedTab)).toContain(filePath)
    await focusTerminalTab(page, managedTab)
    await page.keyboard.press('Enter')
    await expect.poll(() => terminalText(page, managedTab)).toContain('REMOTE_BROWSER_DROP_OWNER')
    console.log('[managed-positive-shell]', await terminalText(page, managedTab))
  } finally {
    try {
      if (app) {
        await session.close(app)
      }
      await session.dispose()
    } finally {
      host.cleanup()
    }
  }
})
