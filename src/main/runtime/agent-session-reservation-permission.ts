import {
  agentChatLaunchPermissionMode,
  agentChatPermissionModes,
  storedAgentChatPermissionMode,
  type AgentChatPermissionMode
} from '../../shared/agent-chat-permission-mode'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import type { AgentSessionStoreState } from './agent-session-store-state'
import { reviseAgentSessionPermission } from './agent-session-permission-revisions'

export type AgentSessionPermissionDefaultResolver = (
  agent: string
) => AgentChatPermissionMode | null

/** Inheritance ends before a reservation can launch its selected policy. */
export function materializeAgentSessionPermissionIntent(
  record: AgentSessionRecord,
  resolveDefault: AgentSessionPermissionDefaultResolver | undefined
): AgentSessionRecord {
  if (
    !resolveDefault ||
    !agentChatPermissionModes(record.provider) ||
    storedAgentChatPermissionMode(record.provider, record.options) ||
    record.lease.claimStatus !== 'reserved' ||
    record.lease.ownerProcess !== null
  ) {
    return record
  }
  const permissionMode = agentChatLaunchPermissionMode(
    record.provider,
    record.options,
    resolveDefault(record.provider)
  )
  return {
    ...record,
    options: { ...record.options, permissionMode }
  }
}

export function commitAgentSessionPermissionIntent(
  state: AgentSessionStoreState,
  record: AgentSessionRecord,
  resolveDefault: AgentSessionPermissionDefaultResolver | undefined
): AgentSessionRecord {
  const selected = materializeAgentSessionPermissionIntent(record, resolveDefault)
  const revised = reviseAgentSessionPermission(state.records.get(record.sessionId), selected)
  state.records.set(revised.sessionId, revised)
  return revised
}
