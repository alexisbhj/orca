import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { fingerprintPluginConsent } from '../../shared/plugins/plugin-consent-fingerprint'
import { pluginManifestSchema } from '../../shared/plugins/plugin-manifest'
import { PANEL_OPEN_EXTERNAL_CAPABILITY } from '../../shared/plugins/plugin-panel-bridge'
import { PluginService } from './plugin-service'
import { rendererPanelOwner } from './plugin-panel-sessions'

const roots: string[] = []
const services: PluginService[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const OWNER = rendererPanelOwner(7)
const URL_OK = 'https://github.com/alexisbhj/orca/issues/8'

async function harness(options: { capability?: boolean; opener?: boolean; owner?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'orca-panel-open-external-'))
  roots.push(root)
  const manifest = pluginManifestSchema.parse({
    manifestVersion: 1,
    id: 'demo',
    publisher: 'orca-samples',
    name: 'Demo',
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    contributes: {
      panels: [{ id: 'panel', title: 'Panel', entry: 'panel.html' }]
    },
    capabilities: options.capability === false ? [] : [{ kind: 'links:openExternal' }]
  })
  await writeFile(join(root, 'orca-plugin.json'), JSON.stringify(manifest))
  await writeFile(join(root, 'panel.html'), '<p>Fixture</p>')
  let approved = true
  const openExternalUrl = vi.fn(async (_url: string) => undefined)
  const service = new PluginService({
    userDataPath: root,
    hostVersion: '1.4.214',
    isPluginSystemEnabled: () => true,
    getDisabledPlugins: () => [],
    getDevPluginPaths: () => [root],
    getPluginConsents: (): Record<string, string> =>
      approved ? { 'orca-samples.demo': fingerprintPluginConsent(manifest) } : {},
    openExternalUrl: options.opener === false ? undefined : openExternalUrl
  })
  services.push(service)
  service.setRuntimeDelegate({
    resolveActiveWorktreeContext: async () => null,
    listTerminals: async () => ({ terminals: [] }),
    sendTerminal: async () => ({ accepted: false }),
    dispatchPluginNotification: async () => ({ delivered: false })
  })
  await service.initialize()
  const owner = options.owner ?? OWNER
  const entry = await service.panels.open(owner, 'orca-samples.demo', 'panel')
  expect(entry).not.toBeNull()
  const call = (params: unknown) =>
    service.panels.execute(owner, {
      sessionToken: entry!.sessionToken,
      action: 'openExternal',
      params
    })
  return {
    service,
    entry: entry!,
    call,
    openExternalUrl,
    revokeConsent: () => {
      approved = false
    }
  }
}

it('opens a consented https URL through the host opener of the displaying desktop', async () => {
  const { call, openExternalUrl, entry } = await harness()
  expect(entry.hostCapabilities).toEqual([PANEL_OPEN_EXTERNAL_CAPABILITY])
  await expect(call({ url: URL_OK })).resolves.toEqual({
    ok: true,
    value: { opened: true }
  })
  expect(openExternalUrl).toHaveBeenCalledExactlyOnceWith(URL_OK)
})

it('denies a plugin that did not declare the capability', async () => {
  const { call, openExternalUrl } = await harness({ capability: false })
  await expect(call({ url: URL_OK })).resolves.toMatchObject({
    ok: false,
    code: 'capability_denied'
  })
  expect(openExternalUrl).not.toHaveBeenCalled()
})

it('denies a plugin whose consent was withdrawn', async () => {
  const h = await harness()
  h.revokeConsent()
  await expect(h.call({ url: URL_OK })).resolves.toMatchObject({ ok: false })
  expect(h.openExternalUrl).not.toHaveBeenCalled()
})

