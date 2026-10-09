import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agentJournalItemKey,
  agentJournalSubmissionKey
} from '../../../shared/agent-session-journal-item-key'
import type { AgentJournalItemIdentity } from '../../../shared/agent-session-journal-types'
import {
  agentSessionWriteNoticeEnglish,
  agentSessionWriteNoticeParts
} from '../../../shared/agent-session-refusal-notice'
import { agentSessionRefusalFailure } from '../../../shared/agent-session-write-failure'
import { isSubagentGroupBlock } from '../../../shared/native-chat-types'
import { projectStructuredAgentSessionStatusState } from '../../../shared/structured-agent-session-projection'
import { codexSubagentGroupIdentity } from '../../codex/codex-subagent-roster'
import { openTestJournalHostDatabase } from '../agent-session-journal/journal-host-database-test-support'
import {
  HOST_TEST_NOW as NOW,
  HOST_TEST_SESSION as SESSION,
  hostTestOperationId
} from './structured-agent-session-host-test-data'
import {
  createQueuedMessageTestRig,
  QUEUED_RIG_CALLER as CALLER,
  type QueuedMessageTestRig
} from './structured-agent-session-queued-message-rig.test-fixture'
import { structuredQueueHold } from './structured-agent-session-queued-messages'
import { isMainAgentWorking } from './structured-agent-session-turns-cancel'
import {
  APPROVAL,
  currentJournal,
  currentWork,
  exitChild,
  exitWhileSettlementFails,
  leaveUnfinishedWork,
  REASONING,
  recoveredRows,
  rowFence,
  ROSTER_GROUP,
  sendText,
  TASK,
  TOOL,
  TURN_KEY,
  turnState,
  watchMarks
} from './structured-agent-session-leftover-settlement.test-fixture'

let rig: QueuedMessageTestRig | undefined

afterEach(async () => {
  await rig?.dispose()
  rig = undefined
  vi.restoreAllMocks()
})

function leftoverSettledAt(current: QueuedMessageTestRig): number | null | undefined {
  return current.store.getRecord(SESSION)?.lease.leftoverSettledAt
}

function settlementWarnings(): string[] {
  return vi
    .mocked(console.warn)
    .mock.calls.flatMap(([, fields]) =>
      typeof fields === 'object' && fields !== null && 'scope' in fields
        ? [String(fields.scope)]
        : []
    )
}

describe('the observed exit, then the next start', () => {
  it('settles at the start in one commit at the released fence, with its mark, before the successor binds', async () => {
    rig = await createQueuedMessageTestRig({ restartable: true })
    const current = rig
    const firstSend = await current.workingSend()
    await leaveUnfinishedWork(current, { everything: true })
    const { session, database, deadFence } = await exitWhileSettlementFails(current)
    database.db.exec('DROP TRIGGER reject_recovered')
    const marks = watchMarks(database.db)

    const { clientOperationId, result } = sendText(current, 'continue after storage recovered')

    expect(await result).toMatchObject({ ok: true })
    // An ordinary send: no card waits behind the dead generation's turn.
    expect(session.journal.queuedMessages.list()).toEqual([])
    expect(session.journal.submission(clientOperationId)).toBeDefined()
    await vi.waitFor(() => expect(current.dispatch).toHaveBeenCalledTimes(2))
    const settled = recoveredRows(database.db)
    expect(settled.length).toBeGreaterThan(0)
    // Every settlement row, at the released fence, was in the database when the mark was set.
    expect(marks()).toEqual([{ fence: deadFence + 1, rows: settled.length }])
    expect(settled.map(rowFence)).toEqual(settled.map(() => deadFence + 1))
    // The successor reserved after it, at the next fence.
    expect(session.child?.fence).toBe(deadFence + 2)
    expect(leftoverSettledAt(current)).toBe(NOW)
    // The exit's proof named the dead generation: its turn was interrupted.
    expect(turnState(current)).toBe('interrupted')
    const body = (identity: AgentJournalItemIdentity) =>
      session.journal.itemBody(agentJournalItemKey(identity))
    expect(body(APPROVAL)).toMatchObject({ resolution: { state: 'cancelled' } })
    expect(body(TOOL)).toMatchObject({ state: 'failed', endedAs: 'interrupted' })
    expect(body(REASONING)).not.toMatchObject({ state: 'running' })
    const roster = body(codexSubagentGroupIdentity(ROSTER_GROUP))
    expect(
      roster?.kind === 'message' ? roster.blocks.find(isSubagentGroupBlock)?.agents : undefined
    ).toMatchObject([{ id: 'a', state: 'unverifiable' }])
    expect(body(TASK)).toMatchObject({
      blocks: [
        { text: 'Background command "sleep 20" stopped reporting' },
        { state: 'unverifiable' }
      ]
    })
    // Handed over and never answered: doubt, never "not delivered".
    expect(session.journal.submission(firstSend)).toMatchObject({
      dispatchState: 'unknown',
      reason: 'provider_exited_before_acknowledgement'
    })
  })

  it('settles at the exit itself when nothing refuses it, once', async () => {
    rig = await createQueuedMessageTestRig({ restartable: true })
    const current = rig
    await current.workingSend()
    await leaveUnfinishedWork(current, { prompt: true })
    const database = openTestJournalHostDatabase(current.root)
    const marks = watchMarks(database.db)

    await exitChild(current)

    const settled = recoveredRows(database.db)
    expect(turnState(current)).toBe('interrupted')
    expect(marks()).toEqual([{ fence: 2, rows: settled.length }])
    // The next start finds nothing left: its settlement writes no row.
    expect((await sendText(current, 'next').result).ok).toBe(true)
    await vi.waitFor(() => expect(current.dispatch).toHaveBeenCalledTimes(2))
    expect(recoveredRows(database.db)).toEqual(settled)
  })
})

