// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-session-contracts'
import type { Tab, TabGroup } from '../../../shared/tab-types'
import type { AgentSessionStatusSummary } from '../../../shared/agent-session-wire'
import type { StructuredAgentSessionLaunchIntent } from '@/lib/launch-structured-agent-session'
import type * as LaunchAdmissionModule from './structured-agent-session-launch-admission'

const mocks = vi.hoisted(() => ({
  createIntent: vi.fn(),
  launch: vi.fn(),
  callRuntimeRpc: vi.fn(),
  refreshTabs: vi.fn(),
  activateTab: vi.fn(),
  focusGroup: vi.fn(),
  statusBySession: new Map<string, AgentSessionStatusSummary['status']>(),
  liveSessions: new Set<string>()
}))

type StoreState = {
  unifiedTabsByWorktree: Record<string, Tab[]>
  groupsByWorktree: Record<string, TabGroup[]>
  activeGroupIdByWorktree: Record<string, string>
  nativeChatLaunchDraftByTabId: Record<string, { text: string; adopted?: boolean }>
}
/** A workspace split into a left (active) and a right tab group. */
function emptyStoreState(): StoreState {
  const group = (id: string): TabGroup => ({
    id,
    worktreeId: 'wt-reuse',
    activeTabId: null,
    tabOrder: []
  })
  return {
    unifiedTabsByWorktree: {},
    groupsByWorktree: { 'wt-reuse': [group('group-left'), group('group-right')] },
    activeGroupIdByWorktree: { 'wt-reuse': 'group-left' },
    nativeChatLaunchDraftByTabId: {}
  }
}
const store = vi.hoisted((): { state: StoreState } => ({ state: emptyStoreState() }))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), message: vi.fn() } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/lib/agent-catalog', () => ({
  getAgentLabel: () => 'Codex',
  getAgentCatalog: () => [{ id: 'codex', label: 'Codex' }]
}))
vi.mock('@/lib/launch-structured-agent-session', () => {
  class StructuredAgentSessionCreateRefusalError extends Error {}
  class StructuredAgentSessionOwnerUnresolvedError extends Error {}
  return {
    createStructuredAgentSessionLaunchIntent: mocks.createIntent,
    retryStructuredAgentSessionLaunchIntent: vi.fn(),
    abandonStructuredAgentSessionLaunchIntent: vi.fn(),
    launchStructuredAgentSession: mocks.launch,
    StructuredAgentSessionCreateRefusalError,
    StructuredAgentSessionOwnerUnresolvedError
  }
})
// Reuse is decided where an admitted launch opens its chat; here this machine admits at once.
vi.mock('@/lib/structured-agent-session-launch-admission', async (importOriginal) => ({
  ...(await importOriginal<typeof LaunchAdmissionModule>()),
  beginHostAdmittedStructuredLaunch: (args: { openAdmitted: () => unknown }) => args.openAdmitted()
}))
vi.mock('@/runtime/local-structured-session-tabs-sync', () => ({
  refreshLocalStructuredSessionTabs: mocks.refreshTabs
}))
vi.mock('@/runtime/structured-agent-session-client', () => ({
  // Sends reach the runtime RPC through this wrapper, as in the app.
  callStructuredAgentSession: (target: unknown, method: string, params?: unknown) =>
    mocks.callRuntimeRpc(target, method, params)
}))
vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: mocks.callRuntimeRpc,
  ensureRuntimeEnvironmentCompatible: vi.fn(async () => undefined)
}))
vi.mock('@/runtime/structured-agent-session-status-feed', () => ({
  getStructuredAgentSessionStatusFeed: () => ({
    getSessionObservation: (sessionId: string) =>
      mocks.liveSessions.has(sessionId) ? 'live' : 'unverifiable',
    getSnapshot: () =>
      new Map(
        [...mocks.statusBySession].map(([sessionId, status]) => [sessionId, { sessionId, status }])
      )
  })
}))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      ...store.state,
      createUnifiedTab: (
        worktreeId: string,
        contentType: Tab['contentType'],
        init: { targetGroupId?: string }
      ) => {
        const groupId =
          init.targetGroupId ?? store.state.activeGroupIdByWorktree[worktreeId] ?? 'group-left'
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the launch passes the agent-session fields a structured tab carries.
        const tab = { ...init, contentType, worktreeId, groupId, createdAt: 1 } as Tab
        store.state.unifiedTabsByWorktree[worktreeId] = [
          ...(store.state.unifiedTabsByWorktree[worktreeId] ?? []),
          tab
        ]
        return tab
      },
      activateTab: mocks.activateTab,
      focusGroup: mocks.focusGroup,
      setActiveTabType: vi.fn(),
      seedNativeChatLaunchDraft: vi.fn(),
      clearNativeChatLaunchDraft: vi.fn()
    }),
    subscribe: () => () => undefined
  }
}))

