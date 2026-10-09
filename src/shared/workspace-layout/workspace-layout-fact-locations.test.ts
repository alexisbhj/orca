// Every on-disk field is written from exactly one model or side-data field, and on-disk fields
// that are copies of one fact are written from the same one. The tables are typed over the disk
// record types and every model and side-data field, so a new field fails typecheck until placed;
// the test then mutates each source and checks the Serializer writes only what the tables claim.

import { describe, expect, it } from 'vitest'
import type { BrowserWorkspace } from '../browser-workspace-types'
import { LOCAL_EXECUTION_HOST_ID } from '../execution-host'
import type { Tab, TabGroup } from '../tab-types'
import type { TerminalLayoutSnapshot, TerminalTab } from '../terminal-tab-types'
import type { PersistedOpenFile, WorkspaceSessionState } from '../workspace-session-state-types'
import type {
  BrowserTabLiveState,
  CarriedSessionFields,
  DesktopLayoutView,
  EditorDraft,
  LayoutContentFacts,
  TerminalRowFacts
} from './workspace-layout-beside'
import { loadWorkspaceLayout } from './workspace-layout-load'
import type { LoadedWorkspaceLayout } from './workspace-layout-load-types'
import type {
  LayoutBrowserTab,
  LayoutContentTab,
  LayoutEditorFile,
  LayoutGroup,
  LayoutTerminalCreation,
  LayoutTerminalPanes,
  LayoutTerminalTab,
  WorkspaceLayout,
  WorkspaceLayoutRecords
} from './workspace-layout-model'
import { localDesktopSession } from './workspace-layout-profile.test-fixture'
import { saveWorkspaceLayout } from './workspace-layout-save'
import { addWorkspace, GIT_KEY, leaf } from './workspace-layout-session.test-fixture'

type Prefixed<Prefix extends string, Key> = Key extends string ? `${Prefix}.${Key}` : never
type ViewGroup = DesktopLayoutView['groups'][string][string]
type ViewPane = DesktopLayoutView['panes'][string]
type Scrollback = LayoutContentFacts['scrollback'][string]

/** Every field of the model and of the side data, as `holder.field`. */
type Source =
  | 'model.hostId'
  | Prefixed<'records', keyof WorkspaceLayoutRecords>
  | Prefixed<
      'workspace',
      Exclude<keyof WorkspaceLayout, 'tabs' | 'groups' | 'editorFiles' | 'browserTabs'>
    >
  | Prefixed<'tab', Exclude<keyof LayoutTerminalTab | keyof LayoutContentTab, 'terminal' | 'panes'>>
  | Prefixed<'tab.terminal', keyof LayoutTerminalCreation>
  | Prefixed<'tab.panes', keyof LayoutTerminalPanes>
  | Prefixed<'group', keyof LayoutGroup>
  | Prefixed<'file', keyof LayoutEditorFile>
  | Prefixed<'browserTab', keyof LayoutBrowserTab>
  | Prefixed<'view', Exclude<keyof DesktopLayoutView, 'groups' | 'panes' | 'editorDrafts'>>
  | Prefixed<'viewGroup', keyof ViewGroup>
  | Prefixed<'viewPane', keyof ViewPane>
  | Prefixed<'editorDraft', keyof EditorDraft>
  | Prefixed<
      'facts',
      Exclude<keyof LayoutContentFacts, 'terminalRows' | 'scrollback' | 'browserTabs'>
    >
  | Prefixed<'terminalRow', keyof TerminalRowFacts>
  | Prefixed<'scrollback', keyof Scrollback>
  | Prefixed<'browserLive', keyof BrowserTabLiveState>
  | Prefixed<'carried', keyof CarriedSessionFields>

/** `from`: the one source. `via`: sources that only select or validate (a fallback, a filter). */
type Written = { from: Source; via?: readonly Source[] } | 'unwritten' | 'container'

const tab = <Field extends string>(field: Field) => ({ from: `tab.${field}` }) as const

const SHARED_TAB_FIELDS = {
  createdAt: tab('createdAt'),
  color: tab('color'),
  aiVaultTitle: tab('aiVaultTitle'),
  quickCommandLabel: tab('quickCommandLabel'),
  isPinned: tab('isPinned'),
  viewMode: tab('viewMode')
} as const

