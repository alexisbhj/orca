// Startup's scan of every chat on record: in the background, never ahead of a person's own action
// on a chat, with no stored mark saying which chats are owed anything.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../../shared/agent-session-journal-types'
import { claudeProviderHandle } from '../../../shared/agent-session-provider-handle-encoding'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { readAgentJournalTurn } from '../../../shared/agent-session-turn-record'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import {
  openTestAgentSessionRecordStore,
  seedTestAgentSessionRecordStore
} from '../../runtime/agent-session-record-store-test-harness'
import {
  closeTestJournalHostDatabases,
  openTestJournalHostDatabase
} from '../agent-session-journal/journal-host-database-test-support'
import { AgentSessionJournal } from '../agent-session-journal/journal-store'
import { openAgentSessionJournal } from '../agent-session-journal/journal-store-factory'
import { NO_STRUCTURED_AGENTS } from './structured-agent-session-adapter-router-test-support'
import { StructuredAgentSessionHost } from './structured-agent-session-host'
import { HOST_TEST_LOCATION as LOCATION } from './structured-agent-session-host-test-data'
import { createStructuredAgentSessionLogger } from './structured-agent-session-logger'

const NOW = 1_800_000_000_000
const CHATS = ['chat-aaaaaaa1', 'chat-aaaaaaa2', 'chat-aaaaaaa3', 'chat-aaaaaaa4', 'chat-aaaaaaa5']
const LATE = 'chat-aaaaaaa6'
/** Released long ago with nothing proving its owner gone: no restart moves its fence. */
const RELEASED = 'chat-released1'

let root: string
let store: AgentSessionRecordStore
let host: StructuredAgentSessionHost | undefined

function record(sessionId: string, released: boolean): AgentSessionRecord {
  const linkId = `${sessionId}-link`
  return {
    schemaVersion: 2,
    sessionId,
    location: LOCATION,
    provider: 'claude',
    providerHandleChain: [
      {
        linkId,
        handle: claudeProviderHandle(`provider-${sessionId}`, null),
        origin: 'created',
        mintedAtFence: 13,
        observedAt: NOW - 60_000
      }
    ],
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: '/home/dev/.claude' },
    createdAt: NOW - 60_000,
    updatedAt: NOW,
    lease: {
      sessionId,
      runtimeKind: 'native',
      runtimeFence: released ? 14 : 13,
      handoffStage: null,
      provenHandleLinkId: linkId,
      ownerProcess: released
        ? null
        : { hostId: 'local', pid: 12_000, processStartTimeMs: NOW - 60_000, spawnToken: 'spawn' },
      reservedSpawnToken: released ? null : 'spawn',
      leaseDeadlineAt: NOW + 30_000,
      lastRenewedAt: NOW,
      handoffOperationId: null,
      journalCheckpoint: null,
      claimKeyId: 'key-1',
      claimStatus: released ? 'released' : 'live',
      unreconciled: false,
      deathEvidence: null
    }
  }
}

/** The chat's journal as the crashed process left it: a running turn at fence 13, and, when
 *  asked, a send it accepted and never handed over. */
async function seedJournal(sessionId: string, options: { queued?: true } = {}): Promise<void> {
  const journal = await openAgentSessionJournal({
    identity: {
      sessionId,
      workspaceId: LOCATION.workspaceId,
      hostId: LOCATION.executionHostId,
      agent: 'claude',
      providerHandle: claudeProviderHandle(`provider-${sessionId}`, null)
    },
    database: openTestJournalHostDatabase(root),
    now: () => NOW
  })
  await journal.appendItem(
    { provider: 'claude', sessionId: `provider-${sessionId}`, uuid: 'turn' },
    { kind: 'turn', turnId: 'turn-1', state: 'running', startedAt: NOW - 30_000 },
    { fence: 13, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
  )
  if (options.queued) {
    await journal.appendSubmission({
      clientMessageId: `${sessionId}-queued`,
      payloadFingerprint: '0'.repeat(64),
      body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'after this' }] },
      fence: 14,
      handoverRecorded: true,
      origin: 'client',
      source: { kind: 'user' }
    })
  }
  await journal.close()
}

function openHost(): StructuredAgentSessionHost {
  host = new StructuredAgentSessionHost({
    agents: NO_STRUCTURED_AGENTS,
    logger: createStructuredAgentSessionLogger(),
    store,
    adapter: {
      acquire: vi.fn(),
      dispatch: vi.fn(),
      cancelTurn: vi.fn(),
      answerPrompt: vi.fn(),
      setOption: vi.fn(),
      supportsCreate: () => true
    },
    journalDatabase: openTestJournalHostDatabase(root),
    claimKeyId: 'key-1',
    probeOwner: async () => ({ outcome: 'pid-absent' }),
    now: () => NOW
  })
  return host
}

async function turnState(current: StructuredAgentSessionHost, sessionId: string) {
  return (await current.journalSnapshot(sessionId)).items
    .map((item) => readAgentJournalTurn(item.body))
    .find(Boolean)?.state
}

async function idle(current: StructuredAgentSessionHost, sessionIds: readonly string[]) {
  const { reconciliation } = current.collaboratorsForTests()
  await vi.waitFor(
    () => expect(sessionIds.filter((sessionId) => reconciliation.owes(sessionId))).toEqual([]),
    { timeout: 10_000 }
  )
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-startup-scan-'))
})

