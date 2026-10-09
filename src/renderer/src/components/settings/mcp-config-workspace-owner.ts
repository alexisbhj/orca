import type { Repo } from '../../../../shared/repo-types'
import {
  getRepoExecutionHostId,
  getRepoSshConnectionId,
  parseExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import type { AppState } from '@/store/types'
import { findRepoForHost } from '@/store/slices/repo-host-identity'
import {
  worktreeHostMatchOptions,
  worktreeMatchesHost
} from '@/store/slices/worktrees/listing/worktree-host-ownership'
import { resolveExactWorktreeRoute } from '@/lib/worktree-owner-route'
import { captureWorktreeOperationGenerationGuard } from '@/lib/worktree-operation-generation'
import { captureDirectSshMutationExpectation } from '@/lib/ssh-mutation-expectation'
import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client'

export type McpConfigWorkspaceOwner = {
  worktreeId: string
  rootPath: string
  executionHostId: ExecutionHostId
  context: RuntimeFileOperationArgs
}

type WorkspaceOwnerState = Pick<
  AppState,
  'repos' | 'worktreesByRepo' | 'activeWorktreeId' | 'activeWorkspaceExecutionHostId'
>

export function resolveMcpConfigWorkspaceOwner(
  state: WorkspaceOwnerState,
  repo: Repo
): McpConfigWorkspaceOwner {
  const repoHostId = getRepoExecutionHostId(repo)
  const repoHost = parseExecutionHostId(repoHostId)
  const matchOptions = worktreeHostMatchOptions(state, repo.id, repoHostId)
  const worktrees = (state.worktreesByRepo[repo.id] ?? []).filter((worktree) =>
    worktreeMatchesHost(worktree, repoHostId, matchOptions)
  )
  const active = worktrees.find(
    (worktree) =>
      worktree.id === state.activeWorktreeId &&
      (!state.activeWorkspaceExecutionHostId ||
        state.activeWorkspaceExecutionHostId === repoHostId ||
        state.activeWorkspaceExecutionHostId === worktree.hostId)
  )
  const target =
    active ??
    worktrees.find((worktree) => worktree.isMainWorktree) ??
    worktrees.find((worktree) => worktree.path === repo.path) ??
    worktrees[0]
  const connectionId = getRepoSshConnectionId(repo)
  const owner = {
    id: target?.id ?? `${repo.id}::${repo.path}`,
    repoId: repo.id,
    hostId: target?.hostId ?? (connectionId ? toSshExecutionHostId(connectionId) : repoHostId),
    runtimeOwnerEnvironmentId:
      target?.runtimeOwnerEnvironmentId ??
      (repoHost?.kind === 'runtime' ? repoHost.environmentId : undefined)
  }
  const resolution = resolveExactWorktreeRoute({ repos: [repo] }, owner)
  const route = resolution.kind === 'resolved' ? resolution.route : null
  const host = parseExecutionHostId(route?.executionHostId)
  if (!route || !host) {
    throw new Error('Unable to resolve the MCP config host.')
  }
  return {
    worktreeId: owner.id,
    rootPath: target?.path ?? repo.path,
    executionHostId: host.id,
    context: {
      settings: { activeRuntimeEnvironmentId: route.runtimeEnvironmentId },
      worktreeId: owner.id,
      worktreePath: target?.path ?? repo.path,
      connectionId: !route.runtimeEnvironmentId && host.kind === 'ssh' ? host.targetId : undefined,
      expectedExecutionHostId: host.kind === 'ssh' ? host.id : 'local'
    }
  }
}

export function captureMcpConfigOperation(
  repo: Repo,
  workspace: McpConfigWorkspaceOwner,
  getState: () => AppState
): { context: RuntimeFileOperationArgs; assertCurrent: () => void } {
  const repoHostId = getRepoExecutionHostId(repo)
  const resolveCurrentRoute = () => {
    const state = getState()
    const currentRepo = findRepoForHost(state.repos, repo.id, { hostId: repoHostId })
    if (!currentRepo || currentRepo.path !== repo.path) {
      return null
    }
    const current = resolveMcpConfigWorkspaceOwner(state, currentRepo)
    return current.worktreeId === workspace.worktreeId && current.rootPath === workspace.rootPath
      ? {
          executionHostId: current.executionHostId,
          runtimeEnvironmentId: current.context.settings?.activeRuntimeEnvironmentId ?? null
        }
      : null
  }
  const route = {
    executionHostId: workspace.executionHostId,
    runtimeEnvironmentId: workspace.context.settings?.activeRuntimeEnvironmentId ?? null
  }
  const guard = captureWorktreeOperationGenerationGuard(
    getState,
    workspace.worktreeId,
    route,
    () => new Error('The MCP config workspace changed. Refresh and try again.'),
    resolveCurrentRoute
  )
  const host = parseExecutionHostId(workspace.executionHostId)
  const context = {
    ...workspace.context,
    ...(host?.kind === 'ssh'
      ? captureDirectSshMutationExpectation(getState(), host.targetId, route.runtimeEnvironmentId)
      : {})
  }
  return {
    context,
    assertCurrent: () => {
      guard.assertCurrent()
      if (
        host?.kind === 'ssh' &&
        captureDirectSshMutationExpectation(getState(), host.targetId, route.runtimeEnvironmentId)
          .expectedSshConnectionGeneration !== context.expectedSshConnectionGeneration
      ) {
        throw new Error('The MCP config workspace changed. Refresh and try again.')
      }
    }
  }
}
