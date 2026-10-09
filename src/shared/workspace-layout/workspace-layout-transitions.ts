// Runtime-internal transitions (design 2.3): facts the runtime sees about processes, hosts and
// owners, applied through the same module as commands. No client sends these.

import type { SleepingAgentSessionRecord } from '../agent-session-resume'
import type { PersistedClientHostedBrowserPage } from '../client-hosted-browser-page-record'
import { omitStoredFields, withoutKey } from './stored-record-fields'
import { isSameTerminal } from './terminal-owner-invariants'
import {
  applied,
  locatePane,
  paneKeysOf,
  refuse,
  updateTab,
  type Applied
} from './workspace-layout-command-steps'
import type { LayoutContext } from './workspace-layout-command-types'
import { createTerminalTab } from './workspace-layout-tab-commands'
import {
  paneKeyOf,
  type LayoutTerminalCreation,
  type WorkspaceLayoutModel
} from './workspace-layout-model'
import {
  findTerminalTab,
  retireExitedSurface,
  type ExitedSurface
} from './workspace-layout-removal'
import { removeWorkspaces, renameWorkspace } from './workspace-layout-owner-transitions'

export type LayoutTransition =
  | {
      type: 'processStarted'
      workspace: string
      paneKey: string
      ptyId: string
      incarnationId?: string
    }
  | { type: 'processExited'; surface: ExitedSurface }
  | { type: 'sshLeaseTerminated'; ptyIds: string[] }
  | {
      type: 'orphanAdopted'
      workspace: string
      ptyId: string
      incarnationId?: string
      creation?: Partial<LayoutTerminalCreation>
    }
  | { type: 'ownerRemoved'; workspaces: string[] }
  | { type: 'identityRenamed'; from: string; to: string }
  | { type: 'legacyWorkerRecovered'; surface: ExitedSurface; resolution: 'exited' | 'adopted' }
  | { type: 'clientHostedPageAnnounced'; workspace: string; page: PersistedClientHostedBrowserPage }
  | {
      type: 'agentLaunchVerdict'
      workspace: string
      tabId: string
      agentLaunchPane: LayoutTerminalCreation['agentLaunchPane'] | null
    }
  | { type: 'sleepingRecordsCaptured'; records: SleepingAgentSessionRecord[] }

function boundElsewhere(
  model: WorkspaceLayoutModel,
  paneKey: string,
  binding: { ptyId: string; incarnationId?: string }
): boolean {
  return Object.values(model.workspaces).some((workspace) =>
    workspace.tabs.some(
      (tab) =>
        tab.kind === 'terminal' &&
        Object.entries(tab.panes.ptyIdsByLeafId ?? {}).some(([leafId, ptyId]) => {
          const key = paneKeyOf(tab.entityId, leafId)
          const incarnationId = model.records.incarnationsByPaneKey?.[key]
          return key !== paneKey && isSameTerminal({ ptyId, incarnationId }, binding)
        })
    )
  )
}

/** Binds the started terminal to the pane that was starting; one terminal never shows in two panes. */
function processStarted(
  model: WorkspaceLayoutModel,
  transition: Extract<LayoutTransition, { type: 'processStarted' }>
): Applied {
  const workspace = model.workspaces[transition.workspace]
  const pane = workspace && locatePane(workspace, transition.paneKey)
  if (!pane) {
    return refuse('pane_not_found')
  }
  if (boundElsewhere(model, transition.paneKey, transition)) {
    return refuse('pane_already_bound')
  }
  const { tab, leafId } = pane
  const bound = updateTab(model, transition.workspace, {
    ...tab,
    panes: {
      ...tab.panes,
      ptyIdsByLeafId: { ...tab.panes.ptyIdsByLeafId, [leafId]: transition.ptyId }
    }
  })
  if (!bound.ok || transition.incarnationId === undefined) {
    return bound
  }
  const incarnationsByPaneKey = {
    ...model.records.incarnationsByPaneKey,
    [transition.paneKey]: transition.incarnationId
  }
  return applied({ ...bound.model, records: { ...bound.model.records, incarnationsByPaneKey } })
}

