import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { record } from '../native-chat/agent-session-wire/structured-agent-session-restart-resume-test-harness'
import {
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStore,
  seedTestAgentSessionRecordStore
} from './agent-session-record-store-test-harness'
import {
  closeTestJournalHostDatabase,
  openTestJournalHostDatabase
} from '../native-chat/agent-session-journal/journal-host-database-test-support'
import type { AgentSessionReserveRequest } from './agent-session-reservation-admission'
import { materializeAgentSessionPermissionIntent } from './agent-session-reservation-permission'

it.each([
  ['claude', 'ask'],
  ['claude', 'bypass'],
  ['codex', 'ask'],
  ['codex', 'bypass']
] as const)(
  'saves inherited %s %s and its revision with the reservation, including retry',
  async (agent, initial) => {
    const root = await mkdtemp(join(tmpdir(), 'orca-reservation-permission-'))
    const saved = { ...record({ chain: [] }), provider: agent, options: { model: 'saved-model' } }
    await seedTestAgentSessionRecordStore(root, { records: [saved] })
    const store = await openTestAgentSessionRecordStore(root)
    const now = Date.now()
    const operationId = `${now}-${'1'.padStart(32, '0')}`
    const request: AgentSessionReserveRequest = {
      sessionId: saved.sessionId,
      location: saved.location,
      provider: agent,
      accountHome: saved.accountHome,
      expectedFence: saved.lease.runtimeFence,
      spawnToken: 'stand-in-spawn',
      claimKeyId: 'key-1',
      handoffOperationId: operationId,
      probe: { outcome: 'reservation-unused' },
      operation: { callerKey: 'client', operationId, fingerprint: 'reservation' },
      now,
      defaultPermissionMode: () => initial
    }
    try {
      await store.reconcileOnRestart({ probe: async () => ({ outcome: 'pid-absent' }), now })
      const database = openTestJournalHostDatabase(root).db
      database.exec(`CREATE TRIGGER refuse_permission_intent BEFORE UPDATE ON agent_session_records
      BEGIN SELECT RAISE(ABORT, 'intent write refused'); END`)
      const before = await readPersistedTestAgentSessionStore(root)
      await expect(store.reserveOwner(request)).rejects.toThrow('intent write refused')
      expect(await readPersistedTestAgentSessionStore(root)).toEqual(before)
      expect(store.getRecord(saved.sessionId)?.options).toEqual({ model: 'saved-model' })
      expect(store.listOperationRows()).toEqual([])
      database.exec('DROP TRIGGER refuse_permission_intent')
      const reserved = await store.reserveOwner(request)
      expect(reserved.record).toMatchObject({
        options: { model: 'saved-model', permissionMode: initial },
        permissionRevision: 1
      })
      expect(
        (await readPersistedTestAgentSessionStore(root)).records[saved.sessionId]
      ).toMatchObject({
        options: reserved.record.options,
        permissionRevision: 1,
        lease: { claimStatus: 'reserved' }
      })
      const replay = await store.reserveOwner({
        ...request,
        defaultPermissionMode: () => (initial === 'ask' ? 'bypass' : 'ask')
      })
      expect(replay.disposition).toBe('replayed')
      expect(replay.record.options).toEqual(reserved.record.options)
      expect(store.permissionRevision(saved.sessionId)).toBe(1)
    } finally {
      closeTestJournalHostDatabase(root)
      await rm(root, { recursive: true, force: true })
    }
  }
)

it('does not replace saved intent, live children, unsupported agents or absent host authority', () => {
  const saved = record({ chain: [] })
  const reserved = { ...saved, lease: { ...saved.lease, claimStatus: 'reserved' as const } }
  for (const value of [
    { ...reserved, options: { permissionMode: 'bypass' } },
    { ...reserved, provider: 'gemini' },
    {
      ...reserved,
      lease: {
        ...reserved.lease,
        ownerProcess: { hostId: 'host', pid: 1, processStartTimeMs: 1, spawnToken: 'spawn' }
      }
    },
    { ...reserved, lease: { ...reserved.lease, claimStatus: 'live' as const } }
  ]) {
    expect(materializeAgentSessionPermissionIntent(value, () => 'ask')).toBe(value)
  }
  expect(materializeAgentSessionPermissionIntent(reserved, undefined)).toBe(reserved)
  expect(
    materializeAgentSessionPermissionIntent(
      { ...reserved, provider: 'codex', options: { permissionMode: 'accept-edits' } },
      () => 'bypass'
    ).options
  ).toEqual({ permissionMode: 'ask' })
})

it.each(['claude', 'codex'] as const)(
  'returns the committed initial %s revision for an unseeded create',
  async (provider) => {
    const root = await mkdtemp(join(tmpdir(), 'orca-unseeded-create-'))
    const store = await openTestAgentSessionRecordStore(root)
    const saved = record({ chain: [] })
    const now = Date.now()
    const operationId = `${now}-${'1'.padStart(32, '0')}`
    const request: AgentSessionReserveRequest = {
      sessionId: saved.sessionId,
      location: saved.location,
      provider,
      accountHome: saved.accountHome,
      expectedFence: null,
      spawnToken: 'stand-in-spawn',
      claimKeyId: 'key-1',
      handoffOperationId: operationId,
      probe: { outcome: 'reservation-unused' },
      operation: { callerKey: 'client', operationId, fingerprint: 'unseeded-create' },
      now,
      defaultPermissionMode: () => 'ask'
    }
    try {
      const database = openTestJournalHostDatabase(root).db
      database.exec(`CREATE TRIGGER refuse_permission_create BEFORE INSERT ON agent_session_records
      BEGIN SELECT RAISE(ABORT, 'intent write refused'); END`)
      await expect(store.reserveOwner(request)).rejects.toThrow('intent write refused')
      expect(store.getRecord(saved.sessionId)).toBeNull()
      expect(store.listOperationRows()).toEqual([])
      database.exec('DROP TRIGGER refuse_permission_create')
      const reserved = await store.reserveOwner(request)
      expect(reserved.record).toMatchObject({
        options: { permissionMode: 'ask' },
        permissionRevision: 0
      })
      expect(
        (await readPersistedTestAgentSessionStore(root)).records[saved.sessionId]
      ).toMatchObject({
        options: reserved.record.options,
        permissionRevision: reserved.record.permissionRevision
      })
    } finally {
      closeTestJournalHostDatabase(root)
      await rm(root, { recursive: true, force: true })
    }
  }
)
