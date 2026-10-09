// One layout tab from today's two records per terminal tab (the row and the tab-bar entry).

import type { ExecutionHostId } from '../execution-host'
import type { Tab } from '../tab-types'
import type { TerminalTab } from '../terminal-tab-types'
import type {
  LayoutContentTab,
  LayoutTerminalCreation,
  LayoutTerminalTab
} from './workspace-layout-model'
import { pickStoredFields } from './stored-record-fields'

const TERMINAL_CREATION_FIELDS = [
  'defaultTitle',
  'shellOverride',
  'forceHostRuntime',
  'startupCwd',
  'launchAgent',
  'agentLaunchPane'
] as const satisfies readonly (keyof LayoutTerminalCreation)[]

/** Row field and tab-bar field that hold the same layout fact. */
const SHARED_FIELDS = [
  ['createdAt', 'createdAt'],
  ['customTitle', 'customLabel'],
  ['color', 'color'],
  ['isPinned', 'isPinned'],
  ['viewMode', 'viewMode'],
  ['generatedTitle', 'generatedLabel'],
  ['aiVaultTitle', 'aiVaultTitle'],
  ['quickCommandLabel', 'quickCommandLabel']
] as const satisfies readonly (readonly [keyof TerminalTab, keyof Tab])[]

export type TabLoadReport = {
  /** The two records name different values for `field`; the row's was kept. */
  disagree: (field: string) => void
  /** The entry names an execution host other than this partition's. */
  foreignHost: () => void
}

function contentFields(entry: Tab, hostId: ExecutionHostId, report: TabLoadReport) {
  if (entry.executionHostId !== undefined && entry.executionHostId !== hostId) {
    report.foreignHost()
  }
  return {
    id: entry.id,
    entityId: entry.entityId,
    ...(entry.executionHostId !== undefined ? { namesExecutionHost: true as const } : {}),
    createdAt: entry.createdAt,
    customTitle: entry.customLabel,
    color: entry.color,
    ...pickStoredFields(entry, [
      'aiVaultTitle',
      'quickCommandLabel',
      'isPinned',
      'viewMode',
      'isPreview',
      'agentSessionAgent'
    ]),
    ...(entry.generatedLabel !== undefined ? { generatedTitle: entry.generatedLabel } : {})
  }
}

export function loadContentTab(
  entry: Tab & { contentType: LayoutContentTab['kind'] },
  hostId: ExecutionHostId,
  report: TabLoadReport
): LayoutContentTab {
  return { ...contentFields(entry, hostId, report), kind: entry.contentType }
}

/**
 * Where both records name a field and disagree, the row wins (every runtime writer updates the
 * row; only the window keeps the tab-bar entry) and the disagreement is reported.
 */
export function loadTerminalTab(
  row: TerminalTab,
  entry: Tab | undefined,
  hostId: ExecutionHostId,
  report: TabLoadReport
): Omit<LayoutTerminalTab, 'panes'> {
  const base = entry
    ? contentFields(entry, hostId, report)
    : { id: row.id, entityId: row.id, customTitle: null, color: null }
  for (const [rowField, entryField] of SHARED_FIELDS) {
    const rowValue = row[rowField]
    const entryValue = entry?.[entryField]
    if (
      rowValue !== undefined &&
      entryValue !== undefined &&
      JSON.stringify(rowValue) !== JSON.stringify(entryValue)
    ) {
      report.disagree(rowField)
    }
  }
  return {
    ...base,
    ...pickStoredFields(row, [
      'aiVaultTitle',
      'quickCommandLabel',
      'isPinned',
      'viewMode',
      'generatedTitle'
    ]),
    createdAt: row.createdAt,
    customTitle: row.customTitle,
    color: row.color,
    kind: 'terminal',
    terminal: pickStoredFields(row, TERMINAL_CREATION_FIELDS)
  }
}
