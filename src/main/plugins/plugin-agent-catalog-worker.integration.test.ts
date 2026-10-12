import { readFile, rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pluginManifestSchema } from '../../shared/plugins/plugin-manifest'
import { buildTypedAgentLaunchCatalog } from '../../shared/typed-agent-launch-catalog'
import { checkTypedTerminalLaunchChoice } from '../runtime/rpc/methods/terminal-typed-launch-check'
import { bindPluginHostServices } from './plugin-host-service-bindings'
import { executePluginHostCall } from './plugin-host-methods'
import { PluginWorkerManager } from './plugin-worker-manager'

const FIXTURE_ROOT = join(process.cwd(), 'examples', 'plugins', 'agent-catalog')
const PROFILE = join(tmpdir(), 'orca-agent-catalog-profile')
let bundleRoot = ''
let hostEntryPath = ''
let manager: PluginWorkerManager | null = null
let previousProfile: string | undefined

beforeAll(async () => {
  previousProfile = process.env.ORCA_USER_DATA_PATH
  process.env.ORCA_USER_DATA_PATH = PROFILE
  bundleRoot = await mkdtemp(join(tmpdir(), 'orca-agent-catalog-host-'))
  hostEntryPath = join(bundleRoot, 'plugin-host-entry.cjs')
  await build({
    entryPoints: [join(process.cwd(), 'src', 'main', 'plugins', 'plugin-host-entry.ts')],
    outfile: hostEntryPath,
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    logLevel: 'silent'
  })
}, 30_000)

afterAll(async () => {
  await manager?.disposeAll()
  if (previousProfile === undefined) {
    delete process.env.ORCA_USER_DATA_PATH
  } else {
    process.env.ORCA_USER_DATA_PATH = previousProfile
  }
  await rm(bundleRoot, { recursive: true, force: true })
})

describe('agent catalog through a real plugin worker', () => {
  it('reads, checks and targets the hosting profile from the fixture worker', async () => {
    const manifest = pluginManifestSchema.parse(
      JSON.parse(await readFile(join(FIXTURE_ROOT, 'orca-plugin.json'), 'utf8'))
    )
    const services = bindPluginHostServices({
      delegate: {
        resolveActiveWorktreeContext: vi.fn().mockResolvedValue(null),
        listTerminals: vi.fn().mockResolvedValue({ terminals: [] }),
        sendTerminal: vi.fn().mockResolvedValue({ accepted: true }),
        dispatchPluginNotification: vi.fn().mockResolvedValue({ delivered: true })
      },
      pluginsDataDir: bundleRoot,
      subscribeEvents: () => []
    })
    manager = new PluginWorkerManager({
      entryPath: hostEntryPath,
      executeHostCall: (pluginId, method, params) =>
        executePluginHostCall({
          pluginId,
          method,
          params,
          viaPanel: false,
          grantedCapabilities: manifest.capabilities.map((capability) => capability.kind),
          services
        }),
      log: () => () => undefined,
      onWorkerStateChange: () => undefined,
      onWorkerGone: () => undefined
    })
    const worker = await manager.ensureActive({
      pluginKey: 'orca-samples.agent-catalog',
      rootDir: FIXTURE_ROOT,
      mainEntry: manifest.main ?? '',
      grantedCapabilities: manifest.capabilities.map((capability) => capability.kind)
    })

    await expect(worker.invokeCommand('catalog')).resolves.toEqual(buildTypedAgentLaunchCatalog())
    const choice = { agent: 'codex', model: 'gpt-5.5', effort: 'ultra' }
    await expect(worker.invokeCommand('check', choice)).resolves.toEqual(
      checkTypedTerminalLaunchChoice(choice)
    )
    await expect(worker.invokeCommand('check', choice)).resolves.toMatchObject({ valid: false })
    await expect(worker.invokeCommand('profile')).resolves.toEqual({ userDataPath: PROFILE })
  }, 30_000)
})
