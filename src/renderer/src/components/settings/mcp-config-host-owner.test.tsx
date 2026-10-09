// @vitest-environment happy-dom

import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { MCP_STARTER_CONFIG } from '../../../../shared/mcp-config'
import type { Repo } from '../../../../shared/repo-types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { makeWorktree } from '@/store/slices/worktrees-slice-test-fixtures'
import { useAppStore } from '@/store'
import { McpConfigSection } from './McpConfigSection'
import {
  captureMcpConfigOperation,
  resolveMcpConfigWorkspaceOwner
} from './mcp-config-workspace-owner'

const { readDirectory, readFile, writeFile, pathExists, desktopWrite, desktopRead } = vi.hoisted(
  () => ({
    readDirectory: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(true),
    desktopWrite: vi.fn().mockResolvedValue(undefined),
    desktopRead: vi.fn().mockResolvedValue({
      content: '{"mcpServers":{"DESKTOP_OWNER":{"command":"desktop"}}}',
      isBinary: false
    })
  })
)
vi.mock('@/runtime/runtime-file-client', () => ({
  readRuntimeDirectory: readDirectory,
  readRuntimeFileContent: readFile,
  writeRuntimeFile: writeFile,
  runtimePathExists: pathExists
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const initialState = useAppStore.getInitialState()
const root = '/same/project'
const worktreeId = `repo::${root}`
const repo: Repo = { id: 'repo', path: root, displayName: 'Project', badgeColor: '', addedAt: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  readDirectory.mockResolvedValue([{ name: '.mcp.json', isDirectory: false }])
  readFile.mockResolvedValue({
    content: '{"mcpServers":{"SELECTED_OWNER":{"command":"selected"}}}',
    isBinary: false
  })
  useAppStore.setState(initialState, true)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      fs: {
        readDir: vi.fn().mockImplementation(() => readDirectory()),
        readFile: desktopRead,
        writeFile: desktopWrite
      },
      shell: { pathExists: vi.fn().mockResolvedValue(true) }
    }
  })
})
afterEach(() => {
  cleanup()
  useAppStore.setState(initialState, true)
  Reflect.deleteProperty(window, 'api')
})

const owners: {
  name: string
  hostId: ExecutionHostId
  connectionId?: string
  environmentId: string | null
}[] = [
  {
    name: 'managed host while another server is focused',
    hostId: 'runtime:host-a',
    environmentId: 'host-a'
  },
  { name: 'desktop while a managed host is focused', hostId: 'local', environmentId: null },
  {
    name: 'SSH identity without the legacy connection field',
    hostId: 'ssh:target-a',
    environmentId: null
  },
  {
    name: 'nested SSH through its owning server',
    hostId: 'runtime:host-a',
    connectionId: 'target-a',
    environmentId: 'host-a'
  }
]

function seedOwner(owner: (typeof owners)[number]): Repo {
  const selected = { ...repo, executionHostId: owner.hostId, connectionId: owner.connectionId }
  const target = {
    targetId: 'target-a',
    status: 'connected' as const,
    connectionGeneration: 3,
    error: null,
    reconnectAttempt: 0
  }
  useAppStore.setState({
    settings: { ...getDefaultSettings('/tmp'), activeRuntimeEnvironmentId: 'host-b' },
    repos: [{ ...repo, executionHostId: 'runtime:host-b' }, selected],
    worktreesByRepo: {
      repo: [
        makeWorktree({ id: worktreeId, repoId: 'repo', path: root, hostId: 'runtime:host-b' }),
        makeWorktree({
          id: worktreeId,
          repoId: 'repo',
          path: root,
          hostId: owner.connectionId ? 'ssh:target-a' : owner.hostId,
          ...(owner.environmentId ? { runtimeOwnerEnvironmentId: owner.environmentId } : {})
        })
      ]
    },
    sshConnectionStates: new Map([['target-a', target]]),
    sshStateByEnvironment: new Map([
      [
        'host-a',
        {
          targetsHydrated: true,
          targets: [],
          targetLabels: new Map(),
          targetGenerations: new Map(),
          removedTargetLabels: new Map(),
          connectionStates: new Map([['target-a', target]])
        }
      ]
    ]),
    openFile: vi.fn().mockReturnValue('opened'),
    setActiveWorktree: vi.fn(),
    ensureWorktreeRootGroup: vi.fn().mockReturnValue('group')
  })
  return selected
}

