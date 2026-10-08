import { expect, it, vi } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import { nativeChatPermissionDefaultRevision } from '../../../shared/native-chat-permission-default'
import { normalizeLoadedProfileState } from '../loading-store/normalize-loaded-profile-state'
import { prepareLoadedProfileSettings } from '../loading-store/prepare-loaded-profile-settings'
import { prepareLoadedTerminalSettings } from '../loading-store/prepare-loaded-terminal-settings'
import { updateSettings, type SettingsMutationOperations } from './settings-update'

function operations(): SettingsMutationOperations {
  return {
    state: getDefaultPersistedState(''),
    bumpLocalWorktreeScanGeneration: vi.fn(),
    removeRetainedBlob: vi.fn(),
    scheduleSave: vi.fn(),
    notifySettingsChanged: vi.fn()
  }
}

it.each(['ask', 'bypass'] as const)(
  'orders each change away from %s in the same saved settings',
  (initial) => {
    const ops = operations()
    ops.state.settings.nativeChatPermissionMode = initial
    const saved: (typeof ops.state.settings)[] = []
    ops.scheduleSave = () => saved.push(structuredClone(ops.state.settings))
    const other = initial === 'ask' ? 'bypass' : 'ask'
    updateSettings(ops, { nativeChatPermissionMode: other }, { notifyListeners: true })
    expect(saved[0]).toMatchObject({
      nativeChatPermissionMode: other,
      nativeChatPermissionRevision: 1
    })
    expect(ops.notifySettingsChanged).toHaveBeenCalledWith(
      { nativeChatPermissionMode: other, nativeChatPermissionRevision: 1 },
      undefined
    )
    updateSettings(ops, { nativeChatPermissionMode: initial })
    expect(saved[1]).toMatchObject({
      nativeChatPermissionMode: initial,
      nativeChatPermissionRevision: 2
    })
    const persisted = { ...ops.state, settings: saved[1] }
    const loaded = normalizeLoadedProfileState(
      persisted,
      prepareLoadedTerminalSettings(persisted, () => {}),
      prepareLoadedProfileSettings(persisted, persisted, () => {}),
      () => {}
    )
    ops.state = loaded
    updateSettings(ops, { nativeChatPermissionMode: other })
    expect(ops.state.settings.nativeChatPermissionRevision).toBe(3)
  }
)

it('ignores client revisions and does not advance an unchanged default or unrelated settings', () => {
  const ops = operations()
  ops.state.settings.nativeChatPermissionRevision = 4
  updateSettings(ops, { nativeChatPermissionRevision: 100, theme: 'dark' })
  updateSettings(ops, { nativeChatPermissionMode: 'bypass', nativeChatPermissionRevision: 0 })
  expect(ops.state.settings.nativeChatPermissionRevision).toBe(4)
  updateSettings(ops, { nativeChatPermissionMode: 'ask', nativeChatPermissionRevision: 100 })
  expect(ops.state.settings.nativeChatPermissionRevision).toBe(5)
})

it('refuses exhausted order before changing or scheduling either saved field', () => {
  const ops = operations()
  ops.state.settings.nativeChatPermissionRevision = Number.MAX_SAFE_INTEGER
  const before = structuredClone(ops.state.settings)
  expect(() => updateSettings(ops, { nativeChatPermissionMode: 'ask' })).toThrow(
    'native_chat_permission_revision_exhausted'
  )
  expect(ops.state.settings).toEqual(before)
  expect(ops.scheduleSave).not.toHaveBeenCalled()
})

it('reads absent or malformed default order as zero without mutating settings', () => {
  for (const revision of [undefined, -1, 1.5, Number.NaN, Infinity]) {
    const settings = { nativeChatPermissionRevision: revision }
    expect(nativeChatPermissionDefaultRevision(settings)).toBe(0)
    expect(settings.nativeChatPermissionRevision).toBe(revision)
  }
})
