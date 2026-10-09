// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { AppState } from '../../store/types'
import type {
  ChatPermissionCreationFixture,
  ChatPermissionCreationHost
} from '../../../../shared/chat-permission-creation.test-fixture'
import type { RuntimeClientTarget } from '../../runtime/runtime-client-target'
import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import type { AgentSessionStatusEvent } from '../../../../shared/agent-session-wire'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { AgentChatPermissionMode } from '../../../../shared/agent-chat-permission-mode'
import type * as RuntimeRpcClientModule from '../../runtime/runtime-rpc-client'
import { getDefaultSettings } from '../../../../shared/constants'
import { toRuntimeExecutionHostId } from '../../../../shared/execution-host'
import { createTestStore } from '../../store/slices/store-test-helpers'
import { hydrateOwnerWorktreeVisibilityDefaults } from '../../store/slices/worktree-visibility-owner-settings'
import { writeStoredRuntimeEnvironment } from '../../web/web-preload-api-test-harness'
import { ChatPermissionSetting } from './ChatPermissionSetting'
import { TooltipProvider } from '../ui/tooltip'
import { adoptAgentSessionLaunchVerdict } from '../../lib/agent-session-launch-plan'
import { launchAgentInNewTab } from '../../lib/launch-agent-in-new-tab'
import { resetStructuredAgentLaunchRegistryForTests } from '../../lib/structured-agent-session-launch-registry'
import { resetStructuredAgentLaunchPersistenceForTests } from '../../lib/structured-agent-session-launch-persistence'
import {
  getStructuredAgentSessionStatusFeed,
  resetStructuredAgentSessionStatusFeedsForTests
} from '../../runtime/structured-agent-session-status-feed'
import { hydrateNativeChatComposerDrafts } from '../native-chat/native-chat-composer-draft-store'
import {
  createMemoryNativeChatComposerDraftStorage,
  setNativeChatComposerDraftStorageForTests
} from '../native-chat/native-chat-composer-draft-storage'

type SettingsIpcHandler = (
  event: { sender: { id: number } },
  updates: Partial<GlobalSettings>
) => Promise<unknown>

const state = vi.hoisted(
  (): {
    store: ReturnType<typeof createTestStore> | undefined
    host: ChatPermissionCreationHost | undefined
    ipcHandlers: Map<string, SettingsIpcHandler>
  } => ({
    store: undefined,
    host: undefined,
    ipcHandlers: new Map()
  })
)
function store() {
  if (!state.store) {
    throw new Error('No renderer store')
  }
  return state.store
}
function host() {
  if (!state.host) {
    throw new Error('No execution host')
  }
  return state.host
}

// The host's real settings IPC handler, minus Electron and the side effects a write applies.
vi.mock('electron', () => ({
  app: { getPath: () => '/FORBIDDEN_REAL_PROFILE' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: (channel: string, handler: SettingsIpcHandler) =>
      state.ipcHandlers.set(channel, handler),
    on: () => {}
  },
  nativeTheme: { themeSource: 'system' }
}))
vi.mock('../../../../main/ghostty/index', () => ({ previewGhosttyImport: vi.fn() }))
vi.mock('../../../../main/warp-themes', () => ({ previewWarpThemeImport: vi.fn() }))
vi.mock('../../../../main/network/proxy-settings', () => ({ applyElectronProxySettings: vi.fn() }))
vi.mock('../../../../main/browser/browser-session-proxy', () => ({
  applyBrowserSessionProxies: vi.fn()
}))
vi.mock('../../../../main/browser/browser-session-registry', () => ({
  browserSessionRegistry: { listProfiles: () => [] }
}))
vi.mock('../../../../main/app-icon', () => ({ applyAppIcon: vi.fn() }))
vi.mock('../../../../main/ai-vault-search/session-search-enablement', () => ({
  applySessionSearchSettingsChange: vi.fn()
}))
vi.mock('../../../../main/agent-hooks/managed-agent-hook-controls', () => ({
  applyAgentStatusHooksEnabled: () => {
    throw new Error('Provider execution forbidden')
  }
}))
vi.mock('../../../../main/agent-workspace-trust', () => ({
  applyAgentWorkspaceTrust: async () => ({})
}))
vi.mock('../../../../main/worktree-root-preparation', () => ({
  prepareLocalWorktreeRootsForRepos: vi.fn()
}))
vi.mock('../../../../main/ipc/worktree-base-directory-watcher', () => ({
  scheduleCurrentWorktreeBaseDirectoryWatcherSync: vi.fn()
}))
vi.mock('../../../../main/menu/register-app-menu', () => ({ rebuildAppMenu: vi.fn() }))
vi.mock('../../../../main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../../main/telemetry/cohort-classifier', () => ({ getCohortAtEmit: () => ({}) }))
vi.mock('../../../../main/ssh/ssh-config-parser', () => ({
  loadUserSshConfig: () => ({ hosts: [] }),
  sshConfigHostsToTargets: () => []
}))

