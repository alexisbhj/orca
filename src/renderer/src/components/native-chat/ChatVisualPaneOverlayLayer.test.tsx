// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab, TabGroup } from '../../../../shared/tab-types'
import type { OpenFile } from '@/store/slices/editor'

type MockAppState = {
  unifiedTabsByWorktree: Record<string, readonly Tab[]>
  groupsByWorktree: Record<string, readonly TabGroup[]>
  openFiles: readonly OpenFile[]
  focusGroup: (worktreeId: string, groupId: string) => void
}

type Mocks = {
  store: { setState: (state: Partial<MockAppState>) => void } | null
  mounts: number
  unmounts: number
}

const mocks = vi.hoisted((): Mocks => ({ store: null, mounts: 0, unmounts: 0 }))

vi.mock('@/store', async () => {
  const { create } = await import('zustand')
  const useAppStore = create<MockAppState>(() => ({
    unifiedTabsByWorktree: {},
    groupsByWorktree: {},
    openFiles: [],
    focusGroup: vi.fn()
  }))
  mocks.store = useAppStore
  return { useAppStore }
})

vi.mock('./NativeChatVisualTab', async () => {
  const { useEffect } = await import('react')
  return {
    NativeChatVisualTab: function MockNativeChatVisualTab({
      visual
    }: {
      visual: { file: string; title: string | null }
    }) {
      useEffect(() => {
        mocks.mounts += 1
        return () => {
          mocks.unmounts += 1
        }
      }, [])
      return <span data-visual-file={visual.file} data-visual-title={visual.title ?? ''} />
    }
  }
})

import ChatVisualPaneOverlayLayer from './ChatVisualPaneOverlayLayer'
import { acquireWebviewsDragPassthrough } from '../browser-pane/host-guest/webview-drag-passthrough'

const WORKTREE_ID = 'wt-1'
const VISUAL_FILE_ID = 'wt-1::chat-visual::session-1::latency.html'
const CHAT_TAB: Tab = tab('chat-tab', 'session-1', 'agent-session', 'group-1')
const VISUAL_TAB: Tab = tab('visual-tab', VISUAL_FILE_ID, 'chat-visual', 'group-1')
const visual = {
  target: { kind: 'local' as const },
  sessionId: 'session-1',
  file: 'latency.html',
  title: 'Latency'
}

describe('ChatVisualPaneOverlayLayer', () => {
  beforeEach(() => {
    mocks.mounts = 0
    mocks.unmounts = 0
    mocks.store?.setState({
      unifiedTabsByWorktree: { [WORKTREE_ID]: [CHAT_TAB, VISUAL_TAB] },
      groupsByWorktree: { [WORKTREE_ID]: [group('group-1', VISUAL_TAB.id)] },
      openFiles: [
        {
          id: VISUAL_FILE_ID,
          filePath: VISUAL_FILE_ID,
          relativePath: 'Latency',
          worktreeId: WORKTREE_ID,
          language: 'plaintext',
          isDirty: false,
          mode: 'chat-visual',
          chatVisual: visual
        }
      ]
    })
  })

  afterEach(cleanup)

  it('keeps the visual mounted while its tab is inactive or moved to another split', () => {
    const view = render(<ChatVisualPaneOverlayLayer worktreeId={WORKTREE_ID} isWorktreeActive />)
    const frame = visualFrame(view.container)
    expect(hostOf(frame).getAttribute('aria-hidden')).toBe('false')

    act(() => {
      mocks.store?.setState({
        groupsByWorktree: { [WORKTREE_ID]: [group('group-1', CHAT_TAB.id)] }
      })
    })
    expect(visualFrame(view.container)).toBe(frame)
    expect(hostOf(frame).getAttribute('aria-hidden')).toBe('true')
    expect(hostOf(frame).hasAttribute('inert')).toBe(true)

    act(() => {
      mocks.store?.setState({
        unifiedTabsByWorktree: {
          [WORKTREE_ID]: [CHAT_TAB, { ...VISUAL_TAB, groupId: 'group-2' }]
        },
        groupsByWorktree: {
          [WORKTREE_ID]: [group('group-1', CHAT_TAB.id), group('group-2', VISUAL_TAB.id)]
        }
      })
    })
    expect(visualFrame(view.container)).toBe(frame)
    expect(hostOf(frame).getAttribute('aria-hidden')).toBe('false')
    expect(mocks.mounts).toBe(1)
    expect(mocks.unmounts).toBe(0)
  })

  it('lets a dragged tab pass over the frame while a tab drag holds passthrough', () => {
    const view = render(<ChatVisualPaneOverlayLayer worktreeId={WORKTREE_ID} isWorktreeActive />)
    const wrapper = visualFrame(view.container).parentElement

    expect(wrapper?.dataset.dragPassthrough).toBe('false')
    let release = (): void => {}
    act(() => {
      release = acquireWebviewsDragPassthrough()
    })
    expect(wrapper?.dataset.dragPassthrough).toBe('true')
    act(() => release())
    expect(wrapper?.dataset.dragPassthrough).toBe('false')
  })

  it('hides the visual with its workspace and drops it when the tab closes', () => {
    const view = render(
      <ChatVisualPaneOverlayLayer worktreeId={WORKTREE_ID} isWorktreeActive={false} />
    )
    expect(hostOf(visualFrame(view.container)).getAttribute('aria-hidden')).toBe('true')

    act(() => {
      mocks.store?.setState({ unifiedTabsByWorktree: { [WORKTREE_ID]: [CHAT_TAB] } })
    })
    expect(view.container.querySelector('[data-visual-file]')).toBeNull()
    expect(mocks.unmounts).toBe(1)
  })
})

function tab(id: string, entityId: string, contentType: Tab['contentType'], groupId: string): Tab {
  return {
    id,
    entityId,
    groupId,
    worktreeId: WORKTREE_ID,
    contentType,
    label: id,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function group(id: string, activeTabId: string): TabGroup {
  return { id, worktreeId: WORKTREE_ID, activeTabId, tabOrder: [activeTabId] }
}

function hostOf(frame: HTMLElement): HTMLElement {
  const host = frame.closest<HTMLElement>('[data-retained-pane-host]')
  if (!host) {
    throw new Error('missing retained pane host')
  }
  return host
}

function visualFrame(container: HTMLElement): HTMLElement {
  const frame = container.querySelector<HTMLElement>('[data-visual-file="latency.html"]')
  if (!frame) {
    throw new Error('missing chat visual frame')
  }
  return frame
}