const ROW = {
  ...SHARED_TAB_FIELDS,
  id: tab('entityId'),
  ptyId: { from: 'tab.panes.ptyIdsByLeafId', via: ['tab.panes.root', 'viewPane.activeLeafId'] },
  worktreeId: { from: 'workspace.worktreeId' },
  title: { from: 'terminalRow.title' },
  defaultTitle: { from: 'tab.terminal.defaultTitle' },
  generatedTitle: tab('generatedTitle'),
  customTitle: tab('customTitle'),
  sortOrder: { from: 'group.tabOrder' },
  generation: { from: 'terminalRow.generation' },
  shellOverride: { from: 'tab.terminal.shellOverride' },
  forceHostRuntime: { from: 'tab.terminal.forceHostRuntime' },
  startupCwd: { from: 'tab.terminal.startupCwd' },
  launchAgent: { from: 'tab.terminal.launchAgent' },
  agentLaunchPane: { from: 'tab.terminal.agentLaunchPane' },
  // Runtime-only; never persisted by today's writers either.
  pendingActivationSpawn: 'unwritten',
  recovery: 'unwritten'
} as const satisfies Record<keyof TerminalTab, Written>

const ENTRY_FIELDS = {
  ...SHARED_TAB_FIELDS,
  id: tab('id'),
  entityId: tab('entityId'),
  groupId: { from: 'group.id' },
  worktreeId: { from: 'workspace.worktreeId' },
  contentType: tab('kind'),
  generatedLabel: tab('generatedTitle'),
  customLabel: tab('customTitle'),
  sortOrder: { from: 'group.tabOrder' },
  isPreview: tab('isPreview'),
  agentSessionAgent: tab('agentSessionAgent'),
  lastFocusedAt: { from: 'view.lastFocusedAt' }
} as const

const TERMINAL_ENTRY = {
  ...ENTRY_FIELDS,
  executionHostId: { from: 'model.hostId' },
  label: { from: 'terminalRow.title' }
} as const satisfies Record<keyof Tab, Written>

const CONTENT_ENTRY = {
  ...ENTRY_FIELDS,
  executionHostId: {
    from: 'model.hostId',
    via: ['file.externalSshTargetId', 'file.runtimeEnvironmentId']
  },
  label: { from: 'facts.tabLabels' }
} as const satisfies Record<keyof Tab, Written>

const GROUP = {
  id: { from: 'group.id' },
  worktreeId: { from: 'workspace.worktreeId' },
  activeTabId: { from: 'viewGroup.activeTabId', via: ['group.tabOrder'] },
  tabOrder: { from: 'group.tabOrder' },
  recentTabIds: { from: 'viewGroup.recentTabIds', via: ['group.tabOrder'] }
} as const satisfies Record<keyof TabGroup, Written>

const LAYOUT = {
  root: { from: 'tab.panes.root' },
  activeLeafId: { from: 'viewPane.activeLeafId', via: ['tab.panes.root'] },
  expandedLeafId: { from: 'viewPane.expandedLeafId', via: ['tab.panes.root'] },
  chatLeafId: { from: 'tab.panes.chatLeafId' },
  ptyIdsByLeafId: { from: 'tab.panes.ptyIdsByLeafId' },
  buffersByLeafId: { from: 'scrollback.buffersByLeafId' },
  scrollbackRefsByLeafId: { from: 'scrollback.scrollbackRefsByLeafId' },
  titlesByLeafId: { from: 'tab.panes.titlesByLeafId' }
} as const satisfies Record<keyof TerminalLayoutSnapshot, Written>

const FILE = {
  filePath: { from: 'file.filePath' },
  relativePath: { from: 'file.relativePath' },
  worktreeId: { from: 'workspace.worktreeId' },
  language: { from: 'file.language' },
  isPreview: { from: 'tab.isPreview' },
  runtimeEnvironmentId: { from: 'file.runtimeEnvironmentId' },
  externalSshTargetId: { from: 'file.externalSshTargetId' },
  dirtyDraftContent: { from: 'editorDraft.dirtyDraftContent' },
  lastKnownDiskSignature: { from: 'editorDraft.lastKnownDiskSignature' },
  readOnly: { from: 'file.readOnly' },
  liveTail: { from: 'file.liveTail' }
} as const satisfies Record<keyof PersistedOpenFile, Written>

