import { beforeEach, describe, expect, it, vi } from 'vitest'

const stored = vi.hoisted(() => new Map<string, string>())
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => stored.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      stored.set(key, value)
    },
    removeItem: async (key: string) => {
      stored.delete(key)
    }
  }
}))
vi.mock('../layout/responsive-layout', () => ({ useResponsiveLayout: () => ({}) }))

import {
  computeMobileWebBundleId,
  MobileWebBundleRouteSchema
} from '../../../src/shared/mobile-web-bundle/manifest-contract'
import { MobileWebBundleManifestReadSchema } from '../transport/mobile-web-bundle-reply-schemas'
import { createBridgeInitFrame } from './bridge/bridge-init-frame'
import { readBridgeHostMessage } from './bridge/bridge-envelope'
import { readShellSession } from './bridge/bridge-client-session'
import {
  createMobileWebShellSession,
  gates,
  MANIFEST_WIRE,
  manifestFacts,
  run
} from './mobile-web-shell-session-test-fixtures'
import { hostAreaOwnerOf, resetHostAreaOwnersForTests } from './host-area-owner'
import { pageCanOwnHostArea, routeViewOf, type MobileWebPageRoute } from './page-route-policy'
import { nativeHostSidebarShown, shellSwitchDecision } from './shell-switch-decision'

const HOST_ROUTE = '/h/host-1'
const SESSION_GRANTS = [
  'navigate',
  'storage',
  'externalLink',
  'haptics',
  'screencastBinary',
  'native.clipboard.write',
  'native.clipboard.read',
  'native.media.pick',
  'native.media.read',
  'native.media.release',
  'native.audio.start',
  'native.audio.read',
  'native.audio.stop'
]

/** The desktop's list as this branch writes it, trimmed to one route of each grant shape. */
function desktopRoutes(declares: boolean): MobileWebPageRoute[] {
  return [
    {
      pathname: '/h/[hostId]',
      grants: ['navigate', 'storage', 'externalLink', 'haptics'],
      ...(declares ? { canOwnHostArea: true } : {})
    },
    {
      pathname: '/h/[hostId]/tasks',
      grants: ['navigate', 'storage', 'externalLink', 'haptics', 'native.clipboard.write']
    },
    {
      pathname: '/h/[hostId]/files/[worktreeId]',
      grants: ['navigate', 'storage', 'externalLink', 'haptics']
    },
    {
      pathname: '/h/[hostId]/session/[worktreeId]',
      grants: SESSION_GRANTS,
      optionalGrants: ['externalNavigation']
    }
  ]
}

function hostAreaStateFor(routes: MobileWebPageRoute[] | null) {
  const opened = run(createMobileWebShellSession(HOST_ROUTE, true), {
    type: 'gates-changed',
    // No bundle capability is a desktop that serves no page at all.
    gates: routes === null ? gates({ hostCapabilities: [] }) : gates()
  })
  if (routes === null) {
    return opened.session
  }
  return run(
    opened.session,
    { type: 'cache-read', generation: null },
    { type: 'manifest-read', manifest: manifestFacts({ ...MANIFEST_WIRE, routes }) }
  ).session
}

beforeEach(() => {
  stored.clear()
  resetHostAreaOwnersForTests()
})

describe('the page declaring it can own the host area', () => {
  it('is a manifest field the desktop may write and an old phone reads past', () => {
    const [host] = desktopRoutes(true)
    expect(MobileWebBundleRouteSchema.safeParse(host).success).toBe(true)
    // `true` only: a desktop writing `false` is writing a field with no meaning.
    expect(MobileWebBundleRouteSchema.safeParse({ ...host, canOwnHostArea: false }).success).toBe(
      false
    )
  })

  it('reads a value this build cannot read as no declaration, not a refused bundle', () => {
    const parsed = MobileWebBundleManifestReadSchema.safeParse({
      ...MANIFEST_WIRE,
      buildId: computeMobileWebBundleId(MANIFEST_WIRE.assets),
      routes: [{ pathname: '/h/[hostId]', grants: ['navigate'], canOwnHostArea: 'yes' }]
    })
    expect(parsed.success).toBe(true)
    expect(pageCanOwnHostArea(parsed.data?.routes, HOST_ROUTE)).toBe(false)
  })

  it('counts only on the host route this shell would serve', () => {
    expect(pageCanOwnHostArea(desktopRoutes(true), HOST_ROUTE)).toBe(true)
    expect(pageCanOwnHostArea(desktopRoutes(false), HOST_ROUTE)).toBe(false)
    expect(pageCanOwnHostArea(desktopRoutes(true), '/h/host-1/tasks')).toBe(false)
    const unserved = [{ ...desktopRoutes(true)[0]!, grants: ['native.teleport.start'] }]
    expect(pageCanOwnHostArea(unserved, HOST_ROUTE)).toBe(false)
  })
})

