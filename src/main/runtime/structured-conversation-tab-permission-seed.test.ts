import { expect, it } from 'vitest'
import { seedStructuredConversationTabPermissions } from './structured-conversation-tab-permission-seed'
import { record } from '../native-chat/agent-session-wire/structured-agent-session-restart-resume-test-harness'
import type { RuntimeMobileSessionTabsSnapshot } from '../../shared/runtime-types'

const saved = record({ chain: [] })
const snapshot: RuntimeMobileSessionTabsSnapshot = {
  worktree: saved.location.workspaceId,
  publicationEpoch: 'p',
  snapshotVersion: 1,
  activeGroupId: null,
  activeTabId: 'chat',
  activeTabType: 'agent-session',
  tabs: [
    {
      type: 'agent-session',
      id: 'chat',
      title: 'Chat',
      sessionId: saved.sessionId,
      agent: 'codex',
      isActive: true
    }
  ]
}

it('publishes current host intent and its fence with the first tab, without storing another copy', () => {
  saved.options = { permissionMode: 'auto' }
  const seeded = seedStructuredConversationTabPermissions(snapshot, () => saved)
  expect(seeded.tabs[0]).toMatchObject({
    permissionSeed: { mode: 'auto', fence: saved.lease.runtimeFence }
  })
  expect(snapshot.tabs[0]).not.toHaveProperty('permissionSeed')
  saved.options = { permissionMode: 'ask' }
  expect(seedStructuredConversationTabPermissions(snapshot, () => saved).tabs[0]).toMatchObject({
    permissionSeed: { mode: 'ask' }
  })
})

it('does not seed a missing record, another workspace, or an unsupported agent', () => {
  expect(
    seedStructuredConversationTabPermissions(snapshot, () => undefined).tabs[0]
  ).not.toHaveProperty('permissionSeed')
  expect(
    seedStructuredConversationTabPermissions({ ...snapshot, worktree: 'other' }, () => saved)
      .tabs[0]
  ).not.toHaveProperty('permissionSeed')
  expect(
    seedStructuredConversationTabPermissions(snapshot, () => ({ ...saved, provider: 'other' }))
      .tabs[0]
  ).not.toHaveProperty('permissionSeed')
})

it('carries the host default order on inherited tab seeds without changing the record', () => {
  const inherited = { ...saved, options: {} }
  const fact = { mode: 'bypass', fence: 7, revision: 0, defaultRevision: 5 } as const
  const seeded = seedStructuredConversationTabPermissions(
    snapshot,
    () => inherited,
    () => fact
  )
  expect(seeded.tabs[0]).toHaveProperty('permissionSeed', fact)
  expect(inherited.options).toEqual({})
  expect(snapshot.tabs[0]).not.toHaveProperty('permissionSeed')
})