const BROWSER = {
  id: { from: 'browserTab.id' },
  worktreeId: { from: 'workspace.worktreeId' },
  label: { from: 'browserTab.label' },
  sessionProfileId: { from: 'browserTab.sessionProfileId' },
  sessionPartition: { from: 'browserTab.sessionPartition' },
  pageIds: { from: 'browserTab.pageIds' },
  createdAt: { from: 'browserTab.createdAt' },
  activePageId: { from: 'browserLive.activePageId' },
  url: { from: 'browserLive.url' },
  title: { from: 'browserLive.title' },
  loading: { from: 'browserLive.loading' },
  faviconUrl: { from: 'browserLive.faviconUrl' },
  canGoBack: { from: 'browserLive.canGoBack' },
  canGoForward: { from: 'browserLive.canGoForward' },
  loadError: { from: 'browserLive.loadError' },
  docLocation: { from: 'browserLive.docLocation' }
} as const satisfies Record<keyof BrowserWorkspace, Written>

const SESSION = {
  activeRepoId: { from: 'view.activeRepoId' },
  activeWorkspaceKey: { from: 'view.activeWorkspaceKey' },
  activeWorkspaceExecutionHostId: { from: 'view.activeWorkspaceExecutionHostId' },
  activeWorktreeId: { from: 'view.activeWorktreeId' },
  activeTabId: { from: 'view.activeTabId' },
  activeFileIdByWorktree: { from: 'view.activeFileIdByWorktree' },
  markdownFrontmatterVisible: { from: 'view.markdownFrontmatterVisible' },
  activeBrowserTabIdByWorktree: { from: 'view.activeBrowserTabIdByWorktree' },
  activeTabTypeByWorktree: { from: 'view.activeTabTypeByWorktree' },
  activeTabIdByWorktree: { from: 'view.activeTabIdByWorktree' },
  activeGroupIdByWorktree: { from: 'view.activeGroupIdByWorktree' },
  lastVisitedAtByWorktreeId: { from: 'view.lastVisitedAtByWorktreeId' },
  localOnlyScrollbackByTabId: { from: 'facts.localOnlyScrollbackByTabId' },
  browserPagesByWorkspace: { from: 'facts.browserPagesByWorkspace' },
  activeWorktreeIdsOnShutdown: { from: 'carried.activeWorktreeIdsOnShutdown' },
  clientHostedBrowserCloseIntentsByEnvironment: {
    from: 'carried.clientHostedBrowserCloseIntentsByEnvironment'
  },
  browserUrlHistory: { from: 'carried.browserUrlHistory' },
  workspaceDocHistory: { from: 'carried.workspaceDocHistory' },
  activeConnectionIdsAtShutdown: { from: 'carried.activeConnectionIdsAtShutdown' },
  remoteSessionIdsByTabId: { from: 'carried.remoteSessionIdsByTabId' },
  clientHostedBrowserPagesByWorktree: { from: 'records.clientHostedBrowserPagesByWorkspace' },
  defaultTerminalTabsAppliedByWorktreeId: { from: 'records.defaultTabsAppliedByWorkspace' },
  sleepingAgentSessionsByPaneKey: { from: 'records.sleepingByPaneKey' },
  terminalPtyIncarnationsByPaneKey: { from: 'records.incarnationsByPaneKey' },
  terminalTopologyRevisionByRepoId: { from: 'records.topologyRevisionByRepoId' },
  closedTerminalTabTombstonesByTabId: { from: 'records.closedTerminalTabTombstones' },
  tabGroupLayouts: { from: 'workspace.groupLayout', via: ['group.id'] },
  // Which workspaces keep an (empty) terminal row list.
  tabsByWorktree: { from: 'workspace.keepsEmptyTerminalRows' },
  // Pane layouts no terminal tab owns, keyed by their tab id.
  terminalLayoutsByTabId: { from: 'carried.unownedTerminalLayouts' },
  unifiedTabs: 'container',
  tabGroups: 'container',
  openFilesByWorktree: 'container',
  browserTabsByWorktree: 'container',
  // Applied and cleared by the Loader.
  terminalSurfaceTombstonesByPaneKey: 'unwritten'
} as const satisfies Record<keyof WorkspaceSessionState, Written>

const TABLES = {
  row: ROW,
  terminalEntry: TERMINAL_ENTRY,
  entry: CONTENT_ENTRY,
  group: GROUP,
  layout: LAYOUT,
  file: FILE,
  browser: BROWSER,
  session: SESSION
} as const

type TableEntry = {
  [Table in keyof typeof TABLES]: (typeof TABLES)[Table][keyof (typeof TABLES)[Table]]
}[keyof typeof TABLES]
type FromOf<Entry> = Entry extends { from: infer From } ? From : never
type UnwrittenSource = Exclude<Source, FromOf<TableEntry>>
// A model or side-data field no disk field is written from fails here.
const everySourceIsWritten: [UnwrittenSource] extends [never] ? true : UnwrittenSource = true

