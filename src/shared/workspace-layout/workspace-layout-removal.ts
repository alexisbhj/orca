import { getRepoIdFromWorktreeId } from '../worktree/id'
import { removeGroupLayoutLeaf } from './tab-group-layout-tree'
import { withoutKey } from './stored-record-fields'
import { layoutContainsLeafId, removeLayoutLeaf } from './terminal-pane-tree'
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

/** An emptied group closes, even the last one: an empty group is never saved, so it never stays. */
export function removeTabFromWorkspace(workspace: WorkspaceLayout, tabId: string): WorkspaceLayout {
  let groupLayout = workspace.groupLayout
  const groups = workspace.groups.flatMap((group) => {
    if (!group.tabOrder.includes(tabId)) {
      return [group]
    }
    const tabOrder = group.tabOrder.filter((id) => id !== tabId)
    if (tabOrder.length === 0) {
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

export function withWorkspace(
  model: WorkspaceLayoutModel,
  workspaceKey: string,
  workspace: WorkspaceLayout
): WorkspaceLayoutModel {
  return { ...model, workspaces: { ...model.workspaces, [workspaceKey]: workspace } }
}

/**
 * Removes one pane; a tab left without panes closes. The pane's incarnation goes with it; its
 * sleeping record stays, as on main.
 */
export function retireTerminalPane(
  model: WorkspaceLayoutModel,
  location: TerminalTabLocation,
  leafId: string
): WorkspaceLayoutModel {
  const { workspaceKey, tab } = location
  const workspace = model.workspaces[workspaceKey]!
  const root = removeLayoutLeaf(tab.panes.root, leafId)
  let nextWorkspace: WorkspaceLayout
  if (!root) {
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
    records: advanceTopologyRevision(records, workspace.worktreeId)
  }
}

export type ExitedSurface = {
  worktreeId: string
  terminalTabId: string
  leafId: string
  ptyId: string
  incarnationId?: string
}

/**
 * Today's exit retirement: a pane now showing another terminal or incarnation is left alone; a
 * pane no longer in its tab only loses its incarnation.
 */
export function retireExitedSurface(
  model: WorkspaceLayoutModel,
  surface: ExitedSurface
): { model: WorkspaceLayoutModel; retired: boolean } {
  const paneKey = paneKeyOf(surface.terminalTabId, surface.leafId)
  const incarnation = model.records.incarnationsByPaneKey?.[paneKey]
  if (surface.incarnationId && incarnation && incarnation !== surface.incarnationId) {
    return { model, retired: false }
  }
  const location = findTerminalTab(model, surface.terminalTabId)
  const panes = location?.tab.panes
  const inTree = Boolean(panes && layoutContainsLeafId(panes.root, surface.leafId))
  const boundPtyId = inTree ? panes?.ptyIdsByLeafId?.[surface.leafId] : undefined
  if (boundPtyId && boundPtyId !== surface.ptyId) {
    return { model, retired: false }
  }
  if (location && inTree) {
    return { model: retireTerminalPane(model, location, surface.leafId), retired: true }
  }
  const records = {
    ...model.records,
    incarnationsByPaneKey: withoutKey(model.records.incarnationsByPaneKey, paneKey)
  }
  return {
    model: { ...model, records: advanceTopologyRevision(records, surface.worktreeId) },
    retired: false
  }
}
