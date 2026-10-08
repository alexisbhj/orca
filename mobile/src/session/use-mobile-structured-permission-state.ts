import * as React from 'react'
import { useMemo } from 'react'
import { isAgentChatPermissionMode } from '../../../src/shared/agent-chat-permission-mode'
import { useAgentSessionPermissionState } from '../../../src/shared/use-agent-session-permission-state'
import type { MobileStructuredAgentOptionsArgs } from './mobile-structured-options-controller'

export function useMobileStructuredPermissionState(args: MobileStructuredAgentOptionsArgs) {
  const publication = useMemo(
    () =>
      args.permissionPublication ??
      (args.permissionMode === null || isAgentChatPermissionMode(args.permissionMode)
        ? { mode: args.permissionMode, fence: args.fence, revision: args.permissionRevision }
        : undefined),
    [args.permissionPublication, args.permissionMode, args.fence, args.permissionRevision]
  )
  return useAgentSessionPermissionState(
    {
      identity: JSON.stringify([args.sessionKey, args.agent, args.sessionId]),
      agent: args.agent ?? '',
      seed: args.permissionSeed,
      publication,
      fence: args.fence
    },
    React
  )
}
