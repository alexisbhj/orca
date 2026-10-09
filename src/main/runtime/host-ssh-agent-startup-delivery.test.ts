import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { makeStore } from './runtime-rpc-worktree-store-fixtures'
import type { TerminalCreateOptions } from './runtime-terminal-contracts'

vi.mock('../git/worktree', () => ({
  listWorktrees: vi.fn().mockResolvedValue([]),
  listWorktreesStrict: vi.fn().mockResolvedValue([])
}))

const desktopPrompt: NonNullable<TerminalCreateOptions['desktopPrompt']> = {
  text: '',
  delivery: 'submit',
  transport: { kind: 'desktop-new-tab', promptDelivery: 'auto-submit' }
}

async function spawnOptionsFor(connectionId: string | null, opts: TerminalCreateOptions) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this store fixture implements the operations a background create exercises; missing operations fail on use.
  const runtime = new OrcaRuntimeService(makeStore() as never)
  const spawn = vi.fn(async (_options: { startupCommandDelivery?: string }) => ({ id: 'pty-1' }))
  runtime.setPtyController({
    spawn,
    write: () => true,
    kill: () => true,
    getForegroundProcess: async () => null
  })
  Object.assign(runtime, {
    resolveTerminalWorkspaceLaunchScope: async () => ({
      id: 'worktree-1',
      path: '/srv/app',
      connectionId,
      repo: null,
      folderWorkspace: null
    })
  })
  await runtime.createTerminal('id:worktree-1', opts)
  return spawn.mock.calls[0]?.[0]
}

describe('desktop new-tab launch into an SSH workspace', () => {
  it('holds a non-Codex agent command for the remote shell-ready marker, as main pane does', async () => {
    const options = await spawnOptionsFor('ssh-1', { startupAgent: 'claude', desktopPrompt })
    expect(options).toMatchObject({
      connectionId: 'ssh-1',
      command: expect.stringContaining('claude'),
      commandDelivery: 'provider',
      startupCommandDelivery: 'shell-ready'
    })
  })

  it('leaves a local desktop launch on the planner delivery', async () => {
    const options = await spawnOptionsFor(null, { startupAgent: 'claude', desktopPrompt })
    expect(options?.startupCommandDelivery).toBeUndefined()
  })

  it('holds every other host agent launch into SSH for the marker too', async () => {
    const options = await spawnOptionsFor('ssh-1', { startupAgent: 'claude' })
    expect(options?.startupCommandDelivery).toBe('shell-ready')
  })
})