/** This machine's preload: the main process's own `settings:set` handler. */
async function writeLocalSettings(updates: Partial<GlobalSettings>): Promise<GlobalSettings> {
  const handler = state.ipcHandlers.get('settings:set')
  if (!handler) {
    throw new Error('Settings IPC not registered')
  }
  await handler({ sender: { id: 1 } }, updates)
  return host().settings()
}
vi.mock('@/store', () => ({
  useAppStore: Object.assign((selector: (value: AppState) => unknown) => store()(selector), {
    getState: () => store().getState(),
    subscribe: (listener: (value: AppState, previous: AppState) => void) =>
      store().subscribe(listener)
  })
}))
vi.mock('@/runtime/runtime-rpc-client', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeRpcClientModule>()),
  callRuntimeRpc: (_target: RuntimeClientTarget, method: string, params: unknown) =>
    host().rpc(method, params),
  runtimeEnvironmentSupportsCapability: async () => true
}))
vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: (_target: RuntimeClientTarget, method: string, params: unknown) =>
    host().rpc(method, params),
  subscribeStructuredAgentSessionStatus: (
    _target: RuntimeClientTarget,
    emit: (event: AgentSessionStatusEvent) => void
  ) => host().subscribeStatus(emit)
}))
vi.mock('@/runtime/local-structured-session-tabs-sync', () => ({
  refreshLocalStructuredSessionTabs: () => host().inventory()
}))
vi.mock('@/runtime/structured-session-tab-inventory', () => ({
  readStructuredSessionTabInventory: () => host().inventory()
}))
vi.mock('../../web/web-runtime-client', () => ({
  WebRuntimeClient: class {
    async call(method: string, params: unknown): Promise<RuntimeRpcResponse<unknown>> {
      return {
        id: 'web',
        ok: true,
        result: await host().rpc(method, params),
        _meta: { runtimeId: 'host' }
      }
    }
    close() {}
  }
}))

let fixture: ChatPermissionCreationFixture
beforeAll(async () => {
  fixture = await vi.importActual<ChatPermissionCreationFixture>(
    '../../../../main/runtime/chat-permission-creation.test-fixture'
  )
}, 240_000)
afterEach(async () => {
  cleanup()
  resetStructuredAgentSessionStatusFeedsForTests()
  resetStructuredAgentLaunchRegistryForTests()
  resetStructuredAgentLaunchPersistenceForTests()
  await state.host?.close()
  state.host = undefined
  state.store = undefined
  vi.restoreAllMocks()
  window.localStorage.clear()
})

function Control() {
  const settings = store()((value) => value.settings)
  if (!settings) {
    throw new Error('No settings')
  }
  return (
    <TooltipProvider>
      <ChatPermissionSetting
        settings={settings}
        updateSettings={store().getState().updateSettingsOrThrow}
        forceVisible
      />
    </TooltipProvider>
  )
}

let requestSequence = 0
async function newTab(agent: TuiAgent, executionHostId: ExecutionHostId): Promise<string> {
  const plan = adoptAgentSessionLaunchVerdict({
    route: 'structured-native-chat',
    requestId: `new-tab-${++requestSequence}`,
    agent,
    executionHostId,
    worktreeId: 'workspace-1'
  })
  const launch = launchAgentInNewTab({
    agent,
    worktreeId: 'workspace-1',
    agentSessionLaunchPlan: plan
  })
  const settled = await launch?.structuredSettlement
  if (settled?.kind !== 'structured') {
    throw new Error(`New tab failed: ${JSON.stringify(settled)}`)
  }
  return settled.sessionId
}

const CLIENTS = ['desktop-local', 'desktop-remote', 'web'] as const

