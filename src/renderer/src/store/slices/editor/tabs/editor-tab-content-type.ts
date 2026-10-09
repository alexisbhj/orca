import type { Tab } from '../../../../../../shared/tab-types'
import type { OpenFile } from '../types/open-file'

/** Tab kinds backed by an OpenFile and rendered in the editor area of a group. */
export const EDITOR_TAB_CONTENT_TYPES = [
  'editor',
  'diff',
  'conflict-review',
  'check-details',
  'chat-visual'
] as const satisfies readonly Tab['contentType'][]

export type EditorTabContentType = (typeof EDITOR_TAB_CONTENT_TYPES)[number]

const EDITOR_TAB_CONTENT_TYPE_SET: ReadonlySet<Tab['contentType']> = new Set(
  EDITOR_TAB_CONTENT_TYPES
)

export function isEditorTabContentType(
  contentType: Tab['contentType']
): contentType is EditorTabContentType {
  return EDITOR_TAB_CONTENT_TYPE_SET.has(contentType)
}

/** Editor tabs with no file behind them: their path is a synthetic id, so nothing may treat it as one. */
export function isVirtualEditorFile(file: Pick<OpenFile, 'mode'>): boolean {
  return file.mode === 'check-details' || file.mode === 'chat-visual'
}
