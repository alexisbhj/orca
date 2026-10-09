// Serializer: the layout model and what is kept beside it, written as today's session partition so
// older builds read the same documents. Every redundant field is derived from the one model.

import type { BrowserWorkspace } from '../browser-workspace-types'
import type { Tab, TabGroup, TabGroupLayoutNode } from '../tab-types'
import type { TerminalTab } from '../terminal-tab-types'
import type { PersistedOpenFile, WorkspaceSessionState } from '../workspace-session-state-types'
import { pickStoredFields } from './stored-record-fields'
import { pruneGroupLayout } from '../workspace-session-terminal-tab-close'
import {
  BLANK_BROWSER_TAB_STATE,
  CARRIED_SESSION_FIELDS,
  FACT_SESSION_FIELDS,
  VIEW_SESSION_FIELDS
} from './workspace-layout-beside'
import type { LoadedWorkspaceLayout } from './workspace-layout-load-types'
import { tabsInOrder, type WorkspaceLayout } from './workspace-layout-model'
import { saveTabBarEntry, saveTerminalLayout, saveTerminalRow } from './workspace-layout-save-tabs'

type WorkspaceMaps = {
  tabsByWorktree: Record<string, TerminalTab[]>
  terminalLayoutsByTabId: WorkspaceSessionState['terminalLayoutsByTabId']
  unifiedTabs: Record<string, Tab[]>
  tabGroups: Record<string, TabGroup[]>
  tabGroupLayouts: Record<string, TabGroupLayoutNode>
  openFilesByWorktree: Record<string, PersistedOpenFile[]>
  browserTabsByWorktree: Record<string, BrowserWorkspace[]>
}

function saveWorkspace(
  key: string,
  workspace: WorkspaceLayout,
  loaded: LoadedWorkspaceLayout,
  session: WorkspaceMaps
): void {
  const { facts, desktopView: view } = loaded
  // Rows follow the one tab order: the rules and older readers expect the row list in that order.
  const ordered = tabsInOrder(workspace)
  const unplaced = workspace.tabs.filter((tab) => !ordered.includes(tab))
  const rows = [...ordered, ...unplaced]
    .flatMap((tab) => (tab.kind === 'terminal' ? [tab] : []))
    .map((tab, index) => saveTerminalRow(tab, index, facts))
  const placement = new Map<string, { groupId: string; index: number }>()
  for (const group of workspace.groups) {
    group.tabOrder.forEach((tabId, index) => placement.set(tabId, { groupId: group.id, index }))
  }
  const entries: Tab[] = []
  for (const tab of workspace.tabs) {
    const place = placement.get(tab.id)
    if (tab.kind === 'terminal') {
      if (tab.panes) {
        session.terminalLayoutsByTabId[tab.entityId] = saveTerminalLayout(
          { ...tab, panes: tab.panes },
          facts,
          view
        )
      }
    }
    if (place) {
      entries.push(
        saveTabBarEntry({
          workspaceKey: key,
          tab,
          groupId: place.groupId,
          sortOrder: place.index,
          facts,
          view
        })
      )
    }
  }
  if (rows.length > 0 || workspace.keepsEmptyTerminalRows) {
    session.tabsByWorktree[key] = rows
  }
  const groups: TabGroup[] = workspace.groups
    .filter((group) => group.tabOrder.length > 0)
    .map((group) => {
      const selection = view.groups[key]?.[group.id]
      const activeTabId = selection?.activeTabId
      return {
        id: group.id,
        worktreeId: group.worktreeId,
        activeTabId: activeTabId && group.tabOrder.includes(activeTabId) ? activeTabId : null,
        tabOrder: group.tabOrder,
        ...(selection?.recentTabIds
          ? {
              recentTabIds: selection.recentTabIds.filter((tabId) => group.tabOrder.includes(tabId))
            }
          : {})
      }
    })
  if (groups.length > 0) {
    session.unifiedTabs[key] = entries
    session.tabGroups[key] = groups
    // Today's writer persists only groups holding tabs, and a group tree naming only those.
    const persistedIds = new Set(groups.map((group) => group.id))
    session.tabGroupLayouts[key] = pruneGroupLayout(workspace.groupLayout, persistedIds) ?? {
      type: 'leaf',
      groupId: groups[0]!.id
    }
  }
  if (workspace.editorFiles) {
    session.openFilesByWorktree[key] = workspace.editorFiles.map((file): PersistedOpenFile => ({
      ...file,
      ...view.editorDrafts[key]?.[file.filePath]
    }))
  }
  if (workspace.browserTabs) {
    session.browserTabsByWorktree[key] = workspace.browserTabs.map((tab): BrowserWorkspace => ({
      ...tab,
      ...(facts.browserTabs[key]?.[tab.id] ?? BLANK_BROWSER_TAB_STATE)
    }))
  }
}

export function saveWorkspaceLayout(loaded: LoadedWorkspaceLayout): WorkspaceSessionState {
  const { layout, desktopView: view, facts, carried } = loaded
  const { records } = layout
  const maps: WorkspaceMaps = {
    tabsByWorktree: {},
    terminalLayoutsByTabId: { ...carried.unownedTerminalLayouts },
    unifiedTabs: {},
    tabGroups: {},
    tabGroupLayouts: {},
    openFilesByWorktree: {},
    browserTabsByWorktree: {}
  }
  for (const [key, workspace] of Object.entries(layout.workspaces)) {
    saveWorkspace(key, workspace, loaded, maps)
  }
  return {
    ...pickStoredFields(view, VIEW_SESSION_FIELDS),
    activeRepoId: view.activeRepoId,
    activeWorktreeId: view.activeWorktreeId,
    activeTabId: view.activeTabId,
    ...pickStoredFields(facts, FACT_SESSION_FIELDS),
    ...pickStoredFields(carried, CARRIED_SESSION_FIELDS),
    ...maps,
    ...(records.sleepingByPaneKey
      ? { sleepingAgentSessionsByPaneKey: records.sleepingByPaneKey }
      : {}),
    ...(records.incarnationsByPaneKey
      ? { terminalPtyIncarnationsByPaneKey: records.incarnationsByPaneKey }
      : {}),
    ...(records.closedTerminalTabTombstones
      ? { closedTerminalTabTombstonesByTabId: records.closedTerminalTabTombstones }
      : {}),
    ...(records.defaultTabsAppliedByWorkspace
      ? { defaultTerminalTabsAppliedByWorktreeId: records.defaultTabsAppliedByWorkspace }
      : {}),
    ...(records.clientHostedBrowserPagesByWorkspace
      ? { clientHostedBrowserPagesByWorktree: records.clientHostedBrowserPagesByWorkspace }
      : {}),
    ...(records.topologyRevisionByRepoId
      ? { terminalTopologyRevisionByRepoId: records.topologyRevisionByRepoId }
      : {})
  }
}
