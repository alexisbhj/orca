/**
 * Exactly one host sidebar on a wide layout, under every shell and page pairing, counted off the
 * real host layout rendered once natively and once per page document the shell would mount. Which
 * sessions are served comes from the real reducer against each desktop's manifest.
 *
 * Two renderers are stand-ins because their code is not on this branch: the shipped shell's layout
 * drew whenever it was wide, and so did a page built before `canOwnHostArea`.
 */
import { Profiler, useContext } from 'react'
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
    reports: (string | null)[]
  } => ({
    width: 390,
    height: 844,
    pathname: '/h/host-1',
    renderer: 'native',
    hostAreaServing: false,
    reports: []
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
  usePathname: () => env.pathname
}))
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
// The host route's shell screen, reduced to the one thing it tells the layout.
vi.mock('../navigation/host-stack', async () => {
  const layoutClass = await import('./host-layout-class')
  return {
    HostStack: function HostAreaSession(): null {
      const { wide, reportHostArea } = useContext(layoutClass.HostLayoutClassContext)
      layoutClass.useReportedHostArea(
        (action) => {
          env.reports.push(typeof action === 'function' ? 'cleared' : action)
          reportHostArea(action)
        },
        'host-1',
        wide && env.hostAreaServing
      )
      return null
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
vi.mock('./host-sidebar-owner', async () => {
  const native =
    await vi.importActual<typeof import('./host-sidebar-owner')>('./host-sidebar-owner')
  const page = await vi.importActual<typeof import('./host-sidebar-owner.web')>(
    './host-sidebar-owner.web'
  )
  return {
    useHostSidebarDrawnHere: (facts: import('./host-sidebar-owner').HostSidebarFacts): boolean => {
      switch (env.renderer) {
        case 'native':
          return native.useHostSidebarDrawnHere(facts)
        case 'page':
          return page.useHostSidebarDrawnHere(facts)
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
import type { MobileWebPageRoute } from './page-route-policy'

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

/** Whether the real reducer serves this route from this desktop's page, at this layout class. */
function served(page: Page, pathname: string, wide: boolean): boolean {
  const routes = pageRoutes(page)
  const opened = run(createMobileWebShellSession(pathname, wide), {
    type: 'gates-changed',
    gates: routes === null ? gates({ hostCapabilities: [] }) : gates()
  }).session
  if (routes === null) {
    return opened.state.kind !== 'native-route'
  }
  const read = run(
    opened,
    { type: 'cache-read', generation: null },
    { type: 'manifest-read', manifest: manifestFacts({ ...MANIFEST_WIRE, routes }) }
  ).session
  return read.state.kind === 'fetching'
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
  const hostAreaServing = wide && hostAreaBeneath && served(page, HOST, true)
  const native = await sidebarsIn('native', window, { pathname: at, hostAreaServing })
  let pages = 0
  if (served(page, at, wide)) {
    const hostArea = wide && at === HOST
    const pane = wide && native > 0 ? { ...window, width: window.width - SIDEBAR } : window
    pages = await sidebarsIn(pageCode, pane, { pathname: at, ownsHostArea: hostArea })
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
  it('commits the layout no more often than it did, and reports nothing', async () => {
    env.renderer = 'native'
    env.width = PHONE.width
    env.height = PHONE.height
    env.pathname = HOST
    env.hostAreaServing = true
    env.reports.length = 0
    let commits = 0
    const mounted: { tree: ReactTestRenderer | null } = { tree: null }
    await act(async () => {
      mounted.tree = create(
        <Profiler id="layout" onRender={() => (commits += 1)}>
          <HostGroupLayout />
        </Profiler>
      )
    })
    await act(async () => {})
    // Measured on the base layout too: the mount, the stored width and its re-clamp.
    expect(commits).toBe(3)
    expect(env.reports).toEqual([])
    act(() => mounted.tree?.unmount())
  })
})
