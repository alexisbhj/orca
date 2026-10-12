import { PLUGIN_EXTERNAL_OPEN_RATE_LIMIT } from '../../shared/plugins/plugin-external-url'
import { PANEL_OPEN_EXTERNAL_CAPABILITY } from '../../shared/plugins/plugin-panel-bridge'
import { createPluginPanelCallAdmission } from '../../shared/plugins/plugin-panel-call-admission'
import { PluginHostCallError, type PluginHostServices } from './plugin-host-method-bindings'
import { isRendererPanelOwner } from './plugin-panel-sessions'

/** Opens plugin-requested links on the desktop that displays the requesting panel. */
export class PluginExternalLinkOpener {
  private readonly admission = createPluginPanelCallAdmission({
    limits: PLUGIN_EXTERNAL_OPEN_RATE_LIMIT
  })

  constructor(private readonly openUrl: ((url: string) => Promise<void>) | undefined) {}

  /** Why: a paired client's panel is displayed remotely, so opening here would
   *  target the execution host's display, never the viewer's. */
  private supports(ownerKey: string): boolean {
    return Boolean(this.openUrl) && isRendererPanelOwner(ownerKey)
  }

  hostCapabilitiesFor(ownerKey: string): string[] {
    return this.supports(ownerKey) ? [PANEL_OPEN_EXTERNAL_CAPABILITY] : []
  }

  /** Service binding for one panel call; undefined makes the method answer `unavailable`. */
  bindFor(ownerKey: string, assertSessionCurrent: () => void): PluginHostServices['openExternal'] {
    const openUrl = this.openUrl
    if (!openUrl || !isRendererPanelOwner(ownerKey)) {
      return undefined
    }
    return async (pluginKey, url) => {
      try {
        assertSessionCurrent()
      } catch (error) {
        throw new PluginHostCallError(
          'unavailable',
          error instanceof Error ? error.message : String(error)
        )
      }
      const refusal = this.admission.admit(pluginKey, url)
      if (refusal === 'rate_limited') {
        throw new PluginHostCallError('rate_limited', 'too many external links opened')
      }
      if (refusal) {
        throw new PluginHostCallError('invalid_params', 'url exceeds the size limit')
      }
      await openUrl(url)
    }
  }
}