describe('the wide host-area session', () => {
  it("is granted every served route's grants, and no phone session is", () => {
    const view = routeViewOf(desktopRoutes(true), HOST_ROUTE, true)
    expect([...view.routeGrants].sort()).toEqual([...SESSION_GRANTS, 'externalNavigation'].sort())
    // Every pair the page compares a hop against is covered, which is what keeps it in the page.
    for (const pair of view.pageRouteGrants) {
      expect(pair.grants.every((grant) => view.routeGrants.includes(grant))).toBe(true)
    }
    expect(routeViewOf(desktopRoutes(true), HOST_ROUTE).routeGrants).toEqual([
      'navigate',
      'storage',
      'externalLink',
      'haptics'
    ])
  })

  it('serves nothing against a page that cannot own the area', () => {
    expect(routeViewOf(desktopRoutes(false), HOST_ROUTE, true)).toEqual({
      pageRoutes: [],
      pageRouteGrants: [],
      routeGrants: []
    })
  })

  it('stays native for no page and for a page without the declaration, and records native', () => {
    for (const routes of [null, desktopRoutes(false)]) {
      const session = hostAreaStateFor(routes)
      expect(session.state.kind).toBe('native-route')
      expect(hostAreaOwnerOf(session.state.kind)).toBe('native')
    }
  })

  it('fetches the declaring page and records it as the owner before it can paint', () => {
    const session = hostAreaStateFor(desktopRoutes(true))
    expect(session.state.kind).toBe('fetching')
    expect(hostAreaOwnerOf(session.state.kind)).toBe('page')
    expect(session.routeGrants).toContain('native.audio.start')
  })

  it('records nothing while it has not read the bundle', () => {
    expect(hostAreaOwnerOf('checking')).toBeNull()
    expect(hostAreaOwnerOf('offline')).toBeNull()
    expect(hostAreaOwnerOf('failed')).toBeNull()
  })
})

describe('the init fact', () => {
  function init(ownsHostArea: boolean | undefined) {
    return createBridgeInitFrame({
      sessionId: 's',
      buildId: 'b',
      connection: {
        state: 'connected',
        reconnectAttempt: 0,
        lastConnectedAt: null,
        lastInboundAt: null,
        generation: null
      },
      route: { pathname: HOST_ROUTE },
      pageRoutes: [],
      granted: [],
      host: { id: 'host-1', name: 'Host', endpoint: 'ws://h', lastConnected: 0 },
      storage: {},
      ...(ownsHostArea === undefined ? {} : { ownsHostArea })
    })
  }

  it('crosses only for the host-area session, and is absent otherwise', () => {
    expect(init(true).ownsHostArea).toBe(true)
    expect('ownsHostArea' in init(false)).toBe(false)
    expect('ownsHostArea' in init(undefined)).toBe(false)
  })

  it('reads as false from every shell that predates it, and from a value it cannot read', () => {
    const parse = (frame: unknown) => {
      const read = readBridgeHostMessage(JSON.stringify(frame))
      if (!read.ok || read.message.type !== 'init') {
        throw new Error('init refused')
      }
      return readShellSession(read.message).ownsHostArea
    }
    expect(parse(init(true))).toBe(true)
    expect(parse(init(undefined))).toBe(false)
    expect(parse({ ...init(undefined), ownsHostArea: 'all of it' })).toBe(false)
  })
})

describe('who draws the wide sidebar natively', () => {
  it('is the native layout unless the page owns the area, and nobody while unsure', () => {
    expect(nativeHostSidebarShown(false, null)).toBe(true)
    expect(nativeHostSidebarShown(false, 'page')).toBe(true)
    expect(nativeHostSidebarShown(true, 'native')).toBe(true)
    expect(nativeHostSidebarShown(true, 'page')).toBe(false)
    expect(nativeHostSidebarShown(true, null)).toBe(false)
    expect(nativeHostSidebarShown(null, 'native')).toBe(false)
  })

  it('keeps every detail switch native on a wide layout the page does not own', () => {
    const route = { pathname: '/h/host-1/session/wt-1' }
    expect(shellSwitchDecision(true, route, 'native')).toEqual({ kind: 'native' })
    expect(shellSwitchDecision(true, route, null)).toEqual({ kind: 'pending' })
    expect(shellSwitchDecision(true, route, 'page')).toEqual({ kind: 'shell', route })
    // A phone is unchanged: no owner is consulted.
    expect(shellSwitchDecision(true, route)).toEqual({ kind: 'shell', route })
  })
})