/** On-disk fields that hold one fact; each group must be written from the same source. */
const COPIES = [
  ['row.ptyId', 'layout.ptyIdsByLeafId'],
  ['row.id', 'terminalEntry.entityId'],
  ['row.title', 'terminalEntry.label'],
  ['row.customTitle', 'terminalEntry.customLabel'],
  ['row.generatedTitle', 'terminalEntry.generatedLabel'],
  ...(
    ['createdAt', 'color', 'aiVaultTitle', 'quickCommandLabel', 'isPinned', 'viewMode'] as const
  ).map((field) => [`row.${field}`, `terminalEntry.${field}`]),
  ['row.sortOrder', 'terminalEntry.sortOrder', 'entry.sortOrder', 'group.tabOrder'],
  [
    'row.worktreeId',
    'terminalEntry.worktreeId',
    'entry.worktreeId',
    'group.worktreeId',
    'file.worktreeId',
    'browser.worktreeId'
  ],
  ['terminalEntry.executionHostId', 'entry.executionHostId'],
  ['entry.isPreview', 'file.isPreview'],
  ['terminalEntry.groupId', 'entry.groupId', 'group.id']
]

/** Ids other records reference; mutating one would break the references, not test a source. */
const IDENTITY_SOURCES = new Set<Source>([
  'tab.id',
  'tab.entityId',
  'tab.kind',
  'group.id',
  'file.filePath',
  'browserTab.id'
])

const WRITTEN_BY_FIELD = new Map<string, Written>(
  Object.entries(TABLES).flatMap(([table, fields]) =>
    Object.entries(fields).map(([field, written]): [string, Written] => [
      `${table}.${field}`,
      written
    ])
  )
)

const writtenOf = (field: string): Written => WRITTEN_BY_FIELD.get(field)!

const sourcesOf = (written: Written): Source[] =>
  typeof written === 'string' ? [] : [written.from, ...(written.via ?? [])]

/** The richest session the fixtures build, with every optional source populated. */
function richLoaded(): LoadedWorkspaceLayout {
  const session = localDesktopSession()
  // A workspace with no terminal that still keeps its (empty) row list.
  addWorkspace(session, 'repo-2::/Users/dev/empty', [
    { id: 'group-empty', tabs: [{ id: 'browser-2', kind: 'browser' }] }
  ])
  session.tabsByWorktree['repo-2::/Users/dev/empty'] = []
  let next = 0
  const loaded = loadWorkspaceLayout(LOCAL_EXECUTION_HOST_ID, session, {
    mintId: () => `minted-${++next}`,
    mintLeafId: () => leaf(9)
  })
  return populate(loaded)
}

/** Sets `source` on the first holder `pick` accepts. */
function fill(
  loaded: LoadedWorkspaceLayout,
  source: Source,
  value: unknown,
  pick: (holder: Holder) => boolean = () => true
): void {
  const [prefix, field] = splitSource(source)
  holdersOf(loaded, prefix).find(pick)![field] = value
}

