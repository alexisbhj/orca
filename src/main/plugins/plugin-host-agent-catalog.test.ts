import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { typedAgentLaunchCatalogSchema } from '../../shared/typed-agent-launch-catalog'
import { pluginManifestSchema } from '../../shared/plugins/plugin-manifest'
import { bindPluginHostServices, type PluginRuntimeDelegate } from './plugin-host-service-bindings'
import { executePluginHostCall, type PluginHostServices } from './plugin-host-methods'

const PLUGIN_ID = 'orca-samples.agent-catalog'

function hostServices(): PluginHostServices {
  const delegate: PluginRuntimeDelegate = {
    resolveActiveWorktreeContext: vi.fn().mockResolvedValue(null),
    listTerminals: vi.fn().mockResolvedValue({ terminals: [] }),
    sendTerminal: vi.fn().mockResolvedValue({ accepted: true }),
    dispatchPluginNotification: vi.fn().mockResolvedValue({ delivered: true })
  }
  return bindPluginHostServices({
    delegate,
    pluginsDataDir: join(tmpdir(), 'orca-agent-catalog-test'),
    subscribeEvents: () => []
  })
}

const call = (
  method: string,
  params: unknown,
  overrides: Partial<Parameters<typeof executePluginHostCall>[0]> = {}
) =>
  executePluginHostCall({
    pluginId: PLUGIN_ID,
    method,
    params,
    viaPanel: false,
    grantedCapabilities: ['agents:read'],
    services: hostServices(),
    ...overrides
  })

describe('worker agent launch catalog', () => {
  it('reads a versioned catalog for the agents terminal.createTyped launches', async () => {
    const outcome = await call('agents.readCatalog', {})
    expect(outcome).toMatchObject({ ok: true, value: { version: 1, accountAccessVerified: false } })
    if (!outcome.ok) {
      return
    }
    const value = typedAgentLaunchCatalogSchema.parse(outcome.value)
    expect(value.agents.map((agent) => agent.id)).toEqual(['codex', 'claude'])
    const codex = value.agents[0]
    expect(codex?.modelSelection).toBe(true)
    expect(codex?.defaultModel).toEqual({ id: null, source: 'agent-config' })
    expect(codex?.models.find((model) => model.id === 'gpt-5.5')?.efforts.map((e) => e.id)).toEqual(
      ['minimal', 'low', 'medium', 'high', 'xhigh']
    )
    // Why: Codex access depends on the account, so free ids are explicit, not hidden.
    expect(codex?.customModels).toMatchObject({ accepted: true, maxLength: 512 })
    expect(
      codex?.customModels.accepted ? codex.customModels.efforts.map((e) => e.id) : []
    ).toContain('ultra')
    const claude = value.agents[1]
    expect(claude?.models.find((model) => model.id === 'haiku')?.efforts).toEqual([])
    expect(Buffer.byteLength(JSON.stringify(value), 'utf8')).toBeLessThan(64 * 1024)
  })

  it('checks a valid choice without launching anything', async () => {
    const services = hostServices()
    const outcome = await call(
      'agents.checkLaunch',
      { agent: 'claude', model: 'opus', effort: 'max' },
      { services }
    )
    expect(outcome).toEqual({
      ok: true,
      value: { valid: true, choice: { agent: 'claude', model: 'opus', effort: 'max' } }
    })
  })

  it('reports a refused choice with the terminal.createTyped code and wording', async () => {
    await expect(call('agents.checkLaunch', { agent: 'codex', effort: 'high' })).resolves.toEqual({
      ok: true,
      value: { valid: false, code: 'invalid_argument', message: '--effort requires --model.' }
    })
    await expect(call('agents.checkLaunch', { agent: 'gemini' })).resolves.toMatchObject({
      ok: true,
      value: { valid: false, code: 'invalid_argument' }
    })
  })

  it('requires the declared capability and stays off the panel bridge', async () => {
    await expect(
      call('agents.readCatalog', {}, { grantedCapabilities: ['storage'] })
    ).resolves.toMatchObject({ ok: false, code: 'capability_denied' })
    await expect(call('agents.readCatalog', {}, { viaPanel: true })).resolves.toMatchObject({
      ok: false,
      code: 'panel_forbidden'
    })
    await expect(
      call('agents.checkLaunch', { agent: 'codex', prompt: 'x' })
    ).resolves.toMatchObject({ ok: false, code: 'invalid_params' })
  })

  it('answers unavailable where no typed launcher binds the catalog', async () => {
    const { agentLaunchCatalog: _omitted, ...services } = hostServices()
    await expect(call('agents.readCatalog', {}, { services })).resolves.toMatchObject({
      ok: false,
      code: 'unavailable'
    })
  })

  it('is unsupported on a host that predates the method', async () => {
    await expect(call('agents.listModels', {})).resolves.toMatchObject({
      ok: false,
      code: 'unknown_method'
    })
  })

  it('accepts agents:read in a manifest', () => {
    const parsed = pluginManifestSchema.safeParse({
      manifestVersion: 1,
      id: 'agent-catalog',
      publisher: 'orca-samples',
      name: 'Agent catalog',
      version: '1.0.0',
      engines: { orca: '>=1.4.0' },
      pluginApi: 1,
      main: 'worker.js',
      capabilities: [{ kind: 'agents:read' }]
    })
    expect(parsed.success ? null : parsed.error.issues).toBeNull()
  })
})
