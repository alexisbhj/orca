import { TerminalTypedCreate } from '../../../../shared/rpc-contract/terminal-typed-create-params'
import { defineMethod } from '../core'
import { runReplaySafeAgentLaunch } from './agent-launch'
import { AgentLaunchExecutionError } from './agent-launch-execution-outcome'
import { assertAgentLaunchTargetAuthorized } from './agent-launch-target-authorization'
import { resolveWorkerLaunchPreferences } from './orchestration/worker/worker-launch-preferences'

export const TERMINAL_TYPED_CREATE_METHODS = [
  defineMethod({
    name: 'terminal.createTyped',
    permission: 'workspace',
    params: TerminalTypedCreate,
    handler: async (params, context) => {
      const target = { kind: 'existing' as const, worktree: params.worktree }
      assertAgentLaunchTargetAuthorized(target, context)
      const selection = resolveWorkerLaunchPreferences(params)
      try {
        const launch = await runReplaySafeAgentLaunch(
          {
            agent: params.agent,
            target,
            operationId: params.operationId,
            terminalOnly: true,
            ...(selection.preferences ? { sessionOptions: { ...selection.preferences } } : {}),
            presentation: params.presentation ?? 'background'
          },
          context
        )
        if (launch.outcome.kind !== 'terminal') {
          throw new Error('agent_session_operation_conflict')
        }
        return {
          operationId: params.operationId,
          attemptId: params.attemptId,
          terminal: {
            handle: launch.outcome.handle,
            paneKey: launch.outcome.paneKey,
            worktreeId: launch.worktreeId
          },
          launch
        }
      } catch (error) {
        if (error instanceof AgentLaunchExecutionError) {
          if (error.failedWithoutEffects) {
            throw error.cause
          }
          throw new Error('agent_session_operation_unknown', { cause: error.cause })
        }
        throw error
      }
    }
  })
]
