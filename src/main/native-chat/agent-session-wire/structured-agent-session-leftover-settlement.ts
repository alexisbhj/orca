// The one settlement of what ended generations left unfinished, run only at the host's ownership
// events: an observed exit (after its release), an acquisition (before its reservation), and
// startup. Opening a chat never runs it.
//
// Re-derived each time from the journal and the lease: every turn, call, prompt, reasoning row,
// subagent roster and background task an ended generation wrote and never ended (below the lease's
// fence, or at it once released), and every send handed to one and never answered. Such a
// generation can no longer write, since every release moves the fence. Its turns end `interrupted` only when the lease's death evidence
// names it, else `unverifiable`. Rows land at the lease's current fence, in ONE transaction with the
// lease's `leftoverSettledAt` receipt, so a second run plans nothing. Best effort at every trigger:
// a failure is the caller's to log, and its rows hold nothing (holds count only current-fence work).

import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import {
  planStructuredAgentSessionDeadGeneration,
  type StructuredAgentSessionDeadGenerationInput
} from './structured-agent-session-dead-generation-settlement'
import {
  planStaleStructuredAgentSessionState,
  type StaleStructuredAgentSessionStateJournal
} from './structured-agent-session-stale-state-settlement'
import type { DeadGenerationJournal } from './structured-agent-session-unfinished-work'
import { STALE_SESSION_ROW_PREFIX } from '../../../shared/agent-session-stop-row-identity'
import { structuredAgentSessionFailureWordsContext } from './structured-agent-session-send-preparation'
import type { StructuredAgentSessionLogger } from './structured-agent-session-logger'

export type StructuredAgentSessionLeftoverStore = Pick<AgentSessionRecordStore, 'getRecord'> & {
  conversationReceipts: Pick<AgentSessionRecordStore['conversationReceipts'], 'leftoverSettled'>
}

export type StructuredAgentSessionLeftoverSettlementInput = {
  store: StructuredAgentSessionLeftoverStore
  sessionId: string
  journal: DeadGenerationJournal & StaleStructuredAgentSessionStateJournal
  now: () => number
  /** An observed exit: what that child's generation left is settled as the exit says. */
  exit?: Omit<StructuredAgentSessionDeadGenerationInput, 'journal' | 'sessionId' | 'fence'> & {
    ownerFence: number
  }
  /** An acquisition about to reserve over an owner a probe proved gone: that owner's generation
   *  ends with the reservation, so its work is settled with the rest. */
  ownerProvenGone?: true
}

export type StructuredAgentSessionLeftoverSettlement = { ok: true } | { ok: false; error: unknown }

export async function settleStructuredAgentSessionLeftovers(
  input: StructuredAgentSessionLeftoverSettlementInput
): Promise<StructuredAgentSessionLeftoverSettlement> {
  try {
    const record = input.store.getRecord(input.sessionId)
    if (!record) {
      return { ok: true }
    }
    const { lease } = record
    const fence = lease.runtimeFence
    const { exit, journal, sessionId } = input
    // A released fence was never a child's (a reservation moves it first), so all of it is ended;
    // what an older build left at it is settled with the rest.
    const ended = input.ownerProvenGone || lease.claimStatus === 'released'
    const below = exit ? exit.ownerFence : ended ? fence + 1 : fence
    const failureTextContext = structuredAgentSessionFailureWordsContext(record)
    await journal.appendPlannedLifecycleBatch({
      settlementId: exit
        ? `dead-generation:${exit.settlementId}`
        : `${STALE_SESSION_ROW_PREFIX}${sessionId}:${fence}:seq-${journal.cursor().sequence}`,
      fence,
      recovered: true,
      // Only a released lease is owed anything: a reservation leaves the mark as it was.
      ...(lease.claimStatus === 'released'
        ? {
            receipt: input.store.conversationReceipts.leftoverSettled(sessionId, fence, input.now())
          }
        : {}),
      plan: () => {
        const exited = exit
          ? planStructuredAgentSessionDeadGeneration(
              { ...exit, journal, sessionId, fence },
              (itemFence) => itemFence === undefined || itemFence >= exit.ownerFence
            )
          : { mutations: [], dispatches: [] }
        const settledByExit = new Set(exited.dispatches.map((entry) => entry.clientMessageId))
        const stale = planStaleStructuredAgentSessionState({
          journal,
          sessionId,
          fence,
          acquisitionGeneration: null,
          // Read with the rows: the evidence the release before this settlement wrote.
          deathEvidence: input.store.getRecord(sessionId)?.lease.deathEvidence ?? null,
          failureTextContext,
          below
        })
        return {
          mutations: [...exited.mutations, ...stale.mutations],
          dispatches: [
            ...exited.dispatches,
            ...stale.dispatches.filter((entry) => !settledByExit.has(entry.clientMessageId))
          ]
        }
      }
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

/** The settlement at a trigger that must go on whatever happens: a failure is logged under the
 *  trigger's scope, and the leftovers stay owed for the next trigger. */
export async function settleStructuredAgentSessionLeftoversOrLog(
  input: StructuredAgentSessionLeftoverSettlementInput & {
    logger: StructuredAgentSessionLogger
    scope: string
  }
): Promise<boolean> {
  const settled = await settleStructuredAgentSessionLeftovers(input)
  if (!settled.ok) {
    input.logger.warn("settling a gone agent's leftover work did not finish", {
      scope: input.scope,
      sessionId: input.sessionId,
      error: settled.error
    })
  }
  return settled.ok
}
