// Stored data older builds can leave disagreeing with itself. Each case is one fixed Loader rule
// from the design (section 7); everything the rule does not name must survive unchanged.

import { describe, expect, it } from 'vitest'
import { LOCAL_EXECUTION_HOST_ID } from '../execution-host'
import type { WorkspaceSessionState } from '../workspace-session-state-types'
import { loadWorkspaceLayout } from './workspace-layout-load'
import { checkWorkspaceLayoutModelRules } from './workspace-layout-model-rules'
import { checkWorkspaceLayoutRules } from './workspace-layout-rules'
import { saveWorkspaceLayout } from './workspace-layout-save'
import {
  addWorkspace,
  emptySession,
  GIT_KEY,
  leaf,
  SSH_KEY
} from './workspace-layout-session-fixtures'

const onDisk = (session: WorkspaceSessionState): WorkspaceSessionState =>
  JSON.parse(JSON.stringify(session))

function load(session: WorkspaceSessionState) {
  let next = 0
  return loadWorkspaceLayout(LOCAL_EXECUTION_HOST_ID, session, { mintId: () => `minted-${++next}` })
}

function twoTabs(): WorkspaceSessionState {
  return addWorkspace(emptySession(), GIT_KEY, [
    {
      id: 'g1',
      tabs: [
        { id: 'tab-a', leaves: [[leaf(1), 'pty-a']] },
        { id: 'tab-b', leaves: [[leaf(2), 'pty-b']] }
      ]
    }
  ])
}

const rules = (session: WorkspaceSessionState) =>
  checkWorkspaceLayoutRules([{ hostId: LOCAL_EXECUTION_HOST_ID, session }]).map(
    (violation) => violation.rule
  )