import { resetStructuredAgentSessionSendsForTests } from '@/components/native-chat/structured-agent-session-message-sender'
import {
  appendNativeChatAttachmentCache,
  clearNativeChatAttachmentCacheForTests
} from '@/components/native-chat/use-native-chat-composer-attachments'
import {
  clearNativeChatDraftCacheForTests,
  writeNativeChatDraftCache
} from '@/components/native-chat/native-chat-draft-cache'
import {
  hydrateNativeChatComposerDrafts,
  structuredAgentSessionDraftScopeKey
} from '@/components/native-chat/native-chat-composer-draft-store'
import {
  createMemoryNativeChatComposerDraftStorage,
  setNativeChatComposerDraftStorageForTests
} from '@/components/native-chat/native-chat-composer-draft-storage'
import { adoptAgentSessionLaunchVerdict } from './agent-session-launch-plan'
import {
  beginStructuredAgentSessionProvisionalLaunch,
  type StructuredAgentSessionProvisionalLaunch
} from './structured-agent-session-provisional-tab'
import { getStructuredAgentSessionLaunchLifecycle } from './structured-agent-session-launch'
import {
  discardStructuredLaunchPrompts,
  hasStagedStructuredLaunchPrompt
} from './structured-agent-session-launch-prompt'
import { resetStructuredAgentLaunchPersistenceForTests } from './structured-agent-session-launch-persistence'
import { resetStructuredAgentLaunchRegistryForTests } from './structured-agent-session-launch-registry'

const WORKTREE_ID = 'wt-reuse'

function launchIntent(
  sessionId: string,
  worktreeId = WORKTREE_ID
): StructuredAgentSessionLaunchIntent {
  return {
    worktreeId,
    sessionId,
    executionHostId: 'local',
    target: { kind: 'local' },
    agent: 'codex',
    params: {
      envelope: {
        sessionId,
        clientOperationId: `operation-${sessionId}`,
        expectedRuntimeFence: null,
        payloadFingerprint: `fingerprint-${sessionId}`
      },
      worktree: `id:${worktreeId}`,
      agent: 'codex'
    }
  }
}

function published(...sessionIds: string[]): RuntimeMobileSessionTabsResult[] {
  return [WORKTREE_ID, 'wt-other'].map((worktree) => ({
    worktree,
    publicationEpoch: 'epoch-1',
    snapshotVersion: 1,
    activeGroupId: null,
    activeTabId: null,
    activeTabType: null,
    tabs: sessionIds.map((sessionId) => ({
      type: 'agent-session',
      id: `tab-${sessionId}`,
      title: 'Codex',
      sessionId,
      agent: 'codex',
      isActive: false
    }))
  }))
}

const first = launchIntent('session-first')
const second = launchIntent('session-second')