describe('a settlement that cannot commit never gates the user', () => {
  it('delivers the queue-if-active send the STOP reproduction stranded', async () => {
    rig = await createQueuedMessageTestRig({ restartable: true })
    const current = rig
    await current.workingSend()
    await leaveUnfinishedWork(current)
    const { session } = await exitWhileSettlementFails(current)

    const { clientOperationId, result } = sendText(current, 'still stranded?')

    expect(await result).toMatchObject({ ok: true })
    expect((await result).ok && 'queued' in (await result)).toBe(false)
    expect(session.journal.queuedMessages.list()).toEqual([])
    expect(session.journal.submission(clientOperationId)).toBeDefined()
    await vi.waitFor(() => expect(current.dispatch).toHaveBeenCalledTimes(2))
  })

  it('reads a dead generation’s open turn as not Working, holds nothing, and delivers', async () => {
    rig = await createQueuedMessageTestRig({ restartable: true })
    const current = rig
    await current.workingSend()
    await leaveUnfinishedWork(current)
    await exitWhileSettlementFails(current)
    const journal = currentJournal(current)
    const record = current.store.getRecord(SESSION)
    const fence = record?.lease.runtimeFence ?? 0
    const work = currentWork(current)

    // Still saved as running: only its settlement would end it.
    expect(turnState(current)).toBe('running')
    expect(work.working()).toBe(false)
    expect(structuredQueueHold({ record, work })).toBeNull()
    expect(isMainAgentWorking({ journal, fence, currentWork: () => work })).toBe(false)
    const { items, submissions } = journal.snapshot()
    expect(
      projectStructuredAgentSessionStatusState(items, submissions, fence, work.scope).summary.status
    ).not.toBe('working')

    expect((await sendText(current, 'go on').result).ok).toBe(true)
    await vi.waitFor(() => expect(current.dispatch).toHaveBeenCalledTimes(2))
  })

  it('starts, delivers and logs when the start’s own settlement fails; the next trigger settles once as unverifiable', async () => {
    rig = await createQueuedMessageTestRig({ restartable: true })
    const current = rig
    await current.workingSend()
    await leaveUnfinishedWork(current, { prompt: true })
    const { session, database } = await exitWhileSettlementFails(current)

    const { clientOperationId, result } = sendText(current, 'meets the storage fault')

    expect(await result).toMatchObject({ ok: true })
    expect(session.journal.submission(clientOperationId)).toBeDefined()
    await vi.waitFor(() => expect(current.dispatch).toHaveBeenCalledTimes(2))
    expect(settlementWarnings()).toContain('acquisition-settlement')
    // Nothing partial committed; the reservation left the mark as it was.
    expect(recoveredRows(database.db)).toEqual([])
    expect(leftoverSettledAt(current)).toBeNull()
    expect(turnState(current)).toBe('running')
    // The successor's turn is the one that counts.
    expect(currentWork(current).activeTurnId()).toBeNull()

    database.db.exec('DROP TRIGGER reject_recovered')
    const marks = watchMarks(database.db)
    await exitChild(current)

    // The reservation wiped the proof that named it: less specific, never wrong.
    expect(turnState(current)).toBe('unverifiable')
    expect(session.journal.itemBody(agentJournalItemKey(APPROVAL))).toMatchObject({
      resolution: { state: 'cancelled' }
    })
    const revisions = recoveredRows(database.db).filter((row) => row.rowJson.includes(TURN_KEY))
    expect(revisions).toHaveLength(1)
    expect(marks()).toHaveLength(1)
  })
})

