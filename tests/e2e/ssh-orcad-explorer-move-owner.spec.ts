import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

async function readManagedFile(
  page: Page,
  environmentId: string,
  worktreeId: string,
  relativePath: string
) {
  return page.evaluate(
    async ({ environmentId, worktreeId, relativePath }) =>
      JSON.stringify(
        await window.api.runtimeEnvironments.call({
          selector: environmentId,
          method: 'files.read',
          params: { worktree: `id:${worktreeId}`, relativePath },
          timeoutMs: 120_000
        })
      ),
    { environmentId, worktreeId, relativePath }
  )
}

async function refreshExplorer(page: Page) {
  const refresh = page.getByRole('button', { name: 'Refresh Explorer', exact: true })
  await refresh.click()
  await expect(refresh).toBeEnabled()
}

async function sameHostMove(
  page: Page,
  fileName: string,
  sourceDir: string,
  targetName: string | null
) {
  const source = page
    .locator(`[data-file-explorer-row][data-file-explorer-drop-dir="${sourceDir}"]`)
    .filter({ hasText: fileName })
  await expect(source).toBeVisible()
  const destination = targetName
    ? page.locator('[data-file-explorer-row]').filter({ hasText: targetName })
    : page.locator('[data-orca-explorer-shell] [data-os-file-drop-owner]')
  await expect(destination).toBeVisible()
  const transfer = await page.evaluateHandle(() => new DataTransfer())
  try {
    await source.evaluate((element, dataTransfer) => {
      element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
    }, transfer)
    const owner = await transfer.evaluate((dataTransfer) =>
      JSON.parse(dataTransfer.getData('application/x-orca-workspace-file-source'))
    )
    await destination.evaluate((element, dataTransfer) => {
      element.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer })
      )
      document.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }))
    }, transfer)
    return owner
  } finally {
    await transfer.dispose()
  }
}

