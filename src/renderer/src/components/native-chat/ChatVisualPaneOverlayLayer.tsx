import { memo, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Tab, TabGroup } from '../../../../shared/tab-types'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { RetainedPaneHost } from '../tab-group/RetainedPaneHost'
import { useWebviewDragPassthroughActive } from '../browser-pane/host-guest/use-webview-drag-passthrough-active'
import { NativeChatVisualTab } from './NativeChatVisualTab'
import type { OpenChatVisualTabState } from './native-chat-visual-tab'

const EMPTY_UNIFIED_TABS: readonly Tab[] = []
const EMPTY_GROUPS: readonly TabGroup[] = []

const ChatVisualOverlaySlot = memo(function ChatVisualOverlaySlot({
  groupId,
  isVisible,
  visual,
  reloadNonce,
  onFocusOwningGroup
}: {
  groupId: string
  isVisible: boolean
  visual: OpenChatVisualTabState
  reloadNonce: number
  onFocusOwningGroup: (groupId: string) => void
}): React.JSX.Element {
  // Why: a tab dragged over the frame must keep its pointer stream in Orca's document to split or drop here.
  const dragPassthrough = useWebviewDragPassthroughActive()
  return (
    <RetainedPaneHost
      groupId={groupId}
      isVisible={isVisible}
      onFocusOwningGroup={onFocusOwningGroup}
    >
      <div
        data-drag-passthrough={dragPassthrough}
        className="flex min-h-0 min-w-0 flex-1 data-[drag-passthrough=true]:pointer-events-none"
      >
        <NativeChatVisualTab visual={visual} isVisible={isVisible} reloadNonce={reloadNonce} />
      </div>
    </RetainedPaneHost>
  )
})

/**
 * One frame per open visual tab, kept mounted while its tab is inactive: the page runs scripts and
 * holds what the reader did in it, which an editor-area remount on every tab switch would lose.
 */
const ChatVisualPaneOverlayLayer = memo(function ChatVisualPaneOverlayLayer({
  worktreeId,
  isWorktreeActive
}: {
  worktreeId: string
  isWorktreeActive: boolean
}): React.JSX.Element {
  const { unifiedTabs, groups, openFiles } = useAppStore(
    useShallow((state) => ({
      unifiedTabs: state.unifiedTabsByWorktree[worktreeId] ?? EMPTY_UNIFIED_TABS,
      groups: state.groupsByWorktree[worktreeId] ?? EMPTY_GROUPS,
      openFiles: state.openFiles
    }))
  )
  const focusGroup = useAppStore((state) => state.focusGroup)
  const focusOwningGroup = useCallback(
    (groupId: string) => focusGroup(worktreeId, groupId),
    [focusGroup, worktreeId]
  )
  const groupActiveTabById = useMemo(
    () => new Map(groups.map((group) => [group.id, group.activeTabId] as const)),
    [groups]
  )
  const visualFileById = useMemo(() => {
    const byId = new Map<string, OpenFile>()
    for (const file of openFiles) {
      if (file.mode === 'chat-visual' && file.worktreeId === worktreeId) {
        byId.set(file.id, file)
      }
    }
    return byId
  }, [openFiles, worktreeId])

  return (
    <>
      {unifiedTabs.map((tab) => {
        const file =
          tab.contentType === 'chat-visual' ? visualFileById.get(tab.entityId) : undefined
        return file?.chatVisual ? (
          <ChatVisualOverlaySlot
            key={tab.id}
            groupId={tab.groupId}
            isVisible={isWorktreeActive && groupActiveTabById.get(tab.groupId) === tab.id}
            visual={file.chatVisual}
            reloadNonce={file.fileContentReloadNonce ?? 0}
            onFocusOwningGroup={focusOwningGroup}
          />
        ) : null
      })}
    </>
  )
})

export default ChatVisualPaneOverlayLayer