it.each([
  ['file:///etc/passwd', 'only https: URLs are allowed'],
  ['javascript:alert(1)', 'only https: URLs are allowed'],
  ['https://user:pw@example.com', 'URL must not contain credentials']
])('refuses %s with an explicit bounded error', async (url, message) => {
  const { call, openExternalUrl } = await harness()
  const outcome = await call({ url })
  expect(outcome).toEqual({
    ok: false,
    code: 'invalid_params',
    error: `url: ${message}`
  })
  expect(openExternalUrl).not.toHaveBeenCalled()
})

it('refuses a URL that only exceeds the size limit once normalized as invalid_params', async () => {
  const { call, openExternalUrl } = await harness()
  await expect(call({ url: `https://example.com/${'"'.repeat(2020)}` })).resolves.toEqual({
    ok: false,
    code: 'invalid_params',
    error: 'url: URL exceeds 2048 characters once normalized'
  })
  expect(openExternalUrl).not.toHaveBeenCalled()
})

it('refuses identity or extra fields supplied by the panel', async () => {
  const { call, openExternalUrl } = await harness()
  await expect(call({ url: URL_OK, pluginKey: 'orca-samples.other' })).resolves.toMatchObject({
    ok: false,
    code: 'invalid_params'
  })
  expect(openExternalUrl).not.toHaveBeenCalled()
})

it('refuses after the panel session is invalidated', async () => {
  const { service, call, openExternalUrl } = await harness()
  service.panels.revokeOwner(OWNER)
  await expect(call({ url: URL_OK })).resolves.toMatchObject({ ok: false })
  expect(openExternalUrl).not.toHaveBeenCalled()
})

it('refuses a session revoked while the audit intent is being written', async () => {
  const { service, call, openExternalUrl } = await harness()
  const pending = call({ url: URL_OK })
  service.panels.revokeOwner(OWNER)
  await expect(pending).resolves.toMatchObject({ ok: false })
  expect(openExternalUrl).not.toHaveBeenCalled()
})

it('bounds bursts of openings per plugin and recovers after the window', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const { call, openExternalUrl } = await harness()
  for (let i = 0; i < 3; i++) {
    await expect(call({ url: `${URL_OK}?n=${i}` })).resolves.toMatchObject({
      ok: true
    })
  }
  await expect(call({ url: URL_OK })).resolves.toMatchObject({
    ok: false,
    code: 'rate_limited'
  })
  expect(openExternalUrl).toHaveBeenCalledTimes(3)
  vi.setSystemTime(Date.now() + 10_001)
  await expect(call({ url: URL_OK })).resolves.toMatchObject({ ok: true })
})

it('keeps the 64 KiB panel message budget', async () => {
  const { call, openExternalUrl } = await harness()
  await expect(call({ url: `https://example.com/${'a'.repeat(70_000)}` })).resolves.toMatchObject({
    ok: false,
    code: 'invalid_request'
  })
  expect(openExternalUrl).not.toHaveBeenCalled()
})

it('answers unavailable without effect on a current host built without a link opener', async () => {
  const { call, entry } = await harness({ opener: false })
  expect(entry.hostCapabilities).toEqual([])
  await expect(call({ url: URL_OK })).resolves.toMatchObject({
    ok: false,
    code: 'unavailable'
  })
})

it('never opens on the execution host for a panel displayed by a paired client', async () => {
  const { call, openExternalUrl, entry } = await harness({
    owner: 'runtime:connection-1'
  })
  expect(entry.hostCapabilities).toEqual([])
  await expect(call({ url: URL_OK })).resolves.toMatchObject({
    ok: false,
    code: 'unavailable'
  })
  expect(openExternalUrl).not.toHaveBeenCalled()
})

it('is not available to workers, which have no displaying client', async () => {
  const { service, openExternalUrl } = await harness()
  await expect(
    service.executeHostCall(
      'orca-samples.demo',
      'openExternal',
      { url: URL_OK },
      {
        viaPanel: false
      }
    )
  ).resolves.toMatchObject({ ok: false, code: 'unavailable' })
  expect(openExternalUrl).not.toHaveBeenCalled()
})
