import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { openSidebarProjectDialog } from './helpers/sidebar-project-dialog'
import { runProcess } from '../../src/shared/child-process/run-process'

test.use({ seedTestRepo: false })

async function runFixtureGit(spec: Parameters<typeof runProcess>[0]): Promise<void> {
  const result = await runProcess(spec)
  expect(result.code, result.stderr).toBe(0)
}

test('concurrent registration keeps one identity, including nested and linked paths', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orca-registration-')))
  const repoPath = join(root, 'repo')
  const nestedPath = join(repoPath, 'nested')
  const linkedPath = join(root, 'linked')
  mkdirSync(nestedPath, { recursive: true })
  registerPostElectronShutdownCleanup(async () => {
    const { rm } = await import('node:fs/promises')
    await rm(root, { recursive: true, force: true })
  })
  await runFixtureGit({ program: 'git', args: ['init', repoPath] })
  await runFixtureGit({
    program: 'git',
    args: [
      '-c',
      'user.name=E2E',
      '-c',
      'user.email=e2e@test.local',
      'commit',
      '--allow-empty',
      '-m',
      'fixture'
    ],
    cwd: repoPath
  })
  await runFixtureGit({
    program: 'git',
    args: ['worktree', 'add', '-b', 'linked', linkedPath],
    cwd: repoPath
  })
  await waitForSessionReady(orcaPage)
  const result = await orcaPage.evaluate(
    async ({ repoPath, nestedPath }) => {
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          window.api.repos.add({ path: index % 2 ? nestedPath : repoPath })
        )
      )
      if (results.some((result) => 'error' in result)) {
        throw new Error(JSON.stringify(results))
      }
      await window.__store!.getState().fetchRepos()
      return {
        ids: results.map((result) => ('repo' in result ? result.repo.id : null)),
        persistedIds: (await window.api.repos.list()).map((repo) => repo.id)
      }
    },
    { repoPath, nestedPath }
  )
  expect(new Set(result.ids).size).toBe(1)
  expect(result.persistedIds).toEqual([result.ids[0]])
  // A repos:changed refresh can supersede the explicitly awaited catalog fetch.
  await expect
    .poll(() => orcaPage.evaluate(() => window.__store!.getState().repos.map((repo) => repo.id)))
    .toEqual(result.persistedIds)
  const linked = await orcaPage.evaluate(async (path) => window.api.repos.add({ path }), linkedPath)
  expect('repo' in linked && linked.repo.id).toBe(result.ids[0])
  const missing = await orcaPage.evaluate(
    async (path) => window.api.repos.add({ path }),
    join(root, 'missing')
  )
  expect('error' in missing).toBe(true)
  expect(
    await orcaPage.evaluate(async () => (await window.api.repos.list()).map((repo) => repo.id))
  ).toEqual(result.persistedIds)
})

test('Add Project opens a folder and preserves its workspace when Git appears', async ({
  electronApp,
  orcaPage,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const folderPath = realpathSync(mkdtempSync(join(tmpdir(), 'orca-folder-upgrade-')))
  registerPostElectronShutdownCleanup(async () => {
    const { rm } = await import('node:fs/promises')
    await rm(folderPath, { recursive: true, force: true })
  })
  await waitForSessionReady(orcaPage)
  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path], bookmarks: [] })
  }, folderPath)
  await openSidebarProjectDialog(orcaPage)
  await orcaPage.getByRole('button', { name: /Browse folder/i }).click()
  const dialog = orcaPage.getByRole('dialog', { name: 'Open as Folder' })
  await expect(dialog).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('open-folder.png') })
  await dialog.getByRole('button', { name: 'Open as Folder', exact: true }).click()
  await expect
    .poll(() => orcaPage.evaluate(() => window.__store!.getState().repos[0]?.kind))
    .toBe('folder')
  await expect
    .poll(() =>
      orcaPage.evaluate(() => {
        const state = window.__store!.getState()
        return state.worktreesByRepo[state.repos[0].id]?.[0]?.id
      })
    )
    .toBeTruthy()
  const before = await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    const repo = state.repos[0]
    return { repoId: repo.id, worktreeId: state.worktreesByRepo[repo.id]?.[0]?.id }
  })
  await orcaPage.screenshot({ path: testInfo.outputPath('folder-workspace.png') })
  await runFixtureGit({ program: 'git', args: ['init', folderPath] })
  await expect
    .poll(() => orcaPage.evaluate(() => window.__store!.getState().repos[0]?.kind), {
      timeout: 30_000
    })
    .toBe('git')
  await expect
    .poll(
      () =>
        orcaPage.evaluate(() => {
          const state = window.__store!.getState()
          const repo = state.repos[0]
          return { repoId: repo.id, worktreeId: state.worktreesByRepo[repo.id]?.[0]?.id }
        }),
      { timeout: 30_000 }
    )
    .toEqual(before)
  await orcaPage.screenshot({ path: testInfo.outputPath('git-workspace.png') })
})

