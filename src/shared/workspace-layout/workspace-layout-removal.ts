import { getRepoIdFromWorktreeId } from '../worktree/id'
import { removeGroupLayoutLeaf } from './tab-group-layout-tree'
import { removeLayoutLeaf } from './terminal-pane-tree'
import {
  paneKeyOf,
  type LayoutTerminalTab,
  type WorkspaceLayout,
  type WorkspaceLayoutModel,
  type WorkspaceLayoutRecords
} from './workspace-layout-model'

export type TerminalTabLocation = { workspaceKey: string; tab: LayoutTerminalTab }

export function findTerminalTab(
  model: WorkspaceLayoutModel,
  terminalTabId: string
): TerminalTabLocation | null {
  for (const [workspaceKey, workspace] of Object.entries(model.workspaces)) {
    for (const tab of workspace.tabs) {
      if (tab.kind === 'terminal' && tab.entityId === terminalTabId) {
        return { workspaceKey, tab }
      }
    }
  }
  return null
}

/** An emptied group closes unless it is the workspace's last one, as the tab bar does today. */
export function removeTabFromWorkspace(workspace: WorkspaceLayout, tabId: string): WorkspaceLayout {
  let groupLayout = workspace.groupLayout
  const groups = workspace.groups.flatMap((group) => {
    if (!group.tabOrder.includes(tabId)) {
      return [group]
    }
    const tabOrder = group.tabOrder.filter((id) => id !== tabId)
    if (tabOrder.length === 0 && workspace.groups.length > 1) {
      groupLayout = groupLayout
        ? (removeGroupLayoutLeaf(groupLayout, group.id) ?? undefined)
        : undefined
      return []
    }
    return [{ ...group, tabOrder }]
  })
  const next: WorkspaceLayout = {
    ...workspace,
    tabs: workspace.tabs.filter((tab) => tab.id !== tabId),
    groups
  }
  if (groupLayout) {
    next.groupLayout = groupLayout
  } else {
    delete next.groupLayout
  }
  return next
}

function withoutKey<T>(
  record: Record<string, T> | undefined,
  key: string
): Record<string, T> | undefined {
  if (!record || !Object.hasOwn(record, key)) {
    return record
  }
  const next = { ...record }
  delete next[key]
  return next
}

/** Membership changed: older builds' save merge must defer to this layout (section 7). */
export function advanceTopologyRevision(
  records: WorkspaceLayoutRecords,
  worktreeId: string
): WorkspaceLayoutRecords {
  const repoId = getRepoIdFromWorktreeId(worktreeId)
  return {
    ...records,
    topologyRevisionByRepoId: {
      ...records.topologyRevisionByRepoId,
      [repoId]: (records.topologyRevisionByRepoId?.[repoId] ?? 0) + 1
    }
  }
}

function withWorkspace(
  model: WorkspaceLayoutModel,
  workspaceKey: string,
  workspace: WorkspaceLayout
): WorkspaceLayoutModel {
  return { ...model, workspaces: { ...model.workspaces, [workspaceKey]: workspace } }
}

/**
 * Removes one pane; a tab left without panes closes. A legacy tab with no pane tree is one
 * surface. The pane's incarnation goes with it; its sleeping record stays, as on main.
 */
export function retireTerminalPane(
  model: WorkspaceLayoutModel,
  location: TerminalTabLocation,
  leafId: string
): WorkspaceLayoutModel {
  const { workspaceKey, tab } = location
  const workspace = model.workspaces[workspaceKey]!
  const root = tab.panes ? removeLayoutLeaf(tab.panes.root, leafId) : null
  let nextWorkspace: WorkspaceLayout
  if (!root || !tab.panes) {
    nextWorkspace = removeTabFromWorkspace(workspace, tab.id)
  } else {
    const panes = {
      ...tab.panes,
      root,
      ptyIdsByLeafId: withoutKey(tab.panes.ptyIdsByLeafId, leafId),
      titlesByLeafId: withoutKey(tab.panes.titlesByLeafId, leafId)
    }
    if (panes.chatLeafId === leafId) {
      delete panes.chatLeafId
    }
    nextWorkspace = {
      ...workspace,
      tabs: workspace.tabs.map((entry) => (entry.id === tab.id ? { ...tab, panes } : entry))
    }
  }
  const records = {
    ...model.records,
    incarnationsByPaneKey: withoutKey(
      model.records.incarnationsByPaneKey,
      paneKeyOf(tab.entityId, leafId)
    )
  }
  return {
    ...withWorkspace(model, workspaceKey, nextWorkspace),
    records: advanceTopologyRevision(records, tab.terminal.worktreeId)
  }
}
