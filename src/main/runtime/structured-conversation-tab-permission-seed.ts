import type { AgentSessionRecord } from '../../shared/agent-session-record'
import type { AgentSessionPermissionFact } from '../../shared/agent-chat-permission-mode'
import { storedAgentChatPermissionMode } from '../../shared/agent-chat-permission-mode'
import type { RuntimeMobileSessionTabsSnapshot } from '../../shared/runtime-types'

/** Derive the first-frame picker from host intent without another options request. */
export function seedStructuredConversationTabPermissions(
  snapshot: RuntimeMobileSessionTabsSnapshot,
  recordFor: (sessionId: string) => AgentSessionRecord | undefined,
  factFor?: (sessionId: string) => AgentSessionPermissionFact | undefined
): RuntimeMobileSessionTabsSnapshot {
  return {
    ...snapshot,
    tabs: snapshot.tabs.map((tab) => {
      if (tab.type !== 'agent-session') {
        return tab
      }
      const record = recordFor(tab.sessionId)
      const fact = factFor?.(tab.sessionId)
      const mode = fact
        ? fact.mode
        : record && storedAgentChatPermissionMode(record.provider, record.options)
      return record?.location.workspaceId === snapshot.worktree && mode
        ? {
            ...tab,
            permissionSeed: {
              mode,
              fence: fact?.fence ?? record.lease.runtimeFence,
              ...(fact ? { revision: fact.revision } : {}),
              ...(fact?.defaultRevision !== undefined
                ? { defaultRevision: fact.defaultRevision }
                : {})
            }
          }
        : tab
    })
  }
}
