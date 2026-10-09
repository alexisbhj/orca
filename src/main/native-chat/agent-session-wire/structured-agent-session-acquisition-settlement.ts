// An acquisition's share of the leftover settlement (`structured-agent-session-leftover-settlement.ts`):
// before the reservation, reading the lease directly, while it still holds the proof of how the
// last generation ended. The reservation clears that proof, so after it the same work could only
// settle `unverifiable`. Best effort: a failure is logged and the start goes on.

import {
  agentSessionLeaseIsReleased,
  isProvenDeadProbe,
  type AgentSessionOwnerProbe
} from '../../../shared/agent-session-lease-adjudication'
import type { StructuredAgentSessionAttachContext } from './structured-agent-session-attach-context'
import { settleStructuredAgentSessionLeftoversOrLog } from './structured-agent-session-leftover-settlement'

const SCOPE = 'acquisition-settlement'

export async function settleStructuredAgentSessionLeftoversBeforeReserve(
  context: Pick<
    StructuredAgentSessionAttachContext,
    'deps' | 'sessions' | 'openConversation' | 'now' | 'runtimeState'
  >,
  sessionId: string,
  probe: AgentSessionOwnerProbe
): Promise<void> {
  const { store, logger } = context.deps
  const lease = store.getRecord(sessionId)?.lease
  if (!lease) {
    return
  }
  // A recorded owner the probe proved gone is ended by the reservation that follows; one alive,
  // unproven, or not yet reconciled keeps its work, which is still its own.
  const ownerProvenGone =
    !lease.unreconciled &&
    lease.claimStatus !== 'conflicted' &&
    lease.ownerProcess !== null &&
    isProvenDeadProbe(probe)
  if (!agentSessionLeaseIsReleased(lease) && !ownerProvenGone) {
    return
  }
  if (ownerProvenGone && context.sessions.get(sessionId)?.child) {
    // A child of this process that died unseen: what it wrote lands before its work is judged.
    const barrier = await context.runtimeState.currentEventSink(sessionId)?.drained()
    if (barrier && !barrier.ok) {
      logger.warn("settling a gone agent's leftover work did not finish", {
        scope: SCOPE,
        sessionId,
        error: barrier.error
      })
      return
    }
  }
  const conversation = await context.openConversation(sessionId).catch((error: unknown) => {
    // The attach's own open meets the same failure and answers it.
    logger.warn("settling a gone agent's leftover work did not finish", {
      scope: SCOPE,
      sessionId,
      error
    })
    return null
  })
  if (!conversation) {
    return
  }
  await settleStructuredAgentSessionLeftoversOrLog({
    store,
    sessionId,
    journal: conversation.journal,
    now: context.now,
    logger,
    scope: SCOPE,
    ...(ownerProvenGone ? { ownerProvenGone: true as const } : {})
  })
}
