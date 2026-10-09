// Records keyed by pane key follow their pane when the pane's key changes.

import { withoutKey } from './stored-record-fields'
import type { WorkspaceLayoutModel } from './workspace-layout-model'
import { withWorkspace } from './workspace-layout-removal'

export function rekeyPaneRecords(
  model: WorkspaceLayoutModel,
  workspaceKey: string,
  from: string,
  to: string
): WorkspaceLayoutModel {
  const workspace = model.workspaces[workspaceKey]!
  const sleeping = workspace.sleepingByPaneKey?.[from]
  const incarnation = model.records.incarnationsByPaneKey?.[from]
  const next = sleeping
    ? withWorkspace(model, workspaceKey, {
        ...workspace,
        sleepingByPaneKey: { ...withoutKey(workspace.sleepingByPaneKey, from), [to]: sleeping }
      })
    : model
  if (incarnation === undefined) {
    return next
  }
  const incarnationsByPaneKey = {
    ...withoutKey(model.records.incarnationsByPaneKey, from),
    [to]: incarnation
  }
  return { ...next, records: { ...next.records, incarnationsByPaneKey } }
}
