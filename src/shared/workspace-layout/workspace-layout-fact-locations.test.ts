// Guard against a layout fact gaining a second home in the model: every model field is listed
// with the one fact it holds, and no fact is listed twice. A new field fails until it is placed.

import { describe, expect, it } from 'vitest'
import { LOCAL_EXECUTION_HOST_ID } from '../execution-host'
import { loadWorkspaceLayout } from './workspace-layout-load'
import type { WorkspaceLayoutModel } from './workspace-layout-model'
import { localDesktopSession } from './workspace-layout-profile.test-fixture'
import { leaf } from './workspace-layout-session.test-fixture'

/** Model field path (map keys as `*`, list items as `[]`) → the one layout fact it holds. */
const FACT_LOCATIONS: Record<string, string> = {
  hostId: 'execution host of every record',
  'workspaces.*.worktreeId': 'worktree id of every record of the workspace',
  'workspaces.*.keepsEmptyTerminalRows': 'empty terminal row list is stored',
  'workspaces.*.tabs[].id': 'tab id',
  'workspaces.*.tabs[].entityId': 'tab content id',
  'workspaces.*.tabs[].kind': 'tab kind',
  'workspaces.*.tabs[].namesExecutionHost': 'tab records its host',
  'workspaces.*.tabs[].createdAt': 'tab creation time',
  'workspaces.*.tabs[].customTitle': 'tab custom title',
  'workspaces.*.tabs[].generatedTitle': 'tab generated title',
  'workspaces.*.tabs[].aiVaultTitle': 'tab AI Vault title',
  'workspaces.*.tabs[].quickCommandLabel': 'tab quick command label',
  'workspaces.*.tabs[].color': 'tab color',
  'workspaces.*.tabs[].isPinned': 'tab pin',
  'workspaces.*.tabs[].viewMode': 'tab view mode',
  'workspaces.*.tabs[].isPreview': 'tab preview',
  'workspaces.*.tabs[].agentSessionAgent': 'agent-session provider',
  'workspaces.*.tabs[].terminal.defaultTitle': 'terminal default title',
  'workspaces.*.tabs[].terminal.shellOverride': 'terminal shell',
  'workspaces.*.tabs[].terminal.forceHostRuntime': 'terminal host fallback',
  'workspaces.*.tabs[].terminal.startupCwd': 'terminal start directory',
  'workspaces.*.tabs[].terminal.launchAgent': 'terminal launched agent',
  'workspaces.*.tabs[].terminal.agentLaunchPane': 'terminal agent launch pane',
  'workspaces.*.tabs[].panes.root': 'pane split tree',
  'workspaces.*.tabs[].panes.chatLeafId': 'chat pane',
  'workspaces.*.tabs[].panes.titlesByLeafId': 'pane titles',
  'workspaces.*.tabs[].panes.ptyIdsByLeafId': 'pane terminal bindings',
  'workspaces.*.tabs[].legacyPtyId': 'legacy single-surface terminal binding',
  'workspaces.*.groups[].id': 'group id',
  'workspaces.*.groups[].tabOrder': 'tab order',
  'workspaces.*.groupLayout': 'group split tree',
  'workspaces.*.editorFiles[].filePath': 'editor file path',
  'workspaces.*.editorFiles[].relativePath': 'editor relative path',
  'workspaces.*.editorFiles[].language': 'editor language',
  'workspaces.*.editorFiles[].runtimeEnvironmentId': 'editor file runtime',
  'workspaces.*.editorFiles[].externalSshTargetId': 'editor file SSH target',
  'workspaces.*.editorFiles[].readOnly': 'editor read-only',
  'workspaces.*.editorFiles[].liveTail': 'editor live tail',
  'workspaces.*.browserTabs[].id': 'browser tab id',
  'workspaces.*.browserTabs[].label': 'browser tab label',
  'workspaces.*.browserTabs[].sessionProfileId': 'browser profile',
  'workspaces.*.browserTabs[].sessionPartition': 'browser partition',
  'workspaces.*.browserTabs[].pageIds': 'browser pages',
  'workspaces.*.browserTabs[].createdAt': 'browser tab creation time',
  'records.sleepingByPaneKey': 'sleeping agent records',
  'records.incarnationsByPaneKey': 'pane process incarnations',
  'records.closedTerminalTabTombstones': 'closed terminal tabs',
  'records.defaultTabsAppliedByWorkspace': 'default tabs applied',
  'records.clientHostedBrowserPagesByWorkspace': 'client-hosted browser pages',
  'records.topologyRevisionByRepoId': 'membership revision'
}

/** Leaf paths are the field itself for trees, maps and lists of values. */
const WHOLE_VALUE =
  /(\.root|\.groupLayout|ByLeafId|ByPaneKey|ByRepoId|Tombstones|ByWorkspace|tabOrder|pageIds|agentLaunchPane|aiVaultTitle)$/

function fieldPaths(value: unknown, path: string, out: Set<string>): void {
  if (value === null || value === undefined) {
    return
  }
  if (path && (WHOLE_VALUE.test(path) || typeof value !== 'object')) {
    out.add(path)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => fieldPaths(item, `${path}[]`, out))
    return
  }
  const keyed = path === 'workspaces'
  for (const [key, child] of Object.entries(value)) {
    fieldPaths(child, path ? `${path}.${keyed ? '*' : key}` : key, out)
  }
}

function richModel(): WorkspaceLayoutModel {
  const session = localDesktopSession()
  const key = Object.keys(session.tabsByWorktree)[0]!
  const [row] = session.tabsByWorktree[key]!
  Object.assign(row!, {
    aiVaultTitle: { agent: 'codex', sessionId: 's', title: 't' },
    quickCommandLabel: 'build',
    forceHostRuntime: true,
    agentLaunchPane: { leafId: leaf(1) }
  })
  Object.assign(session.unifiedTabs![key]![0]!, {
    executionHostId: LOCAL_EXECUTION_HOST_ID,
    isPreview: true
  })
  Object.assign(session.openFilesByWorktree![key]![0]!, {
    runtimeEnvironmentId: 'env',
    externalSshTargetId: 'ssh',
    readOnly: true,
    liveTail: true
  })
  Object.assign(session.browserTabsByWorktree![key]![0]!, {
    sessionPartition: 'persist:p',
    sessionProfileId: 'profile-1'
  })
  session.clientHostedBrowserPagesByWorktree = { [key]: [] }
  session.tabsByWorktree[key]!.push({ ...row!, id: 'legacy', ptyId: 'pty-legacy' })
  let next = 0
  return loadWorkspaceLayout(LOCAL_EXECUTION_HOST_ID, session, {
    mintId: () => `m-${++next}`,
    mintLeafId: () => leaf(9)
  }).layout
}

describe('layout facts have one home each', () => {
  it('lists every model field with the one fact it holds, and no fact twice', () => {
    const paths = new Set<string>()
    fieldPaths(richModel(), '', paths)
    expect(
      [...paths].filter((path) => !(path in FACT_LOCATIONS)),
      'unplaced model fields'
    ).toEqual([])
    expect(
      Object.keys(FACT_LOCATIONS).filter((path) => !paths.has(path)),
      'listed but never present'
    ).toEqual([])
    const facts = Object.values(FACT_LOCATIONS)
    expect(
      facts.filter((fact, index) => facts.indexOf(fact) !== index),
      'facts with two homes'
    ).toEqual([])
  })
})
