import { expect, it, vi } from 'vitest'
import { fixture } from './profile-state-delayed-authority-fixture'

vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: () => ({ nth_repo_added: 2 })
}))
vi.mock('../../ssh/ssh-config-parser', () => ({
  loadUserSshConfig: () => ({ hosts: [] }),
  sshConfigHostsToTargets: () => []
}))

it.each(['ask', 'bypass'] as const)(
  'commits the changed %s default and its order in one SQLite settings row',
  async (initial) => {
    const { store, authority, readState } = await fixture()
    store.updateSettings({ nativeChatPermissionMode: initial })
    await store.flushPendingOrThrowAsync()
    const revision = store.getSettings().nativeChatPermissionRevision ?? 0
    const other = initial === 'ask' ? 'bypass' : 'ask'
    store.updateSettings({ nativeChatPermissionMode: other })
    await store.flushPendingOrThrowAsync()
    expect(readState().settings).toMatchObject({
      nativeChatPermissionMode: other,
      nativeChatPermissionRevision: revision + 1
    })
    expect(
      authority.captures
        .at(-1)
        ?.find((row) => row.domain === 'settings')
        ?.payload?.toString()
    ).toContain('nativeChatPermissionRevision')
    store.updateSettings({ nativeChatPermissionMode: initial })
    await store.flushPendingOrThrowAsync()
    expect(readState().settings).toMatchObject({
      nativeChatPermissionMode: initial,
      nativeChatPermissionRevision: revision + 2
    })
  }
)
