// A saved list may call the chat's selected model gone only once it is current: an aged list that
// lacks it is re-listed once per read, and a held failure re-lists nothing.

import { describe, expect, it, vi } from 'vitest'
import { CLAUDE_STRUCTURED_AGENT } from '../../claude/claude-structured-agent-definition'
import { CODEX_STRUCTURED_AGENT } from '../../codex/codex-structured-agent-definition'
import { agentModelCatalogFingerprint } from './agent-model-catalog-fingerprint'
import { createAgentModelCatalogService } from './agent-model-catalog-service'
import { settledAgentModelSelection } from './agent-model-catalog-selection'
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
  /** A named workspace's own config may pick another model, so reads for it name no default. */
  workspaceOverrides?: boolean
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
    probes: { [agent]: probe },
    workspaceMayOverrideDefaultModel: async () => input.workspaceOverrides === true
  })
  return { clock, store, fingerprint, probe, service, agent }
}

describe('the catalog read for a selected model', () => {
  it('answers a picker read in progress and lets its wait join the one re-listing', async () => {
    const { probe, service } = catalog({})
    const first = await service.read({ agent: 'claude', requiredModel: 'opus' })
    expect(first).toMatchObject({ listingInProgress: true, models: [{ id: 'sonnet' }] })
    expect(first).not.toHaveProperty('unlistedModelReplacement')
    const settled = await service.read({
      agent: 'claude',
      requiredModel: 'opus',
      waitForListing: true
    })
    expect(settled).toMatchObject({
      unlistedModelReplacement: 'sonnet',
      models: [{ id: 'sonnet' }, { id: 'opus' }]
    })
    expect(settled).not.toHaveProperty('listingInProgress')
    expect(probe).toHaveBeenCalledOnce()
  })

  it('re-lists nothing more once the fresh list still lacks the model', async () => {
    const { probe, service } = catalog({ relists: async () => listing('sonnet') })
    const read = () => service.read({ agent: 'claude', requiredModel: 'opus', forStart: true })
    expect(await read()).toMatchObject({
      unlistedModelReplacement: 'sonnet',
      models: [{ id: 'sonnet' }]
    })
    expect(await read()).toMatchObject({ unlistedModelReplacement: 'sonnet' })
    expect(probe).toHaveBeenCalledOnce()
  })

  it('re-lists nothing for a current list, or for one that names the model', async () => {
    const current = catalog({ ageMs: AGENT_MODEL_CATALOG_CURRENT_MS - 1 })
    expect(
      await current.service.read({ agent: 'claude', requiredModel: 'opus', waitForListing: true })
    ).toMatchObject({ unlistedModelReplacement: 'sonnet', models: [{ id: 'sonnet' }] })
    const named = catalog({})
    const answer = await named.service.read({
      agent: 'claude',
      requiredModel: 'sonnet',
      waitForListing: true
    })
    // Not current, but it offers the selection, so nothing is decided against it.
    expect(answer).not.toHaveProperty('unlistedModelReplacement')
    expect(current.probe).not.toHaveBeenCalled()
    expect(named.probe).not.toHaveBeenCalled()
  })

  it('keeps a failed re-listing unverified and waits out the failure before another', async () => {
    const { clock, probe, service } = catalog({
      relists: async () => {
        throw new Error('temporarily unavailable')
      }
    })
    const read = () => service.read({ agent: 'claude', requiredModel: 'opus', forStart: true })
    expect(await read()).toMatchObject({ models: [{ id: 'sonnet' }] })
    expect(await read()).not.toHaveProperty('unlistedModelReplacement')
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
    expect(answer).not.toHaveProperty('unlistedModelReplacement')
    expect(probe).not.toHaveBeenCalled()
  })

  it('starts no listing of its own for a start that finds no list', async () => {
    const { probe, service } = catalog({ saved: null })
    expect(
      await service.read({
        agent: 'claude',
        requiredModel: 'opus',
        forStart: true
      })
    ).toEqual({ origin: 'unknown' })
    expect(probe).not.toHaveBeenCalled()
  })

  it("counts a selection saved as a listed alias's own id as listed, aged or current", async () => {
    const saved: AgentModelCatalogSuccess = {
      ...listing(),
      models: [
        {
          id: 'opus[1m]',
          label: 'Opus',
          isDefault: true,
          efforts: [],
          resolvedModel: 'claude-opus-5-5[1m]'
        },
        {
          id: 'sonnet',
          label: 'Sonnet',
          isDefault: false,
          efforts: [],
          resolvedModel: 'claude-sonnet-5'
        }
      ]
    }
    const selection = { model: 'claude-sonnet-5', effort: 'high' }
    for (const ageMs of [AGENT_MODEL_CATALOG_CURRENT_MS, 0]) {
      const { probe, service } = catalog({ saved, ageMs })
      const answer = await service.read({
        agent: 'claude',
        requiredModel: selection.model,
        forStart: true
      })
      expect(probe).not.toHaveBeenCalled()
      expect(settledAgentModelSelection(answer, selection)).toEqual(selection)
    }
  })

  it("never lets a running child's list from before a model existed make that pick look gone", async () => {
    const { clock, fingerprint, probe, service, store } = catalog({
      relists: async () => listing('sonnet', 'fable-6')
    })
    // A child started five minutes ago keeps answering options reads with its start's list.
    store.recordSuccess(fingerprint, 'claude', {
      ...listing('sonnet'),
      origin: 'live-session',
      listedAt: clock.now - 5 * AGENT_MODEL_CATALOG_CURRENT_MS
    })
    const answer = await service.read({ agent: 'claude', requiredModel: 'fable-6', forStart: true })
    expect(probe).toHaveBeenCalledOnce()
    expect(settledAgentModelSelection(answer, { model: 'fable-6' })).toEqual({ model: 'fable-6' })
  })

  it('names the listed default as the replacement even where a workspace hides which it is', async () => {
    const { service } = catalog({
      ageMs: 0,
      saved: {
        ...listing(),
        models: [
          { id: 'haiku', label: 'Haiku', isDefault: false, efforts: [] },
          { id: 'opus', label: 'Opus', isDefault: true, efforts: [] }
        ]
      },
      workspaceOverrides: true
    })
    const answer = await service.read({
      agent: 'claude',
      requiredModel: 'gone',
      workspacePath: '/workspaces/floating'
    })
    expect(answer).toMatchObject({
      unlistedModelReplacement: 'opus',
      models: [
        { id: 'haiku', isDefault: false },
        { id: 'opus', isDefault: false }
      ]
    })
  })
})