describe('a stale prompt', () => {
  it('holds no send, ends cancelled once settled, and refuses a stale answer', async () => {
    rig = await createQueuedMessageTestRig({ restartable: true })
    const current = rig
    await current.workingSend()
    await leaveUnfinishedWork(current, { prompt: true })
    const { session, database } = await exitWhileSettlementFails(current)
    const prompt = session.journal.item(agentJournalItemKey(APPROVAL))
    if (!prompt) {
      throw new Error('expected the saved prompt')
    }
    const answer = () => {
      const fields = { itemId: prompt.itemId, expectedRevision: prompt.revision, optionId: 'yes' }
      return current.host.respondToPrompt(CALLER, {
        envelope: {
          ...current.envelope(fields, 'agentSession.respondTo:approval', hostTestOperationId()),
          expectedRuntimeFence: current.store.getRecord(SESSION)?.lease.runtimeFence ?? 0
        },
        kind: 'approval',
        ...fields
      })
    }

    // Unsettled, it holds nothing and takes no answer: the agent that asked is gone.
    expect((await sendText(current, 'go on without it').result).ok).toBe(true)
    await vi.waitFor(() => expect(current.dispatch).toHaveBeenCalledTimes(2))
    expect(session.journal.itemBody(prompt.itemId)).toMatchObject({
      resolution: { state: 'pending' }
    })
    const refused = await answer()
    expect(refused).toMatchObject({
      ok: false,
      refusal: { details: { reason: 'promptOwnerEnded' } }
    })
    if (refused.ok) {
      throw new Error('expected the answer refused')
    }
    // Plain words: what did not happen, that the agent stopped, and how to go on.
    const words = agentSessionWriteNoticeEnglish(
      agentSessionWriteNoticeParts(agentSessionRefusalFailure(refused.refusal), 'answer', {
        agentName: 'Codex'
      })
    )
    expect(words).toBe(
      'Your answer was not sent. Codex stopped while this response was in progress. You can continue in this conversation.'
    )
    expect(current.answerPrompt).not.toHaveBeenCalled()

    database.db.exec('DROP TRIGGER reject_recovered')
    await exitChild(current)

    expect(session.journal.itemBody(prompt.itemId)).toMatchObject({
      resolution: { state: 'cancelled' }
    })
    expect((await answer()).ok).toBe(false)
    expect(current.answerPrompt).not.toHaveBeenCalled()
  })
})

