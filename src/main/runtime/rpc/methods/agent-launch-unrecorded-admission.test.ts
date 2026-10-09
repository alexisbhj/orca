import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentLaunchReplay } from '../../../../shared/rpc-contract/agent-launch-params'
import { computeAgentLaunchFingerprint } from '../../../../shared/agent-launch-operation'
import { AGENT_LAUNCH_RUNTIME_CAPABILITY } from '../../../../shared/agent-launch-runtime-capability'
import type { RpcContext } from '../core'
import { DESKTOP_RPC_CALLER } from '../rpc-caller-identity'
import { admitAgentLaunchOperation } from './agent-launch-replay'
import {
  CAPABLE_CLIENT,
  rpcContext,
  runtimeStub,
  setAgentLaunchRecordStore
} from './agent-launch.test-fixture'
import { openTestAgentSessionRecordStore } from '../../agent-session-record-store-test-harness'
import type { AgentSessionRecordStore } from '../../agent-session-record-store'

const DESKTOP: Partial<RpcContext> = {
  caller: DESKTOP_RPC_CALLER,
  clientKind: 'runtime',
  clientCapabilities: [AGENT_LAUNCH_RUNTIME_CAPABILITY]
}
const CLI: Partial<RpcContext> = {}

let store: AgentSessionRecordStore
beforeEach(async () => {
  store = await openTestAgentSessionRecordStore(
    await mkdtemp(join(tmpdir(), 'agent-launch-unrecorded-'))
  )
  setAgentLaunchRecordStore(store)
})
afterEach(() => setAgentLaunchRecordStore(null))

function launch(followUp?: { kind: string; version: number; payload: unknown }) {
  return AgentLaunchReplay.parse({
    agent: 'claude',
    target: { kind: 'existing', worktree: 'id:wt-7' },
    operationId: `${Date.now()}-0123456789abcdef0123456789abcdef`,
    ...(followUp ? { followUp } : {})
  })
}

async function admit(caller: Partial<RpcContext>, params: ReturnType<typeof launch>) {
  const runtime = runtimeStub({ settings: {} })
  runtime.openAgentSessionRecordStore.mockRejectedValue(new Error('record store unavailable'))
  return admitAgentLaunchOperation(
    rpcContext(runtime, caller),
    params,
    computeAgentLaunchFingerprint(params)
  )
}

describe('a launch whose record cannot be written', () => {
  it("runs the desktop's own click unrecorded, as main's new tab ran with no record", async () => {
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const admitted = await admit(DESKTOP, launch())
      expect(admitted).toMatchObject({ decision: 'execute' })
      if (admitted.decision !== 'execute') {
        throw new Error('expected an unrecorded execution')
      }
      await expect(admitted.fail('spawn_failed')).resolves.toBeUndefined()
      expect(store.listOperationRows()).toEqual([])
      expect(quiet).toHaveBeenCalledOnce()
    } finally {
      quiet.mockRestore()
    }
  })

  it('runs it unrecorded when the store opens but the claim write fails', async () => {
    vi.spyOn(store, 'admitAndClaimOperation').mockRejectedValue(new Error('SQLITE_FULL'))
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const params = launch()
      const admitted = await admitAgentLaunchOperation(
        rpcContext(runtimeStub({ settings: {} }), DESKTOP),
        params,
        computeAgentLaunchFingerprint(params)
      )
      expect(admitted).toMatchObject({ decision: 'execute' })
    } finally {
      quiet.mockRestore()
    }
  })

  it('still refuses a desktop launch whose follow-up only the record could run', async () => {
    await expect(
      admit(DESKTOP, launch({ kind: 'test-follow-up', version: 1, payload: {} }))
    ).rejects.toThrow('record store unavailable')
  })

  it.each([
    ['the CLI', CLI],
    ['a phone, which retries the same id', CAPABLE_CLIENT]
  ])(
    'still refuses %s, since a retry without the record would launch twice',
    async (_name, caller) => {
      await expect(admit(caller, launch())).rejects.toThrow('record store unavailable')
    }
  )
})
