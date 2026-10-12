import type { AgentLaunchPreferences } from '../../../../shared/agent-session-host-authority'
import {
  TypedAgentLaunchChoice,
  type TypedAgentLaunchCheckResult
} from '../../../../shared/typed-agent-launch-catalog'
import { formatZodError } from '../core'
import { resolveWorkerLaunchPreferences } from './orchestration/worker/worker-launch-preferences'

/** The agent/model/effort rules `terminal.createTyped` enforces, shared with its dry run. */
export function resolveTypedTerminalLaunchChoice(
  choice: TypedAgentLaunchChoice
): AgentLaunchPreferences | undefined {
  return resolveWorkerLaunchPreferences(choice).preferences
}

/** Dry run: no session, record or terminal is touched. */
export function checkTypedTerminalLaunchChoice(input: unknown): TypedAgentLaunchCheckResult {
  const parsed = TypedAgentLaunchChoice.safeParse(input)
  if (!parsed.success) {
    return {
      valid: false,
      code: 'invalid_argument',
      message: formatZodError(parsed.error).slice(0, 1024)
    }
  }
  try {
    const preferences = resolveTypedTerminalLaunchChoice(parsed.data)
    return {
      valid: true,
      choice: {
        agent: parsed.data.agent,
        model: preferences?.model ?? null,
        effort: preferences?.effort ?? null
      }
    }
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'invalid_argument'
    return {
      valid: false,
      code: code.slice(0, 64),
      message: (error instanceof Error ? error.message : String(error)).slice(0, 1024)
    }
  }
}
