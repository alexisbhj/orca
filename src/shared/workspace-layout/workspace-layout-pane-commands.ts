// Commands on the panes of one terminal tab. Pane ids never change; a moved pane keeps its id
// and its terminal.

import { withoutKey } from './stored-record-fields'
import { getNextTerminalOrdinal } from './terminal-tab-ordinal'
import { rekeyPaneRecords } from './workspace-layout-pane-records'
import {
  equalizeLayout,
  insertLeafBeside,
  layoutContainsLeafId,
  removeLayoutLeaf,
  samePanesIgnoringRatios
} from './terminal-pane-tree'
import {
  applied,
  findTerminal,
  leafIdsOf,
  placeNewTab,
  refuse,
  updateTab,
  type Applied
} from './workspace-layout-command-steps'
import type { CommandOf, LayoutContext } from './workspace-layout-command-types'
import {
  paneKeyOf,
  type LayoutTerminalTab,
  type WorkspaceLayoutModel
} from './workspace-layout-model'
import {
  advanceTopologyRevision,
  retireTerminalPane,
  withWorkspace
} from './workspace-layout-removal'

type PaneCommand = { workspace: string; tabId: string }

function paneTab(model: WorkspaceLayoutModel, command: PaneCommand): LayoutTerminalTab | null {
  const tab = findTerminal(model.workspaces[command.workspace]!, command.tabId)
  return tab?.panes.root ? tab : null
}

export function splitPane(
  model: WorkspaceLayoutModel,
  command: CommandOf<'splitPane'>,
  context: LayoutContext
): Applied {
  const tab = paneTab(model, command)
  if (!tab) {
    return refuse('tab_not_found')
  }
  if (!layoutContainsLeafId(tab.panes.root, command.leafId)) {
    return refuse('pane_not_found')
  }
  const leafId = context.mintLeafId()
  const side = command.direction === 'vertical' ? 'right' : 'bottom'
  const root = insertLeafBeside(tab.panes.root!, command.leafId, leafId, side, command.ratio)
  const next = updateTab(model, command.workspace, { ...tab, panes: { ...tab.panes, root } })
  if (!next.ok) {
    return next
  }
  const paneKey = paneKeyOf(tab.entityId, leafId)
  return applied(
    {
      ...next.model,
      records: advanceTopologyRevision(
        next.model.records,
        model.workspaces[command.workspace]!.worktreeId
      )
    },
    { leafId, paneKey },
    { startPaneKeys: [paneKey] }
  )
}

/** Closing a pane that is already gone succeeds; the last pane closes its tab. */
export function closePane(model: WorkspaceLayoutModel, command: CommandOf<'closePane'>): Applied {
  const tab = findTerminal(model.workspaces[command.workspace]!, command.tabId)
  if (!tab || !layoutContainsLeafId(tab.panes.root, command.leafId)) {
    return applied(model, { alreadyClosed: true })
  }
  const ptyId = tab.panes.ptyIdsByLeafId?.[command.leafId]
  const retired = retireTerminalPane(
    model,
    { workspaceKey: command.workspace, tab },
    command.leafId
  )
  const workspace = retired.workspaces[command.workspace]!
  const tabClosed = !workspace.tabs.some((entry) => entry.id === tab.id)
  const sleepingByPaneKey = withoutKey(
    workspace.sleepingByPaneKey,
    paneKeyOf(tab.entityId, command.leafId)
  )
  return applied(
    withWorkspace(retired, command.workspace, { ...workspace, sleepingByPaneKey }),
    { tabClosed },
    { stopPtyIds: ptyId ? [ptyId] : [] }
  )
}

export function movePane(model: WorkspaceLayoutModel, command: CommandOf<'movePane'>): Applied {
  if (command.leafId === command.targetLeafId) {
    return refuse('same_pane')
  }
  const tab = paneTab(model, command)
  if (!tab) {
    return refuse('tab_not_found')
  }
  const { root } = tab.panes
  if (
    !layoutContainsLeafId(root, command.leafId) ||
    !layoutContainsLeafId(root, command.targetLeafId)
  ) {
    return refuse('pane_not_found')
  }
  const without = removeLayoutLeaf(root, command.leafId)!
  const moved = insertLeafBeside(without, command.targetLeafId, command.leafId, command.side)
  return updateTab(model, command.workspace, { ...tab, panes: { ...tab.panes, root: moved } })
}

