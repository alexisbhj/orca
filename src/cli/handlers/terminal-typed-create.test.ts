import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import { TERMINAL_HANDLERS } from './terminal'

const operationId = `${Date.now()}-000000000000000000000000000000aa`
const flags = () =>
  new Map<string, string | boolean>([
    ['worktree', 'id:wt-7'],
    ['agent', 'claude'],
    ['model', 'opus'],
    ['effort', 'high'],
    ['operation-id', operationId],
    ['attempt-id', 'attempt-1']
  ])
function client(capabilities = ['terminal.create.typed.v1'], reachable = true) {
  const call = vi
    .fn()
    .mockResolvedValue({ ok: true, result: { terminal: { handle: 'term-1' }, operationId } })
  const getCliStatus = vi
    .fn()
    .mockResolvedValue({ result: { runtime: { reachable, capabilities } } })
  return {
    call,
    getCliStatus,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this handler uses only these three transport members.
    runtime: { call, getCliStatus, isRemote: false } as unknown as RuntimeClient
  }
}
afterEach(() => vi.restoreAllMocks())
describe('terminal create --agent', () => {
  it('sends typed picks and caller-owned identities without a shell command or prompt', async () => {
    const host = client()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await TERMINAL_HANDLERS['terminal create']({
      flags: flags(),
      client: host.runtime,
      cwd: '/tmp',
      json: true
    })
    expect(host.call).toHaveBeenCalledWith('terminal.createTyped', {
      worktree: 'id:wt-7',
      agent: 'claude',
      model: 'opus',
      effort: 'high',
      operationId,
      attemptId: 'attempt-1',
      presentation: 'background'
    })
  })
  it.each([{ capabilities: [] }, { capabilities: ['agent.launch.v2'] }])(
    'refuses an older host before sending a create: %j',
    async ({ capabilities }) => {
      const host = client(capabilities)
      await expect(
        TERMINAL_HANDLERS['terminal create']({
          flags: flags(),
          client: host.runtime,
          cwd: '/tmp',
          json: true
        })
      ).rejects.toThrow('does not support typed terminal')
      expect(host.call).not.toHaveBeenCalled()
    }
  )
  it('does not mistake an unreachable host for permission to fall back', async () => {
    const host = client([], false)
    await expect(
      TERMINAL_HANDLERS['terminal create']({
        flags: flags(),
        client: host.runtime,
        cwd: '/tmp',
        json: true
      })
    ).rejects.toThrow('unreachable')
    expect(host.call).not.toHaveBeenCalled()
  })
  it.each(['command', 'shell', 'title'])('refuses incompatible --%s', async (flag) => {
    const host = client()
    const input = flags().set(flag, 'value')
    await expect(
      TERMINAL_HANDLERS['terminal create']({
        flags: input,
        client: host.runtime,
        cwd: '/tmp',
        json: true
      })
    ).rejects.toThrow('cannot be combined')
    expect(host.call).not.toHaveBeenCalled()
  })
  it.each(['operation-id', 'attempt-id'])(
    'requires caller-owned --%s before effects',
    async (flag) => {
      const host = client()
      const input = flags()
      input.delete(flag)
      await expect(
        TERMINAL_HANDLERS['terminal create']({
          flags: input,
          client: host.runtime,
          cwd: '/tmp',
          json: true
        })
      ).rejects.toThrow()
      expect(host.call).not.toHaveBeenCalled()
    }
  )
})
