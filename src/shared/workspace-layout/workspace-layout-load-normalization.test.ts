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
} from './workspace-layout-session.test-fixture'

const onDisk = (session: WorkspaceSessionState): WorkspaceSessionState =>
  JSON.parse(JSON.stringify(session))

function load(session: WorkspaceSessionState) {
  let next = 0
  return loadWorkspaceLayout(LOCAL_EXECUTION_HOST_ID, session, {
    mintId: () => `minted-${++next}`,
    mintLeafId: () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`
  })
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
      ['group_lists_missing_tab', SSH_KEY],
      ['empty_group_dropped', SSH_KEY]
    ])
    // tab-b's pane layout outlived its row: carried as stored, so the rules still report it.
    expect(checkWorkspaceLayoutModelRules([loaded]).map((violation) => violation.rule)).toEqual([
      'pane_without_tab'
    ])
  })

  it('keeps a row stored in two workspaces where the tab bar names it, not by key order', () => {
    const stored = addWorkspace(twoTabs(), SSH_KEY, [
      { id: 'g2', tabs: [{ id: 'tab-c', leaves: [[leaf(3)]] }] }
    ])
    stored.tabsByWorktree[SSH_KEY]!.unshift({
      ...stored.tabsByWorktree[GIT_KEY]![0]!,
      worktreeId: SSH_KEY
    })
    stored.unifiedTabs![GIT_KEY] = stored.unifiedTabs![GIT_KEY]!.filter((tab) => tab.id !== 'tab-a')
    stored.tabGroups![GIT_KEY]![0]!.tabOrder = ['tab-b']
    stored.unifiedTabs![SSH_KEY]!.push({
      ...stored.unifiedTabs![SSH_KEY]![0]!,
      id: 'tab-a',
      entityId: 'tab-a'
    })
    stored.tabGroups![SSH_KEY]![0]!.tabOrder.push('tab-a')
    const loaded = load(stored)
    expect(loaded.normalizations).toContainEqual({
      rule: 'tab_in_two_workspaces_dropped',
      workspaceKey: GIT_KEY,
      ids: ['tab-a']
    })
    expect(loaded.layout.workspaces[SSH_KEY]!.tabs.map((tab) => tab.id)).toContain('tab-a')
    expect(loaded.layout.workspaces[GIT_KEY]!.tabs.map((tab) => tab.id)).toEqual(['tab-b'])
  })

  it('gives the later of two tabs sharing a pane id a new unbound pane', () => {
    const stored = twoTabs()
    stored.terminalLayoutsByTabId['tab-b'] = {
      ...stored.terminalLayoutsByTabId['tab-b']!,
      root: { type: 'leaf', leafId: leaf(1) },
      ptyIdsByLeafId: { [leaf(1)]: 'pty-b' },
      titlesByLeafId: { [leaf(1)]: 'logs' }
    }
    expect(rules(stored)).toEqual(['pane_in_two_tabs'])
    const loaded = load(stored)
    expect(loaded.normalizations.map((entry) => entry.rule)).toEqual([
      'pane_in_two_tabs_reassigned'
    ])
    const saved = saveWorkspaceLayout(loaded)
    const moved = saved.terminalLayoutsByTabId['tab-b']!
    expect(moved.root).toEqual({ type: 'leaf', leafId: expect.not.stringMatching(leaf(1)) })
    expect(moved.ptyIdsByLeafId).toEqual({})
    expect(Object.values(moved.titlesByLeafId ?? {})).toEqual(['logs'])
    expect(saved.terminalLayoutsByTabId['tab-a']!.ptyIdsByLeafId).toEqual({ [leaf(1)]: 'pty-a' })
    expect(rules(saved)).toEqual([])
  })

  it('reports each fact the two records or the workspace records name differently, keeping one', () => {
    const stored = twoTabs()
    stored.unifiedTabs![GIT_KEY]![0]!.color = '#ff0000'
    stored.tabGroups![GIT_KEY]![0]!.worktreeId = 'repo-1::/elsewhere'
    stored.unifiedTabs![GIT_KEY]![1]!.executionHostId = 'ssh:other'
    const loaded = load(stored)
    expect(loaded.normalizations).toEqual([
      { rule: 'worktree_id_disagrees', workspaceKey: GIT_KEY, ids: ['g1'], field: 'worktreeId' },
      { rule: 'row_and_tab_bar_disagree', workspaceKey: GIT_KEY, ids: ['tab-a'], field: 'color' },
      { rule: 'execution_host_disagrees', workspaceKey: GIT_KEY, ids: ['tab-b'] }
    ])
    const saved = saveWorkspaceLayout(loaded)
    expect(saved.unifiedTabs![GIT_KEY]![0]!.color).toBeNull()
    expect(saved.tabGroups![GIT_KEY]![0]!.worktreeId).toBe(GIT_KEY)
    expect(saved.unifiedTabs![GIT_KEY]![1]!.executionHostId).toBe(LOCAL_EXECUTION_HOST_ID)
  })

  it('takes preview from the tab and reports a file record that disagrees', () => {
    const stored = twoTabs()
    stored.openFilesByWorktree = {
      [GIT_KEY]: [
        {
          filePath: '/w/a.ts',
          relativePath: 'a.ts',
          worktreeId: GIT_KEY,
          language: 'ts',
          isPreview: true
        }
      ]
    }
    stored.unifiedTabs![GIT_KEY]!.push({
      ...stored.unifiedTabs![GIT_KEY]![0]!,
      id: 'ed',
      entityId: '/w/a.ts',
      contentType: 'editor',
      sortOrder: 2
    })
    stored.tabGroups![GIT_KEY]![0]!.tabOrder.push('ed')
    const loaded = load(stored)
    expect(loaded.normalizations).toEqual([
      {
        rule: 'preview_flag_disagrees',
        workspaceKey: GIT_KEY,
        ids: ['/w/a.ts'],
        field: 'isPreview'
      }
    ])
    expect(saveWorkspaceLayout(loaded).openFilesByWorktree![GIT_KEY]![0]!.isPreview).toBeUndefined()
  })

  it('re-mints the tab-bar id of a row whose own id another tab already uses, and reports it', () => {
    const stored = twoTabs()
    const [entryA, entryB] = stored.unifiedTabs![GIT_KEY]!
    stored.unifiedTabs![GIT_KEY] = [
      entryA!,
      { ...entryB!, entityId: '/w/b.ts', contentType: 'editor' }
    ]
    const loaded = load(stored)
    expect(loaded.normalizations.map((entry) => entry.rule)).toContain('tab_id_reminted')
    expect(checkWorkspaceLayoutModelRules([loaded])).toEqual([])
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
