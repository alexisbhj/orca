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
  const claimedTerminalIds = new Set<string>()
  for (const key of workspaceKeys(session)) {
    layout.workspaces[key] = loadWorkspace({
      session,
      key,
      claimedTerminalIds,
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
        ([tabId]) => !claimedTerminalIds.has(tabId)
      )
    )
  }
  unbindDuplicateTerminals(layout, normalizations)
  layout = applyLegacySurfaceTombstones(layout, session, facts, normalizations)
  return { layout, desktopView, facts, carried, normalizations }
}