/** Divider sizes only: a different tree or different panes is refused (rule 11). */
export function setPaneRatios(
  model: WorkspaceLayoutModel,
  command: CommandOf<'setPaneRatios'>
): Applied {
  const tab = paneTab(model, command)
  if (!tab) {
    return refuse('tab_not_found')
  }
  if (!samePanesIgnoringRatios(tab.panes.root!, command.root)) {
    return refuse('pane_structure_changed')
  }
  return updateTab(model, command.workspace, {
    ...tab,
    panes: { ...tab.panes, root: command.root }
  })
}

export function equalizePanes(
  model: WorkspaceLayoutModel,
  command: CommandOf<'equalizePanes'>
): Applied {
  const tab = paneTab(model, command)
  if (!tab) {
    return refuse('tab_not_found')
  }
  return updateTab(model, command.workspace, {
    ...tab,
    panes: { ...tab.panes, root: equalizeLayout(tab.panes.root!) }
  })
}

export function renamePane(model: WorkspaceLayoutModel, command: CommandOf<'renamePane'>): Applied {
  const tab = paneTab(model, command)
  if (!tab) {
    return refuse('tab_not_found')
  }
  if (!layoutContainsLeafId(tab.panes.root, command.leafId)) {
    return refuse('pane_not_found')
  }
  const titles = withoutKey(tab.panes.titlesByLeafId, command.leafId) ?? {}
  const titlesByLeafId =
    command.title === null ? titles : { ...titles, [command.leafId]: command.title }
  return updateTab(model, command.workspace, { ...tab, panes: { ...tab.panes, titlesByLeafId } })
}

/** Drag-out (#25380): the pane keeps its id and terminal; only the tab half of its key changes. */
export function movePaneToNewTab(
  model: WorkspaceLayoutModel,
  command: CommandOf<'movePaneToNewTab'>,
  context: LayoutContext
): Applied {
  const tab = paneTab(model, command)
  if (!tab) {
    return refuse('tab_not_found')
  }
  if (!layoutContainsLeafId(tab.panes.root, command.leafId)) {
    return refuse('pane_not_found')
  }
  if (leafIdsOf(tab).length < 2) {
    return refuse('last_pane')
  }
  const { leafId } = command
  const workspace = model.workspaces[command.workspace]!
  const ptyId = tab.panes.ptyIdsByLeafId?.[leafId]
  const title = tab.panes.titlesByLeafId?.[leafId]
  const id = context.mintId()
  const terminals = workspace.tabs.flatMap((entry) => (entry.kind === 'terminal' ? [entry] : []))
  const ordinal = getNextTerminalOrdinal(
    terminals.map((entry) => ({ defaultTitle: entry.terminal.defaultTitle, title: '' }))
  )
  const moved: LayoutTerminalTab = {
    id,
    entityId: id,
    createdAt: context.now(),
    customTitle: null,
    color: null,
    kind: 'terminal',
    terminal: {
      defaultTitle: `Terminal ${ordinal}`,
      ...(tab.terminal.startupCwd ? { startupCwd: tab.terminal.startupCwd } : {}),
      ...(tab.terminal.shellOverride ? { shellOverride: tab.terminal.shellOverride } : {})
    },
    panes: {
      root: { type: 'leaf', leafId },
      ...(ptyId ? { ptyIdsByLeafId: { [leafId]: ptyId } } : {}),
      ...(title ? { titlesByLeafId: { [leafId]: title } } : {}),
      ...(tab.panes.chatLeafId === leafId ? { chatLeafId: leafId } : {})
    }
  }
  const source: LayoutTerminalTab = {
    ...tab,
    panes: {
      ...tab.panes,
      root: removeLayoutLeaf(tab.panes.root, leafId),
      ptyIdsByLeafId: withoutKey(tab.panes.ptyIdsByLeafId, leafId),
      titlesByLeafId: withoutKey(tab.panes.titlesByLeafId, leafId)
    }
  }
  if (source.panes.chatLeafId === leafId) {
    delete source.panes.chatLeafId
  }
  const sourceGroup = workspace.groups.find((group) => group.tabOrder.includes(tab.id))
  const withSource = {
    ...workspace,
    tabs: workspace.tabs.map((entry) => (entry.id === tab.id ? source : entry))
  }
  const placed = placeNewTab(
    withSource,
    moved,
    {
      groupId: command.groupId ?? sourceGroup?.id,
      index: command.index,
      afterTabId: command.index === undefined ? tab.id : undefined
    },
    context
  )
  const next = rekeyPaneRecords(
    withWorkspace(model, command.workspace, placed),
    command.workspace,
    paneKeyOf(tab.entityId, leafId),
    paneKeyOf(id, leafId)
  )
  return applied(
    { ...next, records: advanceTopologyRevision(next.records, workspace.worktreeId) },
    { tabId: id }
  )
}
