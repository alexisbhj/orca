/**
 * Exactly one host sidebar on a wide layout, under every shell and page pairing, counted off the
 * real host layout rendered once natively and once per page document the shell would mount. Which
 * sessions are served comes from the real reducer against each desktop's manifest.
 *
 * Two renderers are stand-ins because their code is not on this branch: the shipped shell's layout
 * drew whenever it was wide, and so did a page built before `canOwnHostArea`.
 */
import { useCallback, useContext } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

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
    pathname: string
    renderer: Renderer
    hostAreaServing: boolean
    reports: boolean[]
    storageListed: number
  } => ({
    width: 390,
    height: 844,
    pathname: '/h/host-1',
    renderer: 'native',
    hostAreaServing: false,
    reports: [],
    storageListed: 0
  })
)

vi.mock('react-native', () => ({
  // The page renderers are web documents; the rest are the native app.
  Platform: {
    get OS() {
      return env.renderer === 'page' || env.renderer === 'old-page' ? 'web' : 'ios'
    }
  },
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles },
  PanResponder: { create: () => ({ panHandlers: {} }) },
  useWindowDimensions: () => ({ width: env.width, height: env.height })
}))
vi.mock('expo-router', async () => {
  const React = await import('react')
  return {
    useGlobalSearchParams: () => ({ hostId: 'host-1' }),
    usePathname: () => env.pathname,
    useFocusEffect: (effect: () => undefined | (() => void)) => React.useEffect(effect, [effect])
  }
})
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getAllKeys: async () => {
      env.storageListed += 1
      return []
    },
    multiGet: async (keys: readonly string[]) => keys.map((key) => [key, null])
  }
}))
vi.mock('../transport/host-store', () => ({ loadHosts: async () => [] }))
vi.mock('../theme/mobile-theme', () => ({ colors: {}, spacing: { md: 16, lg: 24 } }))
vi.mock('../storage/preferences', () => ({
  HOST_SIDEBAR_DEFAULT_WIDTH: 320,
  HOST_SIDEBAR_MAX_WIDTH: 480,
  HOST_SIDEBAR_MIN_WIDTH: 240,
  loadHostSidebarWidth: async () => 320,
  saveHostSidebarWidth: async () => {}
}))
vi.mock('../components/HostProtocolGate', () => ({
  HostProtocolGate: ({ children }: { children: unknown }) => children
}))
vi.mock('../host-screen/HostScreen', () => ({ HostScreen: HostSidebar }))
// The host route's shell screen, reduced to the one thing it tells the layout, which it reports
// through the real hook.
vi.mock('../navigation/host-stack', async () => {
  const serving = await import('./host-area-serving')
  function HostAreaSession(): null {
    serving.useReportedHostAreaServing(env.hostAreaServing)
    return null
  }
  return {
    HostStack: function HostStack() {
      const report = useContext(serving.HostAreaServingContext)
      const recorded = useCallback(
        (served: boolean) => {
          env.reports.push(served)
          report(served)
        },
        [report]
      )
      return (
        <serving.HostAreaServingContext.Provider value={recorded}>
          <HostAreaSession />
        </serving.HostAreaServingContext.Provider>
      )
    }
  }
})
vi.mock('../transport/host-client-hooks', () => ({
  useDisconnectHostClient: () => () => {},
  useForceReconnect: () => null,
  useForgetHostClient: () => () => {},
  useHostClient: () => ({ client: null, clientId: null, state: 'disconnected' }),
  usePrimeHosts: () => () => {},
  useRefreshHostClient: () => () => {}
}))
// The page's override, as each document would resolve it; an old page drew whenever wide.
vi.mock('./page-owns-host-area', async () => {
  const native =
    await vi.importActual<typeof import('./page-owns-host-area')>('./page-owns-host-area')
  const page = await vi.importActual<typeof import('./page-owns-host-area.web')>(
    './page-owns-host-area.web'
  )
  return {
    usePageOwnsHostArea: (): boolean => {
      switch (env.renderer) {
        case 'native':
        case 'shipped-shell':
          return native.usePageOwnsHostArea()
        case 'page':
          return page.usePageOwnsHostArea()
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
import type { MobileWebPageRoute } from './page-route-policy'
import { usePageHostSnapshot } from './use-page-host-snapshot'

const IPAD = { width: 1180, height: 820 }
const PHONE = { width: 390, height: 844 }
const SIDEBAR = 320
const HOST = '/h/host-1'
const DETAIL = '/h/host-1/session/wt-1'

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

/** The real reducer's session for this route against this desktop's page, as the hook drives it:
 *  opened, told its layout class, and carried to `activating` if it serves the page. */
function sessionFor(page: Page, pathname: string, wide: boolean) {
  const routes = pageRoutes(page)
  const opened = run(
    createMobileWebShellSession(pathname),
    { type: 'layout-changed', wide },
    { type: 'gates-changed', gates: routes === null ? gates({ hostCapabilities: [] }) : gates() }
  ).session
  if (routes === null) {
    return opened
  }
  return run(
    opened,
    { type: 'cache-read', generation: null },
    { type: 'manifest-read', manifest: manifestFacts({ ...MANIFEST_WIRE, routes }) },
    { type: 'download-staged' }
  ).session
}

function served(page: Page, pathname: string, wide: boolean): boolean {
  return sessionFor(page, pathname, wide).state.kind === 'activating'
}

/** What `MobileWebShellScreen` reports to the layout for this session. */
function hostAreaServing(page: Page, wide: boolean): boolean {
  const session = sessionFor(page, HOST, wide)
  return session.ownsHostArea && session.state.kind === 'activating'
}

async function sidebarsIn(
  renderer: Renderer,
  viewport: { width: number; height: number },
  options: { pathname?: string; ownsHostArea?: boolean; hostAreaServing?: boolean } = {}
): Promise<number> {
  env.renderer = renderer
  env.width = viewport.width
  env.height = viewport.height
  env.pathname = options.pathname ?? HOST
  env.hostAreaServing = options.hostAreaServing ?? false
  const mounted: { tree: ReactTestRenderer | null } = { tree: null }
  if (renderer === 'page' || renderer === 'old-page') {
    const pair = createFakeBridgePortPair({
      route: { pathname: env.pathname },
      ...(options.ownsHostArea === undefined ? {} : { ownsHostArea: options.ownsHostArea })
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
  await act(async () => {})
  const count = mounted.tree?.root.findAllByType(HostSidebar).length ?? 0
  act(() => mounted.tree?.unmount())
  return count
}

/**
 * Every sidebar on screen with the native stack showing `at`. `hostAreaBeneath` is a detail pushed
 * over the host route (a handoff to a native screen), as opposed to one deep-linked in on its own.
 */
async function countSidebars(
  shell: Shell,
  page: Page,
  wide: boolean,
  at: string = HOST,
  hostAreaBeneath = at === HOST
) {
  const window = wide ? IPAD : PHONE
  const pageCode: Renderer = page === 'declared' ? 'page' : 'old-page'
  if (shell === 'shipped') {
    const native = await sidebarsIn('shipped-shell', window, { pathname: at })
    // The shipped wide host route is a native placeholder; every other route opens the page.
    const opens = page !== 'none' && !(wide && at === HOST) && served(page, at, false)
    const pane = wide ? { ...window, width: window.width - SIDEBAR } : window
    return { native, pages: opens ? await sidebarsIn(pageCode, pane, { pathname: at }) : 0 }
  }
  const native = await sidebarsIn('native', window, {
    pathname: at,
    hostAreaServing: hostAreaBeneath && hostAreaServing(page, wide)
  })
  let pages = 0
  const session = sessionFor(page, at, wide)
  if (session.state.kind === 'activating') {
    const pane = wide && native > 0 ? { ...window, width: window.width - SIDEBAR } : window
    pages = await sidebarsIn(pageCode, pane, { pathname: at, ownsHostArea: session.ownsHostArea })
  }
  return { native, pages }
}

describe('host sidebars on screen, per shell, page and width, on the host route', () => {
  const rows: [Shell, Page, boolean, { native: number; pages: number }][] = [
    ['shipped', 'none', false, { native: 0, pages: 0 }],
    ['shipped', 'undeclared', false, { native: 0, pages: 0 }],
    ['shipped', 'declared', false, { native: 0, pages: 0 }],
    ['new', 'none', false, { native: 0, pages: 0 }],
    ['new', 'undeclared', false, { native: 0, pages: 0 }],
    ['new', 'declared', false, { native: 0, pages: 0 }],
    ['shipped', 'none', true, { native: 1, pages: 0 }],
    ['shipped', 'undeclared', true, { native: 1, pages: 0 }],
    ['shipped', 'declared', true, { native: 1, pages: 0 }],
    ['new', 'none', true, { native: 1, pages: 0 }],
    ['new', 'undeclared', true, { native: 1, pages: 0 }],
    // The page owns the area: the native layout steps aside on this route only.
    ['new', 'declared', true, { native: 0, pages: 1 }]
  ]

  it.each(rows)('%s shell, %s page, wide=%s', async (shell, page, wide, expected) => {
    expect(await countSidebars(shell, page, wide)).toEqual(expected)
  })
})

describe('host sidebars on a wide detail route', () => {
  const rows: [string, Shell, Page, boolean, { native: number; pages: number }][] = [
    // The one pairing nothing on this branch reaches: both sides are already released.
    ['old app opening a detail', 'shipped', 'undeclared', false, { native: 1, pages: 1 }],
    // A new page in an old shell never had the init fact, so it draws none.
    ['old app opening a detail', 'shipped', 'declared', false, { native: 1, pages: 0 }],
    ['deep link or notification', 'new', 'none', false, { native: 1, pages: 0 }],
    ['deep link or notification', 'new', 'undeclared', false, { native: 1, pages: 0 }],
    ['deep link or notification', 'new', 'declared', false, { native: 1, pages: 0 }],
    ['narrow to wide with a detail pushed', 'new', 'declared', false, { native: 1, pages: 0 }],
    ['handoff to a native screen', 'new', 'declared', true, { native: 1, pages: 0 }],
    ['handoff to a native screen', 'new', 'undeclared', true, { native: 1, pages: 0 }]
  ]

  it.each(rows)('%s: %s shell, %s page', async (_case, shell, page, beneath, expected) => {
    expect(await countSidebars(shell, page, true, DETAIL, beneath)).toEqual(expected)
  })
})

describe('the page sidebar rule', () => {
  it('draws no sidebar in a wide viewport without the init fact', async () => {
    expect(await sidebarsIn('page', IPAD)).toBe(0)
    expect(await sidebarsIn('page', IPAD, { ownsHostArea: false })).toBe(0)
    expect(await sidebarsIn('page', { width: 1366 - SIDEBAR, height: 1024 })).toBe(0)
  })

  it('draws one only when the shell gave it the host area, and only when wide', async () => {
    expect(await sidebarsIn('page', IPAD, { ownsHostArea: true })).toBe(1)
    expect(await sidebarsIn('page', PHONE, { ownsHostArea: true })).toBe(0)
  })
})

describe('a phone', () => {
  it('reports nothing to the layout and lists nothing in the store', async () => {
    const session = sessionFor('declared', HOST, false)
    expect(session.state.kind).toBe('activating')
    env.reports.length = 0
    env.storageListed = 0
    function PhoneHostRoute() {
      usePageHostSnapshot('host-1', HOST, session.ownsHostArea)
      return <HostGroupLayout />
    }
    env.renderer = 'native'
    env.width = PHONE.width
    env.height = PHONE.height
    env.pathname = HOST
    env.hostAreaServing = session.ownsHostArea
    const mounted: { tree: ReactTestRenderer | null } = { tree: null }
    await act(async () => {
      mounted.tree = create(<PhoneHostRoute />)
    })
    await act(async () => {})
    expect(env.reports).toEqual([])
    expect(env.storageListed).toBe(0)
    act(() => mounted.tree?.unmount())
  })
})
