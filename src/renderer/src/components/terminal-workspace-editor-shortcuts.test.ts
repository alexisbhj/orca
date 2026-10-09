// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  state: {
    activeTabType: 'editor',
    activeFileId: 'file-1',
    openFiles: [{ id: 'file-1', mode: 'edit' }],
    settings: { editorWordWrap: true },
    updateSettings: vi.fn()
  }
}))

vi.mock('../store', () => ({ useAppStore: { getState: () => store.state } }))
vi.mock('./editor/editor-autosave', () => ({ ORCA_EDITOR_REQUEST_CMD_SAVE_EVENT: 'save' }))
vi.mock('./editor/editor-cmd-save-target', () => ({ getEditorCmdSaveFileId: () => null }))
vi.mock('@/lib/floating-workspace-terminal-actions', () => ({
  isEventTargetInsideFloatingWorkspacePanel: () => false
}))

import { handleTerminalWorkspaceEditorShortcut } from './terminal-workspace-editor-shortcuts'

function pressWordWrap(): boolean {
  return handleTerminalWorkspaceEditorShortcut({
    event: new KeyboardEvent('keydown', { key: 'z', altKey: true }),
    floatingWorkspaceFocused: false,
    matchShortcut: (actionId) => actionId === 'editor.toggleWordWrap',
    notifyTerminalCapture: vi.fn()
  })
}

describe('editor word wrap shortcut', () => {
  beforeEach(() => {
    store.state.updateSettings.mockClear()
  })

  it('toggles word wrap for a text editor tab', () => {
    store.state.openFiles = [{ id: 'file-1', mode: 'edit' }]

    expect(pressWordWrap()).toBe(true)
    expect(store.state.updateSettings).toHaveBeenCalledWith({ editorWordWrap: false })
  })

  it.each(['check-details', 'chat-visual'])(
    'leaves the saved setting alone for a %s tab, which has no text to wrap',
    (mode) => {
      store.state.openFiles = [{ id: 'file-1', mode }]

      expect(pressWordWrap()).toBe(false)
      expect(store.state.updateSettings).not.toHaveBeenCalled()
    }
  )
})
