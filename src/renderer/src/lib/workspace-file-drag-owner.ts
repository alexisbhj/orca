import {
  parseExecutionHostId,
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'
import {
  isResolvedWorkspaceFileDragExecutionHost,
  type WorkspaceFileDragSource
} from './workspace-file-drag'

export function isWorkspaceFileDragSourceOnHost(
  source: WorkspaceFileDragSource | null,
  executionHostId: ExecutionHostId | null | undefined,
  runtimeEnvironmentId: string | null
): boolean {
  const targetHost = parseExecutionHostId(executionHostId)
  if (!source || !targetHost || !isResolvedWorkspaceFileDragExecutionHost(source.executionHostId)) {
    return false
  }
  const sourceHost = parseExecutionHostId(source.executionHostId)
  const sourceEnvironmentId =
    source.runtimeEnvironmentId ??
    (sourceHost?.kind === 'runtime' ? sourceHost.environmentId : null)
  const targetEnvironmentId =
    runtimeEnvironmentId ?? (targetHost.kind === 'runtime' ? targetHost.environmentId : null)
  // A paired host's local pane belongs to that host, not this desktop.
  const targetHostId =
    targetHost.kind === 'local' && targetEnvironmentId
      ? toRuntimeExecutionHostId(targetEnvironmentId)
      : targetHost.id
  return (
    source.executionHostId === targetHostId &&
    sourceEnvironmentId === targetEnvironmentId &&
    (targetHost.kind !== 'runtime' || targetEnvironmentId === targetHost.environmentId)
  )
}
