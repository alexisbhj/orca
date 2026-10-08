import {
  storedAgentChatPermissionMode,
  type AgentChatPermissionMode
} from '../../shared/agent-chat-permission-mode'
import type { AgentSessionRecord } from '../../shared/agent-session-record'

/** Runtime-only order advances at the same commit that changes permission intent. */
export class AgentSessionPermissionRevisions {
  private readonly revisions = new Map<string, number>()
  private readonly modes = new Map<string, AgentChatPermissionMode | null>()

  read = (sessionId: string, mode?: AgentChatPermissionMode | null): number => {
    // Legacy chats can inherit changing defaults without a record write.
    if (mode !== undefined) {
      if (this.modes.has(sessionId) && this.modes.get(sessionId) !== mode) {
        this.revisions.set(sessionId, this.read(sessionId) + 1)
      }
      this.modes.set(sessionId, mode)
    }
    return this.revisions.get(sessionId) ?? 0
  }

  commit(
    previous: ReadonlyMap<string, AgentSessionRecord>,
    next: ReadonlyMap<string, AgentSessionRecord>,
    changed: readonly (readonly [string, string])[]
  ): void {
    for (const [id] of changed) {
      const before = previous.get(id)
      const after = next.get(id)
      const priorMode = before && storedAgentChatPermissionMode(before.provider, before.options)
      const mode = after && storedAgentChatPermissionMode(after.provider, after.options)
      if (mode !== priorMode) {
        this.revisions.set(id, this.read(id) + 1)
        if (mode !== undefined) {
          this.modes.set(id, mode)
        }
      }
    }
  }
}
