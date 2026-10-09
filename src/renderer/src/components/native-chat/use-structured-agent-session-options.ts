import { toast } from 'sonner'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import { structuredAgentSessionSeedCatalog } from './structured-agent-session-seed-catalog'
import {
  canSetStructuredAgentSessionOption,
  lockedStructuredAgentSessionOptionSnapshot,
  pendingModelListStructuredAgentSessionOptionSnapshot,
  structuredAgentSessionOptionSnapshot,
  structuredAgentSessionOptionView,
  type StructuredAgentSessionOptionState
} from '../../../../shared/structured-agent-session-options'
import { structuredAgentSessionOptionPicks } from '../../../../shared/structured-agent-session-option-picks'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { enqueueSessionOptionSettingsWrite } from './native-chat-session-option-settings-write'
import { encodeStructuredAgentSessionOptionValue } from '../../../../shared/structured-agent-session-option-codec'
import type { StructuredAgentSessionMutate } from './use-structured-agent-session-mutate'
import { useHostModelCatalogUpgrade } from './use-host-model-catalog-upgrade'
import { useStructuredAgentSessionOptionState } from './use-structured-agent-session-option-state'
import { agentSessionWriteFailureText } from './agent-session-write-notice-text'
import type { StructuredAgentSessionLaunchView } from './use-native-chat-provisional-launch'
import type { SessionPermissionPublication } from '../../../../shared/agent-session-permission-reducer'
import { useAgentSessionPermissionState } from '../../../../shared/use-agent-session-permission-state'
import { useStructuredAgentOptionWrite } from './use-structured-agent-option-write'
import { structuredAgentSessionHostKey } from '@/runtime/structured-agent-session-host-capability'
import {
  AGENT_CHAT_PERMISSION_MODE_OPTION_ID,
  isAgentChatPermissionMode
} from '../../../../shared/agent-chat-permission-mode'
import type {
  NativeChatPermissionModePickerState,
  StructuredSessionOptionsSurface
} from './native-chat-permission-mode-labels'
import {
  getStructuredAgentSessionLaunchSelection,
  holdStructuredAgentSessionLaunchOption,
  type StructuredLaunchOptionOutcome
} from '@/lib/structured-agent-session-launch-options'

const NO_HELD_OPTIONS: Readonly<Record<string, string>> = {}

