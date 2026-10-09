import { useEffect, useSyncExternalStore } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { MobileWebShellSessionState } from './mobile-web-shell-session-contract'

/** Who draws a wide host area, learned from the bundle and kept per host so a relaunch does not flash. */
export type HostAreaOwner = 'page' | 'native'

const KEY_PREFIX = 'orca:hostAreaOwner:'

const owners = new Map<string, HostAreaOwner>()
const loading = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()

function publish(): void {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function load(hostId: string): void {
  if (hostId === '' || owners.has(hostId) || loading.has(hostId)) {
    return
  }
  const read = AsyncStorage.getItem(KEY_PREFIX + hostId)
    .then((raw) => (raw === 'page' ? 'page' : 'native'))
    .catch((): HostAreaOwner => 'native')
    .then((owner) => {
      loading.delete(hostId)
      // A session that decided while the read was in flight knows better than the disk.
      if (!owners.has(hostId)) {
        owners.set(hostId, owner)
        publish()
      }
    })
  loading.set(hostId, read)
}

/** The recorded owner, or null while the stored record is still being read. No record is native. */
export function useHostAreaOwner(hostId: string): HostAreaOwner | null {
  useEffect(() => {
    load(hostId)
  }, [hostId])
  return useSyncExternalStore(subscribe, () => owners.get(hostId) ?? null)
}

export function recordHostAreaOwner(hostId: string, owner: HostAreaOwner): void {
  if (owners.get(hostId) === owner) {
    return
  }
  owners.set(hostId, owner)
  publish()
  void AsyncStorage.setItem(KEY_PREFIX + hostId, owner).catch(() => undefined)
}

/** From `fetching` on, so the native sidebar is gone before the page can paint its own. */
export function hostAreaOwnerOf(state: MobileWebShellSessionState['kind']): HostAreaOwner | null {
  switch (state) {
    case 'fetching':
    case 'activating':
    case 'ready':
      return 'page'
    case 'native-route':
      return 'native'
    default:
      return null
  }
}

export function useRecordedHostAreaOwner(
  hostId: string | null,
  state: MobileWebShellSessionState['kind']
): void {
  const owner = hostAreaOwnerOf(state)
  useEffect(() => {
    if (hostId !== null && owner !== null) {
      recordHostAreaOwner(hostId, owner)
    }
  }, [hostId, owner])
}

/** A removed host's record goes with it, so a re-pair learns its owner again. */
export function forgetHostAreaOwner(hostId: string): Promise<void> {
  owners.delete(hostId)
  publish()
  return AsyncStorage.removeItem(KEY_PREFIX + hostId)
}

/** Test seam: the process-wide record starts empty for each case. */
export function resetHostAreaOwnersForTests(): void {
  owners.clear()
  loading.clear()
  publish()
}
