import type { Tab } from '../tab-types'
import type { TerminalTab } from '../terminal-tab-types'
import type { WorkspaceSessionState } from '../workspace-session-state-types'
import { childRecord, pickStoredFields } from './stored-record-fields'
import { resolveGroupOrder, type OrderCandidate } from './workspace-layout-load-order'
import {
  loadBrowserTabs,
  loadEditorFiles,
  resolveWorktreeId
} from './workspace-layout-load-records'
import { loadContentTab, loadTerminalTab, type TabLoadReport } from './workspace-layout-load-tabs'
import type { WorkspaceLoadArgs } from './workspace-layout-load-types'
import type { LayoutTab, LayoutTerminalTab, WorkspaceLayout } from './workspace-layout-model'
import { pruneGroupLayout } from '../workspace-session-terminal-tab-close'

function takeRows({ session, key, terminalHomes, normalizations }: WorkspaceLoadArgs) {
  const rows: TerminalTab[] = []
  const local = new Set<string>()
  for (const row of session.tabsByWorktree?.[key] ?? []) {
    if (local.has(row.id) || terminalHomes.get(row.id) !== key) {
      const rule = local.has(row.id) ? 'duplicate_tab_dropped' : 'tab_in_two_workspaces_dropped'
      normalizations.push({ rule, workspaceKey: key, ids: [row.id] })
      continue
    }
    local.add(row.id)
    rows.push(row)
  }
  return rows
}

function loadPanes(
  session: WorkspaceSessionState,
  row: TerminalTab,
  tab: Omit<LayoutTerminalTab, 'panes'>,
  args: WorkspaceLoadArgs
): LayoutTerminalTab {
  const layout = session.terminalLayoutsByTabId?.[tab.entityId]
  if (!layout) {
    return { ...tab, panes: null, ...(row.ptyId ? { legacyPtyId: row.ptyId } : {}) }
  }
  args.view.panes[tab.entityId] = {
    activeLeafId: layout.activeLeafId,
    expandedLeafId: layout.expandedLeafId
  }
  const scrollback = pickStoredFields(layout, ['buffersByLeafId', 'scrollbackRefsByLeafId'])
  if (Object.keys(scrollback).length > 0) {
    args.facts.scrollback[tab.entityId] = scrollback
  }
  return {
    ...tab,
    panes: {
      root: layout.root,
      ...pickStoredFields(layout, ['chatLeafId', 'titlesByLeafId', 'ptyIdsByLeafId'])
    }
  }
}

function reporterFor(args: WorkspaceLoadArgs, tabId: string): TabLoadReport {
  const workspaceKey = args.key
  return {
    disagree: (field) =>
      args.normalizations.push({
        rule: 'row_and_tab_bar_disagree',
        workspaceKey,
        ids: [tabId],
        field
      }),
    foreignHost: () =>
      args.normalizations.push({ rule: 'execution_host_disagrees', workspaceKey, ids: [tabId] })
  }
}

function loadTabs(args: WorkspaceLoadArgs): { tabs: LayoutTab[]; candidates: OrderCandidate[] } {
  const { session, key, normalizations, hostId } = args
  const rows = takeRows(args)
  const rowByEntity = new Map(rows.map((row) => [row.id, row]))
  const merged = new Set<string>()
  const tabs: LayoutTab[] = []
  const candidates: OrderCandidate[] = []
  const tabIds = new Set<string>()
  const addTerminal = (row: TerminalTab, entry: Tab | undefined): void => {
    const loaded = loadTerminalTab(row, entry, hostId, reporterFor(args, entry?.id ?? row.id))
    const tab = loadPanes(session, row, loaded, args)
    if (tabIds.has(tab.id)) {
      const reminted = args.context.mintId()
      normalizations.push({ rule: 'tab_id_reminted', workspaceKey: key, ids: [tab.id, reminted] })
      tab.id = reminted
    }
    merged.add(row.id)
    tabIds.add(tab.id)
    tabs.push(tab)
    args.facts.terminalRows[row.id] = {
      title: row.title,
      ...pickStoredFields(row, ['generation'])
    }
    candidates.push({
      id: tab.id,
      groupId: entry?.groupId,
      tabBarSortOrder: entry?.sortOrder,
      rowSortOrder: row.sortOrder,
      createdAt: tab.createdAt
    })
  }
  for (const entry of session.unifiedTabs?.[key] ?? []) {
    if (tabIds.has(entry.id)) {
      normalizations.push({ rule: 'duplicate_tab_dropped', workspaceKey: key, ids: [entry.id] })
      continue
    }
    if (entry.contentType === 'terminal') {
      const row = rowByEntity.get(entry.entityId)
      if (!row || merged.has(row.id)) {
        normalizations.push({
          rule: 'tab_bar_entry_without_row_dropped',
          workspaceKey: key,
          ids: [entry.id, entry.entityId]
        })
        continue
      }
      addTerminal(row, entry)
    } else {
      const contentType = entry.contentType
      tabs.push(loadContentTab({ ...entry, contentType }, hostId, reporterFor(args, entry.id)))
      tabIds.add(entry.id)
      candidates.push({
        id: entry.id,
        groupId: entry.groupId,
        tabBarSortOrder: entry.sortOrder,
        createdAt: entry.createdAt
      })
    }
    childRecord(args.facts.tabLabels, key)[entry.id] = entry.label
    if (entry.lastFocusedAt !== undefined) {
      childRecord(args.view.lastFocusedAt, key)[entry.id] = entry.lastFocusedAt
    }
  }
  for (const row of rows) {
    if (!merged.has(row.id)) {
      addTerminal(row, undefined)
    }
  }
  return { tabs, candidates }
}

export function loadWorkspace(args: WorkspaceLoadArgs): WorkspaceLayout {
  const { session, key, view } = args
  const worktreeId = resolveWorktreeId(args)
  const { tabs, candidates } = loadTabs(args)
  const storedGroups = session.tabGroups?.[key] ?? []
  for (const group of storedGroups) {
    childRecord(view.groups, key)[group.id] ??= {
      activeTabId: group.activeTabId,
      ...pickStoredFields(group, ['recentTabIds'])
    }
  }
  const groups = resolveGroupOrder({
    workspaceKey: key,
    storedGroups,
    candidates,
    mintId: args.context.mintId,
    normalizations: args.normalizations
  })
  const workspace: WorkspaceLayout = {
    worktreeId,
    tabs,
    groups,
    keepsEmptyTerminalRows: Object.hasOwn(session.tabsByWorktree ?? {}, key)
  }
  const storedTree = session.tabGroupLayouts?.[key]
  const groupLayout = pruneGroupLayout(storedTree, new Set(groups.map((group) => group.id)))
  if (JSON.stringify(groupLayout) !== JSON.stringify(storedTree) && groups.length > 0) {
    args.normalizations.push({ rule: 'group_tree_pruned', workspaceKey: key, ids: [] })
  }
  if (groupLayout) {
    workspace.groupLayout = groupLayout
  }
  const editorFiles = loadEditorFiles(args, tabs)
  if (editorFiles) {
    workspace.editorFiles = editorFiles
  }
  const browserTabs = loadBrowserTabs(args)
  if (browserTabs) {
    workspace.browserTabs = browserTabs
  }
  return workspace
}
