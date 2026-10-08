import {
  isAgentChatPermissionMode,
  type AgentChatPermissionMode
} from '../../../../shared/agent-chat-permission-mode'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { StoredWebRuntimeEnvironment } from '../web-runtime-environment'
import { requireActiveEnvironmentOrNull } from './web-runtime-session'

let hostSetting: { owner: string; mode: AgentChatPermissionMode } | null = null

function owner(environment: StoredWebRuntimeEnvironment | null): string | null {
  return environment
    ? JSON.stringify([environment.id, environment.pairingRevision ?? environment.createdAt])
    : null
}

export function captureWebChatPermissionSetting(
  requestedOwner: string | null,
  settings: Partial<GlobalSettings>
): void {
  if (!requestedOwner || requestedOwner !== webChatPermissionOwner()) {
    return
  }
  hostSetting = isAgentChatPermissionMode(settings.nativeChatPermissionMode)
    ? { owner: requestedOwner, mode: settings.nativeChatPermissionMode }
    : null
}

export function webChatPermissionOwner(): string | null {
  return owner(requireActiveEnvironmentOrNull())
}

/** Browser persistence cannot attest to an execution host's permission default. */
export function settingsForWebChatPermissionOwner(settings: GlobalSettings): GlobalSettings {
  return {
    ...settings,
    nativeChatPermissionMode:
      hostSetting?.owner === webChatPermissionOwner() ? hostSetting?.mode : undefined,
    nativeChatPermissionRevision: undefined
  }
}

export function webChatPermissionUpdate(updates: Partial<GlobalSettings>): Partial<GlobalSettings> {
  return hostSetting?.owner === webChatPermissionOwner() &&
    isAgentChatPermissionMode(updates.nativeChatPermissionMode)
    ? { nativeChatPermissionMode: updates.nativeChatPermissionMode }
    : {}
}
