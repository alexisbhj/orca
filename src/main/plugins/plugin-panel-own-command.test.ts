import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { fingerprintPluginConsent } from '../../shared/plugins/plugin-consent-fingerprint'
import { pluginManifestSchema } from '../../shared/plugins/plugin-manifest'
import { PluginService } from './plugin-service'

const roots: string[] = []
const services: PluginService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function harness(activation?: Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'orca-panel-command-'))
  roots.push(root)
  const manifest = pluginManifestSchema.parse({
    manifestVersion: 1,
    id: 'demo',
    publisher: 'orca-samples',
    name: 'Demo',
    version: '1.0.0',
    engines: { orca: '>=1.0.0' },
    pluginApi: 1,
    main: 'worker.js',
    contributes: {
      panels: [{ id: 'panel', title: 'Panel', entry: 'panel.html' }],
      commands: [
        { id: 'echo', title: 'Echo' },
        { id: 'missing', title: 'Missing' }
      ]
    },
    capabilities: [{ kind: 'commands:invokeOwn' }]
  })
  await writeFile(join(root, 'orca-plugin.json'), JSON.stringify(manifest))
  await writeFile(join(root, 'panel.html'), '<p>Fixture</p>')
  await writeFile(join(root, 'worker.js'), 'export default async function () {}')
  let approved = true
  let enabled = true
  const invoke = vi.fn(async (_command: string, args: unknown): Promise<unknown> => args)
  let markActivating!: () => void
  const activating = new Promise<void>((resolve) => {
    markActivating = resolve
  })
  const service = new PluginService({
    userDataPath: root,
    hostVersion: '1.4.214',
    isPluginSystemEnabled: () => enabled,
    getDisabledPlugins: () => [],
    getDevPluginPaths: () => [root],
    getPluginConsents: (): Record<string, string> =>
      approved ? { 'orca-samples.demo': fingerprintPluginConsent(manifest) } : {},
    workerFactory: async () => {
      markActivating()
      await activation
      return {
        commands: ['echo'],
        invokeCommand: invoke,
        deliverEvent: () => undefined,
        lastActivityAt: () => Date.now(),
        inFlightCount: () => 0,
        dispose: async () => undefined,
        kill: () => undefined,
        onExit: () => undefined
      }
    }
  })
  services.push(service)
  service.setRuntimeDelegate({
    resolveActiveWorktreeContext: async () => null,
    listTerminals: async () => ({ terminals: [] }),
    sendTerminal: async () => ({ accepted: false }),
    dispatchPluginNotification: async () => ({ delivered: false })
  })
  await service.initialize()
  const entry = await service.panels.open('owner', 'orca-samples.demo', 'panel')
  expect(entry).not.toBeNull()
  const call = (params: unknown) =>
    service.panels.execute('owner', {
      sessionToken: entry!.sessionToken,
      action: 'invokeOwnCommand',
      params
    })
  return {
    service,
    activating,
    call,
    invoke,
    revokeConsent: () => {
      approved = false
    },
    disable: () => {
      enabled = false
    }
  }
}

it('a consented panel invokes its declared worker command and receives JSON', async () => {
  const { call } = await harness()
  await expect(call({ commandId: 'echo', args: { answer: 42 } })).resolves.toEqual({
    ok: true,
    value: { answer: 42 }
  })
})

it('rejects foreign identity, undeclared commands and missing handlers', async () => {
  const { call, invoke } = await harness()
  await expect(call({ pluginKey: 'orca-samples.other', commandId: 'echo' })).resolves.toMatchObject(
    { ok: false, code: 'invalid_params' }
  )
  await expect(call({ commandId: 'foreign' })).resolves.toMatchObject({
    ok: false,
    code: 'action_failed'
  })
  await expect(call({ commandId: 'missing' })).resolves.toMatchObject({
    ok: false,
    code: 'action_failed'
  })
  expect(invoke).not.toHaveBeenCalled()
})

it.each(['consent', 'disabled', 'session'] as const)('rejects a revoked %s', async (reason) => {
  const h = await harness()
  if (reason === 'consent') {
    h.revokeConsent()
  }
  if (reason === 'disabled') {
    h.disable()
  }
  if (reason === 'session') {
    h.service.panels.revokeOwner('owner')
  }
  await expect(h.call({ commandId: 'echo', args: null })).resolves.toMatchObject({ ok: false })
  expect(h.invoke).not.toHaveBeenCalled()
})

it('returns bounded failures for oversized and non-JSON worker results', async () => {
  const { call, invoke } = await harness()
  invoke.mockResolvedValueOnce('x'.repeat(70_000))
  await expect(call({ commandId: 'echo' })).resolves.toMatchObject({
    ok: false,
    code: 'action_failed'
  })
  invoke.mockRejectedValueOnce(new Error('x'.repeat(70_000)))
  const failure = await call({ commandId: 'echo' })
  expect(failure.ok).toBe(false)
  if (!failure.ok) {
    expect(failure.error.length).toBeLessThanOrEqual(1024)
  }
  invoke.mockResolvedValueOnce(new Date())
  await expect(call({ commandId: 'echo' })).resolves.toMatchObject({
    ok: false,
    code: 'action_failed'
  })
})

it('rejects cyclic arguments before worker execution', async () => {
  const { call, invoke } = await harness()
  const args: Record<string, unknown> = {}
  args.self = args
  await expect(call({ commandId: 'echo', args })).resolves.toMatchObject({
    ok: false,
    code: 'invalid_params'
  })
  expect(invoke).not.toHaveBeenCalled()
})

it('rejects a session revoked while waiting for the audit write', async () => {
  const { service, call, invoke } = await harness()
  const pending = call({ commandId: 'echo', args: 'too late' })
  service.panels.revokeOwner('owner')
  await expect(pending).resolves.toMatchObject({ ok: false })
  expect(invoke).not.toHaveBeenCalled()
})

it('does not invoke after the owner disconnects during worker activation', async () => {
  let finish!: () => void
  const activation = new Promise<void>((resolve) => {
    finish = resolve
  })
  const { service, call, invoke, activating } = await harness(activation)
  const pending = call({ commandId: 'echo', args: null })
  await activating
  service.panels.revokeOwner('owner')
  finish()
  await expect(pending).resolves.toMatchObject({ ok: false })
  expect(invoke).not.toHaveBeenCalled()
})

it('retains the per-plugin message size and rate limits', async () => {
  const { call, invoke } = await harness()
  await expect(call({ commandId: 'echo', args: 'x'.repeat(65_536) })).resolves.toMatchObject({
    ok: false,
    code: 'invalid_request'
  })
  for (let i = 0; i < 29; i++) {
    await expect(call({ commandId: 'echo', args: i })).resolves.toMatchObject({ ok: true })
  }
  await expect(call({ commandId: 'echo', args: 'over budget' })).resolves.toMatchObject({
    ok: false,
    code: 'rate_limited'
  })
  expect(invoke).toHaveBeenCalledTimes(29)
})