/** A pick from the + menu, new-tab search or the new-agent shortcut: its own action, no text. */
function pick(
  requestId: string,
  overrides: {
    agent?: 'claude' | 'codex'
    worktreeId?: string
    prompt?: string
    /** The split the pick was made in; none means the workspace's active group. */
    group?: string
  } = {}
): Exclude<StructuredAgentSessionProvisionalLaunch, { sessionId: null }> {
  const launch = beginStructuredAgentSessionProvisionalLaunch({
    plan: adoptAgentSessionLaunchVerdict({
      route: 'structured-native-chat',
      requestId,
      agent: overrides.agent ?? 'codex',
      worktreeId: overrides.worktreeId ?? WORKTREE_ID,
      executionHostId: 'local',
      ...(overrides.prompt
        ? { prompt: overrides.prompt, promptDelivery: 'submit-after-ready' as const }
        : {})
    }),
    hooks: {},
    ...(overrides.group ? { targetGroupId: overrides.group } : {})
  })
  if (!launch || launch.sessionId === null) {
    throw new Error('expected a local chat')
  }
  return launch
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve()
  }
}

/** The first chat published and its host's journal holds no request. */
async function publishIdle(sessionId: string): Promise<void> {
  await flush()
  expect(getStructuredAgentSessionLaunchLifecycle(WORKTREE_ID, sessionId)).toBeNull()
  mocks.liveSessions.add(sessionId)
  mocks.statusBySession.set(sessionId, null)
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  clearNativeChatDraftCacheForTests()
  clearNativeChatAttachmentCacheForTests()
  resetStructuredAgentLaunchPersistenceForTests()
  resetStructuredAgentLaunchRegistryForTests()
  resetStructuredAgentSessionSendsForTests()
  for (const sessionId of ['session-first', 'session-second', 'session-third']) {
    discardStructuredLaunchPrompts(sessionId)
  }
  mocks.statusBySession.clear()
  mocks.liveSessions.clear()
  store.state = emptyStoreState()
  mocks.createIntent
    .mockReturnValueOnce(first)
    .mockReturnValueOnce(second)
    .mockReturnValueOnce(launchIntent('session-third'))
  mocks.launch.mockImplementation((intent: StructuredAgentSessionLaunchIntent) =>
    Promise.resolve({ sessionId: intent.sessionId, fence: 1 })
  )
  mocks.refreshTabs.mockResolvedValue(published(first.sessionId, second.sessionId))
  mocks.callRuntimeRpc.mockResolvedValue({
    ok: true,
    value: { submission: { dispatchState: 'accepted' } }
  })
})

describe('a second "new chat" with no text', () => {
  it('opens a second chat while the first empty one is still starting', () => {
    mocks.launch.mockImplementation(() => new Promise(() => undefined))
    const firstPick = pick('plus-pick-1')
    const secondPick = pick('plus-pick-2')

    expect(firstPick.sessionId).toBe(first.sessionId)
    expect(secondPick.sessionId).toBe(second.sessionId)
    expect(store.state.unifiedTabsByWorktree[WORKTREE_ID]).toHaveLength(2)
  })

  it('opens a second chat beside an empty one that published and sits idle', async () => {
    pick('plus-pick-1')
    await publishIdle(first.sessionId)

    const secondPick = pick('plus-pick-2')

    expect(secondPick.sessionId).toBe(second.sessionId)
    expect(store.state.unifiedTabsByWorktree[WORKTREE_ID]).toHaveLength(2)
    await expect(secondPick.settlement).resolves.toEqual({
      kind: 'structured',
      sessionId: second.sessionId
    })
  })

  it('opens one chat when the same pick is delivered twice', () => {
    mocks.launch.mockImplementation(() => new Promise(() => undefined))
    const firstPick = pick('plus-pick-1')

    expect(pick('plus-pick-1').sessionId).toBe(firstPick.sessionId)
    expect(mocks.createIntent).toHaveBeenCalledOnce()
  })
})

