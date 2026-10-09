// Editing one queued card in place, inside the card itself, so it works while a question or an
// approval holds the composer's slot. The host owns the card; this pane holds only the typing,
// an edit lease that keeps automatic delivery off the card, and Save's compare-and-set.

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { structuredAgentSessionHostKey } from '@/runtime/structured-agent-session-host-capability'
import type {
  AgentSessionQueuedMessage,
  AgentSessionQueuedMessageUpdateResult
} from '../../../../shared/agent-session-wire'
import type { AgentJournalSubmission } from '../../../../shared/agent-session-journal-types'
import { agentSessionSendBodyFingerprint } from '../../../../shared/structured-agent-session-send-mutation'
import {
  queuedMessageEditableText,
  queuedMessageWithEditedText
} from '../../../../shared/queued-message-text-edit'
import { appendNativeChatDraftCache } from './native-chat-draft-cache'
import { structuredSessionOperationId } from './structured-agent-session-operation-id'
import {
  startQueuedEditLease,
  type QueuedEditLease
} from './structured-agent-session-queued-edit-lease'
import type { QueuedMessageCard } from './structured-agent-session-queued-cards'
import type { StructuredAgentSessionWrite } from './use-structured-agent-session-mutate'

export type QueuedEditTransport = {
  target: RuntimeClientTarget
  sessionId: string
  /** The host advertises `agent-session.queued-message-edit.v1`; without it there is no Edit. */
  capable: boolean
  write: StructuredAgentSessionWrite
}

export type QueuedMessageInlineEditor = {
  messageId: string
  text: string
  /** The host has not answered the lease yet: the field shows the text, read-only. */
  acquiring: boolean
  saving: boolean
  canSave: boolean
  change: (text: string) => void
  save: () => void
  cancel: () => void
}

type Edit = {
  scope: string
  messageId: string
  body: AgentSessionQueuedMessage['body']
  originalText: string
  text: string
  /** The body Save expects to replace; fixed for the edit, so a newer text is never overwritten. */
  baseFingerprint: string
  acquiring: boolean
  saving: boolean
  lease: QueuedEditLease
}

function editNotice(key: 'editChanged' | 'editFailed' | 'editGone'): string {
  switch (key) {
    case 'editChanged':
      return translate(
        'components.native-chat.queuedMessages.editChanged',
        'This message changed while you were editing. Cancel and edit it again to change the latest text.'
      )
    case 'editGone':
      return translate(
        'components.native-chat.queuedMessages.editGone',
        'This message was already sent or removed. Your edit is in the chat box.'
      )
    case 'editFailed':
      return translate(
        'components.native-chat.queuedMessages.editFailed',
        "This message can't be edited."
      )
  }
}

