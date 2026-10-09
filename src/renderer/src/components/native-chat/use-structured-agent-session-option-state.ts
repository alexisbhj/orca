import type { useAgentSessionPermissionState } from '../../../../shared/use-agent-session-permission-state'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentSessionConversationCommand } from '../../../../shared/agent-session-conversation-command'
import type { AgentSessionOptionsResult } from '../../../../shared/agent-session-wire'
import type { AgentSessionRewindSupport } from '../../../../shared/agent-session-rewind'
import type { AgentType } from '../../../../shared/agent-status-types'
import type { AgentSessionOptionCatalog } from '../../../../shared/agent-session-option-catalog'
import { structuredAgentSessionSeedCatalog } from './structured-agent-session-seed-catalog'
import {
  applyStructuredAgentSessionOptions,
  createStructuredAgentSessionOptionState,
  type StructuredAgentSessionOptionState
} from '../../../../shared/structured-agent-session-options'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import { structuredAgentSessionHostKey } from '@/runtime/structured-agent-session-host-capability'
import {
  createCoalescedPollRunner,
  type CoalescedPollRunner
} from '../right-sidebar/coalesced-poll-runner'

/** The picker's option state for one session: seeded, reset at each fence, re-read each turn. */
export function useStructuredAgentSessionOptionState(args: {
  agent: AgentType
  optionCatalog: AgentSessionOptionCatalog | null
  identity: string
  fence: number | null
  sessionId: string
  target: RuntimeClientTarget
  providerVisible: boolean
  providerStarting: boolean
  readsBeforeStart: boolean
  turnId: string | null
  permissionMode?: string | null
  permissionState?: ReturnType<typeof useAgentSessionPermissionState>
  unloadedTurnRevisions: number | undefined
}) {
  const {
    agent,
    fence,
    identity,
    optionCatalog,
    providerStarting,
    providerVisible,
    readsBeforeStart,
    sessionId,
    target,
    turnId,
    permissionState
  } = args
  const beginPermissionRead = permissionState?.begin
  const confirmPermissionRead = permissionState?.confirmRead
  const [conversationSupport, setConversationSupport] = useState<{
    sessionId: string
    commands: readonly AgentSessionConversationCommand[]
    threadGoal: AgentSessionOptionsResult['threadGoal']
    contextUsage: AgentSessionOptionsResult['contextUsage']
    rewind: AgentSessionRewindSupport
    /** The fence the read answered for; rewind support is only that runtime's. */
    fence: number | null
  } | null>(null)
  // A revision the loaded window dropped can move the host's whole-journal context facts.
  const contextRefresh = conversationSupport?.contextUsage ? (args.unloadedTurnRevisions ?? 0) : 0
  // Seeded from the first frame: the picker renders the static catalog while
  // create, attach and the first live options read are still running.
  const [optionState, setOptionState] = useState(() =>
    createStructuredAgentSessionOptionState(agent, optionCatalog)
  )
  const optionStateRef = useRef(optionState)
  const activeOptionRecordRef = useRef(optionState.record)
  const pendingOptionRef = useRef<string | null>(null)
  const optionMutationGeneration = useRef(0)
  // Turn reads and post-write reads both land here; only the newest started read may apply.
  const optionReadGeneration = useRef(0)
  const updateOptionState = useCallback(
    (update: (current: StructuredAgentSessionOptionState) => StructuredAgentSessionOptionState) => {
      const next = update(optionStateRef.current)
      optionStateRef.current = next
      setOptionState(next)
    },
    []
  )
  const optionIdentityRef = useRef(identity)
  useEffect(() => {
    const previous = optionStateRef.current
    const sameSession = optionIdentityRef.current === identity
    optionIdentityRef.current = identity
    const seeded = createStructuredAgentSessionOptionState(
      agent,
      structuredAgentSessionSeedCatalog(agent)
    )
    // A host catalog is the account's, not the fence's: keep it rather than blank the default.
    const next =
      sameSession && previous.catalogSource === 'host'
        ? { ...seeded, catalog: previous.catalog, catalogSource: previous.catalogSource }
        : seeded
    optionMutationGeneration.current += 1
    pendingOptionRef.current = null
    optionStateRef.current = next
    activeOptionRecordRef.current = next.record
    setOptionState(next)
  }, [agent, fence, identity])

  const optionsReadRef = useRef<CoalescedPollRunner | null>(null)
  // Keyed by value: a caller may build the target inline, and each read's permission begin
  // re-renders, so an identity dependency would start a read on every render.
  const targetKey = structuredAgentSessionHostKey(target)
  const targetRef = useRef(target)
  useEffect(() => {
    targetRef.current = target
  }, [target])
  // Refresh options each turn to confirm which model the provider actually selected, and once
  // the provider starts: only then has the host read what it will run.
  useEffect(() => {
    if (!providerVisible || (providerStarting && !readsBeforeStart) || !optionCatalog) {
      return
    }
    let stale = false
    const runner = createCoalescedPollRunner(async () => {
      const readGeneration = optionMutationGeneration.current
      const read = ++optionReadGeneration.current
      const permissionRead = beginPermissionRead?.()
      const result = await callStructuredAgentSession<AgentSessionOptionsResult>(
        targetRef.current,
        'agentSession.options',
        { sessionId }
      )
      if (permissionRead) {
        confirmPermissionRead?.(permissionRead, result.permissionModes)
      }
      if (!stale && optionMutationGeneration.current === readGeneration) {
        setConversationSupport({
          sessionId,
          commands: result.conversationCommands ?? [],
          threadGoal: result.threadGoal,
          contextUsage: result.contextUsage,
          // A host that predates rewind does not name it.
          rewind: result.rewind ?? { supported: false, reason: 'unsupported' },
          fence
        })
        updateOptionState((current) =>
          current.record === activeOptionRecordRef.current && optionReadGeneration.current === read
            ? applyStructuredAgentSessionOptions(current, optionCatalog, result)
            : current
        )
      }
    })
    optionsReadRef.current = runner
    runner.run()
    return () => {
      stale = true
      runner.dispose()
    }
  }, [
    fence,
    optionCatalog,
    providerStarting,
    providerVisible,
    readsBeforeStart,
    sessionId,
    targetKey,
    args.permissionMode,
    turnId,
    updateOptionState,
    beginPermissionRead,
    confirmPermissionRead
  ])

  // A write's own read; `isCurrent` drops it once the picked record or mutation moved on.
  const refreshOptionsAfterWrite = useCallback(
    (targetRecord: StructuredAgentSessionOptionState['record'], isCurrent: () => boolean) => {
      const read = ++optionReadGeneration.current
      const permissionRead = beginPermissionRead?.()
      void callStructuredAgentSession<AgentSessionOptionsResult>(target, 'agentSession.options', {
        sessionId
      })
        .then((refreshed) => {
          if (permissionRead) {
            confirmPermissionRead?.(permissionRead, refreshed.permissionModes)
          }
          if (isCurrent() && optionReadGeneration.current === read) {
            updateOptionState((latest) =>
              latest.record === targetRecord && optionCatalog
                ? applyStructuredAgentSessionOptions(latest, optionCatalog, refreshed)
                : latest
            )
          }
        })
        .catch(() => {})
    },
    [
      optionCatalog,
      sessionId,
      target,
      updateOptionState,
      beginPermissionRead,
      confirmPermissionRead
    ]
  )

  // Reads share the session's host queue with sends and interrupts, so a burst of
  // missed revisions keeps one read in flight and at most one behind it.
  const seenContextRefresh = useRef(contextRefresh)
  useEffect(() => {
    if (contextRefresh !== seenContextRefresh.current) {
      seenContextRefresh.current = contextRefresh
      optionsReadRef.current?.run()
    }
  }, [contextRefresh])

  return {
    conversationSupport,
    optionState,
    optionStateRef,
    activeOptionRecordRef,
    pendingOptionRef,
    optionMutationGeneration,
    refreshOptionsAfterWrite,
    updateOptionState
  }
}
