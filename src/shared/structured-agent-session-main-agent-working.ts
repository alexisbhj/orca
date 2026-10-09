import type { AgentJournalSubmission } from './agent-session-journal-types'
import { hasUnansweredStructuredAgentSessionDispatch } from './structured-agent-session-unanswered-dispatch'

/** Whether the session's own agent is working: a running turn, or a send it has not answered.
 *  The one rule behind every session list's Working and the chat's own Stop. Callers pass the turn
 *  scoped to `currentFence` (`isStructuredAgentSessionEndedGenerationWork`). */
export function isStructuredAgentSessionMainAgentWorking(
  activeTurnId: string | null,
  submissions: readonly AgentJournalSubmission[],
  currentFence?: number | null
): boolean {
  return (
    activeTurnId !== null || hasUnansweredStructuredAgentSessionDispatch(submissions, currentFence)
  )
}

/** The fence of the writer that created a journal item, where the reader knows it: the host does,
 *  a client does not. */
export type StructuredAgentSessionItemFence = (itemId: string) => number | undefined

/** Work a generation below the lease's fence wrote — a running turn, a pending prompt. Every release
 *  moves the fence, so that generation can no longer finish it: it holds nothing and is not
 *  Working, whether or not its settlement has landed yet. */
export function isStructuredAgentSessionEndedGenerationWork(
  itemFence: number | undefined,
  currentFence: number | null | undefined
): boolean {
  return currentFence != null && itemFence !== undefined && itemFence < currentFence
}
