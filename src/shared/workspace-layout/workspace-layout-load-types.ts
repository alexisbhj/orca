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
    | 'group_lists_missing_tab'
    | 'group_minted'
    | 'legacy_tombstone_applied'
    | 'tab_appended_to_group'
    | 'tab_bar_entry_without_row_dropped'
    | 'tab_in_two_workspaces_dropped'
    | 'tab_listed_twice'
    | 'terminal_in_two_panes_unbound'
  workspaceKey?: string
  ids: string[]
}

export type WorkspaceLayoutLoadContext = {
  /** Mints ids for groups the stored data lacks. */
  mintId: () => string
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
