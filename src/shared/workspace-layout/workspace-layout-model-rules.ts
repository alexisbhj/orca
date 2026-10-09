// The structural rules, run on exactly what the Serializer writes for the model and what is kept
// beside it, so "saves cleanly" and "obeys the rules" are one claim.

import type { LoadedWorkspaceLayout } from './workspace-layout-load-types'
import { checkWorkspaceLayoutRules, type WorkspaceLayoutViolation } from './workspace-layout-rules'
import { saveWorkspaceLayout } from './workspace-layout-save'

/** Nothing beside the layout: no view selection, facts or pass-through fields. */
export function emptyLayoutBeside(): Omit<LoadedWorkspaceLayout, 'layout'> {
  return {
    desktopView: {
      activeRepoId: null,
      activeWorktreeId: null,
      activeTabId: null,
      groups: {},
      lastFocusedAt: {},
      panes: {},
      editorDrafts: {}
    },
    facts: { tabLabels: {}, terminalRows: {}, scrollback: {}, browserTabs: {} },
    carried: { unownedTerminalLayouts: {} }
  }
}

function partitionOf(loaded: LoadedWorkspaceLayout) {
  return { hostId: loaded.layout.hostId, session: saveWorkspaceLayout(loaded) }
}

export function checkWorkspaceLayoutModelRules(
  loaded: readonly LoadedWorkspaceLayout[],
  previous?: readonly LoadedWorkspaceLayout[]
): WorkspaceLayoutViolation[] {
  return checkWorkspaceLayoutRules(loaded.map(partitionOf), previous?.map(partitionOf))
}
