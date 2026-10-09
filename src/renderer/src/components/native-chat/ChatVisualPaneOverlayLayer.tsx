import { memo, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Tab, TabGroup } from '../../../../shared/tab-types'
import { useAppStore } from '@/store'
import { RetainedPaneHost } from '../tab-group/RetainedPaneHost'
import { NativeChatVisualTab } from './NativeChatVisualTab'

const EMPTY_UNIFIED_TABS: readonly Tab[] = []
const EMPTY_GROUPS: readonly TabGroup[] = []

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
  const { unifiedTabs, groups } = useAppStore(
    useShallow((state) => ({
      unifiedTabs: state.unifiedTabsByWorktree[worktreeId] ?? EMPTY_UNIFIED_TABS,
      groups: state.groupsByWorktree[worktreeId] ?? EMPTY_GROUPS
    }))
  )
  const visualFiles = useAppStore(
    useShallow((state) =>
      state.openFiles.filter(
        (file) => file.mode === 'chat-visual' && file.worktreeId === worktreeId
      )
    )
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
  const visualById = useMemo(
    () => new Map(visualFiles.map((file) => [file.id, file.chatVisual] as const)),
    [visualFiles]
  )

  return (
    <>
      {unifiedTabs.map((tab) => {
        const visual = tab.contentType === 'chat-visual' ? visualById.get(tab.entityId) : undefined
        return visual ? (
          <RetainedPaneHost
            key={tab.id}
            groupId={tab.groupId}
            isVisible={isWorktreeActive && groupActiveTabById.get(tab.groupId) === tab.id}
            onFocusOwningGroup={focusOwningGroup}
          >
            <NativeChatVisualTab visual={visual} />
          </RetainedPaneHost>
        ) : null
      })}
    </>
  )
})

export default ChatVisualPaneOverlayLayer
