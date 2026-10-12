/**
 * Invariant: a consented worker reads the typed launch catalog and dry-runs a
 * choice on the Orca instance hosting it, and its CLI env names that profile.
 * Oracle: the fixture worker relays host answers; nothing is launched.
 */

import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from './helpers/orca-app'

test('a consented worker reads the agent catalog and checks a choice without launching', async ({
  electronApp,
  orcaPage
}) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'orca-agent-catalog-e2e-'))
  const pluginRoot = join(tempRoot, 'agent-catalog')
  await cp(join(process.cwd(), 'examples', 'plugins', 'agent-catalog'), pluginRoot, {
    recursive: true
  })
  try {
    const userDataPath = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const result = await orcaPage.evaluate(async (pluginPath) => {
      const settings = await window.api.settings.set({ pluginSystemEnabled: true })
      window.__store?.setState({ settings })
      await window.api.plugins.refresh()
      const installed = await window.api.plugins.install({ kind: 'local-path', path: pluginPath })
      if (!installed.ok) {
        throw new Error(installed.error)
      }
      const listed = await window.api.plugins.refresh()
      const plugin = listed.find((entry) => entry.pluginKey === installed.pluginKey)
      if (!plugin?.consentFingerprint) {
        throw new Error('fixture is not reviewable')
      }
      await window.api.plugins.consent({
        pluginKey: plugin.pluginKey,
        reviewedFingerprint: plugin.consentFingerprint,
        decision: 'approve'
      })
      const invoke = (commandId: string, args?: unknown) =>
        window.api.plugins.invokeCommand({ pluginKey: plugin.pluginKey, commandId, args })
      return {
        catalog: await invoke('catalog'),
        valid: await invoke('check', { agent: 'claude', model: 'opus', effort: 'max' }),
        refused: await invoke('check', { agent: 'claude', model: 'haiku', effort: 'high' }),
        profile: await invoke('profile')
      }
    }, pluginRoot)

    expect(result.catalog).toMatchObject({
      version: 1,
      accountAccessVerified: false,
      agents: [
        { id: 'codex', customModels: { accepted: true } },
        { id: 'claude', modelSelection: true }
      ]
    })
    expect(result.valid).toEqual({
      valid: true,
      choice: { agent: 'claude', model: 'opus', effort: 'max' }
    })
    expect(result.refused).toEqual({
      valid: false,
      code: 'invalid_argument',
      message: 'Agent claude model haiku does not support effort high.'
    })
    expect(result.profile).toEqual({ userDataPath })
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
