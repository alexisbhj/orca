import {
  isAgentChatPermissionMode,
  type AgentChatPermissionMode
} from './agent-chat-permission-mode'
import {
  isAgentSessionPermissionOrder,
  type AgentSessionPermissionOrder
} from './agent-session-permission-order'

export type AgentSessionPermissionDefaultAtCreation = {
  /** The host's new-chat permission default when this chat was created. Not the chat's mode:
   *  narrowing and the user's picks change that, never this. Absent from older records. */
  permissionDefaultAtCreation?: AgentChatPermissionMode
}

export function isAgentSessionPermissionDefaultAtCreation(value: {
  permissionDefaultAtCreation?: unknown
}): value is AgentSessionPermissionDefaultAtCreation {
  return (
    value.permissionDefaultAtCreation === undefined ||
    isAgentChatPermissionMode(value.permissionDefaultAtCreation)
  )
}

/** The permission facts a chat record keeps beside its options. */
export type AgentSessionRecordPermissionFacts = AgentSessionPermissionOrder &
  AgentSessionPermissionDefaultAtCreation

export function isAgentSessionRecordPermissionFacts(value: {
  permissionRevision?: unknown
  permissionDefaultAtCreation?: unknown
}): value is AgentSessionRecordPermissionFacts {
  const { permissionRevision, permissionDefaultAtCreation } = value
  return (
    isAgentSessionPermissionOrder({ permissionRevision }) &&
    isAgentSessionPermissionDefaultAtCreation({ permissionDefaultAtCreation })
  )
}