describe('a "new chat" with text', () => {
  it('opens its own chat beside an idle empty one', async () => {
    pick('plus-pick-1')
    await publishIdle(first.sessionId)

    const notes = pick('notes-send', { prompt: 'review notes' })

    expect(notes.sessionId).toBe(second.sessionId)
    await expect(notes.promptDeliveryResult).resolves.toEqual({
      delivered: true,
      failureNotified: false
    })
  })

  it('opens its own chat in its own split beside an empty chat starting in another', () => {
    mocks.launch.mockImplementation(() => new Promise(() => undefined))
    const blank = pick('plus-pick-1', { group: 'group-left' })

    const notes = pick('notes-send', { prompt: 'review notes', group: 'group-right' })

    expect(notes.sessionId).toBe(second.sessionId)
    expect(
      store.state.unifiedTabsByWorktree[WORKTREE_ID]?.find(
        (tab) => tab.entityId === second.sessionId
      )?.groupId
    ).toBe('group-right')
    expect(mocks.focusGroup).not.toHaveBeenCalled()
    expect(hasStagedStructuredLaunchPrompt(blank.sessionId)).toBe(false)
    expect(hasStagedStructuredLaunchPrompt(second.sessionId)).toBe(true)
  })

  it('takes an empty chat starting in its own split', () => {
    mocks.launch.mockImplementation(() => new Promise(() => undefined))
    const blank = pick('plus-pick-1', { group: 'group-right' })

    expect(pick('notes-send', { prompt: 'review notes', group: 'group-right' }).sessionId).toBe(
      blank.sessionId
    )
  })

  it('leaves a starting chat whose draft holds text, given back or typed, to its user', () => {
    mocks.launch.mockImplementation(() => new Promise(() => undefined))
    const blank = pick('plus-pick-1')
    writeNativeChatDraftCache(structuredAgentSessionDraftScopeKey(blank.sessionId), 'my words')

    expect(pick('notes-send', { prompt: 'review notes' }).sessionId).toBe(second.sessionId)
    expect(hasStagedStructuredLaunchPrompt(blank.sessionId)).toBe(false)
  })

  it('never takes over or reuses a chat whose saved draft holds text or only an image', async () => {
    mocks.launch.mockImplementation(() => new Promise(() => undefined))
    const typed = pick('plus-pick-1')
    writeNativeChatDraftCache(structuredAgentSessionDraftScopeKey(typed.sessionId), 'my words')
    // The saved drafts have loaded, so only the draft itself keeps this chat from looking empty.
    await hydrateNativeChatComposerDrafts()
    const taken = pick('notes-send', { prompt: 'review notes' })
    expect(taken.sessionId).not.toBe(typed.sessionId)
    expect(hasStagedStructuredLaunchPrompt(typed.sessionId)).toBe(false)

    appendNativeChatAttachmentCache(structuredAgentSessionDraftScopeKey(taken.sessionId), [
      { id: 'shot', path: '/tmp/shot.png' }
    ])
    await hydrateNativeChatComposerDrafts()
    expect(pick('notes-send-2', { prompt: 'more notes' }).sessionId).not.toBe(taken.sessionId)
  })

  it('takes no chat while saved drafts are still loading, since one may hold a draft', () => {
    mocks.launch.mockImplementation(() => new Promise(() => undefined))
    const blank = pick('plus-pick-1')
    const loading = createMemoryNativeChatComposerDraftStorage()
    setNativeChatComposerDraftStorageForTests({
      ...loading,
      loadAll: () => new Promise<ReadonlyMap<string, unknown>>(() => undefined)
    })
    void hydrateNativeChatComposerDrafts()

    expect(pick('notes-send', { prompt: 'review notes' }).sessionId).not.toBe(blank.sessionId)
  })

  it('takes an empty chat still starting, as before', () => {
    mocks.launch.mockImplementation(() => new Promise(() => undefined))
    const blank = pick('plus-pick-1')

    expect(pick('notes-send', { prompt: 'review notes' }).sessionId).toBe(blank.sessionId)
  })
})
