import { z } from 'zod'
import { AgentLaunchFields } from './agent-launch-params'
import { LaunchPreferences, StrictNonEmptyString, WorktreeSelector } from './agent-session-params'

export const TerminalTypedCreate = z
  .object({
    worktree: WorktreeSelector,
    agent: z.enum(['codex', 'claude']),
    model: LaunchPreferences.shape.model,
    effort: LaunchPreferences.shape.effort,
    operationId: AgentLaunchFields.shape.operationId.unwrap(),
    attemptId: StrictNonEmptyString(128, 'Invalid attempt id'),
    presentation: z.enum(['background', 'focused']).optional()
  })
  .strict()
