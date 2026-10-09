/**
 * The per-workspace keys inside the host-area page, which reaches every workspace of its host
 * in-page rather than being opened for one.
 *
 * The page must read and write them exactly as a session page opened for that workspace does:
 * `orca:nativeChatTabs:<host>:<worktree>` (which tabs show the chat) and
 * `orca:terminalLiveInputDisabled:<host>:<worktree>` (the handles typing goes around). They are the
 * only workspace-scoped keys in `page-storage-keys.ts`; `init` carries none of them for this page,
 * which reads each from the shell when it opens that workspace.
 */
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => new Map<string, string>())

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
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
  loadHosts: async () => [{ id: 'host-a', name: 'Host', endpoint: 'ws://h', lastConnected: 1 }]
}))

import { usePageHostSnapshot, type PageHostSnapshotView } from './use-page-host-snapshot'
import { createFakeBridgePortPair } from './bridge/bridge-port-pair-test-harness'
import { storageReadParamsSchema, storageReadResultSchema } from './bridge/bridge-native-verbs'
import pageAsyncStorage, { publishPageStorage } from './bridge/page-async-storage'
import { MOBILE_WEB_SHELL_GRANTS } from './page-route-policy'

const CHAT_TABS = 'orca:nativeChatTabs:host-a:wt-1'
const LIVE_INPUT = 'orca:terminalLiveInputDisabled:host-a:wt-1'
const NEVER_STORED = 'orca:nativeChatTabs:host-a:wt-2'
const OTHER_HOST = 'orca:nativeChatTabs:host-b:wt-1'

async function snapshotFor(routePathname: string, hostArea: boolean) {
  const held: { view: PageHostSnapshotView | null } = { view: null }
  function Probe() {
    held.view = usePageHostSnapshot('host-a', routePathname, hostArea)
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

/** The shell as `MobileWebShellScreen` wires it, and the page as the web entry publishes it. */
async function hostAreaPage() {
  const view = await snapshotFor('/h/host-a', true)
  const pair = createFakeBridgePortPair({
    route: { pathname: '/h/host-a' },
    ownsHostArea: true,
    routeGrants: MOBILE_WEB_SHELL_GRANTS,
    storage: view.readStorage().storage,
    serveNativeVerb: async (verb, params) =>
      verb === 'native.storage.read'
        ? { value: await view.readWorkspaceKey(storageReadParamsSchema.parse(params).key) }
        : {}
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
      ? async (key) =>
          storageReadResultSchema.parse(
            (await pair.client.callNativeVerb('native.storage.read', { key })).result
          ).value
      : null
  )
  // Reads settle over the pair's lanes, which drain on a later tick.
  const settled = async <T,>(read: Promise<T>): Promise<T> => {
    await pair.flush()
    return read
  }
  // The shell applies each write the page posts, as the screen's `onStorageWrite` does.
  const applyWrites = async () => {
    await pair.flush()
    for (const { key, value } of pair.storageWrites.splice(0)) {
      view.writeStorage(key, value)
    }
  }
  return { view, pair, settled, applyWrites }
}

beforeEach(() => {
  store.clear()
  store.set(CHAT_TABS, '["tab-1"]')
  store.set(LIVE_INPUT, '["handle-1"]')
  store.set(OTHER_HOST, '["tab-9"]')
})

describe('the per-workspace keys of a host-area page', () => {
  it('reaches init with none of them, and reads each from the shell as a session page would', async () => {
    const perRoute = (await snapshotFor('/h/host-a/session/wt-1', false)).readStorage().storage
    const { view, settled } = await hostAreaPage()
    expect(Object.keys(view.readStorage().storage).filter((key) => key.includes(':host-'))).toEqual(
      []
    )
    for (const key of [CHAT_TABS, LIVE_INPUT]) {
      expect(perRoute[key], key).toBeDefined()
      expect(await settled(pageAsyncStorage.getItem(key)), key).toBe(perRoute[key])
    }
    expect(await settled(pageAsyncStorage.getItem(NEVER_STORED))).toBeNull()
  })

  it("writes both through the bridge to this host's store, a never-stored key included", async () => {
    const { settled, applyWrites } = await hostAreaPage()
    const fresh = 'orca:terminalLiveInputDisabled:host-a:wt-2'
    for (const key of [CHAT_TABS, NEVER_STORED, fresh]) {
      await pageAsyncStorage.setItem(key, '["x"]')
    }
    await applyWrites()
    for (const key of [CHAT_TABS, NEVER_STORED, fresh]) {
      expect(store.get(key), key).toBe('["x"]')
      expect(await settled(pageAsyncStorage.getItem(key)), key).toBe('["x"]')
    }
  })

  it("refuses another host's key, to read or to write", async () => {
    const { view, pair, settled, applyWrites } = await hostAreaPage()
    await pageAsyncStorage.setItem(OTHER_HOST, '["x"]')
    expect(pair.storageWrites).toEqual([])
    await applyWrites()
    expect(store.get(OTHER_HOST)).toBe('["tab-9"]')
    await expect(view.readWorkspaceKey(OTHER_HOST)).rejects.toThrow()
    // The page reads it from its own `init` map, which never held it.
    expect(await settled(pageAsyncStorage.getItem(OTHER_HOST))).toBeNull()
  })

  it('reads and writes none of them for a page that does not own the host area', async () => {
    const phoneList = await snapshotFor('/h/host-a', false)
    await expect(phoneList.readWorkspaceKey(CHAT_TABS)).rejects.toThrow()
    phoneList.writeStorage(CHAT_TABS, '["no"]')
    expect(store.get(CHAT_TABS)).toBe('["tab-1"]')
    const pair = createFakeBridgePortPair({ route: { pathname: '/h/host-a' } })
    await pair.flush()
    pair.client.notifyStorageWrite(CHAT_TABS, '["x"]')
    await pair.flush()
    expect(pair.storageWrites).toEqual([])
  })
})
