import {
  agentChatPermissionModes,
  agentChatLaunchPermissionMode,
  type AgentSessionPermissionFact,
  type AgentSessionPermissionModes
} from '../../../shared/agent-chat-permission-mode'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type { StructuredAgentSessionHostDeps } from './structured-agent-session-host-types'

export function restingPermissionModes(
  record: AgentSessionRecord,
  defaultPermissionMode: StructuredAgentSessionHostDeps['defaultPermissionMode'],
  logger?: StructuredAgentSessionHostDeps['logger']
): AgentSessionPermissionModes | null | undefined {
  try {
    const supported = agentChatPermissionModes(record.provider)
    const fallback = defaultPermissionMode?.(record.provider)
    const current =
      record.options?.permissionMode !== undefined || fallback !== undefined
        ? agentChatLaunchPermissionMode(record.provider, record.options, fallback)
        : null
    return supported && current ? { current, supported } : null
  } catch (error) {
    logger?.warn('reading chat permissions failed', {
      scope: 'permission-fact',
      sessionId: record.sessionId,
      error
    })
    return undefined
  }
}

/** Permission metadata is optional; its failure never blocks transcript delivery. */
export function readStructuredAgentSessionPermissionFact(
  deps: Pick<StructuredAgentSessionHostDeps, 'store' | 'defaultPermissionMode' | 'logger'>,
  sessionId: string
): AgentSessionPermissionFact | undefined {
  try {
    const record = deps.store.getRecord(sessionId)
    if (!record) {
      return undefined
    }
    const permission = restingPermissionModes(record, deps.defaultPermissionMode, deps.logger)
    return permission === undefined
      ? undefined
      : {
          mode: permission?.current ?? null,
          fence: record.lease.runtimeFence,
          revision: deps.store.permissionRevision(sessionId)
        }
  } catch (error) {
    deps.logger.warn('reading chat permissions failed', {
      scope: 'permission-fact',
      sessionId,
      error
    })
    return undefined
  }
}
