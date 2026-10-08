import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { isPersistedAgentSessionRecord } from '../../shared/agent-session-record'
import { record } from '../native-chat/agent-session-wire/structured-agent-session-restart-resume-test-harness'
import {
  closeTestJournalHostDatabase,
  openTestJournalHostDatabase
} from '../native-chat/agent-session-journal/journal-host-database-test-support'
import {
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStore,
  seedTestAgentSessionRecordStore
} from './agent-session-record-store-test-harness'

it('commits permission intent and revision atomically, and discards both after a database refusal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-permission-atomic-'))
  const saved = {
    ...record({ chain: [] }),
    options: { permissionMode: 'ask' },
    permissionRevision: 9
  }
  await seedTestAgentSessionRecordStore(root, { records: [saved] })
  let store = await openTestAgentSessionRecordStore(root)
  const database = openTestJournalHostDatabase(root)
  try {
    database.db.exec(`CREATE TRIGGER reject_permission BEFORE UPDATE ON agent_session_records
      WHEN json_extract(new.record_json, '$.options.permissionMode') = 'bypass'
      BEGIN SELECT RAISE(ABORT, 'permission write refused'); END`)
    await expect(
      store.replaceSessionOptions({
        sessionId: saved.sessionId,
        fence: 1,
        options: { permissionMode: 'bypass' },
        now: 1
      })
    ).rejects.toThrow('permission write refused')
    expect(store.getRecord(saved.sessionId)).toMatchObject({
      options: saved.options,
      permissionRevision: 9
    })
    expect((await readPersistedTestAgentSessionStore(root)).records[saved.sessionId]).toMatchObject(
      {
        options: saved.options,
        permissionRevision: 9
      }
    )
    database.db.exec('DROP TRIGGER reject_permission')
    await Promise.all(
      ['bypass', 'ask', 'bypass'].map((permissionMode) =>
        store.replaceSessionOptions({
          sessionId: saved.sessionId,
          fence: 1,
          options: { permissionMode },
          now: 1
        })
      )
    )
    expect((await readPersistedTestAgentSessionStore(root)).records[saved.sessionId]).toMatchObject(
      {
        options: { permissionMode: 'bypass' },
        permissionRevision: 12
      }
    )
    closeTestJournalHostDatabase(root)
    store = await openTestAgentSessionRecordStore(root)
    expect(store.permissionRevision(saved.sessionId)).toBe(12)
    await store.replaceSessionOptions({
      sessionId: saved.sessionId,
      fence: 1,
      options: { permissionMode: 'ask' },
      now: 0
    })
    expect(store.permissionRevision(saved.sessionId)).toBe(13)
  } finally {
    closeTestJournalHostDatabase(root)
    await rm(root, { recursive: true, force: true })
  }
})

it('derives a stable legacy baseline before any write and retains it through older timestamps', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-permission-legacy-'))
  const saved = { ...record({ chain: [] }), options: { permissionMode: 'ask' } }
  await seedTestAgentSessionRecordStore(root, { records: [saved] })
  let store = await openTestAgentSessionRecordStore(root)
  try {
    const baseline = Math.max(saved.createdAt, saved.updatedAt)
    expect(store.permissionRevision(saved.sessionId, 'ask')).toBe(baseline)
    expect(
      (await readPersistedTestAgentSessionStore(root)).records[saved.sessionId]?.permissionRevision
    ).toBeUndefined()
    closeTestJournalHostDatabase(root)
    store = await openTestAgentSessionRecordStore(root)
    expect(store.permissionRevision(saved.sessionId)).toBe(baseline)
    await store.replaceSessionOptions({
      sessionId: saved.sessionId,
      fence: 1,
      options: { permissionMode: 'ask', model: 'm' },
      now: 0
    })
    expect(store.permissionRevision(saved.sessionId)).toBe(baseline)
    closeTestJournalHostDatabase(root)
    store = await openTestAgentSessionRecordStore(root)
    expect(store.permissionRevision(saved.sessionId)).toBe(baseline)
    await store.replaceSessionOptions({
      sessionId: saved.sessionId,
      fence: 1,
      options: { permissionMode: 'bypass' },
      now: 0
    })
    expect(store.permissionRevision(saved.sessionId)).toBe(baseline + 1)
  } finally {
    closeTestJournalHostDatabase(root)
    await rm(root, { recursive: true, force: true })
  }
})

it.each(['claude', 'codex'] as const)(
  'retains %s inherited-default order across reopen and the next explicit choice',
  async (provider) => {
    const root = await mkdtemp(join(tmpdir(), 'orca-permission-default-'))
    const saved = { ...record({ chain: [] }), provider, options: {} }
    await seedTestAgentSessionRecordStore(root, { records: [saved] })
    let store = await openTestAgentSessionRecordStore(root)
    try {
      const baseline = store.permissionRevision(saved.sessionId, 'ask')
      expect(store.permissionRevision(saved.sessionId, 'bypass')).toBe(baseline + 1)
      expect(store.permissionRevision(saved.sessionId, 'ask')).toBe(baseline + 2)
      closeTestJournalHostDatabase(root)
      store = await openTestAgentSessionRecordStore(root)
      expect(store.permissionRevision(saved.sessionId, 'ask')).toBe(baseline + 2)
      expect(store.permissionRevision(saved.sessionId, 'bypass')).toBe(baseline + 3)
      await store.replaceSessionOptions({
        sessionId: saved.sessionId,
        fence: 1,
        options: { permissionMode: 'ask' },
        now: 0
      })
      const persisted = (await readPersistedTestAgentSessionStore(root)).records[saved.sessionId]
      expect(persisted).toMatchObject({
        options: { permissionMode: 'ask' },
        permissionRevision: baseline + 4
      })
      expect(persisted?.permissionFallbackMode).toBeUndefined()
      closeTestJournalHostDatabase(root)
      store = await openTestAgentSessionRecordStore(root)
      expect(store.permissionRevision(saved.sessionId, 'ask')).toBe(baseline + 4)
    } finally {
      closeTestJournalHostDatabase(root)
      await rm(root, { recursive: true, force: true })
    }
  }
)

it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '3', null])(
  'refuses malformed stored permission revision %s',
  (permissionRevision) => {
    expect(isPersistedAgentSessionRecord({ ...record({ chain: [] }), permissionRevision })).toBe(
      false
    )
  }
)

it('refuses malformed stored fallback mode and accepts absent order fields', () => {
  expect(
    isPersistedAgentSessionRecord({ ...record({ chain: [] }), permissionFallbackMode: 'unsafe' })
  ).toBe(false)
  expect(isPersistedAgentSessionRecord(record({ chain: [] }))).toBe(true)
})
