import type { WorkspaceSessionState } from '../workspace-session-state-types'
import { isSameTerminal } from './terminal-owner-invariants'
import { collectLayoutLeafIdsInOrder, layoutContainsLeafId } from './terminal-pane-tree'
import type { LayoutContentFacts } from './workspace-layout-beside'
import type { LayoutLoadNormalization } from './workspace-layout-load-types'
import { paneKeyOf, tabsInOrder, type WorkspaceLayoutModel } from './workspace-layout-model'
import {
  advanceTopologyRevision,
  findTerminalTab,
  retireTerminalPane
} from './workspace-layout-removal'

/** One terminal bound in two panes: the first pane in tab order keeps it, the other is unbound. */
export function unbindDuplicateTerminals(
  model: WorkspaceLayoutModel,
  normalizations: LayoutLoadNormalization[]
): void {
  const owners: { ptyId: string; incarnationId?: string; paneKey: string }[] = []
  for (const [workspaceKey, workspace] of Object.entries(model.workspaces)) {
    for (const tab of tabsInOrder(workspace)) {
      if (tab.kind !== 'terminal' || !tab.panes?.ptyIdsByLeafId) {
        continue
      }
      for (const leafId of collectLayoutLeafIdsInOrder(tab.panes.root)) {
        const ptyId = tab.panes.ptyIdsByLeafId[leafId]
        if (ptyId === undefined) {
          continue
        }
        const paneKey = paneKeyOf(tab.entityId, leafId)
        const binding = {
          ptyId,
          incarnationId: model.records.incarnationsByPaneKey?.[paneKey],
          paneKey
        }
        const owner = owners.find((candidate) => isSameTerminal(candidate, binding))
        if (owner) {
          // Loaded objects are fresh copies, so unbinding in place touches no stored data.
          delete tab.panes.ptyIdsByLeafId[leafId]
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
}

/** Legacy per-surface tombstones: applied as today's retirement would, then never written again. */
export function applyLegacySurfaceTombstones(
  model: WorkspaceLayoutModel,
  session: WorkspaceSessionState,
  facts: LayoutContentFacts,
  normalizations: LayoutLoadNormalization[]
): WorkspaceLayoutModel {
  let next = model
  for (const [paneKey, tombstone] of Object.entries(
    session.terminalSurfaceTombstonesByPaneKey ?? {}
  )) {
    normalizations.push({ rule: 'legacy_tombstone_applied', ids: [paneKey] })
    // Clearing a tombstone must not drop the authority it gave older builds' save merge.
    next = { ...next, records: advanceTopologyRevision(next.records, tombstone.worktreeId) }
    const incarnation = next.records.incarnationsByPaneKey?.[paneKey]
    if (tombstone.incarnationId && incarnation && incarnation !== tombstone.incarnationId) {
      continue
    }
    const location = findTerminalTab(next, tombstone.parentTabId)
    const panes = location?.tab.panes
    const inTree = Boolean(panes && layoutContainsLeafId(panes.root, tombstone.leafId))
    const boundPtyId = inTree ? panes?.ptyIdsByLeafId?.[tombstone.leafId] : undefined
    if (boundPtyId && boundPtyId !== tombstone.ptyId) {
      continue
    }
    const row = facts.terminalRows[tombstone.parentTabId]
    if (!location || !(inTree || (!panes && row?.ptyId === tombstone.ptyId))) {
      next = {
        ...next,
        records: { ...next.records, incarnationsByPaneKey: withoutPaneKey(next, paneKey) }
      }
      continue
    }
    next = retireTerminalPane(next, location, tombstone.leafId)
    const remaining = findTerminalTab(next, tombstone.parentTabId)?.tab.panes
    if (row && remaining) {
      const activeLeafId = session.terminalLayoutsByTabId?.[tombstone.parentTabId]?.activeLeafId
      row.ptyId =
        remaining.ptyIdsByLeafId?.[activeLeafId ?? ''] ??
        Object.values(remaining.ptyIdsByLeafId ?? {})[0] ??
        null
    }
  }
  return next
}

function withoutPaneKey(
  model: WorkspaceLayoutModel,
  paneKey: string
): Record<string, string> | undefined {
  const incarnations = model.records.incarnationsByPaneKey
  if (!incarnations || !Object.hasOwn(incarnations, paneKey)) {
    return incarnations
  }
  const { [paneKey]: _retired, ...rest } = incarnations
  void _retired
  return rest
}
