// Today's two records per terminal tab, and the tab-bar entry for every tab, derived from one
// layout tab. Order fields are derived from the one tab order.

import type { ExecutionHostId } from '../execution-host'
import type { Tab } from '../tab-types'
import type { TerminalLayoutSnapshot, TerminalTab } from '../terminal-tab-types'
import { pickStoredFields } from './stored-record-fields'
import { collectLayoutLeafIdsInOrder } from './terminal-pane-tree'
import type { DesktopLayoutView, LayoutContentFacts } from './workspace-layout-beside'
import type { LayoutEditorFile, LayoutTab, LayoutTerminalTab } from './workspace-layout-model'
import { tabExecutionHostId } from './workspace-layout-tab-host'

const SHARED_OPTIONAL_FIELDS = [
  'aiVaultTitle',
  'quickCommandLabel',
  'isPinned',
  'viewMode'
] as const

/** What one saved workspace's records share: its key, worktree id, host and the beside records. */
export type WorkspaceSaveScope = {
  workspaceKey: string
  worktreeId: string
  hostId: ExecutionHostId
  editorFiles: readonly LayoutEditorFile[] | undefined
  facts: LayoutContentFacts
  view: DesktopLayoutView
}

/** The row's terminal: the focused pane's, else the first bound pane's, else none. */
export function rowPtyId(tab: LayoutTerminalTab, view: DesktopLayoutView): string | null {
  const bindings = tab.panes.ptyIdsByLeafId ?? {}
  const focused = view.panes[tab.entityId]?.activeLeafId
  if (focused && bindings[focused] !== undefined) {
    return bindings[focused]
  }
  const firstBound = collectLayoutLeafIdsInOrder(tab.panes.root).find(
    (leafId) => bindings[leafId] !== undefined
  )
  return firstBound === undefined ? null : bindings[firstBound]!
}

/** The one live title, written as both the row title and the tab-bar label. */
function terminalTitle(tab: LayoutTerminalTab, facts: LayoutContentFacts): string {
  return (
    facts.terminalRows[tab.entityId]?.title ?? tab.customTitle ?? tab.terminal.defaultTitle ?? ''
  )
}

export function saveTerminalRow(
  tab: LayoutTerminalTab,
  sortOrder: number,
  scope: WorkspaceSaveScope
): TerminalTab {
  const row = scope.facts.terminalRows[tab.entityId]
  return {
    id: tab.entityId,
    ptyId: rowPtyId(tab, scope.view),
    title: terminalTitle(tab, scope.facts),
    ...pickStoredFields(tab.terminal, ['defaultTitle']),
    worktreeId: scope.worktreeId,
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

export function saveTabBarEntry(
  tab: LayoutTab,
  placement: { groupId: string; sortOrder: number },
  scope: WorkspaceSaveScope
): Tab {
  const { workspaceKey, facts } = scope
  const label =
    tab.kind === 'terminal'
      ? terminalTitle(tab, facts)
      : (facts.tabLabels[workspaceKey]?.[tab.id] ?? '')
  const lastFocusedAt = scope.view.lastFocusedAt[workspaceKey]?.[tab.id]
  return {
    id: tab.id,
    entityId: tab.entityId,
    groupId: placement.groupId,
    worktreeId: scope.worktreeId,
    executionHostId: tabExecutionHostId(tab, scope.editorFiles, scope.hostId),
    contentType: tab.kind,
    label,
    ...(tab.generatedTitle !== undefined ? { generatedLabel: tab.generatedTitle } : {}),
    ...pickStoredFields(tab, SHARED_OPTIONAL_FIELDS),
    customLabel: tab.customTitle,
    color: tab.color,
    sortOrder: placement.sortOrder,
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
