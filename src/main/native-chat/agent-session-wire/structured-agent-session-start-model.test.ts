// A start launches the model the catalog settles for the chat's saved selection, and never waits on
// the catalog to start: a failed read launches the selection as saved.

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import type { StructuredAgentSessionHost } from './structured-agent-session-host'
import { attachParams, CALLER, hostTestState } from './structured-agent-session-host-test-harness'
import {
  HOST_TEST_NOW as NOW,
  HOST_TEST_SESSION as SESSION
} from './structured-agent-session-host-test-data'

function catalogFake() {
  return {
    recordLiveListing: vi.fn(),
    prewarm: vi.fn(async () => {}),
    stop: vi.fn(),
    providerStarted: vi.fn()
  }
}

let host: StructuredAgentSessionHost
let acquire: Mock<StructuredAgentSessionAdapter['acquire']>

beforeEach(() => {
  ;({ host, acquire } = hostTestState())
})

describe('the model a start launches', () => {
  it.each([
    ['gone from the current list', true, { model: 'sonnet', effort: 'high' }],
    ['unverified', false, { model: 'opus', effort: 'high' }]
  ])(
    'starts a chat whose saved model is %s on what the catalog settles',
    async (_, verified, launched) => {
      const read = vi.fn(async () => ({
        origin: 'probe' as const,
        models: [
          {
            id: 'sonnet',
            label: 'Sonnet',
            isDefault: true,
            efforts: [{ value: 'high', label: 'High' }]
          }
        ],
        fetchedAt: NOW,
        ...(verified ? { unlistedModelReplacement: 'sonnet' } : {})
      }))
      host.deps.modelCatalog = { ...catalogFake(), read }

      const params = attachParams({ options: { model: 'opus', effort: 'high' } })
      expect(await host.attach(CALLER, params)).toMatchObject({ ok: true })
      expect(read).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: SESSION, forStart: true })
      )
      expect(acquire).toHaveBeenCalledWith(expect.objectContaining({ options: launched }))
    }
  )

  it('starts on the saved options when the catalog cannot be read', async () => {
    host.deps.modelCatalog = {
      ...catalogFake(),
      read: vi.fn(async () => {
        throw new Error('catalog unavailable')
      })
    }
    const params = attachParams({ options: { model: 'opus', effort: 'high' } })
    expect(await host.attach(CALLER, params)).toMatchObject({ ok: true })
    expect(acquire).toHaveBeenCalledWith(
      expect.objectContaining({ options: { model: 'opus', effort: 'high' } })
    )
  })
})
