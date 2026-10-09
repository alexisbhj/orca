// @vitest-environment happy-dom
import { useRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_FILE_DRAG_SOURCE_MIME,
  WORKSPACE_FILE_PATH_MIME,
  WORKSPACE_FILE_PATHS_MIME
} from '@/lib/workspace-file-drag'
import { useFileExplorerDragDrop } from './useFileExplorerDragDrop'
import { useFileExplorerRowDrag } from './useFileExplorerRowDrag'

const move = vi.hoisted(() => vi.fn())
vi.mock('./useFileExplorerMoveDrop', () => ({ useFileExplorerMoveDrop: () => move }))
vi.mock('./useFileExplorerDragEdgeScroll', () => ({
  useFileExplorerDragEdgeScroll: () => ({
    startDragEdgeScroll: vi.fn(),
    stopDragEdgeScroll: vi.fn()
  })
}))
vi.mock('./useFileExplorerDragExpand', () => ({
  useFileExplorerDragExpand: () => ({
    handleDragExpandDir: vi.fn(),
    handleNativeDragExpandDir: vi.fn()
  })
}))

function Targets() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const root = useFileExplorerDragDrop({
    worktreePath: '/repo',
    activeWorktreeId: 'destination',
    expanded: new Set(),
    toggleDir: vi.fn(),
    refreshDir: vi.fn(),
    scrollRef,
    getOperationOwnerForPath: vi.fn()
  })
  const row = useFileExplorerRowDrag({
    rowDropDir: '/repo/dir',
    isDirectory: true,
    nodePath: '/repo/dir',
    isExpanded: true,
    onDragTargetChange: vi.fn(),
    onDragExpandDir: vi.fn(),
    onNativeDragTargetChange: vi.fn(),
    onNativeDragExpandDir: vi.fn(),
    onMoveDrop: move
  })
  return (
    <div data-testid="root" {...root.rootDragHandlers}>
      <button data-testid="row" onDrop={row.handleDrop} />
    </div>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Explorer move drop source payload dispatch', () => {
  it.each(['row', 'root'])('forwards the source namespace for every path at the %s', (target) => {
    const view = render(<Targets />)
    const source = {
      version: 1,
      executionHostId: 'ssh:target',
      workspaceId: 'source',
      runtimeEnvironmentId: 'env-a'
    }
    const data = new Map([
      [WORKSPACE_FILE_PATH_MIME, '/repo/a.txt'],
      [WORKSPACE_FILE_PATHS_MIME, JSON.stringify(['/repo/a.txt', '/repo/b.txt'])],
      [WORKSPACE_FILE_DRAG_SOURCE_MIME, JSON.stringify(source)]
    ])
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: [...data.keys()], getData: (type: string) => data.get(type) ?? '' }
    })
    act(() => {
      view.getByTestId(target).dispatchEvent(event)
    })
    const expectedSource = {
      executionHostId: 'ssh:target',
      workspaceId: 'source',
      runtimeEnvironmentId: 'env-a'
    }
    const destination = target === 'row' ? '/repo/dir' : '/repo'
    expect(move.mock.calls).toEqual([
      ['/repo/a.txt', destination, expectedSource],
      ['/repo/b.txt', destination, expectedSource]
    ])
  })

  it.each(['row', 'root'])('passes an unknown source to the mutation guard at the %s', (target) => {
    const view = render(<Targets />)
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', {
      value: {
        types: [WORKSPACE_FILE_PATH_MIME],
        getData: (type: string) =>
          type === WORKSPACE_FILE_PATH_MIME
            ? '/repo/a.txt'
            : type === WORKSPACE_FILE_DRAG_SOURCE_MIME
              ? '{invalid'
              : ''
      }
    })
    act(() => {
      view.getByTestId(target).dispatchEvent(event)
    })
    expect(move).toHaveBeenCalledWith('/repo/a.txt', target === 'row' ? '/repo/dir' : '/repo', null)
  })
})
