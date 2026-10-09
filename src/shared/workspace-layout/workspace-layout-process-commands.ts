// Commands that start, restart, sleep or wake terminals. Their layout effect is small (bindings
// and sleeping records); the runtime runs the returned effects after replying.

import {
  applied,
  locatePane,
  paneKeysOf,
  refuse,
  updateTab,
  type Applied
} from './workspace-layout-command-steps'
import type { CommandOf } from './workspace-layout-command-types'
import type { WorkspaceLayout, WorkspaceLayoutModel } from './workspace-layout-model'

function workspacePaneKeys(workspace: WorkspaceLayout): string[] {
  return workspace.tabs.flatMap((tab) => (tab.kind === 'terminal' ? paneKeysOf(tab) : []))
}

function boundPty(workspace: WorkspaceLayout, paneKey: string): string | undefined {
  const pane = locatePane(workspace, paneKey)
  return pane?.tab.panes.ptyIdsByLeafId?.[pane.leafId]
}

/** Idempotent: starts or restores a pane that has no live terminal. */
export function startPane(model: WorkspaceLayoutModel, command: CommandOf<'startPane'>): Applied {
  if (!locatePane(model.workspaces[command.workspace]!, command.paneKey)) {
    return refuse('pane_not_found')
  }
  if (model.records.sleepingByPaneKey?.[command.paneKey]) {
    return refuse('pane_sleeping')
  }
  return applied(model, {}, { startPaneKeys: [command.paneKey] })
}

/** Stops then starts in place: the pane keeps its id, its terminal binding is cleared until the new one starts. */
export function restartPane(
  model: WorkspaceLayoutModel,
  command: CommandOf<'restartPane'>
): Applied {
  const pane = locatePane(model.workspaces[command.workspace]!, command.paneKey)
  if (!pane) {
    return refuse('pane_not_found')
  }
  const { tab, leafId } = pane
  const ptyId = tab.panes.ptyIdsByLeafId?.[leafId]
  const ptyIdsByLeafId = { ...tab.panes.ptyIdsByLeafId }
  delete ptyIdsByLeafId[leafId]
  const updated = updateTab(model, command.workspace, {
    ...tab,
    panes: { ...tab.panes, ptyIdsByLeafId }
  })
  if (!updated.ok) {
    return updated
  }
  const incarnations = { ...updated.model.records.incarnationsByPaneKey }
  delete incarnations[command.paneKey]
  const records = updated.model.records.incarnationsByPaneKey
    ? { ...updated.model.records, incarnationsByPaneKey: incarnations }
    : updated.model.records
  return applied(
    { ...updated.model, records },
    {},
    { stopPtyIds: ptyId ? [ptyId] : [], startPaneKeys: [command.paneKey] }
  )
}

/** Stops the terminals and records how to resume each agent; panes and bindings stay. */
export function sleep(model: WorkspaceLayoutModel, command: CommandOf<'sleep'>): Applied {
  const workspace = model.workspaces[command.workspace]!
  const panes = workspacePaneKeys(workspace)
  const targets = command.paneKeys ? panes.filter((key) => command.paneKeys!.includes(key)) : panes
  const recorded = Object.fromEntries(
    command.records
      .filter((record) => targets.includes(record.paneKey))
      .map((record) => [record.paneKey, record])
  )
  const stopPtyIds = targets.flatMap((paneKey) => boundPty(workspace, paneKey) ?? [])
  return applied(
    {
      ...model,
      records: {
        ...model.records,
        sleepingByPaneKey: { ...model.records.sleepingByPaneKey, ...recorded }
      }
    },
    { slept: targets },
    { stopPtyIds }
  )
}

export function wake(model: WorkspaceLayoutModel, command: CommandOf<'wake'>): Applied {
  const sleeping = model.records.sleepingByPaneKey ?? {}
  const panes = workspacePaneKeys(model.workspaces[command.workspace]!)
  const woken = (command.paneKeys ?? panes).filter(
    (paneKey) => panes.includes(paneKey) && Object.hasOwn(sleeping, paneKey)
  )
  const remaining = Object.fromEntries(
    Object.entries(sleeping).filter(([key]) => !woken.includes(key))
  )
  return applied(
    { ...model, records: { ...model.records, sleepingByPaneKey: remaining } },
    { woken },
    { startPaneKeys: woken }
  )
}
