/**
 * The per-workspace keys inside the host-area page, which reaches every workspace of its host
 * in-page rather than being opened for one.
 *
 * The page must read and write them exactly as a session page opened for that workspace does:
 * `orca:nativeChatTabs:<host>:<worktree>` (which tabs show the chat) and
 * `orca:terminalLiveInputDisabled:<host>:<worktree>` (the handles typing goes around). They are the
 * only workspace-scoped keys in `page-storage-keys.ts`; the files, review and source-control routes
 * carry none.
 */
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => new Map<string, string>())

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getAllKeys: async () => [...store.keys()],
    multiGet: async (keys: readonly string[]) => keys.map((key) => [key, store.get(key) ?? null]),
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: async (key: string) => {
      store.delete(key)
    }
  }
}))
vi.mock('../transport/host-store', () => ({
  loadHosts: async () => [{ id: 'host-1', name: 'Host', endpoint: 'ws://h', lastConnected: 1 }]
}))

import { usePageHostSnapshot, type PageHostSnapshotView } from './use-page-host-snapshot'
import { createFakeBridgePortPair } from './bridge/bridge-port-pair-test-harness'
import pageAsyncStorage, { publishPageStorage } from './bridge/page-async-storage'

const CHAT_TABS = 'orca:nativeChatTabs:host-1:wt-1'
const LIVE_INPUT = 'orca:terminalLiveInputDisabled:host-1:wt-1'
const OTHER_HOST = 'orca:nativeChatTabs:host-2:wt-1'
const WORKSPACE_KEYS = [CHAT_TABS, LIVE_INPUT]

async function snapshotFor(routePathname: string, hostArea: boolean) {
  const held: { view: PageHostSnapshotView | null } = { view: null }
  function Probe() {
    held.view = usePageHostSnapshot('host-1', routePathname, hostArea)
    return null
  }
  await act(async () => {
    create(<Probe />)
  })
  await act(async () => {})
  if (held.view === null) {
    throw new Error('nothing mounted')
  }
  return held.view
}

beforeEach(() => {
  store.clear()
  store.set(CHAT_TABS, '["tab-1"]')
  store.set(LIVE_INPUT, '["handle-1"]')
  store.set(OTHER_HOST, '["tab-9"]')
})

describe('the per-workspace keys of a host-area page', () => {
  it("reaches init with each stored key of this host's workspaces, as a session page does", async () => {
    const perRoute = (await snapshotFor('/h/host-1/session/wt-1', false)).readStorage().storage
    const hostArea = (await snapshotFor('/h/host-1', true)).readStorage().storage
    for (const key of WORKSPACE_KEYS) {
      expect(hostArea[key], key).toBe(perRoute[key])
      expect(hostArea[key], key).toBeDefined()
    }
    expect(hostArea[OTHER_HOST]).toBeUndefined()
    // A phone's host list is opened for no workspace and is handed none.
    const phoneList = (await snapshotFor('/h/host-1', false)).readStorage().storage
    expect(WORKSPACE_KEYS.filter((key) => key in phoneList)).toEqual([])
  })

  it("reads them back on the page, and writes them through the bridge to this host's store", async () => {
    const pair = createFakeBridgePortPair({
      route: { pathname: '/h/host-1' },
      ownsHostArea: true,
      storage: { [CHAT_TABS]: '["tab-1"]', [LIVE_INPUT]: '["handle-1"]' }
    })
    await pair.flush()
    const session = pair.client.getShellSession()
    if (session === null) {
      throw new Error('no init')
    }
    publishPageStorage(
      session.storage,
      (key, value) => pair.client.notifyStorageWrite(key, value),
      'host-a',
      '/h/host-a',
      session.storageOversize,
      session.ownsHostArea
    )
    expect(await pageAsyncStorage.getItem(CHAT_TABS)).toBe('["tab-1"]')
    // Any workspace of this host, opened in-page: a key the shell never had a value for included.
    const fresh = 'orca:terminalLiveInputDisabled:host-a:wt-2'
    for (const key of ['orca:nativeChatTabs:host-a:wt-1', fresh]) {
      await pageAsyncStorage.setItem(key, '["x"]')
    }
    await pageAsyncStorage.setItem('orca:nativeChatTabs:host-b:wt-1', '["x"]')
    await pair.flush()
    expect(pair.storageWrites.map((write) => write.key)).toEqual([
      'orca:nativeChatTabs:host-a:wt-1',
      fresh
    ])
    expect(await pageAsyncStorage.getItem(fresh)).toBe('["x"]')
  })

  it('refuses the same writes from a page that does not own the host area', async () => {
    const pair = createFakeBridgePortPair({ route: { pathname: '/h/host-a' } })
    await pair.flush()
    pair.client.notifyStorageWrite('orca:nativeChatTabs:host-a:wt-1', '["x"]')
    await pair.flush()
    expect(pair.storageWrites).toEqual([])
  })

  it('applies a write the shell takes to what the next init carries', async () => {
    const view = await snapshotFor('/h/host-1', true)
    const key = 'orca:nativeChatTabs:host-1:wt-3'
    view.writeStorage(key, '["tab-3"]')
    expect(view.readStorage().storage[key]).toBe('["tab-3"]')
    view.writeStorage('orca:nativeChatTabs:host-2:wt-3', '["no"]')
    expect(store.get('orca:nativeChatTabs:host-2:wt-3')).toBeUndefined()
  })
})