function populate(loaded: LoadedWorkspaceLayout): LoadedWorkspaceLayout {
  const terminal = (holder: Holder) => holder.kind === 'terminal'
  fill(loaded, 'tab.aiVaultTitle', { agent: 'codex', sessionId: 's', title: 't' }, terminal)
  fill(loaded, 'tab.quickCommandLabel', 'build', terminal)
  fill(loaded, 'tab.isPreview', true, (holder) => holder.kind === 'editor')
  fill(loaded, 'tab.terminal.forceHostRuntime', true)
  fill(loaded, 'tab.terminal.agentLaunchPane', { leafId: leaf(1) })
  fill(loaded, 'file.externalSshTargetId', 'box')
  fill(loaded, 'file.runtimeEnvironmentId', 'env')
  fill(loaded, 'file.readOnly', true)
  fill(loaded, 'file.liveTail', true)
  // A focused and an expanded pane that is not the first, so a fallback is visible.
  fill(loaded, 'viewPane.activeLeafId', leaf(2), (holder) => holder.activeLeafId === leaf(1))
  fill(loaded, 'viewPane.expandedLeafId', leaf(2), (holder) => holder.activeLeafId === leaf(2))
  fill(loaded, 'scrollback.buffersByLeafId', { [leaf(1)]: 'buffer' })
  fill(loaded, 'browserTab.sessionProfileId', 'profile-1')
  fill(loaded, 'browserTab.sessionPartition', 'persist:p')
  fill(loaded, 'browserTab.pageIds', ['page-1', 'page-2'])
  fill(loaded, 'browserLive.faviconUrl', 'https://example.com/icon')
  fill(loaded, 'browserLive.loadError', { code: -1, description: 'failed', validatedUrl: 'u' })
  fill(loaded, 'browserLive.docLocation', { kind: 'file', path: '/doc.md' })
  fill(loaded, 'view.activeWorkspaceExecutionHostId', LOCAL_EXECUTION_HOST_ID)
  fill(loaded, 'carried.remoteSessionIdsByTabId', { 'tab-shell': 'remote-1' })
  fill(loaded, 'records.clientHostedBrowserPagesByWorkspace', { 'browser-1': [{ id: 'page-1' }] })
  // Tab fields on both kinds, since terminal and content tabs are written to different tables.
  const content = (holder: Holder) => holder.kind === 'browser'
  fill(loaded, 'tab.aiVaultTitle', { agent: 'codex', sessionId: 's', title: 't' }, content)
  fill(loaded, 'tab.quickCommandLabel', 'open', content)
  fill(loaded, 'tab.isPinned', true, content)
  fill(loaded, 'tab.generatedTitle', 'Docs page', content)
  fill(loaded, 'tab.viewMode', 'terminal', content)
  fill(loaded, 'tab.isPreview', true, terminal)
  fill(loaded, 'tab.agentSessionAgent', 'claude', terminal)
  fill(loaded, 'view.lastFocusedAt', { [GIT_KEY]: { 'tab-agent': 1, 'browser-1': 2 } })
  fill(loaded, 'view.markdownFrontmatterVisible', { '/doc.md': true })
  fill(loaded, 'carried.activeConnectionIdsAtShutdown', ['target-1', 'target-2'])
  fill(loaded, 'carried.browserUrlHistory', [{ url: 'a' }, { url: 'b' }])
  fill(loaded, 'carried.workspaceDocHistory', [{ path: 'a' }, { path: 'b' }])
  fill(loaded, 'carried.clientHostedBrowserCloseIntentsByEnvironment', {
    env: ['page-1', 'page-2']
  })
  fill(loaded, 'carried.unownedTerminalLayouts', {
    'tab-gone': {
      root: { type: 'leaf', leafId: leaf(7) },
      activeLeafId: leaf(7),
      expandedLeafId: null
    }
  })
  return loaded
}

type Holder = Record<string, unknown>

function holdersOf(loaded: LoadedWorkspaceLayout, prefix: string): Holder[] {
  const { layout, desktopView: view, facts, carried } = loaded
  const workspaces = Object.values(layout.workspaces)
  const tabs = workspaces.flatMap((workspace) => workspace.tabs)
  const terminals = tabs.flatMap((entry) => (entry.kind === 'terminal' ? [entry] : []))
  const nested = <Value extends Holder>(record: Record<string, Record<string, Value>>) =>
    Object.values(record).flatMap((inner) => Object.values(inner))
  const holders: Record<string, Holder[]> = {
    model: [layout],
    records: [layout.records],
    workspace: workspaces,
    tab: tabs,
    'tab.terminal': terminals.map((entry) => entry.terminal),
    'tab.panes': terminals.map((entry) => entry.panes),
    group: workspaces.flatMap((workspace) => workspace.groups),
    file: workspaces.flatMap((workspace) => workspace.editorFiles ?? []),
    browserTab: workspaces.flatMap((workspace) => workspace.browserTabs ?? []),
    view: [view],
    viewGroup: nested(view.groups),
    viewPane: Object.values(view.panes),
    editorDraft: nested(view.editorDrafts),
    facts: [facts],
    terminalRow: Object.values(facts.terminalRows),
    scrollback: Object.values(facts.scrollback),
    browserLive: nested(facts.browserTabs),
    carried: [carried]
  }
  return holders[prefix]!
}

function splitSource(source: Source): [prefix: string, field: string] {
  const at = source.lastIndexOf('.')
  return [source.slice(0, at), source.slice(at + 1)]
}

function mutated(value: unknown): unknown {
  if (typeof value === 'string') {
    return `${value}~`
  }
  if (typeof value === 'number') {
    return value + 1
  }
  if (typeof value === 'boolean') {
    return !value
  }
  // A nullable field's other state.
  if (value === null) {
    return 'set'
  }
  if (Array.isArray(value)) {
    // Lists of ids are references: reorder them rather than rename them.
    return value.every((item) => typeof item !== 'object') ? value.toReversed() : value.map(mutated)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mutated(item)]))
  }
  return value
}

