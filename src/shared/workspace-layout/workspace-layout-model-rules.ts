// The structural rules, run on the model through the same projection the Serializer writes, so a
// model that saves cleanly and a model that obeys the rules are the same claim.

import type { LoadedWorkspaceLayout } from './workspace-layout-load-types'
import type { WorkspaceLayoutModel } from './workspace-layout-model'
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

function partitionOf(layout: WorkspaceLayoutModel) {
  return { hostId: layout.hostId, session: saveWorkspaceLayout({ ...emptyLayoutBeside(), layout }) }
}

export function checkWorkspaceLayoutModelRules(
  models: readonly WorkspaceLayoutModel[],
  previous?: readonly WorkspaceLayoutModel[]
): WorkspaceLayoutViolation[] {
  return checkWorkspaceLayoutRules(models.map(partitionOf), previous?.map(partitionOf))
}
