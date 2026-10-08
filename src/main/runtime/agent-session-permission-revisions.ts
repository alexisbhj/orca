import { storedAgentChatPermissionMode } from '../../shared/agent-chat-permission-mode'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import type { AgentSessionStoreState } from './agent-session-store-state'

export function agentSessionPermissionRevision(record: AgentSessionRecord | undefined): number {
  // Legacy counters were small; the record's durable times avoid restarting them at zero.
  return record?.permissionRevision ?? Math.max(0, record?.createdAt ?? 0, record?.updatedAt ?? 0)
}

export function reviseAgentSessionPermission(
  before: AgentSessionRecord | undefined,
  record: AgentSessionRecord
): AgentSessionRecord {
  const priorStored = before && storedAgentChatPermissionMode(before.provider, before.options)
  const priorMode = priorStored ?? before?.permissionFallbackMode
  const storedMode = storedAgentChatPermissionMode(record.provider, record.options)
  const mode = storedMode ?? record.permissionFallbackMode
  const initialFallback = storedMode === null && priorMode === undefined
  const changed =
    before !== undefined && (storedMode !== priorStored || (mode !== priorMode && !initialFallback))
  const revision = before ? agentSessionPermissionRevision(before) + Number(changed) : 0
  if (!Number.isSafeInteger(revision)) {
    throw new Error('agent_session_permission_revision_exhausted')
  }
  if (
    record.permissionRevision === revision &&
    (storedMode === null || record.permissionFallbackMode === undefined)
  ) {
    return record
  }
  const { permissionFallbackMode: fallback, ...intent } = record
  return {
    ...intent,
    permissionRevision: revision,
    ...(storedMode === null && fallback !== undefined ? { permissionFallbackMode: fallback } : {})
  }
}

/** Stamped before serialization, so an intent and its order either both commit or neither does. */
export function stampAgentSessionPermissionRevisions(
  published: AgentSessionStoreState,
  draft: AgentSessionStoreState
): void {
  for (const [id, record] of draft.records) {
    const before = published.records.get(id)
    if (before !== record) {
      draft.records.set(id, reviseAgentSessionPermission(before, record))
    }
  }
}
