/**
 * Exactly one host sidebar on a wide layout, under every shell and page pairing, counted off the
 * real host layout rendered once natively and once per page document the shell would mount.
 *
 * Two renderers are stand-ins because their code is not on this branch: the shipped shell's layout
 * drew whenever it was wide, and so did a page built before `canOwnHostArea`.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Renderer = 'native' | 'page' | 'shipped-shell' | 'old-page'

const { HostSidebar } = vi.hoisted(() => ({
  HostSidebar: function HostSidebar(): null {
    return null
  }
}))

const env = vi.hoisted(
  (): {
    width: number
    height: number
    renderer: Renderer
    flag: boolean
    stored: Map<string, string>
  } => ({
    width: 390,
    height: 844,
    renderer: 'native',
    flag: true,
    stored: new Map<string, string>()
  })
)

vi.mock('react-native', () => ({
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles },
  PanResponder: { create: () => ({ panHandlers: {} }) },
  useWindowDimensions: () => ({ width: env.width, height: env.height })
}))
vi.mock('expo-router', () => ({
  useGlobalSearchParams: () => ({ hostId: 'host-1' }),
  usePathname: () => '/h/host-1'
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => env.stored.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      env.stored.set(key, value)
    },
    removeItem: async (key: string) => {
      env.stored.delete(key)
    }
  }
}))
vi.mock('../theme/mobile-theme', () => ({ colors: {}, spacing: { md: 16, lg: 24 } }))
vi.mock('../storage/preferences', () => ({
  HOST_SIDEBAR_DEFAULT_WIDTH: 320,
  HOST_SIDEBAR_MAX_WIDTH: 480,
  HOST_SIDEBAR_MIN_WIDTH: 240,
  loadHostSidebarWidth: async () => 320,
  saveHostSidebarWidth: async () => {},
  mobileWebShellFlagCanBeOn: () => true,
  loadMobileWebShellEnabled: async () => env.flag
}))
vi.mock('../components/HostProtocolGate', () => ({
  HostProtocolGate: ({ children }: { children: unknown }) => children
}))
vi.mock('../host-screen/HostScreen', () => ({ HostScreen: HostSidebar }))
vi.mock('../navigation/host-stack', () => ({ HostStack: () => null }))
vi.mock('../transport/host-client-hooks', () => ({
  useDisconnectHostClient: () => () => {},
  useForceReconnect: () => null,
  useForgetHostClient: () => () => {},
  useHostClient: () => ({ client: null, clientId: null, state: 'disconnected' }),
  usePrimeHosts: () => () => {},
  useRefreshHostClient: () => () => {}
}))
vi.mock('./host-sidebar-owner', async () => {
  const native =
    await vi.importActual<typeof import('./host-sidebar-owner')>('./host-sidebar-owner')
  const page = await vi.importActual<typeof import('./host-sidebar-owner.web')>(
    './host-sidebar-owner.web'
  )
  return {
    useHostSidebarDrawnHere: (hostId: string): boolean => {
      switch (env.renderer) {
        case 'native':
          return native.useHostSidebarDrawnHere(hostId)
        case 'page':
          return page.useHostSidebarDrawnHere(hostId)
        case 'shipped-shell':
        case 'old-page':
          return true
      }
    }
  }
})

import HostGroupLayout from '../../app/h/_layout'
import { RpcClientProvider } from '../transport/client-context.web'
import { createFakeBridgePortPair } from './bridge/bridge-port-pair-test-harness'
import {
  createMobileWebShellSession,
  gates,
  MANIFEST_WIRE,
  manifestFacts,
  run
} from './mobile-web-shell-session-test-fixtures'
import {
  hostAreaOwnerOf,
  recordHostAreaOwner,
  resetHostAreaOwnersForTests
} from './host-area-owner'
import type { MobileWebPageRoute } from './page-route-policy'
import { shellSwitchDecision } from './shell-switch-decision'

const IPAD = { width: 1180, height: 820 }
const PHONE = { width: 390, height: 844 }
const SIDEBAR = 320
const DETAIL = { pathname: '/h/host-1/session/wt-1' }

type Shell = 'shipped' | 'new'
type Page = 'none' | 'undeclared' | 'declared'

function pageRoutes(page: Page): MobileWebPageRoute[] | null {
  if (page === 'none') {
    return null
  }
  return [
    {
      pathname: '/h/[hostId]',
      grants: ['navigate'],
      ...(page === 'declared' ? { canOwnHostArea: true } : {})
    },
    { pathname: '/h/[hostId]/session/[worktreeId]', grants: ['navigate'] }
  ]
}

/** The owner the real reducer records for the wide host-area session against this desktop. */
function learnOwner(page: Page): void {
  const routes = pageRoutes(page)
  const opened = run(createMobileWebShellSession('/h/host-1', true), {
    type: 'gates-changed',
    gates: routes === null ? gates({ hostCapabilities: [] }) : gates()
  }).session
  const session =
    routes === null
      ? opened
      : run(
          opened,
          { type: 'cache-read', generation: null },
          { type: 'manifest-read', manifest: manifestFacts({ ...MANIFEST_WIRE, routes }) }
        ).session
  const owner = hostAreaOwnerOf(session.state.kind)
  if (owner !== null) {
    recordHostAreaOwner('host-1', owner)
  }
}

