import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getConnectionId } from '@/lib/connection-context'

type StatArgs = { filePath: string; connectionId?: string }

const mocks = vi.hoisted(() => {
  const state: { value: Record<string, unknown> } = { value: {} }
  return {
    state,
    stat: vi.fn<
      (args: StatArgs) => Promise<{ isDirectory: boolean; size: number; mtime: number }>
    >(),
    openFilePath: vi.fn(),
    activateAndRevealWorktree: vi.fn()
  }
})

vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state.value } }))
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: mocks.activateAndRevealWorktree,
  activateAndRevealWorkspace: vi.fn()
}))

import { buildFileLinkActions } from './terminal-file-link-actions'
import { openDetectedFilePath } from './terminal-file-open-routing'

const id = 'repo::/home/u/proj'
const deps = { worktreeId: id, worktreePath: '/home/u/proj', runtimeEnvironmentId: null }

function sameIdState(activeHost: string | null): Record<string, unknown> {
  return {
    settings: { activeRuntimeEnvironmentId: null },
    activeWorktreeId: id,
    activeWorkspaceExecutionHostId: activeHost,
    repos: [
      { id: 'repo', executionHostId: 'local' },
      { id: 'repo', connectionId: 'box', executionHostId: 'ssh:box' },
      { id: 'desktop', executionHostId: 'local' }
    ],
    worktreesByRepo: {
      repo: [
        { id, repoId: 'repo', path: '/home/u/proj', hostId: 'local' },
        { id, repoId: 'repo', path: '/home/u/proj', hostId: 'ssh:box' }
      ],
      desktop: [
        {
          id: 'desktop::/tmp/desktop-root',
          repoId: 'desktop',
          path: '/tmp/desktop-root',
          hostId: 'local'
        }
      ]
    },
    folderWorkspaces: [],
    projectGroups: [],
    openFiles: [],
    activeFileIdByWorktree: {}
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function desktopStatCalls(): unknown[] {
  return mocks.stat.mock.calls.filter(([args]) => !args.connectionId)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.value = sameIdState('ssh:box')
  mocks.stat.mockResolvedValue({ isDirectory: true, size: 0, mtime: 0 })
  mocks.openFilePath.mockResolvedValue(true)
  vi.stubGlobal('navigator', { userAgent: 'Macintosh' })
  vi.stubGlobal('window', {
    api: { fs: { stat: mocks.stat }, shell: { openFilePath: mocks.openFilePath } }
  })
})

describe('same-id SSH terminal file links', () => {
  it('routes a rejected desktop-only root through the SSH host, never the desktop', async () => {
    // Precondition: the real resolver cannot name a connection for the shared id.
    expect(getConnectionId(id)).toBeUndefined()

    openDetectedFilePath('/tmp/desktop-root', null, null, deps)
    await settle()

    expect(mocks.activateAndRevealWorktree).not.toHaveBeenCalled()
    expect(mocks.stat).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/tmp/desktop-root', connectionId: 'box' })
    )
    expect(desktopStatCalls()).toEqual([])
    expect(mocks.openFilePath).not.toHaveBeenCalled()
  })

  it('offers no desktop default-app row on an SSH root, and Shift-click opens nothing locally', async () => {
    const actions = buildFileLinkActions('/home/u/proj', null, null, deps, {
      kind: 'local'
    })
    expect(actions.kind).toBe('workspace')
    expect(actions.alternate).toBeUndefined()

    openDetectedFilePath('/home/u/proj', null, null, { ...deps, openWithSystemDefault: true })
    await settle()

    expect(desktopStatCalls()).toEqual([])
    expect(mocks.openFilePath).not.toHaveBeenCalled()
  })

  it('refuses file access when no owner names the terminal host', async () => {
    mocks.state.value = sameIdState(null)
    const onOpenFailure = vi.fn()

    const actions = buildFileLinkActions('/tmp/desktop-root', null, null, deps, {
      kind: 'local'
    })
    expect(actions.alternate).toBeUndefined()
    expect(actions.secondaryActions).toBeUndefined()

    openDetectedFilePath('/tmp/desktop-root', null, null, {
      ...deps,
      openWithSystemDefault: true,
      onOpenFailure
    })
    await settle()

    expect(mocks.stat).not.toHaveBeenCalled()
    expect(mocks.openFilePath).not.toHaveBeenCalled()
    expect(onOpenFailure).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'unverifiable' }))
  })
})
