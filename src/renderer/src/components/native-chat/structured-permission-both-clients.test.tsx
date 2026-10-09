// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { PermissionAcquisitionFixture } from '../../../../shared/agent-session-permission-acquisition.test-fixture'
import type { AgentSessionPermissionSeed } from '../../../../shared/agent-chat-permission-mode'
import type { AgentSessionSubscribeEvent } from '../../../../shared/agent-session-wire'
import { useStructuredAgentSessionOptions } from './use-structured-agent-session-options'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: async (_target: unknown, method: string) =>
    method === 'agentSession.modelCatalog' ? { origin: 'unknown' } : new Promise(() => {})
}))
vi.mock('./native-chat-session-option-settings-write', () => ({
  enqueueSessionOptionSettingsWrite: vi.fn()
}))
vi.mock('@/lib/structured-agent-session-launch-registry', () => ({
  getStructuredLaunchStateBySessionId: () => undefined,
  notifyStructuredLaunchListeners: () => {},
  subscribeStructuredAgentLaunchStatus: () => () => {}
}))
// Both client hooks must share this renderer's React dispatcher and test mocks.
vi.mock('../../../../../mobile/node_modules/react', async () => vi.importActual('react'))
vi.mock('../../../../../mobile/node_modules/vitest', () => ({ vi }))
vi.mock('../../../../../mobile/node_modules/@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn() }
}))
vi.mock('../../../../../mobile/src/session/mobile-native-chat-session-option-persistence', () => ({
  persistMobileStructuredOptionPicks: vi.fn()
}))
vi.mock('../../../../../mobile/src/session/mobile-native-chat-send', () => ({
  MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS: 1000
}))

type MobileComposition = {
  nativeChatSessionOptions?: { permissionPicker?: { current: string } } | null
}
type MobileFixture = {
  permissionHost: () => {
    client: unknown
    attach: () => void
    publish: (event: AgentSessionSubscribeEvent) => void
  }
  usePermissionComposition: (props: {
    agent: string
    client: unknown
    sessionId: string
    permissionSeed: AgentSessionPermissionSeed
  }) => MobileComposition
}

it.each(['ask', 'bypass'] as const)(
  'attaches both clients to the same starting Claude child running %s after a default change',
  async (initial) => {
    const { permissionAcquisitionHost } = await vi.importActual<PermissionAcquisitionFixture>(
      '../../../../main/native-chat/agent-session-wire/structured-permission-acquisition.test-fixture'
    )
    const mobile = await vi.importActual<MobileFixture>(
      '../../../../../mobile/src/session/mobile-permission-composition.test-fixture'
    )
    const host = await permissionAcquisitionHost('claude', initial)
    const seed = host.fact()
    await host.start()
    expect(host.childPhase()).toBe('starting')
    host.updateSettings({ nativeChatPermissionMode: initial === 'ask' ? 'bypass' : 'ask' })
    const snapshot = await host.snapshot()
    const publication = host.fact()
    const desktop = renderHook(() =>
      useStructuredAgentSessionOptions({
        agent: 'claude',
        sessionId: host.sessionId,
        target: { kind: 'environment', environmentId: 'permission-host' },
        transportEnabled: true,
        isVisible: true,
        providerVisible: false,
        fence: snapshot.fence,
        turnId: null,
        permissionPublication: publication,
        unloadedTurnRevisions: undefined,
        mutate: async () => {
          throw new Error('No permission picks')
        }
      })
    )
    const wire = mobile.permissionHost()
    const probe = renderHook(() =>
      mobile.usePermissionComposition({
        agent: 'claude',
        client: wire.client,
        sessionId: host.sessionId,
        permissionSeed: seed
      })
    )
    try {
      await act(async () => wire.attach())
      await act(async () => wire.publish(snapshot))
      const labels = () => [
        desktop.result.current.optionSurface.permissionPicker?.current,
        probe.result.current.nativeChatSessionOptions?.permissionPicker?.current
      ]
      expect(labels()).toEqual([initial, initial])
      // The host holds a send until the start proves itself.
      host.answerInitialize()
      await host.send()
      await vi.waitFor(() => expect(host.delivered()).toBe(1))
      expect(labels()).toEqual([host.launchMode(), host.launchMode()])
      expect(host.controls()).toEqual([])
      expect(await host.storedIntent()).toMatchObject({
        options: { permissionMode: initial },
        permissionRevision: 0
      })
    } finally {
      desktop.unmount()
      probe.unmount()
      await host.close()
    }
  }
)