for (const target of ['directory', 'root'] as const) {
  test(`managed Files ${target} move drop cannot move an unrelated desktop file`, async ({
    testRepoPath
  }, testInfo) => {
    test.setTimeout(4 * 60_000)
    const fileName = `MOVE_${target.toUpperCase()}_OWNER.txt`
    const relativePath = target === 'root' ? `MOVE_SOURCE/${fileName}` : fileName
    mkdirSync(path.join(testRepoPath, 'MOVE_SOURCE'), { recursive: true })
    const filePath = path.join(testRepoPath, relativePath)
    writeFileSync(filePath, 'DESKTOP_MOVE_OWNER')
    mkdirSync(path.join(testRepoPath, 'MOVE_DESTINATION'), { recursive: true })
    const host = startOrcadConvertHost('docker', testInfo)
    const session = createRestartSession(testInfo, { ORCA_ORCAD_TEMPLATE_PATH: TEMPLATE! })
    let app: ElectronApplication | null = null
    try {
      if (!host.exec) {
        throw new Error('Missing owned host control')
      }
      host.exec(
        `mkdir -p ${shellQuote(path.dirname(testRepoPath))} && git clone --quiet ${shellQuote(host.remoteRepoPath)} ${shellQuote(testRepoPath)} && mkdir -p ${shellQuote(path.dirname(filePath))} && printf '%s' 'REMOTE_MOVE_OWNER' > ${shellQuote(filePath)}`
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
      const remoteIdentity = getWorktreeHostIdentity({
        id: seeded.worktreeId,
        hostId: toRuntimeExecutionHostId(environment.id)
      })
      await page.locator(`[data-worktree-host-identity="${remoteIdentity}"]:visible`).click()
      await openFileExplorer(page)
      await refreshExplorer(page)
      if (target === 'root') {
        await page.locator('[data-file-explorer-row]').filter({ hasText: 'MOVE_SOURCE' }).click()
      }
      const source = page.locator('[data-file-explorer-row]').filter({ hasText: fileName })
      await expect(source).toBeVisible()
      const transfer = await page.evaluateHandle(() => new DataTransfer())
      await source.evaluate((element, dataTransfer) => {
        element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
      }, transfer)
      const payload = await transfer.evaluate((dataTransfer) =>
        Object.fromEntries(
          [...dataTransfer.types].map((type) => [type, dataTransfer.getData(type)])
        )
      )
      console.log('[actual-managed-move-source]', payload)
      expect(JSON.parse(payload['application/x-orca-workspace-file-source'] ?? '{}')).toMatchObject(
        {
          executionHostId: toRuntimeExecutionHostId(environment.id),
          workspaceId: seeded.worktreeId
        }
      )
      console.log(
        '[independent-managed-source-before]',
        await serverCall(page, environment.id, 'files.read', {
          worktree: `id:${seeded.worktreeId}`,
          relativePath
        })
      )
      await page.locator(`[data-worktree-host-identity="${nativeIdentity}"]:visible`).click()
      await openFileExplorer(page)
      await refreshExplorer(page)
      if (target === 'root') {
        await page.locator('[data-file-explorer-row]').filter({ hasText: 'MOVE_SOURCE' }).click()
      }
      await expect(
        page.locator('[data-file-explorer-row]').filter({ hasText: fileName })
      ).toBeVisible()
      const destination =
        target === 'root'
          ? page.locator('[data-orca-explorer-shell] [data-os-file-drop-owner]')
          : page.locator('[data-file-explorer-row]').filter({ hasText: 'MOVE_DESTINATION' })
      await expect(destination).toBeVisible()
      await destination.evaluate((element, dataTransfer) => {
        element.dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer })
        )
        document.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }))
      }, transfer)
      await transfer.dispose()
      const refusal = page.getByText('Move files from the same host as this workspace.', {
        exact: true
      })
      await expect(refusal).toBeVisible()
      const destinationPath =
        target === 'root' ? testRepoPath : path.join(testRepoPath, 'MOVE_DESTINATION')
      const moved = path.join(destinationPath, fileName)
      console.log('[actual-desktop-move-result]', {
        sourceExists: existsSync(filePath),
        destinationExists: existsSync(moved),
        destinationContent: existsSync(moved) ? readFileSync(moved, 'utf8') : null
      })
      console.log(
        '[independent-managed-source-after]',
        await serverCall(page, environment.id, 'files.read', {
          worktree: `id:${seeded.worktreeId}`,
          relativePath
        })
      )
      const refusalToast = page.locator('[data-sonner-toast]').filter({ has: refusal })
      await expect(refusalToast).toHaveAttribute('data-mounted', 'true')
      await refusalToast.evaluate(async (element) => {
        await Promise.allSettled(element.getAnimations().map((animation) => animation.finished))
      })
      await expect(refusalToast).toHaveCSS('opacity', '1')
      await page.screenshot({ path: testInfo.outputPath('managed-explorer-move-owner.png') })
      expect(existsSync(filePath)).toBe(true)
      expect(existsSync(moved)).toBe(false)
      expect(readFileSync(filePath, 'utf8')).toBe('DESKTOP_MOVE_OWNER')
      expect(
        await sameHostMove(
          page,
          fileName,
          path.dirname(filePath),
          target === 'root' ? null : 'MOVE_DESTINATION'
        )
      ).toMatchObject({
        executionHostId: 'local',
        workspaceId: nativeId
      })
      await expect.poll(() => existsSync(moved)).toBe(true)
      expect(readFileSync(moved, 'utf8')).toBe('DESKTOP_MOVE_OWNER')
      expect(existsSync(filePath)).toBe(false)
      await page.locator(`[data-worktree-host-identity="${remoteIdentity}"]:visible`).click()
      await openFileExplorer(page)
      await refreshExplorer(page)
      if (target === 'root') {
        const child = page.locator('[data-file-explorer-row]').filter({ hasText: fileName })
        if (!(await child.count())) {
          await page.locator('[data-file-explorer-row]').filter({ hasText: 'MOVE_SOURCE' }).click()
        }
      }
      expect(
        await sameHostMove(
          page,
          fileName,
          path.dirname(filePath),
          target === 'root' ? null : 'DROP_SOURCE_DIRECTORY'
        )
      ).toMatchObject({
        executionHostId: toRuntimeExecutionHostId(environment.id),
        workspaceId: seeded.worktreeId
      })
      const managedDestination = target === 'root' ? fileName : `DROP_SOURCE_DIRECTORY/${fileName}`
      await expect
        .poll(() => readManagedFile(page, environment.id, seeded.worktreeId, managedDestination))
        .toContain('REMOTE_MOVE_OWNER')
      const missingOriginal = JSON.parse(
        await readManagedFile(page, environment.id, seeded.worktreeId, relativePath)
      )
      expect(missingOriginal.ok).toBe(false)
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
}
