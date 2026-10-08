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
  defaultPermissionMode: StructuredAgentSessionHostDeps['defaultPermissionMode']
): AgentSessionPermissionModes | null {
  const supported = agentChatPermissionModes(record.provider)
  const fallback = defaultPermissionMode?.(record.provider)
  const current =
    record.options?.permissionMode !== undefined || fallback !== undefined
      ? agentChatLaunchPermissionMode(record.provider, record.options, fallback)
      : null
  return supported && current ? { current, supported } : null
}

/** All publications read the same normalized intent, including older saved choices. */
export function readStructuredAgentSessionPermissionFact(
  deps: Pick<StructuredAgentSessionHostDeps, 'store' | 'agents' | 'defaultPermissionMode'>,
  sessionId: string
): AgentSessionPermissionFact | undefined {
  const record = deps.store.getRecord(sessionId)
  if (!record) {
    return undefined
  }
  const rules = deps.agents.definition(record.provider)?.restingOptions
  const permission = restingPermissionModes(
    { ...record, options: rules?.normalizeOptions?.(record.options) ?? record.options },
    deps.defaultPermissionMode
  )
  const mode = permission?.current ?? null
  return {
    mode,
    fence: record.lease.runtimeFence,
    revision: deps.store.permissionRevision(sessionId, mode)
  }
}
