// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceFileDragSource } from '@/lib/workspace-file-drag'
import type { FileExplorerOperationOwner } from './file-explorer-types'
import type * as FileExplorerOperationOwnerModule from './file-explorer-operation-owner'
import { useFileExplorerMoveDrop } from './useFileExplorerMoveDrop'

const mocks = vi.hoisted(() => ({
  move: vi.fn(),
  error: vi.fn(),
  commit: vi.fn<(operation: { undo: () => Promise<void>; redo: () => Promise<void> }) => void>(),
  capture: vi.fn(),
  assertCurrent: vi.fn(),
  refresh: vi.fn()
}))
vi.mock('sonner', () => ({ toast: { error: mocks.error } }))
vi.mock('@/lib/execute-open-editor-path-move', () => ({ executeOpenEditorPathMove: mocks.move }))
vi.mock('./fileExplorerUndoRedo', () => ({ commitFileExplorerOp: mocks.commit }))
vi.mock('./file-explorer-operation-owner', async (importOriginal) => ({
  ...(await importOriginal<typeof FileExplorerOperationOwnerModule>()),
  captureFileExplorerOperationGuard: mocks.capture
}))

const localSource: WorkspaceFileDragSource = { executionHostId: 'local', workspaceId: 'source' }
const runtimeSource: WorkspaceFileDragSource = {
  executionHostId: 'runtime:env-a',
  workspaceId: 'source'
}
const localOwner = { kind: 'local' } as const
const runtimeOwner = {
  kind: 'runtime',
  executionHostId: 'runtime:env-a',
  environmentId: 'env-a'
} as const

async function drop(
  source: WorkspaceFileDragSource | null,
  sourceOwner: FileExplorerOperationOwner = localOwner,
  destinationOwner: FileExplorerOperationOwner = sourceOwner,
  destination = '/repo/target'
) {
  const { result } = renderHook(() =>
    useFileExplorerMoveDrop({
      worktreePath: '/repo',
      activeWorktreeId: 'folder:destination',
      refreshDir: mocks.refresh,
      getOperationOwnerForPath: (path) =>
        path === '/repo/file.txt' ? sourceOwner : destinationOwner,
      setDropTargetDir: vi.fn()
    })
  )
  await act(async () => result.current('/repo/file.txt', destination, source))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.move.mockResolvedValue(undefined)
  mocks.refresh.mockResolvedValue(undefined)
  mocks.capture.mockReturnValue({
    route: { settings: { activeRuntimeEnvironmentId: null }, expectedExecutionHostId: 'local' },
    assertCurrent: mocks.assertCurrent
  })
})
afterEach(cleanup)

describe('Explorer move drop source ownership', () => {
  it.each([
    [runtimeSource, localOwner, localOwner],
    [localSource, runtimeOwner, runtimeOwner],
    [null, localOwner, localOwner],
    [
      { executionHostId: 'runtime:unresolved-owner', workspaceId: 'source' },
      localOwner,
      localOwner
    ],
    [localSource, localOwner, runtimeOwner],
    [localSource, localOwner, { kind: 'unresolved' }],
    [
      { executionHostId: 'ssh:target', runtimeEnvironmentId: 'env-a', workspaceId: 'source' },
      { kind: 'runtime', executionHostId: 'ssh:target', environmentId: 'env-b' },
      { kind: 'runtime', executionHostId: 'ssh:target', environmentId: 'env-b' }
    ]
  ] satisfies [
    WorkspaceFileDragSource | null,
    FileExplorerOperationOwner,
    FileExplorerOperationOwner
  ][])(
    'refuses a foreign, unknown, or stale cached owner: %j / %j / %j',
    async (source, sourceOwner, destinationOwner) => {
      await drop(source, sourceOwner, destinationOwner)
      expect(mocks.move).not.toHaveBeenCalled()
      expect(mocks.commit).not.toHaveBeenCalled()
      expect(mocks.refresh).not.toHaveBeenCalled()
      expect(mocks.error).toHaveBeenCalledWith('Move files from the same host as this workspace.')
    }
  )

  it.each([
    [localSource, localOwner],
    [runtimeSource, runtimeOwner],
    [
      { executionHostId: 'ssh:target', runtimeEnvironmentId: 'env-a', workspaceId: 'source' },
      { kind: 'runtime', executionHostId: 'ssh:target', environmentId: 'env-a' }
    ]
  ] satisfies [WorkspaceFileDragSource, FileExplorerOperationOwner][])(
    'keeps a verified same-host move: %j / %j',
    async (source, owner) => {
      await drop(source, owner)
      expect(mocks.move).toHaveBeenCalledWith(
        expect.objectContaining({ fromPath: '/repo/file.txt', toPath: '/repo/target/file.txt' })
      )
      expect(mocks.assertCurrent).toHaveBeenCalled()
      expect(mocks.commit).toHaveBeenCalledOnce()
      expect(mocks.refresh).toHaveBeenCalledWith('/repo')
      expect(mocks.refresh).toHaveBeenCalledWith('/repo/target')
      expect(mocks.error).not.toHaveBeenCalled()
    }
  )

  it('keeps existing self-drop and descendant protections', async () => {
    await drop(localSource, localOwner, localOwner, '/repo')
    await drop(localSource, localOwner, localOwner, '/repo/file.txt/child')
    expect(mocks.move).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('does not move after the workspace owner changes before mutation', async () => {
    mocks.assertCurrent.mockImplementationOnce(() => {
      throw new Error('Workspace host changed')
    })
    await drop(localSource)
    expect(mocks.move).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith('Workspace host changed')
  })

  it('keeps undo and redo on the captured server and checks its generation', async () => {
    const route = {
      settings: { activeRuntimeEnvironmentId: 'env-a' },
      expectedExecutionHostId: 'ssh:target',
      connectionId: 'target',
      expectedSshTargetId: 'target',
      expectedSshConnectionGeneration: 1
    }
    mocks.capture.mockReturnValue({ route, assertCurrent: mocks.assertCurrent })
    await drop(
      { executionHostId: 'ssh:target', runtimeEnvironmentId: 'env-a', workspaceId: 'source' },
      { kind: 'runtime', executionHostId: 'ssh:target', environmentId: 'env-a' }
    )
    const operation = mocks.commit.mock.calls[0]?.[0]
    if (!operation) {
      throw new Error('Move did not register undo')
    }
    await operation.undo()
    await operation.redo()
    expect(mocks.move).toHaveBeenCalledTimes(3)
    expect(mocks.move).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        context: expect.objectContaining(route),
        fromPath: '/repo/target/file.txt',
        toPath: '/repo/file.txt'
      })
    )
    expect(mocks.move).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        context: expect.objectContaining(route),
        fromPath: '/repo/file.txt',
        toPath: '/repo/target/file.txt'
      })
    )
    mocks.assertCurrent.mockImplementationOnce(() => {
      throw new Error('SSH generation changed')
    })
    await expect(operation.undo()).rejects.toThrow('SSH generation changed')
    expect(mocks.move).toHaveBeenCalledTimes(3)
  })
})
