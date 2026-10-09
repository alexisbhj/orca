// Transitions that remove, rename or rehome a whole workspace with every record that names it.

import { paneKeysOf } from './workspace-layout-command-steps'
import type {
  WorkspaceLayout,
  WorkspaceLayoutModel,
  WorkspaceLayoutRecords
} from './workspace-layout-model'

type KeyedRecord<T> = Record<string, T> | undefined

function pick<T>(record: KeyedRecord<T>, keep: (key: string, value: T) => boolean): KeyedRecord<T> {
  return (
    record && Object.fromEntries(Object.entries(record).filter(([key, value]) => keep(key, value)))
  )
}

function terminalPaneKeys(workspace: WorkspaceLayout | undefined): Set<string> {
  return new Set(
    workspace?.tabs.flatMap((tab) => (tab.kind === 'terminal' ? paneKeysOf(tab) : [])) ?? []
  )
}

/** The records that belong to these workspaces, and the rest. */
function splitRecords(model: WorkspaceLayoutModel, keys: readonly string[]) {
  const paneKeys = new Set(keys.flatMap((key) => [...terminalPaneKeys(model.workspaces[key])]))
  const { records } = model
  const ofThese = (inside: boolean): WorkspaceLayoutRecords => ({
    ...(inside ? {} : records),
    sleepingByPaneKey: pick(records.sleepingByPaneKey, (key) => paneKeys.has(key) === inside),
    incarnationsByPaneKey: pick(
      records.incarnationsByPaneKey,
      (key) => paneKeys.has(key) === inside
    ),
    defaultTabsAppliedByWorkspace: pick(
      records.defaultTabsAppliedByWorkspace,
      (key) => keys.includes(key) === inside
    ),
    clientHostedBrowserPagesByWorkspace: pick(
      records.clientHostedBrowserPagesByWorkspace,
      (key) => keys.includes(key) === inside
    ),
    closedTerminalTabTombstones: pick(
      records.closedTerminalTabTombstones,
      (_key, tombstone) => keys.includes(tombstone.worktreeId) === inside
    )
  })
  return { taken: ofThese(true), kept: ofThese(false) }
}

/** A deleted worktree, repo, folder or project group takes its layout and records with it. */
export function removeWorkspaces(
  model: WorkspaceLayoutModel,
  keys: readonly string[]
): WorkspaceLayoutModel {
  const workspaces = { ...model.workspaces }
  for (const key of keys) {
    delete workspaces[key]
  }
  return { ...model, workspaces, records: splitRecords(model, keys).kept }
}

function merge<T>(left: KeyedRecord<T>, right: KeyedRecord<T>): KeyedRecord<T> {
  return left || right ? { ...left, ...right } : undefined
}

/** An SSH target reassignment moves a workspace to another host's partition, records included. */
export function moveWorkspaceToPartition(
  from: WorkspaceLayoutModel,
  to: WorkspaceLayoutModel,
  key: string
): { from: WorkspaceLayoutModel; to: WorkspaceLayoutModel } {
  const workspace = from.workspaces[key]
  if (!workspace) {
    return { from, to }
  }
  const { taken } = splitRecords(from, [key])
  return {
    from: removeWorkspaces(from, [key]),
    to: {
      ...to,
      workspaces: { ...to.workspaces, [key]: workspace },
      records: {
        ...to.records,
        sleepingByPaneKey: merge(to.records.sleepingByPaneKey, taken.sleepingByPaneKey),
        incarnationsByPaneKey: merge(to.records.incarnationsByPaneKey, taken.incarnationsByPaneKey),
        defaultTabsAppliedByWorkspace: merge(
          to.records.defaultTabsAppliedByWorkspace,
          taken.defaultTabsAppliedByWorkspace
        ),
        clientHostedBrowserPagesByWorkspace: merge(
          to.records.clientHostedBrowserPagesByWorkspace,
          taken.clientHostedBrowserPagesByWorkspace
        ),
        closedTerminalTabTombstones: merge(
          to.records.closedTerminalTabTombstones,
          taken.closedTerminalTabTombstones
        )
      }
    }
  }
}

const renamed = (value: string, from: string, to: string) => (value === from ? to : value)

/** A worktree's identity changed: its key and every record naming the old id follow. */
export function renameWorkspace(
  model: WorkspaceLayoutModel,
  from: string,
  to: string
): WorkspaceLayoutModel {
  const workspace = model.workspaces[from]
  if (!workspace || from === to) {
    return model
  }
  const moved: WorkspaceLayout = {
    ...workspace,
    tabs: workspace.tabs.map((tab) => ({
      ...tab,
      worktreeId: renamed(tab.worktreeId, from, to),
      ...(tab.kind === 'terminal'
        ? { terminal: { ...tab.terminal, worktreeId: renamed(tab.terminal.worktreeId, from, to) } }
        : {})
    })),
    groups: workspace.groups.map((group) => ({
      ...group,
      worktreeId: renamed(group.worktreeId, from, to)
    })),
    ...(workspace.editorFiles
      ? {
          editorFiles: workspace.editorFiles.map((file) => ({
            ...file,
            worktreeId: renamed(file.worktreeId, from, to)
          }))
        }
      : {}),
    ...(workspace.browserTabs
      ? {
          browserTabs: workspace.browserTabs.map((tab) => ({
            ...tab,
            worktreeId: renamed(tab.worktreeId, from, to)
          }))
        }
      : {})
  }
  const workspaces = { ...model.workspaces, [to]: moved }
  delete workspaces[from]
  const { records } = model
  const rekey = <T>(record: KeyedRecord<T>): KeyedRecord<T> =>
    record &&
    Object.fromEntries(
      Object.entries(record).map(([key, value]) => [renamed(key, from, to), value])
    )
  return {
    ...model,
    workspaces,
    records: {
      ...records,
      sleepingByPaneKey:
        records.sleepingByPaneKey &&
        Object.fromEntries(
          Object.entries(records.sleepingByPaneKey).map(([key, record]) => [
            key,
            { ...record, worktreeId: renamed(record.worktreeId, from, to) }
          ])
        ),
      defaultTabsAppliedByWorkspace: rekey(records.defaultTabsAppliedByWorkspace),
      clientHostedBrowserPagesByWorkspace: rekey(records.clientHostedBrowserPagesByWorkspace)
    }
  }
}
