import {
  commitAgentSessionPermissionMode,
  type AgentChatPermissionMode
} from '../../../src/shared/agent-chat-permission-mode'
import type { StructuredAgentSessionOptionState } from '../../../src/shared/structured-agent-session-options'

export function seedMobileStructuredPermissionState(
  current: StructuredAgentSessionOptionState,
  mode: AgentChatPermissionMode | undefined
): StructuredAgentSessionOptionState {
  return current.permission || !mode
    ? current
    : { ...current, permission: commitAgentSessionPermissionMode(null, current.record.agent, mode) }
}
