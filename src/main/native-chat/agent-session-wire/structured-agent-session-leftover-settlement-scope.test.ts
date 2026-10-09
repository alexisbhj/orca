// What the leftover settlement never touches: an open or a re-attach to the live child writes
// nothing, a release nothing proved settles only as `unverifiable`, and an owner that may still run
// keeps its current work, which still holds the chat.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentJournalItemKey } from '../../../shared/agent-session-journal-item-key'
import { isStructuredAgentSessionMainAgentWorking } from '../../../shared/structured-agent-session-main-agent-working'
import { openTestJournalHostDatabase } from '../agent-session-journal/journal-host-database-test-support'
import {
  HOST_TEST_NOW as NOW,
  HOST_TEST_SESSION as SESSION
} from './structured-agent-session-host-test-data'
import {
  createQueuedMessageTestRig,
  QUEUED_RIG_CALLER as CALLER,
  type QueuedMessageTestRig
} from './structured-agent-session-queued-message-rig.test-fixture'
import { structuredQueueHold } from './structured-agent-session-queued-messages'
import {
  APPROVAL,
  currentJournal,
  exitWhileSettlementFails,
  leaveUnfinishedWork,
  logEveryWrite,
  recoveredRows,
  sendText,
  turnState
} from './structured-agent-session-leftover-settlement.test-fixture'

let rig: QueuedMessageTestRig | undefined

afterEach(async () => {
  await rig?.dispose()
  rig = undefined
  vi.restoreAllMocks()
})

/** Every row of every table, as stored. */
function everyRow(db: ReturnType<typeof openTestJournalHostDatabase>['db']): unknown[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((table) => [table.name, db.prepare(`SELECT * FROM main."${String(table.name)}"`).all()])
}

/** Whether the chat reads Working and holds a queue-if-active send, by its current fence. */
function holds(current: QueuedMessageTestRig): { working: boolean; queueHeld: boolean } {
  const journal = currentJournal(current)
  const record = current.store.getRecord(SESSION)
  const fence = record?.lease.runtimeFence ?? 0
  return {
    working: isStructuredAgentSessionMainAgentWorking(
      journal.activeTurnId(fence),
      journal.submissions(),
      fence
    ),
    queueHeld: structuredQueueHold({ journal, record, fence }) !== null
  }
}

describe('reading a chat', () => {
  it('opens a chat whose leftovers are owed with zero writes, by every reader', async () => {
    rig = await createQueuedMessageTestRig({ restartable: true })
    const current = rig
    // Answered, so no send left pending keeps the conversation open.
    await current.settleAccepted(await current.workingSend(), 'work')
    await leaveUnfinishedWork(current, { prompt: true })
    const { database } = await exitWhileSettlementFails(current)
    database.db.exec('DROP TRIGGER reject_recovered')
    await current.host.close(SESSION, 'evict')
    expect(current.host.collaboratorsForTests().sessions.has(SESSION)).toBe(false)
    const writes = logEveryWrite(database.db)

    await current.host.revealSession(SESSION)
    await current.host.history({ sessionId: SESSION, direction: 'tail' })
    await current.host.journalSnapshot(SESSION)
    const unsubscribe = await current.host.subscribe({
      id: 'reader',
      sessionId: SESSION,
      emit: () => undefined
    })
    unsubscribe()

    expect(writes()).toEqual([])
    // Still owed, and still as the dead generation left it: only an ownership event settles it.
    expect(current.store.getRecord(SESSION)?.lease.leftoverSettledAt).toBeNull()
    expect(turnState(current)).toBe('running')
    expect(holds(current)).toEqual({ working: false, queueHeld: false })
  })

  it('re-attaches to the live child with zero writes', async () => {
    rig = await createQueuedMessageTestRig({ restartable: true })
    const current = rig
    await current.workingSend()
    await leaveUnfinishedWork(current, { prompt: true })
    const { db } = openTestJournalHostDatabase(current.root)
    const before = everyRow(db)
    const writes = logEveryWrite(db)

    expect(await current.host.attach(CALLER, current.firstAttach)).toMatchObject({ ok: true })
    await current.host.history({ sessionId: SESSION, direction: 'tail' })

    // The replayed operation's ledger row is upserted with the same bytes; nothing else is touched.
    expect(writes().filter((entry) => entry !== 'UPDATE agent_session_operations')).toEqual([])
    expect(everyRow(db)).toEqual(before)
    expect(turnState(current)).toBe('running')
  })
})

describe('a release nothing proved', () => {
  it('settles what it left as unverifiable at startup, and the next send is delivered', async () => {
    rig = await createQueuedMessageTestRig({ restartable: true })
    const current = rig
    await current.workingSend()
    await leaveUnfinishedWork(current, { prompt: true })

    // The rig's probe answers indeterminate: the restart releases the owner with no proof.
    await current.crashRestartHostProcess()

    expect(current.store.getRecord(SESSION)?.lease).toMatchObject({
      claimStatus: 'released',
      deathEvidence: null,
      leftoverSettledAt: NOW
    })
    expect(turnState(current)).toBe('unverifiable')
    expect(currentJournal(current).itemBody(agentJournalItemKey(APPROVAL))).toMatchObject({
      resolution: { state: 'cancelled' }
    })
    expect(holds(current)).toEqual({ working: false, queueHeld: false })

    expect((await sendText(current, 'carry on').result).ok).toBe(true)
    await vi.waitFor(() => expect(current.dispatch).toHaveBeenCalledTimes(2))
  })
})

describe('an owner that may still run', () => {
  it('keeps an unreconciled owner’s current work, which still holds, and settles nothing', async () => {
    rig = await createQueuedMessageTestRig({
      restartable: true,
      probeOwner: async () => {
        throw new Error('the probe could not run')
      }
    })
    const current = rig
    await current.workingSend()
    await leaveUnfinishedWork(current, { prompt: true })

    // The restart cannot reconcile: no proof, no release.
    await current.crashRestartHostProcess()

    expect(current.store.getRecord(SESSION)?.lease.claimStatus).not.toBe('released')
    expect(recoveredRows(openTestJournalHostDatabase(current.root).db)).toEqual([])
    expect(turnState(current)).toBe('running')
    expect(holds(current)).toEqual({ working: true, queueHeld: true })
  })

  it('leaves a live owner’s work unchanged at every trigger but its own exit', async () => {
    rig = await createQueuedMessageTestRig({ restartable: true })
    const current = rig
    await current.workingSend()
    await leaveUnfinishedWork(current, { prompt: true })
    const database = openTestJournalHostDatabase(current.root)

    // A startup pass and a second attach both find the owner live.
    await current.host.reconcileRestartLeases()
    await current.host.startupSettled()
    expect(await current.host.attach(CALLER, current.firstAttach)).toMatchObject({ ok: true })
    const queued = await sendText(current, 'behind the live turn').result

    expect(queued).toMatchObject({ ok: true, value: { queued: expect.anything() } })
    expect(recoveredRows(database.db)).toEqual([])
    expect(turnState(current)).toBe('running')
    expect(holds(current)).toEqual({ working: true, queueHeld: true })
    expect(current.dispatch).toHaveBeenCalledOnce()
  })
})
