/**
 * Leaving a workspace inside the host-area page, where nothing native tears down.
 *
 * Natively a workspace screen's own unmount released its terminal streams and its microphone, and
 * a detail-route page got the same again from the bridge host's disposal. In the host-area page
 * the document and its bridge host outlive the workspace, so the screen's unmount must reach the
 * device and the desktop on its own. Driven through the real port pair, with the host left alive.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  Platform: { OS: 'ios' }
}))
vi.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: () => Promise.resolve(),
  deactivateKeepAwake: () => Promise.resolve()
}))
vi.mock('../transport/host-client-hooks', () => ({
  useDisconnectHostClient: () => () => {},
  useForceReconnect: () => null,
  useForgetHostClient: () => () => {},
  useHostClient: () => ({ client: null, clientId: null, state: 'disconnected' }),
  usePrimeHosts: () => () => {},
  useRefreshHostClient: () => () => {}
}))
// The page bundle resolves the `.web` sibling; vitest would take the native one.
vi.mock('../platform/dictation-capture', () => import('../platform/dictation-capture.web'))

import { RpcClientProvider } from '../transport/client-context.web'
import { useMobileDictation, type UseMobileDictationResult } from '../hooks/use-mobile-dictation'
import { createNativeAudioCapture, type NativeAudioEngine } from '../platform/native-audio'
import { subscribeMobileTerminalSafely } from '../session/mobile-terminal-stream-subscribe'
import { createFakeRpcClient, type FakeRpcClient } from './bridge-host-test-fakes'
import { createFakeBridgePortPair } from './bridge/bridge-port-pair-test-harness'
import type { BridgeNativeVerb } from './bridge/bridge-native-verbs'
import { routeViewOf } from './page-route-policy'

const HOST_AREA_GRANTS = routeViewOf(
  [
    { pathname: '/h/[hostId]', grants: ['navigate'], canOwnHostArea: true },
    {
      pathname: '/h/[hostId]/session/[worktreeId]',
      grants: ['navigate', 'native.audio.start', 'native.audio.read', 'native.audio.stop']
    }
  ],
  '/h/host-a',
  true
).routeGrants

function hostAreaPair(device: string[]) {
  const engine: NativeAudioEngine = {
    requestPermission: async () => 'granted',
    open: async (sampleRate) => ({ opened: true, sampleRate }),
    begin: () => {
      device.push('mic-open')
      return true
    },
    end: () => device.push('mic-closed'),
    screenLock: { hold: () => device.push('awake'), release: () => device.push('asleep') },
    onMicrophoneData: () => ({ remove: () => {} }),
    onInterruption: () => ({ remove: () => {} })
  }
  const audio = createNativeAudioCapture(engine)
  return createFakeBridgePortPair({
    route: { pathname: '/h/host-a' },
    routeGrants: HOST_AREA_GRANTS,
    ownsHostArea: true,
    serveNativeVerb: (verb: BridgeNativeVerb, params: unknown) => {
      device.push(verb)
      return audio.serve(verb, params)
    }
  })
}

const held: { dictation: UseMobileDictationResult | null } = { dictation: null }

function Composer({ desktop }: { desktop: FakeRpcClient }): null {
  held.dictation = useMobileDictation({
    client: desktop,
    enabled: true,
    onTranscript: () => {},
    onError: () => {}
  })
  return null
}

async function answerDesktop(desktop: FakeRpcClient, settle: () => Promise<void>): Promise<void> {
  for (let round = 0; round < 8; round += 1) {
    for (const request of desktop.requests.splice(0)) {
      request.resolve({ id: 'desktop', ok: true, result: {} })
    }
    await settle()
  }
}

beforeEach(() => {
  held.dictation = null
})

describe('leaving a workspace inside the host-area page', () => {
  it("ends the terminal stream on the device's client, which is what restores the PTY", async () => {
    const pair = hostAreaPair([])
    await pair.flush()
    const unsubscribe = subscribeMobileTerminalSafely(
      pair.client,
      { terminal: 'pty-1', client: { id: 'phone' }, viewport: { cols: 60, rows: 30 } },
      () => {},
      () => {}
    )
    await pair.flush()
    const [stream] = pair.rpc.streams
    expect(stream?.method).toBe('terminal.subscribe')
    unsubscribe()
    await pair.flush()
    // The desktop's mobile subscriber goes with this stream, and with it the phone-size fit.
    expect(stream?.unsubscribes).toBe(1)
    expect(pair.rpc.streams).toHaveLength(1)
  })

  it('closes the microphone and lets the screen sleep when the composer unmounts', async () => {
    const device: string[] = []
    const pair = hostAreaPair(device)
    await pair.flush()
    const desktop = createFakeRpcClient()
    const mounted: { tree: ReactTestRenderer | null } = { tree: null }
    act(() => {
      mounted.tree = create(
        <RpcClientProvider client={pair.client}>
          <Composer desktop={desktop} />
        </RpcClientProvider>
      )
    })
    await act(async () => {
      void held.dictation?.start().catch(() => undefined)
      await answerDesktop(desktop, () => pair.flush())
    })
    expect(held.dictation?.status).toBe('recording')
    expect(device).toContain('mic-open')

    await act(async () => {
      mounted.tree?.unmount()
      await answerDesktop(desktop, () => pair.flush())
    })
    expect(device).toEqual(expect.arrayContaining(['native.audio.stop', 'mic-closed', 'asleep']))
    expect(device.lastIndexOf('mic-closed')).toBeGreaterThan(device.lastIndexOf('mic-open'))
  })
})
