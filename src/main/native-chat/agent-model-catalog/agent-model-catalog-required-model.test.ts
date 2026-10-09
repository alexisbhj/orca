// A saved list may call the chat's selected model gone only once it is current: an aged list that
// lacks it is re-listed once per read, and a held failure re-lists nothing.

import { describe, expect, it, vi } from 'vitest'
import { CLAUDE_STRUCTURED_AGENT } from '../../claude/claude-structured-agent-definition'
import { CODEX_STRUCTURED_AGENT } from '../../codex/codex-structured-agent-definition'
import { agentModelCatalogFingerprint } from './agent-model-catalog-fingerprint'
import { createAgentModelCatalogService } from './agent-model-catalog-service'
import {
  AGENT_MODEL_CATALOG_CURRENT_MS,
  AGENT_MODEL_CATALOG_FAILURE_TTL_MS,
  AgentModelCatalogStore,
  type AgentModelCatalogSuccess
} from './agent-model-catalog-store'

const HOME = { variable: 'CLAUDE_CONFIG_DIR', path: '/accounts/claude' }

function listing(...ids: string[]): AgentModelCatalogSuccess {
  return {
    models: ids.map((id, index) => ({ id, label: id, isDefault: index === 0, efforts: [] })),
    fastModeTierByModel: new Map(),
    origin: 'probe'
  }
}

function catalog(input: {
  agent?: 'claude' | 'codex'
  ageMs?: number
  saved?: AgentModelCatalogSuccess | null
  relists?: () => Promise<AgentModelCatalogSuccess>
}) {
  const agent = input.agent ?? 'claude'
  const clock = { now: 1_000 }
  const store = new AgentModelCatalogStore({ now: () => clock.now })
  const fingerprint = agentModelCatalogFingerprint({ agent, accountHome: HOME, wslDistro: null })
  if (input.saved !== null) {
    store.recordSuccess(fingerprint, agent, input.saved ?? listing('sonnet'))
  }
  clock.now += input.ageMs ?? AGENT_MODEL_CATALOG_CURRENT_MS
  const probe = vi.fn(input.relists ?? (async () => listing('sonnet', 'opus')))
  const service = createAgentModelCatalogService({
    store,
    getRecord: () => undefined,
    drivesRecord: () => true,
    agents: {
      definition: (id) => (id === 'claude' ? CLAUDE_STRUCTURED_AGENT : CODEX_STRUCTURED_AGENT)
    },
    resolveAccountHome: async () => HOME,
    probes: { [agent]: probe }
  })
  return { clock, store, fingerprint, probe, service, agent }
}

describe('the catalog read for a selected model', () => {
  it('answers a picker read in progress and lets its wait join the one re-listing', async () => {
    const { probe, service } = catalog({})
    const first = await service.read({ agent: 'claude', requiredModel: 'opus' })
    expect(first).toMatchObject({ listingInProgress: true, models: [{ id: 'sonnet' }] })
    expect(first).not.toHaveProperty('verified')
    const settled = await service.read({
      agent: 'claude',
      requiredModel: 'opus',
      waitForListing: true
    })
    expect(settled).toMatchObject({ verified: true, models: [{ id: 'sonnet' }, { id: 'opus' }] })
    expect(settled).not.toHaveProperty('listingInProgress')
    expect(probe).toHaveBeenCalledOnce()
  })

  it('re-lists nothing more once the fresh list still lacks the model', async () => {
    const { probe, service } = catalog({ relists: async () => listing('sonnet') })
    const read = () =>
      service.read({ agent: 'claude', requiredModel: 'opus', settleRequiredModel: true })
    expect(await read()).toMatchObject({ verified: true, models: [{ id: 'sonnet' }] })
    expect(await read()).toMatchObject({ verified: true })
    expect(probe).toHaveBeenCalledOnce()
  })

  it('re-lists nothing for a current list, or for one that names the model', async () => {
    const current = catalog({ ageMs: AGENT_MODEL_CATALOG_CURRENT_MS - 1 })
    expect(
      await current.service.read({ agent: 'claude', requiredModel: 'opus', waitForListing: true })
    ).toMatchObject({ verified: true, models: [{ id: 'sonnet' }] })
    const named = catalog({})
    const answer = await named.service.read({
      agent: 'claude',
      requiredModel: 'sonnet',
      waitForListing: true
    })
    // Not current, but it offers the selection, so nothing is decided against it.
    expect(answer).not.toHaveProperty('verified')
    expect(current.probe).not.toHaveBeenCalled()
    expect(named.probe).not.toHaveBeenCalled()
  })

  it('keeps a failed re-listing unverified and waits out the failure before another', async () => {
    const { clock, probe, service } = catalog({
      relists: async () => {
        throw new Error('temporarily unavailable')
      }
    })
    const read = () =>
      service.read({ agent: 'claude', requiredModel: 'opus', settleRequiredModel: true })
    expect(await read()).toMatchObject({ models: [{ id: 'sonnet' }] })
    expect(await read()).not.toHaveProperty('verified')
    expect(probe).toHaveBeenCalledOnce()
    clock.now += AGENT_MODEL_CATALOG_FAILURE_TTL_MS - 1
    await read()
    expect(probe).toHaveBeenCalledOnce()
    clock.now += 1
    await read()
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('leaves an agent without the replacement policy as it was: no re-listing, no verdict', async () => {
    const { probe, service } = catalog({ agent: 'codex' })
    const answer = await service.read({
      agent: 'codex',
      requiredModel: 'opus',
      waitForListing: true
    })
    expect(answer).not.toHaveProperty('verified')
    expect(probe).not.toHaveBeenCalled()
  })

  it('starts no listing of its own for a start that finds no list', async () => {
    const { probe, service } = catalog({ saved: null })
    expect(
      await service.read({
        agent: 'claude',
        requiredModel: 'opus',
        settleRequiredModel: true,
        forStart: true
      })
    ).toEqual({ origin: 'unknown' })
    expect(probe).not.toHaveBeenCalled()
  })
})
