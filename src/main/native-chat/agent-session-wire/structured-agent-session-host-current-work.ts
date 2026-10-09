// The host's current-work projection (`structured-agent-session-current-work.ts`) for a chat it
// holds, read from its sessions and lease store. Apart from the projection itself, which stays free
// of host types so shared and client code can import it.

import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import {
  structuredAgentSessionCurrentWork,
  type StructuredAgentSessionCurrentWork
} from './structured-agent-session-current-work'
import type { StructuredAgentSessionHostSession } from './structured-agent-session-host-types'

/** The host's sessions and lease store, as the projection reads them. */
export type StructuredAgentSessionCurrentWorkHost = {
  store: { getRecord: (sessionId: string) => AgentSessionRecord | null }
  sessions: {
    get(
      sessionId: string
    ):
      | Pick<
          StructuredAgentSessionHostSession,
          'journal' | 'lastEndedChild' | 'operationalRevision'
        >
      | undefined
  }
}

/** A held chat's current work; null when this host holds no conversation for it. */
export function hostStructuredAgentSessionCurrentWork(
  host: StructuredAgentSessionCurrentWorkHost,
  sessionId: string
): StructuredAgentSessionCurrentWork | null {
  const session = host.sessions.get(sessionId)
  return session
    ? structuredAgentSessionCurrentWork(session.journal, {
        record: host.store.getRecord(sessionId),
        ...(session.lastEndedChild ? { ended: session.lastEndedChild } : {}),
        revision: session.operationalRevision ?? 0
      })
    : null
}