test('SSH registration reads the repository on its execution host', async ({
  orcaPage
}, testInfo) => {
  test.skip(process.env.ORCA_E2E_SSH_DOCKER !== '1', 'Requires the existing Docker SSH fixture')
  test.setTimeout(180_000)
  const {
    startDockerSshRelayTarget,
    cleanupDockerSshRelayTarget,
    execDockerSshRelayTargetCommand,
    DOCKER_SSH_RELAY_REMOTE_REPO_PATH
  } = await import('./helpers/docker-ssh-relay-target')
  const { connectDockerSshRelayTarget, disconnectDockerSshRelayTarget } =
    await import('./helpers/docker-ssh-relay-connection')
  const target = startDockerSshRelayTarget(testInfo)
  let targetId: string | null = null
  try {
    await waitForSessionReady(orcaPage)
    const connected = await connectDockerSshRelayTarget(orcaPage, target, { seedInitialTab: false })
    targetId = connected.targetId
    execDockerSshRelayTargetCommand(target, `mkdir -p ${DOCKER_SSH_RELAY_REMOTE_REPO_PATH}/nested`)
    const nested = await orcaPage.evaluate(
      async ({ connectionId, remotePath }) =>
        window.api.repos.addRemote({ connectionId, remotePath }),
      { connectionId: targetId, remotePath: `${DOCKER_SSH_RELAY_REMOTE_REPO_PATH}/nested` }
    )
    expect('repo' in nested && nested.repo.id).toBe(connected.repoId)
    expect('repo' in nested && nested.repo.connectionId).toBe(targetId)
    expect('repo' in nested && nested.repo.executionHostId).toBe(`ssh:${targetId}`)
    const missing = await orcaPage.evaluate(
      async (connectionId) =>
        window.api.repos.addRemote({ connectionId, remotePath: '/tmp/or60risk-missing' }),
      targetId
    )
    expect('error' in missing).toBe(true)
    await orcaPage.screenshot({ path: testInfo.outputPath('ssh-project.png') })
  } finally {
    if (targetId) {
      await disconnectDockerSshRelayTarget(orcaPage, targetId)
    }
    cleanupDockerSshRelayTarget(target)
  }
})

test('real WSL registration preserves literal paths and fences login output', async ({
  orcaPage
}, testInfo) => {
  const distro = process.env.ORCA_REAL_WSL_DISTRO
  test.skip(process.platform !== 'win32' || !distro, 'Requires a real Windows WSL distro')
  const { buildWslExecArgs, buildWslCapturedLoginShellCommand, quotePosixShell } =
    await import('../../src/shared/wsl-login-shell-command')
  const root = `/tmp/or60risk/run-${Date.now()}`
  const repoPath = `${root}/repo-$literal space`
  const uncPath = `\\\\wsl.localhost\\${distro}${repoPath.replaceAll('/', '\\')}`
  const setup = await runProcess({
    program: 'wsl.exe',
    args: buildWslExecArgs(distro, [
      '/bin/sh',
      '-c',
      `mkdir -p ${quotePosixShell(`${repoPath}/nested`)} && git init ${quotePosixShell(repoPath)}`
    ]),
    timeoutMs: 30_000
  })
  expect(setup.code, setup.stderr).toBe(0)
  try {
    const capture = buildWslCapturedLoginShellCommand(
      `git -C ${quotePosixShell(repoPath)} rev-parse --is-inside-work-tree`
    )
    const raw = await runProcess({
      program: 'wsl.exe',
      args: buildWslExecArgs(distro, [
        '/bin/sh',
        '-c',
        `printf 'OR60_LOGIN_NOISE\\n'; ${capture.command}`
      ]),
      timeoutMs: 30_000
    })
    expect(raw.code, raw.stderr).toBe(0)
    expect(raw.stdout).toContain('OR60_LOGIN_NOISE')
    expect(capture.readStdout(raw.stdout)).toBe('true\n')
    await waitForSessionReady(orcaPage)
    const added = await orcaPage.evaluate(
      async (path) => window.api.repos.add({ path }),
      `${uncPath}\\nested`
    )
    expect('repo' in added).toBe(true)
    expect('repo' in added && added.repo.path).toBe(uncPath)
    await orcaPage.screenshot({ path: testInfo.outputPath('wsl-project.png') })
  } finally {
    const cleanup = await runProcess({
      program: 'wsl.exe',
      args: buildWslExecArgs(distro, ['/bin/sh', '-c', `rm -rf ${quotePosixShell(root)}`]),
      timeoutMs: 30_000
    })
    expect(cleanup.code, cleanup.stderr).toBe(0)
  }
})
