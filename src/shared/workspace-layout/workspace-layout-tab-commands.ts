import { filterRecord, omitStoredFields } from './stored-record-fields'
import { canReplacePreviewContentType, partitionPinnedTabOrder } from './tab-order'
import { getNextTerminalOrdinal } from './terminal-tab-ordinal'
import { layoutContainsLeafId } from './terminal-pane-tree'
import {
  applied,
  boundPtyIds,
  workspaceOrEmpty,
  findTab,
  findTerminal,
  paneKeysOf,
  placeNewTab,
  refuse,
  updateTab,
  type Applied
} from './workspace-layout-command-steps'
import type {
  CommandOf,
  LayoutCommandResult,
  LayoutContext
} from './workspace-layout-command-types'
import {
  paneKeyOf,
  type LayoutContentTab,
  type LayoutTerminalTab,
  type WorkspaceLayout,
  type WorkspaceLayoutModel,
  type WorkspaceLayoutRecords
} from './workspace-layout-model'
import {
  advanceTopologyRevision,
  removeTabFromWorkspace,
  withWorkspace
} from './workspace-layout-removal'

type RefusedClose = NonNullable<LayoutCommandResult['refused']>[number]

export function createTerminalTab(
  model: WorkspaceLayoutModel,
  command: CommandOf<'createTerminalTab'>,
  context: LayoutContext
): Applied {
  const workspace = workspaceOrEmpty(model, command.workspace)
  const terminals = workspace.tabs.flatMap((tab) => (tab.kind === 'terminal' ? [tab] : []))
  const ordinal = getNextTerminalOrdinal(
    terminals.map((tab) => ({ defaultTitle: tab.terminal.defaultTitle, title: '' }))
  )
  const id = context.mintId()
  const leafId = context.mintLeafId()
  const tab: LayoutTerminalTab = {
    id,
    entityId: id,
    createdAt: context.now(),
    customTitle: command.title ?? null,
    color: command.color ?? null,
    ...(command.viewMode ? { viewMode: command.viewMode } : {}),
    kind: 'terminal',
    terminal: { defaultTitle: `Terminal ${ordinal}`, ...command.creation },
    panes: { root: { type: 'leaf', leafId } }
  }
  const placed = placeNewTab(workspace, tab, command, context)
  const paneKey = paneKeyOf(id, leafId)
  const next = withWorkspace(model, command.workspace, placed)
  return applied(
    { ...next, records: advanceTopologyRevision(next.records, placed.worktreeId) },
    { tabId: id, leafId, paneKey },
    { startPaneKeys: [paneKey] }
  )
}

function withoutPaneRecords(
  records: WorkspaceLayoutRecords,
  paneKeys: readonly string[]
): WorkspaceLayoutRecords {
  const keep = (key: string) => !paneKeys.includes(key)
  return {
    ...records,
    sleepingByPaneKey: filterRecord(records.sleepingByPaneKey, keep),
    incarnationsByPaneKey: filterRecord(records.incarnationsByPaneKey, keep)
  }
}

/** Removes a tab and its content record; a terminal tab's pane records go with it. */
export function closeTab(
  model: WorkspaceLayoutModel,
  key: string,
  tabId: string
): WorkspaceLayoutModel {
  const workspace = model.workspaces[key]!
  const tab = findTab(workspace, tabId)!
  let next: WorkspaceLayout = removeTabFromWorkspace(workspace, tabId)
  if (
    tab.kind === 'editor' &&
    next.editorFiles &&
    !next.tabs.some((entry) => entry.entityId === tab.entityId)
  ) {
    next = {
      ...next,
      editorFiles: next.editorFiles.filter((file) => file.filePath !== tab.entityId)
    }
  }
  if (tab.kind === 'browser' && next.browserTabs) {
    next = { ...next, browserTabs: next.browserTabs.filter((entry) => entry.id !== tab.entityId) }
  }
  const updated = withWorkspace(model, key, next)
  if (tab.kind !== 'terminal') {
    return updated
  }
  const records = withoutPaneRecords(updated.records, paneKeysOf(tab))
  return { ...updated, records: advanceTopologyRevision(records, workspace.worktreeId) }
}

