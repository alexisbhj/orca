import type { Tab } from '../tab-types'
import type { TerminalTab } from '../terminal-tab-types'
import type { WorkspaceSessionState } from '../workspace-session-state-types'
import {
  BROWSER_TAB_LAYOUT_FIELDS,
  EDITOR_DRAFT_FIELDS,
  type DesktopLayoutView,
  type LayoutContentFacts
} from './workspace-layout-beside'
import { omitStoredFields, pickStoredFields } from './stored-record-fields'
import { resolveGroupOrder, type OrderCandidate } from './workspace-layout-load-order'
import { loadContentTab, loadTerminalTab } from './workspace-layout-load-tabs'
import type {
  LayoutLoadNormalization,
  WorkspaceLayoutLoadContext
} from './workspace-layout-load-types'
import type { LayoutTab, LayoutTerminalTab, WorkspaceLayout } from './workspace-layout-model'

type WorkspaceLoadArgs = {
  session: WorkspaceSessionState
  key: string
  /** Terminal tab ids an earlier workspace of this partition already holds. */
  claimedTerminalIds: Set<string>
  context: WorkspaceLayoutLoadContext
  view: DesktopLayoutView
  facts: LayoutContentFacts
  normalizations: LayoutLoadNormalization[]
}

function entryFor<T>(record: Record<string, Record<string, T>>, key: string): Record<string, T> {
  record[key] ??= {}
  return record[key]
}

function takeRows({ session, key, claimedTerminalIds, normalizations }: WorkspaceLoadArgs) {
  const rows: TerminalTab[] = []
  const local = new Set<string>()
  for (const row of session.tabsByWorktree?.[key] ?? []) {
    if (local.has(row.id) || claimedTerminalIds.has(row.id)) {
      const rule = local.has(row.id) ? 'duplicate_tab_dropped' : 'tab_in_two_workspaces_dropped'
      normalizations.push({ rule, workspaceKey: key, ids: [row.id] })
      continue
    }
    local.add(row.id)
    claimedTerminalIds.add(row.id)
    rows.push(row)
  }
  return rows
}

function loadPanes(
  session: WorkspaceSessionState,
  tab: Omit<LayoutTerminalTab, 'panes'>,
  args: WorkspaceLoadArgs
): LayoutTerminalTab {
  const layout = session.terminalLayoutsByTabId?.[tab.entityId]
  if (!layout) {
    return { ...tab, panes: null }
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

function loadTabs(args: WorkspaceLoadArgs): { tabs: LayoutTab[]; candidates: OrderCandidate[] } {
  const { session, key, normalizations } = args
  const rows = takeRows(args)
  const rowByEntity = new Map(rows.map((row) => [row.id, row]))
  const merged = new Set<string>()
  const tabs: LayoutTab[] = []
  const candidates: OrderCandidate[] = []
  const tabIds = new Set<string>()
  const addTerminal = (row: TerminalTab, entry: Tab | undefined): void => {
    const tab = loadPanes(session, loadTerminalTab(row, entry), args)
    if (tabIds.has(tab.id)) {
      tab.id = args.context.mintId()
    }
    merged.add(row.id)
    tabIds.add(tab.id)
    tabs.push(tab)
    args.facts.terminalRows[row.id] = {
      title: row.title,
      ptyId: row.ptyId,
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
      tabs.push(loadContentTab({ ...entry, contentType }))
      tabIds.add(entry.id)
      candidates.push({
        id: entry.id,
        groupId: entry.groupId,
        tabBarSortOrder: entry.sortOrder,
        createdAt: entry.createdAt
      })
    }
    entryFor(args.facts.tabLabels, key)[entry.id] = entry.label
    if (entry.lastFocusedAt !== undefined) {
      entryFor(args.view.lastFocusedAt, key)[entry.id] = entry.lastFocusedAt
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
  const { session, key, view, facts } = args
  const { tabs, candidates } = loadTabs(args)
  const storedGroups = session.tabGroups?.[key] ?? []
  for (const group of storedGroups) {
    entryFor(view.groups, key)[group.id] ??= {
      activeTabId: group.activeTabId,
      ...pickStoredFields(group, ['recentTabIds'])
    }
  }
  const groups = resolveGroupOrder({
    workspaceKey: key,
    worktreeId: storedGroups[0]?.worktreeId ?? tabs[0]?.worktreeId ?? key,
    storedGroups,
    candidates,
    mintId: args.context.mintId,
    normalizations: args.normalizations
  })
  const workspace: WorkspaceLayout = {
    tabs,
    groups,
    keepsEmptyTerminalRows: Object.hasOwn(session.tabsByWorktree ?? {}, key)
  }
  const groupLayout = session.tabGroupLayouts?.[key]
  if (groupLayout) {
    workspace.groupLayout = groupLayout
  }
  const files = session.openFilesByWorktree?.[key]
  if (files) {
    workspace.editorFiles = files.map((file) => {
      const draft = pickStoredFields(file, EDITOR_DRAFT_FIELDS)
      if (Object.keys(draft).length > 0) {
        entryFor(view.editorDrafts, key)[file.filePath] = draft
      }
      return omitStoredFields(file, EDITOR_DRAFT_FIELDS)
    })
  }
  const browserTabs = session.browserTabsByWorktree?.[key]
  if (browserTabs) {
    workspace.browserTabs = browserTabs.map((tab) => {
      entryFor(facts.browserTabs, key)[tab.id] = omitStoredFields(tab, BROWSER_TAB_LAYOUT_FIELDS)
      return {
        id: tab.id,
        worktreeId: tab.worktreeId,
        createdAt: tab.createdAt,
        ...pickStoredFields(tab, ['label', 'sessionProfileId', 'sessionPartition', 'pageIds'])
      }
    })
  }
  return workspace
}