/** Disk field (`table.field`) → its values across every record, keyed by record. */
function diskValues(session: WorkspaceSessionState): Map<string, string> {
  const values = new Map<string, Record<string, unknown>>()
  const put = (table: keyof typeof TABLES, recordKey: string, record: Holder) => {
    const written: Record<string, Written> = TABLES[table]
    for (const field of Object.keys(written).filter((key) => written[key] !== 'container')) {
      const name = `${table}.${field}`
      values.set(name, { ...values.get(name), [recordKey]: record[field] })
    }
  }
  const ownedLayouts = new Set<string>()
  for (const [key, rows] of Object.entries(session.tabsByWorktree)) {
    rows.forEach((row) => {
      ownedLayouts.add(row.id)
      put('row', `${key}|${row.id}`, row)
    })
  }
  for (const [key, entries] of Object.entries(session.unifiedTabs ?? {})) {
    for (const entry of entries) {
      put(entry.contentType === 'terminal' ? 'terminalEntry' : 'entry', `${key}|${entry.id}`, entry)
    }
  }
  for (const [key, groups] of Object.entries(session.tabGroups ?? {})) {
    groups.forEach((group) => put('group', `${key}|${group.id}`, group))
  }
  const unowned: Holder = {}
  for (const [tabId, layout] of Object.entries(session.terminalLayoutsByTabId)) {
    if (ownedLayouts.has(tabId)) {
      put('layout', tabId, layout)
    } else {
      unowned[tabId] = layout
    }
  }
  for (const [key, files] of Object.entries(session.openFilesByWorktree ?? {})) {
    files.forEach((file) => put('file', `${key}|${file.filePath}`, file))
  }
  for (const [key, tabs] of Object.entries(session.browserTabsByWorktree ?? {})) {
    tabs.forEach((entry) => put('browser', `${key}|${entry.id}`, entry))
  }
  put('session', 'session', {
    ...session,
    tabsByWorktree: Object.keys(session.tabsByWorktree).sort(),
    terminalLayoutsByTabId: unowned
  })
  // Record order is not a field: rows follow the tab order, which sortOrder already carries.
  const sorted = (record: Record<string, unknown>) =>
    JSON.stringify(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)))
  return new Map([...values].map(([name, record]) => [name, sorted(record)]))
}

const ALL_SOURCES = [
  ...new Set(Object.values(TABLES).flatMap((table) => Object.values(table).flatMap(sourcesOf)))
]

describe('each on-disk field has one source', () => {
  it('is typed over every disk, model and side-data field', () => {
    expect(everySourceIsWritten).toBe(true)
  })

  it('writes every copy of one fact from the same source', () => {
    for (const group of COPIES) {
      const sources = group.map((field) => {
        const written = writtenOf(field)
        return typeof written === 'string' ? written : written.from
      })
      expect(new Set(sources).size, group.join(' = ')).toBe(1)
    }
  })

  it('has every source populated, so a mutation can show what it writes', () => {
    const loaded = richLoaded()
    const empty = ALL_SOURCES.filter((source) => {
      const [prefix, field] = splitSource(source)
      return !holdersOf(loaded, prefix).some((holder) => holder[field] != null)
    })
    expect(empty).toEqual([])
  })

  it('changes on disk exactly the fields each source is declared for', () => {
    const base = richLoaded()
    const before = diskValues(saveWorkspaceLayout(base))
    const undeclared: string[] = []
    const ineffective: string[] = []
    for (const source of ALL_SOURCES.filter((entry) => !IDENTITY_SOURCES.has(entry))) {
      const loaded = structuredClone(base)
      const [prefix, field] = splitSource(source)
      for (const holder of holdersOf(loaded, prefix)) {
        holder[field] = mutated(holder[field])
      }
      const after = diskValues(saveWorkspaceLayout(loaded))
      const changed = [...before.keys()].filter((name) => before.get(name) !== after.get(name))
      for (const name of changed) {
        if (!sourcesOf(writtenOf(name)).includes(source)) {
          undeclared.push(`${source} -> ${name}`)
        }
      }
      for (const name of before.keys()) {
        const written = writtenOf(name)
        if (typeof written !== 'string' && written.from === source && !changed.includes(name)) {
          ineffective.push(`${source} -/-> ${name}`)
        }
      }
    }
    expect(undeclared, 'a source changed a disk field not declared to come from it').toEqual([])
    expect(ineffective, 'a declared source did not change its disk field').toEqual([])
  })
})
