import { createContext, useLayoutEffect, useSyncExternalStore } from 'react'
import { codexMaintenanceHostIsReachable } from '@/lib/codex-maintenance-host-contact'
import { observeCodexMaintenance } from '@/lib/codex-maintenance-observation'
import {
  codexMaintenanceTargetKey,
  type CodexMaintenanceTarget
} from '@/lib/codex-maintenance-client'
import {
  getCodexMaintenanceEntry,
  getCodexMaintenanceHostBusy,
  refreshCodexMaintenance,
  startCodexMaintenance,
  subscribeCodexMaintenance
} from '@/lib/codex-maintenance-store'
import {
  codexMaintenanceLabel,
  codexMaintenanceReason
} from '@/components/native-chat/codex-maintenance-copy'
import type { NativeChatComposerNotice } from '@/components/native-chat/native-chat-composer-notice'

export const NativeChatCodexMaintenanceContext = createContext<NativeChatComposerNotice | null>(
  null
)

export function useCodexMaintenance(target: CodexMaintenanceTarget | null) {
  const key = target ? codexMaintenanceTargetKey(target) : ''
  const snapshot = () => getCodexMaintenanceEntry(key)
  const entry = useSyncExternalStore(subscribeCodexMaintenance, snapshot, snapshot)
  const busySnapshot = () => Boolean(target && getCodexMaintenanceHostBusy(target))
  const hostBusy = useSyncExternalStore(subscribeCodexMaintenance, busySnapshot, busySnapshot)
  const kind = target?.kind
  const environmentId = target?.kind === 'environment' ? target.environmentId : null
  const cwd = target?.cwd
  useLayoutEffect(() => {
    const host: CodexMaintenanceTarget | null =
      kind === 'local'
        ? { kind }
        : kind === 'environment' && environmentId
          ? { kind, environmentId }
          : null
    if (!host) {
      return
    }
    const context = { ...host, ...(cwd ? { cwd } : {}) }
    const unsubscribeContact = observeCodexMaintenance(context)
    void refreshCodexMaintenance(context)
    const onFocus = (): void => {
      void refreshCodexMaintenance(context)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      unsubscribeContact()
    }
  }, [kind, environmentId, cwd])
  const installation =
    entry.verification === 'current' && target && codexMaintenanceHostIsReachable(target)
      ? entry.state?.installation
      : undefined
  const blocked = installation?.status === 'missing' || installation?.status === 'unsupported'
  const busy = hostBusy || entry.starting
  // Only a missing Codex gets a button; the user updates an old one themselves.
  const action =
    installation?.status === 'missing' && target && entry.state?.canRun
      ? {
          label: codexMaintenanceLabel(busy),
          disabled: busy,
          busy,
          onClick: () => startCodexMaintenance(target)
        }
      : undefined
  const notice: NativeChatComposerNotice | null =
    blocked && installation
      ? {
          key: 'codex-installation',
          kind: 'error',
          text: codexMaintenanceReason(installation),
          action
        }
      : null
  return { ...entry, installation, blocked, busy, action, notice }
}
