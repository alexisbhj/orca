// A running Claude child answers `list_models` from its initialize result for its whole life, so
// what it writes through to the host catalog is as old as its start, however often it is read.

import { describe, expect, it } from 'vitest'
import {
  AGENT_MODEL_CATALOG_CURRENT_MS,
  AgentModelCatalogStore
} from '../native-chat/agent-model-catalog/agent-model-catalog-store'
import { claudeAcquireCatalogAccess } from './claude-structured-acquire-catalog'
import { claudeStructuredSessionOptionsFrom } from './claude-structured-session-options'
import type { ClaudeSession } from './claude-structured-session-state'

const FROZEN_LIST = [
  { value: 'default', resolvedModel: 'claude-sonnet-5' },
  { value: 'sonnet', displayName: 'Sonnet', resolvedModel: 'claude-sonnet-5' }
]

function runningChild() {
  const clock = { now: 1_000 }
  const store = new AgentModelCatalogStore({ now: () => clock.now })
  const access = claudeAcquireCatalogAccess(store, '/accounts/claude')
  if (!access) {
    throw new Error('the account has a catalog key')
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the option read touches only these session members.
  const session = {
    options: new Map<string, string>(),
    reportedOptions: {},
    confirmedOptions: new Set<string>(),
    optionMutationSequence: 0,
    reportedModelMutation: -1,
    launchedModel: null,
    catalogAccess: access
  } as unknown as ClaudeSession
  return { clock, store, fingerprint: access.fingerprint, session }
}

describe("a running Claude child's list in the host catalog", () => {
  it('keeps the age of its first write and the id each alias runs', () => {
    const { clock, store, fingerprint, session } = runningChild()
    claudeStructuredSessionOptionsFrom(session, FROZEN_LIST)
    clock.now += 5 * AGENT_MODEL_CATALOG_CURRENT_MS
    claudeStructuredSessionOptionsFrom(session, FROZEN_LIST)

    const entry = store.get(fingerprint)
    expect(entry?.fetchedAt).toBe(1_000)
    expect(entry && store.isCurrent(entry)).toBe(false)
    expect(entry?.models).toEqual([
      expect.objectContaining({ id: 'sonnet', isDefault: true, resolvedModel: 'claude-sonnet-5' })
    ])
  })

  it('never replaces a newer listing with its older one', () => {
    const { clock, store, fingerprint, session } = runningChild()
    claudeStructuredSessionOptionsFrom(session, FROZEN_LIST)
    clock.now += AGENT_MODEL_CATALOG_CURRENT_MS
    store.recordSuccess(fingerprint, 'claude', {
      models: [
        { id: 'sonnet', label: 'Sonnet', isDefault: true, efforts: [] },
        { id: 'fable-6', label: 'Fable 6', isDefault: false, efforts: [] }
      ],
      fastModeTierByModel: new Map(),
      origin: 'probe'
    })
    claudeStructuredSessionOptionsFrom(session, FROZEN_LIST)

    expect(store.get(fingerprint)?.models.map((model) => model.id)).toEqual(['sonnet', 'fable-6'])
  })
})
