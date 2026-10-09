import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { startOrcadConvertHost } from './helpers/orcad-convert-host'
import { seedRelayEraProfile } from './helpers/orcad-upgrade-profile'
import { convertAndRetain, serverCall } from './helpers/orcad-convert-flow'
import { waitForSessionReady } from './helpers/store'
import { dismissTransientAnnouncement } from './helpers/ssh-config-host-picker'
import { shellQuote } from './helpers/docker-ssh-relay-target'
import { toRuntimeExecutionHostId, type ExecutionHostId } from '../../src/shared/execution-host'
import { getWorktreeHostIdentity } from '../../src/shared/worktree/host-qualified-identity'
import { getRepoIdFromWorktreeId } from '../../src/shared/worktree/id'
import { MCP_STARTER_CONFIG } from '../../src/shared/mcp-config'

const TEMPLATE = process.env.ORCA_E2E_ORCAD_CONVERT_TEMPLATE
test.skip(!TEMPLATE || process.env.ORCA_E2E_SSH_DOCKER !== '1', 'Needs owned Docker host')
test.skip(process.platform === 'win32', 'Owned POSIX host collision fixture')

async function openMcpSettings(page: Page, repoId: string, hostId: ExecutionHostId) {
  await page.evaluate(
    ({ repoId, hostId }) => {
      const state = window.__store!.getState()
      state.openSettingsPage()
      state.openSettingsTarget({ pane: 'repo', repoId, hostId })
      state.setSettingsSearchQuery('MCP')
    },
    { repoId, hostId }
  )
  const section = page
    .getByRole('heading', { name: 'MCP Configs', exact: true })
    .locator('xpath=ancestor::section[1]')
  await expect(section).toBeVisible()
  await expect(section.locator('.lucide-loader-circle')).toHaveCount(0)
  await expect
    .poll(() =>
      section.evaluate((element) => {
        let ancestor: Element | null = element
        while (ancestor) {
          if (getComputedStyle(ancestor).opacity !== '1') {
            return false
          }
          ancestor = ancestor.parentElement
        }
        return true
      })
    )
    .toBe(true)
  return section
}

for (const action of ['inspect', 'create'] as const) {
  test(`managed repository MCP settings ${action} uses its own host`, async ({
    testRepoPath
  }, testInfo) => {
    test.setTimeout(4 * 60_000)
    const configPath = path.join(testRepoPath, '.mcp.json')
    const localConfig = JSON.stringify({
      mcpServers: { DESKTOP_MCP_OWNER: { command: 'desktop-marker' } }
    })
    const remoteConfig = JSON.stringify({
      mcpServers: { REMOTE_MCP_OWNER: { command: 'remote-marker' } }
    })
    if (action === 'inspect') {
      writeFileSync(configPath, localConfig)
    } else {
      rmSync(configPath, { force: true })
    }
    const host = startOrcadConvertHost('docker', testInfo)
    const session = createRestartSession(testInfo, { ORCA_ORCAD_TEMPLATE_PATH: TEMPLATE! })
    let app: ElectronApplication | null = null
    try {
      if (!host.exec) {
        throw new Error('Missing owned host control')
      }
      host.exec(
        `mkdir -p ${shellQuote(path.dirname(testRepoPath))} && git clone --quiet ${shellQuote(host.remoteRepoPath)} ${shellQuote(testRepoPath)}`
      )
      if (action === 'inspect') {
        host.exec(`printf '%s' ${shellQuote(remoteConfig)} > ${shellQuote(configPath)}`)
      }
      const first = await session.launch()
      app = first.app
      await waitForSessionReady(first.page)
      const nativeRepoId = await first.page.evaluate(async (repoPath) => {
        const result = await window.api.repos.add({ path: repoPath })
        if ('error' in result) {
          throw new Error(result.error)
        }
        return result.repo.id
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
      const hostId = toRuntimeExecutionHostId(environment.id)
      const identity = getWorktreeHostIdentity({ id: seeded.worktreeId, hostId })
      await page.locator(`[data-worktree-host-identity="${identity}"]:visible`).click()
      const section = await openMcpSettings(
        page,
        getRepoIdFromWorktreeId(seeded.worktreeId),
        hostId
      )
      if (action === 'inspect') {
        console.log(
          '[independent-managed-mcp-config]',
          await serverCall(page, environment.id, 'files.read', {
            worktree: `id:${seeded.worktreeId}`,
            relativePath: '.mcp.json'
          })
        )
        await expect(section.getByRole('button', { name: 'Refresh MCP configs' })).toBeEnabled()
        console.log('[actual-mcp-settings]', await section.innerText())
        await page.screenshot({ path: testInfo.outputPath('managed-mcp-inspection.png') })
        await expect(section.getByText('REMOTE_MCP_OWNER', { exact: true })).toBeVisible()
        await expect(section.getByText('DESKTOP_MCP_OWNER', { exact: true })).toHaveCount(0)
        expect(readFileSync(configPath, 'utf8')).toBe(localConfig)
        await section.getByRole('button', { name: 'Open', exact: true }).click()
        await expect(page.locator('.monaco-editor:visible .view-lines')).toContainText(
          'REMOTE_MCP_OWNER'
        )
        const local = await openMcpSettings(page, nativeRepoId, 'local')
        await expect(local.getByText('DESKTOP_MCP_OWNER', { exact: true })).toBeVisible()
        await expect(local.getByText('REMOTE_MCP_OWNER', { exact: true })).toHaveCount(0)
      } else {
        const create = section.getByRole('button', { name: 'Add MCP config', exact: true })
        await expect(create).toBeVisible()
        await create.click()
        await section.getByRole('button', { name: 'Create empty config', exact: true }).click()
        await expect(page.getByText('MCP config created', { exact: true })).toBeVisible()
        console.log('[actual-desktop-mcp-created]', existsSync(configPath))
        console.log(
          '[actual-managed-mcp-created]',
          host.exec(
            `if test -f ${shellQuote(configPath)}; then cat ${shellQuote(configPath)}; else printf MISSING; fi`
          )
        )
        await page.screenshot({ path: testInfo.outputPath('managed-mcp-starter.png') })
        expect(existsSync(configPath)).toBe(false)
        expect(host.exec(`cat ${shellQuote(configPath)}`)).toContain(MCP_STARTER_CONFIG.trim())
        const local = await openMcpSettings(page, nativeRepoId, 'local')
        await local.getByRole('button', { name: 'Add MCP config', exact: true }).click()
        await local.getByRole('button', { name: 'Create empty config', exact: true }).click()
        await expect.poll(() => existsSync(configPath)).toBe(true)
        expect(readFileSync(configPath, 'utf8')).toBe(MCP_STARTER_CONFIG)
        expect(host.exec(`cat ${shellQuote(configPath)}`)).toContain(MCP_STARTER_CONFIG.trim())
      }
    } finally {
      if (app) {
        await session.close(app)
      }
      host.cleanup()
      await session.dispose()
    }
  })
}
