import type { Tab } from '../../../../../../shared/tab-types'
import type { OpenFile } from '../types/open-file'

/** Tab kinds backed by an OpenFile; the chat-visual kind renders in its own retained overlay. */
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

/** Whether the globally active editor tab is virtual, so editor zoom and word wrap have nothing to act on. */
export function isActiveEditorFileVirtual(state: {
  activeTabType: string | null
  activeFileId: string | null
  openFiles: readonly Pick<OpenFile, 'id' | 'mode'>[]
}): boolean {
  if (state.activeTabType !== 'editor') {
    return false
  }
  const activeFile = state.openFiles.find((file) => file.id === state.activeFileId)
  return activeFile ? isVirtualEditorFile(activeFile) : false
}
