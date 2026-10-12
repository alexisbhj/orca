import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openTestAgentSessionRecordStore } from '../../agent-session-record-store-test-harness'
import {
  methodNamed,
  rpcContext,
  runtimeStub,
  setAgentLaunchRecordStore
} from './agent-launch.test-fixture'
import { TERMINAL_TYPED_CREATE_METHODS } from './terminal-typed-create'

const method = methodNamed(TERMINAL_TYPED_CREATE_METHODS, 'terminal.createTyped')
let directory: string
const request = () => ({
  worktree: 'id:wt-7',
  agent: 'codex',
  model: 'gpt-5.4',
  effort: 'high',
  operationId: `${Date.now()}-000000000000000000000000000000aa`,
  attemptId: 'attempt-1'
})
const launch = (params: unknown, runtime = runtimeStub()) =>
  method.handler(method.params.parse(params), rpcContext(runtime, { clientId: 'cli-test' }))

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orca-typed-terminal-'))
  setAgentLaunchRecordStore(await openTestAgentSessionRecordStore(directory))
})
afterEach(async () => {
  setAgentLaunchRecordStore(null)
  await rm(directory, { recursive: true, force: true })
})

describe('typed terminal creation', () => {
  it('starts a fresh terminal even when native chat is the default, without a prompt or checkout', async () => {
    const runtime = runtimeStub()
    const result = await launch(request(), runtime)
    expect(result).toMatchObject({
      terminal: { handle: 'term_1' },
      launch: { receipt: { mode: 'terminal' } }
    })
    expect(runtime.createTerminal).toHaveBeenCalledWith(
      'id:wt-7',
      expect.objectContaining({
        startupAgent: 'codex',
        launchPreferences: { model: 'gpt-5.4', effort: 'high' },
        viewMode: 'terminal',
        presentation: 'background'
      })
    )
    expect(runtime.createTerminal.mock.calls[0]?.[1]).not.toHaveProperty('startupPrompt')
    expect(runtime.createManagedWorktree).not.toHaveBeenCalled()
  })
  it('replays creation after restart and a new transport attempt without another spawn', async () => {
    const params = request()
    const first = await launch(params)
    setAgentLaunchRecordStore(await openTestAgentSessionRecordStore(directory))
    const restarted = runtimeStub()
    const second = await launch({ ...params, attemptId: 'attempt-2' }, restarted)
    expect(second.terminal).toEqual(first.terminal)
    expect(second.attemptId).toBe('attempt-2')
    expect(restarted.createTerminal).not.toHaveBeenCalled()
  })
  it('refuses a changed model under an existing operation identity', async () => {
    const params = request()
    await launch(params)
    await expect(launch({ ...params, model: 'gpt-5.3-codex' })).rejects.toThrow(
      'agent_session_operation_conflict'
    )
  })
  it.each([
    { agent: 'claude', model: 'opus', effort: 'impossible' },
    { effort: 'high', model: undefined },
    { agent: 'codex', model: 'gpt-5.4', effort: 'impossible' }
  ])('rejects unsupported picks before spawning: %j', async (picks) => {
    const runtime = runtimeStub()
    await expect(launch({ ...request(), ...picks }, runtime)).rejects.toThrow()
    expect(runtime.createTerminal).not.toHaveBeenCalled()
  })
  it('refuses prompt and arbitrary shell fields at the wire boundary', () => {
    expect(method.params.safeParse({ ...request(), prompt: 'do work' }).success).toBe(false)
    expect(method.params.safeParse({ ...request(), command: 'codex' }).success).toBe(false)
  })

  it('retains an uncertain spawn across interruption and restart instead of creating again', async () => {
    const params = request()
    const runtime = runtimeStub()
    runtime.createTerminal.mockImplementation(async (_selector, options) => {
      if (typeof options?.onPtySpawnDispatched === 'function') {
        options.onPtySpawnDispatched()
      }
      throw new Error('transport lost')
    })
    await expect(launch(params, runtime)).rejects.toThrow('agent_session_operation_unknown')
    setAgentLaunchRecordStore(await openTestAgentSessionRecordStore(directory))
    const restarted = runtimeStub()
    await expect(launch({ ...params, attemptId: 'after-restart' }, restarted)).rejects.toThrow(
      'agent_session_operation_unknown'
    )
    expect(restarted.createTerminal).not.toHaveBeenCalled()
  })
  it('launches Claude with compatible explicit picks', async () => {
    const runtime = runtimeStub()
    await launch({ ...request(), agent: 'claude', model: 'opus', effort: 'high' }, runtime)
    expect(runtime.createTerminal).toHaveBeenCalledWith(
      'id:wt-7',
      expect.objectContaining({
        startupAgent: 'claude',
        launchPreferences: { model: 'opus', effort: 'high' }
      })
    )
  })
})
