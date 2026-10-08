import { isAgentChatPermissionMode } from '../../../src/shared/agent-chat-permission-mode'
import type {
  StructuredAgentSessionAction,
  StructuredAgentSessionState
} from '../../../src/shared/structured-agent-session-reducer'
import type { AgentChatPermissionMode } from '../../../src/shared/agent-chat-permission-mode'

export type MobileStructuredPermissionPublication = {
  mode: AgentChatPermissionMode | null
  fence: number | null
}

export type MobileStructuredPublishedState = StructuredAgentSessionState & {
  permissionPublication?: MobileStructuredPermissionPublication
}

export function withMobileStructuredPermissionPublication(
  previous: MobileStructuredPublishedState,
  next: StructuredAgentSessionState,
  action: StructuredAgentSessionAction
): MobileStructuredPublishedState {
  const event = action.type === 'event' ? action.event : null
  if (
    !event ||
    event.type === 'end' ||
    (event.permissionMode !== null && !isAgentChatPermissionMode(event.permissionMode)) ||
    (event.type === 'batch' &&
      (previous.epoch !== event.batch.cursor.epoch ||
        (previous.cursor !== null && previous.cursor.sequence > event.batch.cursor.sequence)))
  ) {
    return next === previous
      ? previous
      : { ...next, permissionPublication: previous.permissionPublication }
  }
  // Repeated mode values are still newer host confirmations.
  return {
    ...next,
    permissionPublication: { mode: event.permissionMode, fence: next.fence }
  }
}
