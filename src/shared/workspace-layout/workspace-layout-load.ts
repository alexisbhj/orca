// Loader: one stored session partition (as the Store loads it, after its pane identity
// normalization) into the layout model and what is kept beside it. Runs on every load because an
// older build can write the same documents between upgrades. Stored data that disagrees with
// itself is resolved by fixed rules and reported; nothing is merged.

import type { ExecutionHostId } from '../execution-host'
import type { WorkspaceSessionState } from '../workspace-session-state-types'
import {
  CARRIED_SESSION_FIELDS,
  FACT_SESSION_FIELDS,
  VIEW_SESSION_FIELDS,
  type CarriedSessionFields,
  type DesktopLayoutView,
  type LayoutContentFacts
} from './workspace-layout-beside'
import { pickStoredFields } from './stored-record-fields'
import {
  applyLegacySurfaceTombstones,
  reassignPanesInTwoTabs,
  unbindDuplicateTerminals
} from './workspace-layout-load-bindings'
import type {
  LayoutLoadNormalization,
  WorkspaceLayoutLoadContext,
  WorkspaceLayoutLoadResult
} from './workspace-layout-load-types'
import { loadWorkspace } from './workspace-layout-load-workspace'
import type { WorkspaceLayoutModel, WorkspaceLayoutRecords } from './workspace-layout-model'

function workspaceKeys(session: WorkspaceSessionState): string[] {
  return [
    ...new Set([
      ...Object.keys(session.tabsByWorktree ?? {}),
      ...Object.keys(session.unifiedTabs ?? {}),
      ...Object.keys(session.tabGroups ?? {}),
      ...Object.keys(session.tabGroupLayouts ?? {}),
      ...Object.keys(session.openFilesByWorktree ?? {}),
      ...Object.keys(session.browserTabsByWorktree ?? {})
    ])
  ]
}

/**
 * A terminal row stored in two workspaces is kept where the tab bar or a group also names it,
 * else in the first; the other copies are dropped and reported by the workspace load.
 */
function resolveTerminalHomes(session: WorkspaceSessionState): Map<string, string> {
  const homes = new Map<string, string>()
  const namedByTabBar = (key: string, tabId: string): boolean =>
    (session.unifiedTabs?.[key] ?? []).some(
      (entry) => entry.contentType === 'terminal' && entry.entityId === tabId
    ) || (session.tabGroups?.[key] ?? []).some((group) => group.tabOrder.includes(tabId))
  for (const [key, rows] of Object.entries(session.tabsByWorktree ?? {})) {
    for (const row of rows) {
      const home = homes.get(row.id)
      if (home === undefined || (!namedByTabBar(home, row.id) && namedByTabBar(key, row.id))) {
        homes.set(row.id, key)
      }
    }
  }
  return homes
}

function loadRecords(session: WorkspaceSessionState): WorkspaceLayoutRecords {
  const records: WorkspaceLayoutRecords = {}
  const assign = <K extends keyof WorkspaceLayoutRecords>(
    key: K,
    value: WorkspaceLayoutRecords[K]
  ) => {
    if (value !== undefined) {
      records[key] = value
    }
  }
  assign('sleepingByPaneKey', session.sleepingAgentSessionsByPaneKey)
  assign('incarnationsByPaneKey', session.terminalPtyIncarnationsByPaneKey)
  assign('closedTerminalTabTombstones', session.closedTerminalTabTombstonesByTabId)
  assign('defaultTabsAppliedByWorkspace', session.defaultTerminalTabsAppliedByWorktreeId)
  assign('clientHostedBrowserPagesByWorkspace', session.clientHostedBrowserPagesByWorktree)
  assign('topologyRevisionByRepoId', session.terminalTopologyRevisionByRepoId)
  return records
}

export function loadWorkspaceLayout(
  hostId: ExecutionHostId,
  stored: WorkspaceSessionState,
  context: WorkspaceLayoutLoadContext
): WorkspaceLayoutLoadResult {
  // The Loader edits its own copy; the Store's object stays untouched.
  const session = structuredClone(stored)
  const normalizations: LayoutLoadNormalization[] = []
  const desktopView: DesktopLayoutView = {
    ...pickStoredFields(session, VIEW_SESSION_FIELDS),
    activeRepoId: session.activeRepoId,
    activeWorktreeId: session.activeWorktreeId,
    activeTabId: session.activeTabId,
    groups: {},
    lastFocusedAt: {},
    panes: {},
    editorDrafts: {}
  }
  const facts: LayoutContentFacts = {
    ...pickStoredFields(session, FACT_SESSION_FIELDS),
    tabLabels: {},
    terminalRows: {},
    scrollback: {},
    browserTabs: {}
  }
  let layout: WorkspaceLayoutModel = { hostId, workspaces: {}, records: loadRecords(session) }
  const terminalHomes = resolveTerminalHomes(session)
  for (const key of workspaceKeys(session)) {
    layout.workspaces[key] = loadWorkspace({
      session,
      hostId,
      key,
      terminalHomes,
      context,
      view: desktopView,
      facts,
      normalizations
    })
  }
  const carried: CarriedSessionFields = {
    ...pickStoredFields(session, CARRIED_SESSION_FIELDS),
    unownedTerminalLayouts: Object.fromEntries(
      Object.entries(session.terminalLayoutsByTabId ?? {}).filter(
        ([tabId]) => !terminalHomes.has(tabId)
      )
    )
  }
  reassignPanesInTwoTabs(layout, { view: desktopView, facts }, context, normalizations)
  unbindDuplicateTerminals(layout, normalizations)
  layout = applyLegacySurfaceTombstones(layout, session, normalizations)
  return { layout, desktopView, facts, carried, normalizations }
}