/** Loss of an SSH lease unbinds its panes; it is not evidence the remote process exited. */
function sshLeaseTerminated(model: WorkspaceLayoutModel, ptyIds: readonly string[]): Applied {
  let next = model
  for (const [key, workspace] of Object.entries(model.workspaces)) {
    for (const tab of workspace.tabs) {
      if (tab.kind !== 'terminal' || !tab.panes.ptyIdsByLeafId) {
        continue
      }
      const bindings = Object.entries(tab.panes.ptyIdsByLeafId)
      if (!bindings.some(([, ptyId]) => ptyIds.includes(ptyId))) {
        continue
      }
      const kept = Object.fromEntries(bindings.filter(([, ptyId]) => !ptyIds.includes(ptyId)))
      const updated = updateTab(next, key, {
        ...tab,
        panes: { ...tab.panes, ptyIdsByLeafId: kept }
      })
      next = updated.ok ? updated.model : next
    }
  }
  return applied(next)
}

function orphanAdopted(
  model: WorkspaceLayoutModel,
  transition: Extract<LayoutTransition, { type: 'orphanAdopted' }>,
  context: LayoutContext
): Applied {
  const created = createTerminalTab(
    model,
    { type: 'createTerminalTab', workspace: transition.workspace, creation: transition.creation },
    context
  )
  if (!created.ok) {
    return created
  }
  const started = processStarted(created.model, {
    type: 'processStarted',
    workspace: transition.workspace,
    paneKey: created.result.paneKey!,
    ptyId: transition.ptyId,
    incarnationId: transition.incarnationId
  })
  return started.ok ? applied(started.model, created.result) : started
}

export function applyLayoutTransition(
  model: WorkspaceLayoutModel,
  transition: LayoutTransition,
  context: LayoutContext
): Applied {
  switch (transition.type) {
    case 'processStarted':
      return processStarted(model, transition)
    case 'processExited':
      return applied(retireExitedSurface(model, transition.surface).model)
    case 'sshLeaseTerminated':
      return sshLeaseTerminated(model, transition.ptyIds)
    case 'orphanAdopted':
      return orphanAdopted(model, transition, context)
    case 'ownerRemoved':
      return applied(removeWorkspaces(model, transition.workspaces))
    case 'identityRenamed': {
      const renamedModel = renameWorkspace(model, transition.from, transition.to)
      return renamedModel ? applied(renamedModel) : refuse('workspace_exists')
    }
    case 'legacyWorkerRecovered': {
      const { surface } = transition
      const next =
        transition.resolution === 'exited' ? retireExitedSurface(model, surface).model : model
      const paneKey = paneKeyOf(surface.terminalTabId, surface.leafId)
      return applied({
        ...next,
        records: {
          ...next.records,
          sleepingByPaneKey: withoutKey(next.records.sleepingByPaneKey, paneKey)
        }
      })
    }
    case 'clientHostedPageAnnounced': {
      const pages = model.records.clientHostedBrowserPagesByWorkspace ?? {}
      const kept = (pages[transition.workspace] ?? []).filter(
        (page) => page.browserPageId !== transition.page.browserPageId
      )
      return applied({
        ...model,
        records: {
          ...model.records,
          clientHostedBrowserPagesByWorkspace: {
            ...pages,
            [transition.workspace]: [...kept, transition.page]
          }
        }
      })
    }
    case 'agentLaunchVerdict': {
      const location = findTerminalTab(model, transition.tabId)
      if (!location || location.workspaceKey !== transition.workspace) {
        return refuse('tab_not_found')
      }
      const terminal = omitStoredFields(location.tab.terminal, ['agentLaunchPane'])
      return updateTab(model, transition.workspace, {
        ...location.tab,
        terminal: transition.agentLaunchPane
          ? { ...terminal, agentLaunchPane: transition.agentLaunchPane }
          : terminal
      })
    }
    case 'sleepingRecordsCaptured': {
      const panes = new Set(
        Object.values(model.workspaces).flatMap((workspace) =>
          workspace.tabs.flatMap((tab) => (tab.kind === 'terminal' ? paneKeysOf(tab) : []))
        )
      )
      const captured = transition.records.filter((record) => panes.has(record.paneKey))
      return applied({
        ...model,
        records: {
          ...model.records,
          sleepingByPaneKey: {
            ...model.records.sleepingByPaneKey,
            ...Object.fromEntries(captured.map((record) => [record.paneKey, record]))
          }
        }
      })
    }
  }
}
