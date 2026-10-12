import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { buildTypedAgentLaunchCatalog } from '../../../../shared/typed-agent-launch-catalog'
import { openTestAgentSessionRecordStore } from '../../agent-session-record-store-test-harness'
import { formatZodError } from '../core'
import {
  methodNamed,
  rpcContext,
  runtimeStub,
  setAgentLaunchRecordStore
} from './agent-launch.test-fixture'
import { TERMINAL_TYPED_CREATE_METHODS } from './terminal-typed-create'
import { checkTypedTerminalLaunchChoice } from './terminal-typed-launch-check'

const method = methodNamed(TERMINAL_TYPED_CREATE_METHODS, 'terminal.createTyped')
let directory: string
let sequence = 0

async function createTyped(choice: Record<string, unknown>) {
  const runtime = runtimeStub()
  const params = {
    worktree: 'id:wt-7',
    operationId: `${Date.now()}-${String(++sequence).padStart(32, '0')}`,
    attemptId: 'attempt-1',
    ...choice
  }
  try {
    await method.handler(method.params.parse(params), rpcContext(runtime, { clientId: 'cli' }))
    return { valid: true as const, spawned: runtime.createTerminal.mock.calls.length }
  } catch (error) {
    if (error instanceof ZodError) {
      return { valid: false as const, code: 'invalid_argument', message: formatZodError(error) }
    }
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    return { valid: false as const, code, message: error instanceof Error ? error.message : '' }
  }
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orca-typed-check-'))
  setAgentLaunchRecordStore(await openTestAgentSessionRecordStore(directory))
})
afterEach(async () => {
  setAgentLaunchRecordStore(null)
  await rm(directory, { recursive: true, force: true })
})

describe('typed terminal launch dry run', () => {
  it.each([
    { agent: 'codex' },
    { agent: 'codex', model: 'gpt-5.5', effort: 'xhigh' },
    { agent: 'codex', model: 'gpt-5.5', effort: 'ultra' },
    { agent: 'codex', model: 'some-future-model', effort: 'ultra' },
    { agent: 'codex', model: 'some-future-model', effort: 'nope' },
    { agent: 'claude', model: 'opus', effort: 'max' },
    { agent: 'claude', model: 'haiku', effort: 'high' },
    { agent: 'claude', effort: 'high' },
    { agent: 'claude', model: ' opus' },
    { agent: 'gemini', model: 'x' },
    { agent: 'claude', model: 'opus', prompt: 'do it' }
  ])('accepts and refuses exactly like terminal.createTyped: %j', async (choice) => {
    const live = await createTyped(choice)
    const dry = checkTypedTerminalLaunchChoice(choice)
    if (live.valid) {
      expect(live.spawned).toBe(1)
      expect(dry).toMatchObject({ valid: true })
    } else {
      expect(dry).toEqual({ valid: false, code: live.code, message: live.message })
    }
  })

  it('reports the effective choice without launching', () => {
    expect(checkTypedTerminalLaunchChoice({ agent: 'codex', model: 'gpt-5.5' })).toEqual({
      valid: true,
      choice: { agent: 'codex', model: 'gpt-5.5', effort: null }
    })
  })

  it('names a refused effort in the createTyped wording', () => {
    expect(
      checkTypedTerminalLaunchChoice({ agent: 'claude', model: 'haiku', effort: 'high' })
    ).toEqual({
      valid: false,
      code: 'invalid_argument',
      message: 'Agent claude model haiku does not support effort high.'
    })
  })

  it('accepts every model and effort the catalog advertises', () => {
    for (const agent of buildTypedAgentLaunchCatalog().agents) {
      for (const model of agent.models) {
        expect(checkTypedTerminalLaunchChoice({ agent: agent.id, model: model.id })).toMatchObject({
          valid: true
        })
        for (const effort of model.efforts) {
          expect(
            checkTypedTerminalLaunchChoice({ agent: agent.id, model: model.id, effort: effort.id })
          ).toMatchObject({ valid: true })
        }
      }
      if (agent.customModels.accepted) {
        for (const effort of agent.customModels.efforts) {
          expect(
            checkTypedTerminalLaunchChoice({
              agent: agent.id,
              model: 'not-in-catalog',
              effort: effort.id
            })
          ).toMatchObject({ valid: true })
        }
      }
    }
  })
})