export function closeTabs(model: WorkspaceLayoutModel, command: CommandOf<'closeTabs'>): Applied {
  let next = model
  const closed: string[] = []
  const refused: RefusedClose[] = []
  const stopPtyIds: string[] = []
  for (const tabId of command.tabIds) {
    const tab = findTab(next.workspaces[command.workspace]!, tabId)
    if (!tab) {
      closed.push(tabId)
      continue
    }
    if (!command.force && command.refusePinned && tab.isPinned) {
      refused.push({ tabId, code: 'tab_pinned' })
      continue
    }
    if (!command.force && command.dirtyTabIds?.includes(tabId)) {
      refused.push({ tabId, code: 'editor_tab_has_unsaved_draft' })
      continue
    }
    stopPtyIds.push(...boundPtyIds(tab))
    next = closeTab(next, command.workspace, tabId)
    closed.push(tabId)
  }
  return applied(next, { closed, refused }, { stopPtyIds })
}

export function renameTab(model: WorkspaceLayoutModel, command: CommandOf<'renameTab'>): Applied {
  const tab = findTab(model.workspaces[command.workspace]!, command.tabId)
  if (!tab) {
    return refuse('tab_not_found')
  }
  if (command.kind === 'aiVault') {
    return updateTab(model, command.workspace, { ...tab, aiVaultTitle: command.title })
  }
  return updateTab(
    model,
    command.workspace,
    command.kind === 'custom'
      ? { ...tab, customTitle: command.title }
      : { ...tab, generatedTitle: command.title }
  )
}

export function setTabProps(
  model: WorkspaceLayoutModel,
  command: CommandOf<'setTabProps'>
): Applied {
  const workspace = model.workspaces[command.workspace]!
  const tab = findTab(workspace, command.tabId)
  if (!tab) {
    return refuse('tab_not_found')
  }
  const next = {
    ...tab,
    ...(command.color !== undefined ? { color: command.color } : {}),
    ...(command.isPinned !== undefined ? { isPinned: command.isPinned } : {}),
    ...(command.viewMode !== undefined ? { viewMode: command.viewMode } : {})
  }
  let updated = {
    ...workspace,
    tabs: workspace.tabs.map((entry) => (entry.id === tab.id ? next : entry))
  }
  if (command.isPinned !== undefined && command.isPinned !== (tab.isPinned === true)) {
    // Pinning moves the tab to the edge of the pinned run, as the tab bar does.
    updated = {
      ...updated,
      groups: updated.groups.map((group) =>
        group.tabOrder.includes(tab.id)
          ? { ...group, tabOrder: partitionPinnedTabOrder(group.tabOrder, updated.tabs, tab.id) }
          : group
      )
    }
  }
  return applied(withWorkspace(model, command.workspace, updated))
}

export function setChatPane(
  model: WorkspaceLayoutModel,
  command: CommandOf<'setChatPane'>
): Applied {
  const tab = findTerminal(model.workspaces[command.workspace]!, command.tabId)
  if (!tab?.panes) {
    return refuse('tab_not_found')
  }
  if (command.leafId !== null && !layoutContainsLeafId(tab.panes.root, command.leafId)) {
    return refuse('pane_not_found')
  }
  const panes = omitStoredFields(tab.panes, ['chatLeafId'])
  return updateTab(model, command.workspace, {
    ...tab,
    panes: command.leafId === null ? panes : { ...panes, chatLeafId: command.leafId }
  })
}

export function promotePreviewTab(
  model: WorkspaceLayoutModel,
  command: CommandOf<'promotePreviewTab'>
): Applied {
  const tab = findTab(model.workspaces[command.workspace]!, command.tabId)
  if (!tab) {
    return refuse('tab_not_found')
  }
  const promoted = { ...tab }
  delete promoted.isPreview
  return updateTab(model, command.workspace, promoted)
}

/** A new tab replaces the group's preview tab of a compatible kind, as a single click does today. */
export function placeContentTab(
  model: WorkspaceLayoutModel,
  key: string,
  tab: LayoutContentTab,
  groupId: string | undefined,
  context: LayoutContext
): WorkspaceLayoutModel {
  let workspace = workspaceOrEmpty(model, key)
  const group = workspace.groups.find((entry) => entry.id === groupId) ?? workspace.groups[0]
  const preview = tab.isPreview
    ? workspace.tabs.find(
        (entry) =>
          entry.isPreview &&
          group?.tabOrder.includes(entry.id) &&
          canReplacePreviewContentType(tab.kind, entry.kind)
      )
    : undefined
  if (preview) {
    workspace = closeTab(withWorkspace(model, key, workspace), key, preview.id).workspaces[key]!
  }
  return withWorkspace(model, key, placeNewTab(workspace, tab, { groupId: group?.id }, context))
}