describe('startup', () => {
  it('settles a failed exit settlement once and sets the mark, starting nothing', async () => {
    rig = await createQueuedMessageTestRig({ restartable: true })
    const current = rig
    await current.workingSend()
    await leaveUnfinishedWork(current, { prompt: true })
    const { deadFence } = await exitWhileSettlementFails(current)
    let owed: number | null | undefined
    // A new process loads the database and the record store back from disk, and starts up.
    await current.crashReloadHostProcess(() => {
      owed = leftoverSettledAt(current)
    })
    const database = openTestJournalHostDatabase(current.root)
    expect(owed).toBeNull()

    expect(turnState(current)).toBe('interrupted')
    expect(currentJournal(current).itemBody(agentJournalItemKey(APPROVAL))).toMatchObject({
      resolution: { state: 'cancelled' }
    })
    expect(leftoverSettledAt(current)).toBe(NOW)
    const settled = recoveredRows(database.db)
    expect(settled.map(rowFence)).toEqual(settled.map(() => deadFence + 1))
    expect(current.starts).toHaveBeenCalledOnce()
    // A second pass finds nothing owed.
    await current.host.reconcileRestartLeases()
    await current.host.startupSettled()
    expect(recoveredRows(database.db)).toEqual(settled)
  })
})

describe('the mark is only an index', () => {
  it('a wrong "settled" holds nothing: delivery goes on, and the next start settles and corrects it', async () => {
    rig = await createQueuedMessageTestRig({ restartable: true })
    const current = rig
    await current.workingSend()
    await leaveUnfinishedWork(current)
    const { database } = await exitWhileSettlementFails(current)
    database.db.exec('DROP TRIGGER reject_recovered')
    await current.store.transitionHandoff(SESSION, (record) => ({
      ...record,
      lease: { ...record.lease, leftoverSettledAt: 1 }
    }))
    await current.crashReloadHostProcess()
    // Startup believed it and skipped the chat; a reader's open writes nothing either.
    await current.host.journalSnapshot(SESSION)
    expect(turnState(current)).toBe('running')
    const marks = watchMarks(openTestJournalHostDatabase(current.root).db)

    expect((await sendText(current, 'after a wrong mark').result).ok).toBe(true)

    await vi.waitFor(() => expect(current.dispatch).toHaveBeenCalledTimes(2))
    expect(turnState(current)).toBe('interrupted')
    // The receipt replaced the wrong mark; a set mark is not re-set, so no row logs it.
    expect(marks()).toEqual([])
    expect(leftoverSettledAt(current)).toBe(NOW)
  })

  it('a wrong "owed" costs one journal open and a settlement that plans nothing', async () => {
    rig = await createQueuedMessageTestRig({ restartable: true })
    const current = rig
    await current.workingSend()
    await leaveUnfinishedWork(current)
    await exitChild(current)
    expect(turnState(current)).toBe('interrupted')
    await current.store.transitionHandoff(SESSION, (record) => ({
      ...record,
      lease: { ...record.lease, leftoverSettledAt: null }
    }))
    const settled = recoveredRows(openTestJournalHostDatabase(current.root).db)

    await current.crashReloadHostProcess()

    expect(recoveredRows(openTestJournalHostDatabase(current.root).db)).toEqual(settled)
    expect(leftoverSettledAt(current)).toBe(NOW)
    expect((await sendText(current, 'after a wrong owed mark').result).ok).toBe(true)
    await vi.waitFor(() => expect(current.dispatch).toHaveBeenCalledTimes(2))
  })
})

describe('a folder workspace', () => {
  it('settles a folder chat’s dead generation the same way', async () => {
    rig = await createQueuedMessageTestRig({
      restartable: true,
      location: {
        executionHostId: 'local',
        wslDistro: null,
        workspaceId: 'folder-1',
        workspaceKind: 'folder'
      }
    })
    const current = rig
    await current.workingSend()
    await leaveUnfinishedWork(current)
    const { session, database } = await exitWhileSettlementFails(current)
    database.db.exec('DROP TRIGGER reject_recovered')

    const { clientOperationId, result } = sendText(current, 'continue in the folder')

    expect(await result).toMatchObject({ ok: true })
    expect(session.journal.submission(clientOperationId)).toBeDefined()
    await vi.waitFor(() => expect(current.dispatch).toHaveBeenCalledTimes(2))
    expect(turnState(current)).toBe('interrupted')
    expect(leftoverSettledAt(current)).toBe(NOW)
    expect(
      session.journal.item(agentJournalSubmissionKey(clientOperationId))?.sequence
    ).toBeGreaterThan(recoveredRows(database.db).at(-1)?.seq ?? 0)
  })
})
