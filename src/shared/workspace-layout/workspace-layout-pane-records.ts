// Records keyed by pane key follow their pane when the pane's key changes.

import { withoutKey } from './stored-record-fields'
import type { WorkspaceLayoutRecords } from './workspace-layout-model'

export function rekeyPaneRecords(
  records: WorkspaceLayoutRecords,
  from: string,
  to: string,
  tabId: string
): WorkspaceLayoutRecords {
  const next = { ...records }
  const incarnation = records.incarnationsByPaneKey?.[from]
  if (incarnation !== undefined) {
    next.incarnationsByPaneKey = {
      ...withoutKey(records.incarnationsByPaneKey, from),
      [to]: incarnation
    }
  }
  const sleeping = records.sleepingByPaneKey?.[from]
  if (sleeping) {
    next.sleepingByPaneKey = {
      ...withoutKey(records.sleepingByPaneKey, from),
      [to]: { ...sleeping, paneKey: to, tabId }
    }
  }
  return next
}
