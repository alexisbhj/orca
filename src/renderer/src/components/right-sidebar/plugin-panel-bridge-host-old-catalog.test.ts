import { describe, expect, it, vi } from 'vitest'
import type * as PluginHostApi from '../../../../shared/plugins/plugin-host-api'
import { createPanelBridgeMessageHandler } from './plugin-panel-bridge-host'

// Simulates a renderer shipped before openExternal: its panel catalog lacks the action.
vi.mock('../../../../shared/plugins/plugin-host-api', async (importOriginal) => {
  const actual = await importOriginal<typeof PluginHostApi>()
  return {
    ...actual,
    isPluginPanelAction: (action: string) =>
      action !== 'openExternal' && actual.isPluginPanelAction(action)
  }
})

describe('openExternal on a renderer that predates it', () => {
  it('refuses the unknown action with invalid_request and never relays it', async () => {
    const postMessage = vi.fn()
    const panelWindow = { postMessage }
    const callPanelAction = vi.fn()
    const handler = createPanelBridgeMessageHandler({
      sessionToken: 's'.repeat(43),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler only calls postMessage and compares identity.
      getPanelWindow: () => panelWindow as unknown as Window,
      callPanelAction
    })
    const event = {
      source: panelWindow,
      data: {
        type: 'orca-panel-action',
        requestId: 'open-1',
        action: 'openExternal',
        params: { url: 'https://example.com/' }
      }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler only reads data and source.
    handler(event as unknown as MessageEvent)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(callPanelAction).not.toHaveBeenCalled()
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'open-1',
        ok: false,
        errorCode: 'invalid_request'
      }),
      '*'
    )
  })
})
