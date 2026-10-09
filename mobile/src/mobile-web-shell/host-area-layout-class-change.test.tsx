/**
 * A layout-class change (rotation, Split View, a foldable opening) re-decides a mounted session.
 *
 * Off a wide layout a detail route is served as before; on one it is served only by a page that
 * declares `canOwnHostArea`, because an older page would draw its own sidebar beside the native
 * one. The session rebuilds on the change, so the page's in-page stack does not survive it.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { MOBILE_WEB_BUNDLE_CAPABILITY } from '../../../src/shared/mobile-web-bundle/mobile-web-bundle-capability'
import type { MobileWebBundleManifestRead } from '../transport/mobile-web-bundle-reply-schemas'
import type { GenerationStore } from './generation-store'
import type { MobileWebShellSessionState } from './mobile-web-shell-session-contract'

const doubles = vi.hoisted(
  (): {
    routes: MobileWebBundleManifestRead['routes']
    gates: {
      statusPending: boolean
      statusReadable: boolean
      hostCapabilities: string[]
      hostProtocolWindow: { protocolVersion: number; minCompatibleMobileVersion: number }
    }
  } => ({
    routes: [],
    gates: {
      statusPending: false,
      statusReadable: true,
      hostCapabilities: [],
      hostProtocolWindow: { protocolVersion: 10, minCompatibleMobileVersion: 1 }
    }
  })
)

vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length) }))
vi.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: { cache: '' } }))
vi.mock('../transport/mobile-endpoint-supervisor-support', () => ({
  encodeBase64Url: () => 'session-id'
}))
vi.mock('../components/HostProtocolGate', () => ({ useHostProtocolGates: () => doubles.gates }))
vi.mock('../transport/client-context', () => ({
  useHostClient: () => ({ client: {}, state: 'connected' })
}))
vi.mock('../transport/rpc-operation', () => ({
  defineRpcOperation: (definition: unknown) => definition,
  runRpcOperation: async () => ({
    manifest: {
      schemaVersion: 1,
      buildId: 'b'.repeat(64),
      minCompatibleRuntimeProtocolVersion: 2,
      runtimeProtocolVersion: 5,
      pageVersion: 1,
      entrypoint: 'index.html',
      totalBytes: 2048,
      assets: [
        { path: 'index.html', sha256: 'c'.repeat(64), byteLength: 2048, contentType: 'text/html' }
      ],
      routes: doubles.routes
    }
  })
}))
vi.mock('../transport/mobile-web-bundle-fetch', () => ({
  fetchMobileWebBundle: () => new Promise(() => {})
}))

import { useMobileWebShellSession } from './use-mobile-web-shell-session'

const store: GenerationStore = {
  readActiveGeneration: async () => null,
  stageGeneration: async () => {
    throw new Error('not reached')
  },
  commitGeneration: async () => {
    throw new Error('not reached')
  },
  abortStagedGeneration: async () => undefined,
  sweepStagedGenerations: async () => undefined,
  deleteHostCache: async () => undefined,
  persistActiveManifest: async () => 'persisted',
  recordUpdateFailure: async () => undefined,
  readUpdateFailures: async () => [],
  forgetHostUpdateFailures: async () => undefined
}

function routes(declares: boolean): MobileWebBundleManifestRead['routes'] {
  return [
    {
      pathname: '/h/[hostId]',
      grants: ['navigate'],
      ...(declares ? { canOwnHostArea: true } : {})
    },
    { pathname: '/h/[hostId]/session/[worktreeId]', grants: ['navigate'] }
  ]
}

async function settledKinds(declares: boolean, widths: readonly boolean[]) {
  doubles.routes = routes(declares)
  doubles.gates.hostCapabilities = [MOBILE_WEB_BUNDLE_CAPABILITY]
  const seen: { state: MobileWebShellSessionState; grants: readonly string[] }[] = []
  function Probe({ wide }: { wide: boolean }) {
    const session = useMobileWebShellSession({
      hostId: 'host-1',
      routePathname: '/h/host-1/session/wt-1',
      wide,
      runtime: {
        createStore: () => store,
        mintSessionId: () => 'session-id',
        now: () => 0,
        setTimer: () => () => {}
      }
    })
    seen.push({ state: session.state, grants: session.routeGrants })
    return null
  }
  const mounted: { tree: ReactTestRenderer | null } = { tree: null }
  const kinds: string[] = []
  for (const wide of widths) {
    await act(async () => {
      if (mounted.tree === null) {
        mounted.tree = create(<Probe wide={wide} />)
      } else {
        mounted.tree.update(<Probe wide={wide} />)
      }
    })
    await act(async () => {})
    kinds.push(seen.at(-1)?.state.kind ?? 'none')
  }
  act(() => mounted.tree?.unmount())
  return kinds
}

describe('a detail session across a layout-class change', () => {
  it('goes native on a wide layout under a page without the declaration, and back', async () => {
    expect(await settledKinds(false, [false, true, false])).toEqual([
      'fetching',
      'native-route',
      'fetching'
    ])
  })

  it('stays served at both widths under a declaring page, beside the native sidebar', async () => {
    expect(await settledKinds(true, [false, true, false])).toEqual([
      'fetching',
      'fetching',
      'fetching'
    ])
  })
})
