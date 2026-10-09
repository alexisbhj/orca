import type { ExecutionHostId } from '../execution-host'
import type { WorkspaceSessionState } from '../workspace-session-state-types'
import type {
  CarriedSessionFields,
  DesktopLayoutView,
  LayoutContentFacts
} from './workspace-layout-beside'
import type { WorkspaceLayoutModel } from './workspace-layout-model'

/** One fixed rule the Loader applied to stored data that disagreed with itself. */
export type LayoutLoadNormalization = {
  rule:
    | 'duplicate_group_dropped'
    | 'duplicate_tab_dropped'
    | 'empty_group_dropped'
    | 'execution_host_disagrees'
    | 'group_lists_missing_tab'
    | 'group_minted'
    | 'group_tree_pruned'
    | 'legacy_tombstone_applied'
    | 'pane_in_two_tabs_reassigned'
    | 'preview_flag_disagrees'
    | 'row_and_tab_bar_disagree'
    | 'tab_appended_to_group'
    | 'tab_bar_entry_without_row_dropped'
    | 'tab_id_reminted'
    | 'tab_in_two_workspaces_dropped'
    | 'tab_listed_twice'
    | 'terminal_in_two_panes_unbound'
    | 'worktree_id_disagrees'
  workspaceKey?: string
  ids: string[]
  /** The record field the rule chose a value for, when it names one. */
  field?: string
}

export type WorkspaceLayoutLoadContext = {
  /** Mints ids for groups and tabs the stored data lacks or repeats. */
  mintId: () => string
  /** Mints pane ids (UUIDs) for a pane id two tabs repeat. */
  mintLeafId: () => string
}

/** A stored session partition, split into the layout and what is kept beside it. */
export type LoadedWorkspaceLayout = {
  layout: WorkspaceLayoutModel
  desktopView: DesktopLayoutView
  facts: LayoutContentFacts
  carried: CarriedSessionFields
}

export type WorkspaceLayoutLoadResult = LoadedWorkspaceLayout & {
  normalizations: LayoutLoadNormalization[]
}

export type WorkspaceLoadArgs = {
  session: WorkspaceSessionState
  hostId: ExecutionHostId
  key: string
  /** Terminal tab id → the one workspace that keeps its row. */
  terminalHomes: ReadonlyMap<string, string>
  context: WorkspaceLayoutLoadContext
  view: DesktopLayoutView
  facts: LayoutContentFacts
  normalizations: LayoutLoadNormalization[]
}
