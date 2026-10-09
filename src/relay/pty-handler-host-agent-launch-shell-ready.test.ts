import './mock-descendant-sweep'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDefaultSettings } from '../shared/constants'
import { buildRuntimeAgentTerminalStartupOptions } from '../main/runtime/runtime-agent-terminal-startup'
import { buildSshPtySpawnRequest } from '../main/providers/ssh-pty-spawn-request'

const { mockPtySpawn, mockPtyInstance, mockCreateShellPromptReadinessProbe } = vi.hoisted(() => ({
  mockPtySpawn: vi.fn(),
  mockCreateShellPromptReadinessProbe: vi.fn(),
  mockPtyInstance: {
    pid: process.pid,
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    clear: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn()
  }
}))

vi.mock('node-pty', () => ({ spawn: mockPtySpawn }))
vi.mock('../main/pty/posix-pty-process-groups', () => ({
  forceKillPosixPtyProcessGroups: vi.fn((_pid: number, fallback: () => void) => fallback())
}))
vi.mock('../main/shell-prompt-readiness-probe', () => ({
  createShellPromptReadinessProbe: mockCreateShellPromptReadinessProbe
}))

import type { PtyHandler } from './pty-handler'
import { beginPtyHandlerTest, endPtyHandlerTest } from './pty-handler-test-harness'
import type { MockDispatcher } from './pty-handler-test-harness'

describe('a host agent launch into an SSH workspace whose login shell is slow', () => {
  let dispatcher: MockDispatcher
  let handler: PtyHandler
  let originalPlatform: PropertyDescriptor | undefined
  let homeDir: string
  let oldShell: string | undefined

  beforeEach(() => {
    ;({ dispatcher, handler, originalPlatform } = beginPtyHandlerTest({
      mockPtySpawn,
      mockPtyInstance,
      mockCreateShellPromptReadinessProbe
    }))
    homeDir = mkdtempSync(join(tmpdir(), 'relay-host-agent-shell-ready-'))
    oldShell = process.env.SHELL
    process.env.SHELL = '/bin/bash'
  })

  afterEach(async () => {
    if (oldShell === undefined) {
      delete process.env.SHELL
    } else {
      process.env.SHELL = oldShell
    }
    rmSync(homeDir, { recursive: true, force: true })
    await endPtyHandlerTest(handler, originalPlatform)
  })

  it.skipIf(process.platform === 'win32')(
    'types the Claude command only after the remote prompt is ready',
    async () => {
      let shellOutput: ((data: string) => void) | undefined
      const term = {
        ...mockPtyInstance,
        onData: vi.fn((callback: (data: string) => void) => {
          shellOutput = callback
        }),
        onExit: vi.fn()
      }
      mockPtySpawn.mockReturnValue(term)
      const launch = await buildRuntimeAgentTerminalStartupOptions(
        {
          id: 'worktree-1',
          path: homeDir,
          connectionId: 'ssh-1',
          repo: null,
          folderWorkspace: null
        },
        { startupAgent: 'claude' },
        { ...getDefaultSettings(homeDir), disabledTuiAgents: [] },
        'linux',
        undefined,
        'test-host'
      )
      // The fields the host's background create hands the SSH provider for this launch.
      const request = buildSshPtySpawnRequest({
        options: {
          cols: 120,
          rows: 40,
          cwd: homeDir,
          env: { HOME: homeDir, ...launch.env },
          command: launch.command,
          commandDelivery: 'provider',
          startupCommandDelivery: launch.startupCommandDelivery
        },
        supportsCreateOperation: false
      })

      await dispatcher.callRequest('pty.spawn', request)

      // Far past the relay's flat 50 ms typing delay: a slow rc file is still loading.
      vi.advanceTimersByTime(1499)
      expect(term.write).not.toHaveBeenCalled()

      shellOutput?.('\x1b]777;orca-shell-ready\x07user@remote $ ')
      vi.advanceTimersByTime(50)
      expect(term.write).toHaveBeenCalledWith(`${launch.command}\r`)
    }
  )
})
