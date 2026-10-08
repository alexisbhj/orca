import { agentChatPermissionModeFromSetting } from './agent-chat-permission-mode'
import type { GlobalSettings } from './global-settings-types'

export function nativeChatPermissionDefaultRevision(
  settings: Pick<GlobalSettings, 'nativeChatPermissionRevision'>
): number {
  const revision = settings.nativeChatPermissionRevision
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0
    ? revision
    : 0
}

/** Only the host orders default changes; a client cannot supply their revision. */
export function stampNativeChatPermissionDefault(
  previous: Pick<GlobalSettings, 'nativeChatPermissionMode' | 'nativeChatPermissionRevision'>,
  updates: Partial<GlobalSettings>
): Partial<GlobalSettings> {
  const sanitized: Partial<GlobalSettings> = { ...updates }
  delete sanitized.nativeChatPermissionRevision
  if (!('nativeChatPermissionMode' in sanitized)) {
    return sanitized
  }
  sanitized.nativeChatPermissionMode = agentChatPermissionModeFromSetting(
    sanitized.nativeChatPermissionMode
  )
  if (
    sanitized.nativeChatPermissionMode !==
    agentChatPermissionModeFromSetting(previous.nativeChatPermissionMode)
  ) {
    const revision = nativeChatPermissionDefaultRevision(previous) + 1
    if (!Number.isSafeInteger(revision)) {
      throw new Error('native_chat_permission_revision_exhausted')
    }
    sanitized.nativeChatPermissionRevision = revision
  }
  return sanitized
}