async function sidebarsIn(
  renderer: Renderer,
  viewport: { width: number; height: number },
  ownsHostArea?: boolean
): Promise<number> {
  env.renderer = renderer
  env.width = viewport.width
  env.height = viewport.height
  const mounted: { tree: ReactTestRenderer | null } = { tree: null }
  if (renderer === 'page') {
    const pair = createFakeBridgePortPair({
      route: { pathname: '/h/host-1' },
      ...(ownsHostArea === undefined ? {} : { ownsHostArea })
    })
    await pair.flush()
    await act(async () => {
      mounted.tree = create(
        <RpcClientProvider client={pair.client}>
          <HostGroupLayout />
        </RpcClientProvider>
      )
    })
  } else {
    await act(async () => {
      mounted.tree = create(<HostGroupLayout />)
    })
  }
  // Settles the flag and the owner record, both read after the first render.
  await act(async () => {})
  const count = mounted.tree?.root.findAllByType(HostSidebar).length ?? 0
  act(() => mounted.tree?.unmount())
  return count
}

/** Every sidebar on screen: the native layout's plus each page document's own. */
async function countSidebars(shell: Shell, page: Page, wide: boolean) {
  const window = wide ? IPAD : PHONE
  if (shell === 'new' && wide) {
    learnOwner(page)
  }
  const native = await sidebarsIn(shell === 'new' ? 'native' : 'shipped-shell', window)
  let pages = 0
  if (page !== 'none') {
    const pageRenderer: Renderer = page === 'declared' ? 'page' : 'old-page'
    if (shell === 'new' && wide && env.stored.get('orca:hostAreaOwner:host-1') === 'page') {
      // The host-area session, full width; detail routes open inside this same document.
      pages += await sidebarsIn(pageRenderer, window, true)
    } else if (
      shell === 'shipped' ||
      shellSwitchDecision(true, DETAIL, wide ? 'native' : undefined).kind === 'shell'
    ) {
      // A detail route's own session, beside the native sidebar when there is one.
      const pane = wide ? { ...window, width: window.width - SIDEBAR } : window
      pages += await sidebarsIn(pageRenderer, pane)
    }
  }
  return { native, pages }
}

beforeEach(() => {
  env.stored.clear()
  env.flag = true
  resetHostAreaOwnersForTests()
})

describe('host sidebars on screen, per shell, page and width', () => {
  const rows: [Shell, Page, boolean, { native: number; pages: number }][] = [
    ['shipped', 'none', false, { native: 0, pages: 0 }],
    ['shipped', 'undeclared', false, { native: 0, pages: 0 }],
    ['shipped', 'declared', false, { native: 0, pages: 0 }],
    ['new', 'none', false, { native: 0, pages: 0 }],
    ['new', 'undeclared', false, { native: 0, pages: 0 }],
    ['new', 'declared', false, { native: 0, pages: 0 }],
    ['shipped', 'none', true, { native: 1, pages: 0 }],
    // The one pairing nothing on this branch reaches: both sides are already released.
    ['shipped', 'undeclared', true, { native: 1, pages: 1 }],
    // A new page in an old shell: it never had the init fact, so it draws none (rule 1).
    ['shipped', 'declared', true, { native: 1, pages: 0 }],
    ['new', 'none', true, { native: 1, pages: 0 }],
    // An old page against a new shell: the wide layout stays fully native.
    ['new', 'undeclared', true, { native: 1, pages: 0 }],
    // The page owns the area: the native layout steps aside.
    ['new', 'declared', true, { native: 0, pages: 1 }]
  ]

  it.each(rows)('%s shell, %s page, wide=%s', async (shell, page, wide, expected) => {
    expect(await countSidebars(shell, page, wide)).toEqual(expected)
  })
})

describe('the page sidebar rule', () => {
  it('draws no sidebar in a wide viewport without the init fact', async () => {
    expect(await sidebarsIn('page', IPAD)).toBe(0)
    expect(await sidebarsIn('page', IPAD, false)).toBe(0)
    // A detail pane on a 13-inch iPad is still a wide viewport by itself.
    expect(await sidebarsIn('page', { width: 1366 - SIDEBAR, height: 1024 })).toBe(0)
  })

  it('draws one only when the shell gave it the host area, and only when wide', async () => {
    expect(await sidebarsIn('page', IPAD, true)).toBe(1)
    expect(await sidebarsIn('page', PHONE, true)).toBe(0)
  })
})

describe('the native layout on a wide layout', () => {
  it('draws with the flag off whatever the record says', async () => {
    env.flag = false
    recordHostAreaOwner('host-1', 'page')
    expect(await sidebarsIn('native', IPAD)).toBe(1)
  })

  it('reads a relaunch from the stored record without drawing first', async () => {
    env.stored.set('orca:hostAreaOwner:host-1', 'page')
    expect(await sidebarsIn('native', IPAD)).toBe(0)
  })

  it('crosses a layout-class change with one sidebar or none at every width', async () => {
    recordHostAreaOwner('host-1', 'page')
    for (const window of [IPAD, PHONE, IPAD, { width: 694, height: 1024 }]) {
      const native = await sidebarsIn('native', window)
      const page = await sidebarsIn('page', window, window.width >= 700)
      expect(native + page).toBeLessThanOrEqual(1)
    }
  })
})
