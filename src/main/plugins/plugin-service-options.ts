import type { PluginWorkerFactory } from './plugin-worker-manager'
import type { KeybindingOverrides } from '../../shared/keybindings'
import type { PluginKillListEntry } from '../../shared/plugins/plugin-kill-list'

export type PluginServiceOptions = {
  userDataPath: string
  hostVersion: string
  isPluginSystemEnabled: () => boolean
  getDisabledPlugins: () => string[]
  getPluginConsents: () => Record<string, string>
  getDevPluginPaths: () => string[]
  getKeybindings?: () => KeybindingOverrides
  getPluginKillListEntry?: (pluginKey: string) => PluginKillListEntry | null
  hostEntryPath?: string
  workerFactory?: PluginWorkerFactory
  maxActiveWorkers?: number
  idleReapMs?: number
  /** Opens a validated https URL on this desktop; absent on hosts without a local display. */
  openExternalUrl?: (url: string) => Promise<void>
}