describe('Loader fixed rules for stored data that disagrees with itself', () => {
  it('gives terminal rows saved without a tab bar (headless runtime) an entry in a new first group', () => {
    const stored = twoTabs()
    stored.unifiedTabs = {}
    stored.tabGroups = {}
    stored.tabGroupLayouts = {}
    expect(rules(stored)).toEqual(['tab_bar_missing'])
    const loaded = load(stored)
    expect(loaded.normalizations.map((entry) => entry.rule)).toEqual([
      'group_minted',
      'tab_appended_to_group',
      'tab_appended_to_group'
    ])
    const saved = saveWorkspaceLayout(loaded)
    expect(saved.tabGroups?.[GIT_KEY]).toEqual([
      { id: 'minted-1', worktreeId: GIT_KEY, activeTabId: null, tabOrder: ['tab-a', 'tab-b'] }
    ])
    expect(saved.unifiedTabs?.[GIT_KEY]?.map((tab) => [tab.id, tab.label, tab.sortOrder])).toEqual([
      ['tab-a', 'Terminal 1', 0],
      ['tab-b', 'Terminal 2', 1]
    ])
    expect(saved.tabGroupLayouts?.[GIT_KEY]).toEqual({ type: 'leaf', groupId: 'minted-1' })
    expect(onDisk(saved).tabsByWorktree).toEqual(onDisk(stored).tabsByWorktree)
    expect(rules(saved)).toEqual([])
  })

  it('takes the group tab order over both sortOrders and rewrites rows and sortOrders from it', () => {
    const stored = twoTabs()
    stored.tabGroups![GIT_KEY]![0]!.tabOrder = ['tab-b', 'tab-a']
    stored.tabsByWorktree[GIT_KEY]![1]!.sortOrder = 9
    expect(rules(stored)).toEqual(['tab_order_disagrees'])
    const loaded = load(stored)
    expect(loaded.normalizations).toEqual([])
    const saved = saveWorkspaceLayout(loaded)
    expect(saved.tabsByWorktree[GIT_KEY]!.map((row) => [row.id, row.sortOrder])).toEqual([
      ['tab-b', 0],
      ['tab-a', 1]
    ])
    expect(rules(saved)).toEqual([])
    expect(saved.unifiedTabs![GIT_KEY]!.map((tab) => [tab.id, tab.sortOrder])).toEqual([
      ['tab-a', 1],
      ['tab-b', 0]
    ])
  })

  it('orders a tab no group lists by tab-bar sortOrder, then row sortOrder, then creation time', () => {
    const stored = twoTabs()
    stored.tabGroups![GIT_KEY]![0]!.tabOrder = []
    stored.unifiedTabs![GIT_KEY]![0]!.sortOrder = 5
    const loaded = load(stored)
    expect(loaded.layout.workspaces[GIT_KEY]!.groups[0]!.tabOrder).toEqual(['tab-b', 'tab-a'])
  })

  it('unbinds the later of two panes bound to one terminal, in tab order', () => {
    const stored = twoTabs()
    stored.terminalLayoutsByTabId['tab-b']!.ptyIdsByLeafId = { [leaf(2)]: 'pty-a' }
    expect(rules(stored)).toEqual(['terminal_in_two_panes'])
    const loaded = load(stored)
    expect(loaded.normalizations).toEqual([
      {
        rule: 'terminal_in_two_panes_unbound',
        workspaceKey: GIT_KEY,
        ids: ['pty-a', `tab-a:${leaf(1)}`, `tab-b:${leaf(2)}`]
      }
    ])
    const saved = saveWorkspaceLayout(loaded)
    expect(saved.terminalLayoutsByTabId['tab-a']!.ptyIdsByLeafId).toEqual({ [leaf(1)]: 'pty-a' })
    expect(saved.terminalLayoutsByTabId['tab-b']!.ptyIdsByLeafId).toEqual({})
    expect(rules(saved)).toEqual([])
  })

  it('drops a tab-bar terminal entry whose row is gone and a row a second workspace repeats', () => {
    const stored = addWorkspace(twoTabs(), SSH_KEY, [
      { id: 'g2', tabs: [{ id: 'tab-a', leaves: [[leaf(3)]] }] }
    ])
    stored.tabsByWorktree[GIT_KEY] = stored.tabsByWorktree[GIT_KEY]!.filter(
      (row) => row.id !== 'tab-b'
    )
    const loaded = load(stored)
    expect(loaded.normalizations.map((entry) => [entry.rule, entry.workspaceKey])).toEqual([
      ['tab_bar_entry_without_row_dropped', GIT_KEY],
      ['group_lists_missing_tab', GIT_KEY],
      ['tab_in_two_workspaces_dropped', SSH_KEY],
      ['tab_bar_entry_without_row_dropped', SSH_KEY],
      ['group_lists_missing_tab', SSH_KEY]
    ])
    expect(checkWorkspaceLayoutModelRules([loaded.layout])).toEqual([])
  })

  it('applies a legacy surface tombstone once: the pane closes, the tombstone is cleared, authority stays', () => {
    const stored = twoTabs()
    stored.terminalSurfaceTombstonesByPaneKey = {
      [`tab-b:${leaf(2)}`]: {
        worktreeId: GIT_KEY,
        parentTabId: 'tab-b',
        leafId: leaf(2),
        ptyId: 'pty-b',
        incarnationId: 'inc',
        retiredAt: 1
      }
    }
    const saved = saveWorkspaceLayout(load(stored))
    expect(saved.terminalSurfaceTombstonesByPaneKey).toBeUndefined()
    expect(saved.tabsByWorktree[GIT_KEY]!.map((row) => row.id)).toEqual(['tab-a'])
    expect(saved.tabGroups![GIT_KEY]![0]!.tabOrder).toEqual(['tab-a'])
    expect(saved.terminalLayoutsByTabId['tab-b']).toBeUndefined()
    expect(saved.terminalTopologyRevisionByRepoId!['repo-1']).toBeGreaterThan(0)
    expect(load(saved).normalizations).toEqual([])
  })

  it('keeps a tombstone whose pane now shows another terminal from closing it', () => {
    const stored = twoTabs()
    stored.terminalSurfaceTombstonesByPaneKey = {
      [`tab-b:${leaf(2)}`]: {
        worktreeId: GIT_KEY,
        parentTabId: 'tab-b',
        leafId: leaf(2),
        ptyId: 'pty-old',
        incarnationId: 'inc',
        retiredAt: 1
      }
    }
    const saved = saveWorkspaceLayout(load(stored))
    expect(saved.tabsByWorktree[GIT_KEY]!.map((row) => row.id)).toEqual(['tab-a', 'tab-b'])
    expect(saved.terminalSurfaceTombstonesByPaneKey).toBeUndefined()
  })

  it('carries a legacy row with no pane layout and an unowned pane layout through unchanged', () => {
    const stored = twoTabs()
    delete stored.terminalLayoutsByTabId['tab-b']
    stored.terminalLayoutsByTabId['tab-gone'] = {
      root: { type: 'leaf', leafId: leaf(7) },
      activeLeafId: leaf(7),
      expandedLeafId: null
    }
    const loaded = load(stored)
    expect(loaded.normalizations).toEqual([])
    const saved = saveWorkspaceLayout(loaded)
    expect(onDisk(saved)).toEqual(onDisk(stored))
    // Carried, not repaired: the rules check still reports it.
    expect(rules(saved)).toEqual(['pane_without_tab'])
  })
})
