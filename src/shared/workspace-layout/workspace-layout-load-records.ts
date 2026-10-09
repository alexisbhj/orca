// A workspace's own id and its editor and browser records, each fact taken once.

import {
  BROWSER_TAB_LAYOUT_FIELDS,
  BROWSER_TAB_WORKSPACE_FIELDS,
  EDITOR_DRAFT_FIELDS
} from './workspace-layout-beside'
import { childRecord, omitStoredFields, pickStoredFields } from './stored-record-fields'
import type { WorkspaceLoadArgs } from './workspace-layout-load-types'
import type { LayoutBrowserTab, LayoutEditorFile, LayoutTab } from './workspace-layout-model'

/**
 * Every record of a workspace names its worktree id. Stored data can disagree: the value most
 * records name is kept (the key when none names one) and the others are reported.
 */
export function resolveWorktreeId({ session, key, normalizations }: WorkspaceLoadArgs): string {
  const named: { id: string; worktreeId: string }[] = [
    ...(session.tabsByWorktree?.[key] ?? []),
    ...(session.unifiedTabs?.[key] ?? []),
    ...(session.tabGroups?.[key] ?? []),
    ...(session.openFilesByWorktree?.[key] ?? []).map((file) => ({
      id: file.filePath,
      worktreeId: file.worktreeId
    })),
    ...(session.browserTabsByWorktree?.[key] ?? [])
  ]
  const counts = new Map<string, number>()
  for (const record of named) {
    counts.set(record.worktreeId, (counts.get(record.worktreeId) ?? 0) + 1)
  }
  let worktreeId = key
  let most = 0
  for (const [candidate, count] of counts) {
    if (count > most) {
      worktreeId = candidate
      most = count
    }
  }
  const others = named.filter((record) => record.worktreeId !== worktreeId)
  if (others.length > 0) {
    normalizations.push({
      rule: 'worktree_id_disagrees',
      workspaceKey: key,
      ids: others.map((record) => record.id),
      field: 'worktreeId'
    })
  }
  return worktreeId
}

/** Preview is the tab's: a file record's flag that disagrees with its tab is reported. */
export function loadEditorFiles(
  args: WorkspaceLoadArgs,
  tabs: readonly LayoutTab[]
): LayoutEditorFile[] | undefined {
  const { session, key, view } = args
  const files = session.openFilesByWorktree?.[key]
  if (!files) {
    return undefined
  }
  return files.map((file) => {
    const draft = pickStoredFields(file, EDITOR_DRAFT_FIELDS)
    if (Object.keys(draft).length > 0) {
      childRecord(view.editorDrafts, key)[file.filePath] = draft
    }
    const tab = tabs.find((entry) => entry.kind === 'editor' && entry.entityId === file.filePath)
    if (file.isPreview === true && tab?.isPreview !== true) {
      args.normalizations.push({
        rule: 'preview_flag_disagrees',
        workspaceKey: key,
        ids: [file.filePath],
        field: 'isPreview'
      })
    }
    return omitStoredFields(file, [...EDITOR_DRAFT_FIELDS, 'isPreview', 'worktreeId'])
  })
}

export function loadBrowserTabs(args: WorkspaceLoadArgs): LayoutBrowserTab[] | undefined {
  const { session, key, facts } = args
  return session.browserTabsByWorktree?.[key]?.map((tab) => {
    childRecord(facts.browserTabs, key)[tab.id] = omitStoredFields(tab, [
      ...BROWSER_TAB_LAYOUT_FIELDS,
      ...BROWSER_TAB_WORKSPACE_FIELDS
    ])
    return {
      id: tab.id,
      createdAt: tab.createdAt,
      ...pickStoredFields(tab, ['label', 'sessionProfileId', 'sessionPartition', 'pageIds'])
    }
  })
}
