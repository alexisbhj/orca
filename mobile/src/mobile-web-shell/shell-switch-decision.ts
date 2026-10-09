import { useResponsiveLayout } from '../layout/responsive-layout'
import type { BridgeInitRoute } from './bridge/bridge-init-route'
import { useHostAreaOwner, type HostAreaOwner } from './host-area-owner'
import { useMobileWebShellEnabled } from './use-mobile-web-shell-enabled'

/**
 * Which renderer a hybrid-shell route switch mounts, once that is knowable.
 *
 * `pending` is the third answer every switch was missing. Where the flag can be on it is read from
 * storage after the first render, so `null` is a window every switch passes through, and each one
 * used to spend it on the native screen: a flag-on user watched the native screen mount, subscribe
 * and paint, then be torn down and replaced by the page. One decision here so a switch cannot hold
 * a private opinion about `null`, and so the flag keeps exactly one reader — which is what makes
 * the census beside this file total rather than a list somebody remembers to extend.
 *
 * `pending` is unreachable on a build that cannot have the flag on: the hook starts at `false`
 * there, so a store build commits its native renderer on frame one and pays nothing for a neutral
 * state it could never have used.
 *
 * A route the shell could never open is answered `native` without waiting: the flag cannot change
 * that outcome, and a neutral frame in front of a decided one is a flash this file exists to remove.
 */
export type ShellSwitchDecision =
  | { readonly kind: 'pending' }
  | { readonly kind: 'native' }
  | { readonly kind: 'shell'; readonly route: BridgeInitRoute }

/** `wideOwner` is undefined off a wide layout; on one, only a page that owns the host area serves a
 *  detail route, since an older page beside the native sidebar would draw a second one. */
export function shellSwitchDecision(
  enabled: boolean | null,
  route: BridgeInitRoute | null,
  wideOwner?: HostAreaOwner | null
): ShellSwitchDecision {
  if (route === null) {
    return { kind: 'native' }
  }
  if (enabled === null) {
    return { kind: 'pending' }
  }
  if (!enabled || wideOwner === 'native') {
    return { kind: 'native' }
  }
  return wideOwner === null ? { kind: 'pending' } : { kind: 'shell', route }
}

/** The host a switch's route names: every switch route is `/h/<encoded host>/...`. */
function routeHostId(route: BridgeInitRoute | null): string {
  const segment = route?.pathname.split('/')[2] ?? ''
  try {
    return decodeURIComponent(segment)
  } catch {
    return ''
  }
}

/** The route is `null` when this switch's params name no screen the shell could open. */
export function useShellSwitchDecision(route: BridgeInitRoute | null): ShellSwitchDecision {
  const enabled = useMobileWebShellEnabled()
  const { isWideLayout } = useResponsiveLayout()
  // A phone never reads the record: no owner is consulted off a wide layout.
  const owner = useHostAreaOwner(isWideLayout ? routeHostId(route) : '')
  return shellSwitchDecision(enabled, route, isWideLayout ? owner : undefined)
}

/** `host-area` mounts the host session, which learns from its bundle who owns the area. */
export type WideHostAreaDecision = 'pending' | 'native' | 'host-area'

export function wideHostAreaDecision(enabled: boolean | null): WideHostAreaDecision {
  if (enabled === null) {
    return 'pending'
  }
  return enabled ? 'host-area' : 'native'
}

export function useWideHostAreaDecision(): WideHostAreaDecision {
  return wideHostAreaDecision(useMobileWebShellEnabled())
}

/** Not while the page owns the area, nor while either fact is being read: never two sidebars. */
export function nativeHostSidebarShown(
  enabled: boolean | null,
  owner: HostAreaOwner | null
): boolean {
  return enabled === false || (enabled === true && owner === 'native')
}

export function useNativeHostSidebar(hostId: string): boolean {
  const enabled = useMobileWebShellEnabled()
  return nativeHostSidebarShown(enabled, useHostAreaOwner(hostId))
}
