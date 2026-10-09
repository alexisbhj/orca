// Loader rules for panes and bindings that stored data repeats across tabs.

import type { WorkspaceSessionState } from '../workspace-session-state-types'
import { withoutKey } from './stored-record-fields'
import type { DesktopLayoutView, LayoutContentFacts } from './workspace-layout-beside'
import { rekeyPaneRecords } from './workspace-layout-pane-records'
import { isSameTerminal } from './terminal-owner-invariants'
import { collectLayoutLeafIdsInOrder } from './terminal-pane-tree'
import type { WorkspaceLayoutLoadContext } from './workspace-layout-load-types'
import {
  paneKeyOf,
  tabsInOrder,
  type LayoutTerminalPanes,
  type WorkspaceLayoutModel
} from './workspace-layout-model'
import { advanceTopologyRevision, retireExitedSurface } from './workspace-layout-removal'

function terminalTabsInOrder(model: WorkspaceLayoutModel) {
  return Object.entries(model.workspaces).flatMap(([workspaceKey, workspace]) =>
    tabsInOrder(workspace).flatMap((tab) =>
      tab.kind === 'terminal' ? [{ workspaceKey, tab, panes: tab.panes }] : []
    )
  )
}

function renameLeaf(panes: LayoutTerminalPanes, from: string, to: string): LayoutTerminalPanes {
  const rename = (node: LayoutTerminalPanes['root']): LayoutTerminalPanes['root'] => {
    if (!node) {
      return node
    }
    if (node.type === 'leaf') {
      return node.leafId === from ? { type: 'leaf', leafId: to } : node
    }
    return { ...node, first: rename(node.first)!, second: rename(node.second)! }
  }
  const title = panes.titlesByLeafId?.[from]
  const next: LayoutTerminalPanes = {
    ...panes,
    root: rename(panes.root),
    ptyIdsByLeafId: withoutKey(panes.ptyIdsByLeafId, from),
    titlesByLeafId: withoutKey(panes.titlesByLeafId, from)
  }
  if (title !== undefined) {
    next.titlesByLeafId = { ...next.titlesByLeafId, [to]: title }
  }
  if (panes.chatLeafId === from) {
    next.chatLeafId = to
  }
  return next
}

/** Moves what the view and side data key by the old leaf to the new one. */
function rekeyLeafBeside(
  tabId: string,
  from: string,
  to: string,
  beside: { view: DesktopLayoutView; facts: LayoutContentFacts }
): void {
  const selection = beside.view.panes[tabId]
  if (selection?.activeLeafId === from) {
    selection.activeLeafId = to
  }
  if (selection?.expandedLeafId === from) {
    selection.expandedLeafId = to
  }
  const scrollback = beside.facts.scrollback[tabId]
  for (const field of ['buffersByLeafId', 'scrollbackRefsByLeafId'] as const) {
    const byLeaf = scrollback?.[field]
    if (scrollback && byLeaf && Object.hasOwn(byLeaf, from)) {
      scrollback[field] = { ...withoutKey(byLeaf, from), [to]: byLeaf[from]! }
    }
  }
}

/**
 * One pane id in two tabs: the tab first in tab order keeps it; the other gets a new, unbound
 * pane in the same place, and its records follow it. Kept apart so the owner's choice of which
 * tab keeps it is one edit.
 */
export function reassignPanesInTwoTabs(
  model: WorkspaceLayoutModel,
  beside: { view: DesktopLayoutView; facts: LayoutContentFacts },
  context: WorkspaceLayoutLoadContext
): WorkspaceLayoutModel {
  let next = model
  const owners = new Map<string, string>()
  for (const { workspaceKey, tab, panes } of terminalTabsInOrder(model)) {
    let tabPanes = panes
    for (const leafId of collectLayoutLeafIdsInOrder(panes.root)) {
      const owner = owners.get(leafId)
      if (owner === undefined || owner === tab.entityId) {
        owners.set(leafId, tab.entityId)
        continue
      }
      const fresh = context.mintLeafId()
      tabPanes = renameLeaf(tabPanes, leafId, fresh)
      next = rekeyPaneRecords(
        next,
        workspaceKey,
        paneKeyOf(tab.entityId, leafId),
        paneKeyOf(tab.entityId, fresh)
      )
      rekeyLeafBeside(tab.entityId, leafId, fresh, beside)
      owners.set(fresh, tab.entityId)
    }
    // Loaded objects are fresh copies, so replacing panes in place touches no stored data.
    tab.panes = tabPanes
  }
  return next
}

/** One terminal bound in two panes: the first pane in tab order keeps it, the other is unbound. */
export function unbindDuplicateTerminals(model: WorkspaceLayoutModel): void {
  const owners: { ptyId: string; incarnationId?: string }[] = []
  for (const { tab, panes } of terminalTabsInOrder(model)) {
    const bindings = panes.ptyIdsByLeafId
    if (!bindings) {
      continue
    }
    for (const leafId of collectLayoutLeafIdsInOrder(panes.root)) {
      const ptyId = bindings[leafId]
      if (ptyId === undefined) {
        continue
      }
      const incarnationId = model.records.incarnationsByPaneKey?.[paneKeyOf(tab.entityId, leafId)]
      const binding = { ptyId, incarnationId }
      if (owners.some((candidate) => isSameTerminal(candidate, binding))) {
        delete bindings[leafId]
      } else {
        owners.push(binding)
      }
    }
  }
}

/** Legacy per-surface tombstones: applied as today's retirement would, then never written again. */
export function applyLegacySurfaceTombstones(
  model: WorkspaceLayoutModel,
  session: WorkspaceSessionState
): WorkspaceLayoutModel {
  let next = model
  for (const tombstone of Object.values(session.terminalSurfaceTombstonesByPaneKey ?? {})) {
    // Clearing a tombstone must not drop the authority it gave older builds' save merge.
    next = { ...next, records: advanceTopologyRevision(next.records, tombstone.worktreeId) }
    next = retireExitedSurface(next, { ...tombstone, terminalTabId: tombstone.parentTabId }).model
  }
  return next
}