for (const owner of owners) {
  it(`inspects the selected ${owner.name}`, async () => {
    render(<McpConfigSection repo={seedOwner(owner)} />)
    await screen.findByText('SELECTED_OWNER')
    expect(screen.queryByText('DESKTOP_OWNER')).toBeNull()
    expect(readFile).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: { activeRuntimeEnvironmentId: owner.environmentId },
        worktreeId,
        filePath: `${root}/.mcp.json`,
        relativePath: '.mcp.json',
        connectionId: owner.environmentId
          ? undefined
          : owner.hostId === 'local'
            ? undefined
            : 'target-a'
      })
    )
    expect(desktopRead).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(useAppStore.getState().setActiveWorktree).toHaveBeenCalledWith(
      worktreeId,
      owner.connectionId ? 'ssh:target-a' : owner.hostId
    )
    expect(useAppStore.getState().openFile).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeEnvironmentId: owner.environmentId,
        filePath: `${root}/.mcp.json`
      }),
      expect.objectContaining({ suppressActiveRuntimeFallback: owner.environmentId === null })
    )
  })

  it(`creates the starter on the selected ${owner.name}`, async () => {
    readDirectory.mockResolvedValue([])
    render(<McpConfigSection repo={seedOwner(owner)} />)
    const create = await screen.findByRole('button', { name: 'Add MCP config' })
    await waitFor(() => expect(create.hasAttribute('disabled')).toBe(false))
    fireEvent.click(create)
    fireEvent.click(await screen.findByRole('button', { name: 'Create empty config' }))
    await waitFor(() =>
      expect(writeFile).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: { activeRuntimeEnvironmentId: owner.environmentId },
          worktreeId,
          worktreePath: root,
          expectedExecutionHostId:
            owner.connectionId || owner.hostId.startsWith('ssh:') ? 'ssh:target-a' : 'local',
          ...(owner.connectionId || owner.hostId.startsWith('ssh:')
            ? {
                expectedSshTargetId: 'target-a',
                expectedSshConnectionGeneration: 3
              }
            : {})
        }),
        `${root}/.mcp.json`,
        MCP_STARTER_CONFIG
      )
    )
    expect(desktopWrite).not.toHaveBeenCalled()
  })
}

it('keeps a completed refresh when an older inspection finishes later', async () => {
  let finish: (entries: { name: string; isDirectory: boolean }[]) => void = () => {
    throw new Error('Pending inspection not initialized')
  }
  readDirectory.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  render(
    <McpConfigSection
      repo={seedOwner({ name: 'managed', hostId: 'runtime:host-a', environmentId: 'host-a' })}
    />
  )
  await waitFor(() => expect(readDirectory).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh MCP configs' }))
  await screen.findByText('SELECTED_OWNER')
  readFile.mockResolvedValue({
    content: '{"mcpServers":{"STALE_OWNER":{"command":"stale"}}}',
    isBinary: false
  })
  await act(async () => {
    finish([{ name: '.mcp.json', isDirectory: false }])
  })
  expect(screen.queryByText('STALE_OWNER')).toBeNull()
  expect(screen.getByText('SELECTED_OWNER')).toBeTruthy()
})

it('reports an unavailable managed filesystem without reading the desktop', async () => {
  readDirectory.mockRejectedValue(new Error('Managed host unavailable'))
  render(
    <McpConfigSection
      repo={seedOwner({ name: 'managed', hostId: 'runtime:host-a', environmentId: 'host-a' })}
    />
  )
  await screen.findByText('Managed host unavailable')
  expect(desktopRead).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Add MCP config' })).toBeNull()
})

it('selects the managed main worktree instead of the active desktop branch', () => {
  const selected = seedOwner({ name: 'managed', hostId: 'runtime:host-a', environmentId: 'host-a' })
  const desktopBranch = makeWorktree({
    id: 'repo::/desktop-branch',
    repoId: 'repo',
    path: '/desktop-branch',
    hostId: 'local'
  })
  const managedMain = makeWorktree({
    id: worktreeId,
    repoId: 'repo',
    path: root,
    hostId: 'runtime:host-a',
    isMainWorktree: true
  })
  useAppStore.setState({
    activeWorktreeId: desktopBranch.id,
    activeWorkspaceExecutionHostId: 'local',
    worktreesByRepo: { repo: [desktopBranch, managedMain] }
  })
  expect(resolveMcpConfigWorkspaceOwner(useAppStore.getState(), selected)).toMatchObject({
    worktreeId,
    rootPath: root
  })
})

it('refuses a captured starter write after the SSH connection is replaced', () => {
  const selected = seedOwner({ name: 'SSH', hostId: 'ssh:target-a', environmentId: null })
  const workspace = resolveMcpConfigWorkspaceOwner(useAppStore.getState(), selected)
  const operation = captureMcpConfigOperation(selected, workspace, useAppStore.getState)
  operation.assertCurrent()
  const states = new Map(useAppStore.getState().sshConnectionStates)
  const previous = states.get('target-a')
  if (!previous) {
    throw new Error('Missing SSH fixture')
  }
  states.set('target-a', { ...previous, connectionGeneration: 4 })
  useAppStore.setState({ sshConnectionStates: states })
  expect(() => operation.assertCurrent()).toThrow()
})
