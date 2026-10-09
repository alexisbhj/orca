// Today's two records per terminal tab, and the tab-bar entry for every tab, derived from one
// layout tab. Order fields are derived from the one tab order.

import type { Tab } from '../tab-types'
import type { TerminalLayoutSnapshot, TerminalTab } from '../terminal-tab-types'
import { pickStoredFields } from './stored-record-fields'
import { collectLayoutLeafIdsInOrder } from './terminal-pane-tree'
import type { DesktopLayoutView, LayoutContentFacts } from './workspace-layout-beside'
import type { LayoutTab, LayoutTerminalTab } from './workspace-layout-model'

const SHARED_OPTIONAL_FIELDS = [
  'aiVaultTitle',
  'quickCommandLabel',
  'isPinned',
  'viewMode'
] as const

export function saveTerminalRow(
  tab: LayoutTerminalTab,
  sortOrder: number,
  facts: LayoutContentFacts
): TerminalTab {
  const row = facts.terminalRows[tab.entityId]
  return {
    id: tab.entityId,
    ptyId: row?.ptyId ?? null,
    title: row?.title ?? tab.customTitle ?? tab.terminal.defaultTitle ?? '',
    ...pickStoredFields(tab.terminal, ['defaultTitle']),
    worktreeId: tab.terminal.worktreeId,
    ...(tab.generatedTitle !== undefined ? { generatedTitle: tab.generatedTitle } : {}),
    ...pickStoredFields(tab, SHARED_OPTIONAL_FIELDS),
    customTitle: tab.customTitle,
    color: tab.color,
    sortOrder,
    createdAt: tab.createdAt,
    ...pickStoredFields(row ?? {}, ['generation']),
    ...pickStoredFields(tab.terminal, [
      'shellOverride',
      'forceHostRuntime',
      'startupCwd',
      'launchAgent',
      'agentLaunchPane'
    ])
  }
}

export function saveTabBarEntry(args: {
  workspaceKey: string
  tab: LayoutTab
  groupId: string
  sortOrder: number
  facts: LayoutContentFacts
  view: DesktopLayoutView
}): Tab {
  const { workspaceKey, tab, facts } = args
  const label =
    facts.tabLabels[workspaceKey]?.[tab.id] ??
    (tab.kind === 'terminal' ? facts.terminalRows[tab.entityId]?.title : undefined) ??
    ''
  const lastFocusedAt = args.view.lastFocusedAt[workspaceKey]?.[tab.id]
  return {
    id: tab.id,
    entityId: tab.entityId,
    groupId: args.groupId,
    worktreeId: tab.worktreeId,
    ...pickStoredFields(tab, ['executionHostId']),
    contentType: tab.kind,
    label,
    ...(tab.generatedTitle !== undefined ? { generatedLabel: tab.generatedTitle } : {}),
    ...pickStoredFields(tab, SHARED_OPTIONAL_FIELDS),
    customLabel: tab.customTitle,
    color: tab.color,
    sortOrder: args.sortOrder,
    createdAt: tab.createdAt,
    ...pickStoredFields(tab, ['isPreview', 'agentSessionAgent']),
    ...(lastFocusedAt !== undefined ? { lastFocusedAt } : {})
  }
}

/** A focused or expanded pane that no longer exists falls back as today's writer does. */
export function saveTerminalLayout(
  tab: LayoutTerminalTab & { panes: NonNullable<LayoutTerminalTab['panes']> },
  facts: LayoutContentFacts,
  view: DesktopLayoutView
): TerminalLayoutSnapshot {
  const { panes } = tab
  const leafIds = collectLayoutLeafIdsInOrder(panes.root)
  const selection = view.panes[tab.entityId]
  const activeLeafId = selection?.activeLeafId
  const expandedLeafId = selection?.expandedLeafId
  const scrollback = facts.scrollback[tab.entityId] ?? {}
  return {
    root: panes.root,
    activeLeafId:
      activeLeafId !== undefined && (activeLeafId === null || leafIds.includes(activeLeafId))
        ? activeLeafId
        : (leafIds[0] ?? null),
    expandedLeafId: expandedLeafId && leafIds.includes(expandedLeafId) ? expandedLeafId : null,
    ...pickStoredFields(panes, ['chatLeafId', 'ptyIdsByLeafId']),
    ...pickStoredFields(scrollback, ['buffersByLeafId', 'scrollbackRefsByLeafId']),
    ...pickStoredFields(panes, ['titlesByLeafId'])
  }
}
