import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { storedAgentChatPermissionMode } from '../../shared/agent-chat-permission-mode'
import type { RuntimeMobileSessionTabsSnapshot } from '../../shared/runtime-types'

/** Derive the first-frame picker from host intent without another options request. */
export function seedStructuredConversationTabPermissions(
  snapshot: RuntimeMobileSessionTabsSnapshot,
  recordFor: (sessionId: string) => AgentSessionRecord | undefined
): RuntimeMobileSessionTabsSnapshot {
  return {
    ...snapshot,
    tabs: snapshot.tabs.map((tab) => {
      if (tab.type !== 'agent-session') {
        return tab
      }
      const record = recordFor(tab.sessionId)
      const mode = record && storedAgentChatPermissionMode(record.provider, record.options)
      return record?.location.workspaceId === snapshot.worktree && mode
        ? { ...tab, permissionSeed: { mode, fence: record.lease.runtimeFence } }
        : tab
    })
  }
}
