import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../shared/agent-session-record.test-fixture'
import type { AgentModelCatalogSuccess } from '../native-chat/agent-model-catalog/agent-model-catalog-store'
import type * as CatalogStoreModule from '../native-chat/agent-model-catalog/agent-model-catalog-store'
import {
  agentModelCatalogStore,
  AGENT_MODEL_CATALOG_FRESH_MS
} from '../native-chat/agent-model-catalog/agent-model-catalog-store'
import { agentModelCatalogFingerprint } from '../native-chat/agent-model-catalog/agent-model-catalog-fingerprint'
import { claudeAndCodexAgents } from '../native-chat/agent-session-wire/structured-agent-session-adapter-router-test-support'
import { modelCatalogHostDeps } from './structured-agent-model-catalog-wiring'

const clock = vi.hoisted(() => ({ now: 1_000 }))
vi.mock('../native-chat/agent-model-catalog/agent-model-catalog-store', async (importOriginal) => {
  const actual = await importOriginal<typeof CatalogStoreModule>()
  return {
    ...actual,
    agentModelCatalogStore: new actual.AgentModelCatalogStore({ now: () => clock.now })
  }
})

const SAVED_MODEL = {
  id: 'sonnet',
  label: 'Remembered model',
  description: 'Remembered description',
  isDefault: true,
  efforts: [
    { value: 'low', label: 'Low' },
    { value: 'high', label: 'High' }
  ],
  defaultEffort: 'high',
  supportsFastMode: false
}

let nextAccount = 0
async function hostCatalog(input: {
  agent?: 'claude' | 'codex'
  origin?: AgentModelCatalogSuccess['origin']
  stale?: boolean
  session?: boolean
  model?: string
  fastSupported?: boolean
}) {
  const agent = input.agent ?? 'claude'
  const home = {
    variable: agent === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
    path: `/accounts/catalog-test-${++nextAccount}`
  }
  const record = agentSessionRecordFixture(
    agentSessionLeaseFixture({ claimStatus: 'released', ownerProcess: null })
  )
  record.provider = agent
  record.accountHome = home
  record.location.workspaceKind = 'folder'
  record.options = input.model ? { model: input.model } : {}
  const fingerprint = agentModelCatalogFingerprint({ agent, accountHome: home, wslDistro: null })
  const saved: AgentModelCatalogSuccess = {
    models: [{ ...SAVED_MODEL, supportsFastMode: input.fastSupported ?? false }],
    fastModeSupport: { supported: input.fastSupported ?? false },
    fastModeTierByModel: new Map(),
    origin: input.origin ?? 'probe'
  }
  agentModelCatalogStore.recordSuccess(fingerprint, agent, saved)
  const fetchedAt = clock.now
  if (input.stale) {
    clock.now += AGENT_MODEL_CATALOG_FRESH_MS
    const failedProbe = async () => {
      throw new Error('temporarily unavailable')
    }
    await agentModelCatalogStore.refresh(fingerprint, agent, failedProbe, failedProbe)
    expect(agentModelCatalogStore.hasActiveFailure(fingerprint)).toBe(true)
  }
  vi.spyOn(agentModelCatalogStore, 'attachPersistence').mockResolvedValue()
  const resolveEnvironment = vi.fn(async () => {
    throw new Error('a saved catalog read must not launch an agent')
  })
  const { modelCatalog } = await modelCatalogHostDeps({
    store: { getRecord: () => (input.session ? record : null) },
    agents: claudeAndCodexAgents(),
    deps: {
      stateDirectory: '/unused/catalog-test-state',
      resolveAgentAccountHome: async () => home,
      resolveClaudeAuthPolicy: () => ({ stripAuthEnv: true })
    },
    envResolvers: {
      resolveCodexEnvironment: resolveEnvironment,
      resolveClaudeInheritedEnv: resolveEnvironment
    }
  })
  if (!modelCatalog) {
    throw new Error('the host has a catalog service')
  }
  const result = await modelCatalog.read({
    agent,
    ...(input.session ? { sessionId: record.sessionId } : {})
  })
  expect(resolveEnvironment).not.toHaveBeenCalled()
  return { result, record, saved, fetchedAt, fingerprint }
}

afterEach(() => vi.restoreAllMocks())

describe('the runtime host catalog for session pickers', () => {
  it.each([
    ['probe', false],
    ['probe', true],
    ['live-session', false],
    ['live-session', true]
  ] as const)(
    'serves saved %s rows with their own capabilities (stale: %s)',
    async (origin, stale) => {
      const { result, saved, fetchedAt } = await hostCatalog({ origin, stale })
      // Nothing is selected, so the CLI's own default is not named.
      expect(result).toEqual({
        origin,
        fetchedAt,
        models: [{ ...SAVED_MODEL, isDefault: false }],
        fastModeSupport: saved.fastModeSupport,
        // Only a list current enough to call a missing model gone says so.
        ...(stale ? {} : { unlistedModelReplacement: 'sonnet' })
      })
    }
  )

  it.each(['sonnet', 'new-current-model'])(
    'adds no row for a pinned folder session model %s and verifies nothing while listing fails',
    async (model) => {
      const { result, record } = await hostCatalog({ session: true, model, stale: true })
      if (result.origin === 'unknown') {
        throw new Error('the pinned account has a saved catalog')
      }
      expect(result.models).toEqual([SAVED_MODEL])
      expect(result).not.toHaveProperty('unlistedModelReplacement')
      expect(record.options).toEqual({ model })
    }
  )

  it('preserves the existing Codex catalog default and capability policy', async () => {
    const { result, saved, fetchedAt } = await hostCatalog({ agent: 'codex', stale: true })
    expect(result).toEqual({
      origin: saved.origin,
      models: saved.models,
      fastModeSupport: saved.fastModeSupport,
      fetchedAt
    })
  })
})
