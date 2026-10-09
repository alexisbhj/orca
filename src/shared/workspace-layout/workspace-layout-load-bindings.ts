// Loader rules for panes and bindings that stored data repeats across tabs.

import type { WorkspaceSessionState } from '../workspace-session-state-types'
import { withoutKey } from './stored-record-fields'
import { isSameTerminal } from './terminal-owner-invariants'
import { collectLayoutLeafIdsInOrder } from './terminal-pane-tree'
import type {
  LayoutLoadNormalization,
  WorkspaceLayoutLoadContext
} from './workspace-layout-load-types'
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
      tab.kind === 'terminal' && tab.panes ? [{ workspaceKey, tab, panes: tab.panes }] : []
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

/**
 * One pane id in two tabs: the tab first in tab order keeps it; the other gets a new, unbound
 * pane in the same place. Kept apart so the owner's choice of which tab keeps it is one edit.
 */
export function reassignPanesInTwoTabs(
  model: WorkspaceLayoutModel,
  context: WorkspaceLayoutLoadContext,
  normalizations: LayoutLoadNormalization[]
): void {
  const owners = new Map<string, string>()
  for (const { workspaceKey, tab, panes } of terminalTabsInOrder(model)) {
    let next = panes
    for (const leafId of collectLayoutLeafIdsInOrder(panes.root)) {
      const owner = owners.get(leafId)
      if (owner === undefined || owner === tab.entityId) {
        owners.set(leafId, tab.entityId)
        continue
      }
      const fresh = context.mintLeafId()
      next = renameLeaf(next, leafId, fresh)
      owners.set(fresh, tab.entityId)
      normalizations.push({
        rule: 'pane_in_two_tabs_reassigned',
        workspaceKey,
        ids: [leafId, owner, tab.entityId, fresh]
      })
    }
    // Loaded objects are fresh copies, so replacing panes in place touches no stored data.
    tab.panes = next
  }
}

/** One terminal bound in two panes: the first pane in tab order keeps it, the other is unbound. */
export function unbindDuplicateTerminals(
  model: WorkspaceLayoutModel,
  normalizations: LayoutLoadNormalization[]
): void {
  const owners: { ptyId: string; incarnationId?: string; paneKey: string }[] = []
  for (const { workspaceKey, tab, panes } of terminalTabsInOrder(model)) {
    const bindings = panes.ptyIdsByLeafId
    if (!bindings) {
      continue
    }
    for (const leafId of collectLayoutLeafIdsInOrder(panes.root)) {
      const ptyId = bindings[leafId]
      if (ptyId === undefined) {
        continue
      }
      const paneKey = paneKeyOf(tab.entityId, leafId)
      const incarnationId = model.records.incarnationsByPaneKey?.[paneKey]
      const binding = { ptyId, incarnationId, paneKey }
      const owner = owners.find((candidate) => isSameTerminal(candidate, binding))
      if (owner) {
        delete bindings[leafId]
        normalizations.push({
          rule: 'terminal_in_two_panes_unbound',
          workspaceKey,
          ids: [ptyId, owner.paneKey, paneKey]
        })
      } else {
        owners.push(binding)
      }
    }
  }
}

/** Legacy per-surface tombstones: applied as today's retirement would, then never written again. */
export function applyLegacySurfaceTombstones(
  model: WorkspaceLayoutModel,
  session: WorkspaceSessionState,
  normalizations: LayoutLoadNormalization[]
): WorkspaceLayoutModel {
  let next = model
  for (const [paneKey, tombstone] of Object.entries(
    session.terminalSurfaceTombstonesByPaneKey ?? {}
  )) {
    normalizations.push({ rule: 'legacy_tombstone_applied', ids: [paneKey] })
    // Clearing a tombstone must not drop the authority it gave older builds' save merge.
    next = { ...next, records: advanceTopologyRevision(next.records, tombstone.worktreeId) }
    next = retireExitedSurface(next, { ...tombstone, terminalTabId: tombstone.parentTabId }).model
  }
  return next
}
