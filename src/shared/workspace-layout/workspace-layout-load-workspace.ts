import type { Tab } from '../tab-types'
import type { TerminalLayoutSnapshot, TerminalTab } from '../terminal-tab-types'
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
import { rowPtyId } from './workspace-layout-save-tabs'
import { tabExecutionHostId } from './workspace-layout-tab-host'
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

/** A pane key's leaf for this tab, from the records that name one (the old window's leaf). */
function recordedLeafId(session: WorkspaceSessionState, tabId: string): string | undefined {
  const leafIds = new Set(
    [
      ...Object.keys(session.terminalPtyIncarnationsByPaneKey ?? {}),
      ...Object.keys(session.sleepingAgentSessionsByPaneKey ?? {}),
      ...Object.keys(session.terminalSurfaceTombstonesByPaneKey ?? {})
    ].flatMap((paneKey) =>
      paneKey.startsWith(`${tabId}:`) ? [paneKey.slice(tabId.length + 1)] : []
    )
  )
  return leafIds.size === 1 ? [...leafIds][0] : undefined
}

/**
 * A row saved before pane layouts existed becomes a one-pane tab bound to the row's terminal,
 * as today's window restores it; the pane reuses the leaf the records name, else a new one.
 */
function legacyLayout(
  session: WorkspaceSessionState,
  row: TerminalTab,
  args: WorkspaceLoadArgs
): TerminalLayoutSnapshot {
  const leafId = recordedLeafId(session, row.id) ?? args.context.mintLeafId()
  args.normalizations.push({
    rule: 'legacy_row_given_pane',
    workspaceKey: args.key,
    ids: [row.id, leafId]
  })
  return {
    root: { type: 'leaf', leafId },
    activeLeafId: leafId,
    expandedLeafId: null,
    ...(row.ptyId ? { ptyIdsByLeafId: { [leafId]: row.ptyId } } : {})
  }
}

function loadPanes(
  session: WorkspaceSessionState,
  row: TerminalTab,
  tab: Omit<LayoutTerminalTab, 'panes'>,
  args: WorkspaceLoadArgs
): LayoutTerminalTab {
  const layout = session.terminalLayoutsByTabId?.[tab.entityId] ?? legacyLayout(session, row, args)
  args.view.panes[tab.entityId] = {
    activeLeafId: layout.activeLeafId,
    expandedLeafId: layout.expandedLeafId
  }
  const loaded: LayoutTerminalTab = {
    ...tab,
    panes: {
      root: layout.root,
      ...pickStoredFields(layout, ['chatLeafId', 'titlesByLeafId', 'ptyIdsByLeafId'])
    }
  }
  // The row's terminal is derived from the panes on save; report a stored one that differs.
  if (rowPtyId(loaded, args.view) !== row.ptyId) {
    args.normalizations.push({
      rule: 'row_terminal_rederived',
      workspaceKey: args.key,
      ids: [row.id],
      field: 'ptyId'
    })
  }
  const scrollback = pickStoredFields(layout, ['buffersByLeafId', 'scrollbackRefsByLeafId'])
  if (Object.keys(scrollback).length > 0) {
    args.facts.scrollback[tab.entityId] = scrollback
  }
  return loaded
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
      args.normalizations.push({ rule: 'execution_host_disagrees', workspaceKey, ids: [tabId] }),
    hostFilled: () =>
      args.normalizations.push({ rule: 'execution_host_filled', workspaceKey, ids: [tabId] })
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
    // One live title: the tab-bar label when there is one (the row's is often a stale default).
    if (entry && entry.label !== row.title) {
      normalizations.push({
        rule: 'row_and_tab_bar_disagree',
        workspaceKey: key,
        ids: [tab.id],
        field: 'title'
      })
    }
    args.facts.terminalRows[row.id] = {
      title: entry?.label ?? row.title,
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
      const ownerHostId = tabExecutionHostId(
        { kind: contentType, entityId: entry.entityId },
        session.openFilesByWorktree?.[key],
        hostId
      )
      tabs.push(loadContentTab({ ...entry, contentType }, ownerHostId, reporterFor(args, entry.id)))
      tabIds.add(entry.id)
      candidates.push({
        id: entry.id,
        groupId: entry.groupId,
        tabBarSortOrder: entry.sortOrder,
        createdAt: entry.createdAt
      })
    }
    if (entry.contentType !== 'terminal') {
      childRecord(args.facts.tabLabels, key)[entry.id] = entry.label
    }
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
