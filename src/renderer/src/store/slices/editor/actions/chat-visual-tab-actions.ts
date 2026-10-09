import type { EditorGet, EditorSet } from '../types/editor-set-get'
import type { EditorSlice } from '../types/editor-slice'
import type { OpenFile } from '../types/open-file'
import { buildChatVisualTabId } from '@/components/native-chat/native-chat-visual-tab'
import { openWorkspaceEditorItem } from '../tabs/workspace-editor-item'
import { buildEditorActiveResult } from '../tabs/editor-open-target-group'

export function createChatVisualTabActions(
  set: EditorSet,
  get: EditorGet
): Pick<EditorSlice, 'openChatVisualTab'> {
  return {
    openChatVisualTab: (worktreeId, visual, options) => {
      const id = buildChatVisualTabId(worktreeId, visual)
      const label = visual.title ?? visual.file
      set((s) => {
        const file: OpenFile = {
          id,
          filePath: id,
          relativePath: label,
          worktreeId,
          language: 'plaintext',
          isDirty: false,
          mode: 'chat-visual',
          chatVisual: visual
        }
        const exists = s.openFiles.some((f) => f.id === id)
        return {
          // Why: a later message can retitle or rewrite the same visual; the nonce makes its open tab re-ask the host.
          openFiles: exists
            ? s.openFiles.map((f) =>
                f.id === id
                  ? {
                      ...f,
                      relativePath: label,
                      chatVisual: visual,
                      fileContentReloadNonce: (f.fileContentReloadNonce ?? 0) + 1
                    }
                  : f
              )
            : [...s.openFiles, file],
          ...buildEditorActiveResult(s, worktreeId, id)
        }
      })
      const state = get()
      const openTabs = (state.unifiedTabsByWorktree?.[worktreeId] ?? []).filter(
        (tab) => tab.contentType === 'chat-visual' && tab.entityId === id
      )
      for (const tab of openTabs) {
        if (tab.label !== label) {
          state.setTabLabel?.(tab.id, label)
        }
      }
      // Why: focus the visual in whichever split holds it; default placement targets the chat's group and would duplicate it there.
      const activeGroupId = state.activeGroupIdByWorktree?.[worktreeId]
      const openTab = openTabs.find((tab) => tab.groupId === activeGroupId) ?? openTabs[0]
      void openWorkspaceEditorItem(
        get(),
        id,
        worktreeId,
        label,
        'chat-visual',
        undefined,
        openTab?.groupId ?? options?.newTabGroupId
      )
      return id
    }
  }
}
