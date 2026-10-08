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
