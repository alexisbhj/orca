// Runtime-internal transitions (design 2.3): facts the runtime sees about processes, hosts and
// owners, applied through the same module as commands. No client sends these. Transitions whose
// producer arrives later (orphan adoption, legacy worker recovery, client-hosted pages, agent
// launch verdicts, sleep capture, partition moves) ship with that producer's PR.

import { isSameTerminal } from './terminal-owner-invariants'
import {
  applied,
  locatePane,
  refuse,
  updateTab,
  type Applied
} from './workspace-layout-command-steps'
import { paneKeyOf, type WorkspaceLayoutModel } from './workspace-layout-model'
import { retireExitedSurface, type ExitedSurface } from './workspace-layout-removal'
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
  | { type: 'ownerRemoved'; workspaces: string[] }
  | { type: 'identityRenamed'; from: string; to: string }

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

export function applyLayoutTransition(
  model: WorkspaceLayoutModel,
  transition: LayoutTransition
): Applied {
  switch (transition.type) {
    case 'processStarted':
      return processStarted(model, transition)
    case 'processExited':
      return applied(retireExitedSurface(model, transition.surface).model)
    case 'sshLeaseTerminated':
      return sshLeaseTerminated(model, transition.ptyIds)
    case 'ownerRemoved':
      return applied(removeWorkspaces(model, transition.workspaces))
    case 'identityRenamed': {
      const renamedModel = renameWorkspace(model, transition.from, transition.to)
      return renamedModel ? applied(renamedModel) : refuse('workspace_exists')
    }
  }
}