afterEach(async () => {
  await host?.flushAllStreamedEvents()
  host = undefined
  vi.restoreAllMocks()
  closeTestJournalHostDatabases()
  await rm(root, { recursive: true, force: true })
})

describe('the startup scan', () => {
  it('never puts a chat late in the scan behind its own share: a read and the lane go first', async () => {
    const all = [...CHATS, LATE]
    await seedTestAgentSessionRecordStore(root, { records: all.map((id) => record(id, false)) })
    for (const sessionId of all) {
      await seedJournal(sessionId)
    }
    store = await openTestAgentSessionRecordStore(root)
    // The first opens the scan makes hold every background slot until the test lets them go.
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const open = AgentSessionJournal.prototype.open
    let gated = 0
    vi.spyOn(AgentSessionJournal.prototype, 'open').mockImplementation(async function (
      this: AgentSessionJournal
    ) {
      gated += 1
      if (gated <= 4) {
        await gate
      }
      return open.call(this)
    })
    const current = openHost()
    const events: string[] = []
    const { sessions, serialize } = current.collaboratorsForTests()
    const set = sessions.set.bind(sessions)
    vi.spyOn(sessions, 'set').mockImplementation((sessionId, session) => {
      events.push(`publish:${sessionId}`)
      return set(sessionId, session)
    })
    const shares: string[] = []
    const mark = AgentSessionJournal.prototype.markQueueReopen
    vi.spyOn(AgentSessionJournal.prototype, 'markQueueReopen').mockImplementation(async function (
      this: AgentSessionJournal,
      ...args
    ) {
      const owner = [...sessions].find(([, session]) => session.journal === this)?.[0]
      shares.push(owner ?? 'unknown')
      events.push(`share:${owner}`)
      return mark.apply(this, args)
    })

    await current.reconcileRestartLeases()
    await vi.waitFor(() => expect(gated).toBe(4))

    // The person's own actions on the late chat run now, ahead of its share.
    const order: string[] = []
    await serialize(LATE, async () => {
      order.push('lane')
    })
    expect(await turnState(current, LATE)).toBe('running')
    order.push('read')
    expect(shares).not.toContain(LATE)

    release()
    await current.startupSettled()
    await idle(current, all)
    expect(order).toEqual(['lane', 'read'])
    for (const sessionId of all) {
      expect(await turnState(current, sessionId)).toBe('interrupted')
      // Published before its share wrote anything.
      expect(events.indexOf(`publish:${sessionId}`)).toBeGreaterThanOrEqual(0)
      expect(events.indexOf(`publish:${sessionId}`)).toBeLessThan(
        events.indexOf(`share:${sessionId}`)
      )
    }
    expect(new Set(shares)).toEqual(new Set(all))
  })

  it('finds what an earlier process left with no fence move and no stored mark, and keeps its send as a card', async () => {
    await seedTestAgentSessionRecordStore(root, { records: [record(RELEASED, true)] })
    await seedJournal(RELEASED, { queued: true })
    store = await openTestAgentSessionRecordStore(root)
    const current = openHost()
    const ended = vi.fn()
    store.onGenerationEnded(ended)

    await current.reconcileRestartLeases()
    await current.startupSettled()
    await idle(current, [RELEASED])

    // Already released: the restart moved nothing and ended no generation.
    expect(ended).not.toHaveBeenCalled()
    expect(store.getRecord(RELEASED)?.lease.runtimeFence).toBe(14)
    // Nothing proved its owner gone: less specific, never wrong.
    expect(await turnState(current, RELEASED)).toBe('unverifiable')
    const { journal } = current.collaboratorsForTests().sessions.get(RELEASED)!
    expect(journal.submission(`${RELEASED}-queued`)).toMatchObject({ dispatchState: 'rejected' })
    expect(journal.queuedMessages.list()).toEqual([
      expect.objectContaining({ body: expect.objectContaining({ role: 'user' }) })
    ])
  })

  it('retries a conversion that failed instead of marking it done', async () => {
    await seedTestAgentSessionRecordStore(root, { records: [record(RELEASED, true)] })
    await seedJournal(RELEASED, { queued: true })
    store = await openTestAgentSessionRecordStore(root)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const database = openTestJournalHostDatabase(root)
    database.db.exec(`
      CREATE TEMP TRIGGER reject_conversion BEFORE INSERT ON journal_rows
      WHEN json_extract(NEW.row_json, '$.kind') = 'dispatch'
        AND json_extract(NEW.row_json, '$.state') = 'rejected'
      BEGIN SELECT RAISE(ABORT, 'temporary storage failure'); END;
    `)
    const current = openHost()

    await current.reconcileRestartLeases()
    await current.startupSettled()
    const { reconciliation, sessions } = current.collaboratorsForTests()
    expect(reconciliation.owes(RELEASED)).toBe(true)
    const journal = sessions.get(RELEASED)!.journal
    expect(journal.queuedMessages.list()).toEqual([])

    database.db.exec('DROP TRIGGER reject_conversion')
    await idle(current, [RELEASED])

    expect(journal.submission(`${RELEASED}-queued`)).toMatchObject({ dispatchState: 'rejected' })
    expect(journal.queuedMessages.list()).toHaveLength(1)
  })
})