/** One execution host, and a renderer reaching it as `client` does; returns the chat host's id. */
async function openClient(
  client: (typeof CLIENTS)[number],
  agent: TuiAgent,
  initial: AgentChatPermissionMode,
  options: { withoutAuto?: boolean } = {}
): Promise<ExecutionHostId> {
  state.host = await fixture.openChatPermissionCreationHost(initial, options)
  state.store = createTestStore()
  setNativeChatComposerDraftStorageForTests(createMemoryNativeChatComposerDraftStorage())
  await hydrateNativeChatComposerDrafts()
  const environmentId = `${client}-${agent}-${initial}`
  const target: RuntimeClientTarget =
    client === 'desktop-local' ? { kind: 'local' } : { kind: 'environment', environmentId }
  const local = { ...getDefaultSettings('/unused'), nativeChatPermissionMode: initial }
  let settingsApi = { set: writeLocalSettings }
  if (client === 'web') {
    writeStoredRuntimeEnvironment(window.localStorage, environmentId)
    const { createWebSettingsApi } = await import('../../web/preload-api/web-settings-api')
    const web = createWebSettingsApi().settings
    if (!web) {
      throw new Error('No web settings API')
    }
    settingsApi = web
    state.store.setState({ settings: await web.get() })
  } else {
    local.activeRuntimeEnvironmentId = client === 'desktop-remote' ? environmentId : null
    state.store.setState({
      settings: (await hydrateOwnerWorktreeVisibilityDefaults(local, {})).settings
    })
  }
  Object.assign(window, {
    api: { settings: settingsApi, tabs: { set: async () => {} }, ui: { set: async () => {} } }
  })
  const executionHostId =
    client === 'desktop-local' ? 'local' : toRuntimeExecutionHostId(environmentId)
  getStructuredAgentSessionStatusFeed(target).activate()
  return executionHostId
}

for (const client of CLIENTS) {
  it.each([
    ['claude', 'ask'],
    ['claude', 'bypass'],
    ['codex', 'ask'],
    ['codex', 'bypass']
  ] as const)(`${client}: writes the control then creates %s from %s`, async (agent, initial) => {
    const executionHostId = await openClient(client, agent, initial)
    const existing = await newTab(agent, executionHostId)
    expect(await host().savedMode(existing)).toBe(initial)
    expect(await newTab(agent, executionHostId)).toBe(existing)

    render(<Control />)
    const label = (mode: string) => (mode === 'ask' ? 'Ask for approval' : 'Full access')
    fireEvent.keyDown(screen.getByRole('button', { name: `Permissions ${label(initial)}` }), {
      key: 'Enter'
    })
    const requested = initial === 'ask' ? 'bypass' : 'ask'
    fireEvent.click(
      await screen.findByRole('menuitemradio', { name: new RegExp(label(requested)) })
    )
    await screen.findByRole('button', { name: `Permissions ${label(requested)}` })
    expect(host().settings().nativeChatPermissionMode).toBe(requested)
    expect(await host().savedSetting()).toBe(requested)

    const sessionId = await newTab(agent, executionHostId)
    expect(sessionId).not.toBe(existing)
    expect(await host().savedMode(sessionId)).toBe(requested)
    expect(await host().savedMode(existing)).toBe(initial)
    expect(await newTab(agent, executionHostId)).toBe(sessionId)
  })
}

/** Lets the host's republished summaries reach this renderer's status feed. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

for (const client of CLIENTS) {
  // The chat keeps Auto as the default it was created under even after its start narrows it.
  it.each(['claude', 'codex'] as const)(
    `${client}: reuses an empty %s chat whose Auto default narrowed to Ask`,
    async (agent) => {
      const executionHostId = await openClient(client, agent, 'auto', { withoutAuto: true })
      const first = await newTab(agent, executionHostId)
      await vi.waitFor(async () => expect(await host().savedMode(first)).toBe('ask'))
      await settle()
      expect(host().starts()).toBe(1)

      expect(await newTab(agent, executionHostId)).toBe(first)
      await settle()
      expect(host().starts()).toBe(1)
    }
  )

  it(`${client}: reuses an empty Codex chat created under Accept edits, which it runs as Ask`, async () => {
    const executionHostId = await openClient(client, 'codex', 'accept-edits')
    const first = await newTab('codex', executionHostId)
    expect(await host().savedMode(first)).toBe('ask')
    await settle()

    expect(await newTab('codex', executionHostId)).toBe(first)
    await settle()
    expect(host().starts()).toBe(1)
  })
}
