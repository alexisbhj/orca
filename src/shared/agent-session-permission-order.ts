import {
  isAgentChatPermissionMode,
  type AgentChatPermissionMode
} from './agent-chat-permission-mode'

export type AgentSessionPermissionOrder = {
  /** Order of permission intent, committed with the options it orders. */
  permissionRevision?: number
  /** Last published default or legacy mode when no canonical choice is stored. */
  permissionFallbackMode?: AgentChatPermissionMode | null
}

export function isAgentSessionPermissionOrder(value: {
  permissionRevision?: unknown
  permissionFallbackMode?: unknown
}): value is AgentSessionPermissionOrder {
  const { permissionRevision: revision, permissionFallbackMode: mode } = value
  return (
    (revision === undefined ||
      (typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0)) &&
    (mode === undefined || mode === null || isAgentChatPermissionMode(mode))
  )
}
