// What the host owes its chats when it comes up as a new instance: the earlier process's leftovers.
// Run after the whole-host restart reconcile, per chat under its serialize, queued before anything
// else can reach that chat, so its share runs first.
//
// For each chat it opens, in the order an open used to: the cards' repair and prune; sends the
// earlier process accepted and never handed over, kept as cards or rejected (`holdUnsentSends`);
// the queue's reopen mark; the leftover settlement (`structured-agent-session-leftover-settlement.ts`)
// when the lease says it is owed; and a rewind it left in doubt. Each step is best effort: a failure
// is logged, and the next trigger re-derives it.

import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { agentSessionLeaseIsReleased } from '../../../shared/agent-session-lease-adjudication'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { PrioritySemaphore } from '../../../shared/priority-semaphore'
import { listSessionsWithQueuedMessages } from '../agent-session-journal/queued-message-table'
import { holdUnsentSends } from '../agent-session-journal/journal-unsent-send-hold'
import type {
  StructuredAgentSessionHostDeps,
  StructuredAgentSessionHostSession
} from './structured-agent-session-host-types'
import { settleStructuredAgentSessionLeftoversOrLog } from './structured-agent-session-leftover-settlement'
import {
  markStructuredQueueReopen,
  structuredAgentSessionHostInstance
} from './structured-agent-session-queued-pause'
import { recoverStructuredRewind } from './structured-rewind-recovery'
import type { OpenedStructuredAgentSessionConversation } from './structured-agent-session-conversation-open'
import { restoreStructuredAgentSessionRead } from './structured-agent-session-read-restore'

const STARTUP_SETTLEMENT_CONCURRENCY = 4

export type StructuredAgentSessionStartupSettlementContext = {
  deps: Pick<StructuredAgentSessionHostDeps, 'store' | 'logger' | 'journalDatabase'>
  sessions: Map<string, StructuredAgentSessionHostSession>
  serialize: <T>(sessionId: string, task: () => Promise<T>) => Promise<T>
  /** Indexes and publishes a chat this share opened, once it is settled. */
  adopt: (sessionId: string, opened: OpenedStructuredAgentSessionConversation) => Promise<void>
  now: () => number
  /** Journals whose cards and sends this startup already settled: the restore's share after the
   *  pass's settles only what its recovery ended, or a second reopen mark would hold a later send. */
  sharesDone: WeakSet<StructuredAgentSessionHostSession['journal']>
}

/** Owed: released, and no settlement since the release that ended its last generation. */
export function structuredAgentSessionLeftoversOwed(record: AgentSessionRecord | null): boolean {
  return (
    record !== null &&
    agentSessionLeaseIsReleased(record.lease) &&
    record.lease.leftoverSettledAt === null
  )
}

function rewindInDoubt(record: AgentSessionRecord): boolean {
  return record.rewind?.phase === 'prepared' || record.rewind?.phase === 'provider-succeeded'
}

/** The chats startup opens: owed ones and ones with a rewind in doubt, from the record store, and
 *  ones holding cards, from an index of the cards' own table. Every other chat opens only to read. */
function startupCandidates(context: StructuredAgentSessionStartupSettlementContext): string[] {
  const { store, journalDatabase, logger } = context.deps
  const ids = new Set(
    store
      .listRecords()
      .filter((record) => structuredAgentSessionLeftoversOwed(record) || rewindInDoubt(record))
      .map((record) => record.sessionId)
  )
  try {
    for (const sessionId of listSessionsWithQueuedMessages(journalDatabase.db)) {
      if (store.getRecord(sessionId)) {
        ids.add(sessionId)
      }
    }
  } catch (error) {
    logger.warn('listing chats with saved cards at startup failed', {
      scope: 'startup-settlement',
      error
    })
  }
  return [...ids]
}

/** Every candidate's share is queued on its chat's serialize at once, so whatever that chat runs
 *  next (a reader's open and the queue it wakes, a send, an attach) runs after its share; a few
 *  chats at a time do the work. */
export async function settleStructuredAgentSessionsAtStartup(
  context: StructuredAgentSessionStartupSettlementContext
): Promise<void> {
  const slots = new PrioritySemaphore(STARTUP_SETTLEMENT_CONCURRENCY)
  await Promise.all(
    startupCandidates(context).map((sessionId) =>
      context
        .serialize(sessionId, async () => {
          const release = await slots.acquire(0)
          try {
            // A journal open is synchronous SQLite: a macrotask per chat keeps startup responsive.
            await yieldToEventLoop()
            await settleOneAtStartup(context, sessionId)
          } finally {
            release()
          }
        })
        .catch((error: unknown) =>
          context.deps.logger.warn('settling a chat at startup failed', {
            scope: 'startup-settlement',
            sessionId,
            error
          })
        )
    )
  )
}

/** One chat's share, for a caller inside its serialize: the startup pass, or the restore once it
 *  resolved the chat's recovery (which can end a generation after the pass ran). A chat not yet
 *  open is settled before it is published, so no reader sees what the share ends; `opened` is
 *  one the restore opened and publishes itself. A share already done finds nothing left to do. */
export async function settleOneAtStartup(
  context: StructuredAgentSessionStartupSettlementContext,
  sessionId: string,
  opened?: OpenedStructuredAgentSessionConversation
): Promise<void> {
  const indexed = opened?.session ?? context.sessions.get(sessionId)
  // No journal: nothing was ever written, so nothing is left to settle.
  const fresh = indexed ? null : await restoreStructuredAgentSessionRead(context.deps, sessionId)
  const session = indexed ?? fresh?.session
  try {
    // A child here was acquired since: its acquisition settled first, and its loop owns the queue.
    if (session && !session.child) {
      await settleShare(context, sessionId, session)
    }
  } finally {
    if (fresh) {
      await context.adopt(sessionId, fresh)
    }
  }
}

async function settleShare(
  context: StructuredAgentSessionStartupSettlementContext,
  sessionId: string,
  { journal }: StructuredAgentSessionHostSession
): Promise<void> {
  const { store, logger } = context.deps
  const warn = (scope: string) => (error: unknown) =>
    logger.warn('startup bookkeeping for a chat failed', { scope, sessionId, error })
  const fence = store.getRecord(sessionId)?.lease.runtimeFence
  const firstShare = !context.sharesDone.has(journal)
  context.sharesDone.add(journal)
  if (firstShare && fence !== undefined) {
    await journal.queuedMessages.repairAndPrune().catch(warn('startup-queued-repair'))
    // Before a Stop can withdraw one: a Stop never withdraws a card.
    await holdUnsentSends(journal, {
      fence,
      hostInstance: structuredAgentSessionHostInstance(),
      hold: { cause: 'hostRestarted' }
    }).catch(warn('startup-leftover-sends'))
    // After the leftovers became cards, so the mark follows every card the earlier process left.
    await markStructuredQueueReopen(sessionId, journal, fence, logger)
  }
  if (structuredAgentSessionLeftoversOwed(store.getRecord(sessionId))) {
    await settleStructuredAgentSessionLeftoversOrLog({
      store,
      sessionId,
      journal,
      now: context.now,
      logger,
      scope: 'startup-settlement'
    })
  }
  if (firstShare && fence !== undefined) {
    // A rewind the earlier process left prepared refuses every send until settled; one only its
    // provider can prove stays for the next acquisition.
    await recoverStructuredRewind(context.deps, sessionId, journal, fence).catch(
      warn('rewind-recovery')
    )
  }
}
