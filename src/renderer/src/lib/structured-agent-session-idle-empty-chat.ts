import type { TuiAgent } from '../../../shared/tui-agent'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { Tab } from '../../../shared/tab-types'
import { useAppStore } from '@/store'
import {
  structuredAgentSessionOwnerForTab,
  structuredAgentSessionTargetForHost
} from '@/runtime/structured-agent-session-owner'
import { getStructuredAgentSessionStatusFeed } from '@/runtime/structured-agent-session-status-feed'
import { getStructuredAgentSessionLaunchLifecycle } from './structured-agent-session-launch-registry'
import { isStructuredLaunchChatEmpty } from './structured-agent-session-launch-empty-chat'

export type IdleEmptyStructuredChat = { sessionId: string; executionHostId: ExecutionHostId }

/** Published, and its host's journal holds no request (a null status). A resumed chat's journal
 *  holds the imported conversation, so it never reads as empty. A host that names the mode a new
 *  chat starts in only offers an empty chat already in it, so a changed default opens a new chat. */
function hostOffersEmptyChat(
  tab: Tab,
  executionHostId: ExecutionHostId,
  permissionMode: string | undefined
): boolean {
  const lifecycle = getStructuredAgentSessionLaunchLifecycle(tab.worktreeId, tab.entityId)
  const target = structuredAgentSessionTargetForHost(executionHostId)
  if ((lifecycle !== null && lifecycle !== 'published') || !target) {
    return false
  }
  const feed = getStructuredAgentSessionStatusFeed(target)
  const summary = feed.getSnapshot().get(tab.entityId)
  // Why live only: a summary cached across a lost stream may predate a message the host took.
  return (
    feed.getSessionObservation(tab.entityId) === 'live' &&
    summary?.status === null &&
    (permissionMode === undefined || summary.permissionMode === permissionMode)
  )
}

/** A launch draft its composer has not taken in yet (a chat opened in the background). */
function holdsUnadoptedLaunchDraft(tabId: string): boolean {
  const draft = useAppStore.getState().nativeChatLaunchDraftByTabId[tabId]
  return Boolean(draft && !draft.adopted && !draft.resolved && draft.text.trim())
}

/** An open chat for `agent` in this workspace's `groupId` (else any group) that nothing was ever
 *  sent into and whose composer is untouched. Prefers the group's active tab, else the newest.
 *  `permissionMode`: the mode the host said a new chat would start in, when it said one. */
export function findIdleEmptyStructuredChat(
  worktreeId: string,
  agent: TuiAgent,
  executionHostId?: ExecutionHostId,
  groupId?: string,
  permissionMode?: string
): IdleEmptyStructuredChat | undefined {
  const state = useAppStore.getState()
  const candidates: (IdleEmptyStructuredChat & { tab: Tab })[] = []
  for (const tab of state.unifiedTabsByWorktree[worktreeId] ?? []) {
    const owner =
      tab.contentType === 'agent-session' && tab.agentSessionAgent === agent
        ? structuredAgentSessionOwnerForTab(state, tab)
        : null
    if (
      owner &&
      (!groupId || tab.groupId === groupId) &&
      (!executionHostId || owner === executionHostId) &&
      hostOffersEmptyChat(tab, owner, permissionMode) &&
      isStructuredLaunchChatEmpty(tab.entityId) &&
      !holdsUnadoptedLaunchDraft(tab.id)
    ) {
      candidates.push({ sessionId: tab.entityId, executionHostId: owner, tab })
    }
  }
  if (candidates.length === 0) {
    return undefined
  }
  const focusGroupId = groupId ?? state.activeGroupIdByWorktree[worktreeId]
  const focusedTabId = state.groupsByWorktree[worktreeId]?.find(
    (group) => group.id === focusGroupId
  )?.activeTabId
  const chosen =
    candidates.find((candidate) => candidate.tab.id === focusedTabId) ??
    candidates.toSorted((a, b) => a.tab.createdAt - b.tab.createdAt).at(-1)
  return chosen && { sessionId: chosen.sessionId, executionHostId: chosen.executionHostId }
}
