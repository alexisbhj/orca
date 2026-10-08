import type { RpcClient } from '../transport/rpc-client'
import type { StructuredAgentSessionMutate } from './mobile-structured-agent-session-rpc'
import type { AgentSessionPermissionSeed } from '../../../src/shared/agent-chat-permission-mode'
import type { MobileStructuredPermissionPublication } from './mobile-structured-permission-publication'

import type { AgentSessionConversationCommand } from '../../../src/shared/agent-session-conversation-command'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface,
  SessionOptionValue
} from '../../../src/shared/native-chat-session-options'
import type { MobileNativeChatPermissionPickerState } from './MobileNativeChatPermissionPicker'

export type StructuredOptionsController = {
  /** Null where the host offers no permission picker for this chat. */
  permissionPicker: MobileNativeChatPermissionPickerState | null
  optionPickerRequest: { id: string; sequence: number } | null
  conversationCommands: readonly AgentSessionConversationCommand[]
  optionSnapshot: SessionOptionDescriptor[]
  optionSurface: SessionOptionsSurface
  pendingOptionId: string | null
  setStructuredOption: (id: string, value: SessionOptionValue) => Promise<boolean>
  invokeStructuredOption: (id: string) => Promise<boolean>
}

export type MobileStructuredAgentOptionsArgs = {
  agent: string | null
  client: RpcClient | null
  sessionId: string | null
  sessionKey?: string
  enabled: boolean
  fence: number | null
  connected?: boolean
  turnId?: string | null
  providerPhase?: string | null
  permissionMode?: string | null
  permissionSeed?: AgentSessionPermissionSeed
  permissionPublication?: MobileStructuredPermissionPublication
  unloadedTurnRevisions?: number
  mutate: StructuredAgentSessionMutate
}
