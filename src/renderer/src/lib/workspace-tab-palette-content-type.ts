import type { TabContentType } from '../../../shared/tab-types'
import { isEditorTabContentType } from '@/store/slices/editor/tabs/editor-tab-content-type'
import type { WorkspaceTabContentType } from './workspace-tab-palette-search'

export function isWorkspaceTabContentType(
  contentType: TabContentType
): contentType is WorkspaceTabContentType {
  return contentType === 'terminal' || isEditorTabContentType(contentType)
}