export function useStructuredAgentSessionQueuedEdit(args: {
  transport: QueuedEditTransport
  /** The host's published cards, for each card's full body. */
  messages: readonly AgentSessionQueuedMessage[] | null
  /** The cards this pane shows; a card that leaves them has left the queue. */
  cards: readonly QueuedMessageCard[]
  submissions: readonly AgentJournalSubmission[]
  composerScopeKey: string | undefined
}) {
  const { transport, messages, cards, submissions, composerScopeKey } = args
  const { target, sessionId, capable, write } = transport
  const scope = `${structuredAgentSessionHostKey(target)}:${sessionId}:${composerScopeKey ?? ''}`
  const active = useRef<Edit | null>(null)
  const [shown, setShown] = useState<Edit | null>(null)
  const latest = useRef({ cards, submissions })
  useEffect(() => {
    latest.current = { cards, submissions }
  }, [cards, submissions])

  const render = useCallback((edit: Edit | null) => {
    active.current = edit
    setShown(edit ? { ...edit } : null)
  }, [])
  const close = useCallback(() => {
    const edit = active.current
    render(null)
    edit?.lease.end()
  }, [render])
  /** The card left the queue under the editor: typing is never thrown away, it goes to the
   *  chat box, after whatever draft is already there. */
  const gone = useCallback(
    (edit: Edit) => {
      if (active.current !== edit) {
        return
      }
      if (edit.text !== edit.originalText && composerScopeKey) {
        appendNativeChatDraftCache(composerScopeKey, edit.text)
        toast.error(editNotice('editGone'))
      }
      close()
    },
    [close, composerScopeKey]
  )

  // Another chat, host or composer: the edit belongs to the one it started in.
  useEffect(
    () => () => {
      const edit = active.current
      active.current = null
      edit?.lease.end()
    },
    [scope]
  )

  const begin = useCallback(
    async (messageId: string): Promise<void> => {
      // One editor per pane: another card's Edit waits for this one's Save or Cancel.
      if (active.current || !capable || !composerScopeKey) {
        return
      }
      const message = messages?.find((entry) => entry.messageId === messageId)
      const text = message ? queuedMessageEditableText(message.body) : null
      if (!message || text === null) {
        return
      }
      const baseFingerprint = agentSessionSendBodyFingerprint(sessionId, message.body)
      const lease = startQueuedEditLease({
        target,
        sessionId,
        messageId,
        editId: structuredSessionOperationId(),
        expectedBodyFingerprint: baseFingerprint
      })
      const edit: Edit = {
        scope,
        messageId,
        body: message.body,
        originalText: text,
        text,
        baseFingerprint,
        acquiring: true,
        saving: false,
        lease
      }
      render(edit)
      const answer = await lease.acquired.catch(() => null)
      if (!isOpen(active, edit)) {
        return
      }
      if (answer?.status === 'gone' || answer?.status === 'changed') {
        // Sent, removed or edited elsewhere before the edit began: the card shows what happened.
        close()
      } else if (answer?.status === 'not-editable') {
        toast.error(editNotice('editFailed'))
        close()
      } else {
        // An unanswered lease never gates typing: the lease keeps trying, and Save checks the text.
        edit.acquiring = false
        render(edit)
      }
    },
    [capable, close, composerScopeKey, messages, render, scope, sessionId, target]
  )

  const change = useCallback(
    (text: string) => {
      const edit = active.current
      if (edit && !edit.acquiring && !edit.saving) {
        edit.text = text
        render(edit)
      }
    },
    [render]
  )

  const save = useCallback(async () => {
    const edit = active.current
    if (!edit || edit.acquiring || edit.saving) {
      return
    }
    if (edit.text === edit.originalText) {
      close()
      return
    }
    const body = queuedMessageWithEditedText(edit.body, edit.text)
    if (!body) {
      return
    }
    edit.saving = true
    render(edit)
    const result = await write<AgentSessionQueuedMessageUpdateResult>(
      'agentSession.queuedMessageUpdate',
      'agentSession.queuedMessageUpdate',
      { messageId: edit.messageId, expectedBodyFingerprint: edit.baseFingerprint, text: edit.text }
    )
    if (!isOpen(active, edit)) {
      return
    }
    edit.saving = false
    const status = result.kind === 'done' ? result.value.status : null
    if (status === 'updated' || status === 'unchanged' || result.kind === 'dropped') {
      close()
    } else if (status === 'gone') {
      gone(edit)
    } else if (result.kind === 'not-done' && !onScreen(latest.current.cards, edit.messageId)) {
      // The answer was lost and the card has since left: it went out with this Save's text, or
      // it went before the Save could land.
      const desired = agentSessionSendBodyFingerprint(sessionId, body)
      const sentAsSaved = latest.current.submissions.some(
        (entry) => entry.queuedMessageId === edit.messageId && entry.payloadFingerprint === desired
      )
      if (sentAsSaved) {
        close()
      } else {
        gone(edit)
      }
    } else {
      toast.error(
        result.kind === 'not-done'
          ? result.notice
          : editNotice(status === 'changed' ? 'editChanged' : 'editFailed')
      )
      render(edit)
    }
  }, [close, gone, render, sessionId, write])

  // Sent or removed elsewhere, or a lapsed lease lost the race to delivery. While a Save is out,
  // its answer decides instead: its own text going out right after it lands is a success.
  // An unloaded list (`null`) proves nothing: a stream that went quiet did not send the card.
  useEffect(() => {
    const edit = active.current
    if (edit && !edit.saving && messages !== null && !onScreen(cards, edit.messageId)) {
      gone(edit)
    }
  }, [cards, gone, messages, shown])

  const editor: QueuedMessageInlineEditor | undefined =
    shown && shown.scope === scope
      ? {
          messageId: shown.messageId,
          text: shown.text,
          acquiring: shown.acquiring,
          saving: shown.saving,
          canSave: queuedMessageWithEditedText(shown.body, shown.text) !== null,
          change,
          save: () => void save(),
          cancel: close
        }
      : undefined
  return { editor, begin, capable }
}

/** A read of the ref, not a narrowing: an await may have closed or replaced the edit. */
function isOpen(active: { current: Edit | null }, edit: Edit): boolean {
  return active.current === edit
}

function onScreen(cards: readonly QueuedMessageCard[], messageId: string): boolean {
  return cards.some((card) => card.messageId === messageId)
}
