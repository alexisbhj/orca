import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  commitAgentSessionPermissionMode,
  isAgentChatPermissionMode,
  parseAgentSessionPermissionModes,
  type AgentSessionPermissionModes,
  type AgentSessionPermissionSeed
} from '../../../src/shared/agent-chat-permission-mode'
import type { MobileStructuredPermissionPublication } from './mobile-structured-permission-publication'

type Scope = {
  agent: string | null
  sessionId: string | null
  sessionKey?: string
  enabled: boolean
}
type Confirmation = {
  generation: number
  permission: AgentSessionPermissionModes | null
}
type PermissionState = {
  scope: Scope
  fence: number | null
  publication: MobileStructuredPermissionPublication | undefined
  confirmed: Confirmation | null
}
type PermissionRequest = { scope: Scope; fence: number | null; generation: number }

function publishedPermission(
  agent: string | null,
  publication: MobileStructuredPermissionPublication,
  current: AgentSessionPermissionModes | null
): AgentSessionPermissionModes | null {
  const provisional =
    publication.mode === null
      ? null
      : commitAgentSessionPermissionMode(null, agent ?? '', publication.mode)
  return provisional
    ? { current: provisional.current, supported: current?.supported ?? provisional.supported }
    : null
}

export function useMobileStructuredPermissionState(
  args: Scope & {
    fence: number | null
    permissionSeed?: AgentSessionPermissionSeed
    permissionMode?: string | null
    permissionPublication?: MobileStructuredPermissionPublication
  }
) {
  const { agent, enabled, sessionId, sessionKey } = args
  const scope = useMemo(
    () => ({ agent, enabled, sessionId, sessionKey }),
    [agent, enabled, sessionId, sessionKey]
  )
  const fence = args.fence ?? args.permissionSeed?.fence ?? null
  const fallbackPublication = useMemo(
    () =>
      args.permissionMode === null || isAgentChatPermissionMode(args.permissionMode)
        ? { mode: args.permissionMode, fence }
        : undefined,
    [args.permissionMode, fence]
  )
  const publication = args.permissionPublication ?? fallbackPublication
  const generation = useRef(0)
  const [stored, setStored] = useState<PermissionState>(() => ({
    scope,
    fence,
    publication: undefined,
    confirmed: null
  }))
  let state = stored
  if (state.scope !== scope || state.fence !== fence) {
    state = { scope, fence, publication: undefined, confirmed: null }
  }
  if (publication !== state.publication) {
    state = {
      ...state,
      publication,
      confirmed:
        publication && publication.fence === fence
          ? {
              generation: generation.current + 1,
              permission: publishedPermission(
                agent,
                publication,
                state.confirmed?.permission ?? null
              )
            }
          : state.confirmed
    }
  }
  if (state !== stored) {
    setStored(state)
  }
  const stateRef = useRef(state)
  useLayoutEffect(() => {
    stateRef.current = state
    generation.current = Math.max(generation.current, state.confirmed?.generation ?? 0)
  }, [state])
  const begin = useCallback((): PermissionRequest => {
    const current = stateRef.current
    return { scope: current.scope, fence: current.fence, generation: ++generation.current }
  }, [])
  const confirm = useCallback(
    (request: PermissionRequest, permission: AgentSessionPermissionModes | null) => {
      const current = stateRef.current
      if (
        request.scope !== current.scope ||
        request.fence !== current.fence ||
        request.generation < (current.confirmed?.generation ?? 0)
      ) {
        return
      }
      const next = { ...current, confirmed: { generation: request.generation, permission } }
      stateRef.current = next
      setStored(next)
    },
    []
  )
  const confirmRead = useCallback(
    (request: PermissionRequest, modes: unknown) =>
      confirm(request, parseAgentSessionPermissionModes(modes)),
    [confirm]
  )
  const confirmWrite = useCallback(
    (request: PermissionRequest, mode: string | undefined) => {
      if (mode && isAgentChatPermissionMode(mode)) {
        confirm(
          request,
          publishedPermission(
            agent,
            { mode, fence: request.fence },
            stateRef.current.confirmed?.permission ?? null
          )
        )
      }
    },
    [agent, confirm]
  )
  const seed = args.permissionSeed
  const permission = useMemo(
    () =>
      state.confirmed
        ? state.confirmed.permission
        : seed?.fence === fence
          ? commitAgentSessionPermissionMode(null, agent ?? '', seed.mode)
          : null,
    [state.confirmed, agent, seed?.mode, seed?.fence, fence]
  )
  return useMemo(
    () => ({ permission, begin, confirmRead, confirmWrite }),
    [permission, begin, confirmRead, confirmWrite]
  )
}