export function useStructuredAgentSessionOptions(args: {
  agent: AgentType
  sessionId: string
  target: RuntimeClientTarget
  transportEnabled: boolean
  isVisible: boolean
  providerVisible: boolean
  providerStarting?: boolean
  providerRunning?: boolean
  fence: number | null
  turnId: string | null
  permissionMode?: string | null
  permissionRevision?: number
  permissionPublication?: SessionPermissionPublication
  unloadedTurnRevisions: number | undefined
  mutate: StructuredAgentSessionMutate
  launch?: StructuredAgentSessionLaunchView
}) {
  const {
    agent,
    fence,
    launch,
    mutate,
    providerVisible,
    sessionId,
    target,
    transportEnabled,
    turnId
  } = args
  const launchSeedOptions = launch?.seedOptions
  const held = launch?.heldOptions ?? NO_HELD_OPTIONS
  // Model picks wait for attachment; permissions can use the host receipt first.
  const acceptsPicks = !transportEnabled || fence !== null
  const optionCatalog = useMemo(() => structuredAgentSessionSeedCatalog(agent), [agent])
  const identity = JSON.stringify([structuredAgentSessionHostKey(target), agent, sessionId])
  const publication = useMemo(
    () =>
      args.permissionPublication ??
      (args.permissionMode === null || isAgentChatPermissionMode(args.permissionMode)
        ? { mode: args.permissionMode, fence, revision: args.permissionRevision }
        : undefined),
    [args.permissionMode, args.permissionRevision, fence, args.permissionPublication]
  )
  const permissionState = useAgentSessionPermissionState(
    {
      identity,
      agent,
      fence,
      publication,
      launchMode: held.permissionMode ?? launchSeedOptions?.permissionMode
    },
    React
  )
  const optionOwner = useStructuredAgentSessionOptionState({
    agent,
    optionCatalog,
    identity,
    fence,
    sessionId,
    target,
    providerVisible,
    providerStarting: args.providerStarting ?? false,
    // A new chat's host knows nothing of its model before the provider starts; a resumed one's
    // holds the model it ran, so only the former waits rather than show the host's guess.
    readsBeforeStart: launch?.kind !== 'new',
    turnId,
    permissionMode: args.permissionMode,
    permissionState,
    unloadedTurnRevisions: args.unloadedTurnRevisions
  })
  const {
    optionState,
    optionStateRef,
    activeOptionRecordRef,
    pendingOptionRef,
    updateOptionState,
    conversationSupport
  } = optionOwner

  const hostCatalog = useHostModelCatalogUpgrade({
    agent,
    sessionId,
    target,
    optionCatalog,
    enabled: args.isVisible,
    // A resumed conversation may keep its own model, so only a new one runs the listed default.
    namesDefault: launch?.kind === 'new' && optionCatalog?.hostListingNamesConfiguredModel === true,
    ...(launch?.worktree ? { worktree: launch.worktree } : {}),
    fence,
    turnId,
    ...(args.providerRunning ? { providerRunning: true } : {}),
    activeOptionRecordRef,
    updateOptionState
  })
  // A list in hand, the running provider's or the host's, ends the wait for the host's; so does a
  // verdict, whose re-check is for the chat's notice, not the picker.
  const modelListPending =
    hostCatalog.awaitingListing &&
    hostCatalog.unavailable === null &&
    optionState.catalogSource !== 'live' &&
    optionState.catalogSource !== 'host'

  // What a settled pick must remember so the next launch starts where the user left off.
  const rememberOptionPicks = useCallback(
    (view: StructuredAgentSessionOptionState, committed: Readonly<Record<string, string>>) => {
      const picks = structuredAgentSessionOptionPicks(view, committed)
      if (picks.length > 0) {
        void enqueueSessionOptionSettingsWrite(target, { type: 'apply-picks', agent, picks })
      }
    },
    [agent, target]
  )
  const sendStructuredOption = useStructuredAgentOptionWrite({
    state: optionOwner,
    permissionState,
    fence,
    sessionId,
    target,
    mutate,
    launchSeedOptions,
    rememberOptionPicks
  })
  const settleLaunchOptionPick = useCallback(
    (id: string, outcome: StructuredLaunchOptionOutcome) => {
      if (outcome.kind === 'refused') {
        toast.error(agentSessionWriteFailureText(outcome.failure, 'option'))
      } else if (outcome.kind === 'accepted' && id !== AGENT_CHAT_PERMISSION_MODE_OPTION_ID) {
        rememberOptionPicks(
          structuredAgentSessionOptionView(
            optionStateRef.current,
            launchSeedOptions,
            NO_HELD_OPTIONS
          ),
          outcome.options
        )
      }
    },
    [launchSeedOptions, optionStateRef, rememberOptionPicks]
  )
  const optionSnapshot = useMemo(() => {
    const snapshot = structuredAgentSessionOptionSnapshot(
      structuredAgentSessionOptionView(optionState, launchSeedOptions, held)
    )
    const shown = acceptsPicks ? snapshot : lockedStructuredAgentSessionOptionSnapshot(snapshot)
    return modelListPending ? pendingModelListStructuredAgentSessionOptionSnapshot(shown) : shown
  }, [acceptsPicks, held, launchSeedOptions, modelListPending, optionState])
  const setStructuredOption = useCallback(
    async (id: string, value: string | boolean): Promise<boolean> => {
      const view = {
        ...structuredAgentSessionOptionView(optionStateRef.current, launchSeedOptions, held),
        permission: permissionState.permission
      }
      const encoded = encodeStructuredAgentSessionOptionValue(id, value)
      if (
        !optionCatalog ||
        encoded === null ||
        // A typed `/model` reaches here without the picker.
        optionSnapshot.some((descriptor) => descriptor.id === id && descriptor.choicesPending) ||
        !canSetStructuredAgentSessionOption(view, id, value)
      ) {
        return false
      }
      if (!transportEnabled) {
        // No fence yet: the launch holds it and applies it before anything else is sent.
        const request = permissionState.begin(
          id === AGENT_CHAT_PERMISSION_MODE_OPTION_ID && isAgentChatPermissionMode(encoded)
            ? encoded
            : undefined
        )
        const applied = holdStructuredAgentSessionLaunchOption(sessionId, id, encoded)
        if (!applied) {
          permissionState.confirmWrite(request)
        }
        void applied?.then((outcome) => {
          permissionState.confirmWrite(
            request,
            outcome.kind === 'accepted' ? outcome.options.permissionMode : undefined,
            outcome.kind === 'accepted' ? outcome.permissionFact : undefined
          )
          settleLaunchOptionPick(id, outcome)
        })
        return applied !== null
      }
      if (pendingOptionRef.current !== null) {
        return false
      }
      return sendStructuredOption(id, encoded)
    },
    [
      held,
      launchSeedOptions,
      optionCatalog,
      optionSnapshot,
      optionStateRef,
      pendingOptionRef,
      sendStructuredOption,
      sessionId,
      settleLaunchOptionPick,
      transportEnabled,
      permissionState
    ]
  )
  const setOption = useCallback(
    async (id: string, value: string | boolean) => {
      await setStructuredOption(id, value)
      // Read, not rendered: a pick the launch just took is not in this render's props yet.
      const currentHeld = getStructuredAgentSessionLaunchSelection(sessionId)?.held
      return {
        snapshot: structuredAgentSessionOptionSnapshot(
          structuredAgentSessionOptionView(
            optionStateRef.current,
            launchSeedOptions,
            currentHeld ?? NO_HELD_OPTIONS
          )
        )
      }
    },
    [launchSeedOptions, optionStateRef, sessionId, setStructuredOption]
  )
  const permissionModes = permissionState.permission
  const permissionPicker = useMemo<NativeChatPermissionModePickerState | null>(
    () =>
      permissionModes
        ? {
            provider: agent,
            current: permissionModes.current,
            supported: permissionModes.supported,
            pending:
              permissionState.pending ||
              optionState.pendingId === AGENT_CHAT_PERMISSION_MODE_OPTION_ID,
            disabled: permissionState.pending || optionState.pendingId !== null,
            setMode: (mode) => setStructuredOption(AGENT_CHAT_PERMISSION_MODE_OPTION_ID, mode)
          }
        : null,
    [agent, optionState.pendingId, permissionModes, permissionState.pending, setStructuredOption]
  )
  const optionSurface = useMemo<StructuredSessionOptionsSurface>(
    () => ({
      getSnapshot: () => optionSnapshot,
      setOption,
      invokeAction: async () => ({ snapshot: optionSnapshot }),
      subscribe: () => () => {},
      permissionPicker
    }),
    [setOption, optionSnapshot, permissionPicker]
  )

  const support =
    transportEnabled && conversationSupport?.sessionId === sessionId ? conversationSupport : null
  return {
    conversationCommands: support?.commands ?? [],
    /** Absent unless this host and session can change the goal. */
    threadGoal: support?.threadGoal,
    /** Absent from a host that predates it or a session that writes no context facts. */
    contextUsage: support?.contextUsage,
    /** Undefined until this fence's options read answers. */
    rewind: support?.fence === fence ? support.rewind : undefined,
    optionSnapshot,
    optionSurface,
    setStructuredOption,
    unavailable: hostCatalog.unavailable
  }
}
