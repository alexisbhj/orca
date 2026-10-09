import type { AgentSessionStoreTransactions } from './agent-session-store-transactions'
import {
  commitConversationClearRecord,
  type AgentSessionConversationClear
} from './agent-session-conversation-command-record'
import { settleAgentSessionOperationInto } from './agent-session-operation-admission'
import { commitAgentSessionRewindCompletion } from './agent-session-rewind-completion'
import { markAgentSessionLeftoverSettled } from './agent-session-lease-transitions'

export function createAgentSessionConversationReceipts(
  transactions: Pick<AgentSessionStoreTransactions, 'receipt'>
) {
  return {
    clear: (
      clear: () => AgentSessionConversationClear,
      operation: { callerKey: string; operationId: string }
    ) =>
      transactions.receipt((draft) => {
        const completed = clear()
        commitConversationClearRecord(draft, completed)
        settleAgentSessionOperationInto(draft, {
          ...operation,
          outcome: {
            status: 'succeeded',
            sessionId: completed.sessionId,
            conversationCommand: completed.command
          }
        })
      }),
    rewind: (
      ...args: Parameters<typeof commitAgentSessionRewindCompletion> extends [unknown, ...infer A]
        ? A
        : never
    ) => transactions.receipt((draft) => commitAgentSessionRewindCompletion(draft, ...args)),
    /** Committed with the settlement of what ended generations left: see `leftoverSettledAt`. */
    leftoverSettled: (sessionId: string, plannedFence: number, now: number) =>
      transactions.receipt((draft) => {
        const record = draft.records.get(sessionId)
        if (record) {
          draft.records.set(sessionId, markAgentSessionLeftoverSettled(record, plannedFence, now))
        }
      })
  }
}
