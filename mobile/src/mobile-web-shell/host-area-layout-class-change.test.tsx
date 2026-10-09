/**
 * The host route across a layout-class change: rotation, Split View, a foldable opening.
 *
 * A wide window mounts the host-area session and a narrow one the phone's list session. They were
 * opened under different grants and only one owns the area, so crossing the threshold is a remount
 * of one into the other; the page's in-page stack does not survive it.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Mount = { event: 'mount' | 'unmount'; pathname: string; hostArea: boolean }

const env = vi.hoisted(
  (): { wide: boolean; storage: Map<string, string>; mounts: Mount[]; placeholders: number } => ({
    wide: true,
    storage: new Map(),
    mounts: [],
    placeholders: 0
  })
)

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => env.storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      env.storage.set(key, value)
    }
  }
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (styles: unknown) => styles },
  View: 'View'
}))
vi.mock('expo-router', () => ({ useLocalSearchParams: () => ({ hostId: 'host-1' }) }))
vi.mock('../components/WorkspaceDetailPlaceholder', () => ({
  WorkspaceDetailPlaceholder: () => {
    env.placeholders += 1
    return null
  }
}))
vi.mock('../host-screen/HostScreen', () => ({ HostScreen: () => null }))
vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isWideLayout: env.wide })
}))
vi.mock('./MobileWebShellScreen', async () => {
  const React = await import('react')
  return {
    MobileWebShellScreen: (props: { route: { pathname: string }; hostArea?: boolean }) => {
      const pathname = props.route.pathname
      const hostArea = props.hostArea === true
      React.useEffect(() => {
        env.mounts.push({ event: 'mount', pathname, hostArea })
        return () => {
          env.mounts.push({ event: 'unmount', pathname, hostArea })
        }
      }, [pathname, hostArea])
      return null
    }
  }
})

import HostWorktreeRoute from '../../app/h/[hostId]/index'

const mounted: { tree: ReactTestRenderer | null } = { tree: null }

async function render(wide: boolean): Promise<void> {
  env.wide = wide
  await act(async () => {
    if (mounted.tree === null) {
      mounted.tree = create(<HostWorktreeRoute />)
    } else {
      mounted.tree.update(<HostWorktreeRoute />)
    }
  })
}

beforeEach(() => {
  env.storage.clear()
  env.mounts.length = 0
  env.placeholders = 0
  mounted.tree = null
  Object.assign(globalThis, { __DEV__: true })
  env.storage.set('orca:mobileWebShellEnabled', 'true')
})

describe('the host route across a layout-class change', () => {
  it('swaps the host-area session for the phone list and back, one at a time', async () => {
    await render(true)
    await render(false)
    await render(true)
    expect(env.mounts).toEqual([
      { event: 'mount', pathname: '/h/host-1', hostArea: true },
      { event: 'unmount', pathname: '/h/host-1', hostArea: true },
      { event: 'mount', pathname: '/h/host-1', hostArea: false },
      { event: 'unmount', pathname: '/h/host-1', hostArea: false },
      { event: 'mount', pathname: '/h/host-1', hostArea: true }
    ])
    act(() => mounted.tree?.unmount())
  })

  it('stays the native placeholder on a wide layout with the flag off', async () => {
    env.storage.set('orca:mobileWebShellEnabled', 'false')
    await render(true)
    expect(env.mounts).toEqual([])
    expect(env.placeholders).toBeGreaterThan(0)
    act(() => mounted.tree?.unmount())
  })
})
